"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Gamepad2 } from "lucide-react";
import { MarketCard } from "@/components/dashboard/market-card";
import { EmptyState, ErrorState } from "@/components/dashboard/state-blocks";
import { useMarkets } from "@/lib/hooks/useMarkets";
import { toMarketView } from "@/lib/market-view";

type Props = {
  game: string;
  gameLabel: string;
};

// Per-game esports landing page. Filters indexed markets by Market.game
// (or by title heuristic for legacy markets without the field).
export function EsportsGameClient({ game, gameLabel }: Props) {
  const { markets, isLoading, error } = useMarkets();

  const filtered = useMemo(() => {
    return markets
      .filter(
        (m) =>
          m.game === game ||
          (m.category === "esports" && m.title.toLowerCase().includes(game)),
      )
      .map((m) => toMarketView(m))
      .sort((a, b) => b.volume - a.volume);
  }, [markets, game]);

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
          ["cs2", "CS2"],
          ["dota2", "Dota 2"],
          ["lol", "LoL"],
          ["valorant", "Valorant"],
          ["r6", "R6"],
          ["overwatch", "Overwatch"],
        ].map(([slug, label]) => {
          const active = slug === game;
          return (
            <Link
              key={slug}
              href={`/esports/${slug}`}
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
        <ErrorState
          title={`${gameLabel} markets unavailable`}
          body={error}
        />
      ) : filtered.length === 0 && !isLoading ? (
        <EmptyState
          Icon={Gamepad2}
          title={`No ${gameLabel} markets yet`}
          body={`Once an admin imports a ${gameLabel} match from a public feed, it shows up here. You can also create one manually.`}
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
