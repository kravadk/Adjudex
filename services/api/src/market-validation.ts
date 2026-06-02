type MarketDraft = {
  title?: string;
  description?: string;
  category?: string;
  oracleType?: string;
  asset?: string;
  deadlineIso?: string;
  feeBps?: number;
  sourceUrl?: string;
  resolutionCriteria?: string;
  // Sub-market kinds (S4.E). Defaults to "moneyline". Non-moneyline
  // kinds typically reference a parent moneyline via parentMarketId.
  kind?: string;
  parentMarketId?: string;
};

export const MARKET_KINDS = ["moneyline", "handicap", "totals", "prop"] as const;
export type MarketKindValidated = (typeof MARKET_KINDS)[number];

export type MarketValidationResult = {
  ok: boolean;
  errors: string[];
  warnings?: string[];
};

export function validateMarketDraft(input: MarketDraft): MarketValidationResult {
  const errors: string[] = [];
  const title = input.title?.trim() ?? "";
  const deadline = input.deadlineIso ? new Date(input.deadlineIso) : null;
  const categories = new Set(["stocks", "crypto", "sports", "soft", "esports"]);
  const oracleTypes = new Set(["chainlink-price", "zktls-ai-oracle", "manual"]);
  const assets = new Set(["USDC", "tokenized-TSLA", "tokenized-AAPL"]);

  if (!/^(will|does|did|is|are|was|were|can|has|have)\b/i.test(title) || !title.endsWith("?")) {
    errors.push("title_must_be_binary_question");
  }
  if (!input.description?.trim()) errors.push("description_required");
  if (!input.sourceUrl?.trim()) errors.push("source_url_required");
  else {
    try {
      const parsed = new URL(input.sourceUrl);
      if (!["https:", "http:"].includes(parsed.protocol)) errors.push("source_url_invalid");
    } catch {
      errors.push("source_url_invalid");
    }
  }
  if (!input.resolutionCriteria?.trim()) errors.push("resolution_criteria_required");
  if (!input.category || !categories.has(input.category)) errors.push("category_invalid");
  if (!input.oracleType || !oracleTypes.has(input.oracleType)) errors.push("oracle_type_invalid");
  if (!input.asset || !assets.has(input.asset)) errors.push("asset_invalid");
  if (!deadline || Number.isNaN(deadline.getTime()) || deadline.getTime() <= Date.now()) {
    errors.push("deadline_must_be_future");
  }
  const feeBps = input.feeBps;
  if (!Number.isInteger(feeBps) || feeBps === undefined || feeBps < 0 || feeBps > 500) {
    errors.push("fee_bps_out_of_range");
  }

  // Sub-market kind validation. Empty / undefined = "moneyline".
  // Non-moneyline kinds need a parent market id so the UI can group them.
  if (input.kind !== undefined && input.kind !== null && input.kind !== "") {
    if (!MARKET_KINDS.includes(input.kind as MarketKindValidated)) {
      errors.push("kind_invalid");
    } else if (input.kind !== "moneyline") {
      if (!input.parentMarketId || !input.parentMarketId.trim()) {
        errors.push("parent_market_id_required_for_non_moneyline");
      }
    }
  }
  // parent_market_id without an explicit kind defaults to "handicap"-ish
  // grouping; reject so callers can't silently mislabel a sub-market.
  if (input.parentMarketId && (!input.kind || input.kind === "moneyline")) {
    errors.push("parent_market_id_requires_non_moneyline_kind");
  }

  return { ok: errors.length === 0, errors };
}
