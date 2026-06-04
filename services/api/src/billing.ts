// Subscription billing module (S4.A).
//
// Tracks paying subscribers in the `subscriptions` table. Supports two
// payment rails — both opt-in via env, both no-ops in dev when missing:
//
//   STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET  → fiat path (Checkout + webhook)
//   SABLIER_RPC_URL + SABLIER_CONTRACT          → on-chain USDC stream path
//
// The module never holds funds. Stripe routes the card to Stripe; Sablier
// streams USDC from the user's wallet. We only record subscription state.
//
// Tier resolution is the public-facing API the rest of the codebase uses:
//   tierFor(address) -> "free" | "pro" | "enterprise"
// Rate-limit code, webhook delivery, and analytics gating call this.

import { query } from "./db";
import { captureException } from "./sentry";

// Tier vocabulary (S5.A). Verticalised pro tiers each have their own
// feature surface — see hasFeature() for the mapping. Enterprise is the
// talk-to-sales tier intended for AI hedge-fund-bot operators.
export type Tier =
  | "free"
  | "pro"
  | "esports-pro"
  | "trading-pro"
  | "agent-pro"
  | "enterprise";
export type Status = "active" | "trialing" | "past_due" | "canceled";

export const PAID_TIERS: ReadonlyArray<Exclude<Tier, "free">> = [
  "pro",
  "esports-pro",
  "trading-pro",
  "agent-pro",
  "enterprise",
];

export function isPaidTier(value: unknown): value is Exclude<Tier, "free"> {
  return typeof value === "string" && (PAID_TIERS as readonly string[]).includes(value);
}

// Feature gates. Routes call hasFeature(tier, "webhooks") instead of
// switching on tier directly, so adding a new tier only touches this
// table.
export type Feature =
  | "higher_rate_limit"   // 10× public API quota
  | "webhooks"             // real-time market events to user-supplied URL
  | "advanced_analytics"   // volatility, pool flow, agent activity feed
  | "priority_quotes"      // lower-latency signed bet quotes
  | "private_market"       // can create private (invite-only) markets
  | "esports_pro_feeds"    // live PandaScore-grade match telemetry
  | "trading_terminal"     // sparklines, depth bars, time-window aggregations
  | "agent_dedicated"      // dedicated infra for AI MM-agent fleet
  | "sla_99_99"            // 99.99% uptime SLA
  | "data_export";         // bulk CSV / signed market data

const TIER_FEATURES: Record<Tier, ReadonlyArray<Feature>> = {
  free: [],
  pro: ["higher_rate_limit", "advanced_analytics"],
  "esports-pro": ["higher_rate_limit", "advanced_analytics", "esports_pro_feeds"],
  "trading-pro": ["higher_rate_limit", "advanced_analytics", "trading_terminal", "priority_quotes"],
  "agent-pro": [
    "higher_rate_limit",
    "webhooks",
    "priority_quotes",
    "private_market",
    "agent_dedicated",
  ],
  enterprise: [
    "higher_rate_limit",
    "webhooks",
    "advanced_analytics",
    "priority_quotes",
    "private_market",
    "esports_pro_feeds",
    "trading_terminal",
    "agent_dedicated",
    "sla_99_99",
    "data_export",
  ],
};

export function hasFeature(tier: Tier, feature: Feature): boolean {
  return TIER_FEATURES[tier]?.includes(feature) ?? false;
}

export type SubscriptionRow = {
  id: string;
  address: string;
  tier: Tier;
  status: Status;
  current_period_end: string | null;
  stripe_subscription_id: string | null;
  usdc_stream_id: string | null;
  price_usd_cents: number | null;
};

// Tier price book, server-authoritative. UI may render hints but should
// never compute eligibility from these constants — call tierFor() instead.
export const TIER_PRICES_USD_CENTS: Record<Exclude<Tier, "free">, number> = {
  pro: 2900,             // $29 / month — general pro
  "esports-pro": 4900,   // $49 / month — esports vertical add-on
  "trading-pro": 9900,   // $99 / month — power-trader analytics
  "agent-pro": 14900,    // $149 / month — webhooks + private markets for bots
  enterprise: 49900,     // $499 / month — talk-to-sales tier
};

export async function tierFor(address: string): Promise<Tier> {
  const sub = await currentSubscription(address);
  if (!sub) return "free";
  if (sub.status !== "active" && sub.status !== "trialing") return "free";
  if (sub.current_period_end) {
    const expires = new Date(sub.current_period_end).getTime();
    if (Number.isFinite(expires) && expires < Date.now()) return "free";
  }
  return sub.tier;
}

export async function currentSubscription(
  address: string,
): Promise<SubscriptionRow | null> {
  const r = await query<SubscriptionRow>(
    `SELECT id, address, tier, status, current_period_end,
            stripe_subscription_id, usdc_stream_id, price_usd_cents
       FROM subscriptions
      WHERE lower(address) = lower($1)
        AND status IN ('active', 'trialing', 'past_due')
      ORDER BY updated_at DESC
      LIMIT 1`,
    [address],
  );
  return r.rows[0] ?? null;
}

// Append a subscription_events row. Reconciler picks it up on next tick.
// Returns the event id so webhook handlers can dedupe via external_id.
export async function recordSubscriptionEvent(input: {
  externalId: string;
  kind: string;
  payload: unknown;
  subscriptionId?: string;
}): Promise<string> {
  const id = `evt_${Date.now()}_${Math.floor(performance.now() * 1000) % 1_000_000}`;
  await query(
    `INSERT INTO subscription_events
       (id, subscription_id, external_id, kind, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      input.subscriptionId ?? null,
      input.externalId,
      input.kind,
      JSON.stringify(input.payload),
    ],
  );
  return id;
}

// Upsert a subscription. Used by reconciler when an event resolves to a
// concrete state change. Idempotent on (address, stripe_subscription_id|usdc_stream_id).
export async function upsertSubscription(input: {
  address: string;
  tier: Tier;
  status: Status;
  currentPeriodEnd?: string | null;
  stripeSubscriptionId?: string | null;
  usdcStreamId?: string | null;
  priceUsdCents?: number | null;
}): Promise<void> {
  const id = subscriptionId(input);
  await query(
    `INSERT INTO subscriptions
       (id, address, tier, status, current_period_end,
        stripe_subscription_id, usdc_stream_id, price_usd_cents, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (id) DO UPDATE SET
       tier = EXCLUDED.tier,
       status = EXCLUDED.status,
       current_period_end = EXCLUDED.current_period_end,
       price_usd_cents = EXCLUDED.price_usd_cents,
       updated_at = now()`,
    [
      id,
      input.address.toLowerCase(),
      input.tier,
      input.status,
      input.currentPeriodEnd ?? null,
      input.stripeSubscriptionId ?? null,
      input.usdcStreamId ?? null,
      input.priceUsdCents ?? null,
    ],
  );
}

function subscriptionId(input: {
  address: string;
  stripeSubscriptionId?: string | null;
  usdcStreamId?: string | null;
}): string {
  if (input.stripeSubscriptionId) return `stripe_${input.stripeSubscriptionId}`;
  if (input.usdcStreamId) return `sablier_${input.usdcStreamId}`;
  // Free tier or trial bootstrap: stable internal row keyed by wallet.
  return `wallet_${input.address.toLowerCase()}`;
}

// ─── Stripe Checkout (env-gated) ───────────────────────────────────────

// Returns a Stripe Checkout session URL. Caller (route handler) verifies
// SIWE session first so the address is authenticated.
export async function createStripeCheckoutSession(input: {
  address: string;
  tier: Exclude<Tier, "free">;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string } | { error: string }> {
  const secret = process.env.STRIPE_SECRET_KEY;
  const priceId = stripePriceFor(input.tier);
  if (!secret) return { error: "billing_unavailable" };
  if (!priceId) return { error: `no_stripe_price_for_${input.tier}` };

  try {
    const body = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "metadata[address]": input.address.toLowerCase(),
      "metadata[tier]": input.tier,
      client_reference_id: input.address.toLowerCase(),
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      return { error: `stripe_${res.status}` };
    }
    const json = (await res.json()) as { url?: string };
    if (!json.url) return { error: "stripe_no_url" };
    return { url: json.url };
  } catch (err) {
    void captureException(err, { component: "billing.createStripeCheckoutSession" });
    return { error: "stripe_request_failed" };
  }
}

function stripePriceFor(tier: Exclude<Tier, "free">): string | undefined {
  const envKey: Record<Exclude<Tier, "free">, string> = {
    pro: "STRIPE_PRICE_PRO",
    "esports-pro": "STRIPE_PRICE_ESPORTS_PRO",
    "trading-pro": "STRIPE_PRICE_TRADING_PRO",
    "agent-pro": "STRIPE_PRICE_AGENT_PRO",
    enterprise: "STRIPE_PRICE_ENTERPRISE",
  };
  return process.env[envKey[tier]];
}

// Webhook handler: the route verifies Stripe-Signature against the raw body;
// this module only does event persistence and subscription reconciliation.
export async function handleStripeWebhookEvent(event: {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;
  const address =
    ((obj.metadata as Record<string, unknown> | undefined)?.address as string) ??
    ((obj.client_reference_id as string) || "");
  const stripeSubscriptionId =
    (obj.subscription as string) ?? (obj.id as string) ?? null;

  await recordSubscriptionEvent({
    externalId: event.id,
    kind: event.type,
    payload: event,
  });

  // Reconcile only the events we care about — anything else stays
  // queued in subscription_events for inspection.
  if (event.type === "checkout.session.completed" && address) {
    await upsertSubscription({
      address,
      tier: ((obj.metadata as Record<string, unknown> | undefined)?.tier as Tier) ?? "pro",
      status: "active",
      stripeSubscriptionId,
      currentPeriodEnd: extractPeriodEnd(obj),
      priceUsdCents: TIER_PRICES_USD_CENTS.pro,
    });
  } else if (event.type === "customer.subscription.deleted" && address) {
    await upsertSubscription({
      address,
      tier: "free",
      status: "canceled",
      stripeSubscriptionId,
    });
  } else if (event.type === "customer.subscription.updated" && address) {
    const statusRaw = (obj.status as string) ?? "active";
    const status: Status =
      statusRaw === "active" || statusRaw === "trialing" || statusRaw === "past_due" || statusRaw === "canceled"
        ? (statusRaw as Status)
        : "active";
    await upsertSubscription({
      address,
      tier: ((obj.metadata as Record<string, unknown> | undefined)?.tier as Tier) ?? "pro",
      status,
      stripeSubscriptionId,
      currentPeriodEnd: extractPeriodEnd(obj),
    });
  }
}

function extractPeriodEnd(obj: Record<string, unknown>): string | null {
  const raw =
    (obj.current_period_end as number | undefined) ??
    ((obj.subscription as Record<string, unknown> | undefined)?.current_period_end as
      | number
      | undefined);
  if (!raw) return null;
  return new Date(raw * 1000).toISOString();
}

export function isBillingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
