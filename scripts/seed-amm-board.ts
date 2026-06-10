// Create an AMM (OutcomeSharePool) market on-chain via createAmmMarket and prove
// the full Polymarket-style mechanic: vault-seeded reserves -> buy moves the
// price -> sell exits before resolution. Also usable to seed buy trades on AMM
// pools so prices aren't flat 50/50. On-chain only (no DB; the market row is
// written by the auto-deployer / seed-real-board with DATABASE_URL).
// Run: pnpm tsx --env-file=.env.local scripts/seed-amm-board.ts
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, decodeEventLog, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const rpc = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
const factory = process.env.MARKET_FACTORY_ADDRESS! as `0x${string}`;
const resolver = (process.env.AI_JUDGE_VERIFIER_ADDRESS || process.env.OPTIMISTIC_ORACLE_RESOLVER_ADDRESS)! as `0x${string}`;
const stake = process.env.STAKE_TOKEN_ADDRESS! as `0x${string}`;
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY! as Hex);
const ax = (h: string) => `https://sepolia.arbiscan.io/tx/${h}`;
const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const MAX = 2n ** 256n - 1n;
const fmt = (x: bigint) => (Number(x) / 1e6).toFixed(2);

const factoryAbi = [
  { type: "function", name: "createAmmMarket", stateMutability: "nonpayable", inputs: [{ name: "specHash", type: "bytes32" }, { name: "deadline", type: "uint256" }, { name: "resolver", type: "address" }, { name: "specUri", type: "string" }, { name: "seedAmount", type: "uint256" }], outputs: [{ name: "marketId", type: "uint256" }] },
  { type: "event", name: "MarketCreated", inputs: [{ indexed: true, name: "marketId", type: "uint256" }, { indexed: true, name: "pool", type: "address" }, { indexed: true, name: "specHash", type: "bytes32" }, { indexed: false, name: "creator", type: "address" }, { indexed: false, name: "resolver", type: "address" }, { indexed: false, name: "deadline", type: "uint256" }, { indexed: false, name: "specUri", type: "string" }] },
] as const;
const poolAbi = [
  { type: "function", name: "buy", stateMutability: "nonpayable", inputs: [{ name: "side", type: "uint8" }, { name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sell", stateMutability: "nonpayable", inputs: [{ name: "side", type: "uint8" }, { name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "yesReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "noReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "quoteBuy", stateMutability: "view", inputs: [{ name: "side", type: "uint8" }, { name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "yesBalanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

const pub = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
const w = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpc) });
const wait = async (label: string, h: `0x${string}`) => { const r = await pub.waitForTransactionReceipt({ hash: h }); console.log(`  ${label}: ${r.status}  ${ax(h)}`); if (r.status !== "success") throw new Error(`${label} reverted`); return r; };
const read = (address: `0x${string}`, abi: readonly unknown[], functionName: string, args: unknown[] = []) => pub.readContract({ address, abi: abi as never, functionName, args } as never) as Promise<bigint>;

async function pct(pool: `0x${string}`) {
  const y = await read(pool, poolAbi, "yesReserve");
  const n = await read(pool, poolAbi, "noReserve");
  // Lower reserve = more bought = higher implied price for that side.
  const yesPrice = Number(n) / Number(y + n);
  return `YES~${(yesPrice * 100).toFixed(1)}%  (yesR ${fmt(y)} / noR ${fmt(n)})`;
}

async function main() {
  console.log("wallet:", account.address, "| factory:", factory, "| resolver:", resolver);
  const spec = { title: "AMM DEMO: Will YES win?", oracleType: "zktls-ai-oracle", asset: "USDC", category: "crypto" };
  const specJson = JSON.stringify(spec);
  const specHash = keccak256(stringToHex(specJson));
  const specUri = `data:application/json;base64,${Buffer.from(specJson, "utf8").toString("base64")}`;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3 * 86400);
  const seed = usdc(1000);

  console.log("\n[1] createAmmMarket (seed 1000 USDC)...");
  const rc = await wait("createAmmMarket", await w.writeContract({ address: factory, abi: factoryAbi, functionName: "createAmmMarket", args: [specHash, deadline, resolver, specUri, seed] }));
  let pool = "0x" as `0x${string}`; let marketId = 0n;
  for (const log of rc.logs) { try { const d = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics }); if (d.eventName === "MarketCreated") { const a = d.args as unknown as { marketId: bigint; pool: `0x${string}` }; marketId = a.marketId; pool = a.pool; break; } } catch { /* skip */ } }
  console.log("  marketId:", marketId.toString(), "pool:", pool);
  console.log("  seeded reserves:", await pct(pool));

  console.log("\n[2] buy YES $100 (price should move up)...");
  const bal = await read(stake, erc20Abi, "balanceOf", [account.address]);
  if (bal < usdc(200)) await wait("mint", await w.writeContract({ address: stake, abi: erc20Abi, functionName: "mint", args: [account.address, usdc(10000)] }));
  const allow = await read(stake, erc20Abi, "allowance", [account.address, pool]);
  if (allow < usdc(100)) await wait("approve", await w.writeContract({ address: stake, abi: erc20Abi, functionName: "approve", args: [pool, MAX] }));
  const quoted = await read(pool, poolAbi, "quoteBuy", [0, usdc(100)]);
  console.log("  quoteBuy YES $100 ->", fmt(quoted), "shares");
  await wait("buy(YES,$100)", await w.writeContract({ address: pool, abi: poolAbi, functionName: "buy", args: [0, usdc(100)] }));
  const myShares = await read(pool, poolAbi, "yesBalanceOf", [account.address]);
  console.log("  my YES shares:", fmt(myShares), "| price now:", await pct(pool));

  console.log("\n[3] sell half the YES shares (EXIT before resolution)...");
  const sellAmt = myShares / 2n;
  await wait("sell(YES)", await w.writeContract({ address: pool, abi: poolAbi, functionName: "sell", args: [0, sellAmt] }));
  console.log("  sold", fmt(sellAmt), "shares back | price now:", await pct(pool));

  console.log("\nAMM mechanic verified: seed -> buy (price up) -> sell (exit). marketId", marketId.toString(), "pool", pool);
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
