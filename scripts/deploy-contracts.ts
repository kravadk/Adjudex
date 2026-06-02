import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Hex,
  encodeAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const TESTNET_OPT_IN = "ADJUDEX_TESTNET_ONLY";

type CompiledContract = {
  abi: Abi;
  evm: { bytecode: { object: string } };
};

type SolcOutput = {
  errors?: Array<{ severity: string; formattedMessage: string }>;
  contracts: Record<string, Record<string, CompiledContract>>;
};

function assertTestnetOptIn() {
  if (process.env[TESTNET_OPT_IN] !== "1") {
    throw new Error(
      "Refusing to deploy test collateral/oracle contracts without explicit testnet opt-in. " +
        `Set ${TESTNET_OPT_IN}=1 only for Arbitrum Sepolia testnet deployment.`,
    );
  }
}

function compile(root: string): SolcOutput {
  const src = join(root, "contracts", "src");
  const input = {
    language: "Solidity",
    sources: {
      "ParimutuelPool.sol": { content: readFileSync(join(src, "ParimutuelPool.sol"), "utf8") },
      "MarketFactory.sol": { content: readFileSync(join(src, "MarketFactory.sol"), "utf8") },
      "ReputationOracle.sol": { content: readFileSync(join(src, "ReputationOracle.sol"), "utf8") },
      "TestUSDC.sol": { content: readFileSync(join(src, "TestUSDC.sol"), "utf8") },
      "AIJudgeVerifier.sol": { content: readFileSync(join(src, "AIJudgeVerifier.sol"), "utf8") },
      "PriceOracle.sol": { content: readFileSync(join(src, "PriceOracle.sol"), "utf8") },
      "TokenizedStockAdapter.sol": { content: readFileSync(join(src, "TokenizedStockAdapter.sol"), "utf8") },
      "TestAggregatorV3.sol": { content: readFileSync(join(src, "TestAggregatorV3.sol"), "utf8") },
      "ProofAnchor.sol": { content: readFileSync(join(src, "ProofAnchor.sol"), "utf8") },
      "BetQuoteVerifier.sol": { content: readFileSync(join(src, "BetQuoteVerifier.sol"), "utf8") },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
  const errors = output.errors?.filter((e) => e.severity === "error") ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  }
  return output;
}

function writeAbi(root: string, name: string, abi: Abi) {
  const abiDir = join(root, "src", "lib", "abi");
  mkdirSync(abiDir, { recursive: true });
  writeFileSync(join(abiDir, `${name}.json`), JSON.stringify(abi, null, 2));
}

function patchEnvLocal(root: string, patches: Record<string, string>) {
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) return;
  let body = readFileSync(envPath, "utf8");
  for (const [key, value] of Object.entries(patches)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(body)) {
      body = body.replace(re, `${key}=${value}`);
    } else {
      body += `\n${key}=${value}`;
    }
  }
  writeFileSync(envPath, body);
}

async function main() {
  assertTestnetOptIn();

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;

  if (!privateKey || !rpcUrl) {
    throw new Error(
      "Set DEPLOYER_PRIVATE_KEY and ARBITRUM_SEPOLIA_RPC_URL before running contracts:deploy.",
    );
  }

  const root = process.cwd();
  const account = privateKeyToAccount(privateKey);
  const chain = arbitrumSepolia;
  const transport = http(rpcUrl);
  const walletClient = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });
  const chainId = await publicClient.getChainId();
  if (chainId !== arbitrumSepolia.id) {
    throw new Error(
      `Refusing test collateral/oracle deployment on chain ${chainId}; expected Arbitrum Sepolia (${arbitrumSepolia.id}).`,
    );
  }

  console.log(`Deployer: ${account.address}`);
  console.log(`Chain:    ${chain.name} (${chain.id})`);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance:  ${Number(balance) / 1e18} ETH`);
  if (balance < 1_000_000_000_000_000n) {
    throw new Error("Wallet balance < 0.001 ETH - fund the deployer first.");
  }

  const compiled = compile(root);
  const factory = compiled.contracts["MarketFactory.sol"].MarketFactory;
  const reputation = compiled.contracts["ReputationOracle.sol"].ReputationOracle;
  const pool = compiled.contracts["ParimutuelPool.sol"].ParimutuelPool;
  const usdc = compiled.contracts["TestUSDC.sol"].TestUSDC;
  const judge = compiled.contracts["AIJudgeVerifier.sol"].AIJudgeVerifier;
  const priceOracle = compiled.contracts["PriceOracle.sol"].PriceOracle;
  const stockAdapter = compiled.contracts["TokenizedStockAdapter.sol"].TokenizedStockAdapter;
  const testAggregator = compiled.contracts["TestAggregatorV3.sol"].TestAggregatorV3;
  const proofAnchor = compiled.contracts["ProofAnchor.sol"].ProofAnchor;
  const betQuoteVerifier = compiled.contracts["BetQuoteVerifier.sol"].BetQuoteVerifier;

  writeAbi(root, "MarketFactory", factory.abi);
  writeAbi(root, "ReputationOracle", reputation.abi);
  writeAbi(root, "ParimutuelPool", pool.abi);
  writeAbi(root, "TestUSDC", usdc.abi);
  writeAbi(root, "AIJudgeVerifier", judge.abi);
  writeAbi(root, "PriceOracle", priceOracle.abi);
  writeAbi(root, "TokenizedStockAdapter", stockAdapter.abi);
  writeAbi(root, "TestAggregatorV3", testAggregator.abi);
  writeAbi(root, "ProofAnchor", proofAnchor.abi);
  writeAbi(root, "BetQuoteVerifier", betQuoteVerifier.abi);

  // 2. MarketFactory(stakeToken=TestUSDC)
  console.log("\n> Deploying TestUSDC...");
  const usdcHash = await walletClient.deployContract({
    abi: usdc.abi,
    bytecode: `0x${usdc.evm.bytecode.object}` as Hex,
  });
  console.log(`  tx: ${usdcHash}`);
  const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: usdcHash });
  if (usdcReceipt.status !== "success") {
    throw new Error(`TestUSDC deploy reverted: ${usdcHash}`);
  }
  const usdcAddress = usdcReceipt.contractAddress!;
  console.log(`  ok TestUSDC: ${usdcAddress}`);

  // 1. TestUSDC
  console.log("\n> Deploying MarketFactory...");
  // Fee config: 150 bps (1.5%) by default. Recipient defaults to the
  // deployer EOA — transfer to the governance Safe after deploy via
  // scripts/transfer-ownership.ts (or manually if not yet ownable).
  const feeBps = BigInt(process.env.MARKET_FACTORY_FEE_BPS ?? "150");
  const feeRecipient = (process.env.MARKET_FACTORY_FEE_RECIPIENT ??
    account.address) as `0x${string}`;
  if (feeBps > 500n) throw new Error(`feeBps too high: ${feeBps} > 500`);
  console.log(`  fee: ${feeBps} bps to ${feeRecipient}`);
  const factoryArgs = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "address" },
    ],
    [usdcAddress, feeBps, feeRecipient],
  );
  const factoryHash = await walletClient.deployContract({
    abi: factory.abi,
    bytecode: (`0x${factory.evm.bytecode.object}` + factoryArgs.slice(2)) as Hex,
  });
  console.log(`  tx: ${factoryHash}`);
  const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryHash });
  if (factoryReceipt.status !== "success") {
    throw new Error(`MarketFactory deploy reverted: ${factoryHash}`);
  }
  const factoryAddress = factoryReceipt.contractAddress!;
  console.log(`  ok MarketFactory: ${factoryAddress}`);

  // 3. ReputationOracle
  console.log("\n> Deploying ReputationOracle...");
  const repHash = await walletClient.deployContract({
    abi: reputation.abi,
    bytecode: `0x${reputation.evm.bytecode.object}` as Hex,
  });
  console.log(`  tx: ${repHash}`);
  const repReceipt = await publicClient.waitForTransactionReceipt({ hash: repHash });
  if (repReceipt.status !== "success") {
    throw new Error(`ReputationOracle deploy reverted: ${repHash}`);
  }
  const repAddress = repReceipt.contractAddress!;
  console.log(`  ok ReputationOracle: ${repAddress}`);

  // 4. AIJudgeVerifier(judge=JUDGE_PUBLIC_ADDRESS)
  let judgeAddress: `0x${string}` | "" = "";
  let judgeHash: `0x${string}` | "" = "";
  const judgePublic = process.env.JUDGE_PUBLIC_ADDRESS as `0x${string}` | undefined;
  if (judgePublic && /^0x[0-9a-fA-F]{40}$/.test(judgePublic)) {
    console.log("\n> Deploying AIJudgeVerifier...");
    const judgeArgs = encodeAbiParameters([{ type: "address" }], [judgePublic]);
    judgeHash = await walletClient.deployContract({
      abi: judge.abi,
      bytecode: (`0x${judge.evm.bytecode.object}` + judgeArgs.slice(2)) as Hex,
    });
    console.log(`  tx: ${judgeHash}`);
    const r = await publicClient.waitForTransactionReceipt({ hash: judgeHash });
    if (r.status !== "success") throw new Error(`AIJudgeVerifier reverted: ${judgeHash}`);
    judgeAddress = r.contractAddress!;
    console.log(`  ok AIJudgeVerifier: ${judgeAddress}`);
  } else {
    console.log("\nskip Skipping AIJudgeVerifier (JUDGE_PUBLIC_ADDRESS not set)");
  }

  // 4b. PriceOracle
  console.log("\n> Deploying PriceOracle...");
  const priceHash = await walletClient.deployContract({
    abi: priceOracle.abi,
    bytecode: `0x${priceOracle.evm.bytecode.object}` as Hex,
  });
  console.log(`  tx: ${priceHash}`);
  const priceReceipt = await publicClient.waitForTransactionReceipt({ hash: priceHash });
  if (priceReceipt.status !== "success") throw new Error(`PriceOracle reverted: ${priceHash}`);
  const priceAddress = priceReceipt.contractAddress!;
  console.log(`  ok PriceOracle: ${priceAddress}`);

  // 4c. TokenizedStockAdapter
  console.log("\n> Deploying TokenizedStockAdapter...");
  const stockHash = await walletClient.deployContract({
    abi: stockAdapter.abi,
    bytecode: `0x${stockAdapter.evm.bytecode.object}` as Hex,
  });
  console.log(`  tx: ${stockHash}`);
  const stockReceipt = await publicClient.waitForTransactionReceipt({ hash: stockHash });
  if (stockReceipt.status !== "success") throw new Error(`TokenizedStockAdapter reverted: ${stockHash}`);
  const stockAddress = stockReceipt.contractAddress!;
  console.log(`  ok TokenizedStockAdapter: ${stockAddress}`);

  // 4d. ProofAnchor (Reclaim proof CID anchor + ProofAnchored event)
  console.log("\n> Deploying ProofAnchor...");
  const anchorHash = await walletClient.deployContract({
    abi: proofAnchor.abi,
    bytecode: `0x${proofAnchor.evm.bytecode.object}` as Hex,
  });
  console.log(`  tx: ${anchorHash}`);
  const anchorReceipt = await publicClient.waitForTransactionReceipt({ hash: anchorHash });
  if (anchorReceipt.status !== "success") {
    throw new Error(`ProofAnchor deploy reverted: ${anchorHash}`);
  }
  const anchorAddress = anchorReceipt.contractAddress!;
  console.log(`  ok ProofAnchor: ${anchorAddress}`);

  // 4e. BetQuoteVerifier(quoteSigner=QUOTE_SIGNER_PUBLIC_ADDRESS)
  let quoteVerifierAddress: `0x${string}` | "" = "";
  let quoteVerifierHash: `0x${string}` | "" = "";
  const quoteSignerPublic = process.env.QUOTE_SIGNER_PUBLIC_ADDRESS as
    | `0x${string}`
    | undefined;
  if (quoteSignerPublic && /^0x[0-9a-fA-F]{40}$/.test(quoteSignerPublic)) {
    console.log("\n> Deploying BetQuoteVerifier...");
    const quoteArgs = encodeAbiParameters(
      [{ type: "address" }],
      [quoteSignerPublic],
    );
    quoteVerifierHash = await walletClient.deployContract({
      abi: betQuoteVerifier.abi,
      bytecode: (`0x${betQuoteVerifier.evm.bytecode.object}` + quoteArgs.slice(2)) as Hex,
    });
    console.log(`  tx: ${quoteVerifierHash}`);
    const r = await publicClient.waitForTransactionReceipt({ hash: quoteVerifierHash });
    if (r.status !== "success") {
      throw new Error(`BetQuoteVerifier reverted: ${quoteVerifierHash}`);
    }
    quoteVerifierAddress = r.contractAddress!;
    console.log(`  ok BetQuoteVerifier: ${quoteVerifierAddress}`);
  } else {
    console.log("\nskip Skipping BetQuoteVerifier (QUOTE_SIGNER_PUBLIC_ADDRESS not set)");
  }

  // 5. Persist deployment record
  const deploymentsDir = join(root, "deployments");
  mkdirSync(deploymentsDir, { recursive: true });
  const record = {
    chainId: chain.id,
    chainName: chain.name,
    stakeToken: usdcAddress,
    stakeTokenTx: usdcHash,
    marketFactory: factoryAddress,
    marketFactoryTx: factoryHash,
    reputationOracle: repAddress,
    reputationOracleTx: repHash,
    aiJudgeVerifier: judgeAddress || null,
    aiJudgeVerifierTx: judgeHash || null,
    priceOracle: priceAddress,
    priceOracleTx: priceHash,
    tokenizedStockAdapter: stockAddress,
    tokenizedStockAdapterTx: stockHash,
    proofAnchor: anchorAddress,
    proofAnchorTx: anchorHash,
    betQuoteVerifier: quoteVerifierAddress || null,
    betQuoteVerifierTx: quoteVerifierHash || null,
    deployedAt: new Date().toISOString(),
    deployer: account.address,
  };
  writeFileSync(
    join(deploymentsDir, `${chain.id}.json`),
    JSON.stringify(record, null, 2),
  );

  // 6. Patch .env.local
  const patches: Record<string, string> = {
    STAKE_TOKEN_ADDRESS: usdcAddress,
    NEXT_PUBLIC_STAKE_TOKEN_ADDRESS: usdcAddress,
    MARKET_FACTORY_ADDRESS: factoryAddress,
    NEXT_PUBLIC_MARKET_FACTORY_ADDRESS: factoryAddress,
    REPUTATION_ORACLE_ADDRESS: repAddress,
    NEXT_PUBLIC_REPUTATION_ORACLE_ADDRESS: repAddress,
  };
  if (judgeAddress) {
    patches.AI_JUDGE_VERIFIER_ADDRESS = judgeAddress;
    patches.NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS = judgeAddress;
  }
  patches.PRICE_ORACLE_ADDRESS = priceAddress;
  patches.NEXT_PUBLIC_PRICE_ORACLE_ADDRESS = priceAddress;
  patches.TOKENIZED_STOCK_ADAPTER_ADDRESS = stockAddress;
  patches.NEXT_PUBLIC_TOKENIZED_STOCK_ADAPTER_ADDRESS = stockAddress;
  patches.PROOF_ANCHOR_ADDRESS = anchorAddress;
  patches.NEXT_PUBLIC_PROOF_ANCHOR_ADDRESS = anchorAddress;
  if (quoteVerifierAddress) {
    patches.BET_QUOTE_VERIFIER_ADDRESS = quoteVerifierAddress;
    patches.NEXT_PUBLIC_BET_QUOTE_VERIFIER_ADDRESS = quoteVerifierAddress;
  }
  patchEnvLocal(root, patches);

  console.log("\nok Deployment complete");
  console.log(`  TestUSDC:         ${usdcAddress}`);
  console.log(`  MarketFactory:    ${factoryAddress}`);
  console.log(`  ReputationOracle: ${repAddress}`);
  console.log(`  deployments/${chain.id}.json written`);
  console.log(`  .env.local patched`);
  console.log(`\nView on explorer:`);
  console.log(`  https://sepolia.arbiscan.io/address/${usdcAddress}`);
  console.log(`  https://sepolia.arbiscan.io/address/${factoryAddress}`);
  console.log(`  https://sepolia.arbiscan.io/address/${repAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

