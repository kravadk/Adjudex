// On-chain ActivityService - BetPlaced + MarketResolved across all pools.

import {
  createPublicClient,
  http,
  type Address,
  parseAbiItem,
  type Log,
} from "viem";
import MarketFactoryAbi from "@/lib/abi/MarketFactory.json";
import ParimutuelPoolAbi from "@/lib/abi/ParimutuelPool.json";
import ReputationOracleAbi from "@/lib/abi/ReputationOracle.json";
import { displayMarketIdForChain, resolveDirectOnchainConfig } from "@/lib/onchain-config";
import type { ActivityEvent } from "@/lib/types/domain";
import type { ActivityService, Unsubscribe } from "../types";

const BET_PLACED = parseAbiItem(
  "event BetPlaced(address indexed bettor, uint8 side, uint256 amount, uint256 indexed positionId)",
);
const MARKET_RESOLVED = parseAbiItem("event MarketResolved(uint8 side)");
const REFUNDED = parseAbiItem(
  "event Refunded(address indexed bettor, uint256 indexed positionId, uint256 amount)",
);

const USDC_UNITS = 1_000_000;

export function createOnchainActivityService(): ActivityService {
  const { chain, chainId, rpcUrl, factoryAddress } =
    resolveDirectOnchainConfig("On-chain activity service");
  const oracleAddress = process.env.NEXT_PUBLIC_REPUTATION_ORACLE_ADDRESS as
    | Address
    | undefined;

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // Lazily-loaded wallet->handle map for tagging AI-LP events.
  const agentMap = new Map<string, string>();
  async function ensureAgentMap(): Promise<void> {
    if (!oracleAddress || agentMap.size > 0) return;
    try {
      const count = (await client.readContract({
        address: oracleAddress,
        abi: ReputationOracleAbi,
        functionName: "agentCount",
      })) as bigint;
      for (let i = 0n; i < count; i++) {
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
        agentMap.set(wallet.toLowerCase(), handle);
      }
    } catch {
      /* tolerate missing oracle */
    }
  }

  type PoolRef = { marketId: string; pool: Address };

  async function listPools(): Promise<PoolRef[]> {
      const next = (await client.readContract({
      address: factoryAddress,
      abi: MarketFactoryAbi,
      functionName: "nextMarketId",
    })) as bigint;
    const total = Number(next);
    if (total <= 1) return [];
    const ids = Array.from({ length: total - 1 }, (_, i) => BigInt(i + 1));
    const pools = await Promise.all(
      ids.map(async (id) => {
        const pool = (await client.readContract({
          address: factoryAddress!,
          abi: MarketFactoryAbi,
          functionName: "getMarket",
          args: [id],
        })) as Address;
        return { marketId: displayMarketIdForChain(chainId, id), pool };
      }),
    );
    return pools.filter(
      (p) => p.pool !== "0x0000000000000000000000000000000000000000",
    );
  }

  function shortenAddr(addr: string): string {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  async function tsForLog(log: Log): Promise<string> {
    const block = await client.getBlock({ blockHash: log.blockHash! });
    return new Date(Number(block.timestamp) * 1000).toISOString();
  }

  return {
    async getRecent(limit = 20): Promise<ActivityEvent[]> {
      await ensureAgentMap();
      const pools = await listPools();
      // Carry block ordering alongside the ActivityEvent for stable global
      // ordering across pools. blockNumber + logIndex is monotonic per chain.
      type WithOrder = ActivityEvent & { _block: bigint; _logIdx: number };
      const events: WithOrder[] = [];

      for (const { marketId, pool } of pools) {
        const [bets, resolutions, refunds] = await Promise.all([
          client.getLogs({ address: pool, event: BET_PLACED, fromBlock: 0n, toBlock: "latest" }),
          client.getLogs({ address: pool, event: MARKET_RESOLVED, fromBlock: 0n, toBlock: "latest" }),
          client.getLogs({ address: pool, event: REFUNDED, fromBlock: 0n, toBlock: "latest" }),
        ]);
        for (const log of bets) {
          const side = Number(log.args.side) === 0 ? "YES" : "NO";
          const bettor = (log.args.bettor as string).toLowerCase();
          const handle = agentMap.get(bettor);
          events.push({
            id: `${log.transactionHash}-${log.logIndex}`,
            kind: handle ? "ai-lp" : "bet",
            chainId,
            transactionHash: log.transactionHash ?? undefined,
            side,
            amountUsd: Number(log.args.amount) / USDC_UNITS,
            walletShort: shortenAddr(bettor),
            agentHandle: handle,
            marketTitle: `Market ${marketId}`,
            atIso: await tsForLog(log),
            _block: log.blockNumber ?? 0n,
            _logIdx: log.logIndex ?? 0,
          });
        }
        for (const log of resolutions) {
          const side = Number(log.args.side) === 0 ? "YES" : "NO";
          events.push({
            id: `${log.transactionHash}-${log.logIndex}`,
            kind: "resolution",
            chainId,
            transactionHash: log.transactionHash ?? undefined,
            resolvedAs: side,
            marketTitle: `Market ${marketId}`,
            atIso: await tsForLog(log),
            _block: log.blockNumber ?? 0n,
            _logIdx: log.logIndex ?? 0,
          });
        }
        for (const log of refunds) {
          const bettor = (log.args.bettor as string).toLowerCase();
          events.push({
            id: `${log.transactionHash}-${log.logIndex}`,
            kind: "refund",
            chainId,
            transactionHash: log.transactionHash ?? undefined,
            amountUsd: Number(log.args.amount) / USDC_UNITS,
            walletShort: shortenAddr(bettor),
            marketTitle: `Market ${marketId}`,
            atIso: await tsForLog(log),
            _block: log.blockNumber ?? 0n,
            _logIdx: log.logIndex ?? 0,
          });
        }
      }

      // Global ordering by (blockNumber DESC, logIndex DESC) - newest first.
      events.sort((a, b) => {
        if (a._block !== b._block) return a._block < b._block ? 1 : -1;
        return b._logIdx - a._logIdx;
      });
      return events.slice(0, limit).map(({ _block: _b, _logIdx: _l, ...rest }) => {
        void _b; void _l;
        return rest;
      });
    },

    subscribe(callback: (event: ActivityEvent) => void): Unsubscribe {
      let cancelled = false;
      const unwatchers: Array<() => void> = [];

      (async () => {
        if (cancelled) return;
        const pools = await listPools();
        if (cancelled) return;

        for (const { marketId, pool } of pools) {
          const u1 = client.watchContractEvent({
            address: pool,
            abi: ParimutuelPoolAbi,
            eventName: "BetPlaced",
            onLogs: async (logs) => {
              for (const log of logs as Array<Log & { args: { bettor: string; side: number | bigint; amount: bigint } }>) {
                const side = Number(log.args.side) === 0 ? "YES" : "NO";
                callback({
                  id: `${log.transactionHash}-${log.logIndex}`,
                  kind: "bet",
                  chainId,
                  transactionHash: log.transactionHash ?? undefined,
                  side,
                  amountUsd: Number(log.args.amount) / USDC_UNITS,
                  walletShort: log.args.bettor ? shortenAddr(log.args.bettor) : undefined,
                  marketTitle: `Market ${marketId}`,
                  atIso: await tsForLog(log),
                });
              }
            },
          });
          const u2 = client.watchContractEvent({
            address: pool,
            abi: ParimutuelPoolAbi,
            eventName: "MarketResolved",
            onLogs: async (logs) => {
              for (const log of logs as Array<Log & { args: { side: number | bigint } }>) {
                const side = Number(log.args.side) === 0 ? "YES" : "NO";
                callback({
                  id: `${log.transactionHash}-${log.logIndex}`,
                  kind: "resolution",
                  chainId,
                  transactionHash: log.transactionHash ?? undefined,
                  resolvedAs: side,
                  marketTitle: `Market ${marketId}`,
                  atIso: await tsForLog(log),
                });
              }
            },
          });
          const u3 = client.watchContractEvent({
            address: pool,
            abi: ParimutuelPoolAbi,
            eventName: "Refunded",
            onLogs: async (logs) => {
              for (const log of logs as Array<Log & { args: { bettor: string; amount: bigint } }>) {
                callback({
                  id: `${log.transactionHash}-${log.logIndex}`,
                  kind: "refund",
                  chainId,
                  transactionHash: log.transactionHash ?? undefined,
                  amountUsd: Number(log.args.amount) / USDC_UNITS,
                  walletShort: log.args.bettor ? shortenAddr(log.args.bettor) : undefined,
                  marketTitle: `Market ${marketId}`,
                  atIso: await tsForLog(log),
                });
              }
            },
          });
          unwatchers.push(u1, u2, u3);
        }
      })();

      return () => {
        cancelled = true;
        for (const u of unwatchers) u();
      };
    },
  };
}


