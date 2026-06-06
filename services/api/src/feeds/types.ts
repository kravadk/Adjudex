// Shared contract for real match data sources (esports + traditional sports).
// Providers normalize external schedules/results into this shape so ingest,
// deployment, and resolution do not depend on provider-specific payloads.

import type { EsportsGame } from "../importer";

export type MatchSourceKind = "pandascore" | "football-data" | "polymarket" | "gmx" | "rwa";

export type SportKind = "football" | "basketball" | "tennis" | "other";

// Market category as stored on the `markets` row. Mirrors the frontend
// MarketCategory union (src/lib/types/domain.ts). Generic mirror sources
// (Polymarket) map their tags onto these so UI filter chips keep working.
export type MarketCategorySlug = "stocks" | "crypto" | "sports" | "esports" | "soft";

// A scheduled match normalized to the fields a binary YES/NO market needs.
// YES is defined as "teamA wins" by convention (see matchQuestion()).
export type IngestMatch = {
  // Stable per-provider id. Used both as the dedupe key (so the same match
  // never spawns two markets) and as the handle for result lookup.
  externalMatchId: string;
  sourceKind: MatchSourceKind;
  category: "esports" | "sports" | "external";
  // DB category for the `markets` row. When set (generic mirror sources),
  // the deployer stores this instead of `category` so UI filter chips and
  // the MarketCategory type stay valid. Sports/esports leave it unset.
  marketCategory?: MarketCategorySlug;
  // Verbatim market copy for generic sources whose question is NOT a
  // "teamA beats teamB" match. When `questionOverride` is set, matchQuestion()
  // uses these instead of synthesizing from teamA/teamB.
  titleOverride?: string;
  questionOverride?: string;
  descriptionOverride?: string;
  resolutionCriteriaOverride?: string;
  // Optional explicit emoji (mirror sources pick by mapped category).
  emoji?: string;
  // Exactly one of game / sport is set depending on category.
  game?: EsportsGame;
  sport?: SportKind;
  teamA: string;
  teamB: string;
  tournament?: string;
  league?: string;
  matchStartsAtIso: string;
  bestOfMaps?: number;
  streamUrl?: string;
  sourceUrl: string;
  // Optional explicit market-close time. When a provider supplies it, the
  // deployer uses it verbatim instead of deriving a deadline from kickoff +
  // duration.
  closeAtIsoOverride?: string;
  // Optional implied probability that teamA (YES) wins, in [0,1]. Providers
  // may expose it for analytics/import ranking; deploy-time pool state still
  // comes only from the contract and indexed user transactions.
  impliedYesProbability?: number;
};

export type MatchStatus = "scheduled" | "running" | "finished" | "canceled";

// Resolution outcome from the provider. `winner` is expressed relative to
// the IngestMatch teamA/teamB so the resolve worker can map it to the
// pool's YES/NO side without re-deriving team identity.
export type MatchResult = {
  status: MatchStatus;
  winner: "teamA" | "teamB" | "draw" | null;
  scoreText?: string;
  fetchedAtIso: string;
};

export interface MatchSource {
  readonly kind: MatchSourceKind;
  // When true, fetchResult() mirrors a third-party prediction market's
  // outcome rather than a deterministic official result. The resolve worker
  // runs an independent AI-judge cross-check before proposing such markets
  // and escalates on a clear discrepancy (hybrid resolution). Deterministic
  // sports/esports feeds leave this unset.
  readonly mirrorsExternalMarket?: boolean;
  // Upcoming + recently-started matches that should become markets.
  fetchUpcoming(): Promise<IngestMatch[]>;
  // Final result for one match, or null if not yet decided / not found.
  fetchResult(externalMatchId: string): Promise<MatchResult | null>;
}
