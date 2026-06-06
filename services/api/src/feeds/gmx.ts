// GMX match source — auto-deploys binary markets from live GMX market
// metadata (liquidity / open-interest style questions). Reuses the candidate
// builder used by the manual /api/import/gmx/scan endpoint, then maps each
// draft onto a generic "external" IngestMatch so the standard ingest worker
// deploys it server-side (no admin review step). Resolution is left to the
// AI-judge path (oracleType "zktls-ai-oracle"); fetchResult returns null so
// the deterministic resolve worker does not propose an outcome.

import { buildGmxImportCandidates } from "../sponsor-integrations";
import type { IngestMatch, MatchResult, MatchSource } from "./types";

function gmxLimit(): number {
  const raw = Number(process.env.GMX_INGEST_MAX ?? "8");
  if (!Number.isFinite(raw)) return 8;
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

export function createGmxMatchSource(): MatchSource {
  return {
    kind: "gmx",
    async fetchUpcoming(): Promise<IngestMatch[]> {
      const drafts = await buildGmxImportCandidates(gmxLimit());
      return drafts
        .filter((d) => d.deadlineIso)
        .map((d) => ({
          externalMatchId: d.id,
          sourceKind: "gmx" as const,
          category: "external" as const,
          marketCategory: "crypto" as const,
          emoji: "🪙",
          titleOverride: d.title,
          questionOverride: d.question,
          descriptionOverride: d.description,
          resolutionCriteriaOverride: d.resolutionCriteria,
          teamA: "Yes",
          teamB: "No",
          matchStartsAtIso: new Date().toISOString(),
          closeAtIsoOverride: d.deadlineIso,
          sourceUrl: d.sourceUrl,
        }));
    },
    // Price/liquidity questions resolve through the AI judge, not a feed result.
    async fetchResult(): Promise<MatchResult | null> {
      return null;
    },
  };
}
