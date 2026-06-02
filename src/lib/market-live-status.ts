import type { Market, MarketStatus } from "@/lib/types/domain";

// Computed live-trading status, finer-grained than the on-chain
// `MarketStatus`. Pure helper - takes the market shape + a clock and
// returns a label. Used by market-card / market-detail to show
// "pre-match" / "live" / "closing" / "closed" badges in addition to
// the indexed status.
export type LiveTradingStatus =
  | "pre-match"
  | "live"
  | "closing" // < 15 minutes to deadline
  | "closing-very-soon" // < 60 seconds to deadline
  | "locked" // deadline passed but no resolution yet
  | "resolved";

export function liveTradingStatus(
  market: Pick<Market, "status" | "deadlineIso" | "matchStartsAtIso">,
  now: number = Date.now(),
): LiveTradingStatus {
  if (market.status === "resolved") return "resolved";
  const deadline = new Date(market.deadlineIso).getTime();
  if (!Number.isFinite(deadline)) return "pre-match";
  const startTs = market.matchStartsAtIso
    ? new Date(market.matchStartsAtIso).getTime()
    : null;

  if (now >= deadline) return "locked";
  const msLeft = deadline - now;
  if (msLeft < 60_000) return "closing-very-soon";
  if (msLeft < 15 * 60_000) return "closing";
  if (startTs !== null && Number.isFinite(startTs) && now >= startTs) {
    return "live";
  }
  return "pre-match";
}

// Map computed status to the on-chain MarketStatus enum it most closely
// represents. Used by code paths that need to feed back into existing
// status-based logic.
export function liveToBaseStatus(s: LiveTradingStatus): MarketStatus {
  switch (s) {
    case "pre-match":
    case "live":
    case "closing":
    case "closing-very-soon":
      return "open";
    case "locked":
      return "locked";
    case "resolved":
      return "resolved";
  }
}

// Whether bet submission should be allowed for this market.
export function canAcceptPosition(s: LiveTradingStatus): boolean {
  return s === "pre-match" || s === "live" || s === "closing";
}

// Sub-second hard cutoff before deadline where the UI should disable
// the bet button to avoid race conditions with the on-chain lock.
export const HARD_CUTOFF_MS = 5_000;
