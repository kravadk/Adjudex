"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Clock, Lock } from "lucide-react";
import { liveTradingStatus, type LiveTradingStatus } from "@/lib/market-live-status";
import type { Market } from "@/lib/types/domain";

type Props = {
  market: Pick<Market, "status" | "deadlineIso" | "matchStartsAtIso">;
  size?: "sm" | "md";
};

// Reactive live status badge - re-evaluates every second so the chip
// rolls through pre-match -> live -> closing -> closing-very-soon -> locked
// without a page reload.
export function LiveStatusBadge({ market, size = "sm" }: Props) {
  const [status, setStatus] = useState<LiveTradingStatus>(() =>
    liveTradingStatus(market),
  );

  useEffect(() => {
    const tick = () => setStatus(liveTradingStatus(market));
    const interval = setInterval(tick, 1000);
    tick();
    return () => clearInterval(interval);
  }, [market]);

  const visual = visualForStatus(status);
  const padding = size === "sm" ? "1px 7px 1px 6px" : "3px 9px 3px 8px";
  const fontSize = size === "sm" ? 10.5 : 11.5;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full font-mono tabular-nums"
      style={{
        background: visual.bg,
        border: `1px solid ${visual.border}`,
        color: visual.color,
        padding,
        fontSize,
        whiteSpace: "nowrap",
        letterSpacing: "0.04em",
      }}
    >
      <visual.Icon className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
      {visual.label}
    </span>
  );
}

type Visual = {
  label: string;
  Icon: typeof Circle;
  color: string;
  bg: string;
  border: string;
};

function visualForStatus(status: LiveTradingStatus): Visual {
  switch (status) {
    case "live":
      return {
        label: "LIVE",
        Icon: Circle,
        color: "#ef4444",
        bg: "rgba(239,68,68,0.10)",
        border: "rgba(239,68,68,0.40)",
      };
    case "closing-very-soon":
      return {
        label: "T-60s",
        Icon: Clock,
        color: "#ef4444",
        bg: "rgba(239,68,68,0.10)",
        border: "rgba(239,68,68,0.50)",
      };
    case "closing":
      return {
        label: "CLOSING",
        Icon: Clock,
        color: "var(--amber-tx)",
        bg: "var(--amber-bg)",
        border: "rgba(240,150,30,0.40)",
      };
    case "locked":
      return {
        label: "LOCKED",
        Icon: Lock,
        color: "var(--t3)",
        bg: "var(--gray-bg)",
        border: "rgba(150,145,140,0.30)",
      };
    case "resolved":
      return {
        label: "RESOLVED",
        Icon: CheckCircle2,
        color: "var(--green-tx)",
        bg: "var(--green-bg)",
        border: "rgba(63,140,108,0.40)",
      };
    case "pre-match":
    default:
      return {
        label: "PRE",
        Icon: Circle,
        color: "var(--accent-bright)",
        bg: "rgba(40,160,240,0.08)",
        border: "rgba(40,160,240,0.30)",
      };
  }
}
