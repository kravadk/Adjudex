// Outbound webhook enqueue. On a subscribed event we fan out one delivery
// row per active subscription; the webhook worker does the actual POST +
// HMAC + retry. Enqueue accepts an executor so it can run inside the same
// transaction as the resolution write (atomic) or standalone via `query`.

import { createToken } from "./auth";
import { query, type QueryExecutor } from "./db";
import { captureException } from "./sentry";
import { isIP } from "node:net";

export const WEBHOOK_EVENTS = ["market.resolved", "market.created"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

type Executor = QueryExecutor;
type WebhookUrlError = "invalid_url" | "https_url_required" | "private_url_blocked";

type WebhookSubscriptionRow = {
  id: string;
  url: string;
  event_types: WebhookEvent[];
  active: boolean;
  created_at: Date;
};

export type WebhookSubscriptionView = {
  id: string;
  url: string;
  eventTypes: WebhookEvent[];
  active: boolean;
  createdAtIso: string;
};

export type CreateWebhookResult =
  | {
      ok: true;
      subscription: WebhookSubscriptionView & { secret: string };
    }
  | {
      ok: false;
      error: WebhookUrlError;
    };

const DEFAULT_WEBHOOK_EVENTS: WebhookEvent[] = ["market.resolved"];

export function validateWebhookUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: WebhookUrlError } {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, error: "https_url_required" };
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "https_url_required" };
  if (parsed.username || parsed.password) return { ok: false, error: "invalid_url" };
  if (isBlockedWebhookHost(parsed.hostname)) return { ok: false, error: "private_url_blocked" };
  parsed.hash = "";
  return { ok: true, url: parsed.toString() };
}

export function normalizeWebhookEventTypes(input: unknown): WebhookEvent[] {
  if (!Array.isArray(input)) return [...DEFAULT_WEBHOOK_EVENTS];
  const events = input.filter((event): event is WebhookEvent =>
    typeof event === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(event),
  );
  return events.length ? [...new Set(events)] : [...DEFAULT_WEBHOOK_EVENTS];
}

export async function listWebhookSubscriptions(
  ownerAddress: string,
  exec: Executor = query,
): Promise<WebhookSubscriptionView[]> {
  const result = await exec<WebhookSubscriptionRow>(
    `SELECT id, url, event_types, active, created_at
       FROM webhook_subscriptions WHERE lower(owner_address) = lower($1)
      ORDER BY created_at DESC`,
    [ownerAddress],
  );
  return result.rows.map(formatWebhookSubscription);
}

export async function createWebhookSubscription(
  ownerAddress: string,
  input: { url?: unknown; eventTypes?: unknown },
  exec: Executor = query,
): Promise<CreateWebhookResult> {
  const validatedUrl = validateWebhookUrl(input.url);
  if (!validatedUrl.ok) return validatedUrl;
  const eventTypes = normalizeWebhookEventTypes(input.eventTypes);
  const id = createToken(12);
  const secret = createToken(24);
  await exec(
    `INSERT INTO webhook_subscriptions (id, owner_address, url, secret, event_types)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, ownerAddress.toLowerCase(), validatedUrl.url, secret, eventTypes],
  );
  return {
    ok: true,
    subscription: {
      id,
      url: validatedUrl.url,
      eventTypes,
      active: true,
      secret,
      createdAtIso: new Date().toISOString(),
    },
  };
}

export async function deleteWebhookSubscription(
  id: string,
  ownerAddress: string,
  exec: Executor = query,
): Promise<boolean> {
  const result = await exec(
    `DELETE FROM webhook_subscriptions WHERE id = $1 AND lower(owner_address) = lower($2)`,
    [id, ownerAddress],
  );
  return Boolean(result.rowCount);
}

// Enqueue a delivery per active subscription that listens for `event`.
// Best-effort: never throws into the caller's resolution path.
export async function enqueueWebhook(
  event: WebhookEvent,
  payload: Record<string, unknown>,
  exec: Executor = query,
): Promise<void> {
  try {
    const subs = await exec<{ id: string }>(
      `SELECT id FROM webhook_subscriptions
        WHERE active = true AND $1 = ANY(event_types)`,
      [event],
    );
    const body = JSON.stringify({ event, ...payload, enqueuedAt: new Date().toISOString() });
    for (const sub of subs.rows) {
      await exec(
        `INSERT INTO webhook_deliveries (id, subscription_id, event, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [createToken(16), sub.id, event, body],
      );
    }
  } catch (err) {
    void captureException(err, { component: "webhooks-enqueue", event });
  }
}

export async function enqueueMarketResolved(
  marketId: string,
  outcome: "YES" | "NO",
  transactionHash: string | null,
  exec: Executor = query,
): Promise<void> {
  await enqueueWebhook(
    "market.resolved",
    { marketId, outcome, transactionHash },
    exec,
  );
}

function formatWebhookSubscription(row: WebhookSubscriptionRow): WebhookSubscriptionView {
  return {
    id: row.id,
    url: row.url,
    eventTypes: row.event_types,
    active: row.active,
    createdAtIso: row.created_at.toISOString(),
  };
}

function isBlockedWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isBlockedIpv4(host);
  if (ipVersion === 6) return isBlockedIpv6(host);
  return false;
}

function isBlockedIpv4(host: string): boolean {
  const [a, b] = host.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(host: string): boolean {
  return (
    host === "::" ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:") ||
    host.startsWith("::ffff:127.") ||
    host.startsWith("::ffff:10.") ||
    host.startsWith("::ffff:192.168.")
  );
}
