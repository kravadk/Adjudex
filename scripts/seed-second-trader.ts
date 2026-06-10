// Add a genuine SECOND distinct trader to every market: spin up an ephemeral
// wallet, fund it with a little ETH from the deployer, then have it public-mint
// each pool's own stake token and place one clean-amount bet per market. Result:
// each market has >=2 distinct on-chain trader addresses (not just positions from
// one wallet). On-chain only (no DB writes). Testnet only.
// Run: pnpm tsx --env-file=.env.local scripts/seed-second-trader.ts
import { createPublicClient, createWalletClient, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const rpc = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
const apiBase = process.env.SEED_API_BASE || "https://adjudex-api.onrender.com";
const count = Number(process.env.SEED_COUNT || "40");
const funder = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY! as Hex);
const traderKey = (process.env.SEED_WALLET_2_KEY as Hex) || generatePrivateKey();
const trader = privateKeyToAccount(traderKey);
const ax = (h: string) => `https://sepolia.arbiscan.io/tx/${h}`;

const poolAbi = [
  { type: "function", name: "bet", stateMutability: "nonpayable", inputs: [{ name: "side", type: "uint8" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "stake", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

const pub = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
const wFunder = createWalletClient({ account: funder, chain: arbitrumSepolia, transport: http(rpc) });
const wTrader = createWalletClient({ account: trader, chain: arbitrumSepolia, transport: http(rpc) });
const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const MAX = 2n ** 256n - 1n;
// Clean, varied amounts + alternating side so the second trader nudges each
// market's probability organically rather than uniformly.
const PLAN: Array<{ amt: number; side: 0 | 1 }> = [
  { amt: 30, side: 1 }, { amt: 50, side: 0 }, { amt: 20, side: 1 }, { amt: 40, side: 0 },
  { amt: 25, side: 1 }, { amt: 60, side: 0 }, { amt: 35, side: 1 }, { amt: 45, side: 0 },
  { amt: 15, side: 1 }, { amt: 55, side: 0 },
];

async function wait(hash: `0x${string}`) {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("reverted");
  return r;
}

async function main() {
  console.log("funder:", funder.address);
  console.log("second trader (ephemeral):", trader.address);

  // 1) fund the trader with a little ETH for gas (~62 cheap Arb Sepolia txs).
  const bal = await pub.getBalance({ address: trader.address });
  if (bal < parseEther("0.004")) {
    const h = await wFunder.sendTransaction({ to: trader.address, value: parseEther("0.012") });
    console.log("funding ETH:", ax(h));
    await wait(h);
  }

  // 2) one clean bet per market from the trader.
  const res = await fetch(`${apiBase}/api/markets?limit=${Math.max(count, 40)}`);
  const j = (await res.json()) as unknown;
  type Mkt = { id: string; poolAddress?: string; pool?: string };
  const list: Mkt[] = Array.isArray(j) ? (j as Mkt[]) : ((j as { markets?: Mkt[] }).markets || []);
  const markets = list.filter((m) => m.poolAddress || m.pool).slice(0, count);
  console.log(`seeding a 2nd trader across ${markets.length} markets...`);
  const minted = new Set<string>();
  let ok = 0;

  for (let i = 0; i < markets.length; i++) {
    const pool = (markets[i].poolAddress || markets[i].pool) as `0x${string}`;
    const { amt, side } = PLAN[i % PLAN.length];
    try {
      const token = (await pub.readContract({ address: pool, abi: poolAbi, functionName: "stake" })) as `0x${string}`;
      const need = usdc(amt);
      const tbal = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [trader.address] })) as bigint;
      if (tbal < need && !minted.has(token.toLowerCase())) {
        await wait(await wTrader.writeContract({ address: token, abi: erc20Abi, functionName: "mint", args: [trader.address, usdc(1_000_000)] }));
        minted.add(token.toLowerCase());
      }
      const allow = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [trader.address, pool] })) as bigint;
      if (allow < need) await wait(await wTrader.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [pool, MAX] }));
      await wait(await wTrader.writeContract({ address: pool, abi: poolAbi, functionName: "bet", args: [side, need] }));
      ok++;
      console.log(`  [${i + 1}/${markets.length}] ${markets[i].id}  ${side === 0 ? "YES" : "NO"} $${amt}  OK`);
    } catch (e) {
      console.log(`  [${i + 1}/${markets.length}] ${markets[i].id}  SKIP (${(e as Error).message.split("\n")[0].slice(0, 60)})`);
    }
  }
  console.log(`\nsecond trader ${trader.address} placed ${ok}/${markets.length} bets.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
