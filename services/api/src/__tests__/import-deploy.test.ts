import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  app: null as import("fastify").FastifyInstance | null,
  query: vi.fn(),
  transaction: vi.fn(),
  getChainId: vi.fn(),
  getTransactionReceipt: vi.fn(),
  parseEventLogs: vi.fn(),
}));

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
    getBlockNumber: vi.fn(async () => 1n),
    getTransactionReceipt: state.getTransactionReceipt,
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

const trustedRhcFactory = "0x00000000000000000000000000000000000000fa";
const foreignFactory = "0x00000000000000000000000000000000000000fb";
const marketPool = "0x00000000000000000000000000000000000000aa";
const creatorAddress = "0x00000000000000000000000000000000000000bb";
const resolverAddress = "0x00000000000000000000000000000000000000cc";
const adminAddress = "0x0000000000000000000000000000000000000ad1";
const nonAdminAddress = "0x0000000000000000000000000000000000000bad";
const sessionToken = "test-session-token";
const sessionCookie = `pariai_session=${sessionToken}`;
const transactionHash = "0x00000000000000000000000000000000000000000000000000000000000000cc";
const specHash = "0x0000000000000000000000000000000000000000000000000000000000001234";
const deadline = 1_906_502_400n;

function validMarketSpec() {
  return {
    title: "Will ETH close above 4000 USDC before the deadline?",
    description: "Resolution uses the cited source at the deadline.",
    category: "crypto",
    oracleType: "manual",
    asset: "USDC",
    deadlineIso: "2030-06-01T00:00:00.000Z",
    feeBps: 100,
    sourceUrl: "https://example.com/event",
    resolutionCriteria: "YES if the cited source reports ETH above 4000 USDC at the deadline.",
  };
}

function validMarketSpecUri() {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(validMarketSpec())).toString("base64")}`;
}

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
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
    deadline_at: new Date("2030-06-01T00:00:00.000Z"),
    resolution_criteria: "YES if the cited source reports ETH above 4000 USDC at the deadline.",
    confidence: null,
    status: "validated",
    risk_flags: [],
    validation_errors: [],
    spec_json: validMarketSpec(),
    spec_hash: specHash,
    spec_uri: validMarketSpecUri(),
    created_at: new Date("2026-05-31T00:00:00.000Z"),
    updated_at: new Date("2026-05-31T00:00:00.000Z"),
    ...overrides,
  };
}

function queryRows(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}

function sessionRows(address: string) {
  return queryRows([{ address, expires_at: new Date("2030-01-01T00:00:00.000Z") }]);
}

function marketCreatedEvent(address: string, marketId = 7n) {
  return {
    address,
    args: {
      marketId,
      pool: marketPool,
      specHash,
      creator: creatorAddress,
      resolver: resolverAddress,
      deadline,
      specUri: validMarketSpecUri(),
    },
  };
}

function marketRow(id: string) {
  return {
    id,
    pool_address: marketPool,
    chain_id: 46630,
    factory_address: trustedRhcFactory,
    creation_tx_hash: transactionHash,
    creator_address: creatorAddress,
    emoji: "",
    title: "Will ETH close above 4000 USDC before the deadline?",
    description: "Resolution uses the cited source at the deadline.",
    category: "crypto",
    oracle_type: "manual",
    status: "open",
    asset: "USDC",
    volume_usd: "0",
    yes_probability: "50",
    yes_probability_change_1h: "0",
    bettors: 0,
    ai_lp_count: 0,
    is_hot: false,
    deadline_at: new Date("2030-06-01T00:00:00.000Z"),
    resolved_outcome: null,
    source_url: "https://example.com/event",
    resolution_criteria: "YES if the cited source reports ETH above 4000 USDC at the deadline.",
    resolver_address: resolverAddress,
    resolution_tx_hash: null,
    resolution_evidence_hash: null,
    resolution_proposer: null,
    resolution_proposed_at: null,
    resolution_proof_tx_hash: null,
    proof_url: null,
    import_source_id: "source-1",
    import_candidate_id: "candidate-1",
    source_published_at: null,
    provenance_note: "Imported from public source source-1; normalized by PariAI Market Importer.",
  };
}

describe("import candidate deploy API", () => {
  beforeAll(async () => {
    await import("../server");
    await state.app?.ready();
  });

  beforeEach(() => {
    state.query.mockReset();
    state.transaction.mockReset();
    state.getChainId.mockReset();
    state.getTransactionReceipt.mockReset();
    state.parseEventLogs.mockReset();
    process.env.RHC_RPC_URL = "https://rhc.example";
    process.env.RHC_CHAIN_ID = "46630";
    process.env.RHC_MARKET_FACTORY_ADDRESS = trustedRhcFactory;
    process.env.IMPORT_ADMIN_ADDRESSES = adminAddress;
    delete process.env.ADMIN_WALLET_ADDRESSES;
    delete process.env.ARBITRUM_SEPOLIA_RPC_URL;
    delete process.env.MARKET_FACTORY_ADDRESS;
  });

  it.each([
    ["scan", "POST", "/api/import/scan"],
    ["candidate list", "GET", "/api/import/candidates"],
    ["validate", "POST", "/api/import/candidates/candidate-1/validate"],
    ["deploy", "POST", "/api/import/candidates/candidate-1/deploy"],
  ] as const)("requires auth before accessing import %s", async (_name, method, url) => {
    const response = await state.app!.inject({ method, url });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "auth_required" });
    expect(state.query).not.toHaveBeenCalled();
    expect(state.getChainId).not.toHaveBeenCalled();
    expect(state.getTransactionReceipt).not.toHaveBeenCalled();
    expect(state.parseEventLogs).not.toHaveBeenCalled();
  });

  it.each([
    ["scan", "POST", "/api/import/scan"],
    ["candidate list", "GET", "/api/import/candidates"],
    ["validate", "POST", "/api/import/candidates/candidate-1/validate"],
    ["deploy", "POST", "/api/import/candidates/candidate-1/deploy"],
  ] as const)("fails closed when import admin allowlist is not configured for %s", async (_name, method, url) => {
    delete process.env.IMPORT_ADMIN_ADDRESSES;
    delete process.env.ADMIN_WALLET_ADDRESSES;
    state.query.mockResolvedValueOnce(sessionRows(adminAddress));

    const response = await state.app!.inject({ method, url, headers: { cookie: sessionCookie } });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "admin_not_configured" });
    expect(state.query).toHaveBeenCalledTimes(1);
    expect(state.query.mock.calls[0]?.[0]).toContain("FROM auth_sessions");
    expect(state.getChainId).not.toHaveBeenCalled();
    expect(state.getTransactionReceipt).not.toHaveBeenCalled();
    expect(state.parseEventLogs).not.toHaveBeenCalled();
  });

  it.each([
    ["scan", "POST", "/api/import/scan"],
    ["candidate list", "GET", "/api/import/candidates"],
    ["validate", "POST", "/api/import/candidates/candidate-1/validate"],
    ["deploy", "POST", "/api/import/candidates/candidate-1/deploy"],
  ] as const)("rejects non-admin import %s requests", async (_name, method, url) => {
    state.query.mockResolvedValueOnce(sessionRows(nonAdminAddress));

    const response = await state.app!.inject({ method, url, headers: { cookie: sessionCookie } });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "not_admin" });
    expect(state.query).toHaveBeenCalledTimes(1);
    expect(state.query.mock.calls[0]?.[0]).toContain("FROM auth_sessions");
    expect(state.getChainId).not.toHaveBeenCalled();
    expect(state.getTransactionReceipt).not.toHaveBeenCalled();
    expect(state.parseEventLogs).not.toHaveBeenCalled();
  });

  it("rejects deploy when the candidate has not been validated", async () => {
    state.query
      .mockResolvedValueOnce(sessionRows(adminAddress))
      .mockResolvedValueOnce(queryRows([candidateRow({ status: "needs_review" })]));

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/import/candidates/candidate-1/deploy",
      headers: { cookie: sessionCookie },
      payload: {
        transactionHash,
        marketId: "7",
        poolAddress: marketPool,
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "candidate_not_validated" });
    expect(state.query).toHaveBeenCalledTimes(2);
    expect(state.getChainId).not.toHaveBeenCalled();
    expect(state.getTransactionReceipt).not.toHaveBeenCalled();
    expect(state.parseEventLogs).not.toHaveBeenCalled();
  });

  it.each([
    ["spec_hash", { spec_hash: null }],
    ["spec_uri", { spec_uri: null }],
  ])("rejects deploy when a validated candidate is missing %s", async (_field, overrides) => {
    state.query
      .mockResolvedValueOnce(sessionRows(adminAddress))
      .mockResolvedValueOnce(queryRows([candidateRow(overrides)]));

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/import/candidates/candidate-1/deploy",
      headers: { cookie: sessionCookie },
      payload: {
        transactionHash,
        marketId: "7",
        poolAddress: marketPool,
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "candidate_not_validated" });
    expect(state.query).toHaveBeenCalledTimes(2);
    expect(state.getChainId).not.toHaveBeenCalled();
    expect(state.getTransactionReceipt).not.toHaveBeenCalled();
    expect(state.parseEventLogs).not.toHaveBeenCalled();
  });

  it("does not deploy from MarketCreated logs emitted by an untrusted factory", async () => {
    state.query
      .mockResolvedValueOnce(sessionRows(adminAddress))
      .mockResolvedValueOnce(queryRows([candidateRow()]));
    state.getChainId.mockResolvedValue(46630);
    state.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000beef00",
      blockNumber: 123n,
      logs: [{}],
    });
    state.parseEventLogs.mockReturnValue([marketCreatedEvent(foreignFactory)]);

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/import/candidates/candidate-1/deploy",
      headers: { cookie: sessionCookie },
      payload: {
        transactionHash,
        marketId: "7",
        poolAddress: marketPool,
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "market_created_event_not_found" });
    expect(state.query).toHaveBeenCalledTimes(2);
    expect(state.getChainId).toHaveBeenCalledOnce();
    expect(state.getTransactionReceipt).toHaveBeenCalledOnce();
    expect(state.parseEventLogs).toHaveBeenCalledOnce();
  });

  it("returns the canonical market id only after a trusted factory receipt is verified", async () => {
    const canonicalId = "46630:7";
    state.query
      .mockResolvedValueOnce(sessionRows(adminAddress))
      .mockResolvedValueOnce(queryRows([candidateRow()]))
      .mockResolvedValueOnce(queryRows([]))
      .mockResolvedValueOnce(queryRows([]))
      .mockResolvedValueOnce(queryRows([]))
      .mockResolvedValueOnce(queryRows([]))
      .mockResolvedValueOnce(queryRows([marketRow(canonicalId)]));
    state.getChainId.mockResolvedValue(46630);
    state.getTransactionReceipt.mockResolvedValue({
      status: "success",
      blockHash: "0x0000000000000000000000000000000000000000000000000000000000beef00",
      blockNumber: 123n,
      logs: [{}],
    });
    state.parseEventLogs.mockReturnValue([marketCreatedEvent(trustedRhcFactory)]);

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/import/candidates/candidate-1/deploy",
      headers: { cookie: sessionCookie },
      payload: {
        transactionHash,
        marketId: "7",
        poolAddress: marketPool,
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: canonicalId,
      chainId: 46630,
      factoryAddress: trustedRhcFactory,
      importCandidateId: "candidate-1",
    });

    const deploymentInsert = state.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO import_deployments")) as
      | [string, unknown[]]
      | undefined;
    expect(deploymentInsert?.[1]).toEqual([
      `46630:${transactionHash}:import`,
      "candidate-1",
      canonicalId,
      marketPool,
      transactionHash,
      46630,
    ]);

    const marketInsert = state.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO markets")) as
      | [string, unknown[]]
      | undefined;
    expect(marketInsert?.[1]?.[0]).toBe(canonicalId);
    expect(marketInsert?.[1]?.[3]).toBe(trustedRhcFactory);
    expect(marketInsert?.[1]?.[6]).toBe(resolverAddress);
    expect(marketInsert?.[1]?.[18]).toBe("candidate-1");

    const finalLookup = state.query.mock.calls.at(-1) as [string, unknown[]];
    expect(finalLookup[1]).toEqual([canonicalId]);
  });
});
