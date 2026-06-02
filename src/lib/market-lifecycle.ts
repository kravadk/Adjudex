export type MarketLifecycle = "draft" | "open" | "locked" | "resolving" | "resolved" | "claimable" | "archived";

export function resolveMarketLifecycle(input: {
  status: string;
  deadlineIso?: string;
  resolvedOutcome?: string;
  nowMs?: number;
}): MarketLifecycle {
  if (input.status === "draft") return "draft";
  if (input.status === "archived") return "archived";
  if (input.status === "claimable") return "claimable";
  if (input.status === "resolved" || input.resolvedOutcome) return "resolved";
  if (input.status === "resolving") return "resolving";
  if (input.status === "locked") return "locked";

  if (input.deadlineIso) {
    const deadlineMs = new Date(input.deadlineIso).getTime();
    if (Number.isFinite(deadlineMs) && deadlineMs <= (input.nowMs ?? Date.now())) return "locked";
  }

  return "open";
}
