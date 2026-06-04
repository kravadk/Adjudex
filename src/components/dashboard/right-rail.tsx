"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Market } from "@/lib/types/domain";

type Row = Pick<Market, "id" | "title" | "volumeUsd">;

function formatVolume(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}

export function RightRail() {
  const [trending, setTrending] = useState<Row[]>([]);
  const [latest, setLatest] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/markets?hotOnly=true", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch("/api/markets", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ]).then(([hotRows, allRows]) => {
      if (!active) return;
      const top = (hotRows as Market[])
        .slice()
        .sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0))
        .slice(0, 3);
      const fresh = (allRows as Market[])
        .slice()
        .sort((a, b) =>
          (b.sourcePublishedAtIso ?? "").localeCompare(a.sourcePublishedAtIso ?? ""),
        )
        .slice(0, 3);
      setTrending(top.map((m) => ({ id: m.id, title: m.title, volumeUsd: m.volumeUsd ?? 0 })));
      setLatest(fresh.map((m) => ({ id: m.id, title: m.title, volumeUsd: m.volumeUsd ?? 0 })));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <aside
      className="hidden xl:flex flex-col gap-5 w-[300px] flex-shrink-0 sticky top-[76px] self-start max-h-[calc(100vh-92px)] overflow-y-auto no-scrollbar"
      aria-label="Trending and latest markets"
    >
      <RailList title="Trending" rows={trending} loading={loading} emptyHint="No hot markets yet." />
      <RailList title="New" rows={latest} loading={loading} emptyHint="Markets you create land here first." />
    </aside>
  );
}

function RailList({
  title,
  rows,
  loading,
  emptyHint,
}: {
  title: string;
  rows: Row[];
  loading: boolean;
  emptyHint: string;
}) {
  return (
    <div>
      <h2
        className="text-[18px] mb-3 px-1"
        style={{
          color: "var(--tx, #fafafa)",
          fontWeight: 800,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h2>
      <div className="space-y-1">
        {loading ? (
          <p className="text-[11px] px-1" style={{ color: "var(--t4, #525252)" }}>
            Loading...
          </p>
        ) : rows.length === 0 ? (
          <p className="text-[11px] px-1" style={{ color: "var(--t4, #525252)" }}>
            {emptyHint}
          </p>
        ) : (
          rows.map((row, i) => (
            <Link
              key={row.id}
              href={`/market/${encodeURIComponent(row.id)}`}
              className="flex items-start gap-2.5 rounded-[8px] px-2 py-2 transition-colors hover:bg-white/[0.03]"
            >
              <span
                className="text-[14px] font-bold tabular-nums flex-shrink-0 mt-0.5 min-w-[14px] text-center"
                style={{ color: "var(--t3, #6b7280)" }}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="text-[13.5px] leading-snug line-clamp-2"
                  style={{
                    color: "var(--tx, #fafafa)",
                    fontWeight: 700,
                    letterSpacing: "-0.005em",
                  }}
                >
                  {row.title}
                </div>
                <div
                  className="text-[11px] font-mono tabular-nums font-semibold mt-0.5"
                  style={{ color: "var(--t3, #6b7280)" }}
                >
                  {formatVolume(row.volumeUsd)} Vol
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
