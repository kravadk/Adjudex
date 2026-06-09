// Demo: full AI-judged optimistic-resolution lifecycle on Arbitrum Sepolia, on
// real contracts, producing explorer-linkable transactions for the demo video:
//   createSoftMarket(resolver) -> bet(YES) -> assertOutcome -> settle -> claim
// Single wallet (DEPLOYER_PRIVATE_KEY) acts as resolver owner + asserter + bettor.
// It lowers the resolver liveness to the 10-minute minimum so the cycle completes
// in ~12 minutes. Run: pnpm tsx --env-file=.env.local scripts/demo-resolution.ts
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToHex,
  decodeEventLog,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const rpc = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
const factory = process.env.MARKET_FACTORY_ADDRESS! as `0x${string}`;
const resolver = process.env.OPTIMISTIC_ORACLE_RESOLVER_ADDRESS! as `0x${string}`;
const stake = process.env.STAKE_TOKEN_ADDRESS! as `0x${string}`;
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY! as Hex);
const ax = (h: string) => `https://sepolia.arbiscan.io/tx/${h}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const factoryAbi = [
  { type: "function", name: "createSoftMarket", stateMutability: "nonpayable", inputs: [{ name: "specHash", type: "bytes32" }, { name: "deadline", type: "uint256" }, { name: "verifier", type: "address" }, { name: "specUri", type: "string" }], outputs: [{ name: "marketId", type: "uint256" }] },
  { type: "event", name: "MarketCreated", inputs: [{ indexed: true, name: "marketId", type: "uint256" }, { indexed: true, name: "pool", type: "address" }, { indexed: true, name: "specHash", type: "bytes32" }, { indexed: false, name: "creator", type: "address" }, { indexed: false, name: "resolver", type: "address" }, { indexed: false, name: "deadline", type: "uint256" }, { indexed: false, name: "specUri", type: "string" }] },
] as const;
const poolAbi = [
  { type: "function", name: "bet", stateMutability: "nonpayable", inputs: [{ name: "side", type: "uint8" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ name: "positionId", type: "uint256" }], outputs: [] },
  { type: "function", name: "nextPositionId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
const resolverAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "defaultBond", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "defaultLiveness", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "setDefaultLiveness", stateMutability: "nonpayable", inputs: [{ name: "l", type: "uint64" }], outputs: [] },
  { type: "function", name: "assertOutcome", stateMutability: "nonpayable", inputs: [{ name: "pool", type: "address" }, { name: "marketId", type: "uint256" }, { name: "outcome", type: "uint8" }, { name: "evidenceHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ name: "marketId", type: "uint256" }], outputs: [] },
  { type: "function", name: "canSettle", stateMutability: "view", inputs: [{ name: "marketId", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const pub = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
const w = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpc) });
const send = async (label: string, hash: `0x${string}`) => {
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${label}: ${r.status}  ${ax(hash)}`);
  if (r.status !== "success") throw new Error(`${label} reverted`);
  return r;
};

async function main() {
  console.log("wallet:", account.address);

  // 0) liveness -> 10 min (MIN) so the demo settles quickly
  const liveness = (await pub.readContract({ address: resolver, abi: resolverAbi, functionName: "defaultLiveness" })) as bigint;
  const owner = (await pub.readContract({ address: resolver, abi: resolverAbi, functionName: "owner" })) as string;
  if (owner.toLowerCase() === account.address.toLowerCase() && liveness > 600n) {
    await send("setDefaultLiveness(600)", await w.writeContract({ address: resolver, abi: resolverAbi, functionName: "setDefaultLiveness", args: [600n] }));
  }
  const bond = (await pub.readContract({ address: resolver, abi: resolverAbi, functionName: "defaultBond" })) as bigint;

  // 1) create a soft market resolved by the optimistic resolver, deadline now+90s
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 90);
  const spec = { title: "DEMO: Will YES win this market?", description: "End-to-end demo of AI-judged optimistic resolution.", category: "crypto", oracleType: "optimistic-oracle", asset: "USDC", deadlineIso: new Date(Number(deadline) * 1000).toISOString(), feeBps: 100, sourceUrl: "https://adjudex.vercel.app", resolutionCriteria: "Resolves YES for the demo." };
  const specJson = JSON.stringify(spec);
  const specHash = keccak256(stringToHex(specJson));
  const specUri = `data:application/json;base64,${Buffer.from(specJson, "utf8").toString("base64")}`;
  const createHash = await w.writeContract({ address: factory, abi: factoryAbi, functionName: "createSoftMarket", args: [specHash, deadline, resolver, specUri] });
  const createRcpt = await send("createSoftMarket", createHash);
  let marketId = 0n;
  let pool = "0x" as `0x${string}`;
  for (const log of createRcpt.logs) {
    try {
      const d = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
      if (d.eventName === "MarketCreated") { const a = d.args as unknown as { marketId: bigint; pool: `0x${string}` }; marketId = a.marketId; pool = a.pool; break; }
    } catch { /* not ours */ }
  }
  console.log("marketId:", marketId.toString(), "pool:", pool);

  // 2) bet YES 5 USDC
  const amount = 5_000000n;
  const positionId = (await pub.readContract({ address: pool, abi: poolAbi, functionName: "nextPositionId" })) as bigint;
  const allowPool = (await pub.readContract({ address: stake, abi: erc20Abi, functionName: "allowance", args: [account.address, pool] })) as bigint;
  if (allowPool < amount) await send("approve USDC->pool", await w.writeContract({ address: stake, abi: erc20Abi, functionName: "approve", args: [pool, 2n ** 256n - 1n] }));
  await send("bet(YES, 5 USDC)", await w.writeContract({ address: pool, abi: poolAbi, functionName: "bet", args: [0, amount] }));
  console.log("positionId:", positionId.toString());

  // 3) wait for the deadline, then the AI asserts YES with a bond
  console.log("waiting for deadline (~95s)...");
  await sleep(95_000);
  if (bond > 0n) {
    const allowRes = (await pub.readContract({ address: stake, abi: erc20Abi, functionName: "allowance", args: [account.address, resolver] })) as bigint;
    if (allowRes < bond) await send("approve USDC->resolver", await w.writeContract({ address: stake, abi: erc20Abi, functionName: "approve", args: [resolver, 2n ** 256n - 1n] }));
  }
  const evidenceHash = keccak256(stringToHex(JSON.stringify({ demo: true, outcome: "YES", at: new Date().toISOString() })));
  await send("assertOutcome(YES)", await w.writeContract({ address: resolver, abi: resolverAbi, functionName: "assertOutcome", args: [pool, marketId, 0, evidenceHash] }));

  // 4) wait out the liveness window, then settle
  console.log("waiting out the dispute window (~10.5 min)...");
  for (let i = 0; i < 22; i++) {
    await sleep(30_000);
    const can = (await pub.readContract({ address: resolver, abi: resolverAbi, functionName: "canSettle", args: [marketId] })) as boolean;
    if (can) break;
  }
  await send("settle", await w.writeContract({ address: resolver, abi: resolverAbi, functionName: "settle", args: [marketId] }));

  // 5) claim the winning position
  await send("claim", await w.writeContract({ address: pool, abi: poolAbi, functionName: "claim", args: [positionId] }));

  console.log("\nDONE. marketId=" + marketId.toString() + " pool=" + pool);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
