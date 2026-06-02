import { afterEach, describe, expect, it } from "vitest";
import { configuredImportSources, validateImportCandidate } from "../importer";

describe("market importer", () => {
  afterEach(() => {
    delete process.env.IMPORT_SOURCE_URLS;
  });

  it("loads only explicitly configured public sources", () => {
    process.env.IMPORT_SOURCE_URLS = JSON.stringify([
      {
        id: "crypto-news",
        name: "Crypto News",
        kind: "rss",
        url: "https://example.com/feed.xml",
        category: "crypto",
        oracleType: "manual",
      },
    ]);

    expect(configuredImportSources()).toEqual([
      {
        id: "crypto-news",
        name: "Crypto News",
        kind: "rss",
        url: "https://example.com/feed.xml",
        category: "crypto",
        oracleType: "manual",
        active: true,
      },
    ]);
  });

  it("fails closed when source-backed candidate lacks required proof fields", () => {
    const result = validateImportCandidate({
      question: "Will ETH close above 4000 USDC before the deadline?",
      description: "Imported public event.",
      category: "crypto",
      oracleType: "manual",
      asset: "USDC",
      deadlineIso: new Date(Date.now() + 86_400_000).toISOString(),
      sourceUrl: "https://example.com/event",
      resolutionCriteria: null,
      riskFlags: ["resolution_criteria_missing"],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("resolution_criteria_missing");
  });

  it("creates spec hash and spec uri only for validated candidates", () => {
    const result = validateImportCandidate({
      question: "Will ETH close above 4000 USDC before the deadline?",
      description: "Resolution uses the cited source at the deadline.",
      category: "crypto",
      oracleType: "manual",
      asset: "USDC",
      deadlineIso: new Date(Date.now() + 86_400_000).toISOString(),
      sourceUrl: "https://example.com/event",
      resolutionCriteria: "YES if the cited source reports ETH above 4000 USDC at the deadline.",
      riskFlags: [],
    });

    expect(result.ok).toBe(true);
    expect(result.specHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.specUri).toMatch(/^data:application\/json;base64,/);
  });
});
