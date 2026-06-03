import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import solc from "solc";

const root = process.cwd();

function findImports(importPath: string) {
  if (importPath.startsWith("@fhenixprotocol/") || importPath.startsWith("@openzeppelin/")) {
    return { contents: readFileSync(join(root, "node_modules", importPath), "utf8") };
  }
  if (importPath.startsWith("./")) {
    return {
      contents: readFileSync(join(root, "node_modules", "@fhenixprotocol", "cofhe-contracts", importPath), "utf8"),
    };
  }
  return { error: `Unsupported import: ${importPath}` };
}

const sourceName = "FhenixSealedMarketPrototype.sol";
const input = {
  language: "Solidity",
  sources: {
    [sourceName]: {
      content: readFileSync(join(root, "contracts", "prototypes", sourceName), "utf8"),
    },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports })) as {
  errors?: Array<{ severity: string; formattedMessage: string }>;
  contracts: Record<string, Record<string, { abi: unknown; evm: { bytecode: { object: string } } }>>;
};

const errors = output.errors?.filter((error) => error.severity === "error") ?? [];
if (errors.length > 0) {
  console.error(errors.map((error) => error.formattedMessage).join("\n"));
  process.exit(1);
}

const compiled = output.contracts[sourceName].FhenixSealedMarketPrototype;
if (!compiled.evm.bytecode.object) {
  throw new Error("FhenixSealedMarketPrototype bytecode is empty.");
}

const abiDir = join(root, "src", "lib", "abi");
mkdirSync(abiDir, { recursive: true });
writeFileSync(join(abiDir, "FhenixSealedMarketPrototype.json"), JSON.stringify(compiled.abi, null, 2));
console.log("wrote src/lib/abi/FhenixSealedMarketPrototype.json");
