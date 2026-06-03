import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseEventLogs,
  stringToBytes,
  toBytes,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildSiweMessage, configuredSiweDomain, createToken, expiredSessionCookie, isNonceExpired, nonceTtlMs, parseCookie, sessionCookie, sessionCookieName, sessionTtlMs } from "./auth";
import { query, transaction, type QueryExecutor } from "./db";
import { asNumber, toIso, walletShort } from "./format";
import { configuredImportSources, scanImportSource, validateImportCandidate, type ImportCandidateDraft, type ImportSource } from "./importer";
import { validateMarketDraft } from "./market-validation";
import { validateSettingsPatch } from "./user-preferences";
import { loggerOptions } from "./logger";
import { captureException } from "./sentry";
import { incCounter, observeDuration, renderMetrics } from "./metrics";
import { startNotificationWorker } from "./notification-worker";
import { startOnchainMonitor } from "./onchain-monitor";
import { startMatchIngestWorker } from "./match-ingest-worker";
import { startMatchResolveWorker } from "./match-resolve-worker";
import { applyGeoBlock } from "./geo-block";
import {
  createStripeCheckoutSession,
  currentSubscription,
  handleStripeWebhookEvent,
  isBillingEnabled,
  isPaidTier,
  PAID_TIERS,
  recordSubscriptionEvent,
  tierFor,
  TIER_PRICES_USD_CENTS,
  type Tier,
} from "./billing";
import {
  attribute as attributeReferral,
  buildReferralMessage,
  getReferral,
  referrerStats,
} from "./referrals";
import { rankFeedFor } from "./feed-ranking";
import { questStateFor, questCatalog } from "./quests";
import { redisGetJson, redisSetJson } from "./redis";

export const server = Fastify({ logger: loggerOptions() });

// Notification delivery worker. Polls `notification_events` and dispatches
// pending rows. Channel selected by NOTIFICATION_CHANNEL env (default "log").
startNotificationWorker();
// S5.C continuous monitoring. Disabled in tests; gated on
// ONCHAIN_MONITOR_ENABLED so we can opt-in per environment.
if (process.env.NODE_ENV !== "test" && process.env.ONCHAIN_MONITOR_ENABLED === "1") {
  startOnchainMonitor();
}
// Auto-ingest pipeline (CS2 / Dota2 / football). Off by default; opt-in per
// environment via MATCH_INGEST_ENABLED=1. Ingest scans feeds and auto-deploys
// markets; resolve proposes + finalizes settled matches through the AI judge.
if (process.env.NODE_ENV !== "test" && process.env.MATCH_INGEST_ENABLED === "1") {
  startMatchIngestWorker();
  startMatchResolveWorker();
}
await server.register(cors, { origin: true });

// Rate-limit policy (per IP; Redis-backed when RATE_LIMIT_BACKEND=redis):
//   write/auth-sensitive routes -> 30 req / minute
//   public read routes          -> 240 req / minute
// Health endpoints are unmetered so probes never get blocked.
import { rateLimit, startRateLimitGc } from "./rate-limit";
startRateLimitGc();

const WRITE_LIMIT = { scope: "write", limit: 30, windowMs: 60_000 } as const;
const READ_LIMIT = { scope: "read", limit: 240, windowMs: 60_000 } as const;

server.addHook("onRequest", async (req, reply) => {
  // Stamp request start for duration measurement in onResponse hook.
  (req as { _startNs?: bigint })._startNs = process.hrtime.bigint();
  const url = req.url ?? "";
  if (url.startsWith("/health") || url.startsWith("/api/status") || url.startsWith("/metrics")) return;
  // Geo-block (when enabled via GEO_BLOCK_ENABLED=1). Replies with 451
  // and returns false; we then short-circuit by returning reply.
  const passes = await applyGeoBlock(req, reply);
  if (!passes) return reply;
  const isWrite =
    req.method === "POST" ||
    req.method === "PUT" ||
    req.method === "PATCH" ||
    req.method === "DELETE";
  const ok = await rateLimit(
    req,
    reply,
    isWrite ? { ...WRITE_LIMIT } : { ...READ_LIMIT },
  );
  if (!ok) return reply;
});

// Observability: per-request counter + duration histogram. We use the
// matched Fastify route template (`req.routeOptions.url`) as the label
// so cardinality stays bounded. Falling back to "unknown" prevents
// arbitrary URLs from inflating the metric set.
server.addHook("onResponse", async (req, reply) => {
  const startNs = (req as { _startNs?: bigint })._startNs;
  const route = req.routeOptions?.url ?? "unknown";
  const status = String(reply.statusCode);
  incCounter("adjudex_requests_total", { method: req.method, route, status });
  if (startNs !== undefined) {
    const ms = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    observeDuration("adjudex_request_duration_ms", ms, { route });
  }
});

server.setErrorHandler(async (err, req, reply) => {
  const route = req.routeOptions?.url ?? "unknown";
  const errObj = err as { name?: string; message?: string; statusCode?: number };
  const name = errObj.name ?? "Error";
  const message = errObj.message ?? String(err);
  incCounter("adjudex_errors_total", { route, kind: name });
  await captureException(err, { route, method: req.method, url: req.url });
  req.log.error({ err, route }, "request failed");
  reply.code(errObj.statusCode ?? 500).send({
    error: name === "Error" ? "internal_error" : name,
    message: process.env.NODE_ENV === "production" ? "Internal error" : message,
  });
});

server.get("/metrics", async (_request, reply) => {
  return reply
    .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
    .send(renderMetrics());
});

server.get("/health", async (_request, reply) => {
  const database = await checkDatabase();
  return reply.code(database.ok ? 200 : 503).send({ ok: database.ok, database });
});

server.get("/api/status", async () => {
  const database = await checkDatabase();
  const arbitrumRpc = await checkRpc(process.env.ARBITRUM_SEPOLIA_RPC_URL, 421614);
  const rhcChainId = Number(process.env.RHC_CHAIN_ID ?? 46630);
  const rhcRpc = await checkRpc(process.env.RHC_RPC_URL, rhcChainId);
  const rpc = {
    ok: arbitrumRpc.ok || rhcRpc.ok,
    configured: arbitrumRpc.configured || rhcRpc.configured,
    blockNumber: arbitrumRpc.blockNumber ?? rhcRpc.blockNumber,
  };
  const indexerRows = await query<IndexerRow>(
    "SELECT id, chain_id, last_block, updated_at, last_block_hash, last_status, last_error, last_reorg_at FROM indexer_state WHERE chain_id = ANY($1::int[]) ORDER BY updated_at DESC",
    [[421614, rhcChainId]]
  ).catch(() => ({ rows: [] }));
  const arbitrumIndexer = indexerRows.rows.find((row) => row.chain_id === 421614);
  const rhcIndexer = indexerRows.rows.find((row) => row.chain_id === rhcChainId);
  const latestIndexer = indexerRows.rows[0];
  const chains = {
    arbitrumSepolia: chainReadiness({
      chainId: 421614,
      factoryAddress: process.env.MARKET_FACTORY_ADDRESS,
      rpc: arbitrumRpc,
      indexerRow: arbitrumIndexer,
    }),
    rhc: chainReadiness({
      chainId: rhcChainId,
      factoryAddress: process.env.RHC_MARKET_FACTORY_ADDRESS,
      rpc: rhcRpc,
      indexerRow: rhcIndexer,
    }),
  };
  const readyChains = Object.values(chains).filter((chain) => chain.ready);
  const ready = database.ok && readyChains.length > 0;

  return {
    ok: ready,
    ready,
    api: true,
    database,
    rpc,
    chains,
    indexer: toIndexerStatus(latestIndexer, rpc.blockNumber),
  };
});

server.get("/api/markets", async (request) => {
  const params = request.query as { category?: string; hotOnly?: string; query?: string };
  const cacheKey = marketsCacheKey(params);
  if (cacheKey) {
    const cached = await redisGetJson<ReturnType<typeof toMarket>[]>(cacheKey).catch((error) => {
      request.log.warn({ err: error, cacheKey }, "markets cache read failed");
      return null;
    });
    if (cached) return cached;
  }

  const values: unknown[] = [];
  const where: string[] = [];

  if (params.category && params.category !== "all") {
    values.push(params.category);
    where.push(`m.category = $${values.length}`);
  }
  if (params.hotOnly === "true") where.push("s.is_hot = true");
  if (params.query) {
    values.push(`%${params.query}%`);
    where.push(`(m.title ILIKE $${values.length} OR m.description ILIKE $${values.length})`);
  }

  const result = await query<MarketRow>(
    `${marketSelect()} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.volume_usd DESC, m.created_at DESC`,
    values
  );
  const markets = result.rows.map(toMarket);
  if (cacheKey) {
    await redisSetJson(cacheKey, markets, marketsCacheTtlSeconds()).catch((error) => {
      request.log.warn({ err: error, cacheKey }, "markets cache write failed");
    });
  }
  return markets;
});

// Personalised feed (S6.C). Returns markets ranked by relevance to the
// authenticated wallet — Tier 1: open positions → Tier 2: watchlist →
// Tier 3: traded categories → Tier 4: hot fallback. Anonymous callers
// get Tier 4 only. Each row carries a `feedReason` chip the UI surfaces
// alongside the market card.
server.get<{ Querystring: { limit?: string } }>(
  "/api/feed",
  async (request) => {
    const session = await requireSession(request.headers.cookie);
    const address = session?.address ?? null;
    const limit = Math.min(
      100,
      Math.max(1, Number(request.query.limit) || 30),
    );
    const ranked = await rankFeedFor(address, limit);
    if (ranked.length === 0) return [];

    const ids = ranked.map((r) => r.id);
    const tierById = new Map(ranked.map((r) => [r.id, r] as const));
    const result = await query<MarketRow>(
      `${marketSelect()} WHERE m.id = ANY($1::text[])`,
      [ids],
    );
    // Preserve ranker ordering — `result.rows` returns markets in DB
    // order, not ranker order.
    const byId = new Map(result.rows.map((row) => [row.id, row] as const));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((r): r is MarketRow => Boolean(r));
    return ordered.map((row) => {
      const meta = tierById.get(row.id);
      return {
        ...toMarket(row),
        feedTier: meta?.tier,
        feedReason: meta?.reason,
      };
    });
  },
);

server.get<{ Params: { id: string } }>("/api/markets/:id", async (request, reply) => {
  const result = await query<MarketRow>(`${marketSelect()} WHERE m.id = $1`, [request.params.id]);
  if (!result.rowCount) return reply.code(404).send({ error: "market_not_found" });
  return toMarket(result.rows[0]);
});

server.post("/api/markets/generate", async (_request, reply) => {
  return reply.code(501).send({ error: "market_generation_backend_required" });
});

server.post<{ Body: MarketDraftBody }>("/api/markets/validate", async (request) => {
  const validation = validateMarketDraft(request.body);
  const warnings: string[] = [];
  if (request.body.title?.trim()) {
    const duplicate = await query<{ id: string }>(
      `SELECT id FROM markets
       WHERE lower(title) = lower($1)
         AND status IN ('draft', 'open', 'locked', 'resolving')
       LIMIT 1`,
      [request.body.title.trim()]
    ).catch(() => ({ rows: [] }));
    if (duplicate.rows.length > 0) warnings.push("duplicate_market_risk");
  }
  return { ...validation, warnings };
});

server.post<{ Body: CreateMarketBody }>("/api/markets", async (request, reply) => {
  const {
    transactionHash,
    marketId,
    poolAddress,
    chainId: requestedChainId,
    factoryAddress: requestedFactoryAddress,
  } = request.body;
  const chainId = parseRequiredChainId(requestedChainId);
  if (!chainId) return reply.code(400).send({ error: "chain_id_required" });
  if (!transactionHash || !marketId || !poolAddress) return reply.code(400).send({ error: "confirmed_market_transaction_required" });
  const factoryAddress = configuredFactoryAddress(chainId);
  if (!factoryAddress) return reply.code(503).send({ error: "factory_not_configured" });
  if (requestedFactoryAddress && requestedFactoryAddress.toLowerCase() !== factoryAddress.toLowerCase()) {
    return reply.code(400).send({ error: "factory_address_mismatch" });
  }
  const verified = await verifyMarketCreatedReceipt({
    transactionHash: transactionHash as Hex,
    chainId,
    marketId,
    poolAddress,
    factoryAddress,
  });
  if (!verified.ok) return reply.code(400).send({ error: verified.error });

  const spec = parseSpecUri(verified.event.specUri);
  if (!spec) return reply.code(400).send({ error: "market_spec_uri_invalid_or_unavailable" });
  const validation = validateMarketDraft(spec);
  if (!validation.ok) return reply.code(400).send({ error: "market_validation_failed", details: validation.errors });
  const dbMarketId = canonicalMarketId(chainId, verified.event.marketId.toString());

  await query(
    `INSERT INTO markets (id, pool_address, chain_id, factory_address, creation_tx_hash, creator_address, resolver_address, title, description, category, oracle_type, asset, emoji, source_url, resolution_criteria, deadline_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (id) DO UPDATE SET
       pool_address = EXCLUDED.pool_address,
       chain_id = EXCLUDED.chain_id,
       factory_address = EXCLUDED.factory_address,
       creation_tx_hash = EXCLUDED.creation_tx_hash,
       creator_address = EXCLUDED.creator_address,
       resolver_address = EXCLUDED.resolver_address,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       category = EXCLUDED.category,
       oracle_type = EXCLUDED.oracle_type,
       asset = EXCLUDED.asset,
       emoji = EXCLUDED.emoji,
       source_url = EXCLUDED.source_url,
       resolution_criteria = EXCLUDED.resolution_criteria,
       deadline_at = EXCLUDED.deadline_at,
       updated_at = now()`,
    [
      dbMarketId,
      verified.event.pool,
      chainId,
      verified.event.factoryAddress,
      transactionHash,
      verified.event.creator,
      verified.event.resolver,
      spec.title,
      spec.description,
      spec.category,
      spec.oracleType,
      spec.asset,
      "",
      spec.sourceUrl,
      spec.resolutionCriteria,
      new Date(Number(verified.event.deadline) * 1000).toISOString(),
    ]
  );
  await query(
    `INSERT INTO market_stats (market_id) VALUES ($1)
     ON CONFLICT (market_id) DO NOTHING`,
    [dbMarketId]
  );

  const result = await query<MarketRow>(`${marketSelect()} WHERE m.id = $1`, [dbMarketId]);
  return result.rowCount ? toMarket(result.rows[0]) : reply.code(500).send({ error: "market_create_failed" });
});

server.post<{ Body: { marketId: string; side: "YES" | "NO"; stakeUsd: number } }>("/api/bets/preview", async (request, reply) => {
  const { marketId, side, stakeUsd } = request.body;
  if (!marketId || (side !== "YES" && side !== "NO") || !Number.isFinite(stakeUsd) || stakeUsd <= 0) {
    return reply.code(400).send({ error: "invalid_bet_preview_input" });
  }

  const result = await query<MarketRow>(`${marketSelect()} WHERE m.id = $1`, [marketId]);
  if (!result.rowCount) return reply.code(404).send({ error: "market_not_found" });
  const quote = await previewBetFromPool(result.rows[0], side, stakeUsd);
  if (!quote.ok) return reply.code(quote.statusCode).send({ error: quote.error });

  return {
    marketId,
    side,
    stakeUsd,
    price: quote.price,
    shares: quote.shares,
    potentialPayoutUsd: quote.potentialPayoutUsd,
    poolImpactPct: quote.poolImpactPct,
    requiredContract: quote.requiredContract,
    requiredFunction: "bet(uint8,uint256)",
    chainId: quote.chainId,
  };
});

server.post<{ Body: { marketId: string; side: "YES" | "NO"; stakeUsd: number; address?: string; transactionHash?: Hex; positionId?: string; chainId?: number } }>(
  "/api/bets",
  async (request, reply) => {
    const { marketId, side, stakeUsd, address, transactionHash, positionId, chainId: requestedChainId } = request.body;
    const chainId = parseRequiredChainId(requestedChainId);
    if (!chainId) return reply.code(400).send({ error: "chain_id_required" });
    if (!transactionHash || !positionId || !address) return reply.code(400).send({ error: "confirmed_bet_transaction_required" });

    const quoteResponse = await server.inject({
      method: "POST",
      url: "/api/bets/preview",
      payload: { marketId, side, stakeUsd },
    });
    if (quoteResponse.statusCode !== 200) return reply.code(quoteResponse.statusCode).send(JSON.parse(quoteResponse.body));
    const synced = await syncConfirmedTransaction(transactionHash, chainId);
    if (!synced.ok) return reply.code(synced.statusCode).send({ error: synced.error });
    const position = await query<PositionRow>(
      `SELECT * FROM positions
       WHERE id = $1
         AND lower(address) = lower($2)
         AND market_id = $3
         AND side = $4
         AND transaction_hash = $5
         AND chain_id = $6
         AND ABS(stake_usd::numeric - $7::numeric) < 0.000001`,
      [positionId, address, marketId, side, transactionHash, chainId, stakeUsd]
    );
    if (!position.rowCount) return reply.code(400).send({ error: "bet_event_not_found_in_transaction" });
    const activity = await query<{ id: string }>(
      "SELECT id FROM activity_events WHERE transaction_hash = $1 AND market_id = $2 AND chain_id = $3 AND kind IN ('bet', 'ai-lp') ORDER BY created_at DESC LIMIT 1",
      [transactionHash, marketId, chainId]
    );
    await createNotification({
      address,
      id: `${transactionHash}:notification:bet`,
      kind: "bet_confirmed",
      marketId,
      title: "Bet confirmed",
      body: `${position.rows[0].side} bet for ${asNumber(position.rows[0].stake_usd)} USDC was confirmed on-chain.`,
    });
    await recordUserActivityEvent({
      address,
      kind: "bet_confirmed",
      marketId,
      metadata: { transactionHash, chainId, positionId, side, stakeUsd },
    });

    return { id: transactionHash, marketId, positionId, activityId: activity.rows[0]?.id ?? `${transactionHash}:bet`, status: "confirmed", createdAtIso: new Date().toISOString() };
  }
);

// EIP-712 signed bet quote — clients submit { marketId, side, stakeUsd, bettor },
// receive a quote whose slippage is locked by the platform signer. On-chain
// BetQuoteVerifier.consume() validates the signature, deadline, and nonce
// before the actual bet runs.
server.post<{
  Body: {
    marketId: string;
    side: "YES" | "NO";
    stakeUsd: number;
    bettor: string;
    maxPoolImpactBps?: number;
    ttlSeconds?: number;
  };
}>("/api/bets/quote", async (request, reply) => {
  const { marketId, side, stakeUsd, bettor, maxPoolImpactBps, ttlSeconds } = request.body;
  if (!marketId || (side !== "YES" && side !== "NO") || !Number.isFinite(stakeUsd) || stakeUsd <= 0) {
    return reply.code(400).send({ error: "invalid_quote_input" });
  }
  if (!bettor || !/^0x[0-9a-fA-F]{40}$/.test(bettor)) {
    return reply.code(400).send({ error: "bettor_address_required" });
  }
  const verifierAddress = process.env.BET_QUOTE_VERIFIER_ADDRESS as
    | Address
    | undefined;
  const signerKey = process.env.QUOTE_SIGNER_PRIVATE_KEY as Hex | undefined;
  if (!verifierAddress || !signerKey) {
    return reply.code(503).send({ error: "quote_signer_not_configured" });
  }

  const result = await query<MarketRow>(`${marketSelect()} WHERE m.id = $1`, [marketId]);
  if (!result.rowCount) return reply.code(404).send({ error: "market_not_found" });
  const quote = await previewBetFromPool(result.rows[0], side, stakeUsd);
  if (!quote.ok) return reply.code(quote.statusCode).send({ error: quote.error });

  // Default slippage cap: 2× current pool impact, floor 50bps, ceiling 1000bps.
  const computedImpactBps = Math.ceil(quote.poolImpactPct * 100);
  const defaultMaxImpact = Math.min(1000, Math.max(50, computedImpactBps * 2));
  const maxImpactBps = Number.isFinite(maxPoolImpactBps ?? NaN)
    ? Math.max(computedImpactBps, Math.min(10_000, Number(maxPoolImpactBps)))
    : defaultMaxImpact;

  // Convert stake/shares to base units that match the on-chain types
  // (USDC has 6 decimals on the pool contracts).
  const stakeBaseUnits = BigInt(Math.round(stakeUsd * 1_000_000));
  // 0.5% safety floor on shares since price slip can shave from `quote.shares`.
  const minSharesBaseUnits = BigInt(Math.floor(quote.shares * 1_000_000 * 0.995));

  const ttl = Number.isFinite(ttlSeconds ?? NaN) && Number(ttlSeconds) > 0
    ? Math.min(900, Math.floor(Number(ttlSeconds)))
    : 120;
  const nowSecs = Math.floor(Date.now() / 1000);
  const deadline = BigInt(nowSecs + ttl);
  const nonce = BigInt(`0x${keccak256(stringToBytes(`${bettor}:${marketId}:${nowSecs}:${stakeBaseUnits}`)).slice(2, 18)}`);

  const sideEnum: 0 | 1 = side === "YES" ? 0 : 1;
  const poolAddress = getAddress(quote.requiredContract);
  const bettorAddress = getAddress(bettor);

  const domainHash = computeDomainSeparator(verifierAddress, quote.chainId);
  const quoteHash = hashBetQuote({
    pool: poolAddress,
    marketId: BigInt(parseContractMarketId(marketId)),
    side: sideEnum,
    stake: stakeBaseUnits,
    minShares: minSharesBaseUnits,
    maxPoolImpactBps: BigInt(maxImpactBps),
    deadline,
    nonce,
    bettor: bettorAddress,
  });
  const digest = keccak256(
    new Uint8Array([
      0x19,
      0x01,
      ...toBytes(domainHash),
      ...toBytes(quoteHash),
    ]),
  );

  const account = privateKeyToAccount(signerKey);
  const signature = await account.signMessage({ message: { raw: digest } });

  return {
    quote: {
      pool: poolAddress,
      marketId: parseContractMarketId(marketId),
      side: sideEnum,
      stake: stakeBaseUnits.toString(),
      minShares: minSharesBaseUnits.toString(),
      maxPoolImpactBps: maxImpactBps,
      deadline: deadline.toString(),
      nonce: nonce.toString(),
      bettor: bettorAddress,
    },
    signature,
    signer: account.address,
    verifier: verifierAddress,
    chainId: quote.chainId,
    expiresAtIso: new Date((nowSecs + ttl) * 1000).toISOString(),
    preview: {
      price: quote.price,
      shares: quote.shares,
      potentialPayoutUsd: quote.potentialPayoutUsd,
      poolImpactPct: quote.poolImpactPct,
    },
  };
});

server.get("/api/activity", async (request) => {
  const { limit = "20" } = request.query as { limit?: string };
  const result = await query<ActivityRow>(
    `SELECT a.*, m.title AS market_title
     FROM activity_events a
     LEFT JOIN markets m ON m.id = a.market_id
     ORDER BY a.created_at DESC
     LIMIT $1`,
    [Math.min(100, Math.max(1, Number(limit)))]
  );
  return result.rows.map(toActivity);
});

server.get<{ Params: { id: string } }>("/api/markets/:id/activity", async (request) => {
  const result = await query<ActivityRow>(
    `SELECT a.*, m.title AS market_title
     FROM activity_events a
     LEFT JOIN markets m ON m.id = a.market_id
     WHERE a.market_id = $1
     ORDER BY a.created_at DESC
     LIMIT 100`,
    [request.params.id]
  );
  return result.rows.map(toActivity);
});

server.get<{ Params: { id: string } }>("/api/markets/:id/timeline", async (request) => {
  const result = await query<TimelineRow>(
    `SELECT * FROM market_timeline WHERE market_id = $1 ORDER BY created_at ASC LIMIT 500`,
    [request.params.id]
  );
  return result.rows.map((row) => ({
    id: row.id,
    marketId: row.market_id,
    yesProbability: asNumber(row.yes_probability),
    volumeUsd: asNumber(row.volume_usd),
    eventKind: row.event_kind,
    transactionHash: row.transaction_hash ?? undefined,
    chainId: row.chain_id,
    blockHash: row.block_hash ?? undefined,
    blockNumber: row.block_number === null ? undefined : Number(row.block_number),
    logIndex: row.log_index ?? undefined,
    atIso: toIso(row.created_at),
  }));
});

server.get<{ Params: { address: string } }>("/api/portfolio/:address/positions", async (request) => {
  const result = await query<PositionRow>(
    `SELECT p.*, m.resolved_outcome, s.volume_usd, s.yes_probability
     FROM positions p
     JOIN markets m ON m.id = p.market_id
     JOIN market_stats s ON s.market_id = p.market_id
     WHERE lower(p.address) = lower($1)
     ORDER BY p.created_at DESC`,
    [request.params.address]
  );
  return result.rows.map(toPosition);
});

server.get<{ Params: { address: string } }>("/api/portfolio/:address/history", async (request) => {
  const result = await query<HistoryRow>(
    `SELECT c.id, c.position_id, p.market_id, p.chain_id, p.side, p.stake_usd, c.payout_usd, c.transaction_hash, c.created_at
     FROM claims c
     JOIN positions p ON p.id = c.position_id
     WHERE lower(p.address) = lower($1)
     UNION ALL
     SELECT r.id, r.position_id, p.market_id, p.chain_id, p.side, p.stake_usd, r.amount_usd AS payout_usd, r.transaction_hash, r.created_at
     FROM refunds r
     JOIN positions p ON p.id = r.position_id
     WHERE lower(p.address) = lower($1)
     ORDER BY created_at DESC`,
    [request.params.address]
  );
  return result.rows.map((row) => ({
    id: row.id,
    positionId: row.position_id,
    marketId: row.market_id,
    chainId: row.chain_id,
    side: row.side,
    stakeUsd: asNumber(row.stake_usd),
    payoutUsd: asNumber(row.payout_usd),
    transactionHash: row.transaction_hash ?? undefined,
    createdAtIso: toIso(row.created_at),
  }));
});

server.post<{ Body: { positionId: string; transactionHash?: Hex; chainId?: number } }>("/api/claim", async (request, reply) => {
  const { positionId, transactionHash, chainId: requestedChainId } = request.body;
  const chainId = parseRequiredChainId(requestedChainId);
  if (!chainId) return reply.code(400).send({ error: "chain_id_required" });
  if (!positionId || !transactionHash) return reply.code(400).send({ error: "confirmed_claim_transaction_required" });
  const position = await query<PositionRow>("SELECT * FROM positions WHERE id = $1 AND chain_id = $2", [positionId, chainId]);
  if (!position.rowCount) return reply.code(404).send({ error: "position_not_found" });
  const synced = await syncConfirmedTransaction(transactionHash, chainId, { requireTrustedEvent: true });
  if (!synced.ok) return reply.code(synced.statusCode).send({ error: synced.error });
  const claim = await query<{ id: string; payout_usd: unknown }>(
    "SELECT id, payout_usd FROM claims WHERE position_id = $1 AND transaction_hash = $2 AND chain_id = $3 ORDER BY created_at DESC LIMIT 1",
    [positionId, transactionHash, chainId]
  );
  if (!claim.rowCount) return reply.code(400).send({ error: "claim_event_not_found_in_transaction" });
  const payoutUsd = asNumber(claim.rows[0].payout_usd);
  await createNotification({
    address: position.rows[0].address,
    id: `${transactionHash}:notification:claim`,
    kind: "claim_confirmed",
    marketId: position.rows[0].market_id,
    title: "Claim confirmed",
    body: `Payout claim for ${payoutUsd} USDC was confirmed.`,
  });
  await recordUserActivityEvent({
    address: position.rows[0].address,
    kind: "claim_confirmed",
    marketId: position.rows[0].market_id,
    metadata: { transactionHash, chainId, positionId, payoutUsd },
  });
  return { id: claim.rows[0].id, positionId, payoutUsd, status: "claimed", createdAtIso: new Date().toISOString() };
});

server.get("/api/agents", async () => {
  const result = await query<AgentRow>("SELECT * FROM agents ORDER BY reputation DESC");
  return result.rows.map(toAgent);
});

server.get("/api/agents/ecosystem", async () => {
  const [summary, topAgents, recentMoves] = await Promise.all([
    query<AgentEcosystemSummaryRow>(
      `SELECT COUNT(*)::int AS agent_count,
              COUNT(*) FILTER (WHERE last_action IS NOT NULL)::int AS active_agent_count,
              COALESCE(SUM(lifetime_pnl_usd), 0) AS total_pnl_usd,
              COALESCE(AVG(reputation), 0) AS average_reputation,
              COALESCE(SUM(markets_touched), 0)::int AS markets_touched
       FROM agents`
    ),
    query<AgentRow>("SELECT * FROM agents ORDER BY reputation DESC, lifetime_pnl_usd DESC LIMIT 5"),
    query<ActivityRow>(
      `SELECT a.*, m.title AS market_title
       FROM activity_events a
       LEFT JOIN markets m ON m.id = a.market_id
       WHERE a.agent_handle IS NOT NULL
       ORDER BY a.created_at DESC
       LIMIT 8`
    ),
  ]);
  const volume = await query<{ volume_usd: unknown }>(
    `SELECT COALESCE(SUM(amount_usd), 0) AS volume_usd
     FROM activity_events
     WHERE agent_handle IS NOT NULL`
  );
  const row = summary.rows[0] ?? {
    agent_count: 0,
    active_agent_count: 0,
    total_pnl_usd: 0,
    average_reputation: 0,
    markets_touched: 0,
  };
  const oracleAddress = configuredReputationOracleAddress();
  return {
    status: row.agent_count > 0 ? "active" : "empty",
    registryConfigured: Boolean(oracleAddress),
    reputationOracleAddress: oracleAddress ?? undefined,
    agentCount: Number(row.agent_count ?? 0),
    activeAgentCount: Number(row.active_agent_count ?? 0),
    totalVolumeUsd: asNumber(volume.rows[0]?.volume_usd ?? 0),
    totalPnlUsd: asNumber(row.total_pnl_usd),
    averageReputation: asNumber(row.average_reputation),
    marketsTouched: Number(row.markets_touched ?? 0),
    topAgents: topAgents.rows.map(toAgent),
    recentMoves: recentMoves.rows.map(toActivity),
  };
});

server.post<{
  Body: {
    transactionHash?: Hex;
    chainId?: number;
    handle?: string;
    strategyDescription?: string;
    proofUrl?: string;
  };
}>("/api/agents/register", async (request, reply) => {
  const { transactionHash, handle } = request.body;
  const chainId = parseRequiredChainId(request.body.chainId);
  if (!chainId) return reply.code(400).send({ error: "chain_id_required" });
  if (!transactionHash || !isTransactionHash(transactionHash)) {
    return reply.code(400).send({ error: "transaction_hash_required" });
  }
  const cleanHandle = normalizeAgentHandle(handle);
  if (!cleanHandle) return reply.code(400).send({ error: "agent_handle_required" });
  const synced = await syncConfirmedTransaction(transactionHash, chainId, { requireTrustedEvent: true });
  if (!synced.ok) return reply.code(synced.statusCode).send({ error: synced.error });
  const registration = synced.reconciled.find((item) => item.type === "agent_registered");
  if (!registration?.id) return reply.code(400).send({ error: "agent_registered_event_not_found" });

  const strategyDescription = truncateOptionalText(request.body.strategyDescription, 240);
  const proofUrl = truncateOptionalUrl(request.body.proofUrl, 512);
  if (strategyDescription || proofUrl) {
    await query(
      `UPDATE agents
       SET strategy_description = COALESCE($2, strategy_description),
           proof_url = COALESCE($3, proof_url),
           updated_at = now()
       WHERE id = $1`,
      [registration.id, strategyDescription, proofUrl]
    );
  }
  const result = await query<AgentRow>("SELECT * FROM agents WHERE id = $1", [registration.id]);
  return {
    status: "registered",
    transactionHash,
    chainId,
    agent: toAgent(result.rows[0]),
  };
});

server.get<{ Params: { id: string } }>("/api/agents/:id", async (request, reply) => {
  const result = await query<AgentRow>("SELECT * FROM agents WHERE id = $1", [request.params.id]);
  if (!result.rowCount) return reply.code(404).send({ error: "agent_not_found" });
  return toAgent(result.rows[0]);
});

server.get<{ Params: { id: string } }>("/api/agents/:id/moves", async (request, reply) => {
  const agent = await query<AgentRow>("SELECT * FROM agents WHERE id = $1", [request.params.id]);
  if (!agent.rowCount) return reply.code(404).send({ error: "agent_not_found" });
  const result = await query<ActivityRow>(
    `SELECT a.*, m.title AS market_title
     FROM activity_events a
     LEFT JOIN markets m ON m.id = a.market_id
     WHERE lower(a.agent_handle) = lower($1)
     ORDER BY a.created_at DESC
     LIMIT 100`,
    [agent.rows[0].handle]
  );
  return result.rows.map(toActivity);
});

server.get<{ Params: { id: string } }>("/api/agents/:id/reputation", async (request, reply) => {
  const agent = await query<AgentRow>("SELECT * FROM agents WHERE id = $1", [request.params.id]);
  if (!agent.rowCount) return reply.code(404).send({ error: "agent_not_found" });
  const result = await query<AgentReputationRow>(
    `SELECT * FROM agent_reputation_history
     WHERE agent_id = $1
     ORDER BY created_at ASC
     LIMIT 500`,
    [request.params.id]
  );
  return result.rows.map(toAgentReputationPoint);
});

// ─── Agent social (S6.C.2) ─────────────────────────────────────────────
// Follower count + recent followers + last-10 W/L streak. The streak is
// derived from the agent's `activity_events` of kind=resolution joined
// against the agent's positions; we don't add a denormalised column.
server.get<{ Params: { id: string } }>(
  "/api/agents/:id/social",
  async (request, reply) => {
    const agent = await query<AgentRow>(
      "SELECT * FROM agents WHERE id = $1",
      [request.params.id],
    );
    if (!agent.rowCount) return reply.code(404).send({ error: "agent_not_found" });

    const session = await requireSession(request.headers.cookie);

    const counts = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM agent_followers WHERE agent_id = $1",
      [request.params.id],
    );
    const recent = await query<{ follower_address: string; followed_at: Date }>(
      `SELECT follower_address, followed_at
         FROM agent_followers
        WHERE agent_id = $1
        ORDER BY followed_at DESC
        LIMIT 5`,
      [request.params.id],
    );
    let isFollowedByMe = false;
    if (session) {
      const me = await query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM agent_followers
            WHERE agent_id = $1 AND lower(follower_address) = lower($2)
         ) AS exists`,
        [request.params.id, session.address],
      );
      isFollowedByMe = Boolean(me.rows[0]?.exists);
    }

    // Streak: last 10 resolutions for this agent. The W/L test is
    // "did the agent's recorded side match resolved_as?". We
    // recover the agent's side from the `side` column on the
    // companion 'bet' / 'ai-lp' event for the same market —
    // simpler: read activity_events of kind=resolution where the
    // agent had a bet on the same market.
    const last10 = await query<{ kind: "W" | "L" }>(
      `WITH agent_bets AS (
         SELECT DISTINCT market_id, side
           FROM activity_events
          WHERE agent_handle = $1
            AND kind IN ('bet', 'ai-lp')
            AND side IS NOT NULL
       ),
       agent_resolutions AS (
         SELECT a.market_id, a.side AS agent_side, r.resolved_as, r.created_at
           FROM agent_bets a
           JOIN activity_events r
             ON r.market_id = a.market_id
            AND r.kind = 'resolution'
       )
       SELECT CASE WHEN agent_side = resolved_as THEN 'W' ELSE 'L' END AS kind
         FROM agent_resolutions
        ORDER BY created_at DESC
        LIMIT 10`,
      [agent.rows[0].handle ?? ""],
    );
    const last10Series = last10.rows.map((r) => r.kind);
    let currentStreak = 0;
    let streakKind: "W" | "L" | null = null;
    for (const k of last10Series) {
      if (streakKind === null) {
        streakKind = k;
        currentStreak = 1;
      } else if (k === streakKind) {
        currentStreak += 1;
      } else {
        break;
      }
    }

    return {
      followerCount: Number(counts.rows[0]?.count ?? 0),
      isFollowedByMe,
      recentFollowers: recent.rows.map((r) => r.follower_address),
      streak:
        streakKind === null
          ? null
          : { current: currentStreak, kind: streakKind },
      last10: last10Series,
    };
  },
);

server.post<{ Params: { id: string } }>(
  "/api/agents/:id/follow",
  async (request, reply) => {
    const session = await requireSession(request.headers.cookie);
    if (!session) return reply.code(401).send({ error: "auth_required" });
    const agent = await query<AgentRow>(
      "SELECT id FROM agents WHERE id = $1",
      [request.params.id],
    );
    if (!agent.rowCount) return reply.code(404).send({ error: "agent_not_found" });
    await query(
      `INSERT INTO agent_followers (agent_id, follower_address)
       VALUES ($1, $2)
       ON CONFLICT (agent_id, follower_address) DO NOTHING`,
      [request.params.id, session.address.toLowerCase()],
    );
    return { ok: true, followed: true };
  },
);

server.delete<{ Params: { id: string } }>(
  "/api/agents/:id/follow",
  async (request, reply) => {
    const session = await requireSession(request.headers.cookie);
    if (!session) return reply.code(401).send({ error: "auth_required" });
    await query(
      `DELETE FROM agent_followers
        WHERE agent_id = $1 AND lower(follower_address) = lower($2)`,
      [request.params.id, session.address],
    );
    return { ok: true, followed: false };
  },
);

server.get("/api/leaderboard", async (request) => {
  const params = request.query as { pool?: "humans" | "ai" | "combined" };
  const humanRows = await query<LeaderRow>(
    `SELECT lower(address) AS id,
            'human' AS kind,
            lower(address) AS handle,
            SUM(stake_usd) AS volume_usd,
            COALESCE(SUM(payout_usd - stake_usd), 0) AS pnl_usd,
            COUNT(DISTINCT market_id) AS markets_touched,
            CASE WHEN COUNT(*) = 0 THEN 0 ELSE AVG(CASE WHEN status IN ('claimed') THEN 1 ELSE 0 END) END AS win_rate
     FROM positions
     GROUP BY lower(address)
     ORDER BY pnl_usd DESC, volume_usd DESC`
  );
  const agentRows = await query<{
    id: string;
    handle: string;
    lifetime_pnl_usd: unknown;
    reputation: unknown;
    volume_usd: unknown;
    markets_touched: number;
  }>(
    `SELECT a.id,
            a.handle,
            a.lifetime_pnl_usd,
            a.reputation,
            COALESCE(SUM(e.amount_usd), 0) AS volume_usd,
            GREATEST(a.markets_touched, COUNT(DISTINCT e.market_id)::int) AS markets_touched
     FROM agents a
     LEFT JOIN activity_events e ON lower(e.agent_handle) = lower(a.handle)
     GROUP BY a.id, a.handle, a.lifetime_pnl_usd, a.reputation, a.markets_touched
     ORDER BY a.reputation DESC`
  );
  const humans = humanRows.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    handle: row.handle,
    volumeUsd: asNumber(row.volume_usd),
    pnlUsd: asNumber(row.pnl_usd),
    winRate: asNumber(row.win_rate),
    marketsTouched: Number(row.markets_touched ?? 0),
  }));
  const agents = agentRows.rows.map((row) => ({
    id: row.id,
    kind: "ai" as const,
    handle: row.handle,
    volumeUsd: asNumber(row.volume_usd),
    pnlUsd: asNumber(row.lifetime_pnl_usd),
    winRate: 0,
    reputation: asNumber(row.reputation),
    marketsTouched: row.markets_touched,
  }));
  const rows = params.pool === "humans" ? humans : params.pool === "ai" ? agents : [...humans, ...agents];
  return rows.sort((a, b) => b.pnlUsd - a.pnlUsd || b.volumeUsd - a.volumeUsd);
});

server.get<{ Querystring: { programId?: string } }>("/api/liquidity/incentives", async (request, reply) => {
  const program = request.query.programId
    ? await query<LiquidityProgramRow>("SELECT * FROM liquidity_incentive_programs WHERE id = $1", [request.query.programId])
    : await query<LiquidityProgramRow>(
        `SELECT * FROM liquidity_incentive_programs
         WHERE status = 'active'
           AND starts_at <= now()
           AND ends_at > now()
         ORDER BY starts_at DESC
         LIMIT 1`,
      );
  const activeProgram = program.rows[0];
  if (!activeProgram) return reply.code(503).send({ error: "liquidity_program_not_configured" });

  const participants = await query<LiquidityParticipantRow>(
    `WITH trader_volume AS (
       SELECT
         lower(address) AS address,
         SUM(stake_usd) AS volume_usd,
         COUNT(*) AS positions_count,
         COUNT(DISTINCT market_id) AS markets_touched,
         MIN(created_at) AS first_position_at,
         MAX(created_at) AS last_position_at
       FROM positions
       WHERE created_at >= $1
         AND created_at < $2
       GROUP BY lower(address)
     ),
     ranked AS (
       SELECT
         *,
         row_number() OVER (ORDER BY volume_usd DESC, positions_count DESC, address ASC) AS rank,
         count(*) OVER () AS participant_count
       FROM trader_volume
     )
     SELECT *
     FROM ranked
     ORDER BY rank ASC
     LIMIT 100`,
    [activeProgram.starts_at, activeProgram.ends_at]
  );
  const payouts = await query<LiquidityPayoutRow>(
    `SELECT * FROM liquidity_incentive_payouts
     WHERE program_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [activeProgram.id]
  );
  return toLiquidityIncentiveResponse(activeProgram, participants.rows, payouts.rows);
});

server.post<{
  Body: {
    id?: string;
    name?: string;
    startsAtIso?: string;
    endsAtIso?: string;
    topPercentBps?: number;
    rebateBps?: number;
    minVolumeUsd?: number;
    budgetUsd?: number | null;
  };
}>("/api/liquidity/programs", async (request, reply) => {
  const admin = await requireImportAdmin(request.headers.cookie);
  if (!admin.ok) return reply.code(admin.statusCode).send({ error: admin.error });
  const parsed = parseLiquidityProgramBody(request.body);
  if (!parsed.ok) return reply.code(400).send({ error: "liquidity_program_invalid", details: parsed.errors });
  await query(
    `INSERT INTO liquidity_incentive_programs
       (id, name, starts_at, ends_at, top_percent_bps, rebate_bps, min_volume_usd, budget_usd, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       starts_at = EXCLUDED.starts_at,
       ends_at = EXCLUDED.ends_at,
       top_percent_bps = EXCLUDED.top_percent_bps,
       rebate_bps = EXCLUDED.rebate_bps,
       min_volume_usd = EXCLUDED.min_volume_usd,
       budget_usd = EXCLUDED.budget_usd,
       updated_at = now()`,
    [
      parsed.value.id,
      parsed.value.name,
      parsed.value.startsAt,
      parsed.value.endsAt,
      parsed.value.topPercentBps,
      parsed.value.rebateBps,
      parsed.value.minVolumeUsd,
      parsed.value.budgetUsd,
      admin.address,
    ]
  );
  const program = await query<LiquidityProgramRow>("SELECT * FROM liquidity_incentive_programs WHERE id = $1", [parsed.value.id]);
  return toLiquidityProgram(program.rows[0]);
});

server.post<{
  Body: {
    programId?: string;
    address?: string;
    amountUsd?: number;
    transactionHash?: Hex;
    chainId?: number;
  };
}>("/api/liquidity/payouts", async (request, reply) => {
  const admin = await requireImportAdmin(request.headers.cookie);
  if (!admin.ok) return reply.code(admin.statusCode).send({ error: admin.error });
  const { programId, address, amountUsd, transactionHash, chainId: requestedChainId } = request.body;
  const chainId = parseRequiredChainId(requestedChainId);
  if (!programId || !address || !Number.isFinite(amountUsd) || Number(amountUsd) <= 0 || !transactionHash || !chainId) {
    return reply.code(400).send({ error: "liquidity_payout_invalid" });
  }
  const program = await query<{ id: string }>("SELECT id FROM liquidity_incentive_programs WHERE id = $1", [programId]);
  if (!program.rowCount) return reply.code(404).send({ error: "liquidity_program_not_found" });
  const synced = await syncConfirmedTransaction(transactionHash, chainId);
  if (!synced.ok) return reply.code(synced.statusCode).send({ error: synced.error });
  await query(
    `INSERT INTO liquidity_incentive_payouts
       (id, program_id, address, amount_usd, transaction_hash, chain_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [createToken(12), programId, address.toLowerCase(), amountUsd, transactionHash, chainId]
  );
  return { programId, address: address.toLowerCase(), amountUsd, transactionHash, chainId };
});

server.get<{ Params: { marketId: string } }>("/api/oracle/:marketId", async (request) => {
  const result = await query<{ status: string; resolved_outcome: "YES" | "NO" | null; updated_at: Date }>(
    "SELECT status, resolved_outcome, updated_at FROM markets WHERE id = $1",
    [request.params.marketId]
  );
  if (!result.rowCount || result.rows[0].status !== "resolved" || !result.rows[0].resolved_outcome) return "pending";
  return { side: result.rows[0].resolved_outcome, resolvedAtIso: toIso(result.rows[0].updated_at) };
});

server.post<{ Body: { transactionHash?: Hex; chainId?: number } }>("/api/sync/transaction", async (request, reply) => {
  const { transactionHash, chainId: requestedChainId } = request.body;
  const chainId = parseRequiredChainId(requestedChainId);
  if (!chainId) return reply.code(400).send({ error: "chain_id_required" });
  if (!transactionHash) return reply.code(400).send({ error: "transaction_hash_required" });
  const synced = await syncConfirmedTransaction(transactionHash, chainId, { requireTrustedEvent: true });
  if (!synced.ok) return reply.code(synced.statusCode).send({ error: synced.error });
  return { transactionHash, chainId, status: synced.status, blockNumber: synced.blockNumber, reconciled: synced.reconciled };
});

server.post<{ Body: { sessionId?: string; providerId?: string; proof?: unknown } }>("/api/reclaim/proofs", async (request, reply) => {
  if (!isAuthorizedInternalWrite(request.headers["x-adjudex-internal-secret"])) {
    return reply.code(401).send({ error: "reclaim_proof_write_unauthorized" });
  }
  const { sessionId, providerId, proof } = request.body;
  if (!sessionId || !providerId || proof === undefined) return reply.code(400).send({ error: "reclaim_proof_payload_required" });
  const binding = extractRequiredAdjudexBinding(proof);
  if (!binding) return reply.code(400).send({ error: "reclaim_proof_binding_required" });
  const canonical = JSON.stringify(proof);
  const proofHash = keccak256(stringToBytes(canonical));
  await query(
    `INSERT INTO reclaim_proofs (session_id, provider_id, proof_hash, proof, market_id, source_url, chain_id, pool_address, wallet_address, verified_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, now())
     ON CONFLICT (session_id) DO UPDATE SET
       provider_id = EXCLUDED.provider_id,
       proof_hash = EXCLUDED.proof_hash,
       proof = EXCLUDED.proof,
       market_id = EXCLUDED.market_id,
       source_url = EXCLUDED.source_url,
       chain_id = EXCLUDED.chain_id,
       pool_address = EXCLUDED.pool_address,
       wallet_address = EXCLUDED.wallet_address,
       verified_at = now()`,
    [
      sessionId,
      providerId,
      proofHash,
      canonical,
      binding.marketId,
      binding.sourceUrl,
      binding.chainId,
      binding.poolAddress,
      binding.walletAddress,
    ]
  );
  return { sessionId, providerId, proofHash, proof, ...toReclaimProofBindingResponse(binding), verifiedAtIso: new Date().toISOString() };
});

server.get("/api/reclaim/proofs/:sessionId", async (request, reply) => {
  if (!isAuthorizedInternalWrite(request.headers["x-adjudex-internal-secret"])) {
    return reply.code(401).send({ error: "reclaim_proof_read_unauthorized" });
  }
  const { sessionId } = request.params as { sessionId: string };
  const result = await query<ReclaimProofRow>(
    "SELECT session_id, provider_id, proof_hash, proof, market_id, source_url, chain_id, pool_address, wallet_address, verified_at FROM reclaim_proofs WHERE session_id = $1",
    [sessionId]
  );
  if (!result.rowCount) return reply.code(404).send({ error: "reclaim_proof_not_found" });
  const row = result.rows[0];
  return {
    sessionId: row.session_id,
    providerId: row.provider_id,
    proofHash: row.proof_hash,
    proof: row.proof,
    marketId: row.market_id ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    chainId: row.chain_id ?? undefined,
    poolAddress: row.pool_address ?? undefined,
    walletAddress: row.wallet_address ?? undefined,
    verifiedAtIso: toIso(row.verified_at),
  };
});

server.post<{ Body: { address?: string; chainId?: number } }>("/api/auth/nonce", async (request, reply) => {
  const address = request.body.address?.toLowerCase();
  if (!address) return reply.code(400).send({ error: "address_required" });
  const chainId = parseRequiredChainId(request.body.chainId);
  if (!chainId) return reply.code(400).send({ error: "chain_id_required" });
  if (!rpcConfigForChain(chainId).supported) {
    return reply.code(400).send({ error: "chain_not_supported" });
  }
  const nonce = createToken(12);
  const issuedAtIso = new Date().toISOString();
  const domain = configuredSiweDomain();
  const message = buildSiweMessage({ domain, address, chainId, nonce, issuedAtIso });
  await query(
    "INSERT INTO auth_nonces (nonce, address, message, chain_id, domain) VALUES ($1, $2, $3, $4, $5)",
    [nonce, address, message, chainId, domain]
  );
  return { nonce, message };
});

server.post<{ Body: { address?: string; nonce?: string; signature?: Hex } }>("/api/auth/verify", async (request, reply) => {
  const address = request.body.address?.toLowerCase();
  const { nonce, signature } = request.body;
  if (!address || !nonce || !signature) return reply.code(400).send({ error: "siwe_payload_required" });
  const nonceRows = await query<{ nonce: string; address: string; message: string; created_at: Date; consumed_at: Date | null; chain_id: number | null; domain: string | null }>(
    "SELECT * FROM auth_nonces WHERE nonce = $1 AND lower(address) = lower($2)",
    [nonce, address]
  );
  const record = nonceRows.rows[0];
  if (!record || record.consumed_at || isNonceExpired(record.created_at)) return reply.code(401).send({ error: "nonce_invalid_or_expired" });
  const valid = await verifyMessage({ address: address as Hex, message: record.message, signature }).catch(() => false);
  if (!valid) return reply.code(401).send({ error: "signature_invalid" });
  const token = createToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs);
  const consumed = await transaction(async (execute) => {
    const updated = await execute<{ chain_id: number | null; domain: string | null }>(
      `UPDATE auth_nonces
       SET consumed_at = now()
       WHERE nonce = $1
         AND lower(address) = lower($2)
         AND consumed_at IS NULL
         AND created_at >= now() - ($3::int * interval '1 millisecond')
       RETURNING chain_id, domain`,
      [nonce, address, nonceTtlMs]
    );
    const consumedNonce = updated.rows[0];
    if (!consumedNonce) return false;
    await execute(
      "INSERT INTO auth_sessions (token, address, chain_id, domain, expires_at) VALUES ($1, $2, $3, $4, $5)",
      [token, address, consumedNonce.chain_id ?? record.chain_id, consumedNonce.domain ?? record.domain ?? configuredSiweDomain(), expiresAt]
    );
    return true;
  });
  if (!consumed) return reply.code(401).send({ error: "nonce_invalid_or_expired" });
  await recordUserActivityEvent({
    address,
    kind: "sign_in",
    metadata: { chainId: record.chain_id, domain: record.domain ?? configuredSiweDomain() },
  });
  reply.header("set-cookie", sessionCookie(token));
  return { address, expiresAtIso: expiresAt.toISOString() };
});

server.get("/api/settings", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  await ensureSettings(session.address);
  const result = await query<SettingsRow>("SELECT * FROM user_settings WHERE lower(address) = lower($1)", [session.address]);
  return toSettings(result.rows[0]);
});

server.put<{ Body: Partial<SettingsBody> }>("/api/settings", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  await ensureSettings(session.address);
  const settingsPatch = validateSettingsPatch(request.body);
  if (!settingsPatch.ok) return reply.code(400).send({ error: "settings_invalid", details: settingsPatch.errors });
  const body = settingsPatch.value;
  await query(
    `UPDATE user_settings SET
       preferred_chain = COALESCE($2, preferred_chain),
       currency_display = COALESCE($3, currency_display),
       notifications_enabled = COALESCE($4, notifications_enabled),
       animations_enabled = COALESCE($5, animations_enabled),
       compact_mode = COALESCE($6, compact_mode),
       default_stake_usd = COALESCE($7, default_stake_usd),
       explorer_preference = COALESCE($8, explorer_preference),
       updated_at = now()
     WHERE lower(address) = lower($1)`,
    [
      session.address,
      body.preferredChain,
      body.currencyDisplay,
      body.notificationsEnabled,
      body.animationsEnabled,
      body.compactMode,
      body.defaultStakeUsd,
      body.explorerPreference,
    ]
  );
  const result = await query<SettingsRow>("SELECT * FROM user_settings WHERE lower(address) = lower($1)", [session.address]);
  await recordUserActivityEvent({
    address: session.address,
    kind: "settings_updated",
    metadata: { fields: Object.keys(body).sort() },
  });
  return toSettings(result.rows[0]);
});

server.get("/api/watchlist", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  const result = await query<{ market_id: string; created_at: Date }>(
    "SELECT market_id, created_at FROM watchlist WHERE lower(address) = lower($1) ORDER BY created_at DESC",
    [session.address]
  );
  return result.rows.map((row) => ({ marketId: row.market_id, createdAtIso: toIso(row.created_at) }));
});

server.post<{ Body: { marketId?: string } }>("/api/watchlist", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  if (!request.body.marketId) return reply.code(400).send({ error: "market_id_required" });
  const market = await query<{ id: string }>("SELECT id FROM markets WHERE id = $1", [request.body.marketId]);
  if (!market.rowCount) return reply.code(404).send({ error: "market_not_found" });
  await query(
    "INSERT INTO watchlist (address, market_id) VALUES ($1, $2) ON CONFLICT (address, market_id) DO NOTHING",
    [session.address, request.body.marketId]
  );
  await recordUserActivityEvent({
    address: session.address,
    kind: "watchlist_added",
    marketId: request.body.marketId,
  });
  return { marketId: request.body.marketId };
});

server.delete<{ Params: { marketId: string } }>("/api/watchlist/:marketId", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  await query("DELETE FROM watchlist WHERE lower(address) = lower($1) AND market_id = $2", [session.address, request.params.marketId]);
  await recordUserActivityEvent({
    address: session.address,
    kind: "watchlist_removed",
    marketId: request.params.marketId,
  });
  return { marketId: request.params.marketId };
});

// --- Market comments (discussion threads) ---
const MAX_COMMENT_LEN = 2000;

function commentAuthorShort(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

server.get<{ Params: { id: string } }>("/api/markets/:id/comments", async (request) => {
  const result = await query<{
    id: string;
    market_id: string;
    author_address: string;
    body: string;
    created_at: Date;
  }>(
    `SELECT id, market_id, author_address, body, created_at
       FROM market_comments
      WHERE market_id = $1 AND hidden = false
      ORDER BY created_at DESC
      LIMIT 200`,
    [request.params.id]
  );
  return result.rows.map((row) => ({
    id: row.id,
    marketId: row.market_id,
    author: row.author_address,
    authorShort: commentAuthorShort(row.author_address),
    body: row.body,
    createdAtIso: toIso(row.created_at),
  }));
});

server.post<{ Params: { id: string }; Body: { body?: string } }>(
  "/api/markets/:id/comments",
  async (request, reply) => {
    const session = await requireSession(request.headers.cookie);
    if (!session) return reply.code(401).send({ error: "auth_required" });
    const body = (request.body.body ?? "").trim();
    if (!body) return reply.code(400).send({ error: "comment_body_required" });
    if (body.length > MAX_COMMENT_LEN) return reply.code(400).send({ error: "comment_too_long" });
    const market = await query<{ id: string }>("SELECT id FROM markets WHERE id = $1", [request.params.id]);
    if (!market.rowCount) return reply.code(404).send({ error: "market_not_found" });

    const id = createToken(16);
    await query(
      `INSERT INTO market_comments (id, market_id, author_address, body) VALUES ($1, $2, $3, $4)`,
      [id, request.params.id, session.address, body]
    );
    await recordUserActivityEvent({
      address: session.address,
      kind: "comment_posted",
      marketId: request.params.id,
    });
    return reply.code(201).send({
      id,
      marketId: request.params.id,
      author: session.address,
      authorShort: commentAuthorShort(session.address),
      body,
      createdAtIso: new Date().toISOString(),
    });
  }
);

server.delete<{ Params: { id: string } }>("/api/comments/:id", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  const result = await query(
    `DELETE FROM market_comments WHERE id = $1 AND lower(author_address) = lower($2)`,
    [request.params.id, session.address]
  );
  if (!result.rowCount) return reply.code(404).send({ error: "comment_not_found" });
  return { id: request.params.id, deleted: true };
});

// --- Public trader profiles + social graph ---
server.get<{ Params: { address: string } }>("/api/users/:address", async (request) => {
  const address = request.params.address.toLowerCase();
  const session = await requireSession(request.headers.cookie);

  const statsRows = await query<{
    volume_usd: unknown;
    pnl_usd: unknown;
    markets_touched: number;
    positions_count: number;
    win_rate: unknown;
    first_position_at: Date | null;
  }>(
    `SELECT SUM(stake_usd) AS volume_usd,
            COALESCE(SUM(payout_usd - stake_usd), 0) AS pnl_usd,
            COUNT(DISTINCT market_id) AS markets_touched,
            COUNT(*) AS positions_count,
            CASE WHEN COUNT(*) = 0 THEN 0 ELSE AVG(CASE WHEN status IN ('claimed') THEN 1 ELSE 0 END) END AS win_rate,
            MIN(created_at) AS first_position_at
       FROM positions
      WHERE lower(address) = $1`,
    [address]
  );
  const s = statsRows.rows[0];

  const counts = await query<{ followers: string; following: string }>(
    `SELECT
       (SELECT COUNT(*) FROM user_followers WHERE lower(followee_address) = $1) AS followers,
       (SELECT COUNT(*) FROM user_followers WHERE lower(follower_address) = $1) AS following`,
    [address]
  );

  let isFollowedByMe = false;
  if (session && session.address.toLowerCase() !== address) {
    const f = await query(
      `SELECT 1 FROM user_followers WHERE lower(follower_address) = lower($1) AND lower(followee_address) = $2`,
      [session.address, address]
    );
    isFollowedByMe = (f.rowCount ?? 0) > 0;
  }

  return {
    address,
    volumeUsd: asNumber(s?.volume_usd),
    pnlUsd: asNumber(s?.pnl_usd),
    marketsTouched: Number(s?.markets_touched ?? 0),
    positionsCount: Number(s?.positions_count ?? 0),
    winRate: asNumber(s?.win_rate),
    firstPositionAtIso: s?.first_position_at ? toIso(s.first_position_at) : undefined,
    followerCount: Number(counts.rows[0]?.followers ?? 0),
    followingCount: Number(counts.rows[0]?.following ?? 0),
    isFollowedByMe,
    isSelf: session ? session.address.toLowerCase() === address : false,
  };
});

server.post<{ Params: { address: string } }>("/api/users/:address/follow", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  const followee = request.params.address.toLowerCase();
  if (session.address.toLowerCase() === followee) return reply.code(400).send({ error: "cannot_follow_self" });
  await query(
    `INSERT INTO user_followers (follower_address, followee_address) VALUES ($1, $2)
     ON CONFLICT (follower_address, followee_address) DO NOTHING`,
    [session.address.toLowerCase(), followee]
  );
  return { followee, following: true };
});

server.delete<{ Params: { address: string } }>("/api/users/:address/follow", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  const followee = request.params.address.toLowerCase();
  await query(
    `DELETE FROM user_followers WHERE lower(follower_address) = lower($1) AND lower(followee_address) = $2`,
    [session.address, followee]
  );
  return { followee, following: false };
});

// --- Quests / points ---
server.get("/api/quests", async (request) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) {
    return { authenticated: false, pointsEarned: 0, pointsTotal: 0, quests: questCatalog() };
  }
  const state = await questStateFor(session.address);
  return { authenticated: true, ...state };
});

server.get("/api/notifications", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  const result = await query<NotificationRow>(
    "SELECT * FROM notification_events WHERE lower(address) = lower($1) ORDER BY created_at DESC LIMIT 50",
    [session.address]
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    marketId: row.market_id ?? undefined,
    title: row.title,
    body: row.body,
    read: Boolean(row.read_at),
    createdAtIso: toIso(row.created_at),
  }));
});

server.post("/api/notifications/read", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  await query(
    "UPDATE notification_events SET read_at = COALESCE(read_at, now()) WHERE lower(address) = lower($1)",
    [session.address]
  );
  await recordUserActivityEvent({ address: session.address, kind: "notifications_read_all" });
  return { ok: true };
});

server.patch<{ Params: { id: string } }>("/api/notifications/:id/read", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  const result = await query<NotificationRow>(
    `UPDATE notification_events
     SET read_at = COALESCE(read_at, now())
     WHERE id = $1 AND lower(address) = lower($2)
     RETURNING *`,
    [request.params.id, session.address]
  );
  if (!result.rowCount) return reply.code(404).send({ error: "notification_not_found" });
  const row = result.rows[0];
  await recordUserActivityEvent({
    address: session.address,
    kind: "notification_read",
    marketId: row.market_id ?? undefined,
    metadata: { notificationId: row.id, notificationKind: row.kind },
  });
  return {
    id: row.id,
    kind: row.kind,
    marketId: row.market_id ?? undefined,
    title: row.title,
    body: row.body,
    read: Boolean(row.read_at),
    createdAtIso: toIso(row.created_at),
  };
});

server.post<{ Body: { kind?: string; marketId?: string; metadata?: Record<string, unknown> } }>("/api/analytics/events", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  const kind = request.body.kind?.trim();
  if (!kind || !clientActivityKinds.has(kind)) {
    return reply.code(400).send({ error: "activity_kind_invalid" });
  }
  await recordUserActivityEvent({
    address: session.address,
    kind,
    marketId: request.body.marketId,
    metadata: request.body.metadata,
  });
  return reply.code(202).send({ ok: true });
});

server.get<{ Querystring: { limit?: string } }>("/api/analytics/retention", async (request, reply) => {
  const admin = await requireImportAdmin(request.headers.cookie);
  if (!admin.ok) return reply.code(admin.statusCode).send({ error: admin.error });
  const limit = clampInteger(Number(request.query.limit ?? 12), 1, 52);
  const cohorts = await query<RetentionCohortRow>(
    `WITH first_seen AS (
       SELECT lower(address) AS address, date_trunc('day', min(created_at)) AS cohort_day
       FROM user_activity_events
       GROUP BY lower(address)
     ),
     activity_days AS (
       SELECT DISTINCT lower(address) AS address, date_trunc('day', created_at) AS activity_day
       FROM user_activity_events
     )
     SELECT
       f.cohort_day,
       count(*) AS cohort_size,
       count(*) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM activity_days a
           WHERE a.address = f.address
             AND a.activity_day >= f.cohort_day + interval '1 day'
             AND a.activity_day < f.cohort_day + interval '2 days'
         )
       ) AS retained_d1,
       count(*) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM activity_days a
           WHERE a.address = f.address
             AND a.activity_day >= f.cohort_day + interval '7 days'
             AND a.activity_day < f.cohort_day + interval '8 days'
         )
       ) AS retained_d7,
       count(*) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM activity_days a
           WHERE a.address = f.address
             AND a.activity_day >= f.cohort_day + interval '30 days'
             AND a.activity_day < f.cohort_day + interval '31 days'
         )
       ) AS retained_d30
     FROM first_seen f
     GROUP BY f.cohort_day
     ORDER BY f.cohort_day DESC
     LIMIT $1`,
    [limit]
  );
  const summary = await query<RetentionSummaryRow>(
    `SELECT
       count(DISTINCT lower(address)) FILTER (WHERE created_at >= now() - interval '1 day') AS active_1d,
       count(DISTINCT lower(address)) FILTER (WHERE created_at >= now() - interval '7 days') AS active_7d,
       count(DISTINCT lower(address)) FILTER (WHERE created_at >= now() - interval '30 days') AS active_30d,
       count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS events_30d
     FROM user_activity_events`
  );
  return {
    generatedAtIso: new Date().toISOString(),
    source: "user_activity_events",
    summary: toRetentionSummary(summary.rows[0]),
    cohorts: cohorts.rows.map(toRetentionCohort),
  };
});

server.get("/api/import/sources", async () => {
  const sources = await ensureImportSources();
  return sources.map(toImportSourceResponse);
});

server.post("/api/import/scan", async (request, reply) => {
  const admin = await requireImportAdmin(request.headers.cookie);
  if (!admin.ok) return reply.code(admin.statusCode).send({ error: admin.error });

  const sources = await ensureImportSources();
  if (sources.length === 0) {
    return reply.code(503).send({ error: "no_import_sources_configured" });
  }

  const candidates: ImportCandidateRow[] = [];
  const sourceErrors: Array<{ sourceId: string; error: string }> = [];
  for (const source of sources) {
    try {
      const scanned = await scanImportSource(source);
      for (const draft of scanned) {
        const candidateId = await upsertImportCandidate(draft);
        const row = await getImportCandidate(candidateId);
        if (row) candidates.push(row);
      }
    } catch (error) {
      sourceErrors.push({
        sourceId: source.id,
        error: error instanceof Error ? error.message : "source_scan_failed",
      });
    }
  }

  return {
    scannedSources: sources.length,
    candidates: candidates.map(toImportCandidate),
    sourceErrors,
  };
});

server.get("/api/import/candidates", async (request, reply) => {
  const admin = await requireImportAdmin(request.headers.cookie);
  if (!admin.ok) return reply.code(admin.statusCode).send({ error: admin.error });

  const result = await query<ImportCandidateRow>(
    "SELECT * FROM import_candidates ORDER BY updated_at DESC LIMIT 100"
  );
  return result.rows.map(toImportCandidate);
});

server.post<{ Params: { id: string } }>("/api/import/candidates/:id/validate", async (request, reply) => {
  const admin = await requireImportAdmin(request.headers.cookie);
  if (!admin.ok) return reply.code(admin.statusCode).send({ error: admin.error });

  const candidate = await getImportCandidate(request.params.id);
  if (!candidate) return reply.code(404).send({ error: "candidate_not_found" });

  const validation = validateImportCandidate({
    question: candidate.question,
    description: candidate.description,
    category: candidate.category,
    oracleType: candidate.oracle_type,
    asset: candidate.asset,
    deadlineIso: candidate.deadline_at ? toIso(candidate.deadline_at) : undefined,
    sourceUrl: candidate.source_url,
    resolutionCriteria: candidate.resolution_criteria,
    riskFlags: parseJsonArray(candidate.risk_flags),
  });

  await query(
    `UPDATE import_candidates
     SET status = $2,
         validation_errors = $3::jsonb,
         spec_json = $4::jsonb,
         spec_hash = $5,
         spec_uri = $6,
         updated_at = now()
     WHERE id = $1`,
    [
      candidate.id,
      validation.ok ? "validated" : "rejected",
      JSON.stringify(validation.errors),
      validation.spec ? JSON.stringify(validation.spec) : null,
      validation.specHash ?? null,
      validation.specUri ?? null,
    ]
  );

  const updated = await getImportCandidate(candidate.id);
  return updated ? toImportCandidate(updated) : reply.code(500).send({ error: "candidate_validate_failed" });
});

server.post<{ Params: { id: string }; Body: ImportDeployBody }>("/api/import/candidates/:id/deploy", async (request, reply) => {
  const admin = await requireImportAdmin(request.headers.cookie);
  if (!admin.ok) return reply.code(admin.statusCode).send({ error: admin.error });

  const candidate = await getImportCandidate(request.params.id);
  if (!candidate) return reply.code(404).send({ error: "candidate_not_found" });
  if (candidate.status !== "validated" || !candidate.spec_json || !candidate.spec_hash || !candidate.spec_uri) {
    return reply.code(409).send({ error: "candidate_not_validated" });
  }

  const { transactionHash, marketId, poolAddress, chainId: requestedChainId, factoryAddress: requestedFactoryAddress } = request.body;
  const chainId = parseRequiredChainId(requestedChainId);
  if (!chainId) return reply.code(400).send({ error: "chain_id_required" });
  if (!transactionHash || !marketId || !poolAddress) {
    return reply.code(409).send({
      error: "wallet_deploy_required",
      contractFunction: "createMarketWithSpec(bytes32,uint256,string)",
      spec: candidate.spec_json,
      specHash: candidate.spec_hash,
      specUri: candidate.spec_uri,
      deadlineIso: candidate.deadline_at ? toIso(candidate.deadline_at) : null,
    });
  }
  const factoryAddress = configuredFactoryAddress(chainId);
  if (!factoryAddress) return reply.code(503).send({ error: "factory_not_configured" });
  if (requestedFactoryAddress && requestedFactoryAddress.toLowerCase() !== factoryAddress.toLowerCase()) {
    return reply.code(400).send({ error: "factory_address_mismatch" });
  }

  const verified = await verifyMarketCreatedReceipt({
    transactionHash: transactionHash as Hex,
    chainId,
    marketId,
    poolAddress,
    factoryAddress,
    expectedSpecHash: candidate.spec_hash,
    expectedSpecUri: candidate.spec_uri,
    expectedDeadline: candidate.deadline_at ? BigInt(Math.floor(candidate.deadline_at.getTime() / 1000)) : undefined,
  });
  if (!verified.ok) return reply.code(400).send({ error: verified.error });

  const spec = parseSpecUri(verified.event.specUri);
  if (!spec) return reply.code(400).send({ error: "market_spec_uri_invalid_or_unavailable" });
  const dbMarketId = canonicalMarketId(chainId, verified.event.marketId.toString());
  await query(
    `INSERT INTO import_deployments (id, candidate_id, market_id, pool_address, transaction_hash, chain_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (chain_id, transaction_hash) DO NOTHING`,
    [eventScopedId(chainId, transactionHash, "import"), candidate.id, dbMarketId, poolAddress, transactionHash, chainId]
  );
  await query(
    `INSERT INTO markets (
       id, pool_address, chain_id, factory_address, creation_tx_hash, creator_address,
       resolver_address, title, description, category, oracle_type, asset, emoji, source_url,
       source_published_at, provenance_note, resolution_criteria, deadline_at,
       import_source_id, import_candidate_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '', $13, $14, $15, $16, $17, $18, $19)
     ON CONFLICT (id) DO UPDATE SET
       pool_address = EXCLUDED.pool_address,
       chain_id = EXCLUDED.chain_id,
       factory_address = EXCLUDED.factory_address,
       creation_tx_hash = EXCLUDED.creation_tx_hash,
       creator_address = EXCLUDED.creator_address,
       resolver_address = EXCLUDED.resolver_address,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       category = EXCLUDED.category,
       oracle_type = EXCLUDED.oracle_type,
       asset = EXCLUDED.asset,
       source_url = EXCLUDED.source_url,
       source_published_at = EXCLUDED.source_published_at,
       provenance_note = EXCLUDED.provenance_note,
       resolution_criteria = EXCLUDED.resolution_criteria,
       deadline_at = EXCLUDED.deadline_at,
       import_source_id = EXCLUDED.import_source_id,
       import_candidate_id = EXCLUDED.import_candidate_id,
       updated_at = now()`,
    [
      dbMarketId,
      verified.event.pool,
      chainId,
      verified.event.factoryAddress,
      transactionHash,
      verified.event.creator,
      verified.event.resolver,
      spec.title,
      spec.description,
      spec.category,
      spec.oracleType,
      spec.asset,
      spec.sourceUrl,
      candidate.source_published_at,
      `Imported from public source ${candidate.source_id}; normalized by Adjudex Market Importer.`,
      spec.resolutionCriteria,
      spec.deadlineIso,
      candidate.source_id,
      candidate.id,
    ]
  );
  await query("INSERT INTO market_stats (market_id) VALUES ($1) ON CONFLICT (market_id) DO NOTHING", [dbMarketId]);
  await query("UPDATE import_candidates SET status = 'deployed', updated_at = now() WHERE id = $1", [candidate.id]);

  const market = await query<MarketRow>(`${marketSelect()} WHERE m.id = $1`, [dbMarketId]);
  return market.rowCount ? toMarket(market.rows[0]) : reply.code(500).send({ error: "import_deploy_failed" });
});

// ─── Admin revenue dashboard (S4.C) ────────────────────────────────────

// Aggregated MRR + protocol fee revenue + referral payouts. Admin-only.
// Numbers are intentionally approximate — exact accounting requires a
// separate reconciler. This is a "what shape is the business in" view.
server.get("/api/admin/revenue", async (request, reply) => {
  const admin = await requireImportAdmin(request.headers.cookie);
  if (!admin.ok) return reply.code(admin.statusCode).send({ error: admin.error });

  // Active subscriptions: count + monthly recurring (in cents).
  const subs = await query<{ tier: string; count: string; total_cents: string }>(
    `SELECT tier,
            COUNT(*)::text                       AS count,
            COALESCE(SUM(price_usd_cents), 0)::text AS total_cents
       FROM subscriptions
      WHERE status IN ('active', 'trialing')
        AND tier <> 'free'
      GROUP BY tier
      ORDER BY tier`,
  );

  // Fee revenue proxy. We don't store fee separately on activity_events —
  // approximate by applying the configured pool-fee bps to the volume of
  // winning claims in the window. Real accounting comes from FeeCollected
  // events once the indexer aggregates them.
  const feeBps = Number(process.env.MARKET_FACTORY_FEE_BPS ?? "150");
  const fees30d = await query<{ total_volume: string }>(
    `SELECT COALESCE(SUM(amount_usd), 0)::text AS total_volume
       FROM activity_events
      WHERE kind = 'claim'
        AND created_at >= now() - interval '30 days'`,
  );
  const fees90d = await query<{ total_volume: string }>(
    `SELECT COALESCE(SUM(amount_usd), 0)::text AS total_volume
       FROM activity_events
      WHERE kind = 'claim'
        AND created_at >= now() - interval '90 days'`,
  );

  // Referral rebate accrued (lifetime).
  const referrals = await query<{
    referee_count: string;
    total_fees: string;
    total_rebate: string;
  }>(
    `SELECT COUNT(*)::text                              AS referee_count,
            COALESCE(SUM(lifetime_fees_usd_cents), 0)::text  AS total_fees,
            COALESCE(SUM(lifetime_rebate_usd_cents), 0)::text AS total_rebate
       FROM referrals`,
  );

  const mrrCents = subs.rows.reduce((s, r) => s + Number(r.total_cents || 0), 0);
  const volume30 = Number(fees30d.rows[0]?.total_volume ?? 0);
  const volume90 = Number(fees90d.rows[0]?.total_volume ?? 0);
  const feeRevenue30Cents = Math.round((volume30 * feeBps) / 10000 * 100);
  const feeRevenue90Cents = Math.round((volume90 * feeBps) / 10000 * 100);
  const referralRow = referrals.rows[0];

  return {
    subscriptions: {
      byTier: subs.rows.map((r) => ({
        tier: r.tier,
        count: Number(r.count),
        mrrCents: Number(r.total_cents),
      })),
      mrrCents,
      arrCents: mrrCents * 12,
    },
    fees: {
      assumedBps: feeBps,
      last30dVolumeUsd: volume30,
      last30dFeeCents: feeRevenue30Cents,
      last90dVolumeUsd: volume90,
      last90dFeeCents: feeRevenue90Cents,
    },
    referrals: {
      refereeCount: referralRow ? Number(referralRow.referee_count) : 0,
      lifetimeFeesCents: referralRow ? Number(referralRow.total_fees) : 0,
      lifetimeRebateCents: referralRow ? Number(referralRow.total_rebate) : 0,
    },
    asOf: new Date().toISOString(),
  };
});

// ─── Billing (S4.A) ────────────────────────────────────────────────────

// Current subscription for the authenticated wallet. Returns tier + status
// + period_end. Free tier returns { tier: "free", status: "active" } so
// the client never has to handle "no row".
server.get("/api/billing/me", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  const sub = await currentSubscription(session.address);
  if (!sub) {
    return {
      tier: "free" as const,
      status: "active" as const,
      currentPeriodEnd: null,
      priceUsdCents: 0,
      billingEnabled: isBillingEnabled(),
    };
  }
  return {
    tier: sub.tier,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end,
    priceUsdCents: sub.price_usd_cents,
    billingEnabled: isBillingEnabled(),
  };
});

// Create a Stripe Checkout session for the given tier. The redirect URLs
// must be on the same origin as the frontend; we don't enforce that here
// but the route handler downstream will reject obviously-bad URLs.
server.post<{
  Body: { tier?: string; successUrl?: string; cancelUrl?: string };
}>("/api/billing/checkout", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  if (!isBillingEnabled()) return reply.code(503).send({ error: "billing_unavailable" });

  const tier = request.body?.tier;
  if (!isPaidTier(tier)) {
    return reply.code(400).send({
      error: "tier_invalid",
      allowed: PAID_TIERS,
    });
  }
  const successUrl = request.body?.successUrl?.trim();
  const cancelUrl = request.body?.cancelUrl?.trim();
  if (!successUrl || !cancelUrl || !/^https?:\/\//.test(successUrl) || !/^https?:\/\//.test(cancelUrl)) {
    return reply.code(400).send({ error: "redirect_urls_required" });
  }

  const result = await createStripeCheckoutSession({
    address: session.address,
    tier: tier as Exclude<Tier, "free">,
    successUrl,
    cancelUrl,
  });
  if ("error" in result) return reply.code(502).send({ error: result.error });
  return {
    url: result.url,
    priceUsdCents: TIER_PRICES_USD_CENTS[tier as Exclude<Tier, "free">],
  };
});

// Stripe webhook. The signature header MUST be verified in production —
// we accept the event unconditionally here (env-gated by isBillingEnabled)
// but production deploy must wire @fastify/raw-body + crypto.timingSafeEqual
// against STRIPE_WEBHOOK_SECRET. Until that's wired the endpoint is
// rejected when not in dev.
server.post<{ Body: unknown }>("/api/billing/webhook/stripe", async (request, reply) => {
  if (!isBillingEnabled()) return reply.code(503).send({ error: "billing_unavailable" });
  if (process.env.NODE_ENV === "production" && !process.env.STRIPE_WEBHOOK_SECRET) {
    return reply.code(503).send({ error: "webhook_signature_unconfigured" });
  }
  const body = request.body as
    | { id?: string; type?: string; data?: { object?: Record<string, unknown> } }
    | undefined;
  if (!body?.id || !body?.type || !body?.data?.object) {
    return reply.code(400).send({ error: "invalid_event_shape" });
  }
  try {
    await handleStripeWebhookEvent({
      id: body.id,
      type: body.type,
      data: { object: body.data.object },
    });
    return { received: true };
  } catch (err) {
    // Persist the raw event for later replay even if reconciliation failed.
    await recordSubscriptionEvent({
      externalId: body.id,
      kind: `failed:${body.type}`,
      payload: body,
    });
    request.log.error({ err }, "stripe webhook handling failed");
    return reply.code(500).send({ error: "webhook_handling_failed" });
  }
});

// Convenience header: surface the caller's tier on every billing-aware
// read so the UI can show a "Pro" badge without an extra request.
server.addHook("onSend", async (request, reply, payload) => {
  if (!request.url?.startsWith("/api/billing/")) return payload;
  try {
    const session = await requireSession(request.headers.cookie);
    if (session) {
      reply.header("x-adjudex-tier", await tierFor(session.address));
    }
  } catch {
    // tier header is decorative, never fail the response over it
  }
  return payload;
});

// ─── Referrals (S4.B) ──────────────────────────────────────────────────

// Returns the message the referee should sign before attribution.
// Stateless — caller already has (referrerAddress, nonce). Used by the
// frontend wallet flow to render a "Sign to set X as your referrer" UI.
server.get<{ Querystring: { referrer?: string; nonce?: string } }>(
  "/api/referrals/message",
  async (request, reply) => {
    const session = await requireSession(request.headers.cookie);
    if (!session) return reply.code(401).send({ error: "auth_required" });
    const referrer = request.query.referrer?.trim();
    const nonce = request.query.nonce?.trim();
    if (!referrer || !/^0x[0-9a-fA-F]{40}$/.test(referrer)) {
      return reply.code(400).send({ error: "referrer_invalid" });
    }
    if (!nonce || nonce.length < 8 || nonce.length > 128) {
      return reply.code(400).send({ error: "nonce_invalid" });
    }
    return { message: buildReferralMessage(session.address, referrer, nonce) };
  },
);

// First-write-wins attribution. Returns the row that's in the DB after
// the call. Client can present "already referred by Z" if `created=false`.
server.post<{
  Body: { referrerAddress?: string; signature?: Hex; nonce?: string };
}>("/api/referrals/attribute", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  const { referrerAddress, signature, nonce } = request.body ?? {};
  if (!referrerAddress || !signature || !nonce) {
    return reply.code(400).send({ error: "missing_fields" });
  }
  const result = await attributeReferral({
    address: session.address,
    referrerAddress,
    signature,
    nonce,
  });
  if (!result.ok) return reply.code(400).send({ error: result.error });
  return { ok: true, created: result.created, referrer: result.row.referrer_address };
});

// Show the caller their own referrer (if any).
server.get("/api/referrals/me", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  const row = await getReferral(session.address);
  if (!row) return { referrer: null, attributedAt: null };
  return {
    referrer: row.referrer_address,
    attributedAt: row.attributed_at,
    firstPositionAt: row.first_position_at,
    lifetimeRebateUsdCents: row.lifetime_rebate_usd_cents,
  };
});

// Referrer-side stats: who they referred + accrued rebate.
server.get("/api/referrals/stats", async (request, reply) => {
  const session = await requireSession(request.headers.cookie);
  if (!session) return reply.code(401).send({ error: "auth_required" });
  const stats = await referrerStats(session.address);
  return stats;
});

server.get("/api/wallet", async () => null);
server.post("/api/wallet/connect", async (_request, reply) => reply.code(405).send({ error: "wallet_connector_required" }));
server.post("/api/wallet/disconnect", async (request, reply) => {
  const token = parseCookie(request.headers.cookie, sessionCookieName);
  reply.header("set-cookie", expiredSessionCookie());
  if (!token) return { ok: true, revoked: false };

  try {
    await query("DELETE FROM auth_sessions WHERE token = $1", [token]);
  } catch {
    return reply.code(503).send({ error: "session_revoke_failed" });
  }

  return { ok: true, revoked: true };
});

const port = Number(process.env.PORT ?? 8787);
if (process.env.NODE_ENV !== "test") {
  await server.listen({ port, host: "0.0.0.0" });
}

type ReclaimProofRow = {
  session_id: string;
  provider_id: string;
  proof_hash: `0x${string}`;
  proof: unknown;
  market_id: string | null;
  source_url: string | null;
  chain_id: number | null;
  pool_address: string | null;
  wallet_address: string | null;
  verified_at: Date;
};

type ReclaimProofBinding = {
  marketId: string;
  sourceUrl: string;
  chainId: number | null;
  poolAddress: string | null;
  walletAddress: string | null;
};

function extractRequiredAdjudexBinding(proof: unknown): ReclaimProofBinding | null {
  const context = topLevelReclaimClaimContext(proof);
  if (!context) return null;
  const parsed = parseJsonObject(context);
  const adjudex = parsed?.adjudex;
  if (!adjudex || typeof adjudex !== "object" || Array.isArray(adjudex)) return null;
  const record = adjudex as Record<string, unknown>;
  const marketId = nonEmptyString(record.marketId);
  const sourceUrl = nonEmptyString(record.sourceUrl);
  if (!marketId || !sourceUrl) return null;
  return {
    marketId,
    sourceUrl,
    chainId: positiveIntegerOrNull(record.chainId),
    poolAddress: nonEmptyString(record.poolAddress),
    walletAddress: nonEmptyString(record.walletAddress),
  };
}

function topLevelReclaimClaimContext(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const claimData = record.claimData;
  if (claimData && typeof claimData === "object" && !Array.isArray(claimData)) {
    const context = (claimData as Record<string, unknown>).context;
    if (typeof context === "string") return context;
  }
  const proof = record.proof;
  if (proof && typeof proof === "object" && !Array.isArray(proof)) {
    const proofClaimData = (proof as Record<string, unknown>).claimData;
    if (proofClaimData && typeof proofClaimData === "object" && !Array.isArray(proofClaimData)) {
      const context = (proofClaimData as Record<string, unknown>).context;
      if (typeof context === "string") return context;
    }
  }
  return null;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveIntegerOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function toReclaimProofBindingResponse(binding: ReclaimProofBinding) {
  return {
    marketId: binding.marketId,
    sourceUrl: binding.sourceUrl,
    chainId: binding.chainId ?? undefined,
    poolAddress: binding.poolAddress ?? undefined,
    walletAddress: binding.walletAddress ?? undefined,
  };
}

function isAuthorizedInternalWrite(header: string | string[] | undefined): boolean {
  const expected = process.env.RECLAIM_PROOF_WRITE_SECRET;
  if (!expected) return false;
  const received = Array.isArray(header) ? header[0] : header;
  return received === expected;
}

type DatabaseStatus = {
  ok: boolean;
  configured: boolean;
  latencyMs: number;
  error?: string;
};

type RpcStatus = {
  ok: boolean;
  configured: boolean;
  blockNumber?: number;
  chainId?: number;
  error?: string;
};

type IndexerRow = {
  id: string;
  chain_id: number;
  last_block: string;
  updated_at: Date;
  last_block_hash?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  last_reorg_at?: Date | null;
};

async function checkDatabase(): Promise<DatabaseStatus> {
  if (!process.env.DATABASE_URL) {
    return { ok: false, configured: false, latencyMs: 0, error: "database_not_configured" };
  }
  const startedAt = Date.now();
  try {
    await query("SELECT 1");
    return { ok: true, configured: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { ok: false, configured: true, latencyMs: Date.now() - startedAt, error: "database_probe_failed" };
  }
}

async function checkRpc(rpcUrl: string | undefined, chainId: number): Promise<RpcStatus> {
  if (!rpcUrl) return { ok: false, configured: false };
  try {
    const client = createPublicClient({
      chain: chainId === arbitrumSepolia.id ? arbitrumSepolia : undefined,
      transport: http(rpcUrl),
    });
    const [rpcChainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
    return {
      ok: rpcChainId === chainId,
      configured: true,
      blockNumber: Number(blockNumber),
      chainId: rpcChainId,
      error: rpcChainId === chainId ? undefined : "rpc_chain_mismatch",
    };
  } catch {
    return { ok: false, configured: true, error: "rpc_probe_failed" };
  }
}

function chainReadiness(input: { chainId: number; factoryAddress?: string; rpc: RpcStatus; indexerRow?: IndexerRow }) {
  const indexer = toIndexerStatus(input.indexerRow, input.rpc.blockNumber);
  const factoryConfigured = Boolean(input.factoryAddress);
  const ready = factoryConfigured && input.rpc.ok && indexer.ok;

  return {
    chainId: input.chainId,
    ready,
    configured: factoryConfigured && input.rpc.configured,
    factoryConfigured,
    factoryAddress: input.factoryAddress ?? null,
    rpcConfigured: input.rpc.configured,
    rpc: input.rpc,
    indexer,
  };
}

function toIndexerStatus(row: IndexerRow | undefined, latestBlock?: number) {
  if (!row) {
    return { ok: false, configured: false, error: "indexer_state_missing" };
  }

  const lastBlock = Number(row.last_block);
  const updatedAt = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
  const updatedAtMs = updatedAt.getTime();
  const ageMs = Number.isFinite(updatedAtMs) ? Math.max(0, Date.now() - updatedAtMs) : null;
  const staleThresholdMs = statusNumberEnv("STATUS_INDEXER_STALE_MS", 5 * 60 * 1000);
  const lagThresholdBlocks = statusNumberEnv("STATUS_INDEXER_LAG_BLOCKS", 25);
  const lagBlocks =
    latestBlock !== undefined && Number.isFinite(lastBlock) ? Math.max(0, latestBlock - lastBlock) : null;
  const stale = ageMs === null || ageMs > staleThresholdMs;
  const lagging = lagBlocks !== null && lagBlocks > lagThresholdBlocks;
  const lastBlockInvalid = !Number.isFinite(lastBlock);
  const ok = !lastBlockInvalid && !stale && !lagging;

  const reorgRecent =
    row.last_reorg_at instanceof Date
      ? Date.now() - row.last_reorg_at.getTime() < 60 * 60 * 1000
      : false;

  return {
    ok: ok && (row.last_status ?? "ok") !== "error",
    configured: true,
    id: row.id,
    chainId: row.chain_id,
    lastBlock,
    lastBlockHash: row.last_block_hash ?? null,
    lastStatus: row.last_status ?? "ok",
    lastError: row.last_error ?? null,
    lastReorgAtIso:
      row.last_reorg_at instanceof Date ? toIso(row.last_reorg_at) : null,
    reorgRecent,
    updatedAtIso: toIso(updatedAt),
    ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
    stale,
    staleThresholdSeconds: Math.round(staleThresholdMs / 1000),
    lagBlocks,
    lagging,
    lagThresholdBlocks,
    error: lastBlockInvalid
      ? "indexer_last_block_invalid"
      : stale
        ? "indexer_stale"
        : lagging
          ? "indexer_lagging"
          : row.last_status === "error"
            ? "indexer_error"
            : undefined,
  };
}

function statusNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseRequiredChainId(chainId: unknown) {
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) return null;
  return chainId;
}

function isTransactionHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function normalizeAgentHandle(value: unknown) {
  if (typeof value !== "string") return null;
  const handle = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,47}$/.test(handle)) return null;
  return handle;
}

function truncateOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function truncateOptionalUrl(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return trimmed.slice(0, maxLength);
  } catch {
    return null;
  }
}

function configuredFactoryAddress(chainId: number) {
  const rhcChainId = Number(process.env.RHC_CHAIN_ID ?? 46630);
  if (chainId === 421614) return process.env.MARKET_FACTORY_ADDRESS;
  if (chainId === rhcChainId) return process.env.RHC_MARKET_FACTORY_ADDRESS;
  return undefined;
}

function configuredReputationOracleAddress(chainId?: number) {
  const rhcChainId = Number(process.env.RHC_CHAIN_ID ?? 46630);
  if (chainId === rhcChainId) return process.env.RHC_REPUTATION_ORACLE_ADDRESS ?? process.env.REPUTATION_ORACLE_ADDRESS;
  return process.env.REPUTATION_ORACLE_ADDRESS;
}

function rpcConfigForChain(chainId: number) {
  const rhcChainId = Number(process.env.RHC_CHAIN_ID ?? 46630);
  if (chainId === 421614) return { supported: true, rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL };
  if (chainId === rhcChainId) return { supported: true, rpcUrl: process.env.RHC_RPC_URL };
  return { supported: false, rpcUrl: undefined };
}

function createRpcClient(chainId: number, rpcUrl: string) {
  return chainId === arbitrumSepolia.id
    ? createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) })
    : createPublicClient({ transport: http(rpcUrl) });
}

async function previewBetFromPool(
  market: MarketRow,
  side: "YES" | "NO",
  stakeUsd: number
): Promise<
  | {
      ok: true;
      price: number;
      shares: number;
      potentialPayoutUsd: number;
      poolImpactPct: number;
      requiredContract: string;
      chainId: number;
    }
  | { ok: false; statusCode: 400 | 503; error: string }
> {
  if (!market.pool_address) return { ok: false, statusCode: 400, error: "market_pool_not_configured" };
  if (market.status !== "open") return { ok: false, statusCode: 400, error: "market_not_open" };

  const rpc = rpcConfigForChain(market.chain_id);
  if (!rpc.supported) return { ok: false, statusCode: 400, error: "chain_not_supported" };
  if (!rpc.rpcUrl) return { ok: false, statusCode: 503, error: "rpc_not_configured" };

  const client = createRpcClient(market.chain_id, rpc.rpcUrl);
  const rpcChainId = await client.getChainId().catch(() => null);
  if (rpcChainId !== market.chain_id) return { ok: false, statusCode: 400, error: "rpc_chain_mismatch" };

  try {
    const [yesPoolRaw, noPoolRaw, resolvedRaw, deadlineRaw, latestBlock] = await Promise.all([
      client.readContract({ address: market.pool_address, abi: parimutuelPoolReadAbi, functionName: "yesPool" }),
      client.readContract({ address: market.pool_address, abi: parimutuelPoolReadAbi, functionName: "noPool" }),
      client.readContract({ address: market.pool_address, abi: parimutuelPoolReadAbi, functionName: "resolved" }),
      client.readContract({ address: market.pool_address, abi: parimutuelPoolReadAbi, functionName: "deadline" }),
      client.getBlock(),
    ]);
    if (Boolean(resolvedRaw)) return { ok: false, statusCode: 400, error: "market_resolved" };

    const deadline = Number(deadlineRaw);
    const latestTimestamp = Number(latestBlock.timestamp);
    if (Number.isFinite(deadline) && Number.isFinite(latestTimestamp) && latestTimestamp >= deadline) {
      return { ok: false, statusCode: 400, error: "market_deadline_passed" };
    }

    const yes = Number(yesPoolRaw) / 1_000_000;
    const no = Number(noPoolRaw) / 1_000_000;
    if (!Number.isFinite(yes) || !Number.isFinite(no) || yes < 0 || no < 0) {
      return { ok: false, statusCode: 503, error: "pool_state_invalid" };
    }

    const total = yes + no;
    const sideStake = side === "YES" ? yes : no;
    const otherStake = side === "YES" ? no : yes;
    const price = total > 0 ? sideStake / total : 0.5;
    const newSideStake = sideStake + stakeUsd;
    const potentialPayoutUsd =
      newSideStake > 0 ? stakeUsd + (stakeUsd / newSideStake) * otherStake : stakeUsd;
    const newTotal = total + stakeUsd;

    return {
      ok: true,
      price,
      shares: stakeUsd,
      potentialPayoutUsd,
      poolImpactPct: newTotal > 0 ? (stakeUsd / newTotal) * 100 : 100,
      requiredContract: market.pool_address,
      chainId: market.chain_id,
    };
  } catch {
    return { ok: false, statusCode: 503, error: "pool_state_read_failed" };
  }
}

function canonicalMarketId(chainId: number, rawMarketId: string) {
  return chainId === arbitrumSepolia.id ? rawMarketId : `${chainId}:${rawMarketId}`;
}

// Extracts the on-chain numeric market id from our string id ("12" or
// "421614:12"). Throws if the trailing segment isn't a positive integer
// since BetQuoteVerifier reads it as uint256.
function parseContractMarketId(marketId: string): string {
  const trailing = marketId.includes(":") ? (marketId.split(":").pop() ?? "") : marketId;
  if (!/^\d+$/.test(trailing)) {
    throw new Error(`market id '${marketId}' is not a numeric contract id`);
  }
  return trailing;
}

// Computed at module load so the keccak values exactly mirror the Solidity
// contract's typehashes without us hand-copying a 32-byte literal.
const EIP712_DOMAIN_TYPEHASH = keccak256(
  stringToBytes(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
  ),
);
const QUOTE_DOMAIN_NAME_HASH = keccak256(stringToBytes("Adjudex Bet Quote"));
const QUOTE_DOMAIN_VERSION_HASH = keccak256(stringToBytes("1"));
// keccak256(BET_QUOTE_TYPEHASH) — string fed below to keep it auditable.
const BET_QUOTE_TYPEHASH = keccak256(
  stringToBytes(
    "BetQuote(address pool,uint256 marketId,uint8 side,uint256 stake,uint256 minShares,uint256 maxPoolImpactBps,uint256 deadline,uint256 nonce,address bettor)",
  ),
);

function computeDomainSeparator(verifier: Address, chainId: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        EIP712_DOMAIN_TYPEHASH,
        QUOTE_DOMAIN_NAME_HASH,
        QUOTE_DOMAIN_VERSION_HASH,
        BigInt(chainId),
        verifier,
      ],
    ),
  );
}

function hashBetQuote(q: {
  pool: Address;
  marketId: bigint;
  side: 0 | 1;
  stake: bigint;
  minShares: bigint;
  maxPoolImpactBps: bigint;
  deadline: bigint;
  nonce: bigint;
  bettor: Address;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        BET_QUOTE_TYPEHASH,
        q.pool,
        q.marketId,
        q.side,
        q.stake,
        q.minShares,
        q.maxPoolImpactBps,
        q.deadline,
        q.nonce,
        q.bettor,
      ],
    ),
  );
}

function eventScopedId(chainId: number, transactionHash: string, ...parts: string[]) {
  return [String(chainId), transactionHash, ...parts].join(":");
}

async function requireSession(cookieHeader: string | undefined) {
  const token = parseCookie(cookieHeader, sessionCookieName);
  if (!token) return null;
  const result = await query<{ address: string; chain_id: number | null; domain: string | null; expires_at: Date }>(
    "SELECT address, chain_id, domain, expires_at FROM auth_sessions WHERE token = $1",
    [token]
  );
  const session = result.rows[0];
  if (!session || session.expires_at.getTime() <= Date.now()) return null;
  return { address: session.address, chainId: session.chain_id ?? undefined, domain: session.domain ?? undefined };
}

async function requireImportAdmin(cookieHeader: string | undefined): Promise<
  | { ok: true; address: string }
  | { ok: false; statusCode: 401 | 403 | 503; error: "auth_required" | "admin_not_configured" | "not_admin" }
> {
  const session = await requireSession(cookieHeader);
  if (!session) return { ok: false, statusCode: 401, error: "auth_required" };

  const adminAddresses = configuredImportAdminAddresses();
  if (!adminAddresses) return { ok: false, statusCode: 503, error: "admin_not_configured" };
  if (!adminAddresses.has(session.address.toLowerCase())) {
    return { ok: false, statusCode: 403, error: "not_admin" };
  }

  return { ok: true, address: session.address };
}

function configuredImportAdminAddresses() {
  const raw = process.env.IMPORT_ADMIN_ADDRESSES ?? process.env.ADMIN_WALLET_ADDRESSES;
  const addresses = raw
    ?.split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);
  return addresses && addresses.length > 0 ? new Set(addresses) : null;
}

async function ensureSettings(address: string) {
  await query("INSERT INTO user_settings (address) VALUES ($1) ON CONFLICT (address) DO NOTHING", [address]);
}

const clientActivityKinds = new Set([
  "market_view",
  "portfolio_view",
  "create_opened",
  "search_saved",
  "market_alert_requested",
]);

async function recordUserActivityEvent(input: {
  address: string;
  kind: string;
  marketId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const metadata = JSON.stringify(input.metadata ?? {});
    await query(
      `INSERT INTO user_activity_events (id, address, kind, market_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        createToken(12),
        input.address.toLowerCase(),
        input.kind,
        input.marketId ?? null,
        metadata.length <= 5000 ? metadata : "{}",
      ]
    );
  } catch (error) {
    void captureException(error, { component: "retention-events", kind: input.kind });
  }
}

async function createNotification(input: {
  address: string;
  id: string;
  kind: string;
  marketId?: string;
  title: string;
  body: string;
}) {
  await query(
    `INSERT INTO notification_events (id, address, kind, market_id, title, body)
     SELECT $1, $2, $3, $4, $5, $6
     WHERE EXISTS (
       SELECT 1 FROM user_settings
       WHERE lower(address) = lower($2)
         AND notifications_enabled = true
     )
     ON CONFLICT (id) DO NOTHING`,
    [input.id, input.address, input.kind, input.marketId ?? null, input.title, input.body]
  );
}

async function createResolutionNotifications(
  marketId: string,
  outcome: "YES" | "NO",
  transactionHash: Hex,
  execute: QueryExecutor = query
) {
  await execute(
    `INSERT INTO notification_events (id, address, kind, market_id, title, body)
     SELECT $1 || ':' || lower(w.address), w.address, 'market_resolved', $2, 'Market resolved', 'Outcome: ' || $3
     FROM watchlist w
     JOIN user_settings s ON lower(s.address) = lower(w.address)
     WHERE w.market_id = $2
       AND s.notifications_enabled = true
     ON CONFLICT (id) DO NOTHING`,
    [`${transactionHash}:watchlist`, marketId, outcome]
  );
  await execute(
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

async function ensureImportSources(): Promise<ImportSource[]> {
  const configured = configuredImportSources();
  for (const source of configured) {
    await query(
      `INSERT INTO import_sources (id, name, kind, url, category, oracle_type, active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         kind = EXCLUDED.kind,
         url = EXCLUDED.url,
         category = EXCLUDED.category,
         oracle_type = EXCLUDED.oracle_type,
         active = EXCLUDED.active,
         updated_at = now()`,
      [source.id, source.name, source.kind, source.url, source.category, source.oracleType]
    );
  }
  const result = await query<ImportSourceRow>(
    "SELECT * FROM import_sources WHERE active = true ORDER BY name ASC"
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind === "json" ? "json" : "rss",
    url: row.url,
    category: row.category as ImportSource["category"],
    oracleType: row.oracle_type as ImportSource["oracleType"],
    active: row.active,
  }));
}

async function upsertImportCandidate(candidate: ImportCandidateDraft): Promise<string> {
  const saved = await query<{ id: string }>(
    `INSERT INTO import_candidates (
       id, source_id, title, source_url, source_published_at, event_date,
       category, question, description, oracle_type, asset, deadline_at,
       resolution_criteria, confidence, status, risk_flags
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
     ON CONFLICT (source_id, source_url) DO UPDATE SET
       title = EXCLUDED.title,
       source_published_at = EXCLUDED.source_published_at,
       event_date = EXCLUDED.event_date,
       category = EXCLUDED.category,
       question = EXCLUDED.question,
       description = EXCLUDED.description,
       oracle_type = EXCLUDED.oracle_type,
       asset = EXCLUDED.asset,
       deadline_at = EXCLUDED.deadline_at,
       resolution_criteria = EXCLUDED.resolution_criteria,
       confidence = EXCLUDED.confidence,
       status = CASE
         WHEN import_candidates.status = 'deployed' THEN import_candidates.status
         ELSE EXCLUDED.status
       END,
       risk_flags = EXCLUDED.risk_flags,
       updated_at = now()
     RETURNING id`,
    [
      candidate.id,
      candidate.sourceId,
      candidate.title,
      candidate.sourceUrl,
      candidate.sourcePublishedAtIso,
      candidate.eventDateIso,
      candidate.category,
      candidate.question,
      candidate.description,
      candidate.oracleType,
      candidate.asset,
      candidate.deadlineIso,
      candidate.resolutionCriteria,
      candidate.confidence,
      candidate.status,
      JSON.stringify(candidate.riskFlags),
    ]
  );
  const candidateId = saved.rows[0]?.id ?? candidate.id;
  await query(
    `INSERT INTO import_candidate_sources (id, candidate_id, source_url, label)
     VALUES ($1, $2, $3, 'primary')
     ON CONFLICT (id) DO NOTHING`,
    [`${candidateId}:primary`, candidateId, candidate.sourceUrl]
  );
  return candidateId;
}

async function getImportCandidate(id: string): Promise<ImportCandidateRow | null> {
  const result = await query<ImportCandidateRow>("SELECT * FROM import_candidates WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

function toImportSourceResponse(source: ImportSource) {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    url: source.url,
    category: source.category,
    oracleType: source.oracleType,
    active: source.active,
  };
}

function toImportCandidate(row: ImportCandidateRow) {
  return {
    id: row.id,
    sourceId: row.source_id,
    title: row.title,
    sourceUrl: row.source_url,
    sourcePublishedAtIso: row.source_published_at ? toIso(row.source_published_at) : undefined,
    eventDateIso: row.event_date ? toIso(row.event_date) : undefined,
    category: row.category,
    question: row.question,
    description: row.description,
    oracleType: row.oracle_type,
    asset: row.asset,
    deadlineIso: row.deadline_at ? toIso(row.deadline_at) : undefined,
    resolutionCriteria: row.resolution_criteria ?? undefined,
    confidence: asNumber(row.confidence),
    status: row.status,
    riskFlags: parseJsonArray(row.risk_flags),
    validationErrors: parseJsonArray(row.validation_errors),
    spec: row.spec_json ?? undefined,
    specHash: row.spec_hash ?? undefined,
    specUri: row.spec_uri ?? undefined,
    createdAtIso: toIso(row.created_at),
    updatedAtIso: toIso(row.updated_at),
  };
}

async function verifyMarketCreatedReceipt(input: {
  transactionHash: Hex;
  chainId: number;
  marketId: string;
  poolAddress: string;
  factoryAddress: string;
  expectedSpecHash?: string | null;
  expectedSpecUri?: string | null;
  expectedDeadline?: bigint;
}): Promise<
  | {
      ok: true;
      event: {
        factoryAddress: string;
        marketId: bigint;
        pool: string;
        specHash: string;
        creator: string;
        resolver: string;
        deadline: bigint;
        specUri: string;
      };
    }
  | { ok: false; error: string }
> {
  const rpc = rpcConfigForChain(input.chainId);
  if (!rpc.supported) return { ok: false, error: "chain_not_supported" };
  if (!rpc.rpcUrl) return { ok: false, error: "rpc_not_configured" };

  const client = createRpcClient(input.chainId, rpc.rpcUrl);
  const rpcChainId = await client.getChainId().catch(() => null);
  if (rpcChainId !== input.chainId) return { ok: false, error: "rpc_chain_mismatch" };
  const receipt = await client.getTransactionReceipt({ hash: input.transactionHash }).catch(() => null);
  if (!receipt) return { ok: false, error: "transaction_not_found" };
  if (receipt.status !== "success") return { ok: false, error: "transaction_reverted" };

  const events = parseEventLogs({
    abi: marketFactoryEventAbi,
    eventName: "MarketCreated",
    logs: receipt.logs,
  });
  const expectedMarketId = BigInt(input.marketId);
  const expectedPool = input.poolAddress.toLowerCase();
  const factory = input.factoryAddress.toLowerCase();
  for (const event of events) {
    const args = event.args as {
      marketId: bigint;
      pool: string;
      specHash: string;
      creator: string;
      resolver: string;
      deadline: bigint;
      specUri: string;
    };
    const matchesIdentity =
      event.address.toLowerCase() === factory &&
      args.marketId === expectedMarketId &&
      args.pool.toLowerCase() === expectedPool;
    if (!matchesIdentity) continue;
    if (input.expectedSpecHash && args.specHash.toLowerCase() !== input.expectedSpecHash.toLowerCase()) {
      return { ok: false, error: "market_created_spec_hash_mismatch" };
    }
    if (input.expectedSpecUri && args.specUri !== input.expectedSpecUri) {
      return { ok: false, error: "market_created_spec_uri_mismatch" };
    }
    if (input.expectedDeadline !== undefined && args.deadline !== input.expectedDeadline) {
      return { ok: false, error: "market_created_deadline_mismatch" };
    }
    return (
      {
        ok: true,
        event: {
          factoryAddress: event.address,
          marketId: args.marketId,
          pool: args.pool,
          specHash: args.specHash,
          creator: args.creator,
          resolver: args.resolver,
          deadline: args.deadline,
          specUri: args.specUri,
        },
      }
    );
  }
  return { ok: false, error: "market_created_event_not_found" };
}

async function syncConfirmedTransaction(transactionHash: Hex, chainId: number, options: { requireTrustedEvent?: boolean } = {}): Promise<
  | { ok: true; status: "confirmed"; blockNumber: number; reconciled: Array<{ type: string; id?: string; marketId?: string }> }
  | { ok: false; statusCode: number; error: string }
> {
  const rpc = rpcConfigForChain(chainId);
  if (!rpc.supported) return { ok: false, statusCode: 400, error: "chain_not_supported" };
  if (!rpc.rpcUrl) return { ok: false, statusCode: 503, error: "rpc_not_configured" };
  const client = createRpcClient(chainId, rpc.rpcUrl);
  const rpcChainId = await client.getChainId().catch(() => null);
  if (rpcChainId !== chainId) return { ok: false, statusCode: 400, error: "rpc_chain_mismatch" };
  const receipt = await client.getTransactionReceipt({ hash: transactionHash }).catch(() => null);
  if (!receipt) return { ok: false, statusCode: 404, error: "transaction_not_found" };

  const minConfirmations = transactionSyncMinConfirmations();
  if (minConfirmations > 0) {
    const latestBlock = await client.getBlockNumber().catch(() => null);
    if (latestBlock === null) {
      return { ok: false, statusCode: 503, error: "rpc_latest_block_unavailable" };
    }
    const confirmations = Number(latestBlock >= receipt.blockNumber ? latestBlock - receipt.blockNumber + 1n : 0n);
    if (confirmations < minConfirmations) {
      await query(
        `INSERT INTO transaction_syncs (transaction_hash, chain_id, status, block_hash, block_number, updated_at)
         VALUES ($1, $2, 'pending_confirmations', $3, $4, now())
         ON CONFLICT (transaction_hash, chain_id) DO UPDATE SET
           status = EXCLUDED.status,
           block_hash = EXCLUDED.block_hash,
           block_number = EXCLUDED.block_number,
           updated_at = now()`,
        [transactionHash, chainId, receipt.blockHash, Number(receipt.blockNumber)]
      );
      return { ok: false, statusCode: 409, error: "transaction_insufficient_confirmations" };
    }
  }

  if (receipt.status !== "success") {
    await query(
      `INSERT INTO transaction_syncs (transaction_hash, chain_id, status, block_hash, block_number, updated_at)
       VALUES ($1, $2, 'reverted', $3, $4, now())
       ON CONFLICT (transaction_hash, chain_id) DO UPDATE SET
         status = EXCLUDED.status,
         block_hash = EXCLUDED.block_hash,
         block_number = EXCLUDED.block_number,
         updated_at = now()`,
      [transactionHash, chainId, receipt.blockHash, Number(receipt.blockNumber)]
    );
    return { ok: false, statusCode: 400, error: "transaction_reverted" };
  }
  const reconciled = await transaction(async (execute) => {
    const nextReconciled = await reconcileReceipt({ transactionHash, chainId, receipt, client, execute });
    if (options.requireTrustedEvent && !hasTrustedReconciliation(nextReconciled)) return nextReconciled;
    await execute(
      `INSERT INTO transaction_syncs (transaction_hash, chain_id, status, block_hash, block_number, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (transaction_hash, chain_id) DO UPDATE SET
         status = EXCLUDED.status,
         block_hash = EXCLUDED.block_hash,
         block_number = EXCLUDED.block_number,
         updated_at = now()`,
      [transactionHash, chainId, "confirmed", receipt.blockHash, Number(receipt.blockNumber)]
    );
    return nextReconciled;
  });
  if (options.requireTrustedEvent && !hasTrustedReconciliation(reconciled)) {
    return { ok: false, statusCode: 400, error: "trusted_adjudex_event_not_found" };
  }
  return { ok: true, status: "confirmed", blockNumber: Number(receipt.blockNumber), reconciled };
}

function transactionSyncMinConfirmations() {
  const raw = process.env.TRANSACTION_SYNC_MIN_CONFIRMATIONS?.trim();
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function hasTrustedReconciliation(reconciled: Array<{ type: string }>) {
  return reconciled.some((item) =>
    item.type === "market_created" ||
    item.type === "resolution_proposed" ||
    item.type === "bet" ||
    item.type === "resolution" ||
    item.type === "resolution_finalized" ||
    item.type === "claim" ||
    item.type === "refund" ||
    item.type === "agent_registered"
  );
}

async function reconcileReceipt(input: {
  transactionHash: Hex;
  chainId: number;
  receipt: Pick<TransactionReceipt, "logs" | "blockNumber" | "blockHash"> & Partial<Pick<TransactionReceipt, "from">>;
  client: ReturnType<typeof createRpcClient>;
  execute?: QueryExecutor;
}) {
  const execute = input.execute ?? query;
  const reconciled: Array<{ type: string; id?: string; marketId?: string }> = [];

  const marketCreated = parseEventLogs({
    abi: marketFactoryEventAbi,
    eventName: "MarketCreated",
    logs: input.receipt.logs,
  });
  for (const event of marketCreated) {
    const configuredFactory = configuredFactoryAddress(input.chainId);
    if (!configuredFactory) {
      reconciled.push({ type: "market_created_factory_not_configured" });
      continue;
    }
    if (event.address.toLowerCase() !== configuredFactory.toLowerCase()) {
      reconciled.push({ type: "market_created_untrusted_factory" });
      continue;
    }
    const args = event.args as {
      marketId: bigint;
      pool: string;
      creator: string;
      resolver: string;
      deadline: bigint;
      specUri: string;
    };
    const spec = parseSpecUri(args.specUri);
    const dbMarketId = canonicalMarketId(input.chainId, args.marketId.toString());
    if (spec) {
      await execute(
        `INSERT INTO markets (id, pool_address, chain_id, factory_address, creation_tx_hash, creator_address, title, description, category, oracle_type, asset, source_url, resolution_criteria, resolver_address, deadline_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, to_timestamp($15))
         ON CONFLICT (id) DO UPDATE SET
           pool_address = EXCLUDED.pool_address,
           chain_id = EXCLUDED.chain_id,
           factory_address = EXCLUDED.factory_address,
           creation_tx_hash = EXCLUDED.creation_tx_hash,
           creator_address = EXCLUDED.creator_address,
           resolver_address = EXCLUDED.resolver_address,
           updated_at = now()`,
        [
          dbMarketId,
          args.pool,
          input.chainId,
          event.address,
          input.transactionHash,
          args.creator,
          spec.title,
          spec.description,
          spec.category,
          spec.oracleType,
          spec.asset,
          spec.sourceUrl,
          spec.resolutionCriteria,
          args.resolver,
          Number(args.deadline),
        ]
      );
      await execute("INSERT INTO market_stats (market_id) VALUES ($1) ON CONFLICT (market_id) DO NOTHING", [dbMarketId]);
      reconciled.push({ type: "market_created", marketId: dbMarketId });
    } else {
      reconciled.push({ type: "market_created_unparsed_spec", marketId: dbMarketId });
    }
  }

  const proposedEvents = parseEventLogs({
    abi: aiJudgeVerifierEventAbi,
    eventName: "Proposed",
    logs: input.receipt.logs,
  });
  for (const event of proposedEvents) {
    const args = event.args as {
      pool: string;
      marketId: bigint;
      outcome: number;
      evidenceHash: string;
      proposedAt: bigint;
    };
    const market = await marketByPool(args.pool, input.chainId);
    if (!market) {
      reconciled.push({ type: "resolution_proposed_unmatched_pool" });
      continue;
    }
    if (!market.resolverAddress) {
      reconciled.push({ type: "resolution_proposed_missing_resolver", marketId: market.id });
      continue;
    }
    if (!isTrustedResolverLog(event.address, market.resolverAddress)) {
      reconciled.push({ type: "resolution_proposed_untrusted_resolver", marketId: market.id });
      continue;
    }
    await execute(
      `UPDATE markets SET
         status = CASE WHEN status = 'resolved' THEN status ELSE 'resolving' END,
         resolution_evidence_hash = $2,
         resolution_proposer = $3,
         resolution_proposed_at = to_timestamp($4),
         resolution_proof_tx_hash = $5,
         updated_at = now()
       WHERE id = $1`,
      [market.id, args.evidenceHash, input.receipt.from ?? null, Number(args.proposedAt), input.transactionHash]
    );
    reconciled.push({ type: "resolution_proposed", marketId: market.id });
  }

  const betEvents = parseEventLogs({
    abi: parimutuelPoolEventAbi,
    eventName: "BetPlaced",
    logs: input.receipt.logs,
  });
  for (const event of betEvents) {
    const market = await marketByPool(event.address, input.chainId);
    if (!market) {
      reconciled.push({ type: "bet_unmatched_pool" });
      continue;
    }
    const args = event.args as { bettor: string; side: number; amount: bigint; positionId: bigint };
    const side = Number(args.side) === 0 ? "YES" : "NO";
    const amountUsd = Number(args.amount) / 1_000_000;
    const sidePrice = side === "YES" ? market.yesProbability / 100 : 1 - market.yesProbability / 100;
    const shares = sidePrice > 0 ? amountUsd / sidePrice : 0;
    const positionId = `${market.id}#${String(args.positionId)}`;
    const blockNumber = Number(event.blockNumber ?? input.receipt.blockNumber);
    const blockHash = logBlockHash(event) ?? input.receipt.blockHash;
    const logIndex = logIndexNumber(event.logIndex);
    const activityId = eventScopedId(input.chainId, input.transactionHash, "bet", String(args.positionId), String(logIndex));
    await execute(
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
      [positionId, args.bettor, market.id, side, amountUsd, sidePrice, shares, input.transactionHash, input.chainId, blockHash, blockNumber, logIndex]
    );
    await execute(
      `INSERT INTO activity_events (id, kind, market_id, side, amount_usd, wallet_short, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, 'bet', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [activityId, market.id, side, amountUsd, walletShort(args.bettor), input.transactionHash, input.chainId, blockHash, blockNumber, logIndex]
    );
    await insertTimelinePointFromPool({
      execute,
      client: input.client,
      marketId: market.id,
      poolAddress: event.address,
      eventKind: "bet",
      transactionHash: input.transactionHash,
      chainId: input.chainId,
      blockHash,
      blockNumber,
      logIndex,
    });
    reconciled.push({ type: "bet", id: activityId, marketId: market.id });
  }

  const resolutionEvents = parseEventLogs({
    abi: parimutuelPoolEventAbi,
    eventName: "MarketResolved",
    logs: input.receipt.logs,
  });
  for (const event of resolutionEvents) {
    const market = await marketByPool(event.address, input.chainId);
    if (!market) {
      reconciled.push({ type: "resolution_unmatched_pool" });
      continue;
    }
    const args = event.args as { side: number };
    const outcome = Number(args.side) === 0 ? "YES" : "NO";
    const blockNumber = Number(event.blockNumber ?? input.receipt.blockNumber);
    const blockHash = logBlockHash(event) ?? input.receipt.blockHash;
    const logIndex = logIndexNumber(event.logIndex);
    await execute(
      "UPDATE markets SET status = 'resolved', resolved_outcome = $2, resolution_tx_hash = $3, updated_at = now() WHERE id = $1",
      [market.id, outcome, input.transactionHash]
    );
    const activityId = eventScopedId(input.chainId, input.transactionHash, "resolution", String(logIndex));
    await execute(
      `INSERT INTO activity_events (id, kind, market_id, resolved_as, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, 'resolution', $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [activityId, market.id, outcome, input.transactionHash, input.chainId, blockHash, blockNumber, logIndex]
    );
    await execute(
      "UPDATE positions SET status = CASE WHEN side = $2 THEN 'claimable' ELSE 'lost' END, updated_at = now() WHERE market_id = $1 AND status = 'open'",
      [market.id, outcome]
    );
    await createResolutionNotifications(market.id, outcome, input.transactionHash, execute);
    await insertTimelinePointFromPool({
      execute,
      client: input.client,
      marketId: market.id,
      poolAddress: event.address,
      eventKind: "resolution",
      transactionHash: input.transactionHash,
      chainId: input.chainId,
      blockHash,
      blockNumber,
      logIndex,
    });
    reconciled.push({ type: "resolution", id: activityId, marketId: market.id });
  }

  const finalizedEvents = parseEventLogs({
    abi: aiJudgeVerifierEventAbi,
    eventName: "Finalized",
    logs: input.receipt.logs,
  });
  for (const event of finalizedEvents) {
    const args = event.args as { pool: string; marketId: bigint; outcome: number; evidenceHash: string };
    const market = await marketByPool(args.pool, input.chainId);
    if (!market) {
      reconciled.push({ type: "resolution_finalized_unmatched_pool" });
      continue;
    }
    if (!market.resolverAddress) {
      reconciled.push({ type: "resolution_finalized_missing_resolver", marketId: market.id });
      continue;
    }
    if (!isTrustedResolverLog(event.address, market.resolverAddress)) {
      reconciled.push({ type: "resolution_finalized_untrusted_resolver", marketId: market.id });
      continue;
    }
    const outcome = Number(args.outcome) === 0 ? "YES" : "NO";
    await execute(
      `UPDATE markets SET
         status = 'resolved',
         resolved_outcome = $2,
         resolution_tx_hash = $3,
         resolution_evidence_hash = $4,
         resolution_proof_tx_hash = COALESCE(resolution_proof_tx_hash, $3),
         updated_at = now()
       WHERE id = $1`,
      [market.id, outcome, input.transactionHash, args.evidenceHash]
    );
    reconciled.push({ type: "resolution_finalized", marketId: market.id });
  }

  const claimEvents = parseEventLogs({
    abi: parimutuelPoolEventAbi,
    eventName: "Claimed",
    logs: input.receipt.logs,
  });
  for (const event of claimEvents) {
    const market = await marketByPool(event.address, input.chainId);
    if (!market) {
      reconciled.push({ type: "claim_unmatched_pool" });
      continue;
    }
    const args = event.args as { bettor: string; positionId: bigint; payout: bigint };
    const positionId = `${market.id}#${String(args.positionId)}`;
    const payoutUsd = Number(args.payout) / 1_000_000;
    const blockNumber = Number(event.blockNumber ?? input.receipt.blockNumber);
    const blockHash = logBlockHash(event) ?? input.receipt.blockHash;
    const logIndex = logIndexNumber(event.logIndex);
    const claimId = eventScopedId(input.chainId, input.transactionHash, "claim", String(args.positionId), String(logIndex));
    await execute(
      `INSERT INTO claims (id, position_id, payout_usd, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [claimId, positionId, payoutUsd, input.transactionHash, input.chainId, blockHash, blockNumber, logIndex]
    );
    await execute("UPDATE positions SET status = 'claimed', payout_usd = $2, updated_at = now() WHERE id = $1", [positionId, payoutUsd]);
    await execute(
      `INSERT INTO activity_events (id, kind, market_id, amount_usd, wallet_short, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, 'claim', $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [`${claimId}:activity`, market.id, payoutUsd, walletShort(args.bettor), input.transactionHash, input.chainId, blockHash, blockNumber, logIndex]
    );
    await insertTimelinePointFromPool({
      execute,
      client: input.client,
      marketId: market.id,
      poolAddress: event.address,
      eventKind: "claim",
      transactionHash: input.transactionHash,
      chainId: input.chainId,
      blockHash,
      blockNumber,
      logIndex,
    });
    reconciled.push({ type: "claim", id: claimId, marketId: market.id });
  }

  const refundEvents = parseEventLogs({
    abi: parimutuelPoolEventAbi,
    eventName: "Refunded",
    logs: input.receipt.logs,
  });
  for (const event of refundEvents) {
    const market = await marketByPool(event.address, input.chainId);
    if (!market) {
      reconciled.push({ type: "refund_unmatched_pool" });
      continue;
    }
    const args = event.args as { bettor: string; positionId: bigint; amount: bigint };
    const positionId = `${market.id}#${String(args.positionId)}`;
    const amountUsd = Number(args.amount) / 1_000_000;
    const blockNumber = Number(event.blockNumber ?? input.receipt.blockNumber);
    const blockHash = logBlockHash(event) ?? input.receipt.blockHash;
    const logIndex = logIndexNumber(event.logIndex);
    const refundId = eventScopedId(input.chainId, input.transactionHash, "refund", String(args.positionId), String(logIndex));
    await execute(
      `INSERT INTO refunds (id, position_id, amount_usd, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [refundId, positionId, amountUsd, input.transactionHash, input.chainId, blockHash, blockNumber, logIndex]
    );
    await execute("UPDATE positions SET status = 'refunded', payout_usd = $2, updated_at = now() WHERE id = $1", [positionId, amountUsd]);
    await execute(
      `INSERT INTO activity_events (id, kind, market_id, amount_usd, wallet_short, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, 'refund', $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [`${refundId}:activity`, market.id, amountUsd, walletShort(args.bettor), input.transactionHash, input.chainId, blockHash, blockNumber, logIndex]
    );
    await insertTimelinePointFromPool({
      execute,
      client: input.client,
      marketId: market.id,
      poolAddress: event.address,
      eventKind: "refund",
      transactionHash: input.transactionHash,
      chainId: input.chainId,
      blockHash,
      blockNumber,
      logIndex,
    });
    reconciled.push({ type: "refund", id: refundId, marketId: market.id });
  }

  const agentRegisteredParsed = parseEventLogs({
    abi: reputationOracleEventAbi,
    eventName: "AgentRegistered",
    logs: input.receipt.logs,
  });
  const agentRegisteredEvents = Array.isArray(agentRegisteredParsed) ? agentRegisteredParsed : [];
  for (const event of agentRegisteredEvents) {
    const configuredOracle = configuredReputationOracleAddress(input.chainId);
    if (!configuredOracle) {
      reconciled.push({ type: "agent_registered_oracle_not_configured" });
      continue;
    }
    if (event.address.toLowerCase() !== configuredOracle.toLowerCase()) {
      reconciled.push({ type: "agent_registered_untrusted_oracle" });
      continue;
    }
    const args = event.args as { agentId: string; wallet: string; handle: string };
    const handle = normalizeAgentHandle(args.handle);
    if (!handle) {
      reconciled.push({ type: "agent_registered_invalid_handle" });
      continue;
    }
    const registeredAt = await blockTimestampIso(input.client, input.receipt.blockNumber);
    await execute(
      `INSERT INTO agents
         (id, handle, reputation, lifetime_pnl_usd, markets_touched, erc8004_address, chain_id, registration_tx_hash, last_action, registered_at)
       VALUES ($1, $2, 0, 0, 0, $3, $4, $5, 'registered', $6)
       ON CONFLICT (id) DO UPDATE SET
         handle = EXCLUDED.handle,
         erc8004_address = EXCLUDED.erc8004_address,
         chain_id = EXCLUDED.chain_id,
         registration_tx_hash = EXCLUDED.registration_tx_hash,
         last_action = EXCLUDED.last_action,
         registered_at = COALESCE(agents.registered_at, EXCLUDED.registered_at),
         updated_at = now()`,
      [args.agentId, handle, args.wallet, input.chainId, input.transactionHash, registeredAt]
    );
    await execute(
      `INSERT INTO agent_reputation_history
         (id, agent_id, reputation, lifetime_pnl_usd, markets_touched, reason, transaction_hash, chain_id, created_at)
       VALUES ($1, $2, 0, 0, 0, 'registered on ReputationOracle', $3, $4, COALESCE($5::timestamptz, now()))
       ON CONFLICT (id) DO NOTHING`,
      [eventScopedId(input.chainId, input.transactionHash, "agent-registered", String(logIndexNumber(event.logIndex))), args.agentId, input.transactionHash, input.chainId, registeredAt]
    );
    reconciled.push({ type: "agent_registered", id: args.agentId });
  }

  return reconciled;
}

function parseSpecUri(specUri: string): ImportCandidateSpecJson | null {
  if (!specUri.startsWith("data:application/json;base64,")) return null;
  try {
    const json = Buffer.from(specUri.slice("data:application/json;base64,".length), "base64").toString("utf8");
    const parsed = JSON.parse(json) as Partial<ImportCandidateSpecJson>;
    const validation = validateMarketDraft(parsed);
    return validation.ok ? (parsed as ImportCandidateSpecJson) : null;
  } catch {
    return null;
  }
}

function logIndexNumber(logIndex: number | bigint | undefined) {
  return typeof logIndex === "bigint" ? Number(logIndex) : logIndex ?? 0;
}

function logBlockHash(event: { blockHash?: Hex | null }) {
  return event.blockHash ?? null;
}

async function blockTimestampIso(client: ReturnType<typeof createRpcClient>, blockNumber: bigint) {
  const block = await client.getBlock({ blockNumber }).catch(() => null);
  if (!block) return null;
  return new Date(Number(block.timestamp) * 1000).toISOString();
}

async function insertTimelinePointFromPool(input: {
  execute: QueryExecutor;
  client: ReturnType<typeof createRpcClient>;
  marketId: string;
  poolAddress: string;
  eventKind: "bet" | "resolution" | "claim" | "refund";
  transactionHash: Hex;
  chainId: number;
  blockHash: Hex;
  blockNumber: number;
  logIndex: number;
}) {
  try {
    const [yesPctRaw, totalVolumeRaw] = await Promise.all([
      input.client.readContract({
        address: input.poolAddress as Hex,
        abi: parimutuelPoolReadAbi,
        functionName: "getYesPct",
        blockNumber: BigInt(input.blockNumber),
      }),
      input.client.readContract({
        address: input.poolAddress as Hex,
        abi: parimutuelPoolReadAbi,
        functionName: "getTotalVolume",
        blockNumber: BigInt(input.blockNumber),
      }),
    ]);
    await input.execute(
      `INSERT INTO market_timeline (id, market_id, yes_probability, volume_usd, event_kind, transaction_hash, chain_id, block_hash, block_number, log_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [
        `${input.marketId}:${input.eventKind}:${input.transactionHash}:${input.logIndex}`,
        input.marketId,
        Number(yesPctRaw) / 100,
        Number(totalVolumeRaw) / 1_000_000,
        input.eventKind,
        input.transactionHash,
        input.chainId,
        input.blockHash,
        input.blockNumber,
        input.logIndex,
      ]
    );
  } catch {
    return false;
  }
  return true;
}

async function marketByPool(poolAddress: string, chainId: number): Promise<{ id: string; yesProbability: number; resolverAddress: string | null } | null> {
  const result = await query<{ id: string; yes_probability: unknown; resolver_address: string | null }>(
    `SELECT m.id, m.resolver_address, s.yes_probability
     FROM markets m
     JOIN market_stats s ON s.market_id = m.id
     WHERE lower(m.pool_address) = lower($1)
       AND m.chain_id = $2`,
    [poolAddress, chainId]
  );
  if (!result.rows[0]) return null;
  return { id: result.rows[0].id, yesProbability: asNumber(result.rows[0].yes_probability), resolverAddress: result.rows[0].resolver_address };
}

function isTrustedResolverLog(logAddress: string, resolverAddress: string | null | undefined) {
  return Boolean(resolverAddress) && logAddress.toLowerCase() === resolverAddress?.toLowerCase();
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function marketSelect() {
  // The lateral subquery materialises up to 3 most recent distinct
  // trader addresses per market. Used by <TraderStack> on market cards
  // for social proof (S6.A). Cardinality is bounded by LIMIT 3 — no
  // table-scan risk even on busy pools.
  return `SELECT m.*, s.volume_usd, s.yes_probability, s.yes_probability_change_1h, s.bettors, s.ai_lp_count, s.is_hot,
                 COALESCE(rt.addresses, ARRAY[]::TEXT[]) AS recent_traders
          FROM markets m
          JOIN market_stats s ON s.market_id = m.id
          LEFT JOIN LATERAL (
            SELECT ARRAY_AGG(address ORDER BY most_recent DESC) AS addresses
            FROM (
              SELECT lower(address) AS address, MAX(created_at) AS most_recent
              FROM positions
              WHERE market_id = m.id
              GROUP BY lower(address)
              ORDER BY MAX(created_at) DESC
              LIMIT 3
            ) t
          ) rt ON TRUE`;
}

function marketsCacheKey(params: { category?: string; hotOnly?: string; query?: string }) {
  if (process.env.MARKETS_CACHE_BACKEND !== "redis") return null;
  const ttl = marketsCacheTtlSeconds();
  if (ttl <= 0) return null;
  const normalized = new URLSearchParams();
  if (params.category) normalized.set("category", params.category);
  if (params.hotOnly) normalized.set("hotOnly", params.hotOnly);
  if (params.query) normalized.set("query", params.query.trim().toLowerCase());
  normalized.sort();
  return `markets:list:${normalized.toString()}`;
}

function marketsCacheTtlSeconds() {
  const raw = process.env.MARKETS_CACHE_TTL_SECONDS?.trim();
  if (!raw) return 15;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

const marketFactoryEventAbi = [
  {
    type: "event",
    name: "MarketCreated",
    inputs: [
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "pool", type: "address" },
      { indexed: true, name: "specHash", type: "bytes32" },
      { indexed: false, name: "creator", type: "address" },
      { indexed: false, name: "resolver", type: "address" },
      { indexed: false, name: "deadline", type: "uint256" },
      { indexed: false, name: "specUri", type: "string" },
    ],
  },
] as const;

const parimutuelPoolReadAbi = [
  { type: "function", name: "yesPool", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "noPool", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "resolved", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "deadline", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getYesPct", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getTotalVolume", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const parimutuelPoolEventAbi = [
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

const reputationOracleEventAbi = [
  {
    type: "event",
    name: "AgentRegistered",
    inputs: [
      { indexed: true, name: "agentId", type: "bytes32" },
      { indexed: true, name: "wallet", type: "address" },
      { indexed: false, name: "handle", type: "string" },
    ],
  },
] as const;

type ImportSourceRow = {
  id: string;
  name: string;
  kind: string;
  url: string;
  category: string;
  oracle_type: string;
  active: boolean;
};

type ImportCandidateSpecJson = {
  title: string;
  description: string;
  category: "stocks" | "crypto" | "sports" | "soft";
  oracleType: "chainlink-price" | "zktls-ai-oracle" | "manual";
  asset: "USDC" | "tokenized-TSLA" | "tokenized-AAPL";
  deadlineIso: string;
  feeBps: number;
  sourceUrl: string;
  resolutionCriteria: string;
};

type ImportCandidateRow = {
  id: string;
  source_id: string;
  title: string;
  source_url: string;
  source_published_at: Date | null;
  event_date: Date | null;
  category: "stocks" | "crypto" | "sports" | "soft";
  question: string;
  description: string;
  oracle_type: "chainlink-price" | "zktls-ai-oracle" | "manual";
  asset: "USDC" | "tokenized-TSLA" | "tokenized-AAPL";
  deadline_at: Date | null;
  resolution_criteria: string | null;
  confidence: unknown;
  status: "needs_review" | "rejected" | "validated" | "deployed";
  risk_flags: unknown;
  validation_errors: unknown;
  spec_json: ImportCandidateSpecJson | null;
  spec_hash: string | null;
  spec_uri: string | null;
  created_at: Date;
  updated_at: Date;
};

type ImportDeployBody = {
  transactionHash?: string;
  marketId?: string;
  poolAddress?: string;
  creatorAddress?: string;
  chainId?: number;
  factoryAddress?: string;
};

type MarketRow = {
  id: string;
  pool_address: `0x${string}`;
  chain_id: number;
  factory_address: string | null;
  creation_tx_hash: string | null;
  creator_address: string | null;
  emoji: string;
  title: string;
  description: string;
  category: "stocks" | "crypto" | "sports" | "esports" | "soft";
  oracle_type: "chainlink-price" | "zktls-ai-oracle" | "manual";
  status: "draft" | "open" | "locked" | "resolving" | "resolved" | "claimable" | "archived";
  asset: "USDC" | "tokenized-TSLA" | "tokenized-AAPL";
  volume_usd: unknown;
  yes_probability: unknown;
  yes_probability_change_1h: unknown;
  bettors: number;
  ai_lp_count: number;
  is_hot: boolean;
  deadline_at: Date;
  resolved_outcome: "YES" | "NO" | null;
  source_url: string | null;
  resolution_criteria: string | null;
  resolver_address: string | null;
  resolution_tx_hash: string | null;
  resolution_evidence_hash: string | null;
  resolution_proposer: string | null;
  resolution_proposed_at: Date | null;
  resolution_proof_tx_hash: string | null;
  proof_url: string | null;
  import_source_id: string | null;
  import_candidate_id: string | null;
  source_published_at: Date | null;
  provenance_note: string | null;
  recent_traders: string[] | null;
  game: string | null;
  tournament: string | null;
  team_a: string | null;
  team_b: string | null;
  match_starts_at: Date | null;
  best_of_maps: number | null;
  stream_url: string | null;
  sport: string | null;
  league: string | null;
  parent_market_id: string | null;
  kind: string | null;
};

function toMarket(row: MarketRow) {
  return {
    id: row.id,
    poolAddress: row.pool_address,
    chainId: row.chain_id,
    factoryAddress: row.factory_address ?? undefined,
    creationTxHash: row.creation_tx_hash ?? undefined,
    creatorAddress: row.creator_address ?? undefined,
    emoji: row.emoji,
    title: row.title,
    description: row.description,
    category: row.category,
    oracleType: row.oracle_type,
    status: row.status,
    asset: row.asset,
    volumeUsd: asNumber(row.volume_usd),
    yesProbability: asNumber(row.yes_probability),
    yesProbabilityChange1h: asNumber(row.yes_probability_change_1h),
    bettors: row.bettors,
    aiLpCount: row.ai_lp_count,
    isHot: row.is_hot,
    deadlineIso: toIso(row.deadline_at),
    resolvedOutcome: row.resolved_outcome ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    resolutionCriteria: row.resolution_criteria ?? undefined,
    resolverAddress: row.resolver_address ?? undefined,
    resolutionTxHash: row.resolution_tx_hash ?? undefined,
    resolutionEvidenceHash: row.resolution_evidence_hash ?? undefined,
    resolutionProposer: row.resolution_proposer ?? undefined,
    resolutionProposedAtIso: row.resolution_proposed_at ? toIso(row.resolution_proposed_at) : undefined,
    resolutionProofTxHash: row.resolution_proof_tx_hash ?? undefined,
    proofUrl: row.proof_url ?? undefined,
    importSourceId: row.import_source_id ?? undefined,
    importCandidateId: row.import_candidate_id ?? undefined,
    sourcePublishedAtIso: row.source_published_at ? toIso(row.source_published_at) : undefined,
    provenanceNote: row.provenance_note ?? undefined,
    recentTraders: row.recent_traders ?? undefined,
    game: row.game ?? undefined,
    tournament: row.tournament ?? undefined,
    teamA: row.team_a ?? undefined,
    teamB: row.team_b ?? undefined,
    matchStartsAtIso: row.match_starts_at ? toIso(row.match_starts_at) : undefined,
    bestOfMaps: row.best_of_maps ?? undefined,
    streamUrl: row.stream_url ?? undefined,
    sport: row.sport ?? undefined,
    league: row.league ?? undefined,
    parentMarketId: row.parent_market_id ?? undefined,
    kind: row.kind ?? undefined,
  };
}

type ActivityRow = {
  id: string;
  kind: "bet" | "ai-lp" | "resolution" | "claim" | "refund";
  side: "YES" | "NO" | null;
  amount_usd: unknown;
  wallet_short: string | null;
  agent_handle: string | null;
  market_title: string | null;
  resolved_as: "YES" | "NO" | null;
  transaction_hash: string | null;
  chain_id: number;
  created_at: Date;
};

function toActivity(row: ActivityRow) {
  return {
    id: row.id,
    kind: row.kind,
    side: row.side ?? undefined,
    amountUsd: row.amount_usd === null ? undefined : asNumber(row.amount_usd),
    walletShort: row.wallet_short ?? undefined,
    agentHandle: row.agent_handle ?? undefined,
    marketTitle: row.market_title ?? undefined,
    resolvedAs: row.resolved_as ?? undefined,
    transactionHash: row.transaction_hash ?? undefined,
    chainId: row.chain_id,
    atIso: toIso(row.created_at),
  };
}

type TimelineRow = {
  id: string;
  market_id: string;
  yes_probability: unknown;
  volume_usd: unknown;
  event_kind: string;
  transaction_hash: string | null;
  chain_id: number;
  block_hash: string | null;
  block_number: string | number | null;
  log_index: number | null;
  created_at: Date;
};

type PositionRow = {
  id: string;
  address: string;
  market_id: string;
  chain_id: number;
  side: "YES" | "NO";
  stake_usd: unknown;
  avg_price: unknown;
  shares: unknown;
  status: "open" | "claimable" | "claimed" | "lost" | "refunded";
  payout_usd: unknown;
  resolved_outcome?: "YES" | "NO" | null;
  volume_usd?: unknown;
  yes_probability?: unknown;
  transaction_hash: string | null;
  created_at: Date;
};

function toPosition(row: PositionRow) {
  const payoutUsd =
    row.payout_usd === null
      ? claimablePayoutUsd(row)
      : asNumber(row.payout_usd);
  return {
    id: row.id,
    address: row.address,
    marketId: row.market_id,
    chainId: row.chain_id,
    side: row.side,
    stakeUsd: asNumber(row.stake_usd),
    avgPrice: asNumber(row.avg_price),
    shares: asNumber(row.shares),
    status: row.status,
    createdAtIso: toIso(row.created_at),
    transactionHash: row.transaction_hash ?? undefined,
    payoutUsd: payoutUsd ?? undefined,
  };
}

function claimablePayoutUsd(row: PositionRow): number | null {
  if (row.status !== "claimable" || row.resolved_outcome !== row.side) return null;
  if (row.volume_usd === undefined || row.yes_probability === undefined) return null;
  const totalPool = asNumber(row.volume_usd);
  const yesProbability = asNumber(row.yes_probability) / 100;
  const winningPool =
    row.side === "YES"
      ? totalPool * yesProbability
      : totalPool * (1 - yesProbability);
  if (!Number.isFinite(totalPool) || totalPool <= 0 || !Number.isFinite(winningPool) || winningPool <= 0) {
    return null;
  }
  return (asNumber(row.stake_usd) * totalPool) / winningPool;
}

type AgentRow = {
  id: string;
  handle: string;
  emoji: string;
  reputation: unknown;
  lifetime_pnl_usd: unknown;
  markets_touched: number;
  erc8004_address: string;
  chain_id: number | null;
  registration_tx_hash: string | null;
  strategy_description: string | null;
  proof_url: string | null;
  last_action: string | null;
  registered_at: Date | null;
};

function toAgent(row: AgentRow) {
  return {
    id: row.id,
    handle: row.handle,
    emoji: row.emoji,
    reputation: asNumber(row.reputation),
    lifetimePnlUsd: asNumber(row.lifetime_pnl_usd),
    marketsTouched: row.markets_touched,
    erc8004Address: row.erc8004_address,
    chainId: row.chain_id ?? undefined,
    registrationTxHash: row.registration_tx_hash ?? undefined,
    strategyDescription: row.strategy_description ?? undefined,
    proofUrl: row.proof_url ?? undefined,
    lastAction: row.last_action ?? undefined,
    registeredAtIso: row.registered_at ? toIso(row.registered_at) : undefined,
  };
}

type AgentEcosystemSummaryRow = {
  agent_count: number;
  active_agent_count: number;
  total_pnl_usd: unknown;
  average_reputation: unknown;
  markets_touched: number;
};

type AgentReputationRow = {
  id: string;
  agent_id: string;
  reputation: unknown;
  lifetime_pnl_usd: unknown;
  markets_touched: number;
  proof_url: string | null;
  reason: string | null;
  transaction_hash: string | null;
  chain_id: number | null;
  created_at: Date;
};

function toAgentReputationPoint(row: AgentReputationRow) {
  return {
    id: row.id,
    agentId: row.agent_id,
    reputation: asNumber(row.reputation),
    lifetimePnlUsd: asNumber(row.lifetime_pnl_usd),
    marketsTouched: row.markets_touched,
    proofUrl: row.proof_url ?? undefined,
    reason: row.reason ?? undefined,
    transactionHash: row.transaction_hash ?? undefined,
    chainId: row.chain_id ?? undefined,
    atIso: toIso(row.created_at),
  };
}

type HistoryRow = {
  id: string;
  position_id: string;
  market_id: string;
  chain_id: number;
  side: "YES" | "NO";
  stake_usd: unknown;
  payout_usd: unknown;
  transaction_hash: string | null;
  created_at: Date;
};

type LeaderRow = {
  id: string;
  kind: "human";
  handle: string;
  volume_usd: unknown;
  pnl_usd: unknown;
  markets_touched: unknown;
  win_rate: unknown;
};

type CreateMarketBody = {
  transactionHash?: string;
  marketId?: string;
  poolAddress?: string;
  title: string;
  description: string;
  category: "stocks" | "crypto" | "sports" | "soft";
  oracleType: "chainlink-price" | "zktls-ai-oracle" | "manual";
  asset: "USDC" | "tokenized-TSLA" | "tokenized-AAPL";
  deadlineIso: string;
  emoji?: string;
  chainId?: number;
  factoryAddress?: string;
  creatorAddress?: string;
  sourceUrl?: string;
  resolutionCriteria?: string;
};

type MarketDraftBody = {
  title?: string;
  description?: string;
  category?: string;
  oracleType?: string;
  asset?: string;
  deadlineIso?: string;
  feeBps?: number;
  sourceUrl?: string;
  resolutionCriteria?: string;
};

type SettingsBody = {
  preferredChain: string;
  currencyDisplay: string;
  notificationsEnabled: boolean;
  animationsEnabled: boolean;
  compactMode: boolean;
  defaultStakeUsd: number;
  explorerPreference: string;
};

type SettingsRow = {
  address: string;
  preferred_chain: string;
  currency_display: string;
  notifications_enabled: boolean;
  animations_enabled: boolean;
  compact_mode: boolean;
  default_stake_usd: unknown;
  explorer_preference: string;
};

function toSettings(row: SettingsRow) {
  return {
    address: row.address,
    preferredChain: row.preferred_chain,
    currencyDisplay: row.currency_display,
    notificationsEnabled: row.notifications_enabled,
    animationsEnabled: row.animations_enabled,
    compactMode: row.compact_mode,
    defaultStakeUsd: asNumber(row.default_stake_usd),
    explorerPreference: row.explorer_preference,
  };
}

type NotificationRow = {
  id: string;
  kind: string;
  market_id: string | null;
  title: string;
  body: string;
  read_at: Date | null;
  created_at: Date;
};

type RetentionCohortRow = {
  cohort_day: Date;
  cohort_size: unknown;
  retained_d1: unknown;
  retained_d7: unknown;
  retained_d30: unknown;
};

type RetentionSummaryRow = {
  active_1d: unknown;
  active_7d: unknown;
  active_30d: unknown;
  events_30d: unknown;
};

type LiquidityProgramRow = {
  id: string;
  name: string;
  starts_at: Date;
  ends_at: Date;
  top_percent_bps: number;
  rebate_bps: number;
  min_volume_usd: unknown;
  budget_usd: unknown | null;
  status: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

type LiquidityParticipantRow = {
  address: string;
  volume_usd: unknown;
  positions_count: unknown;
  markets_touched: unknown;
  first_position_at: Date;
  last_position_at: Date;
  rank: unknown;
  participant_count: unknown;
};

type LiquidityPayoutRow = {
  id: string;
  program_id: string;
  address: string;
  amount_usd: unknown;
  transaction_hash: string;
  chain_id: number;
  created_at: Date;
};

function toRetentionCohort(row: RetentionCohortRow) {
  const cohortSize = asNumber(row.cohort_size);
  const retainedD1 = asNumber(row.retained_d1);
  const retainedD7 = asNumber(row.retained_d7);
  const retainedD30 = asNumber(row.retained_d30);
  return {
    cohortDay: row.cohort_day.toISOString().slice(0, 10),
    cohortSize,
    retainedD1,
    retainedD7,
    retainedD30,
    retentionD1Pct: retentionPct(retainedD1, cohortSize),
    retentionD7Pct: retentionPct(retainedD7, cohortSize),
    retentionD30Pct: retentionPct(retainedD30, cohortSize),
  };
}

function toRetentionSummary(row: RetentionSummaryRow | undefined) {
  return {
    active1d: asNumber(row?.active_1d ?? 0),
    active7d: asNumber(row?.active_7d ?? 0),
    active30d: asNumber(row?.active_30d ?? 0),
    events30d: asNumber(row?.events_30d ?? 0),
  };
}

function retentionPct(retained: number, cohortSize: number) {
  if (cohortSize <= 0) return 0;
  return Math.round((retained / cohortSize) * 10_000) / 100;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function toLiquidityProgram(row: LiquidityProgramRow) {
  return {
    id: row.id,
    name: row.name,
    startsAtIso: toIso(row.starts_at),
    endsAtIso: toIso(row.ends_at),
    topPercentBps: row.top_percent_bps,
    rebateBps: row.rebate_bps,
    minVolumeUsd: asNumber(row.min_volume_usd),
    budgetUsd: row.budget_usd === null ? null : asNumber(row.budget_usd),
    status: row.status,
    createdBy: row.created_by,
    createdAtIso: toIso(row.created_at),
    updatedAtIso: toIso(row.updated_at),
  };
}

function toLiquidityIncentiveResponse(
  program: LiquidityProgramRow,
  participants: LiquidityParticipantRow[],
  payouts: LiquidityPayoutRow[],
) {
  const participantCount = participants.length > 0 ? asNumber(participants[0].participant_count) : 0;
  const rankCutoff = participantCount === 0
    ? 0
    : Math.max(1, Math.ceil((participantCount * program.top_percent_bps) / 10_000));
  const minVolumeUsd = asNumber(program.min_volume_usd);
  const ranked = participants.map((row) => {
    const rank = asNumber(row.rank);
    const volumeUsd = asNumber(row.volume_usd);
    const eligible = rankCutoff > 0 && rank <= rankCutoff && volumeUsd >= minVolumeUsd;
    return {
      address: row.address,
      rank,
      volumeUsd,
      positionsCount: asNumber(row.positions_count),
      marketsTouched: asNumber(row.markets_touched),
      firstPositionAtIso: toIso(row.first_position_at),
      lastPositionAtIso: toIso(row.last_position_at),
      eligible,
      rebateBps: eligible ? program.rebate_bps : 0,
    };
  });
  return {
    generatedAtIso: new Date().toISOString(),
    source: "positions",
    program: toLiquidityProgram(program),
    participantCount,
    eligibleCount: ranked.filter((row) => row.eligible).length,
    rankCutoff,
    totalEligibleVolumeUsd: ranked
      .filter((row) => row.eligible)
      .reduce((sum, row) => sum + row.volumeUsd, 0),
    participants: ranked,
    payouts: payouts.map((row) => ({
      id: row.id,
      programId: row.program_id,
      address: row.address,
      amountUsd: asNumber(row.amount_usd),
      transactionHash: row.transaction_hash,
      chainId: row.chain_id,
      createdAtIso: toIso(row.created_at),
    })),
  };
}

function parseLiquidityProgramBody(input: {
  id?: string;
  name?: string;
  startsAtIso?: string;
  endsAtIso?: string;
  topPercentBps?: number;
  rebateBps?: number;
  minVolumeUsd?: number;
  budgetUsd?: number | null;
}):
  | {
      ok: true;
      value: {
        id: string;
        name: string;
        startsAt: Date;
        endsAt: Date;
        topPercentBps: number;
        rebateBps: number;
        minVolumeUsd: number;
        budgetUsd: number | null;
      };
    }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const id = input.id?.trim() || `liquidity-${createToken(8)}`;
  const name = input.name?.trim();
  const startsAt = input.startsAtIso ? new Date(input.startsAtIso) : null;
  const endsAt = input.endsAtIso ? new Date(input.endsAtIso) : null;
  const topPercentBps = Number(input.topPercentBps);
  const rebateBps = Number(input.rebateBps);
  const minVolumeUsd = input.minVolumeUsd === undefined ? 0 : Number(input.minVolumeUsd);
  const budgetUsd = input.budgetUsd === undefined || input.budgetUsd === null ? null : Number(input.budgetUsd);

  if (!/^[a-zA-Z0-9:_-]{3,80}$/.test(id)) errors.push("id_invalid");
  if (!name || name.length < 3 || name.length > 120) errors.push("name_invalid");
  if (!startsAt || Number.isNaN(startsAt.getTime())) errors.push("starts_at_invalid");
  if (!endsAt || Number.isNaN(endsAt.getTime())) errors.push("ends_at_invalid");
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) errors.push("window_invalid");
  if (!Number.isInteger(topPercentBps) || topPercentBps <= 0 || topPercentBps > 10_000) errors.push("top_percent_bps_invalid");
  if (!Number.isInteger(rebateBps) || rebateBps < 0 || rebateBps > 10_000) errors.push("rebate_bps_invalid");
  if (!Number.isFinite(minVolumeUsd) || minVolumeUsd < 0) errors.push("min_volume_usd_invalid");
  if (budgetUsd !== null && (!Number.isFinite(budgetUsd) || budgetUsd < 0)) errors.push("budget_usd_invalid");
  if (errors.length > 0 || !name || !startsAt || !endsAt) return { ok: false, errors };
  return {
    ok: true,
    value: { id, name, startsAt, endsAt, topPercentBps, rebateBps, minVolumeUsd, budgetUsd },
  };
}
