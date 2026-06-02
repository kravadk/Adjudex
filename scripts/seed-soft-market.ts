// Creates a soft market resolved by AIJudgeVerifier from MARKET_SPEC_JSON.
//
// This script does not write local market records. After the transaction is
// confirmed, run the indexer or POST /api/sync/transaction so Postgres/API
// becomes the source of truth.
//
// Run:
// MARKET_SPEC_JSON='{"title":"...","description":"...","category":"soft","oracleType":"zktls-ai-oracle","asset":"USDC","deadlineIso":"2026-07-01T00:00:00.000Z","feeBps":100,"sourceUrl":"https://...","resolutionCriteria":"..."}' pnpm tsx --env-file=.env.local scripts/seed-soft-market.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

type MarketSpecJson = {
  title: string;
  description: string;
  category: "stocks" | "crypto" | "sports" | "soft";
  oracleType: "chainlink-price" | "zktls-ai-oracle" | "manual";
  asset: "USDC" | "tokenized-TSLA" | "tokenized-AAPL";
  deadlineIso: string;
  feeBps: number;
  sourceUrl: string;
  resolutionCriteria: string;
};

function readSpec(): MarketSpecJson {
  const raw = process.env.MARKET_SPEC_JSON;
  if (!raw) throw new Error("MARKET_SPEC_JSON is required.");
  const spec = JSON.parse(raw) as Partial<MarketSpecJson>;
  const required: Array<keyof MarketSpecJson> = [
    "title",
    "description",
    "category",
    "oracleType",
    "asset",
    "deadlineIso",
    "feeBps",
    "sourceUrl",
    "resolutionCriteria",
  ];
  for (const key of required) {
    if (spec[key] === undefined || spec[key] === "") throw new Error(`MARKET_SPEC_JSON.${key} is required.`);
  }
  if (Number.isNaN(new Date(spec.deadlineIso!).getTime())) throw new Error("MARKET_SPEC_JSON.deadlineIso is invalid.");
  return spec as MarketSpecJson;
}

async function main() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  const factoryAddress = process.env.MARKET_FACTORY_ADDRESS as Address | undefined;
  const verifierAddress = process.env.AI_JUDGE_VERIFIER_ADDRESS as Address | undefined;

  if (!privateKey || !rpcUrl || !factoryAddress || !verifierAddress) {
    throw new Error(
      "Set DEPLOYER_PRIVATE_KEY, ARBITRUM_SEPOLIA_RPC_URL, MARKET_FACTORY_ADDRESS, AI_JUDGE_VERIFIER_ADDRESS in .env.local.",
    );
  }

  const root = process.cwd();
  const factoryAbi = JSON.parse(
    readFileSync(join(root, "src", "lib", "abi", "MarketFactory.json"), "utf8"),
  ) as Abi;

  const spec = readSpec();
  const specJson = JSON.stringify(spec);
  const specHash = keccak256(stringToHex(specJson));
  const deadlineSec = BigInt(Math.floor(new Date(spec.deadlineIso).getTime() / 1000));
  const specUri = `data:application/json;base64,${Buffer.from(specJson).toString("base64")}`;

  const chain = arbitrumSepolia;
  const transport = http(rpcUrl);
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  console.log(`Factory:  ${factoryAddress}`);
  console.log(`Verifier: ${verifierAddress}`);
  console.log(`Caller:   ${account.address}`);
  console.log(`SpecHash: ${specHash}`);
  console.log(`Deadline: ${spec.deadlineIso} (${deadlineSec})`);

  const hash = await walletClient.writeContract({
    address: factoryAddress,
    abi: factoryAbi,
    functionName: "createSoftMarket",
    args: [specHash, deadlineSec, verifierAddress, specUri],
  });
  console.log(`tx: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`createSoftMarket reverted: ${hash}`);

  let marketId: bigint | null = null;
  let poolAddress: Address | null = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "MarketCreated") {
        const args = decoded.args as unknown as { marketId: bigint; pool: Address };
        marketId = args.marketId;
        poolAddress = args.pool;
        break;
      }
    } catch {
      // not our event
    }
  }
  if (!marketId || !poolAddress) throw new Error("MarketCreated event not found in tx logs.");

  console.log(`marketId: ${marketId.toString()}`);
  console.log(`pool:     ${poolAddress}`);
  console.log(`sync:     POST /api/sync/transaction { "transactionHash": "${hash}", "chainId": ${chain.id} }`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
