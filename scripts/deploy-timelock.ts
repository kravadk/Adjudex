// Deploy AdjudexTimelock (OpenZeppelin TimelockController) — the governance
// timelock that should own AIJudgeVerifier / MarketFactory / ProofAnchor etc.
// so privileged owner calls (overrideAndFinalize, pause) run through a
// mandatory minDelay + multisig proposer/executor flow instead of a hot key.
//
//   ADJUDEX_TESTNET_ONLY=1 \
//   DEPLOYER_PRIVATE_KEY=0x.. ARBITRUM_SEPOLIA_RPC_URL=https://... \
//   TIMELOCK_MIN_DELAY=172800 \
//   TIMELOCK_PROPOSERS=0xSafe TIMELOCK_EXECUTORS=0xSafe \
//   pnpm tsx scripts/deploy-timelock.ts
//
// Then hand ownership over with:
//   SAFE_ADDRESS=<timelock> pnpm tsx scripts/transfer-ownership.ts
//
// Defaults (testnet convenience): 48h delay, deployer as sole proposer +
// executor + admin. In production use a real multisig for proposers/executors
// and renounce the deployer's TIMELOCK_ADMIN_ROLE after wiring.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import solc from "solc";
import { createPublicClient, createWalletClient, http, encodeAbiParameters, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

function assertTestnet() {
  if (process.env.ADJUDEX_TESTNET_ONLY !== "1") {
    throw new Error("Set ADJUDEX_TESTNET_ONLY=1 to deploy the timelock on a supported testnet.");
  }
}

function findImports(p: string) {
  if (p.startsWith("@openzeppelin/")) {
    return { contents: readFileSync(join(process.cwd(), "node_modules", p), "utf8") };
  }
  return { error: `Unsupported import: ${p}` };
}

function compileTimelock() {
  const root = join(process.cwd(), "contracts", "src");
  const input = {
    language: "Solidity",
    sources: { "AdjudexTimelock.sol": { content: readFileSync(join(root, "AdjudexTimelock.sol"), "utf8") } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errs = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errs.length) throw new Error(errs.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));
  return out.contracts["AdjudexTimelock.sol"].AdjudexTimelock as {
    abi: unknown[];
    evm: { bytecode: { object: string } };
  };
}

function csvAddrs(raw: string | undefined, fallback: `0x${string}`): `0x${string}`[] {
  const list = (raw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^0x[0-9a-fA-F]{40}$/.test(s))
    .map((s) => getAddress(s));
  return list.length ? list : [fallback];
}

async function main() {
  assertTestnet();
  const pk = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  const rpcUrl =
    process.env.ARBITRUM_SEPOLIA_RPC_URL ||
    (process.env.ALCHEMY_ARBITRUM_SEPOLIA_API_KEY
      ? `https://arb-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_ARBITRUM_SEPOLIA_API_KEY}`
      : undefined);
  if (!pk || !rpcUrl) {
    throw new Error("Set DEPLOYER_PRIVATE_KEY and ARBITRUM_SEPOLIA_RPC_URL.");
  }
  const account = privateKeyToAccount(pk);
  const minDelay = BigInt(process.env.TIMELOCK_MIN_DELAY ?? "172800"); // 48h
  const proposers = csvAddrs(process.env.TIMELOCK_PROPOSERS, account.address);
  const executors = csvAddrs(process.env.TIMELOCK_EXECUTORS, account.address);
  const admin = (process.env.TIMELOCK_ADMIN as `0x${string}`) || account.address;

  const timelock = compileTimelock();
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpcUrl) });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Deployer: ${account.address}  balance: ${Number(balance) / 1e18} ETH`);
  console.log(`minDelay: ${minDelay}s  proposers: ${proposers.join(",")}  executors: ${executors.join(",")}`);
  if (balance < 1_000_000_000_000_000n) throw new Error("Balance < 0.001 ETH — fund the deployer.");

  const args = encodeAbiParameters(
    [{ type: "uint256" }, { type: "address[]" }, { type: "address[]" }, { type: "address" }],
    [minDelay, proposers, executors, admin],
  );
  console.log("\n> Deploying AdjudexTimelock...");
  const hash = await walletClient.deployContract({
    abi: timelock.abi,
    bytecode: (`0x${timelock.evm.bytecode.object}` + args.slice(2)) as Hex,
  });
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`AdjudexTimelock deploy reverted: ${hash}`);
  console.log(`  ok AdjudexTimelock: ${receipt.contractAddress}`);
  console.log("\nNext: hand each Ownable2Step contract to the timelock, e.g.");
  console.log(`  SAFE_ADDRESS=${receipt.contractAddress} pnpm tsx scripts/transfer-ownership.ts`);
  console.log("Each contract then calls acceptOwnership via a timelock-scheduled op.");
  if (admin === account.address && executors[0] !== ZERO) {
    console.log("\nReminder: renounce the deployer's TIMELOCK_ADMIN_ROLE once a multisig holds proposer/executor roles.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
