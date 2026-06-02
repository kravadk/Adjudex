// Deploy TestAggregatorV3 instances per asset and register them in PriceOracle.
//
// Chainlink classic Data Feeds (AggregatorV3) are not deployed on Arbitrum
// Sepolia (421614); Data Streams use a different interface. For testnet,
// operator-controlled TestAggregatorV3 contracts provide explicit configured
// feeds. Mainnet must use real oracle addresses.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  stringToBytes,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import solc from "solc";

const TESTNET_OPT_IN = "ADJUDEX_TESTNET_ONLY";

type CompiledContract = { abi: Abi; evm: { bytecode: { object: string } } };

type Preset = {
  symbol: string;
  description: string;
  decimals: number;
  initialAnswer: bigint;
};

const PRESETS: Preset[] = [
  { symbol: "BTC", description: "BTC / USD (testnet)", decimals: 8, initialAnswer: 95_000_00_000_000n },
  { symbol: "ETH", description: "ETH / USD (testnet)", decimals: 8, initialAnswer: 3_400_00_000_000n },
  { symbol: "LINK", description: "LINK / USD (testnet)", decimals: 8, initialAnswer: 22_00_000_000n },
  { symbol: "TSLA", description: "TSLA / USD (testnet)", decimals: 8, initialAnswer: 312_00_000_000n },
];

function assertTestnetOptIn() {
  if (process.env[TESTNET_OPT_IN] !== "1") {
    throw new Error(
      "Refusing to deploy/register test oracle feeds without explicit testnet opt-in. " +
        `Set ${TESTNET_OPT_IN}=1 only for Arbitrum Sepolia testnet feed setup.`,
    );
  }
}

async function main() {
  assertTestnetOptIn();

  const root = process.cwd();
  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  const oracle = process.env.PRICE_ORACLE_ADDRESS as Address | undefined;

  if (!rpcUrl || !privateKey || !oracle) {
    throw new Error(
      "Set ARBITRUM_SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, and PRICE_ORACLE_ADDRESS first.",
    );
  }

  const account = privateKeyToAccount(privateKey);
  const chain = arbitrumSepolia;
  const transport = http(rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const pub = createPublicClient({ chain, transport });
  const chainId = await pub.getChainId();
  if (chainId !== arbitrumSepolia.id) {
    throw new Error(
      `Refusing test oracle feed deployment on chain ${chainId}; expected Arbitrum Sepolia (${arbitrumSepolia.id}).`,
    );
  }

  const aggAbi: Abi = JSON.parse(
    readFileSync(join(root, "src", "lib", "abi", "TestAggregatorV3.json"), "utf-8"),
  );
  const oracleAbi: Abi = JSON.parse(
    readFileSync(join(root, "src", "lib", "abi", "PriceOracle.json"), "utf-8"),
  );

  const src = readFileSync(join(root, "contracts", "src", "TestAggregatorV3.sol"), "utf-8");
  const compiled = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "TestAggregatorV3.sol": { content: src } },
        settings: {
          optimizer: { enabled: true, runs: 200 },
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  ) as { contracts: Record<string, Record<string, CompiledContract>> };
  const bytecode = (`0x${compiled.contracts["TestAggregatorV3.sol"].TestAggregatorV3.evm.bytecode.object}`) as Hex;

  console.log(`Deployer: ${account.address}`);
  console.log(`Oracle:   ${oracle}`);
  console.log(`Chain:    ${chain.name} (${chain.id})`);

  for (const preset of PRESETS) {
    console.log(`\n${preset.symbol}`);
    const ctorArgs = encodeAbiParameters(
      [{ type: "uint8" }, { type: "string" }, { type: "int256" }],
      [preset.decimals, preset.description, preset.initialAnswer],
    );
    const deployHash = await wallet.deployContract({
      abi: aggAbi,
      bytecode: (bytecode + ctorArgs.slice(2)) as Hex,
    });
    const deployReceipt = await pub.waitForTransactionReceipt({ hash: deployHash });
    if (deployReceipt.status !== "success") throw new Error(`${preset.symbol} deploy reverted`);
    const aggregator = deployReceipt.contractAddress!;
    console.log(`  aggregator: ${aggregator}`);

    const key = keccak256(stringToBytes(preset.symbol));
    const registerHash = await wallet.writeContract({
      address: oracle,
      abi: oracleAbi,
      functionName: "setFeed",
      args: [key, aggregator],
    });
    await pub.waitForTransactionReceipt({ hash: registerHash });
    console.log(`  PriceOracle.setFeed(${preset.symbol} / ${key.slice(0, 12)}...) ok`);
  }

  console.log("\nFeed registration confirmed on-chain.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
