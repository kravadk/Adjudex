// Fixture adapter — synthetic match feed used when no provider token is
// configured. Reads services/api/fixtures/matches.sample.json (override
// with FIXTURE_MATCHES_PATH) so the full ingest → deploy → resolve
// pipeline can be demoed offline, with zero API keys or rate limits.
//
// startsInMinutes is relative to "now" at read time, so the feed always
// looks live across restarts. An optional deadlineInMinutes pins an
// explicit market close for the fast resolve demo.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EsportsGame } from "../importer";
import type {
  IngestMatch,
  MatchResult,
  MatchSource,
  MatchStatus,
  SportKind,
} from "./types";

type FixtureRow = {
  externalMatchId: string;
  category: "esports" | "sports";
  game?: EsportsGame;
  sport?: SportKind;
  teamA: string;
  teamB: string;
  tournament?: string;
  league?: string;
  startsInMinutes: number;
  deadlineInMinutes?: number;
  bestOfMaps?: number;
  streamUrl?: string;
  impliedYesProbability?: number;
  result?: {
    status?: MatchStatus;
    winner?: "teamA" | "teamB" | "draw" | null;
    scoreText?: string;
  } | null;
};

type FixtureFile = { matches?: FixtureRow[] };

function fixturePath(): string {
  const override = process.env.FIXTURE_MATCHES_PATH?.trim();
  if (override) return override;
  // Default sits next to the api package; cwd is the repo root in dev.
  return join(process.cwd(), "services", "api", "fixtures", "matches.sample.json");
}

function loadRows(): FixtureRow[] {
  const raw = readFileSync(fixturePath(), "utf8");
  const parsed = JSON.parse(raw) as FixtureFile;
  return Array.isArray(parsed.matches) ? parsed.matches : [];
}

function minutesFromNowIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function toIngestMatch(row: FixtureRow): IngestMatch {
  return {
    externalMatchId: row.externalMatchId,
    sourceKind: "fixture",
    category: row.category,
    game: row.game,
    sport: row.sport,
    teamA: row.teamA,
    teamB: row.teamB,
    tournament: row.tournament,
    league: row.league,
    matchStartsAtIso: minutesFromNowIso(row.startsInMinutes),
    bestOfMaps: row.bestOfMaps,
    streamUrl: row.streamUrl,
    sourceUrl: `https://adjudex.xyz/demo/match/${row.externalMatchId}`,
    closeAtIsoOverride:
      typeof row.deadlineInMinutes === "number"
        ? minutesFromNowIso(row.deadlineInMinutes)
        : undefined,
    impliedYesProbability:
      typeof row.impliedYesProbability === "number"
        ? row.impliedYesProbability
        : undefined,
  };
}

export function createFixtureSource(): MatchSource {
  return {
    kind: "fixture",
    async fetchUpcoming(): Promise<IngestMatch[]> {
      return loadRows().map(toIngestMatch);
    },
    async fetchResult(externalMatchId: string): Promise<MatchResult | null> {
      const row = loadRows().find((r) => r.externalMatchId === externalMatchId);
      const fetchedAtIso = new Date().toISOString();
      if (!row || !row.result) {
        return { status: "scheduled", winner: null, fetchedAtIso };
      }
      return {
        status: row.result.status ?? "finished",
        winner: row.result.winner ?? null,
        scoreText: row.result.scoreText,
        fetchedAtIso,
      };
    },
  };
}
