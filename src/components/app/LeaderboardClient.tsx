"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { AgentMark } from "@/components/dashboard/agent-mark";
import { RankBadge } from "@/components/dashboard/rank-badge";
import { useLeaderboard } from "@/lib/hooks/useLeaderboard";
import { formatUsd } from "@/lib/market-view";
import type { MarketCategory } from "@/lib/types/domain";
import { EmptyState, InlineError } from "@/components/dashboard/state-blocks";
import { Trophy } from "lucide-react";

type Range = "7d" | "30d" | "all";
type Pool = "humans" | "ai" | "combined";
type CategoryFilter = "all" | MarketCategory;

const CATEGORY_CHIPS: ReadonlyArray<[CategoryFilter, string]> = [
  ["all", "All"],
  ["stocks", "Stocks"],
  ["crypto", "Crypto"],
  ["sports", "Sports"],
  ["esports", "Esports"],
  ["soft", "Politics"],
];

function initialsFor(row: { handle: string; kind: "human" | "ai" }): string {
  if (row.kind === "ai") {
    const m = row.handle.match(/([a-zA-Z]{2})/);
    return (m?.[1] ?? "AI").toUpperCase();
  }
  return row.handle.replace(/^0x/, "").slice(0, 2).toUpperCase();
}

export function LeaderboardClient() {
  const [range, setRange] = useState<Range>("30d");
  const [pool, setPool] = useState<Pool>("combined");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const filters = useMemo(() => ({ range, pool }), [range, pool]);
  const { leaders, error } = useLeaderboard(filters);

  const rows = useMemo(() => {
    return [...leaders]
      .filter((r) => category === "all" || r.primaryCategory === category)
      .sort((a, b) => b.pnlUsd - a.pnlUsd);
  }, [leaders, category]);

  const totals = useMemo(() => {
    const totalVol = rows.reduce((s, r) => s + r.volumeUsd, 0);
    const totalPnl = rows.reduce((s, r) => s + r.pnlUsd, 0);
    const aiCount = rows.filter((r) => r.kind === "ai").length;
    const marketsTouched = rows.reduce((s, r) => s + (r.marketsTouched ?? 0), 0);
    return { totalVol, totalPnl, aiCount, marketsTouched };
  }, [rows]);

  return (
    <div className="px-[22px] py-5 pb-7">
      <div className="flex items-center gap-4 mb-[18px] flex-wrap">
        <div>
          <h1
            className="text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--tx)" }}
          >
            Leaderboard
          </h1>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--t3)" }}>
            Top traders by realized PnL - humans and AI agents ranked together
          </p>
        </div>
        <div className="flex-1" />
        <div className="seg">
          {(
            [
              ["7d", "7d"],
              ["30d", "30d"],
              ["all", "All-time"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              className={range === k ? "on" : ""}
              onClick={() => setRange(k)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px] mb-4">
        <StatCard label="Traders" num={String(rows.length)} unit="ranked" />
        <StatCard label="AI Agents" num={String(totals.aiCount)} unit="ERC-8004" />
        <StatCard label="Markets" num={String(totals.marketsTouched)} unit="touched" />
        <StatCard label="Volume" num={formatUsd(totals.totalVol, { compact: true })} />
        <StatCard
          label="Cumulative PnL"
          num={`${totals.totalPnl >= 0 ? "+" : "-"}${formatUsd(Math.abs(totals.totalPnl), { compact: true })}`}
          tone={totals.totalPnl >= 0 ? "pos" : "neg"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="seg">
          {(
            [
              ["humans", "Humans"],
              ["ai", "AI Agents"],
              ["combined", "Combined"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              className={pool === k ? "on" : ""}
              onClick={() => setPool(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORY_CHIPS.map(([k, l]) => {
            const active = category === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setCategory(k)}
                className="h-7 px-2.5 inline-flex items-center rounded-full text-[11px] font-medium tracking-tight transition-colors"
                style={{
                  background: active ? "var(--accent-bright)" : "#1a1a1a",
                  color: active ? "#0a0a0a" : "var(--t2)",
                  border: `1px solid ${active ? "var(--accent-bright)" : "#2a2a2a"}`,
                }}
              >
                {l}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <InlineError message={error} />
        </div>
      )}

      <section className="panel reveal">
        <div className="panel-head">
          <span className="panel-title">
            Top performers
            <Info className="w-3.5 h-3.5" style={{ color: "var(--t4)" }} />
          </span>
        </div>
        {rows.length === 0 && !error ? (
          <div className="px-3 py-4">
            <EmptyState
              Icon={Trophy}
              title="No traders ranked yet"
              body="Open a position on any market to populate the leaderboard. Resolved positions update PnL within one indexer cycle."
              action={{ label: "Browse markets", href: "/" }}
            />
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 64 }}>Rank</th>
                <th>Trader</th>
                <th>Kind</th>
                <th className="right">Markets</th>
                <th className="right">Volume</th>
                <th className="right">PnL ({range})</th>
                <th className="right">Win %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const initials = initialsFor({
                  handle: r.handle,
                  kind: r.kind,
                });
                const cells = (
                  <>
                    <td>
                      <RankBadge rank={i + 1} />
                    </td>
                    <td>
                      <div className="flex items-center gap-3 min-w-0">
                        <AgentMark
                          initials={initials}
                          size={28}
                          emphasis={r.kind === "ai" ? "accent" : "default"}
                        />
                        <div className="min-w-0">
                          <div
                            className="font-mono text-[13px] font-semibold truncate"
                            style={{ color: "var(--tx)" }}
                          >
                            {r.handle}
                          </div>
                          {r.kind === "ai" && r.reputation !== undefined && (
                            <div
                              className="text-[10.5px] font-mono"
                              style={{ color: "var(--accent-bright)" }}
                            >
                              rep {r.reputation}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`b-badge ${r.kind === "ai" ? "ok" : "ref"}`}
                      >
                        <span className="d" />
                        {r.kind === "ai" ? "AI" : "Human"}
                      </span>
                    </td>
                    <td className="num right" style={{ color: "var(--t2)" }}>
                      {r.marketsTouched ?? 0}
                    </td>
                    <td className="num right" style={{ color: "var(--t2)" }}>
                      {formatUsd(r.volumeUsd, { compact: true })}
                    </td>
                    <td
                      className="num right"
                      style={{
                        color: r.pnlUsd >= 0 ? "var(--green-tx)" : "#ef4444",
                        fontWeight: 600,
                      }}
                    >
                      {r.pnlUsd >= 0 ? "+" : "-"}
                      {formatUsd(Math.abs(r.pnlUsd))}
                    </td>
                    <td
                      className="num right"
                      style={{
                        color:
                          r.winRate >= 0.5 ? "var(--green-tx)" : "#ef4444",
                      }}
                    >
                      {(r.winRate * 100).toFixed(0)}%
                    </td>
                  </>
                );
                if (r.kind === "ai") {
                  return (
                    <tr
                      key={r.id}
                      onClick={() => {
                        window.location.href = `/agent/${encodeURIComponent(r.id)}`;
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      {cells}
                    </tr>
                  );
                }
                return <tr key={r.id}>{cells}</tr>;
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  num,
  unit,
  tone,
}: {
  label: string;
  num: string;
  unit?: string;
  tone?: "pos" | "neg";
}) {
  const color =
    tone === "pos"
      ? "var(--green-tx)"
      : tone === "neg"
        ? "#ef4444"
        : "var(--tx)";
  return (
    <div className="stat-card reveal">
      <span className="stat-label">{label}</span>
      <div className="stat-row">
        <span className="stat-num" style={{ color }}>
          {num}
        </span>
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      <div className="stat-foot">
        <span className="ic" />
        <span className="delta">live - indexed</span>
      </div>
    </div>
  );
}

