import { TrendingDown, TrendingUp, User2 } from "lucide-react";
import type { ActivityEvent } from "@/lib/types/domain";

type Props = {
  events: ActivityEvent[];
  explorerBase?: string;
  emptyLabel?: string;
};

// Recent positions feed - parimutuel-native view of recent stakes into
// the pool. Intentionally NOT a CLOB "tape": each row is a position
// joining or leaving the pool, not a matched-execution print.
export function PositionsFeed({
  events,
  explorerBase = "https://sepolia.arbiscan.io/tx/",
  emptyLabel = "No positions yet. Be the first to open one.",
}: Props) {
  const positionEvents = events.filter(
    (e) => e.kind === "bet" || e.kind === "ai-lp",
  );

  return (
    <div className="panel" style={{ padding: 0, borderColor: "var(--line)" }}>
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: "var(--line-soft)" }}
      >
        <div
          className="text-[10.5px] font-mono uppercase tracking-[0.08em] font-semibold"
          style={{ color: "var(--t2)" }}
        >
          Recent positions
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: "var(--t3)" }}>
          Stakes joining the peer pool.
        </div>
      </div>

      {positionEvents.length === 0 ? (
        <div className="px-4 py-6 text-[12px]" style={{ color: "var(--t3)" }}>
          {emptyLabel}
        </div>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
          {positionEvents.slice(0, 12).map((event) => (
            <PositionRow
              key={event.id}
              event={event}
              explorerBase={explorerBase}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PositionRow({
  event,
  explorerBase,
}: {
  event: ActivityEvent;
  explorerBase: string;
}) {
  const isYes = event.side === "YES";
  const sideColor = isYes ? "var(--green-tx)" : "#ef4444";
  const Icon = isYes ? TrendingUp : TrendingDown;
  const actor = event.agentHandle ?? event.walletShort ?? "—";
  const amount =
    typeof event.amountUsd === "number"
      ? `$${event.amountUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : "—";

  return (
    <li className="px-4 py-2.5 flex items-center gap-3">
      <span
        className="inline-grid place-items-center w-7 h-7 rounded-[7px] flex-shrink-0"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid var(--line)",
          color: sideColor,
        }}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-[12.5px]">
          <span
            className="font-mono tabular-nums font-semibold"
            style={{ color: sideColor }}
          >
            {event.side ?? "—"}
          </span>
          <span
            className="font-mono tabular-nums"
            style={{ color: "var(--tx)" }}
          >
            {amount}
          </span>
          {event.kind === "ai-lp" && (
            <span
              className="b-badge ok"
              style={{ padding: "1px 6px", fontSize: 10 }}
            >
              <span className="d" />
              AI LP
            </span>
          )}
        </div>
        <div
          className="flex items-center gap-2 text-[10.5px] font-mono tabular-nums mt-0.5"
          style={{ color: "var(--t3)" }}
        >
          <User2 className="w-3 h-3" />
          <span>{actor}</span>
          <span>{formatRelative(event.atIso)}</span>
          {event.transactionHash && (
            <a
              href={`${explorerBase}${event.transactionHash}`}
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

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
