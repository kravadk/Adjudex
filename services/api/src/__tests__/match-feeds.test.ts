import { afterEach, describe, expect, it } from "vitest";
import {
  deadlineForMatch,
  inferMatchDurationSec,
  matchQuestion,
  resultBufferSec,
} from "../feeds/match-question";
import type { IngestMatch } from "../feeds/types";
import { isSupported } from "../match-ingest-worker";
import { optimisticResolutionEnabled } from "../feeds/chain";

function esportsMatch(overrides: Partial<IngestMatch> = {}): IngestMatch {
  return {
    externalMatchId: "t-1",
    sourceKind: "pandascore",
    category: "esports",
    game: "cs2",
    teamA: "NAVI",
    teamB: "FaZe",
    tournament: "ESL Pro League",
    matchStartsAtIso: "2026-06-10T18:00:00.000Z",
    bestOfMaps: 3,
    sourceUrl: "https://example.test/match/t-1",
    ...overrides,
  };
}

describe("matchQuestion", () => {
  it("frames YES as teamA winning and names the tournament", () => {
    const spec = matchQuestion(esportsMatch());
    expect(spec.question).toBe("Will NAVI beat FaZe in ESL Pro League?");
    expect(spec.title).toBe("NAVI vs FaZe · ESL Pro League");
    expect(spec.resolutionCriteria).toContain("Resolves YES if NAVI wins");
    expect(spec.resolutionCriteria).toContain("Resolves NO if FaZe wins");
    expect(spec.resolutionCriteria).toContain("https://example.test/match/t-1");
  });

  it("uses best-of series wording for multi-map esports", () => {
    const spec = matchQuestion(esportsMatch({ bestOfMaps: 3 }));
    expect(spec.description).toContain("best-of-3 series");
  });

  it("falls back to plain 'match' when no tournament context", () => {
    const spec = matchQuestion(
      esportsMatch({ tournament: undefined, bestOfMaps: undefined }),
    );
    expect(spec.question).toBe("Will NAVI beat FaZe?");
    expect(spec.title).toBe("NAVI vs FaZe");
  });

  it("handles football (sports) framing", () => {
    const spec = matchQuestion({
      externalMatchId: "f-1",
      sourceKind: "football-data",
      category: "sports",
      sport: "football",
      teamA: "Arsenal",
      teamB: "Man City",
      tournament: "Premier League",
      league: "Premier League",
      matchStartsAtIso: "2026-06-10T14:00:00.000Z",
      sourceUrl: "https://example.test/f-1",
    });
    expect(spec.question).toBe("Will Arsenal beat Man City in Premier League?");
    expect(spec.description).toContain("match");
  });
});

describe("deadline inference", () => {
  const OLD = process.env.RESULT_BUFFER_SEC;
  afterEach(() => {
    if (OLD === undefined) delete process.env.RESULT_BUFFER_SEC;
    else process.env.RESULT_BUFFER_SEC = OLD;
  });

  it("defaults the result buffer to 2h and honours the env override", () => {
    delete process.env.RESULT_BUFFER_SEC;
    expect(resultBufferSec()).toBe(7200);
    process.env.RESULT_BUFFER_SEC = "60";
    expect(resultBufferSec()).toBe(60);
  });

  it("gives football a longer base duration than a short esports series", () => {
    const football = inferMatchDurationSec({
      ...esportsMatch(),
      category: "sports",
      sport: "football",
      game: undefined,
    });
    const esports = inferMatchDurationSec(esportsMatch({ bestOfMaps: 1 }));
    expect(football).toBeGreaterThan(esports);
  });

  it("pushes the deadline past kickoff by duration + buffer", () => {
    process.env.RESULT_BUFFER_SEC = "3600";
    const match = esportsMatch({ matchStartsAtIso: "2026-06-10T18:00:00.000Z" });
    const deadline = deadlineForMatch(match);
    expect(deadline).not.toBeNull();
    expect(new Date(deadline!).getTime()).toBeGreaterThan(
      new Date(match.matchStartsAtIso).getTime(),
    );
  });

  it("returns null for an unparseable kickoff", () => {
    expect(deadlineForMatch(esportsMatch({ matchStartsAtIso: "not-a-date" }))).toBeNull();
  });
});

describe("isSupported", () => {
  it("accepts Polymarket mirror markets (category 'external')", () => {
    expect(isSupported(esportsMatch({ category: "external", game: undefined }))).toBe(true);
  });

  it("accepts the extended esports games", () => {
    for (const game of ["cs2", "dota2", "lol", "valorant", "r6"] as const) {
      expect(isSupported(esportsMatch({ game }))).toBe(true);
    }
    expect(isSupported(esportsMatch({ game: "other" }))).toBe(false);
  });

  it("accepts football and rejects unknown sports", () => {
    expect(isSupported(esportsMatch({ category: "sports", sport: "football", game: undefined }))).toBe(true);
    expect(isSupported(esportsMatch({ category: "sports", sport: "tennis", game: undefined }))).toBe(false);
  });
});

describe("optimisticResolutionEnabled", () => {
  const prevFlag = process.env.OPTIMISTIC_RESOLUTION_ENABLED;
  const prevAddr = process.env.OPTIMISTIC_ORACLE_RESOLVER_ADDRESS;
  afterEach(() => {
    if (prevFlag === undefined) delete process.env.OPTIMISTIC_RESOLUTION_ENABLED;
    else process.env.OPTIMISTIC_RESOLUTION_ENABLED = prevFlag;
    if (prevAddr === undefined) delete process.env.OPTIMISTIC_ORACLE_RESOLVER_ADDRESS;
    else process.env.OPTIMISTIC_ORACLE_RESOLVER_ADDRESS = prevAddr;
  });

  it("is on only when the flag is 1 and the resolver address is set", () => {
    process.env.OPTIMISTIC_RESOLUTION_ENABLED = "1";
    process.env.OPTIMISTIC_ORACLE_RESOLVER_ADDRESS = "0xdbad18aaa2db2bbb5a703f4305ad71ea0c1b1258";
    expect(optimisticResolutionEnabled()).toBe(true);

    process.env.OPTIMISTIC_RESOLUTION_ENABLED = "0";
    expect(optimisticResolutionEnabled()).toBe(false);

    process.env.OPTIMISTIC_RESOLUTION_ENABLED = "1";
    delete process.env.OPTIMISTIC_ORACLE_RESOLVER_ADDRESS;
    expect(optimisticResolutionEnabled()).toBe(false);
  });
});
