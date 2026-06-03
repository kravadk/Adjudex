"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { CountUp } from "./CountUp";

type ChainRow = { markets: number; volumeUsd: number; bettors: number; resolvedMarkets: number };
type Totals = { markets: number; volumeUsd: number; bettors: number; resolvedMarkets: number };

export function StatsBand() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch("/api/analytics/chains", { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error("bad status");
        const data = (await res.json()) as { rows?: ChainRow[] };
        const rows = data.rows ?? [];
        const sum = rows.reduce<Totals>(
          (acc, r) => ({
            markets: acc.markets + (r.markets ?? 0),
            volumeUsd: acc.volumeUsd + (r.volumeUsd ?? 0),
            bettors: acc.bettors + (r.bettors ?? 0),
            resolvedMarkets: acc.resolvedMarkets + (r.resolvedMarkets ?? 0),
          }),
          { markets: 0, volumeUsd: 0, bettors: 0, resolvedMarkets: 0 },
        );
        if (!controller.signal.aborted) setTotals(sum);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const items: { label: string; value: number | null; fmt: (n: number) => string }[] = [
    { label: "Markets", value: totals?.markets ?? null, fmt: (n) => Math.round(n).toLocaleString("en-US") },
    { label: "Volume", value: totals?.volumeUsd ?? null, fmt: formatUsd },
    { label: "Bettors", value: totals?.bettors ?? null, fmt: (n) => Math.round(n).toLocaleString("en-US") },
    { label: "Resolved", value: totals?.resolvedMarkets ?? null, fmt: (n) => Math.round(n).toLocaleString("en-US") },
  ];

  return (
    <section className="mx-auto max-w-[1180px] px-5 py-16">
      <div
        className="rounded-[20px] border p-8"
        style={{ borderColor: "var(--line)", background: "linear-gradient(180deg, var(--card), #0f0f0f)" }}
      >
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="caps mb-1">On-chain traction</div>
            <h2 className="text-[22px] font-semibold tracking-[-0.01em]" style={{ color: "var(--tx)" }}>
              Real numbers, across every chain.
            </h2>
          </div>
          <Link
            href="/analytics/sponsors"
            className="inline-flex items-center gap-1.5 text-[13px]"
            style={{ color: "var(--accent-bright)" }}
          >
            Proof of traction <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {items.map((it) => (
            <div key={it.label}>
              <div className="caps mb-2">{it.label}</div>
              <div className="font-mono text-[28px] font-semibold tabular-nums" style={{ color: "var(--tx)" }}>
                {it.value === null ? (
                  <span style={{ color: "var(--t4)" }}>{failed ? "—" : "…"}</span>
                ) : (
                  <CountUp value={it.value} format={it.fmt} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatUsd(value: number): string {
  if (!value || value <= 0) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
