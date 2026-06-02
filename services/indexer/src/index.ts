import { createPublicClient, http, parseEventLogs, type Address, type Hex } from "viem";
import { query } from "./db";

const config = readIndexerConfig();
const client = createPublicClient({ transport: http(config.rpcUrl) });

const poolAbi = [
  {
    type: "function",
    name: "getYesPct",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getTotalVolume",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getBettorCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "resolved",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "resolvedSide",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

const poolEventAbi = [
  {
    type: "event",
    name: "BetPlaced",
    inputs: [
      { indexed: true, name: "bettor", type: "address" },
      { indexed: false, name: "side", type: "uint8" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: true, name: "positionId", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "MarketResolved",
    inputs: [{ indexed: false, name: "side", type: "uint8" }],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { indexed: true, name: "bettor", type: "address" },
      { indexed: true, name: "positionId", type: "uint256" },
      { indexed: false, name: "payout", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Refunded",
    inputs: [
      { indexed: true, name: "bettor", type: "address" },
      { indexed: true, name: "positionId", type: "uint256" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
] as const;

const aiJudgeVerifierEventAbi = [
  {
    type: "event",
    name: "Proposed",
    inputs: [
      { indexed: true, name: "pool", type: "address" },
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: false, name: "outcome", type: "uint8" },
      { indexed: false, name: "evidenceHash", type: "bytes32" },
      { indexed: false, name: "proposedAt", type: "uint64" },
    ],
  },
  {
    type: "event",
    name: "Finalized",
    inputs: [
      { indexed: true, name: "pool", type: "address" },
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: false, name: "outcome", type: "uint8" },
      { indexed: false, name: "evidenceHash", type: "bytes32" },
    ],
  },
] as const;

type MarketRow = {
  id: string;
  pool_address: string;
  chain_id: number;
  resolver_address: string | null;
};

async function syncOnce() {
  await assertRpcChain();
  const head = await client.getBlockNumber();
  // Confirmation depth: stay this many blocks behind head so the events
  // we index are extremely unlikely to be reorged out underneath us.
  const safeHead = head > config.confirmations ? head - config.confirmations : 0n;

  // Reorg detection: compare the persisted block hash for `last_block`
  // against the current chain. If they diverge, rewind by 2x the
  // confirmation depth and replay.
  const cursor = await getIndexerCursor();
  if (cursor.lastBlock > 0n && cursor.lastBlockHash) {
    try {
      const onChain = await client.getBlock({ blockNumber: cursor.lastBlock });
      if (onChain.hash.toLowerCase() !== cursor.lastBlockHash.toLowerCase()) {
        const rewindTo =
          cursor.lastBlock > config.confirmations * 2n
            ? cursor.lastBlock - config.confirmations * 2n
            : 0n;
        console.warn(
          `[indexer] reorg detected at block ${cursor.lastBlock}: stored hash ${cursor.lastBlockHash} != chain ${onChain.hash}. Rewinding to ${rewindTo}.`,
        );
        await writeIndexerStatus({
          lastBlock: rewindTo,
          lastBlockHash: null,
          status: "reorg",
          error: `reorg at block ${cursor.lastBlock}`,
          reorged: true,
        });
        cursor.lastBlock = rewindTo;
        cursor.lastBlockHash = null;
      }
    } catch (error) {
      console.warn(
        `[indexer] cursor probe failed at block ${cursor.lastBlock}: ${(error as Error).message}`,
      );
    }
  }

  const fromBlock = cursor.lastBlock === 0n ? 0n : cursor.lastBlock + 1n;
  const toBlock =
    fromBlock > safeHead
      ? safeHead
      : min(safeHead, fromBlock + config.maxBlockRange - 1n);

  const markets = await query<MarketRow>(
    "SELECT id, pool_address, chain_id, resolver_address FROM markets WHERE pool_address IS NOT NULL AND chain_id = $1 ORDER BY created_at ASC",
    [config.chainId]
  );

  for (const market of markets.rows) {
    await syncMarketState(market);
    if (fromBlock <= toBlock) {
      await syncMarketEvents(market, fromBlock, toBlock);
    }
  }

  // Record the hash of the new cursor for the next reorg probe. Skip when
  // we did not advance (toBlock === current cursor.lastBlock) to avoid a
  // useless RPC call.
  let newHash: string | null = cursor.lastBlockHash;
  if (toBlock > cursor.lastBlock && toBlock > 0n) {
    try {
      const tip = await client.getBlock({ blockNumber: toBlock });
      newHash = tip.hash;
    } catch (error) {
      console.warn(
        `[indexer] failed to capture tip hash at ${toBlock}: ${(error as Error).message}`,
      );
    }
  }

  await writeIndexerStatus({
    lastBlock: toBlock,
    lastBlockHash: newHash,
    status: "ok",
    error: null,
    reorged: false,
  });
}

async function writeIndexerStatus(input: {
  lastBlock: bigint;
  lastBlockHash: string | null;
  status: "ok" | "reorg" | "error";
  error: string | null;
  reorged: boolean;
}) {
  await query(
    `INSERT INTO indexer_state (id, chain_id, last_block, last_block_hash, last_status, last_error, last_reorg_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN now() ELSE NULL END, now())
     ON CONFLICT (id) DO UPDATE SET
       last_block = EXCLUDED.last_block,
       last_block_hash = EXCLUDED.last_block_hash,
       last_status = EXCLUDED.last_status,
       last_error = EXCLUDED.last_error,
       last_reorg_at = COALESCE(EXCLUDED.last_reorg_at, indexer_state.last_reorg_at),
       updated_at = now()
     WHERE indexer_state.chain_id = EXCLUDED.chain_id`,
    [
      config.indexerId,
      config.chainId,
      input.lastBlock.toString(),
      input.lastBlockHash,
      input.status,
      input.error,
      input.reorged,
    ]
  );
}

async function getIndexerCursor(): Promise<{
  lastBlock: bigint;
  lastBlockHash: string | null;
}> {
  const result = await query<{ last_block: string; last_block_hash: string | null }>(
    "SELECT last_block, last_block_hash FROM indexer_state WHERE id = $1 AND chain_id = $2",
    [config.indexerId, config.chainId]
  );
  const row = result.rows[0];
  return {
    lastBlock: row ? BigInt(row.last_block) : 0n,
    lastBlockHash: row?.last_block_hash ?? null,
  };
}

export async function backfill(fromBlock: bigint, toBlock: bigint) {
  await assertRpcChain();
  console.log(
    `[indexer] backfill chain=${config.chainId} from=${fromBlock} to=${toBlock}`,
  );
  const markets = await query<MarketRow>(
    "SELECT id, pool_address, chain_id, resolver_address FROM markets WHERE pool_address IS NOT NULL AND chain_id = $1 ORDER BY created_at ASC",
    [config.chainId]
  );
  for (const market of markets.rows) {
    await syncMarketState(market);
    await syncMarketEvents(market, fromBlock, toBlock);
  }
  console.log(
    `[indexer] backfill complete: ${markets.rows.length} markets, blocks ${fromBlock}..${toBlock}`,
  );
}

async function syncMarketState(market: MarketRow) {
  const address = market.pool_address as Address;
  const [yesPctRaw, totalVolumeRaw, bettorCountRaw, resolved, resolvedSideRaw] = await Promise.all([
    client.readContract({ address, abi: poolAbi, functionName: "getYesPct" }),
    client.readContract({ address, abi: poolAbi, functionName: "getTotalVolume" }),
    client.readContract({ address, abi: poolAbi, functionName: "getBettorCount" }),
    client.readContract({ address, abi: poolAbi, functionName: "resolved" }),
    client.readContract({ address, abi: poolAbi, functionName: "resolvedSide" }),
  ]);

  const yesProbability = Number(yesPctRaw) / 100;
  const volumeUsd = Number(totalVolumeRaw) / 1_000_000;
  const bettors = Number(bettorCountRaw);
  const resolvedOutcome = Number(resolvedSideRaw) === 0 ? "YES" : "NO";

  await query(
    `INSERT INTO market_stats (market_id, volume_usd, yes_probability, bettors, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (market_id) DO UPDATE SET
       volume_usd = EXCLUDED.volume_usd,
       yes_probability = EXCLUDED.yes_probability,
       yes_probability_change_1h = EXCLUDED.yes_probability - market_stats.yes_probability,
       bettors = EXCLUDED.bettors,
       is_hot = EXCLUDED.volume_usd >= 100 OR EXCLUDED.bettors >= 5,
       updated_at = now()`,
    [market.id, volumeUsd, yesProbability, bettors]
  );

  await query(
    `INSERT INTO market_timeline (id, market_id, yes_probability, volume_usd, event_kind, chain_id)
     VALUES ($1, $2, $3, $4, 'snapshot', $5)
     ON CONFLICT (id) DO NOTHING`,
    [`${market.id}:snapshot:${Math.floor(Date.now() / 60_000)}`, market.id, yesProbability, volumeUsd, config.chainId]
  );

  if (resolved) {
    await query(
      "UPDATE markets SET status = 'resolved', resolved_outcome = $2, updated_at = now() WHERE id = $1",
      [market.id, resolvedOutcome]
    );
  }
}

async function syncMarketEvents(market: MarketRow, fromBlock: bigint, toBlock: bigint) {
  const logs = await client.getLogs({
    address: market.pool_address as Address,
    fromBlock,
    toBlock,
  });
  const verifierLogs = market.resolver_address
    ? await client.getLogs({
        address: market.resolver_address as Address,
        fromBlock,
        toBlock,
      })
    : [];
  if (logs.length === 0 && verifierLogs.length === 0) return;

  const proposedEvents = parseEventLogs({ abi: aiJudgeVerifierEventAbi, eventName: "Proposed", logs: verifierLogs });
  for (const event of proposedEvents) {
    const args = event.args as { pool: Address; marketId: bigint; outcome: number; evidenceHash: Hex; proposedAt: bigint };
    if (args.pool.toLowerCase() !== market.pool_address.toLowerCase()) continue;
    const tx = await client.getTransaction({ hash: event.transactionHash });
    await query(
      `UPDATE markets SET
         status = CASE WHEN status = 'resolved' THEN status ELSE 'resolving' END,
         resolution_evidence_hash = $2,
         resolution_proposer = $3,
         resolution_proposed_at = to_timestamp($4),
         resolution_proof_tx_hash = $5,
         updated_at = now()
       WHERE id = $1`,
      [market.id, args.evidenceHash, tx.from, Number(args.proposedAt), event.transactionHash]
    );
  }

  const finalizedEvents = parseEventLogs({ abi: aiJudgeVerifierEventAbi, eventName: "Finalized", logs: verifierLogs });
  for (const event of finalizedEvents) {
    const args = event.args as { pool: Address; marketId: bigint; outcome: number; evidenceHash: Hex };
    if (args.pool.toLowerCase() !== market.pool_address.toLowerCase()) continue;
    const outcome = Number(args.outcome) === 0 ? "YES" : "NO";
    await query(
      `UPDATE markets SET
         status = 'resolved',
         resolved_outcome = $2,
         resolution_tx_hash = $3,
         resolution_evidence_hash = $4,
         resolution_proof_tx_hash = COALESCE(resolution_proof_tx_hash, $3),
         updated_at = now()
       WHERE id = $1`,
      [market.id, outcome, event.transactionHash, args.evidenceHash]
    );
  }

  const betEvents = parseEventLogs({ abi: poolEventAbi, eventName: "BetPlaced", logs });
  for (const event of betEvents) {
    const args = event.args as { bettor: Address; side: number; amount: bigint; positionId: bigint };
    const side = Number(args.side) === 0 ? "YES" : "NO";
    const amountUsd = Number(args.amount) / 1_000_000;
    const yesPctAtBlock = await readYesPct(market.pool_address as Address, event.blockNumber);
    const sidePrice = side === "YES" ? yesPctAtBlock / 100 : 1 - yesPctAtBlock / 100;
    const shares = sidePrice > 0 ? amountUsd / sidePrice : 0;
    const positionId = `${market.id}#${args.positionId.toString()}`;
    const txHash = event.transactionHash;
    const logIndex = logIndexNumber(event.logIndex);
    const blockNumber = Number(event.blockNumber);
    const blockHash = event.blockHash;
    const activityId = eventScopedId(txHash, "bet", args.positionId.toString(), String(logIndex));

    await query(
      `INSERT INTO positions (id, address, market_id, side, stake_usd, avg_price, shares, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         address = EXCLUDED.address,
         market_id = EXCLUDED.market_id,
         side = EXCLUDED.side,
         stake_usd = EXCLUDED.stake_usd,
         avg_price = EXCLUDED.avg_price,
         shares = EXCLUDED.shares,
         transaction_hash = EXCLUDED.transaction_hash,
         chain_id = EXCLUDED.chain_id,
         block_hash = EXCLUDED.block_hash,
         block_number = EXCLUDED.block_number,
         log_index = EXCLUDED.log_index,
         updated_at = now()`,
      [positionId, args.bettor, market.id, side, amountUsd, sidePrice, shares, txHash, config.chainId, blockHash, blockNumber, logIndex]
    );
    await query(
      `INSERT INTO activity_events (id, kind, market_id, side, amount_usd, wallet_short, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, 'bet', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [activityId, market.id, side, amountUsd, walletShort(args.bettor), txHash, config.chainId, blockHash, blockNumber, logIndex]
    );
    await insertTimelinePoint(market.id, "bet", txHash, event.blockNumber, blockHash, logIndex);
  }

  const resolutionEvents = parseEventLogs({ abi: poolEventAbi, eventName: "MarketResolved", logs });
  for (const event of resolutionEvents) {
    const args = event.args as { side: number };
    const outcome = Number(args.side) === 0 ? "YES" : "NO";
    const txHash = event.transactionHash;
    const logIndex = logIndexNumber(event.logIndex);
    const blockNumber = Number(event.blockNumber);
    const blockHash = event.blockHash;
    const activityId = eventScopedId(txHash, "resolution", String(logIndex));
    await query(
      "UPDATE markets SET status = 'resolved', resolved_outcome = $2, resolution_tx_hash = $3, updated_at = now() WHERE id = $1",
      [market.id, outcome, txHash]
    );
    await query(
      `INSERT INTO activity_events (id, kind, market_id, resolved_as, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, 'resolution', $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [activityId, market.id, outcome, txHash, config.chainId, blockHash, blockNumber, logIndex]
    );
    await query(
      "UPDATE positions SET status = CASE WHEN side = $2 THEN 'claimable' ELSE 'lost' END, updated_at = now() WHERE market_id = $1 AND status = 'open'",
      [market.id, outcome]
    );
    await createResolutionNotifications(market.id, outcome, txHash);
    await insertTimelinePoint(market.id, "resolution", txHash, event.blockNumber, blockHash, logIndex);
  }

  const claimEvents = parseEventLogs({ abi: poolEventAbi, eventName: "Claimed", logs });
  for (const event of claimEvents) {
    const args = event.args as { bettor: Address; positionId: bigint; payout: bigint };
    const positionId = `${market.id}#${args.positionId.toString()}`;
    const payoutUsd = Number(args.payout) / 1_000_000;
    const txHash = event.transactionHash;
    const logIndex = logIndexNumber(event.logIndex);
    const blockNumber = Number(event.blockNumber);
    const blockHash = event.blockHash;
    const claimId = eventScopedId(txHash, "claim", args.positionId.toString(), String(logIndex));
    await query(
      `INSERT INTO claims (id, position_id, payout_usd, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [claimId, positionId, payoutUsd, txHash, config.chainId, blockHash, blockNumber, logIndex]
    );
    await query(
      "UPDATE positions SET status = 'claimed', payout_usd = $2, updated_at = now() WHERE id = $1",
      [positionId, payoutUsd]
    );
    await query(
      `INSERT INTO activity_events (id, kind, market_id, amount_usd, wallet_short, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, 'claim', $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [`${claimId}:activity`, market.id, payoutUsd, walletShort(args.bettor), txHash, config.chainId, blockHash, blockNumber, logIndex]
    );
    await insertTimelinePoint(market.id, "claim", txHash, event.blockNumber, blockHash, logIndex);
  }

  const refundEvents = parseEventLogs({ abi: poolEventAbi, eventName: "Refunded", logs });
  for (const event of refundEvents) {
    const args = event.args as { bettor: Address; positionId: bigint; amount: bigint };
    const positionId = `${market.id}#${args.positionId.toString()}`;
    const amountUsd = Number(args.amount) / 1_000_000;
    const txHash = event.transactionHash;
    const logIndex = logIndexNumber(event.logIndex);
    const blockNumber = Number(event.blockNumber);
    const blockHash = event.blockHash;
    const refundId = eventScopedId(txHash, "refund", args.positionId.toString(), String(logIndex));
    await query(
      `INSERT INTO refunds (id, position_id, amount_usd, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [refundId, positionId, amountUsd, txHash, config.chainId, blockHash, blockNumber, logIndex]
    );
    await query(
      "UPDATE positions SET status = 'refunded', payout_usd = $2, updated_at = now() WHERE id = $1",
      [positionId, amountUsd]
    );
    await query(
      `INSERT INTO activity_events (id, kind, market_id, amount_usd, wallet_short, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, 'refund', $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [`${refundId}:activity`, market.id, amountUsd, walletShort(args.bettor), txHash, config.chainId, blockHash, blockNumber, logIndex]
    );
    await insertTimelinePoint(market.id, "refund", txHash, event.blockNumber, blockHash, logIndex);
  }
}

async function insertTimelinePoint(marketId: string, eventKind: string, transactionHash: Hex, blockNumber: bigint, blockHash: Hex, logIndex: number) {
  const market = await query<{ pool_address: string }>("SELECT pool_address FROM markets WHERE id = $1", [marketId]);
  const pool = market.rows[0]?.pool_address as Address | undefined;
  if (!pool) return;
  const [yesPctRaw, totalVolumeRaw] = await Promise.all([
    client.readContract({ address: pool, abi: poolAbi, functionName: "getYesPct", blockNumber }),
    client.readContract({ address: pool, abi: poolAbi, functionName: "getTotalVolume", blockNumber }),
  ]);
  await query(
    `INSERT INTO market_timeline (id, market_id, yes_probability, volume_usd, event_kind, transaction_hash, chain_id, block_hash, block_number, log_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING`,
    [
      `${marketId}:${eventKind}:${transactionHash}:${logIndex}`,
      marketId,
      Number(yesPctRaw) / 100,
      Number(totalVolumeRaw) / 1_000_000,
      eventKind,
      transactionHash,
      config.chainId,
      blockHash,
      Number(blockNumber),
      logIndex,
    ]
  );
}

async function readYesPct(pool: Address, blockNumber: bigint) {
  const yesPctRaw = await client.readContract({ address: pool, abi: poolAbi, functionName: "getYesPct", blockNumber });
  return Number(yesPctRaw) / 100;
}

function logIndexNumber(logIndex: number | bigint | undefined) {
  return typeof logIndex === "bigint" ? Number(logIndex) : logIndex ?? 0;
}

function eventScopedId(transactionHash: string, ...parts: string[]) {
  return [String(config.chainId), transactionHash, ...parts].join(":");
}

async function createResolutionNotifications(marketId: string, outcome: "YES" | "NO", transactionHash: Hex) {
  await query(
    `INSERT INTO notification_events (id, address, kind, market_id, title, body)
     SELECT $1 || ':' || lower(w.address), w.address, 'market_resolved', $2, 'Market resolved', 'Outcome: ' || $3
     FROM watchlist w
     JOIN user_settings s ON lower(s.address) = lower(w.address)
     WHERE w.market_id = $2
       AND s.notifications_enabled = true
     ON CONFLICT (id) DO NOTHING`,
    [`${transactionHash}:watchlist`, marketId, outcome]
  );
  await query(
    `INSERT INTO notification_events (id, address, kind, market_id, title, body)
     SELECT $1 || ':' || lower(p.address), p.address, 'payout_claimable', $2, 'Payout claimable', 'Your winning position can be claimed.'
     FROM positions p
     JOIN user_settings s ON lower(s.address) = lower(p.address)
     WHERE p.market_id = $2
       AND p.side = $3
       AND p.status = 'claimable'
       AND s.notifications_enabled = true
     ON CONFLICT (id) DO NOTHING`,
    [`${transactionHash}:claimable`, marketId, outcome]
  );
}

function walletShort(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function min(a: bigint, b: bigint) {
  return a < b ? a : b;
}

async function main() {
  // Mode dispatch via CLI argv:
  //   (no args)                      -> long-running indexer
  //   backfill <fromBlock> <toBlock> -> one-shot replay across a window
  const [mode, fromArg, toArg] = process.argv.slice(2);
  if (mode === "backfill") {
    if (!fromArg || !toArg || !/^\d+$/.test(fromArg) || !/^\d+$/.test(toArg)) {
      throw new Error(
        "Usage: tsx src/index.ts backfill <fromBlock> <toBlock>",
      );
    }
    await backfill(BigInt(fromArg), BigInt(toArg));
    return;
  }
  await assertIndexerIdAvailableForChain();
  await syncOnce();
  setInterval(() => {
    void syncOnce().catch(async (error) => {
      console.error(error);
      try {
        await writeIndexerStatus({
          lastBlock: (await getIndexerCursor()).lastBlock,
          lastBlockHash: (await getIndexerCursor()).lastBlockHash,
          status: "error",
          error: (error as Error).message,
          reorged: false,
        });
      } catch {
        /* swallow status-write failure to not mask the real error */
      }
    });
  }, config.intervalMs);
}

await main();

function readIndexerConfig() {
  return {
    rpcUrl: readRequiredEnv("INDEXER_RPC_URL"),
    chainId: readRequiredIntegerEnv("INDEXER_CHAIN_ID"),
    indexerId: readRequiredEnv("INDEXER_ID"),
    maxBlockRange: readRequiredPositiveBigIntEnv("INDEXER_MAX_BLOCK_RANGE"),
    intervalMs: readRequiredPositiveIntegerEnv("INDEXER_INTERVAL_MS"),
    // Defaults: 3 blocks (Arb Sepolia ~3s finality buffer).
    confirmations: readOptionalPositiveBigIntEnv("INDEXER_CONFIRMATIONS", 3n),
  };
}

function readOptionalPositiveBigIntEnv(name: string, fallback: bigint) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer.`);
  const parsed = BigInt(value);
  if (parsed < 0n) throw new Error(`${name} must be >= 0.`);
  return parsed;
}

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readRequiredIntegerEnv(name: string) {
  const value = readRequiredEnv(name);
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive safe integer.`);
  return parsed;
}

function readRequiredPositiveIntegerEnv(name: string) {
  return readRequiredIntegerEnv(name);
}

function readRequiredPositiveBigIntEnv(name: string) {
  const value = readRequiredEnv(name);
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer.`);
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`${name} must be greater than zero.`);
  return parsed;
}

async function assertRpcChain() {
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== config.chainId) {
    throw new Error(`INDEXER_CHAIN_ID ${config.chainId} does not match RPC chain id ${rpcChainId}.`);
  }
}

async function assertIndexerIdAvailableForChain() {
  const result = await query<{ chain_id: number }>("SELECT chain_id FROM indexer_state WHERE id = $1", [config.indexerId]);
  const existingChainId = result.rows[0]?.chain_id;
  if (existingChainId !== undefined && existingChainId !== config.chainId) {
    throw new Error(
      `INDEXER_ID ${config.indexerId} is already used for chain ${existingChainId}; use a distinct id for chain ${config.chainId}.`
    );
  }
}
