import { describe, expect, it } from "vitest";
import { validateMarketDraft } from "../market-validation";

const validDraft = {
  title: "Will ETH close above 4000 USDC on Arbitrum before the deadline?",
  description: "Resolution uses the configured source URL and the close price at the deadline.",
  category: "crypto",
  oracleType: "chainlink-price",
  asset: "USDC",
  deadlineIso: new Date(Date.now() + 86_400_000).toISOString(),
  feeBps: 100,
  sourceUrl: "https://example.com/markets/eth-usdc",
  resolutionCriteria: "YES if the reported close price is greater than 4000 USDC.",
};

describe("validateMarketDraft", () => {
  it("accepts a binary future-dated market draft with a source URL", () => {
    expect(validateMarketDraft(validDraft)).toEqual({ ok: true, errors: [] });
  });

  it("rejects drafts without a binary question", () => {
    const result = validateMarketDraft({ ...validDraft, title: "ETH price discussion" });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("title_must_be_binary_question");
  });

  it("rejects past deadlines, out-of-range fees, and missing source URLs", () => {
    const result = validateMarketDraft({
      ...validDraft,
      deadlineIso: new Date(Date.now() - 1_000).toISOString(),
      feeBps: 700,
      sourceUrl: "",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(["deadline_must_be_future", "fee_bps_out_of_range", "source_url_required"]));
  });

  it("rejects invalid source URLs and unsupported enum values", () => {
    const result = validateMarketDraft({
      ...validDraft,
      sourceUrl: "not-a-url",
      category: "weather",
      oracleType: "spreadsheet",
      asset: "POINTS",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(["source_url_invalid", "category_invalid", "oracle_type_invalid", "asset_invalid"]));
  });
});
