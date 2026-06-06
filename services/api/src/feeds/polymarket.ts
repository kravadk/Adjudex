// Polymarket mirror adapter — ingests live Polymarket markets via the public
// Gamma API and maps them onto Adjudex binary YES/NO pools.
//
// Gamma already decomposes multi-outcome events into per-candidate binary
// markets (neg-risk), so every `/markets` row is a binary YES/NO with a
// `groupItemTitle` for grouped events. We mirror each as one Adjudex market.
//
// Resolution (Phase 1): mirror Polymarket's official outcome. A closed market
// reports the winner via `outcomePrices` (winning side ≈ 1). The resolve
// worker turns that into the signed verdict. Phase 2 layers an independent
// AI-judge discrepancy check on top.
//
// Docs: https://docs.polymarket.com/ (Gamma Markets API)
//
// Env:
//   POLYMARKET_INGEST_ENABLED=1            enable this source
//   POLYMARKET_GAMMA_URL=...               override base (default gamma-api)
//   POLYMARKET_TAG_SLUGS=crypto,politics   category allowlist (tag/category match)
//   POLYMARKET_MIN_VOLUME_USD=25000        skip thin markets
//   POLYMARKET_MAX_INGEST=20               cap markets scanned per tick

import type {
  IngestMatch,
  MarketCategorySlug,
  MatchResult,
  MatchSource,
  MatchStatus,
} from "./types";

const DEFAULT_BASE = "https://gamma-api.polymarket.com";
const DEFAULT_MIN_VOLUME = 25_000;
const DEFAULT_MAX_INGEST = 20;
const DEFAULT_TAGS = ["crypto", "politics", "sports"];

type GammaTag = { label?: string; slug?: string };
type GammaEvent = { title?: string; slug?: string; tags?: GammaTag[] };
type GammaMarket = {
  id?: string | number;
  question?: string;
  slug?: string;
  description?: string;
  outcomes?: string; // JSON-encoded array, e.g. '["Yes","No"]'
  outcomePrices?: string; // JSON-encoded array, e.g. '["0.6","0.4"]'
  volumeNum?: number;
  volume?: string;
  liquidityNum?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  endDate?: string;
  endDateIso?: string;
  groupItemTitle?: string;
  category?: string;
  umaResolutionStatus?: string;
  events?: GammaEvent[];
};

function base(): string {
  return (process.env.POLYMARKET_GAMMA_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
}

function tagAllowlist(): string[] {
  const raw = process.env.POLYMARKET_TAG_SLUGS?.trim();
  if (!raw) return DEFAULT_TAGS;
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function minVolume(): number {
  const raw = Number(process.env.POLYMARKET_MIN_VOLUME_USD);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MIN_VOLUME;
}

function maxIngest(): number {
  const raw = Number(process.env.POLYMARKET_MAX_INGEST);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_INGEST;
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${base()}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`polymarket_fetch_failed:${res.status}`);
  return res.json();
}

function parseJsonArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function volumeOf(m: GammaMarket): number {
  if (typeof m.volumeNum === "number") return m.volumeNum;
  const n = Number(m.volume);
  return Number.isFinite(n) ? n : 0;
}

function endDateOf(m: GammaMarket): string | null {
  const raw = m.endDate || m.endDateIso;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Collect category/tag text for both the allowlist filter and DB mapping.
function tagText(m: GammaMarket): string {
  const parts: string[] = [];
  if (m.category) parts.push(m.category);
  for (const ev of m.events ?? []) {
    if (ev.title) parts.push(ev.title);
    for (const t of ev.tags ?? []) {
      if (t.slug) parts.push(t.slug);
      if (t.label) parts.push(t.label);
    }
  }
  return parts.join(" ").toLowerCase();
}

function matchesAllowedTags(m: GammaMarket, allow: string[]): boolean {
  if (allow.length === 0) return true;
  const text = `${tagText(m)} ${(m.question ?? "").toLowerCase()}`;
  return allow.some((tag) => text.includes(tag));
}

function mapCategory(m: GammaMarket): MarketCategorySlug {
  const text = `${tagText(m)} ${(m.question ?? "").toLowerCase()}`;
  if (/\b(crypto|bitcoin|btc|ethereum|eth|solana|sol|defi|token|coin)\b/.test(text)) return "crypto";
  if (/\b(cs2|csgo|dota|league of legends|lol|valorant|esports)\b/.test(text)) return "esports";
  if (/\b(nfl|nba|mlb|nhl|soccer|football|tennis|ufc|f1|premier league|sport)\b/.test(text)) return "sports";
  if (/\b(stock|nasdaq|s&p|earnings|ipo|equity)\b/.test(text)) return "stocks";
  // politics, world, economics, pop-culture → generic bucket.
  return "soft";
}

const CATEGORY_EMOJI: Record<MarketCategorySlug, string> = {
  crypto: "🪙",
  sports: "🏟️",
  esports: "🎮",
  stocks: "📈",
  soft: "🔮",
};

// Recognize a binary YES/NO outcome pair (case-insensitive). Polymarket binary
// and neg-risk sub-markets both use ["Yes","No"].
function yesNoIndex(outcomes: string[]): { yes: number; no: number } | null {
  if (outcomes.length !== 2) return null;
  const lower = outcomes.map((o) => o.trim().toLowerCase());
  const yes = lower.indexOf("yes");
  const no = lower.indexOf("no");
  if (yes === -1 || no === -1) return null;
  return { yes, no };
}

function impliedYes(m: GammaMarket, yesIdx: number): number | undefined {
  const prices = parseJsonArray(m.outcomePrices);
  const p = Number(prices[yesIdx]);
  return Number.isFinite(p) ? p : undefined;
}

function toIngestMatch(m: GammaMarket): IngestMatch | null {
  if (m.id == null || !m.question) return null;
  const outcomes = parseJsonArray(m.outcomes);
  const yn = yesNoIndex(outcomes);
  if (!yn) return null; // not a clean binary YES/NO
  const closeAt = endDateOf(m);
  if (!closeAt) return null;
  if (new Date(closeAt).getTime() <= Date.now()) return null; // already past close

  const slug = m.slug ?? String(m.id);
  const eventTitle = m.events?.[0]?.title;
  // Grouped (multi-outcome) sub-markets: prefix with the parent event so the
  // standalone question reads clearly. Otherwise the question stands alone.
  const title =
    m.groupItemTitle && eventTitle ? `${eventTitle}: ${m.groupItemTitle}` : m.question;
  const category = mapCategory(m);
  const sourceUrl = `https://polymarket.com/market/${slug}`;

  return {
    externalMatchId: String(m.id),
    sourceKind: "polymarket",
    category: "external",
    marketCategory: category,
    emoji: CATEGORY_EMOJI[category],
    teamA: outcomes[yn.yes], // YES side
    teamB: outcomes[yn.no], // NO side
    titleOverride: title,
    questionOverride: m.question,
    descriptionOverride:
      `${(m.description ?? m.question).trim()} ` +
      `Mirrored by Adjudex from Polymarket; resolves to Polymarket's official outcome.`,
    resolutionCriteriaOverride:
      `Resolves YES if Polymarket officially resolves "${m.question}" to Yes, ` +
      `NO if it resolves to No. Voided/canceled markets refund after the grace ` +
      `window. Source: ${sourceUrl}`,
    matchStartsAtIso: new Date().toISOString(),
    closeAtIsoOverride: closeAt,
    sourceUrl,
    impliedYesProbability: impliedYes(m, yn.yes),
  };
}

function mapStatus(m: GammaMarket): MatchStatus {
  if (m.closed) return "finished";
  if (m.active === false || m.archived) return "canceled";
  return "scheduled";
}

export function createPolymarketSource(): MatchSource {
  return {
    kind: "polymarket",
    async fetchUpcoming(): Promise<IngestMatch[]> {
      const limit = maxIngest() * 3; // overfetch, then filter down
      const data = (await getJson(
        `/markets?closed=false&active=true&archived=false&order=volumeNum&ascending=false&limit=${limit}`,
      )) as GammaMarket[] | { data?: GammaMarket[] };
      const rows = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : [];
      const allow = tagAllowlist();
      const floor = minVolume();
      const out: IngestMatch[] = [];
      for (const m of rows) {
        if (volumeOf(m) < floor) continue;
        if (!matchesAllowedTags(m, allow)) continue;
        const mapped = toIngestMatch(m);
        if (mapped) out.push(mapped);
        if (out.length >= maxIngest()) break;
      }
      return out;
    },
    async fetchResult(externalMatchId: string): Promise<MatchResult | null> {
      const data = (await getJson(`/markets/${externalMatchId}`)) as
        | GammaMarket
        | GammaMarket[]
        | { data?: GammaMarket[] };
      const m: GammaMarket | undefined = Array.isArray(data)
        ? data[0]
        : data && typeof data === "object" && "data" in data && Array.isArray(data.data)
          ? data.data[0]
          : (data as GammaMarket);
      if (!m) return null;
      const fetchedAtIso = new Date().toISOString();
      const status = mapStatus(m);
      if (status === "canceled") return { status, winner: null, fetchedAtIso };
      if (status !== "finished") return { status, winner: null, fetchedAtIso };

      const outcomes = parseJsonArray(m.outcomes);
      const yn = yesNoIndex(outcomes);
      const prices = parseJsonArray(m.outcomePrices).map((p) => Number(p));
      if (!yn || prices.length !== outcomes.length) {
        // Closed but no decodable outcome yet — treat as not-final, retry later.
        return { status: "running", winner: null, fetchedAtIso };
      }
      const yesPrice = prices[yn.yes];
      const noPrice = prices[yn.no];
      // Resolved Polymarket markets settle to 1 / 0. Require a decisive split.
      if (yesPrice >= 0.99 && noPrice <= 0.01) {
        return { status, winner: "teamA", scoreText: "Polymarket: YES", fetchedAtIso };
      }
      if (noPrice >= 0.99 && yesPrice <= 0.01) {
        return { status, winner: "teamB", scoreText: "Polymarket: NO", fetchedAtIso };
      }
      // Closed but prices not settled to 1/0 yet (UMA window) — retry later.
      return { status: "running", winner: null, fetchedAtIso };
    },
  };
}
