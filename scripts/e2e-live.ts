// Live E2E verification against the configured testnet.
//
//   pnpm e2e:live           - runs the full create -> bet -> propose ->
//                              finalize -> claim flow against Arb Sepolia
//   pnpm e2e:live --dry     - prints the plan + env preflight only
//
// Env required (matches scripts/check-env.ts --profile=full):
//   DEPLOYER_PRIVATE_KEY         deployer + bettor for this script
//   JUDGE_PRIVATE_KEY            signer for AIJudgeVerifier.propose payload
//   ARBITRUM_SEPOLIA_RPC_URL     write RPC
//   NEXT_PUBLIC_MARKET_FACTORY_ADDRESS
//   NEXT_PUBLIC_STAKE_TOKEN_ADDRESS
//   NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS
//
// The script is best-effort instrumented: every tx hash is logged. A
// failure prints the offending step and the raw error, then exits 1.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseEventLogs,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

type Verbosity = "verbose" | "dry";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadAbi(name: string): unknown[] {
  return readJson(
    join(process.cwd(), "src", "lib", "abi", `${name}.json`),
  ) as unknown[];
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for pnpm e2e:live`);
  return value;
}

function readPrivateKey(name: string): Hex {
  const v = readRequiredEnv(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) {
    throw new Error(`${name} must be 0x + 64 hex chars`);
  }
  return v as Hex;
}

function readAddress(name: string): Address {
  const v = readRequiredEnv(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`${name} must be 0x + 40 hex chars`);
  }
  return v as Address;
}

function step(label: string) {
  console.log(`\n=== ${label} ===`);
}

async function main() {
  const argv = process.argv.slice(2);
  const mode: Verbosity = argv.includes("--dry") ? "dry" : "verbose";

  step("env preflight");
  const deployerKey = readPrivateKey("DEPLOYER_PRIVATE_KEY");
  const judgeKey = readPrivateKey("JUDGE_PRIVATE_KEY");
  const rpcUrl = readRequiredEnv("ARBITRUM_SEPOLIA_RPC_URL");
  const factoryAddress = readAddress("NEXT_PUBLIC_MARKET_FACTORY_ADDRESS");
  const stakeTokenAddress = readAddress("NEXT_PUBLIC_STAKE_TOKEN_ADDRESS");
  const verifierAddress = readAddress(
    "NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS",
  );
  console.log("env preflight ok");
  console.log(`  factory  : ${factoryAddress}`);
  console.log(`  stake    : ${stakeTokenAddress}`);
  console.log(`  verifier : ${verifierAddress}`);
  if (mode === "dry") {
    console.log(
      "\nDRY MODE: no chain writes. Re-run without --dry to execute the flow.",
    );
    return;
  }

  const factoryAbi = loadAbi("MarketFactory");
  const poolAbi = loadAbi("ParimutuelPool");
  const usdcAbi = loadAbi("TestUSDC");
  const judgeAbi = loadAbi("AIJudgeVerifier");

  const transport = http(rpcUrl);
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport,
  });
  const deployer = privateKeyToAccount(deployerKey);
  const judge = privateKeyToAccount(judgeKey);
  const wallet = createWalletClient({
    account: deployer,
    chain: arbitrumSepolia,
    transport,
  });

  step("rpc + chain id");
  const chainId = await publicClient.getChainId();
  if (chainId !== arbitrumSepolia.id) {
    throw new Error(
      `RPC chain id ${chainId} != Arbitrum Sepolia (${arbitrumSepolia.id})`,
    );
  }
  console.log(`chain id ${chainId} ok`);
  console.log(`deployer ${deployer.address}`);
  console.log(`judge    ${judge.address}`);

  step("create soft market");
  const seed = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const specHash = keccak256(stringToBytes(`e2e-live:${seed}`));
  const createHash = await wallet.writeContract({
    address: factoryAddress,
    abi: factoryAbi,
    functionName: "createSoftMarket",
    args: [specHash, verifierAddress],
  });
  console.log(`create tx ${createHash}`);
  const createReceipt = await publicClient.waitForTransactionReceipt({
    hash: createHash,
  });
  const created = parseEventLogs({
    abi: factoryAbi,
    logs: createReceipt.logs,
    eventName: "MarketCreated",
  });
  const args = (created[0] as unknown as {
    args: { marketId: bigint; pool: Address };
  } | undefined)?.args;
  if (!args?.marketId || !args.pool) {
    throw new Error("MarketCreated event not found in receipt");
  }
  const marketId = args.marketId;
  const poolAddress = args.pool;
  console.log(`market id ${marketId} pool ${poolAddress}`);

  step("mint test usdc");
  const mintAmount = 100_000_000n; // 100 USDC (6 dec)
  const mintHash = await wallet.writeContract({
    address: stakeTokenAddress,
    abi: usdcAbi,
    functionName: "mint",
    args: [deployer.address, mintAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });
  console.log(`mint tx ${mintHash}`);

  step("approve + bet YES");
  const approveHash = await wallet.writeContract({
    address: stakeTokenAddress,
    abi: usdcAbi,
    functionName: "approve",
    args: [poolAddress, mintAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  const betAmount = 10_000_000n; // 10 USDC
  const betHash = await wallet.writeContract({
    address: poolAddress,
    abi: poolAbi,
    functionName: "bet",
    args: [0, betAmount], // side 0 = YES
  });
  await publicClient.waitForTransactionReceipt({ hash: betHash });
  console.log(`bet tx ${betHash}`);

  step("sign + propose verdict");
  const outcome: 0 | 1 = 0; // YES
  const evidenceHash = keccak256(stringToBytes(`e2e-evidence:${seed}`));
  const inner = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "bytes32" },
      ],
      [BigInt(arbitrumSepolia.id), poolAddress, marketId, outcome, evidenceHash],
    ),
  );
  const signature = await judge.signMessage({ message: { raw: inner } });
  const proposeHash = await wallet.writeContract({
    address: verifierAddress,
    abi: judgeAbi,
    functionName: "propose",
    args: [poolAddress, marketId, outcome, evidenceHash, signature],
  });
  await publicClient.waitForTransactionReceipt({ hash: proposeHash });
  console.log(`propose tx ${proposeHash}`);

  step("set fastTrack (skip 2h window for live test)");
  // Verifier owner is whoever ran the deploy; if it's the same key we use
  // here, we can bump fastTrackUntil to immediately satisfy finalize().
  // On a real production verifier ownership is on a multisig, so this
  // step will skip with a warning - that's fine, just wait the 2h window.
  try {
    const futureTs = BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24);
    const ftHash = await wallet.writeContract({
      address: verifierAddress,
      abi: judgeAbi,
      functionName: "setFastTrackUntil",
      args: [futureTs],
    });
    await publicClient.waitForTransactionReceipt({ hash: ftHash });
    console.log(`setFastTrackUntil tx ${ftHash}`);
  } catch (error) {
    console.warn(
      `setFastTrackUntil skipped (likely not owner): ${(error as Error).message}`,
    );
  }

  step("wait for canFinalize");
  const finalizeReady = await waitFor(async () => {
    const ok = (await publicClient.readContract({
      address: verifierAddress,
      abi: judgeAbi,
      functionName: "canFinalize",
      args: [marketId],
    })) as boolean;
    return ok ? true : undefined;
  }, { timeoutMs: 2 * 60 * 1000, intervalMs: 5_000 });
  if (!finalizeReady) {
    throw new Error(
      "canFinalize stayed false. Challenge window may still be open; rerun later.",
    );
  }

  step("finalize");
  const finalizeHash = await wallet.writeContract({
    address: verifierAddress,
    abi: judgeAbi,
    functionName: "finalize",
    args: [marketId],
  });
  await publicClient.waitForTransactionReceipt({ hash: finalizeHash });
  console.log(`finalize tx ${finalizeHash}`);

  step("claim");
  // Position id for the first bet on a fresh pool is 1.
  const claimHash = await wallet.writeContract({
    address: poolAddress,
    abi: poolAbi,
    functionName: "claim",
    args: [1n],
  });
  const claimReceipt = await publicClient.waitForTransactionReceipt({
    hash: claimHash,
  });
  console.log(`claim tx ${claimHash}`);
  const claimed = parseEventLogs({
    abi: poolAbi,
    logs: claimReceipt.logs,
    eventName: "Claimed",
  });
  if (claimed.length > 0) {
    const payout = (claimed[0] as unknown as { args: { payout: bigint } })
      .args.payout;
    console.log(`payout: ${Number(payout) / 1_000_000} USDC`);
  }

  step("DONE");
  console.log(`market ${marketId} on pool ${poolAddress}`);
  console.log(
    `arbiscan: https://sepolia.arbiscan.io/address/${poolAddress}`,
  );
}

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  opts: { timeoutMs: number; intervalMs: number },
): Promise<T | undefined> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await probe();
      if (result !== undefined) return result;
    } catch (error) {
      console.warn(`waitFor probe: ${(error as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
  return undefined;
}

main().catch((err) => {
  console.error(`\nFAIL: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
