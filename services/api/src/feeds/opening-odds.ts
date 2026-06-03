// Opening-odds seed (optional, SEED_OPENING_ODDS=1). Right after a market
// is auto-deployed, the creator hot wallet places two opening bets — YES
// and NO — sized to a target implied probability so the pool doesn't sit
// at a cold 50/50 and the first real bettor sees realistic depth + sane
// slippage. This is pure bootstrap liquidity: the parimutuel pool ratio
// remains the source of truth; external implied odds only shape the
// opening skew. Testnet-only — relies on TestUSDC.mint for self-funding.

import { getCreatorClients } from "./chain";

// TestUSDC surface we touch (mint is testnet-only; absent on real USDC).
const usdcAbi = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

const poolBetAbi = [
  { type: "function", name: "bet", stateMutability: "nonpayable", inputs: [{ name: "side", type: "uint8" }, { name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

export function openingOddsEnabled(): boolean {
  return process.env.SEED_OPENING_ODDS === "1";
}

// Total opening stake across both sides, in USDC base units (6 dec).
function totalSeedUnits(): bigint {
  const raw = process.env.SEED_OPENING_USDC;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? BigInt(Math.floor(n)) : 20_000_000n; // 20 USDC
}

// Clamp implied probability so neither side seeds to zero and slippage
// stays sane. Default 0.5 (symmetric depth, stays at 50/50).
function clampProb(p: number | undefined): number {
  if (typeof p !== "number" || !Number.isFinite(p)) return 0.5;
  return Math.min(0.9, Math.max(0.1, p));
}

async function ensureFunds(
  clients: ReturnType<typeof getCreatorClients>,
  stakeToken: `0x${string}`,
  pool: `0x${string}`,
  total: bigint,
): Promise<void> {
  const { publicClient, walletClient, account } = clients;
  const balance = (await publicClient.readContract({
    address: stakeToken,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  if (balance < total) {
    // Mint 10x the shortfall so we don't mint every market.
    const mintHash = await walletClient.writeContract({
      address: stakeToken,
      abi: usdcAbi,
      functionName: "mint",
      args: [account.address, total * 10n],
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
  }
  const allowance = (await publicClient.readContract({
    address: stakeToken,
    abi: usdcAbi,
    functionName: "allowance",
    args: [account.address, pool],
  })) as bigint;
  if (allowance < total) {
    const approveHash = await walletClient.writeContract({
      address: stakeToken,
      abi: usdcAbi,
      functionName: "approve",
      args: [pool, 2n ** 256n - 1n],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }
}

// Best-effort. Returns true if both opening bets landed. Never throws —
// a failed seed must not fail the deploy.
export async function seedOpeningOdds(
  pool: `0x${string}`,
  impliedYesProbability: number | undefined,
): Promise<boolean> {
  if (!openingOddsEnabled()) return false;
  const stakeToken = process.env.STAKE_TOKEN_ADDRESS as `0x${string}` | undefined;
  if (!stakeToken) {
    console.warn("[opening-odds] STAKE_TOKEN_ADDRESS missing — skipping seed");
    return false;
  }

  try {
    const clients = getCreatorClients();
    const total = totalSeedUnits();
    const p = clampProb(impliedYesProbability);
    const yesAmount = BigInt(Math.floor(Number(total) * p));
    const noAmount = total - yesAmount;
    if (yesAmount <= 0n || noAmount <= 0n) return false;

    await ensureFunds(clients, stakeToken, pool, total);

    const { walletClient, publicClient } = clients;
    for (const [side, amount] of [
      [0, yesAmount],
      [1, noAmount],
    ] as const) {
      const hash = await walletClient.writeContract({
        address: pool,
        abi: poolBetAbi,
        functionName: "bet",
        args: [side, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
    console.log(
      `[opening-odds] seeded ${pool} yes=${yesAmount} no=${noAmount} (p=${p})`,
    );
    return true;
  } catch (err) {
    console.warn(`[opening-odds] seed failed for ${pool}: ${(err as Error).message}`);
    return false;
  }
}
