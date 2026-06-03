// Shared contract for match data sources (esports + traditional sports).
//
// An adapter turns an external API (PandaScore, football-data.org) or a
// local fixture file into a normalized `IngestMatch`, and can look up the
// final result of a match by its external id. Everything downstream — the
// ingest worker, the market deployer, the resolve worker — speaks this
// shape only, so swapping or adding a provider never touches that code.

import type { EsportsGame } from "../importer";

export type MatchSourceKind = "pandascore" | "football-data" | "fixture";

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
  // Optional explicit market-close time. When a provider (or the fixture
  // feed) supplies it, the deployer uses it verbatim instead of deriving a
  // deadline from kickoff + duration. Lets the fixture demo close a market
  // a few minutes out so the resolve worker can be shown end-to-end.
  closeAtIsoOverride?: string;
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
