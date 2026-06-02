// On-chain OracleService - reads ParimutuelPool.resolved/resolvedSide
// and timestamps via the MarketResolved log.

import {
  createPublicClient,
  http,
  type Address,
  parseAbiItem,
} from "viem";
import MarketFactoryAbi from "@/lib/abi/MarketFactory.json";
import ParimutuelPoolAbi from "@/lib/abi/ParimutuelPool.json";
import { parseContractMarketId, resolveDirectOnchainConfig } from "@/lib/onchain-config";
import type { ResolutionResult } from "@/lib/types/domain";
import type { OracleService } from "../types";

const MARKET_RESOLVED = parseAbiItem("event MarketResolved(uint8 side)");
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

function parseMarketIdForChain(marketId: string, chainId: number): bigint {
  const parts = marketId.split(":");
  if (parts.length > 2) {
    throw new Error(`Market id ${marketId} must be marketId or chainId:marketId.`);
  }
  if (parts.length === 2) {
    const requestedChainId = Number(parts[0]);
    if (!Number.isInteger(requestedChainId) || requestedChainId <= 0) {
      throw new Error(`Market id ${marketId} has an invalid chain id namespace.`);
    }
    if (requestedChainId !== chainId) {
      throw new Error(
        `OracleService is configured for chain ${chainId}, but market ${marketId} targets chain ${requestedChainId}.`,
      );
    }
  } else if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new Error(`Market id ${marketId} must include the chain namespace ${chainId}:${marketId}.`);
  }
  return parseContractMarketId(marketId);
}

export function createOnchainOracleService(): OracleService {
  const config = resolveDirectOnchainConfig("OracleService");

  const client = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  return {
    async getResolution(marketId: string): Promise<ResolutionResult | "pending"> {
      const contractMarketId = parseMarketIdForChain(marketId, config.chainId);
      const pool = (await client.readContract({
        address: config.factoryAddress,
        abi: MarketFactoryAbi,
        functionName: "getMarket",
        args: [contractMarketId],
      })) as Address;
      if (pool === "0x0000000000000000000000000000000000000000") return "pending";

      const [resolved, resolvedSide] = await Promise.all([
        client.readContract({ address: pool, abi: ParimutuelPoolAbi, functionName: "resolved" }),
        client.readContract({ address: pool, abi: ParimutuelPoolAbi, functionName: "resolvedSide" }),
      ]);
      if (!resolved) return "pending";

      const logs = await client.getLogs({
        address: pool,
        event: MARKET_RESOLVED,
        fromBlock: 0n,
        toBlock: "latest",
      });
      const last = logs[logs.length - 1];
      let resolvedAtIso = new Date().toISOString();
      if (last) {
        const block = await client.getBlock({ blockHash: last.blockHash! });
        resolvedAtIso = new Date(Number(block.timestamp) * 1000).toISOString();
      }
      return {
        side: Number(resolvedSide) === 0 ? "YES" : "NO",
        resolvedAtIso,
      };
    },
  };
}


