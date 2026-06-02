import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { MarketTimelinePoint } from "@/lib/types/domain";
import {
  buildRepriceTriggers,
  formatProbabilityDelta,
  type RepriceTrigger,
} from "@/lib/reprice-triggers";

type Props = {
  timeline: MarketTimelinePoint[];
  explorerBase?: string;
  emptyLabel?: string;
};

// Reprice triggers feed - chronological view of every event that moved
// the implied probability of a market. Replaces a generic "recent activity"
// stream with a trader-facing "why did the price move" feed.
export function RepriceFeed({
  timeline,
  explorerBase = "https://sepolia.arbiscan.io/tx/",
  emptyLabel = "No reprice triggers yet. Place a bet or wait for the AI judge to propose a verdict.",
}: Props) {
  const triggers = buildRepriceTriggers(timeline);

  return (
    <div className="panel" style={{ padding: 0, borderColor: "var(--line)" }}>
      <div
        className="px-4 py-3 border-b"
        style={{
          borderColor: "var(--line-soft)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <div
          className="text-[10.5px] uppercase tracking-[0.08em] font-semibold"
          style={{ color: "var(--t2)" }}
        >
          Reprice triggers
        </div>
        <div
          className="text-[11px] mt-0.5"
          style={{ color: "var(--t3)" }}
        >
          Why the implied probability moved.
        </div>
      </div>

      {triggers.length === 0 ? (
        <div
          className="px-4 py-6 text-[12px]"
          style={{ color: "var(--t3)" }}
        >
          {emptyLabel}
        </div>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
          {triggers.map((t) => (
            <TriggerRow key={t.id} t={t} explorerBase={explorerBase} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TriggerRow({
  t,
  explorerBase,
}: {
  t: RepriceTrigger;
  explorerBase: string;
}) {
  const delta = t.probabilityDelta ?? 0;
  const deltaTone =
    Math.abs(delta) < 0.0001
      ? "neutral"
      : delta > 0
        ? "positive"
        : "negative";
  const deltaColor =
    deltaTone === "positive"
      ? "var(--green-tx)"
      : deltaTone === "negative"
        ? "#ef4444"
        : "var(--t3)";
  const Icon =
    deltaTone === "positive"
      ? ArrowUpRight
      : deltaTone === "negative"
        ? ArrowDownRight
        : Minus;

  return (
    <li
      className="px-4 py-3 flex items-start gap-3"
      style={{ borderColor: "var(--line-soft)" }}
    >
      <span
        className="inline-grid place-items-center w-7 h-7 rounded-[7px] flex-shrink-0 mt-0.5"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid var(--line)",
          color: deltaColor,
        }}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className="text-[13px] font-semibold tracking-tight"
            style={{ color: "var(--tx)" }}
          >
            {t.label}
          </span>
          <span
            className="text-[11px] font-mono tabular-nums"
            style={{ color: deltaColor }}
          >
            {formatProbabilityDelta(t.probabilityDelta)}
          </span>
        </div>
        <div
          className="text-[11.5px] leading-relaxed mt-0.5"
          style={{ color: "var(--t2)" }}
        >
          {t.description}
        </div>
        <div
          className="flex items-center gap-3 text-[10.5px] font-mono tabular-nums mt-1.5"
          style={{ color: "var(--t3)" }}
        >
          <span>yes {Math.round(t.probability * 100)}%</span>
          <span>vol {Math.round(t.volumeUsd).toLocaleString()}</span>
          <span>{formatRelativeTime(t.atIso)}</span>
          {t.transactionHash && (
            <a
              href={`${explorerBase}${t.transactionHash}`}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
              style={{ color: "var(--accent-bright)" }}
            >
              tx
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  if (!Number.isFinite(then)) return "—";
  const diff = Math.max(0, now - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
