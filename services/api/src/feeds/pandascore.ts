// PandaScore adapter — CS2 + Dota2 schedules and results.
//
// Free "Schedules, Results & Context" plan covers what we need: upcoming
// matches (to spawn markets) and finished-match winners (to resolve). It
// is NOT an odds feed and its free tier forbids betting use. Use a paid
// plan or different source before real-money production. See docs/SECRETS.md.
//
// Docs: https://developers.pandascore.co/reference

import type { EsportsGame } from "../importer";
import type { IngestMatch, MatchResult, MatchSource, MatchStatus } from "./types";

const BASE = "https://api.pandascore.co";

// PandaScore game slug per Adjudex game. Only the two we focus on.
const GAME_PATH: Partial<Record<EsportsGame, string>> = {
  cs2: "csgo",
  dota2: "dota2",
  lol: "lol",
  valorant: "valorant",
  r6: "r6siege",
  overwatch: "ow",
  "rocket-league": "rl",
};

type PandaOpponent = { opponent?: { id?: number; name?: string; acronym?: string } };
type PandaMatch = {
  id?: number;
  name?: string;
  status?: string;
  begin_at?: string;
  scheduled_at?: string;
  number_of_games?: number;
  winner_id?: number | null;
  opponents?: PandaOpponent[];
  videogame?: { slug?: string };
  league?: { name?: string };
  serie?: { full_name?: string; name?: string };
  streams_list?: Array<{ embed_url?: string; raw_url?: string; main?: boolean }>;
  results?: Array<{ team_id?: number; score?: number }>;
};

function token(): string | null {
  const t = process.env.PANDASCORE_TOKEN?.trim();
  return t ? t : null;
}

async function getJson(path: string, params: Record<string, string>): Promise<unknown> {
  const t = token();
  if (!t) throw new Error("pandascore_token_missing");
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("token", t);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`pandascore_fetch_failed:${res.status}`);
  return res.json();
}

function opponentNames(m: PandaMatch): { aId?: number; bId?: number; a?: string; b?: string } {
  const ops = Array.isArray(m.opponents) ? m.opponents : [];
  const a = ops[0]?.opponent;
  const b = ops[1]?.opponent;
  return {
    aId: a?.id,
    bId: b?.id,
    a: a?.name || a?.acronym,
    b: b?.name || b?.acronym,
  };
}

function mapStatus(raw: string | undefined): MatchStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "finished":
      return "finished";
    case "running":
      return "running";
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      return "scheduled";
  }
}

function toIngestMatch(game: EsportsGame, m: PandaMatch): IngestMatch | null {
  const { a, b } = opponentNames(m);
  const startsAt = m.begin_at || m.scheduled_at;
  if (!a || !b || !startsAt || m.id == null) return null;
  const tournament =
    [m.league?.name, m.serie?.full_name || m.serie?.name].filter(Boolean).join(" · ") || undefined;
  const stream = (m.streams_list ?? []).find((s) => s.main) ?? (m.streams_list ?? [])[0];
  return {
    externalMatchId: String(m.id),
    sourceKind: "pandascore",
    category: "esports",
    game,
    teamA: a,
    teamB: b,
    tournament,
    matchStartsAtIso: new Date(startsAt).toISOString(),
    bestOfMaps:
      typeof m.number_of_games === "number" && m.number_of_games > 0
        ? Math.floor(m.number_of_games)
        : undefined,
    streamUrl: stream?.embed_url || stream?.raw_url || undefined,
    sourceUrl: `https://www.pandascore.co/matches/${m.id}`,
  };
}

export function createPandaScoreSource(games: EsportsGame[]): MatchSource {
  const targets = games.filter((g) => GAME_PATH[g]);
  return {
    kind: "pandascore",
    async fetchUpcoming(): Promise<IngestMatch[]> {
      const out: IngestMatch[] = [];
      for (const game of targets) {
        const path = `/${GAME_PATH[game]}/matches/upcoming`;
        const rows = (await getJson(path, { per_page: "25", sort: "begin_at" })) as PandaMatch[];
        for (const row of Array.isArray(rows) ? rows : []) {
          const match = toIngestMatch(game, row);
          if (match) out.push(match);
        }
      }
      return out;
    },
    async fetchResult(externalMatchId: string): Promise<MatchResult | null> {
      const m = (await getJson(`/matches/${externalMatchId}`, {})) as PandaMatch;
      const status = mapStatus(m.status);
      const fetchedAtIso = new Date().toISOString();
      if (status === "canceled") {
        return { status, winner: null, fetchedAtIso };
      }
      if (status !== "finished" || m.winner_id == null) {
        return { status, winner: null, fetchedAtIso };
      }
      const { aId, bId } = opponentNames(m);
      let winner: MatchResult["winner"] = null;
      if (m.winner_id === aId) winner = "teamA";
      else if (m.winner_id === bId) winner = "teamB";
      const scoreText = (m.results ?? [])
        .map((r) => r.score)
        .filter((s): s is number => typeof s === "number")
        .join("-");
      return { status, winner, scoreText: scoreText || undefined, fetchedAtIso };
    },
  };
}
