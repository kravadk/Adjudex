// Turns a normalized IngestMatch into the binary market spec fields:
// the YES/NO question, the resolution criteria, and a derived deadline.
//
// Convention: YES = teamA wins. The resolve worker maps the provider's
// winner back to YES/NO using the same teamA/teamB identity carried on
// the match, so the wording here and the settlement there never drift.

import type { IngestMatch } from "./types";

// Rough match durations used to push the betting deadline to "results are
// knowable" rather than "match kicks off". Tuned per format, then padded
// by RESULT_BUFFER_SEC so a late official result still lands before close.
const ESPORTS_BO_BASE_SEC = 45 * 60; // a single map / game, ballpark
const FOOTBALL_DURATION_SEC = 2 * 60 * 60 + 30 * 60; // 90' + stoppage + half-time + pad
const DEFAULT_RESULT_BUFFER_SEC = 2 * 60 * 60;

export function resultBufferSec(): number {
  const raw = Number(process.env.RESULT_BUFFER_SEC);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RESULT_BUFFER_SEC;
}

// Estimated wall-clock from kickoff to a final, publishable result.
export function inferMatchDurationSec(match: IngestMatch): number {
  if (match.category === "sports") {
    return FOOTBALL_DURATION_SEC;
  }
  // Esports: best-of N maps. Assume ~half the maps are actually played on
  // average (a 2-0 sweep in a bo3), floored at one map.
  const bo = match.bestOfMaps && match.bestOfMaps > 0 ? match.bestOfMaps : 3;
  const expectedMaps = Math.max(1, Math.ceil(bo / 2) + 1);
  return expectedMaps * ESPORTS_BO_BASE_SEC;
}

// Deadline = kickoff + expected duration + result-publication buffer.
export function deadlineForMatch(match: IngestMatch): string | null {
  const start = new Date(match.matchStartsAtIso).getTime();
  if (Number.isNaN(start)) return null;
  const close = start + (inferMatchDurationSec(match) + resultBufferSec()) * 1000;
  return new Date(close).toISOString();
}

export type MatchMarketSpec = {
  title: string;
  question: string;
  description: string;
  resolutionCriteria: string;
  deadlineIso: string | null;
};

export function matchQuestion(match: IngestMatch): MatchMarketSpec {
  const context = match.tournament || match.league;
  const venue = context ? ` in ${context}` : "";
  const seriesFormat =
    match.category === "esports" && match.bestOfMaps && match.bestOfMaps > 1
      ? `best-of-${match.bestOfMaps} series`
      : "match";

  const title = context
    ? `${match.teamA} vs ${match.teamB} · ${context}`
    : `${match.teamA} vs ${match.teamB}`;

  const question = `Will ${match.teamA} beat ${match.teamB}${venue}?`;

  const description =
    `Binary market on the ${match.teamA} vs ${match.teamB} ${seriesFormat}` +
    `${venue}. YES resolves if ${match.teamA} is the official winner; NO if ` +
    `${match.teamB} wins. Auto-ingested by Adjudex from a public match feed.`;

  const resolutionCriteria =
    `Resolves YES if ${match.teamA} wins the ${seriesFormat}${venue} per the ` +
    `official published result. Resolves NO if ${match.teamB} wins. If the ` +
    `match is canceled or abandoned without an official winner, positions are ` +
    `refunded after the grace window. Source: ${match.sourceUrl}`;

  return {
    title,
    question,
    description,
    resolutionCriteria,
    deadlineIso: deadlineForMatch(match),
  };
}
