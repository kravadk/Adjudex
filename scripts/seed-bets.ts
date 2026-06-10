// Seed activity on EVERY open market so the whole board shows non-50/50
// probabilities and a live activity feed. For each market it reads the pool's
// OWN stake token (stake()), public-mints that TestUSDC to the seeder, approves
// it, and places asymmetric YES/NO bets. Works across factories (each pool
// reports its own collateral). Testnet only; single wallet.
// Run: SEED_COUNT=40 pnpm tsx --env-file=.env.local scripts/seed-bets.ts
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const rpc = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
const apiBase = process.env.SEED_API_BASE || "https://adjudex-api.onrender.com";
const count = Number(process.env.SEED_COUNT || "40");
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY! as Hex);
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
const w = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpc) });
const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const MAX = 2n ** 256n - 1n;
// Varied (yes,no) stakes so probabilities look organic across the board.
const PLAN: Array<[number, number]> = [[12, 5], [6, 11], [15, 4], [9, 14], [20, 7], [5, 9], [11, 6], [7, 13], [18, 8], [4, 10]];

async function wait(label: string, hash: `0x${string}`) {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted`);
  return r;
}

async function main() {
  console.log("seeder:", account.address);
  const res = await fetch(`${apiBase}/api/markets?limit=${Math.max(count, 40)}`);
  const j = (await res.json()) as unknown;
  type Mkt = { id: string; poolAddress?: string; pool?: string };
  const list: Mkt[] = Array.isArray(j) ? (j as Mkt[]) : ((j as { markets?: Mkt[] }).markets || []);
  const markets = list.filter((m) => m.poolAddress || m.pool).slice(0, count);
  console.log(`seeding ${markets.length} markets...`);
  const minted = new Set<string>();
  let ok = 0;

  for (let i = 0; i < markets.length; i++) {
    const pool = (markets[i].poolAddress || markets[i].pool) as `0x${string}`;
    const [yes, no] = PLAN[i % PLAN.length];
    try {
      const token = (await pub.readContract({ address: pool, abi: poolAbi, functionName: "stake" })) as `0x${string}`;
      const need = usdc(yes + no);
      const bal = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) as bigint;
      if (bal < need && !minted.has(token.toLowerCase())) {
        await wait("mint", await w.writeContract({ address: token, abi: erc20Abi, functionName: "mint", args: [account.address, usdc(1_000_000)] }));
        minted.add(token.toLowerCase());
      }
      const allow = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, pool] })) as bigint;
      if (allow < need) await wait("approve", await w.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [pool, MAX] }));
      await wait("betYES", await w.writeContract({ address: pool, abi: poolAbi, functionName: "bet", args: [0, usdc(yes)] }));
      await wait("betNO", await w.writeContract({ address: pool, abi: poolAbi, functionName: "bet", args: [1, usdc(no)] }));
      ok++;
      console.log(`  [${i + 1}/${markets.length}] ${markets[i].id}  YES $${yes} / NO $${no}  OK`);
    } catch (e) {
      console.log(`  [${i + 1}/${markets.length}] ${markets[i].id}  SKIP (${(e as Error).message.split("\n")[0].slice(0, 60)})`);
    }
  }
  console.log(`\nseeded ${ok}/${markets.length} markets.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
