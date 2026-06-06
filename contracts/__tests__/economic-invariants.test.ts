// Property / invariant tests for the core economic math, fuzzed with a
// deterministic PRNG. These are pure-TS mirrors of the Solidity algorithms
// (ParimutuelPool.claim, OutcomeSharePool quoteBuy/quoteSell). They assert the
// invariants the contracts must hold — solvency, constant-product growth, fee
// monotonicity, round-trip loss — across thousands of randomized inputs.
//
// Scope note: this verifies the ALGORITHM, not the deployed bytecode. A future
// Foundry/EVM harness should re-run the same invariants against the compiled
// contracts. Until then this is the executable spec the Solidity must match.

import { describe, expect, it } from "vitest";

// Deterministic 64-bit LCG so failures are reproducible.
function makeRng(seed: number) {
  const mask = (1n << 64n) - 1n;
  let s = BigInt(seed >>> 0) || 1n;
  return (maxExclusive: bigint): bigint => {
    s = (s * 6364136223846793005n + 1442695040888963407n) & mask;
    return (((s >> 16n) % maxExclusive) + maxExclusive) % maxExclusive;
  };
}

// Floor integer sqrt (mirrors OpenZeppelin Math.sqrt rounding-down).
function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

// --- OutcomeSharePool mirrors ---
function netOfFee(amount: bigint, feeBps: bigint): bigint {
  return feeBps === 0n ? amount : amount - (amount * feeBps) / 10_000n;
}

function quoteBuy(reserve: bigint, opposite: bigint, amount: bigint, feeBps: bigint): bigint {
  const net = netOfFee(amount, feeBps);
  if (reserve === 0n || opposite === 0n) return net;
  const k = reserve * opposite;
  const denom = opposite + net;
  const endingReserve = (k + denom - 1n) / denom; // ceil
  return reserve + net - endingReserve;
}

function quoteSell(reserve: bigint, opposite: bigint, shares: bigint, feeBps: bigint): bigint {
  if (shares === 0n) return 0n;
  if (reserve === 0n || opposite === 0n) return 0n;
  const b = reserve + shares + opposite;
  const disc = b * b - 4n * shares * opposite;
  let r = (b - isqrt(disc)) / 2n;
  if (r >= opposite) r = opposite - 1n;
  return netOfFee(r, feeBps);
}

// --- ParimutuelPool.claim mirror ---
function payout(myAmount: bigint, mySide: 0 | 1, resolvedSide: 0 | 1, yesPool: bigint, noPool: bigint): bigint {
  if (mySide !== resolvedSide) return 0n;
  const winningPool = resolvedSide === 0 ? yesPool : noPool;
  if (winningPool === 0n) return 0n;
  return (myAmount * (yesPool + noPool)) / winningPool;
}

const FEES = [0n, 30n, 150n, 500n];
const ITER = 400;

describe("OutcomeSharePool — constant-product invariants", () => {
  it("buy never lets the invariant k decrease (rounding favours LPs)", () => {
    const rng = makeRng(1);
    for (let i = 0; i < ITER; i++) {
      const reserve = rng(1_000_000_000_000n) + 1_000n;
      const opposite = rng(1_000_000_000_000n) + 1_000n;
      const amount = rng(1_000_000_000n) + 1n;
      const fee = FEES[Number(rng(BigInt(FEES.length)))];
      const net = netOfFee(amount, fee);
      const sharesOut = quoteBuy(reserve, opposite, amount, fee);
      const sideAfter = reserve + net - sharesOut;
      const oppAfter = opposite + net;
      expect(sideAfter * oppAfter).toBeGreaterThanOrEqual(reserve * opposite);
      expect(sharesOut).toBeGreaterThanOrEqual(0n);
      expect(sideAfter).toBeGreaterThan(0n);
    }
  });

  it("buy output is monotonic non-decreasing in collateral", () => {
    const rng = makeRng(2);
    for (let i = 0; i < ITER; i++) {
      const reserve = rng(1_000_000_000_000n) + 1_000n;
      const opposite = rng(1_000_000_000_000n) + 1_000n;
      const fee = FEES[Number(rng(BigInt(FEES.length)))];
      const a1 = rng(500_000_000n) + 1n;
      const a2 = a1 + rng(500_000_000n) + 1n; // strictly larger
      expect(quoteBuy(reserve, opposite, a2, fee)).toBeGreaterThanOrEqual(
        quoteBuy(reserve, opposite, a1, fee),
      );
    }
  });

  it("buy then immediately sell never returns more collateral than was put in", () => {
    const rng = makeRng(3);
    for (let i = 0; i < ITER; i++) {
      const reserve = rng(1_000_000_000_000n) + 10_000n;
      const opposite = rng(1_000_000_000_000n) + 10_000n;
      const amount = rng(100_000_000n) + 1n;
      const fee = FEES[Number(rng(BigInt(FEES.length)))];
      const net = netOfFee(amount, fee);
      const sharesOut = quoteBuy(reserve, opposite, amount, fee);
      if (sharesOut === 0n) continue;
      const sideAfter = reserve + net - sharesOut;
      const oppAfter = opposite + net;
      const back = quoteSell(sideAfter, oppAfter, sharesOut, fee);
      expect(back).toBeLessThanOrEqual(amount);
    }
  });

  it("higher fee never increases trader output (buy and sell)", () => {
    const rng = makeRng(4);
    for (let i = 0; i < ITER; i++) {
      const reserve = rng(1_000_000_000_000n) + 10_000n;
      const opposite = rng(1_000_000_000_000n) + 10_000n;
      const amount = rng(100_000_000n) + 1n;
      const shares = rng(100_000n) + 1n;
      expect(quoteBuy(reserve, opposite, amount, 0n)).toBeGreaterThanOrEqual(
        quoteBuy(reserve, opposite, amount, 500n),
      );
      expect(quoteSell(reserve, opposite, shares, 0n)).toBeGreaterThanOrEqual(
        quoteSell(reserve, opposite, shares, 500n),
      );
    }
  });

  it("sell never drains the opposite reserve to zero", () => {
    const rng = makeRng(5);
    for (let i = 0; i < ITER; i++) {
      const reserve = rng(1_000_000_000n) + 1_000n;
      const opposite = rng(1_000_000_000n) + 1_000n;
      const shares = rng(10_000_000_000n) + 1n; // can exceed reserves
      const out = quoteSell(reserve, opposite, shares, 0n);
      expect(out).toBeLessThan(opposite);
      expect(out).toBeGreaterThanOrEqual(0n);
    }
  });
});

describe("ParimutuelPool — solvency invariants", () => {
  it("sum of all winners' payouts never exceeds the total pool", () => {
    const rng = makeRng(6);
    for (let i = 0; i < ITER; i++) {
      const yesPool = rng(1_000_000_000n) + 1n;
      const noPool = rng(1_000_000_000n) + 1n;
      const total = yesPool + noPool;
      for (const side of [0, 1] as const) {
        const winning = side === 0 ? yesPool : noPool;
        let remaining = winning;
        let paid = 0n;
        const parts = Number(rng(8n)) + 1;
        for (let p = 0; p < parts && remaining > 0n; p++) {
          const stake = p === parts - 1 ? remaining : (rng(remaining) % remaining) + 1n;
          if (stake > remaining) {
            paid += payout(remaining, side, side, yesPool, noPool);
            remaining = 0n;
            break;
          }
          remaining -= stake;
          paid += payout(stake, side, side, yesPool, noPool);
        }
        expect(paid).toBeLessThanOrEqual(total);
      }
    }
  });

  it("losing side is always zero; winner stake is monotonic", () => {
    const rng = makeRng(7);
    for (let i = 0; i < ITER; i++) {
      const yesPool = rng(1_000_000_000n) + 1n;
      const noPool = rng(1_000_000_000n) + 1n;
      const loseSide = Number(rng(2n)) as 0 | 1;
      const winSide = (1 - loseSide) as 0 | 1;
      expect(payout((rng(yesPool) % yesPool) + 1n, loseSide, winSide, yesPool, noPool)).toBe(0n);
      const winning = winSide === 0 ? yesPool : noPool;
      const s1 = (rng(winning) % winning) + 1n;
      const s2add = (rng(winning) % winning) + 1n;
      const s2 = s1 + s2add > winning ? winning : s1 + s2add;
      const p2 = payout(s2, winSide, winSide, yesPool, noPool);
      const p1 = payout(s1 > winning ? winning : s1, winSide, winSide, yesPool, noPool);
      expect(p2).toBeGreaterThanOrEqual(p1);
    }
  });
});
