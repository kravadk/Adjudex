// One-shot onchain sanity check: reads MarketFactory.nextMarketId() and getMarket(1).
// Run: pnpm tsx --env-file=.env.local scripts/verify-onchain.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, http, type Abi, type Address } from "viem";
import { arbitrumSepolia } from "viem/chains";

async function main() {
  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
  const factoryAddress = process.env.MARKET_FACTORY_ADDRESS as Address;
  const repAddress = process.env.REPUTATION_ORACLE_ADDRESS as Address;
  const root = process.cwd();
  const factoryAbi = JSON.parse(
    readFileSync(join(root, "src", "lib", "abi", "MarketFactory.json"), "utf8"),
  ) as Abi;

  const client = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });

  const next = await client.readContract({
    address: factoryAddress,
    abi: factoryAbi,
    functionName: "nextMarketId",
  });
  console.log(`nextMarketId: ${next}`);
  console.log(`So there are ${Number(next) - 1} market(s) deployed.\n`);

  for (let id = 1n; id < (next as bigint); id++) {
    const pool = (await client.readContract({
      address: factoryAddress,
      abi: factoryAbi,
      functionName: "getMarket",
      args: [id],
    })) as Address;
    const code = await client.getCode({ address: pool });
    console.log(`Market #${id}`);
    console.log(`  pool:     ${pool}`);
    console.log(`  bytecode: ${code ? (code.length - 2) / 2 : 0} bytes`);
    console.log(`  explorer: https://sepolia.arbiscan.io/address/${pool}`);
  }

  console.log(`\nMarketFactory:    ${factoryAddress}`);
  console.log(`ReputationOracle: ${repAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
