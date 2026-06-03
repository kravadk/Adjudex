// Transfer contract ownership from the deployer EOA to a Gnosis Safe.
// Used during S1.C of the maturity roadmap (multisig governance).
//
// Usage:
//   SAFE_ADDRESS=0x...                            \
//   DEPLOYER_PRIVATE_KEY=0x...                    \
//   ARBITRUM_SEPOLIA_RPC_URL=https://...          \
//   CHAIN_ID=421614                               \
//   DRY_RUN=1                                      \
//   pnpm tsx scripts/transfer-ownership.ts
//
// Without DRY_RUN it sends real transactions.
//
// Coverage:
//   AIJudgeVerifier  — has transferOwnership(address) ✅
//   MarketFactory    — no owner pattern (permissionless) — SKIP, document gap
//   ProofAnchor      — OpenZeppelin Ownable + transferOwnership(address) ✅
//   BetQuoteVerifier — immutable _quoteSigner        — SKIP, document gap
//   ReputationOracle — no owner pattern              — SKIP, document gap
//   PriceOracle      — owner without transferOwnership — SKIP (contract change needed)
//   TokenizedStockAdapter — OpenZeppelin Ownable + transferOwnership(address) ✅
//
// See docs/GOVERNANCE.md for the contract-change list required to make
// all contracts multisig-owned before mainnet.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

type Deployments = Record<string, string | number | undefined> & {
  chainId: number;
  aiJudgeVerifier?: string;
  marketFactory?: string;
  proofAnchor?: string;
  betQuoteVerifier?: string;
  reputationOracle?: string;
  tokenizedStockAdapter?: string;
};

const TRANSFER_OWNERSHIP_ABI = [
  {
    type: "function",
    name: "transferOwnership",
    stateMutability: "nonpayable",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

type Target = {
  name: string;
  key: keyof Deployments;
  supportsTransfer: boolean;
  note?: string;
};

const TARGETS: Target[] = [
  {
    name: "AIJudgeVerifier",
    key: "aiJudgeVerifier",
    supportsTransfer: true,
  },
  {
    name: "MarketFactory",
    key: "marketFactory",
    supportsTransfer: false,
    note: "Contract has no owner; treat as permissionless. No transfer needed.",
  },
  {
    name: "ProofAnchor",
    key: "proofAnchor",
    supportsTransfer: true,
  },
  {
    name: "BetQuoteVerifier",
    key: "betQuoteVerifier",
    supportsTransfer: false,
    note: "Quote signer is immutable. Adding `rotateSigner(address)` is a pre-mainnet contract change.",
  },
  {
    name: "ReputationOracle",
    key: "reputationOracle",
    supportsTransfer: false,
    note: "Permissionless self-attest. No owner.",
  },
  {
    name: "TokenizedStockAdapter",
    key: "tokenizedStockAdapter",
    supportsTransfer: true,
  },
];

function requireEnv(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function loadDeployments(chainId: number): Deployments {
  const path = join(process.cwd(), "deployments", `${chainId}.json`);
  if (!existsSync(path)) {
    throw new Error(`deployments/${chainId}.json not found — run contracts:deploy first.`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as Deployments;
}

async function main() {
  const safeAddress = requireEnv("SAFE_ADDRESS");
  if (!isAddress(safeAddress)) {
    throw new Error(`SAFE_ADDRESS invalid: ${safeAddress}`);
  }
  const chainId = Number(process.env.CHAIN_ID ?? 421614);
  const dryRun = process.env.DRY_RUN === "1";
  const deployments = loadDeployments(chainId);

  const rpc = requireEnv("ARBITRUM_SEPOLIA_RPC_URL");
  const privateKey = requireEnv("DEPLOYER_PRIVATE_KEY") as Hex;
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpc),
  });
  const walletClient = createWalletClient({
    chain: arbitrumSepolia,
    transport: http(rpc),
    account,
  });

  console.log(`Chain:        ${chainId}`);
  console.log(`Safe target:  ${safeAddress}`);
  console.log(`Deployer EOA: ${account.address}`);
  console.log(`Dry run:      ${dryRun}`);
  console.log("");

  const skipped: string[] = [];
  const transferred: string[] = [];
  const failed: Array<{ name: string; reason: string }> = [];

  for (const target of TARGETS) {
    const addr = deployments[target.key] as string | undefined;
    if (!addr) {
      console.log(`[SKIP] ${target.name}: not deployed on chain ${chainId}`);
      continue;
    }
    if (!target.supportsTransfer) {
      console.log(`[SKIP] ${target.name} (${addr}) — ${target.note}`);
      skipped.push(target.name);
      continue;
    }
    try {
      const currentOwner = (await publicClient.readContract({
        address: addr as Address,
        abi: TRANSFER_OWNERSHIP_ABI,
        functionName: "owner",
      })) as Address;
      console.log(`[CHECK] ${target.name} owner = ${currentOwner}`);
      if (currentOwner.toLowerCase() === safeAddress.toLowerCase()) {
        console.log(`[OK] ${target.name} already owned by Safe`);
        continue;
      }
      if (currentOwner.toLowerCase() !== account.address.toLowerCase()) {
        failed.push({
          name: target.name,
          reason: `current owner is ${currentOwner}, not the configured deployer ${account.address}`,
        });
        continue;
      }
      if (dryRun) {
        console.log(`[DRY] would call ${target.name}.transferOwnership(${safeAddress})`);
        transferred.push(target.name);
        continue;
      }
      const hash = await walletClient.writeContract({
        address: addr as Address,
        abi: TRANSFER_OWNERSHIP_ABI,
        functionName: "transferOwnership",
        args: [safeAddress as Address],
      });
      console.log(`[TX] ${target.name} transferOwnership → ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        failed.push({ name: target.name, reason: `tx reverted (${hash})` });
        continue;
      }
      console.log(`[OK] ${target.name} owner transferred (block ${receipt.blockNumber})`);
      transferred.push(target.name);
    } catch (err) {
      failed.push({
        name: target.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log("");
  console.log("Summary:");
  console.log(`  transferred: ${transferred.join(", ") || "(none)"}`);
  console.log(`  skipped:     ${skipped.join(", ") || "(none)"}`);
  if (failed.length) {
    console.log("  failed:");
    for (const f of failed) console.log(`    - ${f.name}: ${f.reason}`);
    process.exit(1);
  }
  if (skipped.length) {
    console.log("");
    console.log(
      "NOTE: skipped contracts do not yet support multisig ownership. See docs/GOVERNANCE.md for the contract-change checklist required before mainnet.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
