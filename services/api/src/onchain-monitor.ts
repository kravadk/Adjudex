// On-chain anomaly monitor (S5.C). Periodic watchdog that flags
// suspicious behaviour to the on-call channel via notification_events.
// Not a security oracle on its own — production should pair this with
// Forta or a similar continuous-monitoring vendor. This module is the
// "internal smoke alarm" that catches things the indexer already saw.
//
// Checks (kept intentionally cheap so we can run every minute):
//
//   1. Indexer lag spike — chain X is more than INDEXER_LAG_ALERT_BLOCKS
//      behind for over INDEXER_LAG_ALERT_MS continuous milliseconds.
//   2. Resolve burst — > N resolves in T minutes for the same pool
//      (potential bug or attempted griefing).
//   3. Single-pool dominance — one pool is over X% of last 24h fee
//      revenue (concentration risk, not an attack per se).
//   4. Refund-after-grace surge — > M refunds in T minutes (markets
//      failing to resolve, ops attention required).
//
// All findings are written to `notification_events` with kind starting
// with `onchain_anomaly:`. The on-call rotation receives them via the
// regular notification worker (Telegram / email / log).

import { query } from "./db";
import { captureException } from "./sentry";
import { incCounter, setGauge } from "./metrics";

const DEFAULT_INTERVAL_MS = 60_000;
const ALERT_LAG_BLOCKS = Number(process.env.ONCHAIN_MONITOR_LAG_BLOCKS ?? "200");
const ALERT_RESOLVE_BURST = Number(process.env.ONCHAIN_MONITOR_RESOLVE_BURST ?? "5");
const ALERT_RESOLVE_WINDOW_MIN = Number(process.env.ONCHAIN_MONITOR_RESOLVE_WINDOW_MIN ?? "5");
const ALERT_REFUND_BURST = Number(process.env.ONCHAIN_MONITOR_REFUND_BURST ?? "10");
const ALERT_REFUND_WINDOW_MIN = Number(process.env.ONCHAIN_MONITOR_REFUND_WINDOW_MIN ?? "60");
const ALERT_POOL_DOMINANCE_PCT = Number(process.env.ONCHAIN_MONITOR_POOL_DOMINANCE_PCT ?? "60");
const ALERT_RECIPIENT = process.env.ONCALL_ALERT_ADDRESS ?? "0xoncall";

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startOnchainMonitor(opts?: { intervalMs?: number }): void {
  if (timer) return;
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const tick = () => {
    if (running) return;
    running = true;
    drainOnce()
      .catch((err) => {
        incCounter("adjudex_onchain_monitor_errors_total");
        void captureException(err, { component: "onchain-monitor" });
      })
      .finally(() => {
        running = false;
      });
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
}

export function stopOnchainMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function drainOnce(): Promise<void> {
  await checkIndexerLag();
  await checkResolveBurst();
  await checkRefundBurst();
  await checkPoolDominance();
}

async function checkIndexerLag(): Promise<void> {
  const r = await query<{
    chain_id: number;
    last_block: string;
    last_status: string | null;
    updated_at: Date;
  }>(
    `SELECT chain_id, last_block::text, last_status, updated_at
       FROM indexer_state
      ORDER BY updated_at DESC`,
  );
  for (const row of r.rows) {
    const lag = Number(row.last_block || 0);
    setGauge("adjudex_onchain_monitor_indexer_last_block", lag, {
      chain: row.chain_id,
    });
    const staleMs = Date.now() - new Date(row.updated_at).getTime();
    if (staleMs < 5 * 60_000) continue; // skip if cursor is fresh
    if (row.last_status === "error") {
      await notify({
        kind: "onchain_anomaly:indexer_error",
        title: `Indexer chain ${row.chain_id} in error state`,
        body: `last_status=error for over ${Math.floor(staleMs / 60000)}m`,
      });
    } else if (staleMs > 15 * 60_000) {
      await notify({
        kind: "onchain_anomaly:indexer_stale",
        title: `Indexer chain ${row.chain_id} stale`,
        body: `cursor not advancing for ${Math.floor(staleMs / 60000)}m`,
      });
    }
  }
  // ALERT_LAG_BLOCKS gauge for Grafana alert rules.
  setGauge("adjudex_onchain_monitor_lag_threshold_blocks", ALERT_LAG_BLOCKS);
}

async function checkResolveBurst(): Promise<void> {
  const r = await query<{ market_id: string; resolve_count: string }>(
    `SELECT market_id, COUNT(*)::text AS resolve_count
       FROM activity_events
      WHERE kind = 'resolution'
        AND created_at >= now() - interval '${ALERT_RESOLVE_WINDOW_MIN} minutes'
      GROUP BY market_id
      HAVING COUNT(*) >= $1`,
    [ALERT_RESOLVE_BURST],
  );
  for (const row of r.rows) {
    await notify({
      kind: "onchain_anomaly:resolve_burst",
      marketId: row.market_id,
      title: `Resolve burst on ${row.market_id}`,
      body: `${row.resolve_count} resolution events in the last ${ALERT_RESOLVE_WINDOW_MIN}m. Investigate before next window.`,
    });
  }
}

async function checkRefundBurst(): Promise<void> {
  const r = await query<{ refund_count: string }>(
    `SELECT COUNT(*)::text AS refund_count
       FROM activity_events
      WHERE kind = 'refund'
        AND created_at >= now() - interval '${ALERT_REFUND_WINDOW_MIN} minutes'`,
  );
  const total = Number(r.rows[0]?.refund_count ?? 0);
  setGauge("adjudex_onchain_monitor_refunds_window", total);
  if (total >= ALERT_REFUND_BURST) {
    await notify({
      kind: "onchain_anomaly:refund_burst",
      title: "Refund-after-grace surge",
      body: `${total} refunds in the last ${ALERT_REFUND_WINDOW_MIN}m. Markets failing to resolve — check judge worker + RPC health.`,
    });
  }
}

async function checkPoolDominance(): Promise<void> {
  const r = await query<{ market_id: string; pool_sum: string; pool_pct: string }>(
    `WITH window_volume AS (
       SELECT market_id, COALESCE(SUM(amount_usd), 0) AS volume
         FROM activity_events
        WHERE kind = 'claim'
          AND created_at >= now() - interval '24 hours'
        GROUP BY market_id
     ), totals AS (
       SELECT COALESCE(SUM(volume), 0)::numeric AS total FROM window_volume
     )
     SELECT w.market_id,
            w.volume::text                AS pool_sum,
            CASE WHEN t.total > 0
                 THEN (w.volume / t.total * 100)::text
                 ELSE '0'
            END                            AS pool_pct
       FROM window_volume w, totals t
      WHERE t.total > 0
        AND (w.volume / t.total * 100) >= $1
      ORDER BY w.volume DESC
      LIMIT 5`,
    [ALERT_POOL_DOMINANCE_PCT],
  );
  for (const row of r.rows) {
    const pct = Math.round(Number(row.pool_pct || 0));
    await notify({
      kind: "onchain_anomaly:pool_dominance",
      marketId: row.market_id,
      title: `Pool ${row.market_id} = ${pct}% of 24h fee revenue`,
      body: `Concentration risk above ${ALERT_POOL_DOMINANCE_PCT}%. Not an attack on its own but worth eyeballing.`,
    });
  }
}

// Write to notification_events (already drained by notification worker
// to Telegram / email / log). Dedupes per (kind, marketId) within a
// 30-minute window so we don't spam the on-call channel.
async function notify(input: {
  kind: string;
  title: string;
  body: string;
  marketId?: string;
}): Promise<void> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM notification_events
      WHERE kind = $1
        AND COALESCE(market_id, '') = COALESCE($2, '')
        AND created_at >= now() - interval '30 minutes'
      LIMIT 1`,
    [input.kind, input.marketId ?? null],
  );
  if (existing.rowCount) return;
  const id = `mon_${Date.now()}_${Math.floor(performance.now() * 1000) % 1_000_000}`;
  await query(
    `INSERT INTO notification_events
       (id, address, kind, market_id, title, body)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [id, ALERT_RECIPIENT, input.kind, input.marketId ?? null, input.title, input.body],
  );
  incCounter("adjudex_onchain_monitor_alerts_total", { kind: input.kind });
}
