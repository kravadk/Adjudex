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
  id: "46630:1",
  pool_address: "0x00000000000000000000000000000000000000aa",
  chain_id: 46630,
  factory_address: "0x00000000000000000000000000000000000000fa",
  creation_tx_hash: "0x00000000000000000000000000000000000000000000000000000000000000ab",
  creator_address: "0x00000000000000000000000000000000000000bb",
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
  deadline_at: new Date("2030-06-01T00:00:00.000Z"),
  resolved_outcome: null,
  source_url: null,
  resolution_criteria: null,
  resolver_address: "0x00000000000000000000000000000000000000cc",
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

describe("bet preview", () => {
  beforeAll(async () => {
    await import("../server");
    await state.app?.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RHC_CHAIN_ID = "46630";
    process.env.RHC_RPC_URL = "https://rhc.example";
    delete process.env.ARBITRUM_SEPOLIA_RPC_URL;

    state.query.mockResolvedValue({ rows: [marketRow], rowCount: 1 });
    state.getChainId.mockResolvedValue(46630);
    state.getBlockNumber.mockResolvedValue(1n);
    state.getBlock.mockResolvedValue({ timestamp: 1_800_000_000n });
    state.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "yesPool") return 60_000_000n;
      if (functionName === "noPool") return 40_000_000n;
      if (functionName === "resolved") return false;
      if (functionName === "deadline") return 1_906_675_200n;
      throw new Error(`unexpected function ${functionName}`);
    });
  });

  it("derives quote from live pool contract state instead of cached market stats", async () => {
    const response = await state.app!.inject({
      method: "POST",
      url: "/api/bets/preview",
      payload: { marketId: "46630:1", side: "YES", stakeUsd: 10 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      marketId: "46630:1",
      side: "YES",
      stakeUsd: 10,
      price: 0.6,
      shares: 10,
      requiredContract: marketRow.pool_address,
      requiredFunction: "bet(uint8,uint256)",
      chainId: 46630,
    });
    expect(response.json().potentialPayoutUsd).toBeCloseTo(15.714285, 5);
    expect(response.json().poolImpactPct).toBeCloseTo(9.090909, 5);
    expect(state.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: marketRow.pool_address, functionName: "yesPool" }),
    );
    expect(state.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: marketRow.pool_address, functionName: "noPool" }),
    );
  });

  it("fails closed when the market chain RPC is not configured", async () => {
    delete process.env.RHC_RPC_URL;

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/bets/preview",
      payload: { marketId: "46630:1", side: "YES", stakeUsd: 10 },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "rpc_not_configured" });
    expect(state.readContract).not.toHaveBeenCalled();
  });

  it("does not quote resolved or past-deadline pools", async () => {
    state.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "yesPool") return 60_000_000n;
      if (functionName === "noPool") return 40_000_000n;
      if (functionName === "resolved") return true;
      if (functionName === "deadline") return 1_906_675_200n;
      throw new Error(`unexpected function ${functionName}`);
    });

    const response = await state.app!.inject({
      method: "POST",
      url: "/api/bets/preview",
      payload: { marketId: "46630:1", side: "NO", stakeUsd: 10 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "market_resolved" });
  });
});
