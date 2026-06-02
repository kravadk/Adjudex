import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abi, Hex } from "viem";

// Walk up from this file until we find src/lib/abi/. Works regardless of cwd.
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "src", "lib", "abi", "MarketFactory.json"))) return dir;
    dir = resolve(dir, "..");
  }
  throw new Error("Cannot locate repo root containing src/lib/abi/MarketFactory.json");
}
const ROOT = findRepoRoot();

function loadAbi(name: string): Abi {
  return JSON.parse(readFileSync(join(ROOT, "src", "lib", "abi", `${name}.json`), "utf-8"));
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required in .env.local`);
  return v;
}

export const config = {
  rpcUrl: required("ARBITRUM_SEPOLIA_RPC_URL"),
  privateKey: required("MM_AGENT_PRIVATE_KEY") as Hex,
  factory: required("MARKET_FACTORY_ADDRESS") as Hex,
  oracle: required("REPUTATION_ORACLE_ADDRESS") as Hex,
  stakeToken: required("STAKE_TOKEN_ADDRESS") as Hex,
  handle: process.env.MM_AGENT_HANDLE ?? "halcyon-mm-#0001",
  // Re-balance when |yes% - 50%| > threshold (bps). 500 bps = 5%.
  imbalanceThresholdBps: Number(process.env.MM_IMBALANCE_BPS ?? 500),
  // Per-bet size in USDC base units (6 decimals). $10 default.
  betSizeUsdc: BigInt(process.env.MM_BET_USDC ?? 10_000_000n),
  // Cap total exposure per market.
  maxExposurePerMarketUsdc: BigInt(process.env.MM_MAX_EXPOSURE ?? 100_000_000n),
  // Polling interval.
  intervalMs: Number(process.env.MM_INTERVAL_MS ?? 15_000),
};

export const abis = {
  factory: loadAbi("MarketFactory"),
  pool: loadAbi("ParimutuelPool"),
  oracle: loadAbi("ReputationOracle"),
  usdc: loadAbi("TestUSDC"),
};
