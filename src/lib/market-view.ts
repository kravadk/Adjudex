// Adapter: maps domain Market to the view shape consumed by the Adjudex UI.
// Keeps the service layer and zustand stores untouched.

import type { EsportsGame, Market, MarketKind } from "@/lib/types/domain";
import { resolveMarketLifecycle, type MarketLifecycle } from "@/lib/market-lifecycle";

export type AssetClass = "stock" | "crypto" | "sports" | "esports" | "politics" | "tech";

export type MarketView = {
  id: string;
  ticker: string;
  assetClass: AssetClass;
  title: string;
  description: string;
  category: string;
  rawCategory: Market["category"];
  volume: number;
  bettors: number;
  aiLpCount: number;
  hasAiJudge: boolean;
  asset: string;
  yesPct: number;
  resolvesInMs: number;
  deadlineIso: string;
  isHot: boolean;
  featured?: boolean;
  yesHistory: number[];
  changePct: number;
  poolAddress?: `0x${string}`;
  chainId?: number;
  sourceUrl?: string;
  lifecycle: MarketLifecycle;
  // Esports opt-in (mirrors Market opt-in fields).
  game?: EsportsGame;
  tournament?: string;
  teamA?: string;
  teamB?: string;
  matchStartsAtIso?: string;
  bestOfMaps?: number;
  streamUrl?: string;
  parentMarketId?: string;
  kind?: MarketKind;
  // S6.A — passthrough for <TraderStack> on market cards.
  recentTraders?: string[];
};

const TITLE_TICKER = /\b([A-Z]{2,6})\b/;

const CATEGORY_LABEL: Record<string, { label: string; assetClass: AssetClass }> = {
  stocks:  { label: "Stocks",   assetClass: "stock" },
  crypto:  { label: "Crypto",   assetClass: "crypto" },
  sports:  { label: "Sports",   assetClass: "sports" },
  esports: { label: "Esports",  assetClass: "esports" },
  soft:    { label: "Politics", assetClass: "politics" },
};

function pickTicker(title: string, category: string): string {
  const match = title.match(TITLE_TICKER);
  if (match) return match[1];
  return category === "crypto" ? "CRYPTO" : category === "sports" ? "SPORT" : "MKT";
}

function assetLabel(market: Market): string {
  switch (market.asset) {
    case "tokenized-TSLA": return "TSLA (tokenized equity)";
    case "tokenized-AAPL": return "AAPL (tokenized equity)";
    case "USDC":           return "USDC settled";
  }
}

function resolvesInMs(deadlineIso: string): number {
  const t = new Date(deadlineIso).getTime();
  return Math.max(0, t - Date.now());
}

function lifecycleOf(market: Market): MarketView["lifecycle"] {
  return resolveMarketLifecycle({
    status: market.status,
    deadlineIso: market.deadlineIso,
    resolvedOutcome: market.resolvedOutcome,
  });
}

export function toMarketView(market: Market, opts: { featured?: boolean } = {}): MarketView {
  const cat = CATEGORY_LABEL[market.category] ?? { label: "Markets", assetClass: "tech" as AssetClass };
  const ticker = pickTicker(market.title, market.category);
  // Real per-market price history is not derivable from a single `Market`
  // snapshot; it needs a dedicated history endpoint. Leave empty so the
  // Sparkline renders nothing rather than a fabricated curve.
  const yesHistory: number[] = [];
  return {
    id: market.id,
    ticker,
    assetClass: cat.assetClass,
    title: market.title,
    description: market.description,
    category: cat.label,
    rawCategory: market.category,
    volume: market.volumeUsd,
    bettors: market.bettors,
    aiLpCount: market.aiLpCount,
    hasAiJudge: market.oracleType === "zktls-ai-oracle",
    asset: assetLabel(market),
    yesPct: market.yesProbability,
    resolvesInMs: resolvesInMs(market.deadlineIso),
    deadlineIso: market.deadlineIso,
    isHot: market.isHot,
    featured: opts.featured,
    yesHistory,
    changePct: market.yesProbabilityChange1h * 100,
    poolAddress: market.poolAddress,
    chainId: market.chainId,
    sourceUrl: market.sourceUrl,
    lifecycle: lifecycleOf(market),
    game: market.game,
    tournament: market.tournament,
    teamA: market.teamA,
    teamB: market.teamB,
    matchStartsAtIso: market.matchStartsAtIso,
    bestOfMaps: market.bestOfMaps,
    streamUrl: market.streamUrl,
    parentMarketId: market.parentMarketId,
    kind: market.kind,
    recentTraders: market.recentTraders,
  };
}

export function formatUsd(n: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact) {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  }
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "resolved";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function multiplierFromPct(pct: number): number {
  if (pct <= 0) return 0;
  return 1 / pct;
}

