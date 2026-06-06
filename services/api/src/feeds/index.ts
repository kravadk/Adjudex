// Feed registry. Decides which match sources are active from env, and
// resolves a single source by kind so the resolve worker can fetch a
// result for a market whose origin was recorded at ingest time.
//
// Selection rules:
//   - PANDASCORE_TOKEN set      -> PandaScore (CS2 + Dota2)
//   - FOOTBALL_DATA_TOKEN set   -> football-data.org (football)
//   - neither set               -> no active source; pipeline fails closed

import type { EsportsGame } from "../importer";
import { createFootballDataSource } from "./football-data";
import { createPandaScoreSource } from "./pandascore";
import { createPolymarketSource } from "./polymarket";
import type { MatchSource, MatchSourceKind } from "./types";

function pandaGames(): EsportsGame[] {
  const raw = process.env.PANDASCORE_GAMES?.trim();
  if (!raw) return ["cs2", "dota2"];
  const allowed: EsportsGame[] = ["cs2", "dota2", "lol", "valorant", "r6", "overwatch", "rocket-league"];
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

function hasPolymarket(): boolean {
  return process.env.POLYMARKET_INGEST_ENABLED === "1";
}

// Active sources for the ingest worker to scan this tick.
export function getActiveMatchSources(): MatchSource[] {
  const sources: MatchSource[] = [];
  if (hasPanda()) sources.push(createPandaScoreSource(pandaGames()));
  if (hasFootball()) sources.push(createFootballDataSource());
  if (hasPolymarket()) sources.push(createPolymarketSource());
  return sources;
}

// Resolve a single source by its recorded kind (for the resolve worker).
export function getMatchSourceByKind(kind: MatchSourceKind): MatchSource | null {
  switch (kind) {
    case "pandascore":
      return hasPanda() ? createPandaScoreSource(pandaGames()) : null;
    case "football-data":
      return hasFootball() ? createFootballDataSource() : null;
    case "polymarket":
      // Result lookup is stateless (no token), so resolve mirrored markets
      // even if new Polymarket ingest was later disabled.
      return createPolymarketSource();
    default:
      return null;
  }
}

export type { IngestMatch, MatchResult, MatchSource, MatchSourceKind } from "./types";
