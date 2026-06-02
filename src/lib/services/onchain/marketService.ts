// On-chain MarketService.
//
// Reads MarketFactory + each ParimutuelPool directly via viem.
// Off-chain metadata (title/description/etc) is bridged via spec-cache.ts.

import { createPublicClient, http, type Address } from "viem";
import MarketFactoryAbi from "@/lib/abi/MarketFactory.json";
import ParimutuelPoolAbi from "@/lib/abi/ParimutuelPool.json";
import {
  displayMarketIdForChain,
  getConfiguredOneHourLookbackBlocks,
  parseContractMarketId,
  resolveDirectOnchainConfig,
} from "@/lib/onchain-config";
import type { Market, MarketSpec } from "@/lib/types/domain";
import type { MarketService, Unsubscribe } from "../types";
import {
  getSpec,
  setSpec,
  type SpecMeta,
} from "./spec-cache";

type PoolSnapshot = {
  poolAddress: Address;
  yesPool: bigint;
  noPool: bigint;
  bettorCount: bigint;
  resolved: boolean;
  resolvedSide: number;
};

const USDC_UNITS = 1_000_000;

export function createOnchainMarketService(): MarketService {
  const { chain, chainId, rpcUrl, factoryAddress } =
    resolveDirectOnchainConfig("On-chain market service");

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  async function readNextMarketId(): Promise<bigint> {
    return (await client.readContract({
      address: factoryAddress!,
      abi: MarketFactoryAbi,
      functionName: "nextMarketId",
    })) as bigint;
  }

  async function readPoolAddress(marketId: bigint): Promise<Address> {
    return (await client.readContract({
      address: factoryAddress!,
      abi: MarketFactoryAbi,
      functionName: "getMarket",
      args: [marketId],
    })) as Address;
  }

  const oneHourLookbackBlocks = getConfiguredOneHourLookbackBlocks(chainId);

  async function readYesProbAtBlock(
    poolAddress: Address,
    blockNumber: bigint,
  ): Promise<number | null> {
    try {
      const [y, n] = await Promise.all([
        client.readContract({
          address: poolAddress,
          abi: ParimutuelPoolAbi,
          functionName: "yesPool",
          blockNumber,
        }) as Promise<bigint>,
        client.readContract({
          address: poolAddress,
          abi: ParimutuelPoolAbi,
          functionName: "noPool",
          blockNumber,
        }) as Promise<bigint>,
      ]);
      const total = y + n;
      if (total === 0n) return null;
      return Number(y) / Number(total);
    } catch {
      // Pool didn't exist at that block, or archive node missing - caller
      // treats null as "no signal" and surfaces a 0 delta rather than guess.
      return null;
    }
  }

  async function readPoolSnapshot(poolAddress: Address): Promise<PoolSnapshot> {
    const [yesPool, noPool, bettorCount, resolved, resolvedSide] =
      await Promise.all([
        client.readContract({ address: poolAddress, abi: ParimutuelPoolAbi, functionName: "yesPool" }),
        client.readContract({ address: poolAddress, abi: ParimutuelPoolAbi, functionName: "noPool" }),
        client.readContract({ address: poolAddress, abi: ParimutuelPoolAbi, functionName: "bettorCount" }),
        client.readContract({ address: poolAddress, abi: ParimutuelPoolAbi, functionName: "resolved" }),
        client.readContract({ address: poolAddress, abi: ParimutuelPoolAbi, functionName: "resolvedSide" }),
      ]);
    return {
      poolAddress,
      yesPool: yesPool as bigint,
      noPool: noPool as bigint,
      bettorCount: bettorCount as bigint,
      resolved: resolved as boolean,
      resolvedSide: Number(resolvedSide),
    };
  }

  function snapshotToMarket(
    marketId: string,
    snap: PoolSnapshot,
    meta: SpecMeta,
    yesProbAnHourAgo: number | null,
  ): Market {
    const yes = Number(snap.yesPool) / USDC_UNITS;
    const no = Number(snap.noPool) / USDC_UNITS;
    const total = yes + no;
    const yesProb = total > 0 ? yes / total : 0.5;
    const change1h =
      yesProbAnHourAgo === null ? 0 : yesProb - yesProbAnHourAgo;
    const status: Market["status"] = snap.resolved ? "resolved" : "open";
    return {
      id: marketId,
      poolAddress: snap.poolAddress,
      chainId,
      factoryAddress,
      emoji: meta.emoji ?? "",
      title: meta.title,
      description: meta.description,
      category: meta.category,
      oracleType: meta.oracleType,
      status,
      asset: meta.asset,
      volumeUsd: total,
      yesProbability: yesProb,
      yesProbabilityChange1h: change1h,
      bettors: Number(snap.bettorCount),
      aiLpCount: 0,
      isHot: total > 1000,
      deadlineIso: meta.deadlineIso,
      resolvedOutcome: snap.resolved ? (snap.resolvedSide === 0 ? "YES" : "NO") : undefined,
      sourceUrl: meta.sourceUrl,
      resolutionCriteria: meta.resolutionCriteria,
    };
  }

  async function decodeSpecUri(uri: string): Promise<SpecMeta | null> {
    if (!uri) return null;
    try {
      if (uri.startsWith("data:application/json;base64,")) {
        const b64 = uri.slice("data:application/json;base64,".length);
        const json =
          typeof atob === "function"
            ? atob(b64)
            : Buffer.from(b64, "base64").toString("utf-8");
        return JSON.parse(json) as SpecMeta;
      }
      if (uri.startsWith("http://") || uri.startsWith("https://")) {
        const res = await fetch(uri);
        if (!res.ok) return null;
        return (await res.json()) as SpecMeta;
      }
    } catch {
      /* fall through to fallback */
    }
    return null;
  }

  async function readSpecUri(marketId: string): Promise<string> {
    try {
      const uri = (await client.readContract({
        address: factoryAddress!,
        abi: MarketFactoryAbi,
        functionName: "specUris",
        args: [parseContractMarketId(marketId)],
      })) as string;
      return uri;
    } catch {
      return "";
    }
  }

  async function readSpecHash(marketId: string): Promise<`0x${string}` | null> {
    try {
      const specHash = (await client.readContract({
        address: factoryAddress!,
        abi: MarketFactoryAbi,
        functionName: "specHashes",
        args: [parseContractMarketId(marketId)],
      })) as `0x${string}`;
      return specHash === "0x0000000000000000000000000000000000000000000000000000000000000000"
        ? null
        : specHash;
    } catch {
      return null;
    }
  }

  async function resolveMeta(marketId: string): Promise<SpecMeta> {
    const specHash = await readSpecHash(marketId);
    if (specHash) {
      const cached = getSpec(specHash);
      if (cached) return cached;
    }
    // On-chain fallback via MarketFactory.specUris(marketId).
    const uri = await readSpecUri(marketId);
    const fromUri = await decodeSpecUri(uri);
    if (fromUri) {
      if (specHash) setSpec(specHash, fromUri);
      return fromUri;
    }
    throw new Error(
      `Market ${marketId} metadata is unavailable. A durable specUri or indexed backend record is required.`,
    );
  }

  return {
    async listMarkets(filters) {
      const [next, head] = await Promise.all([
        readNextMarketId(),
        client.getBlockNumber(),
      ]);
      const total = Number(next);
      if (total <= 1) return [];
      const lookbackBlock =
        oneHourLookbackBlocks && head > oneHourLookbackBlocks
          ? head - oneHourLookbackBlocks
          : null;

      const ids = Array.from({ length: total - 1 }, (_, i) => BigInt(i + 1));
      const markets = await Promise.all(
        ids.map(async (id) => {
          const poolAddress = await readPoolAddress(id);
          if (poolAddress === "0x0000000000000000000000000000000000000000") return null;
          const [snap, prevYesProb] = await Promise.all([
            readPoolSnapshot(poolAddress),
            lookbackBlock === null ? Promise.resolve(null) : readYesProbAtBlock(poolAddress, lookbackBlock),
          ]);
          const idStr = displayMarketIdForChain(chainId, id);
          const meta = await resolveMeta(idStr);
          return snapshotToMarket(idStr, snap, meta, prevYesProb);
        }),
      );

      let out = markets.filter((m): m is Market => m !== null);
      if (filters?.category && filters.category !== "all") {
        out = out.filter((m) => m.category === filters.category);
      }
      if (filters?.hotOnly) out = out.filter((m) => m.isHot);
      if (filters?.query) {
        const q = filters.query.toLowerCase();
        out = out.filter(
          (m) => m.title.toLowerCase().includes(q) || m.description.toLowerCase().includes(q),
        );
      }
      return out;
    },

    async getMarket(id: string) {
      const marketId = parseContractMarketId(id);
      const poolAddress = await readPoolAddress(marketId);
      if (poolAddress === "0x0000000000000000000000000000000000000000") {
        throw new Error(`Market ${id} not found on-chain.`);
      }
      const head = await client.getBlockNumber();
      const lookbackBlock =
        oneHourLookbackBlocks && head > oneHourLookbackBlocks
          ? head - oneHourLookbackBlocks
          : null;
      const [snap, prevYesProb] = await Promise.all([
        readPoolSnapshot(poolAddress),
        lookbackBlock === null ? Promise.resolve(null) : readYesProbAtBlock(poolAddress, lookbackBlock),
      ]);
      const meta = await resolveMeta(id);
      return snapshotToMarket(id, snap, meta, prevYesProb);
    },

    subscribeMarket(id: string, cb: (market: Market) => void): Unsubscribe {
      let cancelled = false;
      let unwatch: (() => void) | null = null;
      (async () => {
        if (cancelled) return;
        const marketId = parseContractMarketId(id);
        const poolAddress = await readPoolAddress(marketId);
        if (cancelled || poolAddress === "0x0000000000000000000000000000000000000000") return;
        const refresh = async () => {
          try {
            const head = await client.getBlockNumber();
            const lookbackBlock =
              oneHourLookbackBlocks && head > oneHourLookbackBlocks
                ? head - oneHourLookbackBlocks
                : null;
            const [snap, prevYesProb] = await Promise.all([
              readPoolSnapshot(poolAddress),
              lookbackBlock === null ? Promise.resolve(null) : readYesProbAtBlock(poolAddress, lookbackBlock),
            ]);
            const meta = await resolveMeta(id);
            cb(snapshotToMarket(id, snap, meta, prevYesProb));
          } catch {
            /* transient RPC errors */
          }
        };
        await refresh();
        if (cancelled) return;
        unwatch = client.watchContractEvent({
          address: poolAddress,
          abi: ParimutuelPoolAbi,
          eventName: "BetPlaced",
          onLogs: () => { void refresh(); },
        });
      })();
      return () => {
        cancelled = true;
        if (unwatch) unwatch();
      };
    },

    async generateSpec(prompt: string): Promise<MarketSpec> {
      void prompt;
      throw new Error("market_generation_backend_required");
    },

    async deployMarket(spec: MarketSpec): Promise<Market> {
      void spec;
      throw new Error("market_deploy_requires_confirmed_wallet_tx_and_indexed_backend_record");
    },
  };
}


