// Notification worker. Polls `notification_events` for undelivered rows
// and dispatches them via the configured channel. In S1 the only working
// channel is "log" (writes to the Pino structured log + Sentry breadcrumb).
// In S2 we'll wire Resend / Postmark for real email delivery.
//
// Lifecycle: started from server.ts boot. Single-instance assumption — when
// we scale to multiple Fastify workers (S3) this needs a Postgres advisory
// lock or a separate worker pod to avoid duplicate sends.

import { query } from "./db";
import { captureException } from "./sentry";
import { setGauge } from "./metrics";

type Row = {
  id: string;
  address: string;
  kind: string;
  market_id: string | null;
  title: string;
  body: string;
  delivery_attempts: number;
};

const DEFAULT_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = Number(process.env.NOTIFICATION_MAX_ATTEMPTS ?? "5");
const CHANNEL = (process.env.NOTIFICATION_CHANNEL ?? "log").toLowerCase();
let timer: NodeJS.Timeout | null = null;
let running = false;

export function startNotificationWorker(opts?: { intervalMs?: number }): void {
  if (timer) return;
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const tick = () => {
    if (running) return;
    running = true;
    drainOnce()
      .catch((err) => {
        void captureException(err, { component: "notification-worker" });
      })
      .finally(() => {
        running = false;
      });
  };
  timer = setInterval(tick, intervalMs);
  // Don't keep the event loop alive — graceful shutdown should be able to
  // close even without explicit cancellation.
  timer.unref?.();
  // Fire one tick immediately so the first row doesn't wait `intervalMs`.
  tick();
}

export function stopNotificationWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function drainOnce(): Promise<void> {
  const result = await query<Row>(
    `SELECT id, address, kind, market_id, title, body, delivery_attempts
       FROM notification_events
      WHERE delivered_at IS NULL
        AND delivery_attempts < $1
      ORDER BY created_at ASC
      LIMIT 50`,
    [MAX_ATTEMPTS],
  );
  const rows = result.rows;
  setGauge("pariai_notification_pending", rows.length);
  if (!rows.length) return;

  for (const row of rows) {
    try {
      await dispatch(row);
      await query(
        `UPDATE notification_events
            SET delivered_at = now(),
                delivery_channel = $2,
                delivery_attempts = delivery_attempts + 1,
                delivery_error = NULL
          WHERE id = $1`,
        [row.id, CHANNEL],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE notification_events
            SET delivery_attempts = delivery_attempts + 1,
                delivery_error = $2
          WHERE id = $1`,
        [row.id, message.slice(0, 500)],
      );
      void captureException(err, { component: "notification-worker", row: row.id });
    }
  }
}

async function dispatch(row: Row): Promise<void> {
  if (CHANNEL === "email") {
    return dispatchEmail(row);
  }
  if (CHANNEL === "log" || CHANNEL === "") {
    // Default in dev: write to stdout so it shows up in the structured log.
    console.info(
      `[notify] ${row.kind} -> ${row.address}: ${row.title} (market=${row.market_id ?? "-"})`,
    );
    return;
  }
  throw new Error(`Unsupported NOTIFICATION_CHANNEL: ${CHANNEL}`);
}

// Resend.com transport. Lightweight (single API call), no SDK needed.
// Enable by setting NOTIFICATION_CHANNEL=email + RESEND_API_KEY + NOTIFY_FROM.
// Recipient is looked up from user_emails (S2 — for now uses address as a
// stand-in; rows for non-email kinds should not be queued with channel=email).
async function dispatchEmail(row: Row): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM;
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY + NOTIFY_FROM required when NOTIFICATION_CHANNEL=email");
  }
  const recipient = await resolveEmail(row.address);
  if (!recipient) {
    // No verified email — fall back to log so the row gets marked delivered
    // (silent skip is worse than a noisy log).
    console.info(
      `[notify-skip] ${row.address} has no verified email; skipping email send for ${row.id}`,
    );
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: recipient,
      subject: row.title,
      text: row.body,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

async function resolveEmail(address: string): Promise<string | null> {
  // user_emails table is added in a later migration. For now no rows exist
  // so we always return null and the email channel becomes a no-op until
  // S2 ships the user-preferences UI.
  try {
    const r = await query<{ email: string }>(
      `SELECT email FROM user_emails WHERE lower(address) = lower($1) AND verified_at IS NOT NULL LIMIT 1`,
      [address],
    );
    return r.rows[0]?.email ?? null;
  } catch {
    return null;
  }
}
