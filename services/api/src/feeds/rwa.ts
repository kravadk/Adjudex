// RWA / tokenized-stock match source — auto-deploys binary markets from the
// tokenized-stock catalogue used by the manual /api/import/rwa/scan endpoint.
// Each draft is mapped onto a generic "external" IngestMatch so the standard
// ingest worker deploys it server-side. Resolution is handled by the AI-judge
// path; fetchResult returns null so the deterministic resolve worker abstains.

import { buildRwaImportCandidates } from "../sponsor-integrations";
import type { IngestMatch, MatchResult, MatchSource } from "./types";

function rwaLimit(): number {
  const raw = Number(process.env.RWA_INGEST_MAX ?? "8");
  if (!Number.isFinite(raw)) return 8;
  return Math.max(1, Math.min(20, Math.floor(raw)));
}

export function createRwaMatchSource(): MatchSource {
  return {
    kind: "rwa",
    async fetchUpcoming(): Promise<IngestMatch[]> {
      const drafts = buildRwaImportCandidates(rwaLimit());
      return drafts
        .filter((d) => d.deadlineIso)
        .map((d) => ({
          externalMatchId: d.id,
          sourceKind: "rwa" as const,
          category: "external" as const,
          marketCategory: "stocks" as const,
          emoji: "📈",
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
    async fetchResult(): Promise<MatchResult | null> {
      return null;
    },
  };
}
