import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  app: null as import("fastify").FastifyInstance | null,
  query: vi.fn(),
  transaction: vi.fn(),
  getChainId: vi.fn(),
  getBlock: vi.fn(),
  getBlockNumber: vi.fn(),
  getTransactionReceipt: vi.fn(),
  readContract: vi.fn(),
  parseEventLogs: vi.fn(),
}));

const originalFetch = globalThis.fetch;

vi.mock("fastify", async () => {
  const actual = await vi.importActual<typeof import("fastify")>("fastify");

  return {
    ...actual,
    default: (options: Parameters<typeof actual.default>[0]) => {
      const app = actual.default(options);
      app.listen = vi.fn(async () => "");
      state.app = app as unknown as import("fastify").FastifyInstance;
      return app;
    },
  };
});

vi.mock("viem", () => ({
  createPublicClient: vi.fn(() => ({
    getChainId: state.getChainId,
    getBlock: state.getBlock,
    getBlockNumber: state.getBlockNumber,
    getTransactionReceipt: state.getTransactionReceipt,
    readContract: state.readContract,
  })),
  http: vi.fn((url?: string) => ({ url })),
  keccak256: vi.fn(() => "0xhash"),
  parseEventLogs: state.parseEventLogs,
  stringToBytes: vi.fn((value: string) => new TextEncoder().encode(value)),
  verifyMessage: vi.fn(async () => true),
}));

vi.mock("../db", () => ({
  query: state.query,
  transaction: state.transaction,
}));

const marketRow = {
  id: "1",
  pool_address: "0x00000000000000000000000000000000000000aa",
  chain_id: 46630,
  factory_address: null,
  creation_tx_hash: null,
  creator_address: null,
  emoji: "",
  title: "Market",
  description: "Description",
  category: "crypto",
  oracle_type: "manual",
  status: "open",
  asset: "USDC",
  volume_usd: "100",
  yes_probability: "55",
  yes_probability_change_1h: "0",
  bettors: 1,
  ai_lp_count: 0,
  is_hot: false,
  deadline_at: new Date("2026-06-01T00:00:00.000Z"),
  resolved_outcome: null,
  source_url: null,
  resolution_criteria: null,
  resolver_address: null,
  resolution_tx_hash: null,
  resolution_evidence_hash: null,
  resolution_proposer: null,
  resolution_proposed_at: null,
  resolution_proof_tx_hash: null,
  proof_url: null,
  import_source_id: null,
  import_candidate_id: null,
  source_published_at: null,
  provenance_note: null,
};

const positionRow = {
  id: "pos-1",
  address: "0x00000000000000000000000000000000000000bb",
  market_id: "1",
  side: "YES",
  stake_usd: "10",
  avg_price: "0.55",
  shares: "18.181818",
  status: "open",
  payout_usd: null,
  transaction_hash: "0x00000000000000000000000000000000000000000000000000000000000000cc",
  chain_id: 46630,
  created_at: new Date("2026-05-31T00:00:00.000Z"),
};

const trustedRhcFactory = "0x00000000000000000000000000000000000000fa";
const foreignFactory = "0x00000000000000000000000000000000000000fb";
const marketPool = "0x00000000000000000000000000000000000000aa";
const creatorAddress = "0x00000000000000000000000000000000000000bb";
const resolverAddress = "0x00000000000000000000000000000000000000cc";
const adminAddress = "0x0000000000000000000000000000000000000ad1";
const sessionCookie = "adjudex_session=test-session-token";
const transactionHash = "0x00000000000000000000000000000000000000000000000000000000000000cc";

function validMarketSpecUri() {
  return `data:application/json;base64,${Buffer.from(
    JSON.stringify({
      title: "Will ETH close above 4000 USDC before the deadline?",
      description: "Resolution uses the cited source at the deadline.",
      category: "crypto",
      oracleType: "manual",
      asset: "USDC",
      deadlineIso: "2030-06-01T00:00:00.000Z",
      feeBps: 100,
      sourceUrl: "https://example.com/event",
      resolutionCriteria: "YES if the cited source reports ETH above 4000 USDC at the deadline.",
    }),
  ).toString("base64")}`;
}

function marketCreatedEvent(address: string) {
  return {
    address,
    args: {
      marketId: 1n,
      pool: marketPool,
      creator: creatorAddress,
      resolver: resolverAddress,
      deadline: 1_906_675_200n,
      specUri: validMarketSpecUri(),
    },
  };
}

function sessionRows(address = adminAddress) {
  return {
    rows: [
      {
        address,
        chain_id: 46630,
        domain: "adjudex.test",
        expires_at: new Date(Date.now() + 60_000),
      },
    ],
    rowCount: 1,
  };
}

function liquidityProgramRow() {
  return {
    id: "program-1",
    name: "Volume rebate",
    starts_at: new Date("2026-06-01T00:00:00.000Z"),
    ends_at: new Date("2026-07-01T00:00:00.000Z"),
    top_percent_bps: 5000,
    rebate_bps: 100,
    min_volume_usd: "50",
    budget_usd: "1000",
    status: "active",
    created_by: adminAddress,
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    updated_at: new Date("2026-06-01T00:00:00.000Z"),
  };
}

describe("transaction chain and log identity", () => {
  beforeAll(async () => {
    await import("../server");
    await state.app?.ready();
  });

  beforeEach(() => {
    state.query.mockReset();
    state.transaction.mockReset();
    state.getChainId.mockReset();
    state.getBlock.mockReset();
    state.getBlockNumber.mockReset();
    state.getTransactionReceipt.mockReset();
    state.readContract.mockReset();
    state.parseEventLogs.mockReset();
    delete process.env.DATABASE_URL;
    process.env.RHC_RPC_URL = "https://rhc.example";
    process.env.RHC_CHAIN_ID = "46630";
    delete process.env.ARBITRUM_SEPOLIA_RPC_URL;
    delete process.env.MARKET_FACTORY_ADDRESS;
    delete process.env.RHC_MARKET_FACTORY_ADDRESS;
    delete process.env.IMPORT_ADMIN_ADDRESSES;
    delete process.env.ADMIN_WALLET_ADDRESSES;
    delete process.env.STATUS_INDEXER_STALE_MS;
    delete process.env.STATUS_INDEXER_LAG_BLOCKS;
    delete process.env.TRANSACTION_SYNC_MIN_CONFIRMATIONS;
    delete process.env.RATE_LIMIT_BACKEND;
    delete process.env.REDIS_REST_URL;
    delete process.env.REDIS_REST_TOKEN;
    delete process.env.MARKETS_CACHE_BACKEND;
    delete process.env.MARKETS_CACHE_TTL_SECONDS;
    globalThis.fetch = originalFetch;
    state.getBlockNumber.mockResolvedValue(1n);
  });

  it("fails closed when a confirmed bet omits chainId", async () => {
    const response = await state.app!.inject({
      method: "POST",
      url: "/api/bets",
      payload: {
        marketId: "1",
        side: "YES",
        stakeUsd: 10,
        address: "0x00000000000000000000000000000000000000bb",
        transactionHash: "0x00000000000000000000000000000000000000000000000000000000000000cc",
        positionId: "pos-1",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "chain_id_required" });
    expect(state.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("requires explicit chainId when syncing a confirmed transaction", async () => {
    const response = await state.app!.inject({
      method: "POST",
      url: "/api/sync/transaction",
      payload: {
        transactionHash: "0x00000000000000000000000000000000000000000000000000000000000000cc",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "chain_id_required" });
    expect(state.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("rejects transaction sync before the configured confirmation depth", async () => {
    process.env.TRANSACTION_SYNC_MIN_CONFIRMATIONS = "3";
    state.getChainId.mockResolvedValue(46630);
    state.getBlockNumber.mockResolvedValue(124n);
    state.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockHash: "0xblock",
      blockNumber: 123n,
      logs: [],
    });
    state.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/sync/transaction",
      payload: {
        transactionHash,
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "transaction_insufficient_confirmations" });
    expect(state.query.mock.calls[0]?.[0]).toContain("pending_confirmations");
  });

  it("rejects unsupported chains instead of routing them to RHC", async () => {
    const response = await state.app!.inject({
      method: "POST",
      url: "/api/sync/transaction",
      payload: {
        transactionHash: "0x00000000000000000000000000000000000000000000000000000000000000cc",
        chainId: 999999,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "chain_not_supported" });
    expect(state.getChainId).not.toHaveBeenCalled();
    expect(state.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("uses Redis-backed rate limit when configured for multi-instance API", async () => {
    process.env.RATE_LIMIT_BACKEND = "redis";
    process.env.REDIS_REST_URL = "https://redis.example";
    process.env.REDIS_REST_TOKEN = "redis-token";
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { result: 31 },
          { result: 58_000 },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/sync/transaction",
      payload: {
        transactionHash,
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["x-ratelimit-backend"]).toBe("redis");
    expect(response.json()).toMatchObject({ error: "rate_limited", scope: "write" });
    expect(state.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("rejects configured RPC endpoints that report a different chain", async () => {
    state.getChainId.mockResolvedValue(421614);

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/sync/transaction",
      payload: {
        transactionHash: "0x00000000000000000000000000000000000000000000000000000000000000cc",
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "rpc_chain_mismatch" });
    expect(state.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("reports RPC chain mismatch in status health", async () => {
    state.getChainId.mockResolvedValue(421614);
    state.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const response = await state.app!.inject({
      method: "GET",
      url: "/api/status",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rpc).toMatchObject({
      ok: false,
      configured: true,
      blockNumber: 1,
    });
    expect(body.chains.rhc.rpc).toMatchObject({
      ok: false,
      configured: true,
      chainId: 421614,
      error: "rpc_chain_mismatch",
    });
  });

  it("serves market list from Redis read-through cache when configured", async () => {
    process.env.MARKETS_CACHE_BACKEND = "redis";
    process.env.REDIS_REST_URL = "https://redis.example";
    process.env.REDIS_REST_TOKEN = "redis-token";
    const cachedMarkets = [{ id: "cached-market", title: "Cached market" }];
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ result: JSON.stringify(cachedMarkets) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    const response = await state.app!.inject({
      method: "GET",
      url: "/api/markets",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(cachedMarkets);
    expect(state.query).not.toHaveBeenCalled();
  });

  it("falls back to DB market list when Redis cache misses", async () => {
    process.env.MARKETS_CACHE_BACKEND = "redis";
    process.env.REDIS_REST_URL = "https://redis.example";
    process.env.REDIS_REST_TOKEN = "redis-token";
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: "OK" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ) as typeof fetch;
    state.query.mockResolvedValueOnce({ rows: [marketRow], rowCount: 1 });

    const response = await state.app!.inject({
      method: "GET",
      url: "/api/markets",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([expect.objectContaining({ id: "1", title: "Market" })]);
    expect(state.query).toHaveBeenCalledTimes(1);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });

  it("records authenticated retention activity events through the backend", async () => {
    state.query
      .mockResolvedValueOnce(sessionRows())
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/analytics/events",
      headers: { cookie: sessionCookie },
      payload: { kind: "portfolio_view", metadata: { surface: "portfolio" } },
    });

    expect(response.statusCode).toBe(202);
    const insert = state.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO user_activity_events"));
    expect(insert?.[1]).toMatchObject([
      expect.any(String),
      adminAddress,
      "portfolio_view",
      null,
      JSON.stringify({ surface: "portfolio" }),
    ]);
  });

  it("rejects unsupported client retention event kinds", async () => {
    state.query.mockResolvedValueOnce(sessionRows());

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/analytics/events",
      headers: { cookie: sessionCookie },
      payload: { kind: "arbitrary_event" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "activity_kind_invalid" });
    expect(state.query).toHaveBeenCalledTimes(1);
  });

  it("returns admin retention cohorts from indexed backend activity events", async () => {
    process.env.IMPORT_ADMIN_ADDRESSES = adminAddress;
    state.query
      .mockResolvedValueOnce(sessionRows(adminAddress))
      .mockResolvedValueOnce({
        rows: [
          {
            cohort_day: new Date("2026-05-01T00:00:00.000Z"),
            cohort_size: "10",
            retained_d1: "6",
            retained_d7: "4",
            retained_d30: "3",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ active_1d: "2", active_7d: "5", active_30d: "9", events_30d: "31" }],
        rowCount: 1,
      });

    const response = await state.app!.inject({
      method: "GET",
      url: "/api/analytics/retention?limit=12",
      headers: { cookie: sessionCookie },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.source).toBe("user_activity_events");
    expect(body.summary).toEqual({ active1d: 2, active7d: 5, active30d: 9, events30d: 31 });
    expect(body.cohorts[0]).toMatchObject({
      cohortDay: "2026-05-01",
      cohortSize: 10,
      retainedD1: 6,
      retainedD7: 4,
      retainedD30: 3,
      retentionD1Pct: 60,
      retentionD7Pct: 40,
      retentionD30Pct: 30,
    });
  });

  it("fails closed when no active liquidity incentive program is configured", async () => {
    state.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await state.app!.inject({
      method: "GET",
      url: "/api/liquidity/incentives",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "liquidity_program_not_configured" });
  });

  it("computes liquidity incentive eligibility from indexed positions", async () => {
    state.query
      .mockResolvedValueOnce({ rows: [liquidityProgramRow()], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            address: "0x00000000000000000000000000000000000000a1",
            volume_usd: "200",
            positions_count: "4",
            markets_touched: "2",
            first_position_at: new Date("2026-06-02T00:00:00.000Z"),
            last_position_at: new Date("2026-06-03T00:00:00.000Z"),
            rank: "1",
            participant_count: "2",
          },
          {
            address: "0x00000000000000000000000000000000000000a2",
            volume_usd: "100",
            positions_count: "2",
            markets_touched: "1",
            first_position_at: new Date("2026-06-02T00:00:00.000Z"),
            last_position_at: new Date("2026-06-04T00:00:00.000Z"),
            rank: "2",
            participant_count: "2",
          },
        ],
        rowCount: 2,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await state.app!.inject({
      method: "GET",
      url: "/api/liquidity/incentives",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe("positions");
    expect(body.rankCutoff).toBe(1);
    expect(body.eligibleCount).toBe(1);
    expect(body.totalEligibleVolumeUsd).toBe(200);
    expect(body.participants[0]).toMatchObject({
      address: "0x00000000000000000000000000000000000000a1",
      rank: 1,
      eligible: true,
      rebateBps: 100,
    });
    expect(body.participants[1]).toMatchObject({
      address: "0x00000000000000000000000000000000000000a2",
      rank: 2,
      eligible: false,
      rebateBps: 0,
    });
  });

  it("creates liquidity programs only for admin sessions", async () => {
    process.env.IMPORT_ADMIN_ADDRESSES = adminAddress;
    state.query
      .mockResolvedValueOnce(sessionRows(adminAddress))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [liquidityProgramRow()], rowCount: 1 });

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/liquidity/programs",
      headers: { cookie: sessionCookie },
      payload: {
        id: "program-1",
        name: "Volume rebate",
        startsAtIso: "2026-06-01T00:00:00.000Z",
        endsAtIso: "2026-07-01T00:00:00.000Z",
        topPercentBps: 5000,
        rebateBps: 100,
        minVolumeUsd: 50,
        budgetUsd: 1000,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "program-1",
      name: "Volume rebate",
      topPercentBps: 5000,
      rebateBps: 100,
    });
    expect(state.query.mock.calls[1]?.[0]).toContain("INSERT INTO liquidity_incentive_programs");
  });

  it("probes the database before reporting health", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@example.test/db";
    state.query.mockResolvedValueOnce({ rows: [{ ok: 1 }], rowCount: 1 });

    const response = await state.app!.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      database: {
        ok: true,
        configured: true,
      },
    });
    expect(state.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("returns unavailable health when the database probe fails", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@example.test/db";
    state.query.mockRejectedValueOnce(new Error("connection refused"));

    const response = await state.app!.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      database: {
        ok: false,
        configured: true,
        error: "database_probe_failed",
      },
    });
  });

  it("reports a ready chain when database, RPC, factory, and indexer are current", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@example.test/db";
    process.env.RHC_MARKET_FACTORY_ADDRESS = trustedRhcFactory;
    state.getChainId.mockResolvedValue(46630);
    state.query
      .mockResolvedValueOnce({ rows: [{ ok: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ id: "rhc-indexer", chain_id: 46630, last_block: "1", updated_at: new Date() }],
        rowCount: 1,
      });

    const response = await state.app!.inject({
      method: "GET",
      url: "/api/status",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ready).toBe(true);
    expect(body.chains.rhc).toMatchObject({
      ready: true,
      factoryConfigured: true,
      rpcConfigured: true,
      indexer: {
        ok: true,
        stale: false,
        lagging: false,
        lagBlocks: 0,
      },
    });
  });

  it("reports stale and lagging indexers per chain", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@example.test/db";
    process.env.RHC_MARKET_FACTORY_ADDRESS = trustedRhcFactory;
    process.env.STATUS_INDEXER_STALE_MS = "1";
    process.env.STATUS_INDEXER_LAG_BLOCKS = "0";
    state.getChainId.mockResolvedValue(46630);
    state.query
      .mockResolvedValueOnce({ rows: [{ ok: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ id: "rhc-indexer", chain_id: 46630, last_block: "0", updated_at: new Date(Date.now() - 10_000) }],
        rowCount: 1,
      });

    const response = await state.app!.inject({
      method: "GET",
      url: "/api/status",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ready).toBe(false);
    expect(body.chains.rhc.indexer).toMatchObject({
      ok: false,
      stale: true,
      lagging: true,
      lagBlocks: 1,
      error: "indexer_stale",
    });
    expect(body.chains.rhc.ready).toBe(false);
  });

  it("rejects client-supplied market factory addresses that differ from backend configuration", async () => {
    process.env.RHC_MARKET_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000fa";

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/markets",
      payload: {
        transactionHash: "0x00000000000000000000000000000000000000000000000000000000000000cc",
        marketId: "1",
        poolAddress: "0x00000000000000000000000000000000000000aa",
        chainId: 46630,
        factoryAddress: "0x00000000000000000000000000000000000000fb",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "factory_address_mismatch" });
    expect(state.getChainId).not.toHaveBeenCalled();
    expect(state.getTransactionReceipt).not.toHaveBeenCalled();
    expect(state.query).not.toHaveBeenCalled();
  });

  it("rejects import candidate deployment factory addresses that differ from backend configuration", async () => {
    process.env.RHC_MARKET_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000fa";
    process.env.IMPORT_ADMIN_ADDRESSES = adminAddress;
    state.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ address: adminAddress, expires_at: new Date("2030-01-01T00:00:00.000Z") }],
    });
    state.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: "candidate-1",
          source_id: "source-1",
          title: "Imported market",
          source_url: "https://example.com/event",
          source_published_at: null,
          event_date: null,
          category: "crypto",
          question: "Will ETH close above 4000 USDC before the deadline?",
          description: "Resolution uses the cited source at the deadline.",
          oracle_type: "manual",
          asset: "USDC",
          deadline_at: new Date("2026-06-01T00:00:00.000Z"),
          resolution_criteria: "YES if the cited source reports ETH above 4000 USDC at the deadline.",
          confidence: null,
          status: "validated",
          risk_flags: [],
          validation_errors: [],
          spec_json: {
            title: "Will ETH close above 4000 USDC before the deadline?",
            description: "Resolution uses the cited source at the deadline.",
            category: "crypto",
            oracleType: "manual",
            asset: "USDC",
            deadlineIso: "2026-06-01T00:00:00.000Z",
            feeBps: 100,
            sourceUrl: "https://example.com/event",
            resolutionCriteria: "YES if the cited source reports ETH above 4000 USDC at the deadline.",
          },
          spec_hash: "0x0000000000000000000000000000000000000000000000000000000000001234",
          spec_uri: "data:application/json;base64,e30=",
          created_at: new Date("2026-05-31T00:00:00.000Z"),
          updated_at: new Date("2026-05-31T00:00:00.000Z"),
        },
      ],
    });

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/import/candidates/candidate-1/deploy",
      headers: { cookie: sessionCookie },
      payload: {
        transactionHash: "0x00000000000000000000000000000000000000000000000000000000000000cc",
        marketId: "1",
        poolAddress: "0x00000000000000000000000000000000000000aa",
        chainId: 46630,
        factoryAddress: "0x00000000000000000000000000000000000000fb",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "factory_address_mismatch" });
    expect(state.query).toHaveBeenCalledTimes(2);
    expect(state.getChainId).not.toHaveBeenCalled();
    expect(state.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("does not reconcile MarketCreated logs from untrusted factories", async () => {
    process.env.RHC_MARKET_FACTORY_ADDRESS = trustedRhcFactory;
    const execute = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    state.getChainId.mockResolvedValue(46630);
    state.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000beef00",
      blockNumber: 123n,
      logs: [{}],
    });
    state.parseEventLogs
      .mockReturnValueOnce([marketCreatedEvent(foreignFactory)])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    state.transaction.mockImplementation(async (callback) => callback(execute));

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/sync/transaction",
      payload: {
        transactionHash,
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "trusted_adjudex_event_not_found" });
    expect(
      execute.mock.calls.some((call) => String((call as unknown[])[0]).includes("INSERT INTO markets")),
    ).toBe(false);
    expect(
      execute.mock.calls.some((call) => String((call as unknown[])[0]).includes("INSERT INTO market_stats")),
    ).toBe(false);
    expect(
      execute.mock.calls.some((call) => String((call as unknown[])[0]).includes("INSERT INTO transaction_syncs")),
    ).toBe(false);
  });

  it("reconciles trusted RHC MarketCreated logs to canonical non-Arbitrum market ids", async () => {
    process.env.RHC_MARKET_FACTORY_ADDRESS = trustedRhcFactory;
    const execute = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    state.getChainId.mockResolvedValue(46630);
    state.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000beef00",
      blockNumber: 123n,
      logs: [{}],
    });
    state.parseEventLogs
      .mockReturnValueOnce([marketCreatedEvent(trustedRhcFactory)])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    state.transaction.mockImplementation(async (callback) => callback(execute));

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/sync/transaction",
      payload: {
        transactionHash,
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().reconciled).toContainEqual({ type: "market_created", marketId: "46630:1" });

    const marketInsert = execute.mock.calls.find((call) => String((call as unknown[])[0]).includes("INSERT INTO markets")) as
      | [string, unknown[]]
      | undefined;
    expect(marketInsert?.[1]).toEqual([
      "46630:1",
      marketPool,
      46630,
      trustedRhcFactory,
      transactionHash,
      creatorAddress,
      "Will ETH close above 4000 USDC before the deadline?",
      "Resolution uses the cited source at the deadline.",
      "crypto",
      "manual",
      "USDC",
      "https://example.com/event",
      "YES if the cited source reports ETH above 4000 USDC at the deadline.",
      resolverAddress,
      1_906_675_200,
    ]);

    const statsInsert = execute.mock.calls.find((call) => String((call as unknown[])[0]).includes("INSERT INTO market_stats")) as
      | [string, unknown[]]
      | undefined;
    expect(statsInsert?.[1]).toEqual(["46630:1"]);
  });

  it("does not insert MarketCreated rows when the chain factory is not configured", async () => {
    const execute = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    state.getChainId.mockResolvedValue(46630);
    state.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000beef00",
      blockNumber: 123n,
      logs: [{}],
    });
    state.parseEventLogs
      .mockReturnValueOnce([marketCreatedEvent(trustedRhcFactory)])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    state.transaction.mockImplementation(async (callback) => callback(execute));

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/sync/transaction",
      payload: {
        transactionHash,
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "trusted_adjudex_event_not_found" });
    expect(
      execute.mock.calls.some((call) => String((call as unknown[])[0]).includes("INSERT INTO markets")),
    ).toBe(false);
    expect(
      execute.mock.calls.some((call) => String((call as unknown[])[0]).includes("INSERT INTO market_stats")),
    ).toBe(false);
    expect(
      execute.mock.calls.some((call) => String((call as unknown[])[0]).includes("INSERT INTO transaction_syncs")),
    ).toBe(false);
  });

  it("does not persist public transaction syncs without trusted Adjudex events", async () => {
    const execute = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    state.getChainId.mockResolvedValue(46630);
    state.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000beef00",
      blockNumber: 123n,
      logs: [],
    });
    state.parseEventLogs.mockReturnValue([]);
    state.transaction.mockImplementation(async (callback) => callback(execute));

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/sync/transaction",
      payload: {
        transactionHash,
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "trusted_adjudex_event_not_found" });
    expect(execute).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO transaction_syncs"),
      expect.anything(),
    );
  });

  it("looks up confirmed bets by transaction hash and chain identity", async () => {
    state.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockHash: "0xblock",
      blockNumber: 123n,
      logs: [],
    });
    state.getChainId.mockResolvedValue(46630);
    state.getBlock.mockResolvedValue({ timestamp: 1_800_000_000n });
    state.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "yesPool") return 60_000_000n;
      if (functionName === "noPool") return 40_000_000n;
      if (functionName === "resolved") return false;
      if (functionName === "deadline") return 1_906_675_200n;
      if (functionName === "getYesPct") return 6000n;
      if (functionName === "getTotalVolume") return 100_000_000n;
      throw new Error(`unexpected function ${functionName}`);
    });
    state.parseEventLogs.mockReturnValue([]);
    const execute = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    state.transaction.mockImplementation(async (callback) => callback(execute));
    state.query
      .mockResolvedValueOnce({ rows: [marketRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [positionRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "activity-46630" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/bets",
      payload: {
        marketId: "1",
        side: "YES",
        stakeUsd: 10,
        address: "0x00000000000000000000000000000000000000bb",
        transactionHash: "0x00000000000000000000000000000000000000000000000000000000000000cc",
        positionId: "pos-1",
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(200);
    const positionLookup = state.query.mock.calls.find(([sql]) => String(sql).includes("FROM positions"));
    expect(positionLookup?.[0]).toContain("AND chain_id = $6");
    expect(positionLookup?.[1]).toEqual([
      "pos-1",
      "0x00000000000000000000000000000000000000bb",
      "1",
      "YES",
      "0x00000000000000000000000000000000000000000000000000000000000000cc",
      46630,
      10,
    ]);
    const activityLookup = state.query.mock.calls.find(([sql]) => String(sql).includes("FROM activity_events"));
    expect(activityLookup?.[0]).toContain("chain_id = $3");
    expect(activityLookup?.[1]).toEqual([
      "0x00000000000000000000000000000000000000000000000000000000000000cc",
      "1",
      46630,
    ]);
  });

  it("returns timeline rows with chain and log identity", async () => {
    state.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: "timeline-1",
          market_id: "1",
          yes_probability: "60",
          volume_usd: "250",
          event_kind: "bet",
          transaction_hash: "0x00000000000000000000000000000000000000000000000000000000000000cc",
          chain_id: 46630,
          block_hash: "0xblock",
          block_number: "123",
          log_index: 7,
          created_at: new Date("2026-05-31T00:00:00.000Z"),
        },
      ],
    });

    const response = await state.app!.inject({
      method: "GET",
      url: "/api/markets/1/timeline",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        id: "timeline-1",
        marketId: "1",
        yesProbability: 60,
        volumeUsd: 250,
        eventKind: "bet",
        transactionHash: "0x00000000000000000000000000000000000000000000000000000000000000cc",
        chainId: 46630,
        blockHash: "0xblock",
        blockNumber: 123,
        logIndex: 7,
        atIso: "2026-05-31T00:00:00.000Z",
      },
    ]);
  });

  it("persists verifier evidence metadata when reconciling AI judge events", async () => {
    const execute = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const evidenceHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const proposer = "0x00000000000000000000000000000000000000dd";
    state.getTransactionReceipt.mockResolvedValue({
      status: "success",
      from: proposer,
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000beef00",
      blockNumber: 123n,
      logs: [{}],
    });
    state.getChainId.mockResolvedValue(46630);
    state.parseEventLogs
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          address: resolverAddress,
          args: {
            pool: marketPool,
            marketId: 1n,
            outcome: 0,
            evidenceHash,
            proposedAt: 1_780_000_000n,
          },
        },
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          address: resolverAddress,
          args: {
            pool: marketPool,
            marketId: 1n,
            outcome: 0,
            evidenceHash,
          },
        },
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    state.transaction.mockImplementation(async (callback) => callback(execute));
    state.query.mockResolvedValue({
      rows: [{ id: "46630:1", yes_probability: "55", resolver_address: resolverAddress }],
      rowCount: 1,
    });

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/sync/transaction",
      payload: {
        transactionHash,
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().reconciled).toContainEqual({ type: "resolution_proposed", marketId: "46630:1" });
    expect(response.json().reconciled).toContainEqual({ type: "resolution_finalized", marketId: "46630:1" });

    const proposedUpdate = execute.mock.calls.find((call) =>
      String((call as unknown[])[0]).includes("resolution_proposed_at = to_timestamp")
    ) as [string, unknown[]] | undefined;
    expect(proposedUpdate?.[1]).toEqual(["46630:1", evidenceHash, proposer, 1_780_000_000, transactionHash]);

    const finalizedUpdate = execute.mock.calls.find((call) =>
      String((call as unknown[])[0]).includes("resolution_proof_tx_hash = COALESCE")
    ) as [string, unknown[]] | undefined;
    expect(finalizedUpdate?.[1]).toEqual(["46630:1", "YES", transactionHash, evidenceHash]);
  });

  it("does not reconcile verifier events when market resolver is missing", async () => {
    const execute = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const evidenceHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
    state.getTransactionReceipt.mockResolvedValue({
      status: "success",
      from: "0x00000000000000000000000000000000000000dd",
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000beef00",
      blockNumber: 123n,
      logs: [{}],
    });
    state.getChainId.mockResolvedValue(46630);
    state.parseEventLogs
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          address: resolverAddress,
          args: {
            pool: marketPool,
            marketId: 1n,
            outcome: 0,
            evidenceHash,
            proposedAt: 1_780_000_000n,
          },
        },
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          address: resolverAddress,
          args: {
            pool: marketPool,
            marketId: 1n,
            outcome: 0,
            evidenceHash,
          },
        },
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    state.transaction.mockImplementation(async (callback) => callback(execute));
    state.query.mockResolvedValue({
      rows: [{ id: "46630:1", yes_probability: "55", resolver_address: null }],
      rowCount: 1,
    });

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/sync/transaction",
      payload: {
        transactionHash,
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "trusted_adjudex_event_not_found" });
    expect(
      execute.mock.calls.some((call) => String((call as unknown[])[0]).includes("resolution_evidence_hash = $2")),
    ).toBe(false);
    expect(
      execute.mock.calls.some((call) => String((call as unknown[])[0]).includes("resolved_outcome = $2")),
    ).toBe(false);
    expect(
      execute.mock.calls.some((call) => String((call as unknown[])[0]).includes("INSERT INTO transaction_syncs")),
    ).toBe(false);
  });

  it("persists activity rows with chain and log identity when reconciling bet logs", async () => {
    const execute = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    state.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000beef00",
      blockNumber: 123n,
      logs: [{}],
    });
    state.getChainId.mockResolvedValue(46630);
    state.readContract.mockImplementation(async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
      expect(blockNumber).toBe(456n);
      if (functionName === "getYesPct") return 6100n;
      if (functionName === "getTotalVolume") return 110_000_000n;
      throw new Error(`unexpected function ${functionName}`);
    });
    state.parseEventLogs
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          address: "0x00000000000000000000000000000000000000aa",
          args: {
            bettor: "0x00000000000000000000000000000000000000bb",
            side: 0,
            amount: 10_000_000n,
            positionId: 1n,
          },
          blockHash: "0x0000000000000000000000000000000000000000000000000000000000feed00",
          blockNumber: 456n,
          logIndex: 7,
        },
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    state.transaction.mockImplementation(async (callback) => callback(execute));
    state.query.mockResolvedValueOnce({
      rows: [{ id: "1", yes_probability: "55" }],
      rowCount: 1,
    });

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/sync/transaction",
      payload: {
        transactionHash: "0x00000000000000000000000000000000000000000000000000000000000000cc",
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(200);
    const firstQuery = state.query.mock.calls[0] as [string, unknown[]];
    expect(firstQuery[0]).toContain("AND m.chain_id = $2");
    expect(firstQuery[1]).toEqual(["0x00000000000000000000000000000000000000aa", 46630]);

    const activityInsert = execute.mock.calls.find((call) => String((call as unknown[])[0]).includes("INSERT INTO activity_events")) as
      | [string, unknown[]]
      | undefined;
    expect(activityInsert?.[0]).toContain("chain_id, block_hash, block_number, log_index");
    expect(activityInsert?.[1]).toEqual([
      "46630:0x00000000000000000000000000000000000000000000000000000000000000cc:bet:1:7",
      "1",
      "YES",
      10,
      "0x0000...00bb",
      "0x00000000000000000000000000000000000000000000000000000000000000cc",
      46630,
      "0x0000000000000000000000000000000000000000000000000000000000feed00",
      456,
      7,
    ]);

    const timelineInsert = execute.mock.calls.find((call) => String((call as unknown[])[0]).includes("INSERT INTO market_timeline")) as
      | [string, unknown[]]
      | undefined;
    expect(timelineInsert?.[1]).toEqual([
      "1:bet:0x00000000000000000000000000000000000000000000000000000000000000cc:7",
      "1",
      61,
      110,
      "bet",
      "0x00000000000000000000000000000000000000000000000000000000000000cc",
      46630,
      "0x0000000000000000000000000000000000000000000000000000000000feed00",
      456,
      7,
    ]);
  });

  it("returns claimable position payout from indexed final pool stats", async () => {
    state.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          ...positionRow,
          status: "claimable",
          resolved_outcome: "YES",
          volume_usd: "100",
          yes_probability: "25",
        },
      ],
    });

    const response = await state.app!.inject({
      method: "GET",
      url: "/api/portfolio/0x00000000000000000000000000000000000000bb/positions",
    });

    expect(response.statusCode).toBe(200);
    expect(state.query.mock.calls[0]?.[0]).toContain("JOIN market_stats s ON s.market_id = p.market_id");
    expect(response.json()).toEqual([
      expect.objectContaining({
        id: "pos-1",
        status: "claimable",
        payoutUsd: 40,
      }),
    ]);
  });
});
