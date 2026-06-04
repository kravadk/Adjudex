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
  { type: "function", name: "yesReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "noReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "yesShares", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "noShares", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
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
  {
    type: "event",
    name: "SharesBought",
    inputs: [
      { indexed: true, name: "trader", type: "address" },
      { indexed: false, name: "side", type: "uint8" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "shares", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "SharesSold",
    inputs: [
      { indexed: true, name: "trader", type: "address" },
      { indexed: false, name: "side", type: "uint8" },
      { indexed: false, name: "shares", type: "uint256" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "LiquidityAdded",
    inputs: [
      { indexed: true, name: "provider", type: "address" },
      { indexed: false, name: "yesAmount", type: "uint256" },
      { indexed: false, name: "noAmount", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "VaultSeeded",
    inputs: [
      { indexed: false, name: "yesAmount", type: "uint256" },
      { indexed: false, name: "noAmount", type: "uint256" },
    ],
  },
] as const;

const orderMatcherEventAbi = [
  {
    type: "event",
    name: "OrderFilled",
    inputs: [
      { indexed: true, name: "makerHash", type: "bytes32" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "shares", type: "uint256" },
      { indexed: false, name: "cost", type: "uint256" },
    ],
  },
] as const;

const optimisticOracleEventAbi = [
  {
    type: "event",
    name: "OutcomeAsserted",
    inputs: [
      { indexed: true, name: "pool", type: "address" },
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "asserter", type: "address" },
      { indexed: false, name: "outcome", type: "uint8" },
      { indexed: false, name: "evidenceHash", type: "bytes32" },
      { indexed: false, name: "bond", type: "uint256" },
      { indexed: false, name: "liveness", type: "uint64" },
    ],
  },
  {
    type: "event",
    name: "OutcomeDisputed",
    inputs: [
      { indexed: true, name: "pool", type: "address" },
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "disputer", type: "address" },
      { indexed: false, name: "bond", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "OutcomeSettled",
    inputs: [
      { indexed: true, name: "pool", type: "address" },
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: false, name: "outcome", type: "uint8" },
      { indexed: true, name: "asserter", type: "address" },
    ],
  },
  {
    type: "event",
    name: "DisputeArbitrated",
    inputs: [
      { indexed: true, name: "pool", type: "address" },
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: false, name: "finalOutcome", type: "uint8" },
      { indexed: true, name: "winner", type: "address" },
      { indexed: false, name: "payout", type: "uint256" },
    ],
  },
] as const;

const registryEventAbi = [
  {
    type: "event",
    name: "OutcomeGroupCreated",
    inputs: [
      { indexed: true, name: "groupId", type: "uint256" },
      { indexed: false, name: "title", type: "string" },
    ],
  },
  {
    type: "event",
    name: "GroupOutcomeLinked",
    inputs: [
      { indexed: true, name: "groupId", type: "uint256" },
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: false, name: "label", type: "string" },
    ],
  },
  {
    type: "event",
    name: "GroupResolved",
    inputs: [
      { indexed: true, name: "groupId", type: "uint256" },
      { indexed: true, name: "winningMarketId", type: "uint256" },
    ],
  },
] as const;

const vaultEventAbi = [
  {
    type: "event",
    name: "MarketRegistered",
    inputs: [
      { indexed: true, name: "market", type: "address" },
      { indexed: false, name: "seedAmount", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "DebtRepaid",
    inputs: [
      { indexed: true, name: "market", type: "address" },
      { indexed: false, name: "repaid", type: "uint256" },
      { indexed: false, name: "surplus", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "SurplusClaimed",
    inputs: [
      { indexed: true, name: "market", type: "address" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
] as const;

// Per-market vault accounting is read straight off the vault's public mappings
// after any event, so the indexed debt/surplus can't drift from the chain.
const vaultReadAbi = [
  { type: "function", name: "marketDebt", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "marketSurplus", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
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
    name: "Challenged",
    inputs: [
      { indexed: true, name: "pool", type: "address" },
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "challenger", type: "address" },
    ],
  },
  {
    type: "event",
    name: "ProposalReset",
    inputs: [
      { indexed: true, name: "pool", type: "address" },
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: false, name: "evidenceHash", type: "bytes32" },
    ],
  },
  {
    type: "event",
    name: "ProposalEscalated",
    inputs: [
      { indexed: true, name: "pool", type: "address" },
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "challenger", type: "address" },
    ],
  },
  {
    type: "event",
    name: "ChallengeBondPosted",
    inputs: [
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "challenger", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
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
  liquidity_mode: "parimutuel" | "amm";
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
    "SELECT id, pool_address, chain_id, resolver_address, liquidity_mode FROM markets WHERE pool_address IS NOT NULL AND chain_id = $1 ORDER BY created_at ASC",
    [config.chainId]
  );

  for (const market of markets.rows) {
    await syncMarketState(market);
    if (fromBlock <= toBlock) {
      await syncMarketEvents(market, fromBlock, toBlock);
    }
  }

  // Chain-wide singletons are indexed once per window rather than per market.
  if (fromBlock <= toBlock) {
    if (config.orderMatcherAddress) await syncOrderFills(fromBlock, toBlock);
    if (config.exclusiveOutcomeRegistryAddress) await syncOutcomeGroups(fromBlock, toBlock);
    if (config.liquidityVaultAddress) await syncVault(fromBlock, toBlock);
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
    "SELECT id, pool_address, chain_id, resolver_address, liquidity_mode FROM markets WHERE pool_address IS NOT NULL AND chain_id = $1 ORDER BY created_at ASC",
    [config.chainId]
  );
  for (const market of markets.rows) {
    await syncMarketState(market);
    await syncMarketEvents(market, fromBlock, toBlock);
  }
  if (config.orderMatcherAddress) await syncOrderFills(fromBlock, toBlock);
  if (config.exclusiveOutcomeRegistryAddress) await syncOutcomeGroups(fromBlock, toBlock);
  if (config.liquidityVaultAddress) await syncVault(fromBlock, toBlock);
  console.log(
    `[indexer] backfill complete: ${markets.rows.length} markets, blocks ${fromBlock}..${toBlock}`,
  );
}

async function syncMarketState(market: MarketRow) {
  const address = market.pool_address as Address;
  if (market.liquidity_mode === "amm") {
    await refreshAmmLiquidity(market);
    return;
  }
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
    await query(
      `INSERT INTO resolution_disputes
         (id, market_id, pool_address, status, outcome, evidence_hash, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1,$2,$3,'proposed',$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        eventScopedId(event.transactionHash, "resolution-proposed", String(logIndexNumber(event.logIndex))),
        market.id,
        args.pool,
        Number(args.outcome) === 0 ? "YES" : "NO",
        args.evidenceHash,
        event.transactionHash,
        config.chainId,
        event.blockHash,
        Number(event.blockNumber),
        logIndexNumber(event.logIndex),
      ]
    );
  }

  const challengedEvents = parseEventLogs({ abi: aiJudgeVerifierEventAbi, eventName: "Challenged", logs: verifierLogs });
  for (const event of challengedEvents) {
    const args = event.args as { pool: Address; marketId: bigint; challenger: Address };
    if (args.pool.toLowerCase() !== market.pool_address.toLowerCase()) continue;
    await query(
      `INSERT INTO resolution_disputes
         (id, market_id, pool_address, status, challenger_address, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1,$2,$3,'challenged',$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        eventScopedId(event.transactionHash, "resolution-challenged", String(logIndexNumber(event.logIndex))),
        market.id,
        args.pool,
        args.challenger,
        event.transactionHash,
        config.chainId,
        event.blockHash,
        Number(event.blockNumber),
        logIndexNumber(event.logIndex),
      ]
    );
  }

  const resetEvents = parseEventLogs({ abi: aiJudgeVerifierEventAbi, eventName: "ProposalReset", logs: verifierLogs });
  for (const event of resetEvents) {
    const args = event.args as { pool: Address; marketId: bigint; evidenceHash: Hex };
    if (args.pool.toLowerCase() !== market.pool_address.toLowerCase()) continue;
    await query("UPDATE markets SET status = 'resolving', updated_at = now() WHERE id = $1 AND status <> 'resolved'", [market.id]);
    await query(
      `INSERT INTO resolution_disputes
         (id, market_id, pool_address, status, evidence_hash, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1,$2,$3,'reset',$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        eventScopedId(event.transactionHash, "resolution-reset", String(logIndexNumber(event.logIndex))),
        market.id,
        args.pool,
        args.evidenceHash,
        event.transactionHash,
        config.chainId,
        event.blockHash,
        Number(event.blockNumber),
        logIndexNumber(event.logIndex),
      ]
    );
  }

  const escalatedEvents = parseEventLogs({ abi: aiJudgeVerifierEventAbi, eventName: "ProposalEscalated", logs: verifierLogs });
  for (const event of escalatedEvents) {
    const args = event.args as { pool: Address; marketId: bigint; challenger: Address };
    if (args.pool.toLowerCase() !== market.pool_address.toLowerCase()) continue;
    await query("UPDATE markets SET status = 'resolving', updated_at = now() WHERE id = $1 AND status <> 'resolved'", [market.id]);
    await query(
      `INSERT INTO resolution_disputes
         (id, market_id, pool_address, status, challenger_address, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1,$2,$3,'escalated',$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        eventScopedId(event.transactionHash, "resolution-escalated", String(logIndexNumber(event.logIndex))),
        market.id,
        args.pool,
        args.challenger,
        event.transactionHash,
        config.chainId,
        event.blockHash,
        Number(event.blockNumber),
        logIndexNumber(event.logIndex),
      ]
    );
  }

  const bondEvents = parseEventLogs({ abi: aiJudgeVerifierEventAbi, eventName: "ChallengeBondPosted", logs: verifierLogs });
  for (const event of bondEvents) {
    const args = event.args as { marketId: bigint; challenger: Address; amount: bigint };
    const dbMarketId = `${config.chainId}:${args.marketId.toString()}`;
    await query(
      `INSERT INTO resolution_disputes
         (id, market_id, status, challenger_address, bond_amount, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1,$2,'bond_posted',$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        eventScopedId(event.transactionHash, "resolution-bond", String(logIndexNumber(event.logIndex))),
        dbMarketId,
        args.challenger,
        args.amount.toString(),
        event.transactionHash,
        config.chainId,
        event.blockHash,
        Number(event.blockNumber),
        logIndexNumber(event.logIndex),
      ]
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
    await query(
      `INSERT INTO resolution_disputes
         (id, market_id, pool_address, status, outcome, evidence_hash, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1,$2,$3,'finalized',$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        eventScopedId(event.transactionHash, "resolution-finalized", String(logIndexNumber(event.logIndex))),
        market.id,
        args.pool,
        outcome,
        args.evidenceHash,
        event.transactionHash,
        config.chainId,
        event.blockHash,
        Number(event.blockNumber),
        logIndexNumber(event.logIndex),
      ]
    );
  }

  // Optimistic-oracle resolution. A market whose resolver is an
  // OptimisticOracleResolver emits these on the same resolver_address we
  // already fetched as verifierLogs. The pool.resolve() the oracle triggers
  // also emits MarketResolved (handled below), so here we only record the
  // assertion/dispute audit trail plus the proposer + evidence on the market.
  const assertedEvents = parseEventLogs({ abi: optimisticOracleEventAbi, eventName: "OutcomeAsserted", logs: verifierLogs });
  for (const event of assertedEvents) {
    const args = event.args as { pool: Address; marketId: bigint; asserter: Address; outcome: number; evidenceHash: Hex; bond: bigint };
    if (args.pool.toLowerCase() !== market.pool_address.toLowerCase()) continue;
    const block = await client.getBlock({ blockNumber: event.blockNumber });
    await query(
      `UPDATE markets SET
         status = CASE WHEN status = 'resolved' THEN status ELSE 'resolving' END,
         resolution_evidence_hash = $2,
         resolution_proposer = $3,
         resolution_proposed_at = to_timestamp($4),
         resolution_proof_tx_hash = $5,
         updated_at = now()
       WHERE id = $1`,
      [market.id, args.evidenceHash, args.asserter, Number(block.timestamp), event.transactionHash],
    );
    await query(
      `INSERT INTO resolution_disputes
         (id, market_id, pool_address, status, outcome, evidence_hash, bond_amount, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1,$2,$3,'asserted',$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [
        eventScopedId(event.transactionHash, "oo-asserted", String(logIndexNumber(event.logIndex))),
        market.id,
        args.pool,
        Number(args.outcome) === 0 ? "YES" : "NO",
        args.evidenceHash,
        args.bond.toString(),
        event.transactionHash,
        config.chainId,
        event.blockHash,
        Number(event.blockNumber),
        logIndexNumber(event.logIndex),
      ],
    );
  }

  const disputedEvents = parseEventLogs({ abi: optimisticOracleEventAbi, eventName: "OutcomeDisputed", logs: verifierLogs });
  for (const event of disputedEvents) {
    const args = event.args as { pool: Address; marketId: bigint; disputer: Address; bond: bigint };
    if (args.pool.toLowerCase() !== market.pool_address.toLowerCase()) continue;
    await query("UPDATE markets SET status = 'resolving', updated_at = now() WHERE id = $1 AND status <> 'resolved'", [market.id]);
    await query(
      `INSERT INTO resolution_disputes
         (id, market_id, pool_address, status, challenger_address, bond_amount, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1,$2,$3,'disputed',$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        eventScopedId(event.transactionHash, "oo-disputed", String(logIndexNumber(event.logIndex))),
        market.id,
        args.pool,
        args.disputer,
        args.bond.toString(),
        event.transactionHash,
        config.chainId,
        event.blockHash,
        Number(event.blockNumber),
        logIndexNumber(event.logIndex),
      ],
    );
  }

  const ooSettledEvents = [
    ...parseEventLogs({ abi: optimisticOracleEventAbi, eventName: "OutcomeSettled", logs: verifierLogs }).map((e) => ({ e, kind: "settled" as const })),
    ...parseEventLogs({ abi: optimisticOracleEventAbi, eventName: "DisputeArbitrated", logs: verifierLogs }).map((e) => ({ e, kind: "arbitrated" as const })),
  ];
  for (const { e: event, kind } of ooSettledEvents) {
    const args = event.args as { pool: Address; marketId: bigint; outcome?: number; finalOutcome?: number };
    if (args.pool.toLowerCase() !== market.pool_address.toLowerCase()) continue;
    const outcomeNum = kind === "settled" ? Number(args.outcome) : Number(args.finalOutcome);
    const outcome = outcomeNum === 0 ? "YES" : "NO";
    await query(
      `UPDATE markets SET status = 'resolved', resolved_outcome = $2, resolution_tx_hash = COALESCE(resolution_tx_hash, $3), updated_at = now() WHERE id = $1`,
      [market.id, outcome, event.transactionHash],
    );
    await query(
      `INSERT INTO resolution_disputes
         (id, market_id, pool_address, status, outcome, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        eventScopedId(event.transactionHash, `oo-${kind}`, String(logIndexNumber(event.logIndex))),
        market.id,
        args.pool,
        kind,
        outcome,
        event.transactionHash,
        config.chainId,
        event.blockHash,
        Number(event.blockNumber),
        logIndexNumber(event.logIndex),
      ],
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

  const shareBoughtEvents = parseEventLogs({ abi: poolEventAbi, eventName: "SharesBought", logs });
  for (const event of shareBoughtEvents) {
    const args = event.args as { trader: Address; side: number; amount: bigint; shares: bigint };
    const logIndex = logIndexNumber(event.logIndex);
    await query(
      `INSERT INTO share_trades
         (id, market_id, address, side, action, amount_usd, shares, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1,$2,$3,$4,'buy',$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT DO NOTHING`,
      [
        eventScopedId(event.transactionHash, "share-buy", String(logIndex)),
        market.id,
        args.trader.toLowerCase(),
        Number(args.side) === 0 ? "YES" : "NO",
        Number(args.amount) / 1_000_000,
        Number(args.shares) / 1_000_000,
        event.transactionHash,
        config.chainId,
        event.blockHash,
        Number(event.blockNumber),
        logIndex,
      ],
    );
    await refreshAmmLiquidity(market);
  }

  const shareSoldEvents = parseEventLogs({ abi: poolEventAbi, eventName: "SharesSold", logs });
  for (const event of shareSoldEvents) {
    const args = event.args as { trader: Address; side: number; shares: bigint; amount: bigint };
    const logIndex = logIndexNumber(event.logIndex);
    await query(
      `INSERT INTO share_trades
         (id, market_id, address, side, action, amount_usd, shares, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1,$2,$3,$4,'sell',$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT DO NOTHING`,
      [
        eventScopedId(event.transactionHash, "share-sell", String(logIndex)),
        market.id,
        args.trader.toLowerCase(),
        Number(args.side) === 0 ? "YES" : "NO",
        Number(args.amount) / 1_000_000,
        Number(args.shares) / 1_000_000,
        event.transactionHash,
        config.chainId,
        event.blockHash,
        Number(event.blockNumber),
        logIndex,
      ],
    );
    await refreshAmmLiquidity(market);
  }

  const liquidityEvents = [
    ...parseEventLogs({ abi: poolEventAbi, eventName: "LiquidityAdded", logs }),
    ...parseEventLogs({ abi: poolEventAbi, eventName: "VaultSeeded", logs }),
  ];
  if (liquidityEvents.length > 0) {
    await refreshAmmLiquidity(market);
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

// Index on-chain settlement from the matcher. Each OrderFilled fully settles a
// resting maker order (the matcher fills the whole maker amount), so we flip the
// matched order to 'filled' and record the fill. The join is by the EIP-712
// digest the API persisted as onchain_hash; fills for orders placed outside our
// book have no row to reconcile and are skipped.
async function syncOrderFills(fromBlock: bigint, toBlock: bigint) {
  const matcher = config.orderMatcherAddress;
  if (!matcher) return;
  const logs = await client.getLogs({ address: matcher, fromBlock, toBlock });
  if (logs.length === 0) return;
  const fills = parseEventLogs({ abi: orderMatcherEventAbi, eventName: "OrderFilled", logs });
  for (const event of fills) {
    const args = event.args as { makerHash: Hex; buyer: Address; seller: Address; shares: bigint; cost: bigint };
    const logIndex = logIndexNumber(event.logIndex);
    const amountUsd = Number(args.cost) / 1_000_000;
    const priceBps = args.shares > 0n ? Number((args.cost * 10_000n) / args.shares) : 0;
    const updated = await query<{ hash: string }>(
      `UPDATE order_intents SET status = 'filled', updated_at = now()
       WHERE lower(onchain_hash) = lower($1)
       RETURNING hash`,
      [args.makerHash],
    );
    const row = updated.rows[0];
    if (!row) continue;
    await query(
      `INSERT INTO order_fills (id, order_hash, counterparty_hash, amount_usd, price_bps, transaction_hash, chain_id)
       VALUES ($1, $2, NULL, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        eventScopedId(event.transactionHash, "order-fill", String(logIndex)),
        row.hash,
        amountUsd,
        priceBps,
        event.transactionHash,
        config.chainId,
      ],
    );
  }
}

// Index the on-chain ExclusiveOutcomeRegistry (a chain-wide singleton) into the
// off-chain group tables, namespacing its numeric ids so they can't collide
// with API-created groups. Group rows are written before their links each
// window, and links to markets we haven't indexed yet are skipped (the FK
// would fail) — they reconcile on a later pass once the market lands.
async function syncOutcomeGroups(fromBlock: bigint, toBlock: bigint) {
  const registry = config.exclusiveOutcomeRegistryAddress;
  if (!registry) return;
  const logs = await client.getLogs({ address: registry, fromBlock, toBlock });
  if (logs.length === 0) return;

  const created = parseEventLogs({ abi: registryEventAbi, eventName: "OutcomeGroupCreated", logs });
  for (const event of created) {
    const args = event.args as { groupId: bigint; title: string };
    await query(
      `INSERT INTO market_groups (id, title, status) VALUES ($1, $2, 'open')
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
      [groupDbId(args.groupId), args.title],
    );
  }

  const linked = parseEventLogs({ abi: registryEventAbi, eventName: "GroupOutcomeLinked", logs });
  for (const event of linked) {
    const args = event.args as { groupId: bigint; marketId: bigint; label: string };
    const groupId = groupDbId(args.groupId);
    const marketDbId = `${config.chainId}:${args.marketId.toString()}`;
    const group = await query("SELECT 1 FROM market_groups WHERE id = $1", [groupId]);
    const marketExists = await query("SELECT 1 FROM markets WHERE id = $1", [marketDbId]);
    if (group.rowCount === 0 || marketExists.rowCount === 0) continue;
    await query(
      `INSERT INTO market_group_outcomes (id, group_id, market_id, label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, market_id) DO UPDATE SET label = EXCLUDED.label`,
      [`${groupId}:${marketDbId}`, groupId, marketDbId, args.label],
    );
  }

  const resolved = parseEventLogs({ abi: registryEventAbi, eventName: "GroupResolved", logs });
  for (const event of resolved) {
    const args = event.args as { groupId: bigint; winningMarketId: bigint };
    await query(
      `UPDATE market_groups SET status = 'resolved', winning_market_id = $2, updated_at = now() WHERE id = $1`,
      [groupDbId(args.groupId), `${config.chainId}:${args.winningMarketId.toString()}`],
    );
  }
}

// Index LiquidityVault seed-liquidity accounting. Rather than replay the deltas
// in MarketRegistered/DebtRepaid/SurplusClaimed, we read the vault's per-market
// debt/surplus mappings after any event so the indexed values track the chain.
async function syncVault(fromBlock: bigint, toBlock: bigint) {
  const vault = config.liquidityVaultAddress;
  if (!vault) return;
  const logs = await client.getLogs({ address: vault, fromBlock, toBlock });
  if (logs.length === 0) return;
  const events = [
    ...parseEventLogs({ abi: vaultEventAbi, eventName: "MarketRegistered", logs }),
    ...parseEventLogs({ abi: vaultEventAbi, eventName: "DebtRepaid", logs }),
    ...parseEventLogs({ abi: vaultEventAbi, eventName: "SurplusClaimed", logs }),
  ];
  const pools = new Set<string>();
  for (const event of events) {
    pools.add((event.args as { market: Address }).market.toLowerCase());
  }
  for (const poolLower of pools) {
    const found = await query<{ id: string }>(
      "SELECT id FROM markets WHERE lower(pool_address) = $1 AND chain_id = $2",
      [poolLower, config.chainId],
    );
    const marketId = found.rows[0]?.id;
    if (!marketId) continue;
    const [debt, surplus] = await Promise.all([
      client.readContract({ address: vault, abi: vaultReadAbi, functionName: "marketDebt", args: [poolLower as Address] }),
      client.readContract({ address: vault, abi: vaultReadAbi, functionName: "marketSurplus", args: [poolLower as Address] }),
    ]);
    await query(
      `INSERT INTO market_liquidity (market_id, vault_debt, vault_surplus, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (market_id) DO UPDATE SET
         vault_debt = EXCLUDED.vault_debt,
         vault_surplus = EXCLUDED.vault_surplus,
         updated_at = now()`,
      [marketId, Number(debt) / 1_000_000, Number(surplus) / 1_000_000],
    );
  }
}

function groupDbId(groupId: bigint) {
  return `${config.chainId}:group:${groupId.toString()}`;
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

async function refreshAmmLiquidity(market: MarketRow) {
  try {
    const address = market.pool_address as Address;
    const [yesReserve, noReserve, yesShares, noShares] = await Promise.all([
      client.readContract({ address, abi: poolAbi, functionName: "yesReserve" }),
      client.readContract({ address, abi: poolAbi, functionName: "noReserve" }),
      client.readContract({ address, abi: poolAbi, functionName: "yesShares" }),
      client.readContract({ address, abi: poolAbi, functionName: "noShares" }),
    ]);
    const yesReserveUsd = Number(yesReserve) / 1_000_000;
    const noReserveUsd = Number(noReserve) / 1_000_000;
    const totalReserveUsd = yesReserveUsd + noReserveUsd;
    const yesProbability = totalReserveUsd > 0 ? (yesReserveUsd / totalReserveUsd) * 100 : 50;
    await query(
      `INSERT INTO market_liquidity
         (market_id, mode, yes_reserve, no_reserve, yes_shares, no_shares, updated_at)
       VALUES ($1,'amm',$2,$3,$4,$5,now())
       ON CONFLICT (market_id) DO UPDATE SET
         mode = 'amm',
         yes_reserve = EXCLUDED.yes_reserve,
         no_reserve = EXCLUDED.no_reserve,
         yes_shares = EXCLUDED.yes_shares,
         no_shares = EXCLUDED.no_shares,
         updated_at = now()`,
      [
        market.id,
        yesReserveUsd,
        noReserveUsd,
        Number(yesShares) / 1_000_000,
        Number(noShares) / 1_000_000,
      ],
    );
    await query(
      `INSERT INTO market_stats (market_id, volume_usd, yes_probability, bettors, updated_at)
       VALUES ($1, $2, $3, 0, now())
       ON CONFLICT (market_id) DO UPDATE SET
         volume_usd = EXCLUDED.volume_usd,
         yes_probability = EXCLUDED.yes_probability,
         yes_probability_change_1h = EXCLUDED.yes_probability - market_stats.yes_probability,
         updated_at = now()`,
      [market.id, totalReserveUsd, yesProbability],
    );
  } catch {
    return;
  }
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
    // Optional: the AdjudexOrderMatcher whose OrderFilled events settle the
    // signed-order book. Unset -> on-chain fills are simply not indexed.
    orderMatcherAddress: readOptionalAddressEnv("INDEXER_ORDER_MATCHER_ADDRESS"),
    // Optional chain-wide singletons. Unset -> their events are not indexed.
    exclusiveOutcomeRegistryAddress: readOptionalAddressEnv("INDEXER_EXCLUSIVE_OUTCOME_REGISTRY_ADDRESS"),
    liquidityVaultAddress: readOptionalAddressEnv("INDEXER_LIQUIDITY_VAULT_ADDRESS"),
  };
}

function readOptionalAddressEnv(name: string): Address | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} must be a 20-byte hex address.`);
  return value as Address;
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
