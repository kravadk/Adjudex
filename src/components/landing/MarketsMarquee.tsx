"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type MarketChip = {
  id: string;
  title: string;
  emoji?: string;
  category?: string;
  volumeUsd?: number;
  yesProbability?: number;
};

const FALLBACK: MarketChip[] = [
  { id: "s1", title: "Will BTC close above $120k this month?", emoji: "₿", category: "crypto", yesProbability: 62 },
  { id: "s2", title: "NAVI to win the next CS2 major?", emoji: "🎯", category: "esports", yesProbability: 44 },
  { id: "s3", title: "Will tokenized AAPL close above $250?", emoji: "📈", category: "stocks", yesProbability: 51 },
  { id: "s4", title: "ETH/BTC ratio up next week?", emoji: "Ξ", category: "crypto", yesProbability: 38 },
  { id: "s5", title: "Real Madrid to win El Clasico?", emoji: "⚽", category: "sports", yesProbability: 57 },
  { id: "s6", title: "GMX BTC pool keeps $1M+ liquidity?", emoji: "🔷", category: "crypto", yesProbability: 73 },
];

export function MarketsMarquee() {
  const [items, setItems] = useState<MarketChip[]>(FALLBACK);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch("/api/markets", { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const rows = (await res.json()) as MarketChip[];
        const top = rows
          .filter((r) => r.title)
          .sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0))
          .slice(0, 12);
        if (top.length >= 4 && !controller.signal.aborted) setItems(top);
      } catch {
        // keep fallback chips
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  // Duplicate the track so the -50% translate loops seamlessly.
  const track = [...items, ...items];

  return (
    <div className="lp-marquee-wrap relative overflow-hidden py-2">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16"
        style={{ background: "linear-gradient(90deg, var(--shell-bg), transparent)" }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16"
        style={{ background: "linear-gradient(270deg, var(--shell-bg), transparent)" }}
      />
      <div className="lp-marquee flex w-max gap-3" style={{ ["--lp-marquee-dur" as string]: "46s" }}>
        {track.map((chip, i) => (
          <Link
            key={`${chip.id}-${i}`}
            href={chip.id.startsWith("s") ? "/" : `/market/${encodeURIComponent(chip.id)}`}
            className="flex items-center gap-3 rounded-[12px] border px-4 py-2.5 transition-colors"
            style={{ borderColor: "var(--line)", background: "var(--card)" }}
          >
            <span className="text-[16px]">{chip.emoji ?? "•"}</span>
            <span className="max-w-[240px] truncate text-[12.5px]" style={{ color: "var(--t2)" }}>
              {chip.title}
            </span>
            {typeof chip.yesProbability === "number" && (
              <span
                className="font-mono text-[12px] font-semibold tabular-nums"
                style={{ color: "var(--brand-primary)" }}
              >
                {Math.round(chip.yesProbability)}%
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
