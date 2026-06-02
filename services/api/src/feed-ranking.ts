// Personalised feed ranker (S6.C.1).
//
// Returns market ids ordered by relevance to the caller, then the
// caller's server.ts route hydrates them via the normal marketSelect()
// path so feed rows have the exact same shape as `/api/markets`.
//
// Ranking is intentionally deterministic — no ML, no embeddings. We
// just bucket-sort by relevance tier and within each tier by volume:
//
//   Tier 1: open position on this market               (your skin in the game)
//   Tier 2: watchlisted markets                        (explicit signal)
//   Tier 3: markets in categories you've traded        (implicit signal)
//   Tier 4: hot markets (market_stats.is_hot = true)   (fallback)
//
// Anonymous callers get only Tier 4.

import { query } from "./db";

export type FeedRow = {
  id: string;
  tier: 1 | 2 | 3 | 4;
  // Optional human-readable hint the UI can render as a chip:
  // "Your position", "Watchlisted", "You trade Crypto", "Hot".
  reason: string;
};

const MAX_LIMIT = 100;

export async function rankFeedFor(
  address: string | null,
  limit = 30,
): Promise<FeedRow[]> {
  const cap = Math.max(1, Math.min(limit, MAX_LIMIT));
  if (!address) {
    // Anonymous — hot only, sorted by volume.
    const r = await query<{ id: string }>(
      `SELECT m.id
         FROM markets m
         JOIN market_stats s ON s.market_id = m.id
        WHERE s.is_hot = true AND m.status <> 'archived'
        ORDER BY s.volume_usd DESC
        LIMIT $1`,
      [cap],
    );
    return r.rows.map((row) => ({ id: row.id, tier: 4, reason: "Hot" }));
  }

  const lower = address.toLowerCase();
  const seen = new Set<string>();
  const out: FeedRow[] = [];

  // Tier 1 — open positions
  const positions = await query<{ market_id: string }>(
    `SELECT DISTINCT market_id
       FROM positions
      WHERE lower(address) = $1 AND status = 'open'
      ORDER BY market_id DESC
      LIMIT $2`,
    [lower, cap],
  );
  for (const row of positions.rows) {
    if (!seen.has(row.market_id)) {
      seen.add(row.market_id);
      out.push({ id: row.market_id, tier: 1, reason: "Your position" });
    }
  }

  // Tier 2 — watchlisted
  if (out.length < cap) {
    const watch = await query<{ market_id: string }>(
      `SELECT market_id
         FROM watchlist
        WHERE lower(address) = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [lower, cap - out.length],
    );
    for (const row of watch.rows) {
      if (!seen.has(row.market_id)) {
        seen.add(row.market_id);
        out.push({ id: row.market_id, tier: 2, reason: "Watchlisted" });
      }
    }
  }

  // Tier 3 — categories the user has traded in
  if (out.length < cap) {
    const cats = await query<{ category: string }>(
      `SELECT DISTINCT m.category
         FROM positions p
         JOIN markets m ON m.id = p.market_id
        WHERE lower(p.address) = $1`,
      [lower],
    );
    const categoryList = cats.rows.map((r) => r.category);
    if (categoryList.length > 0) {
      const matched = await query<{ id: string; category: string }>(
        `SELECT m.id, m.category
           FROM markets m
           JOIN market_stats s ON s.market_id = m.id
          WHERE m.category = ANY($1::text[])
            AND m.status <> 'archived'
          ORDER BY s.volume_usd DESC
          LIMIT $2`,
        [categoryList, cap - out.length],
      );
      for (const row of matched.rows) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          out.push({
            id: row.id,
            tier: 3,
            reason: `You trade ${capitalize(row.category)}`,
          });
        }
      }
    }
  }

  // Tier 4 — hot fallback
  if (out.length < cap) {
    const hot = await query<{ id: string }>(
      `SELECT m.id
         FROM markets m
         JOIN market_stats s ON s.market_id = m.id
        WHERE s.is_hot = true AND m.status <> 'archived'
        ORDER BY s.volume_usd DESC
        LIMIT $1`,
      [cap - out.length],
    );
    for (const row of hot.rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        out.push({ id: row.id, tier: 4, reason: "Hot" });
      }
    }
  }

  return out.slice(0, cap);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
