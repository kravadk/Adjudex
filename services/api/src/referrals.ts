// Referral attribution (S4.B).
//
// Attribution is recorded once per address (first-write-wins) and bound
// to a signed message from the referee. This makes the link auditable
// — we keep the signature, and any later challenge can re-verify it.
//
// The pay-out (0.5% of friend's trading fees) is computed off-chain by
// a separate reconciler against `activity_events` + the configured
// `FEE_BPS`. We only update `lifetime_*_usd_cents` columns so the user
// can see accumulated rebates in the UI.

import { verifyMessage, type Hex } from "viem";
import { query } from "./db";

export type ReferralRow = {
  address: string;
  referrer_address: string;
  signature: string;
  attributed_at: string;
  first_position_at: string | null;
  first_position_market_id: string | null;
  lifetime_fees_usd_cents: number;
  lifetime_rebate_usd_cents: number;
};

export type AttributionInput = {
  address: string;       // referee — the wallet being referred
  referrerAddress: string; // referrer — who gets the rebate
  signature: Hex;
  // The message the referee signed. We rebuild this server-side from
  // (address, referrerAddress, nonce) so a stolen signature for a
  // different referee can't be replayed.
  nonce: string;
};

// Default rebate share of the platform fee. 50 = 50% of the fee goes
// back to the referrer (which equals 0.75% of trade size at fee=150 bps).
// Overridable via REFERRAL_REBATE_PCT (integer 0-100).
export function referralRebatePct(): number {
  const raw = Number(process.env.REFERRAL_REBATE_PCT ?? "50");
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) return 50;
  return Math.floor(raw);
}

export function buildReferralMessage(address: string, referrerAddress: string, nonce: string): string {
  return [
    "PariAI referral attribution",
    `Referee:   ${address.toLowerCase()}`,
    `Referrer:  ${referrerAddress.toLowerCase()}`,
    `Nonce:     ${nonce}`,
    "",
    "By signing you accept the Terms of Service. This binding is one-way",
    "and cannot be reassigned to another referrer.",
  ].join("\n");
}

export async function getReferral(address: string): Promise<ReferralRow | null> {
  const r = await query<ReferralRow>(
    `SELECT address, referrer_address, signature, attributed_at,
            first_position_at, first_position_market_id,
            lifetime_fees_usd_cents, lifetime_rebate_usd_cents
       FROM referrals
      WHERE lower(address) = lower($1)
      LIMIT 1`,
    [address],
  );
  return r.rows[0] ?? null;
}

// First-write-wins attribution. Returns the row that's in the database
// after this call (existing or newly inserted) so the caller can show
// the actual referrer (which may differ from input on race).
export async function attribute(input: AttributionInput): Promise<
  | { ok: true; row: ReferralRow; created: boolean }
  | { ok: false; error: string }
> {
  if (input.address.toLowerCase() === input.referrerAddress.toLowerCase()) {
    return { ok: false, error: "self_referral_forbidden" };
  }
  const message = buildReferralMessage(input.address, input.referrerAddress, input.nonce);
  const valid = await verifyMessage({
    address: input.address as Hex,
    message,
    signature: input.signature,
  }).catch(() => false);
  if (!valid) return { ok: false, error: "signature_invalid" };

  const insert = await query<ReferralRow>(
    `INSERT INTO referrals (address, referrer_address, signature)
     VALUES ($1, $2, $3)
     ON CONFLICT (address) DO NOTHING
     RETURNING address, referrer_address, signature, attributed_at,
               first_position_at, first_position_market_id,
               lifetime_fees_usd_cents, lifetime_rebate_usd_cents`,
    [input.address.toLowerCase(), input.referrerAddress.toLowerCase(), input.signature],
  );
  if (insert.rowCount && insert.rows[0]) {
    return { ok: true, row: insert.rows[0], created: true };
  }
  // Existing row — return whatever is on disk so the UI can render
  // "you were already referred by X" gracefully.
  const existing = await getReferral(input.address);
  if (!existing) return { ok: false, error: "attribution_failed" };
  return { ok: true, row: existing, created: false };
}

// Mark first-position timestamp (called once when the referee makes their
// first non-refund position). Subsequent positions don't update this.
export async function noteFirstPosition(input: {
  address: string;
  marketId: string;
}): Promise<void> {
  await query(
    `UPDATE referrals
        SET first_position_at = COALESCE(first_position_at, now()),
            first_position_market_id = COALESCE(first_position_market_id, $2)
      WHERE lower(address) = lower($1)`,
    [input.address, input.marketId],
  );
}

// Increment lifetime fee + rebate counters. Called from a separate
// reconciler that aggregates `activity_events` of kind "claim" and
// looks up referee→referrer for each.
export async function applyRebateAccrual(input: {
  address: string;
  feeUsdCents: number;
  rebateUsdCents: number;
}): Promise<void> {
  if (input.feeUsdCents <= 0 && input.rebateUsdCents <= 0) return;
  await query(
    `UPDATE referrals
        SET lifetime_fees_usd_cents = lifetime_fees_usd_cents + $2,
            lifetime_rebate_usd_cents = lifetime_rebate_usd_cents + $3
      WHERE lower(address) = lower($1)`,
    [input.address, input.feeUsdCents, input.rebateUsdCents],
  );
}

// Returns referrer-side stats: how many users they referred, sum of
// rebate accrued (which they can then claim via the reconciler payout).
export async function referrerStats(referrerAddress: string): Promise<{
  refereeCount: number;
  totalFeesUsdCents: number;
  totalRebateUsdCents: number;
}> {
  const r = await query<{
    referee_count: string;
    total_fees: string;
    total_rebate: string;
  }>(
    `SELECT COUNT(*)::text                      AS referee_count,
            COALESCE(SUM(lifetime_fees_usd_cents), 0)::text  AS total_fees,
            COALESCE(SUM(lifetime_rebate_usd_cents), 0)::text AS total_rebate
       FROM referrals
      WHERE lower(referrer_address) = lower($1)`,
    [referrerAddress],
  );
  const row = r.rows[0];
  return {
    refereeCount: row ? Number(row.referee_count) : 0,
    totalFeesUsdCents: row ? Number(row.total_fees) : 0,
    totalRebateUsdCents: row ? Number(row.total_rebate) : 0,
  };
}
