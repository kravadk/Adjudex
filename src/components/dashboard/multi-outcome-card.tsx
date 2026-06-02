"use client";

import Link from "next/link";
import { Clock } from "lucide-react";
import type { MarketView } from "@/lib/market-view";
import { LiveStatusBadge } from "./live-status-badge";

// Multi-outcome card (foresee.lol style). Renders a parent moneyline
// market header + a row per child sub-market with Yes/No buttons.
// Used when a parent has at least one child referenced by parentMarketId.
//
// Each child row is independently bettable — clicking Yes / No opens the
// child market's detail page. Probabilities come from the child's own
// yesProbability (NOT the parent's).

function formatVolume(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}

function formatDeadline(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function MultiOutcomeCard({
  parent,
  outcomes,
}: {
  parent: MarketView;
  outcomes: MarketView[];
}) {
  // Sort outcomes by yesProbability DESC so the most likely option is on top
  const rows = [...outcomes]
    .sort((a, b) => (b.yesPct ?? 0) - (a.yesPct ?? 0))
    .slice(0, 5);

  const totalVolume = rows.reduce((s, r) => s + (r.volume ?? 0), parent.volume ?? 0);

  return (
    <div
      className="rounded-[16px] overflow-hidden flex flex-col transition-colors"
      style={{
        background: "var(--panel-bg)",
        border: "1px solid var(--line-soft)",
      }}
    >
      {/* Header */}
      <Link
        href={`/market/${encodeURIComponent(parent.id)}`}
        className="flex items-start gap-3 px-4 pt-4 pb-3"
      >
        <span
          className="grid place-items-center w-10 h-10 rounded-full text-[15px] font-bold flex-shrink-0"
          style={{
            background: "var(--card-inner)",
            color: "var(--accent-bright)",
          }}
        >
          {parent.ticker?.slice(0, 1) || "Π"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10.5px]" style={{ color: "var(--t3)" }}>
              {parent.category}
            </span>
            <LiveStatusBadge
              market={{
                status:
                  parent.lifecycle === "resolved"
                    ? "resolved"
                    : parent.lifecycle === "locked"
                      ? "locked"
                      : "open",
                deadlineIso: parent.deadlineIso,
                matchStartsAtIso: parent.matchStartsAtIso,
              }}
            />
          </div>
          <h3
            className="text-[17px] leading-tight"
            style={{
              color: "var(--tx)",
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            {parent.title}
          </h3>
          <div className="text-[11.5px] mt-1 font-medium" style={{ color: "var(--t3)" }}>
            Total market {outcomes.length}
          </div>
        </div>
      </Link>

      {/* Outcome rows */}
      <div className="px-2 pb-1">
        {rows.map((row) => {
          const pct = Math.round((row.yesPct ?? 0) * 100);
          const optionLabel =
            row.title
              .replace(parent.title, "")
              .replace(/^[\s\-–—:?,]+/, "")
              .trim() || row.title;
          return (
            <div
              key={row.id}
              className="flex items-center gap-2.5 px-2 py-2.5 rounded-[10px] transition-colors hover:bg-white/[0.02]"
            >
              <span
                className="flex-1 min-w-0 text-[14.5px] truncate"
                style={{ color: "var(--tx)", fontWeight: 600 }}
              >
                {optionLabel}
              </span>
              <span
                className="text-[14.5px] font-mono tabular-nums min-w-[48px] text-right"
                style={{ color: "var(--tx)", fontWeight: 800 }}
              >
                {pct}%
              </span>
              <Link
                href={`/market/${encodeURIComponent(row.id)}?side=YES`}
                className="inline-flex h-8 items-center justify-center px-3.5 rounded-md text-[12.5px] transition-transform active:scale-95"
                style={{
                  background: "var(--yes-bg)",
                  color: "var(--yes-tx)",
                  fontWeight: 800,
                  letterSpacing: "-0.005em",
                }}
              >
                Yes
              </Link>
              <Link
                href={`/market/${encodeURIComponent(row.id)}?side=NO`}
                className="inline-flex h-8 items-center justify-center px-3.5 rounded-md text-[12.5px] transition-transform active:scale-95"
                style={{
                  background: "var(--no-bg)",
                  color: "var(--no-tx)",
                  fontWeight: 800,
                  letterSpacing: "-0.005em",
                }}
              >
                No
              </Link>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between gap-3 mx-3 mb-3 mt-1 px-3 py-2.5 rounded-[8px] text-[11.5px]"
        style={{
          background: "var(--shell-bg)",
          color: "var(--t2)",
        }}
      >
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Clock className="w-3 h-3" />
          {formatDeadline(parent.deadlineIso)}
        </span>
        <span className="font-mono tabular-nums font-bold">
          {formatVolume(totalVolume)} Vol
        </span>
      </div>
    </div>
  );
}
