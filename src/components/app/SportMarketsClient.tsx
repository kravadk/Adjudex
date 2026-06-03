"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Trophy } from "lucide-react";
import { MarketCard } from "@/components/dashboard/market-card";
import { EmptyState, ErrorState } from "@/components/dashboard/state-blocks";
import { useMarkets } from "@/lib/hooks/useMarkets";
import { toMarketView } from "@/lib/market-view";

type Props = {
  sport: string;
  sportLabel: string;
};

// Per-sport landing page for traditional sports (category === "sports").
// Filters by Market.sport, with a title heuristic fallback for legacy
// sports markets that predate the structured field.
export function SportMarketsClient({ sport, sportLabel }: Props) {
  const { markets, isLoading, error } = useMarkets();

  const filtered = useMemo(() => {
    return markets
      .filter(
        (m) =>
          m.sport === sport ||
          (m.category === "sports" && m.title.toLowerCase().includes(sport)),
      )
      .map((m) => toMarketView(m))
      .sort((a, b) => b.volume - a.volume);
  }, [markets, sport]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href="/"
          className="btn ghost"
          style={{ height: 32, padding: "0 12px", fontSize: 12 }}
        >
          All markets
        </Link>
        {[
          ["football", "Football"],
          ["basketball", "Basketball"],
          ["tennis", "Tennis"],
        ].map(([slug, label]) => {
          const active = slug === sport;
          return (
            <Link
              key={slug}
              href={`/sports/${slug}`}
              className="h-8 px-2.5 inline-flex items-center rounded-full text-[11.5px] font-medium tracking-tight"
              style={{
                background: active ? "var(--accent-bright)" : "#211f1e",
                color: active ? "#0a0a0a" : "var(--t2)",
                border: `1px solid ${active ? "var(--accent-bright)" : "#34312e"}`,
              }}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {error ? (
        <ErrorState title={`${sportLabel} markets unavailable`} body={error} />
      ) : filtered.length === 0 && !isLoading ? (
        <EmptyState
          Icon={Trophy}
          title={`No ${sportLabel} markets yet`}
          body={`Once a ${sportLabel} fixture is auto-ingested from a public feed, it shows up here. You can also create one manually.`}
          action={{ label: "Create a market", href: "/create" }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>
      )}
    </>
  );
}
