// One-off unblock: on Arbitrum (421614) the DB market id == raw on-chain
// marketId (canonicalMarketId), so the NEW factory's ids collide with the OLD
// factory's already-in-DB ids 3..31. Advance the new factory's marketId counter
// past the old max with cheap throwaway AMM markets (tiny seed) so subsequent
// real AMM markets land in the DB without an auto_markets_pkey collision.
// On-chain only (no DB). Run: TARGET_ID=33 pnpm tsx --env-file=.env.local scripts/advance-amm-counter.ts
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, decodeEventLog, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const rpc = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
const factory = process.env.MARKET_FACTORY_ADDRESS! as `0x${string}`;
const resolver = (process.env.AI_JUDGE_VERIFIER_ADDRESS || process.env.OPTIMISTIC_ORACLE_RESOLVER_ADDRESS)! as `0x${string}`;
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY! as Hex);
const target = BigInt(process.env.TARGET_ID || "33");

const factoryAbi = [
  { type: "function", name: "createAmmMarket", stateMutability: "nonpayable", inputs: [{ name: "specHash", type: "bytes32" }, { name: "deadline", type: "uint256" }, { name: "resolver", type: "address" }, { name: "specUri", type: "string" }, { name: "seedAmount", type: "uint256" }], outputs: [{ name: "marketId", type: "uint256" }] },
  { type: "event", name: "MarketCreated", inputs: [{ indexed: true, name: "marketId", type: "uint256" }, { indexed: true, name: "pool", type: "address" }, { indexed: true, name: "specHash", type: "bytes32" }, { indexed: false, name: "creator", type: "address" }, { indexed: false, name: "resolver", type: "address" }, { indexed: false, name: "deadline", type: "uint256" }, { indexed: false, name: "specUri", type: "string" }] },
] as const;

const pub = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
const w = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpc) });

async function createOne(i: number): Promise<bigint> {
  const spec = JSON.stringify({ title: `counter-advance ${i}`, oracleType: "zktls-ai-oracle", asset: "USDC", category: "crypto" });
  const specHash = keccak256(stringToHex(spec));
  const specUri = `data:application/json;base64,${Buffer.from(spec, "utf8").toString("base64")}`;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400);
  const hash = await w.writeContract({ address: factory, abi: factoryAbi, functionName: "createAmmMarket", args: [specHash, deadline, resolver, specUri, 2_000_000n] });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`createAmmMarket reverted (${hash})`);
  for (const log of rc.logs) {
    try {
      const d = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
      if (d.eventName === "MarketCreated") return (d.args as unknown as { marketId: bigint }).marketId;
    } catch { /* skip */ }
  }
  throw new Error("MarketCreated not found");
}

async function main() {
  console.log("advancing new-factory marketId counter past", target.toString(), "...");
  let last = 0n;
  for (let i = 0; i < 60; i++) {
    last = await createOne(i);
    console.log("  created marketId", last.toString());
    if (last >= target) break;
  }
  console.log("done. next createAmmMarket will be marketId", (last + 1n).toString(), "(clean of old DB ids).");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
