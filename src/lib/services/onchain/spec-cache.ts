// In-memory specHash -> market metadata cache.
//
// Product rule: market metadata must come from a durable specUri/backend/indexer
// path. This module intentionally keeps only an in-memory cache and does not
// synthesize fallback market metadata.

import type {
  Market,
  MarketCategory,
  OracleType,
} from "@/lib/types/domain";

export type SpecMeta = {
  title: string;
  description: string;
  category: MarketCategory;
  oracleType: OracleType;
  asset: Market["asset"];
  deadlineIso: string;
  feeBps: number;
  sourceUrl?: string;
  resolutionCriteria?: string;
  emoji?: string;
};

type CacheShape = Record<string, SpecMeta>;

let cache: CacheShape = {};

export function getSpec(specHash: `0x${string}`): SpecMeta | null {
  return cache[specHash] ?? null;
}

export function setSpec(specHash: `0x${string}`, meta: SpecMeta): void {
  cache = { ...cache, [specHash]: meta };
}

