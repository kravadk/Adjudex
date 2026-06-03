// Feed registry. Decides which match sources are active from env, and
// resolves a single source by kind so the resolve worker can fetch a
// result for a market whose origin was recorded at ingest time.
//
// Selection rules:
//   - PANDASCORE_TOKEN set      -> PandaScore (CS2 + Dota2)
//   - FOOTBALL_DATA_TOKEN set   -> football-data.org (football)
//   - neither, or MATCH_FIXTURE_MODE=1 -> fixture fallback
// The fixture source is always available by kind so a market deployed
// from fixtures can still be resolved even if a real token is added later.

import type { EsportsGame } from "../importer";
import { createFootballDataSource } from "./football-data";
import { createFixtureSource } from "./fixture-fallback";
import { createPandaScoreSource } from "./pandascore";
import type { MatchSource, MatchSourceKind } from "./types";

function pandaGames(): EsportsGame[] {
  const raw = process.env.PANDASCORE_GAMES?.trim();
  if (!raw) return ["cs2", "dota2"];
  const allowed: EsportsGame[] = ["cs2", "dota2"];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is EsportsGame => (allowed as string[]).includes(s));
}

function hasPanda(): boolean {
  return Boolean(process.env.PANDASCORE_TOKEN?.trim());
}

function hasFootball(): boolean {
  return Boolean(process.env.FOOTBALL_DATA_TOKEN?.trim());
}

function fixtureForced(): boolean {
  return process.env.MATCH_FIXTURE_MODE === "1";
}

// Active sources for the ingest worker to scan this tick.
export function getActiveMatchSources(): MatchSource[] {
  if (fixtureForced()) return [createFixtureSource()];

  const sources: MatchSource[] = [];
  if (hasPanda()) sources.push(createPandaScoreSource(pandaGames()));
  if (hasFootball()) sources.push(createFootballDataSource());

  // No real provider configured -> fall back to the offline demo feed so
  // the pipeline is never a no-op in local / hackathon environments.
  if (sources.length === 0) return [createFixtureSource()];
  return sources;
}

// Resolve a single source by its recorded kind (for the resolve worker).
export function getMatchSourceByKind(kind: MatchSourceKind): MatchSource | null {
  switch (kind) {
    case "pandascore":
      return hasPanda() ? createPandaScoreSource(pandaGames()) : null;
    case "football-data":
      return hasFootball() ? createFootballDataSource() : null;
    case "fixture":
      return createFixtureSource();
    default:
      return null;
  }
}

export type { IngestMatch, MatchResult, MatchSource, MatchSourceKind } from "./types";
