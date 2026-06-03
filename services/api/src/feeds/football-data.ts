// football-data.org adapter — football (soccer) fixtures + results.
//
// Free tier covers ~12 top competitions (PL, La Liga, Serie A, UCL, ...)
// with clean REST JSON. Auth is an X-Auth-Token header. Schedules and
// final scores are enough for binary "team A beats team B" markets.
//
// Docs: https://www.football-data.org/documentation/quickstart

import type { IngestMatch, MatchResult, MatchSource, MatchStatus } from "./types";

const BASE = "https://api.football-data.org/v4";

type FdTeam = { name?: string; shortName?: string; tla?: string };
type FdMatch = {
  id?: number;
  utcDate?: string;
  status?: string;
  competition?: { name?: string; code?: string };
  homeTeam?: FdTeam;
  awayTeam?: FdTeam;
  score?: { winner?: string | null; fullTime?: { home?: number | null; away?: number | null } };
};

function token(): string | null {
  const t = process.env.FOOTBALL_DATA_TOKEN?.trim();
  return t ? t : null;
}

async function getJson(path: string, params: Record<string, string>): Promise<unknown> {
  const t = token();
  if (!t) throw new Error("football_data_token_missing");
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { accept: "application/json", "X-Auth-Token": t },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`football_data_fetch_failed:${res.status}`);
  return res.json();
}

function teamName(t: FdTeam | undefined): string | undefined {
  return t?.name || t?.shortName || t?.tla || undefined;
}

function mapStatus(raw: string | undefined): MatchStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "FINISHED":
      return "finished";
    case "IN_PLAY":
    case "PAUSED":
      return "running";
    case "CANCELLED":
    case "POSTPONED":
    case "SUSPENDED":
      return "canceled";
    default:
      return "scheduled";
  }
}

function toIngestMatch(m: FdMatch): IngestMatch | null {
  const a = teamName(m.homeTeam);
  const b = teamName(m.awayTeam);
  if (!a || !b || !m.utcDate || m.id == null) return null;
  return {
    externalMatchId: String(m.id),
    sourceKind: "football-data",
    category: "sports",
    sport: "football",
    teamA: a,
    teamB: b,
    tournament: m.competition?.name,
    league: m.competition?.name,
    matchStartsAtIso: new Date(m.utcDate).toISOString(),
    sourceUrl: `https://www.football-data.org/match/${m.id}`,
  };
}

// Window helper: football-data filters by dateFrom/dateTo (yyyy-mm-dd).
function isoDate(offsetDays: number): string {
  const ms = Date.now() + offsetDays * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function createFootballDataSource(): MatchSource {
  return {
    kind: "football-data",
    async fetchUpcoming(): Promise<IngestMatch[]> {
      const data = (await getJson("/matches", {
        status: "SCHEDULED",
        dateFrom: isoDate(0),
        dateTo: isoDate(7),
      })) as { matches?: FdMatch[] };
      const rows = Array.isArray(data.matches) ? data.matches : [];
      return rows.map(toIngestMatch).filter((m): m is IngestMatch => m !== null);
    },
    async fetchResult(externalMatchId: string): Promise<MatchResult | null> {
      const data = (await getJson(`/matches/${externalMatchId}`, {})) as { match?: FdMatch } & FdMatch;
      const m = data.match ?? data;
      const status = mapStatus(m.status);
      const fetchedAtIso = new Date().toISOString();
      if (status === "canceled") return { status, winner: null, fetchedAtIso };
      if (status !== "finished") return { status, winner: null, fetchedAtIso };
      const w = m.score?.winner;
      let winner: MatchResult["winner"] = null;
      if (w === "HOME_TEAM") winner = "teamA";
      else if (w === "AWAY_TEAM") winner = "teamB";
      else if (w === "DRAW") winner = "draw";
      const h = m.score?.fullTime?.home;
      const aw = m.score?.fullTime?.away;
      const scoreText =
        typeof h === "number" && typeof aw === "number" ? `${h}-${aw}` : undefined;
      return { status, winner, scoreText, fetchedAtIso };
    },
  };
}
