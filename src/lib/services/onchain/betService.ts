// On-chain BetService.
//
// previewBet():  reads pool state and computes parimutuel price + payout.
// placeBet():    verifies the submitted wallet tx by reading the on-chain
//                receipt and BetPlaced event. No local receipt IDs are minted.

import { createPublicClient, http, parseEventLogs, type Address, type Hex } from "viem";
import MarketFactoryAbi from "@/lib/abi/MarketFactory.json";
import ParimutuelPoolAbi from "@/lib/abi/ParimutuelPool.json";
import { parseContractMarketId, resolveDirectOnchainConfig } from "@/lib/onchain-config";
import type { BetPreviewInput, BetQuote, BetReceipt } from "@/lib/types/domain";
import type { BetService } from "../types";

const USDC_UNITS = 1_000_000;
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
        `On-chain bet service is configured for chain ${chainId}, but market ${marketId} targets chain ${requestedChainId}.`,
      );
    }
  } else if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new Error(`Market id ${marketId} must include the chain namespace ${chainId}:${marketId}.`);
  }
  return parseContractMarketId(marketId);
}

export function createOnchainBetService(): BetService {
  const { chain, rpcUrl, factoryAddress, chainId } =
    resolveDirectOnchainConfig("On-chain bet service");

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  async function poolFor(marketId: string): Promise<Address> {
    return (await client.readContract({
      address: factoryAddress!,
      abi: MarketFactoryAbi,
      functionName: "getMarket",
      args: [parseMarketIdForChain(marketId, chainId)],
    })) as Address;
  }

  return {
    async previewBet(input: BetPreviewInput): Promise<BetQuote> {
      const pool = await poolFor(input.marketId);
      if (pool === "0x0000000000000000000000000000000000000000") {
        throw new Error(`Market ${input.marketId} has no on-chain pool.`);
      }
      const [yesPool, noPool] = await Promise.all([
        client.readContract({ address: pool, abi: ParimutuelPoolAbi, functionName: "yesPool" }),
        client.readContract({ address: pool, abi: ParimutuelPoolAbi, functionName: "noPool" }),
      ]);
      const yes = Number(yesPool) / USDC_UNITS;
      const no = Number(noPool) / USDC_UNITS;
      const total = yes + no;
      const sideStake = input.side === "YES" ? yes : no;
      const otherStake = input.side === "YES" ? no : yes;

      const price = total > 0 ? sideStake / total : 0.5;
      const shares = input.stakeUsd;
      const newSideStake = sideStake + input.stakeUsd;
      const payoutIfWin =
        newSideStake > 0
          ? input.stakeUsd + (input.stakeUsd / newSideStake) * otherStake
          : input.stakeUsd;
      const newTotal = total + input.stakeUsd;
      const poolImpactPct = newTotal > 0 ? (input.stakeUsd / newTotal) * 100 : 100;

      return {
        ...input,
        price,
        shares,
        potentialPayoutUsd: payoutIfWin,
        poolImpactPct,
        requiredContract: pool,
        requiredFunction: "bet(uint8,uint256)",
        chainId,
      };
    },

    async placeBet(quote: BetQuote): Promise<BetReceipt> {
      if (quote.chainId !== chainId) {
        throw new Error(
          quote.chainId === undefined
            ? `On-chain placeBet requires quote.chainId for configured chain ${chainId}.`
            : `On-chain placeBet configured for chain ${chainId}, but quote targets chain ${quote.chainId}.`,
        );
      }
      if (!quote.transactionHash) {
        throw new Error(
          "On-chain placeBet expects quote.transactionHash (set by client wallet write).",
        );
      }
      if (!quote.requiredContract) {
        throw new Error("On-chain placeBet expects quote.requiredContract.");
      }
      const pool = await poolFor(quote.marketId);
      if (pool === "0x0000000000000000000000000000000000000000") {
        throw new Error(`Market ${quote.marketId} has no on-chain pool.`);
      }
      if (pool.toLowerCase() !== quote.requiredContract.toLowerCase()) {
        throw new Error(
          `Quote contract ${quote.requiredContract} does not match market ${quote.marketId} pool ${pool} on chain ${chainId}.`,
        );
      }
      const receipt = await client.getTransactionReceipt({ hash: quote.transactionHash as Hex });
      if (receipt.status !== "success") throw new Error("Bet transaction reverted.");
      const events = parseEventLogs({
        abi: ParimutuelPoolAbi,
        eventName: "BetPlaced",
        logs: receipt.logs,
      }) as unknown as Array<{ address: string; args: { side: number | bigint; positionId: bigint } }>;
      const poolEvents = events.filter((event) => event.address.toLowerCase() === pool.toLowerCase());
      const matched = poolEvents.find((event) => {
        const args = event.args as { side: number; positionId: bigint };
        const expectedSide = quote.side === "YES" ? 0 : 1;
        const expectedPositionId = quote.positionId?.split("#").at(-1);
        return (
          Number(args.side) === expectedSide &&
          (!expectedPositionId || args.positionId.toString() === expectedPositionId)
        );
      });
      if (!matched) throw new Error("BetPlaced event was not found in the confirmed transaction.");
      const args = matched.args as { positionId: bigint };
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      const positionId = `${quote.marketId}#${args.positionId.toString()}`;
      return {
        id: quote.transactionHash,
        marketId: quote.marketId,
        positionId,
        activityId: `${quote.transactionHash}:bet:${args.positionId.toString()}`,
        status: "confirmed",
        createdAtIso: new Date(Number(block.timestamp) * 1000).toISOString(),
      };
    },
  };
}


