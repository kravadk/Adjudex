import type { MarketTimelinePoint } from "@/lib/types/domain";

// "Reprice triggers" turn raw market_timeline rows into a human-readable
// chronological feed of why the implied probability moved. The indexer
// writes one row per BetPlaced / MarketResolved / Proposed / Finalized
// / Claimed / Refunded / Snapshot - this helper classifies each row and
// labels it for the trader-facing feed.
//
// Pure / synchronous. No data fetching. UI calls it on already-loaded
// timeline points.

export type RepriceKind =
  | "bet-placed"
  | "judge-proposed"
  | "judge-finalized"
  | "judge-challenged"
  | "claim"
  | "refund"
  | "snapshot"
  | "other";

export type RepriceTrigger = {
  id: string;
  kind: RepriceKind;
  label: string;
  description: string;
  probability: number;
  probabilityDelta: number | null;
  volumeUsd: number;
  atIso: string;
  transactionHash?: string;
};

const KIND_TO_LABEL: Record<RepriceKind, { label: string; description: string }> = {
  "bet-placed": {
    label: "Bet placed",
    description: "Pool shifted by a new position",
  },
  "judge-proposed": {
    label: "Judge verdict proposed",
    description: "Optimistic resolution started · 2h challenge window open",
  },
  "judge-challenged": {
    label: "Challenge raised",
    description: "Proposal disputed · owner must override or void",
  },
  "judge-finalized": {
    label: "Judge verdict finalized",
    description: "Challenge window closed · claims unlocked",
  },
  claim: {
    label: "Claim",
    description: "Winning position withdrew from the pool",
  },
  refund: {
    label: "Refund",
    description: "Pre-resolution refund after grace window",
  },
  snapshot: {
    label: "Snapshot",
    description: "Periodic pool state capture",
  },
  other: {
    label: "Event",
    description: "Indexed market event",
  },
};

function classify(eventKind: string): RepriceKind {
  const k = eventKind.toLowerCase();
  if (k === "bet" || k === "betplaced") return "bet-placed";
  if (k === "proposed" || k === "propose") return "judge-proposed";
  if (k === "challenged" || k === "challenge") return "judge-challenged";
  if (k === "finalized" || k === "finalize" || k === "marketresolved" || k === "resolved") {
    return "judge-finalized";
  }
  if (k === "claim" || k === "claimed") return "claim";
  if (k === "refund" || k === "refunded") return "refund";
  if (k === "snapshot") return "snapshot";
  return "other";
}

export function buildRepriceTriggers(
  points: MarketTimelinePoint[],
): RepriceTrigger[] {
  if (points.length === 0) return [];
  // Sort ascending by time so the delta vs previous probability is correct,
  // then reverse for newest-first rendering.
  const ascending = [...points].sort(
    (a, b) => new Date(a.atIso).getTime() - new Date(b.atIso).getTime(),
  );
  const out: RepriceTrigger[] = [];
  for (let i = 0; i < ascending.length; i++) {
    const point = ascending[i];
    const previous = i > 0 ? ascending[i - 1] : null;
    const kind = classify(point.eventKind);
    const labels = KIND_TO_LABEL[kind];
    const delta =
      previous && Number.isFinite(previous.yesProbability)
        ? point.yesProbability - previous.yesProbability
        : null;
    out.push({
      id: point.id,
      kind,
      label: labels.label,
      description: labels.description,
      probability: point.yesProbability,
      probabilityDelta: delta,
      volumeUsd: point.volumeUsd,
      atIso: point.atIso,
      transactionHash: point.transactionHash,
    });
  }
  return out.reverse();
}

export function formatProbabilityDelta(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return "—";
  const pct = delta * 100;
  if (Math.abs(pct) < 0.01) return "±0.00 pp";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)} pp`;
}
