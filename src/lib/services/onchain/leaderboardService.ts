// On-chain LeaderboardService - aggregates BetPlaced logs per bettor.

import {
  createPublicClient,
  http,
  type Address,
  parseAbiItem,
} from "viem";
import MarketFactoryAbi from "@/lib/abi/MarketFactory.json";
import ParimutuelPoolAbi from "@/lib/abi/ParimutuelPool.json";
import ReputationOracleAbi from "@/lib/abi/ReputationOracle.json";
import { displayMarketIdForChain, resolveDirectOnchainConfig } from "@/lib/onchain-config";
import type { LeaderRow } from "@/lib/types/domain";
import type { LeaderboardService } from "../types";

const BET_PLACED = parseAbiItem(
  "event BetPlaced(address indexed bettor, uint8 side, uint256 amount, uint256 indexed positionId)",
);
const USDC_UNITS = 1_000_000;

export function createOnchainLeaderboardService(): LeaderboardService {
  const { chain, chainId, rpcUrl, factoryAddress } =
    resolveDirectOnchainConfig("On-chain leaderboard service");
  const oracleAddress = process.env.NEXT_PUBLIC_REPUTATION_ORACLE_ADDRESS as
    | Address
    | undefined;

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // Build a map of agentWallet -> {handle, reputation} by walking the
  // ERC-8004-style ReputationOracle registry. Treats those wallets as kind="ai"
  // on the leaderboard.
  async function loadAgentMap(): Promise<Map<string, { handle: string; reputation: number }>> {
    const map = new Map<string, { handle: string; reputation: number }>();
    if (!oracleAddress) return map;
    try {
      const count = (await client.readContract({
        address: oracleAddress,
        abi: ReputationOracleAbi,
        functionName: "agentCount",
      })) as bigint;
      const total = Number(count);
      for (let i = 0n; i < BigInt(total); i++) {
        const agentId = (await client.readContract({
          address: oracleAddress,
          abi: ReputationOracleAbi,
          functionName: "agentIds",
          args: [i],
        })) as `0x${string}`;
        const [wallet, handle] = (await client.readContract({
          address: oracleAddress,
          abi: ReputationOracleAbi,
          functionName: "getAgent",
          args: [agentId],
        })) as readonly [Address, string, bigint];
        const reputation = Number(
          (await client.readContract({
            address: oracleAddress,
            abi: ReputationOracleAbi,
            functionName: "getReputation",
            args: [agentId],
          })) as bigint,
        );
        map.set(wallet.toLowerCase(), { handle, reputation });
      }
    } catch {
      // No oracle deployed or RPC hiccup - fall back to all humans.
    }
    return map;
  }

  async function listPools(): Promise<
    { marketId: string; pool: Address; resolved: boolean; resolvedSide: number }[]
  > {
    const next = (await client.readContract({
      address: factoryAddress!,
      abi: MarketFactoryAbi,
      functionName: "nextMarketId",
    })) as bigint;
    const total = Number(next);
    if (total <= 1) return [];
    const ids = Array.from({ length: total - 1 }, (_, i) => BigInt(i + 1));
    const rows = await Promise.all(
      ids.map(async (id) => {
        const pool = (await client.readContract({
          address: factoryAddress!,
          abi: MarketFactoryAbi,
          functionName: "getMarket",
          args: [id],
        })) as Address;
        if (pool === "0x0000000000000000000000000000000000000000") {
          return null;
        }
        const [resolved, resolvedSide] = await Promise.all([
          client.readContract({ address: pool, abi: ParimutuelPoolAbi, functionName: "resolved" }),
          client.readContract({ address: pool, abi: ParimutuelPoolAbi, functionName: "resolvedSide" }),
        ]);
        return {
          marketId: displayMarketIdForChain(chainId, id),
          pool,
          resolved: resolved as boolean,
          resolvedSide: Number(resolvedSide),
        };
      }),
    );
    return rows.filter((r): r is { marketId: string; pool: Address; resolved: boolean; resolvedSide: number } => r !== null);
  }

  return {
    async getLeaders(filters = {}): Promise<LeaderRow[]> {
      const [pools, agentMap] = await Promise.all([listPools(), loadAgentMap()]);
      type Agg = { volume: number; wins: number; losses: number; pnl: number; markets: Set<string> };
      const byAddr = new Map<string, Agg>();

      for (const { marketId, pool, resolved, resolvedSide } of pools) {
        const logs = await client.getLogs({
          address: pool,
          event: BET_PLACED,
          fromBlock: 0n,
          toBlock: "latest",
        });
        for (const log of logs) {
          const addr = (log.args.bettor as string)?.toLowerCase();
          if (!addr) continue;
          const side = Number(log.args.side);
          const amount = Number(log.args.amount) / USDC_UNITS;
          const agg = byAddr.get(addr) ?? { volume: 0, wins: 0, losses: 0, pnl: 0, markets: new Set<string>() };
          agg.volume += amount;
          agg.markets.add(marketId);
          if (resolved) {
            const won = side === resolvedSide;
            if (won) {
              agg.wins += 1;
              agg.pnl += amount;
            } else {
              agg.losses += 1;
              agg.pnl -= amount;
            }
          }
          byAddr.set(addr, agg);
        }
      }

      let rows: LeaderRow[] = Array.from(byAddr.entries()).map(([addr, agg]) => {
        const settled = agg.wins + agg.losses;
        const agent = agentMap.get(addr);
        return {
          id: addr,
          kind: agent ? "ai" : "human",
          handle: agent ? agent.handle : `${addr.slice(0, 6)}...${addr.slice(-4)}`,
          volumeUsd: agg.volume,
          pnlUsd: agg.pnl,
          winRate: settled > 0 ? agg.wins / settled : 0,
          reputation: agent?.reputation,
          marketsTouched: agg.markets.size,
        };
      });

      if (filters.pool === "humans") rows = rows.filter((r) => r.kind === "human");
      if (filters.pool === "ai") rows = rows.filter((r) => r.kind === "ai");
      rows.sort((a, b) => b.volumeUsd - a.volumeUsd);
      return rows;
    },
  };
}


