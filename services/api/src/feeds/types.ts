// Shared contract for real match data sources (esports + traditional sports).
// Providers normalize external schedules/results into this shape so ingest,
// deployment, and resolution do not depend on provider-specific payloads.

import type { EsportsGame } from "../importer";

export type MatchSourceKind = "pandascore" | "football-data";

export type SportKind = "football" | "basketball" | "tennis" | "other";

// A scheduled match normalized to the fields a binary YES/NO market needs.
// YES is defined as "teamA wins" by convention (see matchQuestion()).
export type IngestMatch = {
  // Stable per-provider id. Used both as the dedupe key (so the same match
  // never spawns two markets) and as the handle for result lookup.
  externalMatchId: string;
  sourceKind: MatchSourceKind;
  category: "esports" | "sports";
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
  // Upcoming + recently-started matches that should become markets.
  fetchUpcoming(): Promise<IngestMatch[]>;
  // Final result for one match, or null if not yet decided / not found.
  fetchResult(externalMatchId: string): Promise<MatchResult | null>;
}
