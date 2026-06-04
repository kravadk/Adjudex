// Compile all contracts and write ABI JSONs to src/lib/abi/.
// Useful when you want ABIs without re-deploying (e.g. CI typecheck).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import solc from "solc";

const root = process.cwd();
const src = join(root, "contracts", "src");

function findImports(importPath: string) {
  if (importPath.startsWith("@openzeppelin/")) {
    return { contents: readFileSync(join(root, "node_modules", importPath), "utf8") };
  }
  return { error: `Unsupported import: ${importPath}` };
}

const sources = {
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
};

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports })) as {
  errors?: Array<{ severity: string; formattedMessage: string }>;
  contracts: Record<string, Record<string, { abi: unknown }>>;
};

const errors = output.errors?.filter((e) => e.severity === "error") ?? [];
if (errors.length > 0) {
  console.error(errors.map((e) => e.formattedMessage).join("\n"));
  process.exit(1);
}

const abiDir = join(root, "src", "lib", "abi");
mkdirSync(abiDir, { recursive: true });

const writes: Array<[string, string]> = [
  ["ParimutuelPool.sol", "ParimutuelPool"],
  ["MarketFactory.sol", "MarketFactory"],
  ["OutcomeSharePool.sol", "OutcomeSharePool"],
  ["LiquidityVault.sol", "LiquidityVault"],
  ["AdjudexOrderMatcher.sol", "AdjudexOrderMatcher"],
  ["ExclusiveOutcomeRegistry.sol", "ExclusiveOutcomeRegistry"],
  ["ParlayPoolPrototype.sol", "ParlayPoolPrototype"],
  ["ReputationOracle.sol", "ReputationOracle"],
  ["TestUSDC.sol", "TestUSDC"],
  ["AIJudgeVerifier.sol", "AIJudgeVerifier"],
  ["PriceOracle.sol", "PriceOracle"],
  ["OptimisticOracleResolver.sol", "OptimisticOracleResolver"],
  ["TokenizedStockAdapter.sol", "TokenizedStockAdapter"],
  ["TestAggregatorV3.sol", "TestAggregatorV3"],
  ["ProofAnchor.sol", "ProofAnchor"],
  ["BetQuoteVerifier.sol", "BetQuoteVerifier"],
];
for (const [sol, name] of writes) {
  const abi = output.contracts[sol][name].abi;
  writeFileSync(join(abiDir, `${name}.json`), JSON.stringify(abi, null, 2));
  console.log(`wrote src/lib/abi/${name}.json`);
}
