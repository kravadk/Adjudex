"use client";

import { useEffect, useState } from "react";
import { Compass, RefreshCw, Sparkles } from "lucide-react";
import { MarketCard } from "@/components/dashboard/market-card";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/dashboard/state-blocks";
import { toMarketView } from "@/lib/market-view";
import type { Market } from "@/lib/types/domain";

// Personalised feed (S6.C). Renders /api/feed rows as MarketCards with
// a small "reason chip" above each card explaining why it surfaced
// (Your position / Watchlisted / You trade Crypto / Hot).

type FeedMarket = Market & {
  feedTier?: 1 | 2 | 3 | 4;
  feedReason?: string;
};

export function FeedClient() {
  const [markets, setMarkets] = useState<FeedMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    // Intentional: setState inside the effect drives a fetch lifecycle
    // (loading → ok | error). This is the standard data-fetch pattern,
    // not an external-store subscription.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch("/api/feed?limit=30", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`feed_${res.status}`);
        return (await res.json()) as FeedMarket[];
      })
      .then((rows) => {
        if (!active) return;
        setMarkets(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load feed.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  return (
    <div className="px-[22px] py-5 pb-7">
      <div className="mb-5 flex items-end justify-between flex-wrap gap-3">
        <div>
          <div
            className="text-[10.5px] font-mono uppercase tracking-[0.14em] mb-1.5"
            style={{ color: "var(--accent-bright)" }}
          >
            For you · Personalised
          </div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{ color: "var(--tx)" }}
          >
            Markets ranked for you
          </h1>
          <p
            className="text-[13px] mt-1 max-w-prose"
            style={{ color: "var(--t2)" }}
          >
            Your open positions first, then watchlisted markets, then
            markets in categories you trade, finally hot markets you
            haven&apos;t seen.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
          className="btn ghost inline-flex items-center gap-1.5 disabled:opacity-50"
          style={{ height: 32, padding: "0 12px", fontSize: 12 }}
        >
          <RefreshCw
            className="h-3.5 w-3.5"
            style={{ animation: loading ? "spin 1s linear infinite" : undefined }}
          />
          Refresh
        </button>
      </div>

      {error ? (
        <ErrorState
          title="Couldn't load your feed"
          body={error}
          action={{ label: "Retry", onClick: () => setRefreshKey((k) => k + 1) }}
        />
      ) : loading && markets.length === 0 ? (
        <LoadingState
          title="Loading your feed"
          body="Pulling open positions, watchlist, and hot markets."
        />
      ) : markets.length === 0 ? (
        <EmptyState
          Icon={Compass}
          title="Nothing surfaced yet"
          body="Place a bet, watchlist a market, or explore Markets — your feed fills in as you interact."
          action={{ label: "Browse markets", href: "/" }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {markets.map((m) => (
            <div key={m.id} className="flex flex-col gap-1.5">
              {m.feedReason && (
                <ReasonChip reason={m.feedReason} tier={m.feedTier ?? 4} />
              )}
              <MarketCard market={toMarketView(m)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReasonChip({ reason, tier }: { reason: string; tier: 1 | 2 | 3 | 4 }) {
  const color =
    tier === 1
      ? "#10b981"
      : tier === 2
        ? "#3b6ffa"
        : tier === 3
          ? "#a78bfa"
          : "#f59e0b";
  return (
    <span
      className="inline-flex items-center gap-1 self-start text-[10px] font-mono uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-full"
      style={{
        background: `${color}1A`,
        color,
        border: `1px solid ${color}3F`,
      }}
    >
      <Sparkles className="h-2.5 w-2.5" />
      {reason}
    </span>
  );
}
