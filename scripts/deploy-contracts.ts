import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Chain,
  type Hex,
  encodeAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const TESTNET_OPT_IN = "ADJUDEX_TESTNET_ONLY";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

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
        `Set ${TESTNET_OPT_IN}=1 only for supported testnet deployments.`,
    );
  }
}

function alchemyRpcUrl(network: "arb-sepolia" | "robinhood-testnet", apiKey?: string) {
  const key = apiKey?.trim();
  if (!key) return undefined;
  return `https://${network}.g.alchemy.com/v2/${key}`;
}

function targetDeploymentChain(): { chain: Chain; rpcUrl?: string; env: "arb" | "rhc"; explorerBase: string } {
  const target = (process.env.DEPLOY_CHAIN ?? process.env.CONTRACT_DEPLOY_CHAIN ?? "arbitrum-sepolia").toLowerCase();
  if (target === "rhc" || target === "robinhood" || target === "robinhood-chain") {
    const chainId = Number(process.env.RHC_CHAIN_ID ?? "46630");
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Error(`Invalid RHC_CHAIN_ID: ${process.env.RHC_CHAIN_ID}`);
    }
    const rpcUrl =
      process.env.RHC_RPC_URL?.trim() ||
      alchemyRpcUrl("robinhood-testnet", process.env.ALCHEMY_RHC_API_KEY);
    const explorerBase = process.env.RHC_EXPLORER_URL ?? process.env.NEXT_PUBLIC_RHC_EXPLORER_URL ?? "";
    return {
      env: "rhc",
      rpcUrl,
      explorerBase,
      chain: {
        id: chainId,
        name: "Robinhood Chain Testnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [] } },
        blockExplorers: explorerBase ? { default: { name: "RHC Explorer", url: explorerBase } } : undefined,
        testnet: true,
      },
    };
  }

  const rpcUrl =
    process.env.ARBITRUM_SEPOLIA_RPC_URL?.trim() ||
    alchemyRpcUrl("arb-sepolia", process.env.ALCHEMY_ARBITRUM_SEPOLIA_API_KEY);
  return {
    env: "arb",
    chain: arbitrumSepolia,
    rpcUrl,
    explorerBase: "https://sepolia.arbiscan.io",
  };
}

function compile(root: string): SolcOutput {
  const src = join(root, "contracts", "src");
  const findImports = (importPath: string) => {
    if (importPath.startsWith("@openzeppelin/")) {
      return { contents: readFileSync(join(root, "node_modules", importPath), "utf8") };
    }
    return { error: `Unsupported import: ${importPath}` };
  };
  const input = {
    language: "Solidity",
    sources: {
      "ParimutuelPool.sol": { content: readFileSync(join(src, "ParimutuelPool.sol"), "utf8") },
      "MarketFactory.sol": { content: readFileSync(join(src, "MarketFactory.sol"), "utf8") },
      "OutcomeSharePool.sol": { content: readFileSync(join(src, "OutcomeSharePool.sol"), "utf8") },
      "LiquidityVault.sol": { content: readFileSync(join(src, "LiquidityVault.sol"), "utf8") },
      "AdjudexOrderMatcher.sol": { content: readFileSync(join(src, "AdjudexOrderMatcher.sol"), "utf8") },
      "ExclusiveOutcomeRegistry.sol": { content: readFileSync(join(src, "ExclusiveOutcomeRegistry.sol"), "utf8") },
      "ParlayPoolPrototype.sol": { content: readFileSync(join(src, "ParlayPoolPrototype.sol"), "utf8") },
      "ReputationOracle.sol": { content: readFileSync(join(src, "ReputationOracle.sol"), "utf8") },
      "TestUSDC.sol": { content: readFileSync(join(src, "TestUSDC.sol"), "utf8") },
      "AIJudgeVerifier.sol": { content: readFileSync(join(src, "AIJudgeVerifier.sol"), "utf8") },
      "PriceOracle.sol": { content: readFileSync(join(src, "PriceOracle.sol"), "utf8") },
      "OptimisticOracleResolver.sol": { content: readFileSync(join(src, "OptimisticOracleResolver.sol"), "utf8") },
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
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports })) as SolcOutput;
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

// DRY_RUN=1: compile + print the deploy plan without touching the chain.
// Needs no funds and no live RPC, so the deploy path (especially DEPLOY_CHAIN=
// rhc) can be verified before spending gas.
function printDeployPlan(
  root: string,
  chain: Chain,
  env: "arb" | "rhc",
  rpcUrl: string | undefined,
  privateKey: Hex | undefined,
): void {
  const compiled = compile(root);
  const account = privateKey ? privateKeyToAccount(privateKey) : null;
  const order: Array<[string, string]> = [
    ["TestUSDC.sol", "TestUSDC"],
    ["AIJudgeVerifier.sol", "AIJudgeVerifier"],
    ["BetQuoteVerifier.sol", "BetQuoteVerifier"],
    ["LiquidityVault.sol", "LiquidityVault"],
    ["AdjudexOrderMatcher.sol", "AdjudexOrderMatcher"],
    ["ExclusiveOutcomeRegistry.sol", "ExclusiveOutcomeRegistry"],
    ...(process.env.PARLAY_PROTOTYPE_ENABLED === "1"
      ? ([["ParlayPoolPrototype.sol", "ParlayPoolPrototype"]] as Array<[string, string]>)
      : []),
    ["MarketFactory.sol", "MarketFactory"],
    ["ReputationOracle.sol", "ReputationOracle"],
    ["PriceOracle.sol", "PriceOracle"],
    ["TokenizedStockAdapter.sol", "TokenizedStockAdapter"],
    ["ProofAnchor.sol", "ProofAnchor"],
  ];
  console.log("DRY RUN - no transactions will be sent.\n");
  console.log(`Target chain:  ${chain.name} (${chain.id}) [${env}]`);
  console.log(`RPC:           ${rpcUrl ? "configured" : "MISSING"}`);
  console.log(`Deployer:      ${account ? account.address : "DEPLOYER_PRIVATE_KEY not set"}`);
  console.log(`Writes:        deployments/${chain.id}.json + .env.local patches`);
  console.log("\nContracts compiled OK. Deploy order (bytecode size):");
  for (const [file, name] of order) {
    const compiledContract = compiled.contracts[file]?.[name];
    const bytes = compiledContract ? compiledContract.evm.bytecode.object.length / 2 : 0;
    console.log(`  - ${name}: ${bytes.toLocaleString("en-US")} bytes`);
  }
  console.log(
    "\nTo deploy for real: set ADJUDEX_TESTNET_ONLY=1, a funded DEPLOYER_PRIVATE_KEY, " +
      (env === "rhc" ? "RHC_RPC_URL or ALCHEMY_RHC_API_KEY, " : "ARBITRUM_SEPOLIA_RPC_URL, ") +
      "and re-run without DRY_RUN=1.",
  );
}

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  if (!dryRun) assertTestnetOptIn();

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  const target = targetDeploymentChain();
  const rpcUrl = target.rpcUrl;
  const root = process.cwd();
  const chain = target.chain;

  if (dryRun) {
    printDeployPlan(root, chain, target.env, rpcUrl, privateKey);
    return;
  }

  if (!privateKey || !rpcUrl) {
    throw new Error(
      target.env === "rhc"
        ? "Set DEPLOYER_PRIVATE_KEY plus RHC_RPC_URL or ALCHEMY_RHC_API_KEY before running DEPLOY_CHAIN=rhc contracts:deploy."
        : "Set DEPLOYER_PRIVATE_KEY plus ARBITRUM_SEPOLIA_RPC_URL or ALCHEMY_ARBITRUM_SEPOLIA_API_KEY before running contracts:deploy.",
    );
  }

  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const walletClient = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });
  const chainId = await publicClient.getChainId();
  if (chainId !== chain.id) {
    throw new Error(
      `Refusing deployment on chain ${chainId}; expected ${chain.name} (${chain.id}).`,
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
  const outcomeSharePool = compiled.contracts["OutcomeSharePool.sol"].OutcomeSharePool;
  const liquidityVault = compiled.contracts["LiquidityVault.sol"].LiquidityVault;
  const orderMatcher = compiled.contracts["AdjudexOrderMatcher.sol"].AdjudexOrderMatcher;
  const exclusiveOutcomeRegistry = compiled.contracts["ExclusiveOutcomeRegistry.sol"].ExclusiveOutcomeRegistry;
  const parlayPrototype = compiled.contracts["ParlayPoolPrototype.sol"].ParlayPoolPrototype;
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
  writeAbi(root, "OutcomeSharePool", outcomeSharePool.abi);
  writeAbi(root, "LiquidityVault", liquidityVault.abi);
  writeAbi(root, "AdjudexOrderMatcher", orderMatcher.abi);
  writeAbi(root, "ExclusiveOutcomeRegistry", exclusiveOutcomeRegistry.abi);
  writeAbi(root, "ParlayPoolPrototype", parlayPrototype.abi);
  writeAbi(root, "ReputationOracle", reputation.abi);
  writeAbi(root, "ParimutuelPool", pool.abi);
  writeAbi(root, "TestUSDC", usdc.abi);
  writeAbi(root, "AIJudgeVerifier", judge.abi);
  writeAbi(root, "PriceOracle", priceOracle.abi);
  writeAbi(root, "TokenizedStockAdapter", stockAdapter.abi);
  writeAbi(root, "TestAggregatorV3", testAggregator.abi);
  writeAbi(root, "ProofAnchor", proofAnchor.abi);
  writeAbi(root, "BetQuoteVerifier", betQuoteVerifier.abi);

  // 1. TestUSDC
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

  // 2. AIJudgeVerifier (optional, moved BEFORE MarketFactory so its
  //    address is available for ReputationOracle constructor).
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

  // 3. BetQuoteVerifier (optional, moved BEFORE MarketFactory so its
  //    address can be baked into the factory immutable).
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

  // 4. LiquidityVault(stakeToken) - optional seed-liquidity primitive for
  // AMM markets. The factory is set after MarketFactory is deployed.
  console.log("\n> Deploying LiquidityVault...");
  const vaultArgs = encodeAbiParameters([{ type: "address" }], [usdcAddress]);
  const vaultHash = await walletClient.deployContract({
    abi: liquidityVault.abi,
    bytecode: (`0x${liquidityVault.evm.bytecode.object}` + vaultArgs.slice(2)) as Hex,
  });
  console.log(`  tx: ${vaultHash}`);
  const vaultReceipt = await publicClient.waitForTransactionReceipt({ hash: vaultHash });
  if (vaultReceipt.status !== "success") throw new Error(`LiquidityVault reverted: ${vaultHash}`);
  const vaultAddress = vaultReceipt.contractAddress!;
  console.log(`  ok LiquidityVault: ${vaultAddress}`);

  // 5. MarketFactory(stakeToken, feeBps, feeRecipient, quoteVerifier, liquidityVault)
  console.log("\n> Deploying MarketFactory...");
  // Fee config: 150 bps (1.5%) by default. Recipient defaults to the
  // deployer EOA — transfer to the governance Safe after deploy via
  // scripts/transfer-ownership.ts (or manually if not yet ownable).
  const feeBps = BigInt(process.env.MARKET_FACTORY_FEE_BPS ?? "150");
  const feeRecipient = (process.env.MARKET_FACTORY_FEE_RECIPIENT ??
    account.address) as `0x${string}`;
  if (feeBps > 500n) throw new Error(`feeBps too high: ${feeBps} > 500`);
  console.log(`  fee: ${feeBps} bps to ${feeRecipient}`);
  console.log(
    `  quoteVerifier: ${quoteVerifierAddress || `${ZERO_ADDRESS} (disabled)`}`,
  );
  const factoryArgs = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
    ],
    [usdcAddress, feeBps, feeRecipient, (quoteVerifierAddress || ZERO_ADDRESS) as `0x${string}`, vaultAddress],
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

  const setVaultFactoryHash = await walletClient.writeContract({
    address: vaultAddress,
    abi: liquidityVault.abi,
    functionName: "setFactory",
    args: [factoryAddress],
  });
  await publicClient.waitForTransactionReceipt({ hash: setVaultFactoryHash });
  console.log(`  ok LiquidityVault factory set: ${setVaultFactoryHash}`);

  // 6. OrderMatcher
  console.log("\n> Deploying AdjudexOrderMatcher...");
  const matcherHash = await walletClient.deployContract({
    abi: orderMatcher.abi,
    bytecode: `0x${orderMatcher.evm.bytecode.object}` as Hex,
  });
  console.log(`  tx: ${matcherHash}`);
  const matcherReceipt = await publicClient.waitForTransactionReceipt({ hash: matcherHash });
  if (matcherReceipt.status !== "success") throw new Error(`AdjudexOrderMatcher reverted: ${matcherHash}`);
  const matcherAddress = matcherReceipt.contractAddress!;
  console.log(`  ok AdjudexOrderMatcher: ${matcherAddress}`);

  // 7. ExclusiveOutcomeRegistry
  console.log("\n> Deploying ExclusiveOutcomeRegistry...");
  const registryHash = await walletClient.deployContract({
    abi: exclusiveOutcomeRegistry.abi,
    bytecode: `0x${exclusiveOutcomeRegistry.evm.bytecode.object}` as Hex,
  });
  console.log(`  tx: ${registryHash}`);
  const registryReceipt = await publicClient.waitForTransactionReceipt({ hash: registryHash });
  if (registryReceipt.status !== "success") throw new Error(`ExclusiveOutcomeRegistry reverted: ${registryHash}`);
  const registryAddress = registryReceipt.contractAddress!;
  console.log(`  ok ExclusiveOutcomeRegistry: ${registryAddress}`);

  let parlayPrototypeAddress: `0x${string}` | "" = "";
  let parlayPrototypeHash: `0x${string}` | "" = "";
  if (process.env.PARLAY_PROTOTYPE_ENABLED === "1") {
    if (chain.id === 1) {
      throw new Error("ParlayPoolPrototype is testnet-only and cannot be deployed on mainnet.");
    }
    console.log("\n> Deploying ParlayPoolPrototype...");
    const parlayArgs = encodeAbiParameters([{ type: "address" }], [usdcAddress]);
    parlayPrototypeHash = await walletClient.deployContract({
      abi: parlayPrototype.abi,
      bytecode: (`0x${parlayPrototype.evm.bytecode.object}` + parlayArgs.slice(2)) as Hex,
    });
    console.log(`  tx: ${parlayPrototypeHash}`);
    const parlayReceipt = await publicClient.waitForTransactionReceipt({ hash: parlayPrototypeHash });
    if (parlayReceipt.status !== "success") throw new Error(`ParlayPoolPrototype reverted: ${parlayPrototypeHash}`);
    parlayPrototypeAddress = parlayReceipt.contractAddress!;
    console.log(`  ok ParlayPoolPrototype: ${parlayPrototypeAddress}`);
  } else {
    console.log("\nskip Skipping ParlayPoolPrototype (PARLAY_PROTOTYPE_ENABLED != 1)");
  }

  // 8. ReputationOracle(judge)
  console.log("\n> Deploying ReputationOracle...");
  console.log(
    `  judge: ${judgeAddress || `${ZERO_ADDRESS} (use rotateJudge later)`}`,
  );
  const repArgs = encodeAbiParameters(
    [{ type: "address" }],
    [(judgeAddress || ZERO_ADDRESS) as `0x${string}`],
  );
  const repHash = await walletClient.deployContract({
    abi: reputation.abi,
    bytecode: (`0x${reputation.evm.bytecode.object}` + repArgs.slice(2)) as Hex,
  });
  console.log(`  tx: ${repHash}`);
  const repReceipt = await publicClient.waitForTransactionReceipt({ hash: repHash });
  if (repReceipt.status !== "success") {
    throw new Error(`ReputationOracle deploy reverted: ${repHash}`);
  }
  const repAddress = repReceipt.contractAddress!;
  console.log(`  ok ReputationOracle: ${repAddress}`);

  // 6. PriceOracle
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

  // 7. TokenizedStockAdapter
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

  // 8. ProofAnchor (Reclaim proof CID anchor + ProofAnchored event)
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
    liquidityVault: vaultAddress,
    liquidityVaultTx: vaultHash,
    orderMatcher: matcherAddress,
    orderMatcherTx: matcherHash,
    exclusiveOutcomeRegistry: registryAddress,
    exclusiveOutcomeRegistryTx: registryHash,
    parlayPoolPrototype: parlayPrototypeAddress || null,
    parlayPoolPrototypeTx: parlayPrototypeHash || null,
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
  const patches: Record<string, string> =
    target.env === "rhc"
      ? {
          RHC_STAKE_TOKEN_ADDRESS: usdcAddress,
          NEXT_PUBLIC_RHC_STAKE_TOKEN_ADDRESS: usdcAddress,
          RHC_MARKET_FACTORY_ADDRESS: factoryAddress,
          NEXT_PUBLIC_RHC_MARKET_FACTORY_ADDRESS: factoryAddress,
          RHC_REPUTATION_ORACLE_ADDRESS: repAddress,
          NEXT_PUBLIC_RHC_REPUTATION_ORACLE_ADDRESS: repAddress,
          RHC_CHAIN_ID: String(chain.id),
          NEXT_PUBLIC_RHC_CHAIN_ID: String(chain.id),
        }
      : {
          STAKE_TOKEN_ADDRESS: usdcAddress,
          NEXT_PUBLIC_STAKE_TOKEN_ADDRESS: usdcAddress,
          MARKET_FACTORY_ADDRESS: factoryAddress,
          NEXT_PUBLIC_MARKET_FACTORY_ADDRESS: factoryAddress,
          REPUTATION_ORACLE_ADDRESS: repAddress,
          NEXT_PUBLIC_REPUTATION_ORACLE_ADDRESS: repAddress,
        };
  if (judgeAddress) {
    if (target.env === "rhc") {
      patches.RHC_AI_JUDGE_VERIFIER_ADDRESS = judgeAddress;
      patches.NEXT_PUBLIC_RHC_AI_JUDGE_VERIFIER_ADDRESS = judgeAddress;
    } else {
      patches.AI_JUDGE_VERIFIER_ADDRESS = judgeAddress;
      patches.NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS = judgeAddress;
    }
  }
  const prefix = target.env === "rhc" ? "RHC_" : "";
  const publicPrefix = target.env === "rhc" ? "NEXT_PUBLIC_RHC_" : "NEXT_PUBLIC_";
  patches[`${prefix}PRICE_ORACLE_ADDRESS`] = priceAddress;
  patches[`${publicPrefix}PRICE_ORACLE_ADDRESS`] = priceAddress;
  patches[`${prefix}TOKENIZED_STOCK_ADAPTER_ADDRESS`] = stockAddress;
  patches[`${publicPrefix}TOKENIZED_STOCK_ADAPTER_ADDRESS`] = stockAddress;
  patches[`${prefix}PROOF_ANCHOR_ADDRESS`] = anchorAddress;
  patches[`${publicPrefix}PROOF_ANCHOR_ADDRESS`] = anchorAddress;
  patches[`${prefix}LIQUIDITY_VAULT_ADDRESS`] = vaultAddress;
  patches[`${publicPrefix}LIQUIDITY_VAULT_ADDRESS`] = vaultAddress;
  patches[`${prefix}ORDER_MATCHER_ADDRESS`] = matcherAddress;
  patches[`${publicPrefix}ORDER_MATCHER_ADDRESS`] = matcherAddress;
  patches[`${prefix}EXCLUSIVE_OUTCOME_REGISTRY_ADDRESS`] = registryAddress;
  patches[`${publicPrefix}EXCLUSIVE_OUTCOME_REGISTRY_ADDRESS`] = registryAddress;
  if (quoteVerifierAddress) {
    patches[`${prefix}BET_QUOTE_VERIFIER_ADDRESS`] = quoteVerifierAddress;
    patches[`${publicPrefix}BET_QUOTE_VERIFIER_ADDRESS`] = quoteVerifierAddress;
  }
  if (parlayPrototypeAddress) {
    patches[`${prefix}PARLAY_POOL_PROTOTYPE_ADDRESS`] = parlayPrototypeAddress;
    patches[`${publicPrefix}PARLAY_POOL_PROTOTYPE_ADDRESS`] = parlayPrototypeAddress;
  }
  patchEnvLocal(root, patches);

  console.log("\nok Deployment complete");
  console.log(`  TestUSDC:         ${usdcAddress}`);
  console.log(`  MarketFactory:    ${factoryAddress}`);
  console.log(`  LiquidityVault:   ${vaultAddress}`);
  console.log(`  OrderMatcher:     ${matcherAddress}`);
  console.log(`  ReputationOracle: ${repAddress}`);
  console.log(`  deployments/${chain.id}.json written`);
  console.log(`  .env.local patched`);
  console.log(`\nView on explorer:`);
  if (target.explorerBase) {
    console.log(`  ${target.explorerBase.replace(/\/$/, "")}/address/${usdcAddress}`);
    console.log(`  ${target.explorerBase.replace(/\/$/, "")}/address/${factoryAddress}`);
    console.log(`  ${target.explorerBase.replace(/\/$/, "")}/address/${repAddress}`);
  } else {
    console.log("  Set RHC_EXPLORER_URL or NEXT_PUBLIC_RHC_EXPLORER_URL to print explorer links.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
