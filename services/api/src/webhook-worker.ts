// Webhook delivery worker. Polls pending webhook_deliveries and POSTs each
// to its subscription URL with an HMAC signature, retrying with a bounded
// attempt cap. Mirrors notification-worker (setInterval / running guard /
// unref / Sentry). Single-instance assumption for now.

import { createHmac } from "node:crypto";
import { query } from "./db";
import { captureException } from "./sentry";
import { setGauge } from "./metrics";

const DEFAULT_INTERVAL_MS = 20_000;
const MAX_ATTEMPTS = Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? "6");
const MAX_BACKOFF_SECONDS = 300;
let timer: NodeJS.Timeout | null = null;
let running = false;

type DeliveryRow = {
  id: string;
  subscription_id: string;
  event: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret: string;
};

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function drainWebhookDeliveriesOnce(fetchImpl: typeof fetch = fetch): Promise<void> {
  const { rows } = await query<DeliveryRow>(
    `SELECT d.id, d.subscription_id, d.event, d.payload, d.attempts, s.url, s.secret
       FROM webhook_deliveries d
       JOIN webhook_subscriptions s ON s.id = d.subscription_id
      WHERE d.status = 'pending'
        AND s.active = true
        AND d.attempts < $1
        AND d.next_attempt_at <= now()
      ORDER BY d.next_attempt_at ASC, d.created_at ASC
      LIMIT 50`,
    [MAX_ATTEMPTS],
  );
  setGauge("adjudex_webhook_pending", rows.length);
  if (!rows.length) return;

  for (const row of rows) {
    // payload is stored as JSONB; pg returns it already parsed. Re-stringify
    // canonically so the signature matches exactly what we send on the wire.
    const body = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
    try {
      const res = await fetchImpl(row.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-adjudex-event": row.event,
          "x-adjudex-signature": signWebhookBody(row.secret, body),
          "x-adjudex-delivery": row.id,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await query(
          `UPDATE webhook_deliveries SET status = 'delivered', delivered_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1`,
          [row.id],
        );
      } else {
        await failDelivery(row, `http_${res.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failDelivery(row, message.slice(0, 400));
      void captureException(err, { component: "webhook-worker", delivery: row.id });
    }
  }
}

async function failDelivery(row: DeliveryRow, error: string): Promise<void> {
  const attempts = row.attempts + 1;
  const status = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
  const nextAttemptSeconds = Math.min(MAX_BACKOFF_SECONDS, 20 * 2 ** Math.max(0, attempts - 1));
  await query(
    `UPDATE webhook_deliveries
        SET attempts = $2,
            last_error = $3,
            status = $4,
            next_attempt_at = CASE
              WHEN $4 = 'pending' THEN now() + ($5::int * interval '1 second')
              ELSE next_attempt_at
            END
      WHERE id = $1`,
    [row.id, attempts, error, status, nextAttemptSeconds],
  );
}

export function startWebhookWorker(opts?: { intervalMs?: number }): void {
  if (timer) return;
  const intervalMs = opts?.intervalMs ?? Number(process.env.WEBHOOK_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const tick = () => {
    if (running) return;
    running = true;
    drainWebhookDeliveriesOnce()
      .catch((err) => void captureException(err, { component: "webhook-worker" }))
      .finally(() => {
        running = false;
      });
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
}

export function stopWebhookWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
