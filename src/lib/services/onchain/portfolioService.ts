// On-chain PortfolioService.
//
// Positions = ParimutuelPool.BetPlaced logs filtered by bettor=address.
// History  = positions where the host pool is resolved.
// claim()  = verifies the wallet tx by reading the Claimed event from RPC.

import {
  createPublicClient,
  http,
  type Address,
  parseAbiItem,
  getAddress,
  parseEventLogs,
  type Hex,
} from "viem";
import MarketFactoryAbi from "@/lib/abi/MarketFactory.json";
import ParimutuelPoolAbi from "@/lib/abi/ParimutuelPool.json";
import {
  displayMarketIdForChain,
  parseContractMarketId,
  resolveDirectOnchainConfig,
} from "@/lib/onchain-config";
import type { ClaimReceipt, HistoryRow, Position } from "@/lib/types/domain";
import type { PortfolioService } from "../types";

const BET_PLACED = parseAbiItem(
  "event BetPlaced(address indexed bettor, uint8 side, uint256 amount, uint256 indexed positionId)",
);
const REFUNDED = parseAbiItem(
  "event Refunded(address indexed bettor, uint256 indexed positionId, uint256 amount)",
);
const USDC_UNITS = 1_000_000;

export function createOnchainPortfolioService(): PortfolioService {
  const { chain, rpcUrl, factoryAddress, chainId } =
    resolveDirectOnchainConfig("On-chain portfolio service");

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  async function listPools(): Promise<{ marketId: string; pool: Address }[]> {
    const next = (await client.readContract({
      address: factoryAddress!,
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

  async function loadPositions(address: string): Promise<Position[]> {
    const checksum = getAddress(address);
    const pools = await listPools();
    const positions: Position[] = [];

    for (const { marketId, pool } of pools) {
      const [logs, refundLogs, resolved, resolvedSide] = await Promise.all([
        client.getLogs({
          address: pool,
          event: BET_PLACED,
          args: { bettor: checksum },
          fromBlock: 0n,
          toBlock: "latest",
        }),
        client.getLogs({
          address: pool,
          event: REFUNDED,
          args: { bettor: checksum },
          fromBlock: 0n,
          toBlock: "latest",
        }),
        client.readContract({ address: pool, abi: ParimutuelPoolAbi, functionName: "resolved" }),
        client.readContract({ address: pool, abi: ParimutuelPoolAbi, functionName: "resolvedSide" }),
      ]);
      const isResolved = resolved as boolean;
      const winningSide = Number(resolvedSide);
      const refundsByPosition = new Map(
        refundLogs.map((log) => [
          (log.args.positionId as bigint).toString(),
          {
            amountUsd: Number(log.args.amount) / USDC_UNITS,
            transactionHash: log.transactionHash ?? undefined,
          },
        ]),
      );

      // Read on-chain claimed flag for each position. Pool's positions(id)
      // returns (bettor, side, amount, claimed). Also read yesPool/noPool at
      // the block BEFORE the bet so we can derive the real entry probability
      // (parimutuel implied price = side's share of total pool pre-trade).
      const positionLookups = await Promise.all(
        logs.map(async (log) => {
          const onChainPosId = log.args.positionId as bigint;
          const betBlock = log.blockNumber!;
          const preBlock = betBlock > 0n ? betBlock - 1n : 0n;
          const [tuple, block, preYes, preNo] = await Promise.all([
            client.readContract({
              address: pool,
              abi: ParimutuelPoolAbi,
              functionName: "positions",
              args: [onChainPosId],
            }) as Promise<readonly [Address, number, bigint, boolean]>,
            client.getBlock({ blockHash: log.blockHash! }),
            client.readContract({
              address: pool,
              abi: ParimutuelPoolAbi,
              functionName: "yesPool",
              blockNumber: preBlock,
            }) as Promise<bigint>,
            client.readContract({
              address: pool,
              abi: ParimutuelPoolAbi,
              functionName: "noPool",
              blockNumber: preBlock,
            }) as Promise<bigint>,
          ]);
          return {
            log,
            onChainPosId,
            claimed: tuple[3],
            block,
            preYes,
            preNo,
          };
        }),
      );

      for (const {
        log,
        onChainPosId,
        claimed,
        block,
        preYes,
        preNo,
      } of positionLookups) {
        const side = Number(log.args.side) === 0 ? "YES" : "NO";
        const amount = Number(log.args.amount) / USDC_UNITS;
        const createdAtIso = new Date(Number(block.timestamp) * 1000).toISOString();
        const positionId = `${marketId}#${onChainPosId.toString()}`;
        const refund = refundsByPosition.get(onChainPosId.toString());

        // Implied entry price = the side's share of the pool at the block
        // BEFORE the bet. Empty pool -> 0.5 (both outcomes equally likely
        // under parimutuel before any liquidity).
        const totalPre = preYes + preNo;
        let avgPrice: number;
        if (totalPre === 0n) {
          avgPrice = 0.5;
        } else if (side === "YES") {
          avgPrice = Number(preYes) / Number(totalPre);
        } else {
          avgPrice = Number(preNo) / Number(totalPre);
        }

        let status: Position["status"];
        if (refund) {
          status = "refunded";
        } else if (claimed) {
          status = "claimed";
        } else if (isResolved) {
          const won =
            (side === "YES" && winningSide === 0) ||
            (side === "NO" && winningSide === 1);
          status = won ? "claimable" : "lost";
        } else {
          status = "open";
        }

        positions.push({
          id: positionId,
          address: checksum,
          marketId,
          chainId,
          side,
          stakeUsd: amount,
          avgPrice,
          shares: amount,
          status,
          createdAtIso,
          transactionHash: refund?.transactionHash ?? log.transactionHash ?? undefined,
          payoutUsd: refund?.amountUsd,
        });
      }
    }
    return positions;
  }

  return {
    getPositions: loadPositions,

    async getHistory(address: string): Promise<HistoryRow[]> {
      const positions = await loadPositions(address);
      return positions
        .filter((p) => p.status !== "open")
        .map((p) => ({
          id: `hist-${p.id}`,
          positionId: p.id,
          marketId: p.marketId,
          chainId: p.chainId,
          side: p.side,
          stakeUsd: p.stakeUsd,
          payoutUsd: p.status === "lost" ? 0 : (p.payoutUsd ?? p.stakeUsd),
          createdAtIso: p.createdAtIso,
        }));
    },

    async claim(
      positionId: string,
      transactionHash?: `0x${string}`,
      requestedChainId?: number,
    ): Promise<ClaimReceipt> {
      if (!transactionHash) {
        throw new Error("On-chain claim expects transactionHash from the wallet write.");
      }
      if (requestedChainId !== undefined && requestedChainId !== chainId) {
        throw new Error(
          `On-chain claim configured for chain ${chainId}, but the wallet transaction was submitted on chain ${requestedChainId}.`,
        );
      }
      const [marketId, rawPositionId] = positionId.split("#");
      if (!marketId || !rawPositionId) throw new Error("Position id must be marketId#positionId.");
      const pool = (await client.readContract({
        address: factoryAddress!,
        abi: MarketFactoryAbi,
        functionName: "getMarket",
        args: [parseContractMarketId(marketId)],
      })) as Address;
      if (pool === "0x0000000000000000000000000000000000000000") {
        throw new Error(`Market ${marketId} has no on-chain pool.`);
      }
      const receipt = await client.getTransactionReceipt({ hash: transactionHash as Hex });
      if (receipt.status !== "success") throw new Error("Claim transaction reverted.");
      const events = parseEventLogs({
        abi: ParimutuelPoolAbi,
        eventName: "Claimed",
        logs: receipt.logs,
      }) as unknown as Array<{ address: string; args: { positionId: bigint; payout: bigint } }>;
      const poolEvents = events.filter((event) => event.address.toLowerCase() === pool.toLowerCase());
      const matched = poolEvents.find((event) => {
        const args = event.args as { positionId: bigint };
        return args.positionId.toString() === rawPositionId;
      });
      if (!matched) throw new Error("Claimed event was not found in the confirmed transaction.");
      const args = matched.args as { payout: bigint; positionId: bigint };
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      return {
        id: `${transactionHash}:claim:${args.positionId.toString()}`,
        positionId,
        payoutUsd: Number(args.payout) / USDC_UNITS,
        status: "claimed",
        createdAtIso: new Date(Number(block.timestamp) * 1000).toISOString(),
      };
    },
  };
}


