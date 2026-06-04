import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  query: queryMock,
  transaction: transactionMock,
}));

const { server } = await import("../server");

describe("competitive gap APIs", () => {
  beforeEach(() => {
    queryMock.mockReset();
    transactionMock.mockReset();
    transactionMock.mockImplementation(async (callback) => callback(queryMock));
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    delete process.env.RECLAIM_PROOF_WRITE_SECRET;
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns a real empty liquidity state when no AMM row is indexed", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/markets/421614:99/liquidity",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      marketId: "421614:99",
      mode: "parimutuel",
      yesReserveUsd: 0,
      noReserveUsd: 0,
      yesShares: 0,
      noShares: 0,
      vaultDebtUsd: 0,
      vaultSurplusUsd: 0,
      updatedAtIso: null,
    });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("FROM market_liquidity"),
      ["421614:99"],
    );
  });

  it("quotes AMM sell exits from indexed reserves and supply", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        mode: "amm",
        yes_reserve: "100",
        no_reserve: "60",
        yes_shares: "200",
        no_shares: "120",
      }],
      rowCount: 1,
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/markets/421614:1/share-quote",
      payload: { side: "YES", action: "sell", shares: 20 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      marketId: "421614:1",
      side: "YES",
      action: "sell",
      amountUsd: 25,
      shares: 20,
      priceBps: 12500,
    });
  });

  it("lists signed order intents only from open non-expired database rows", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        hash: "0xorder",
        market_id: "421614:1",
        pool_address: "0x0000000000000000000000000000000000000001",
        side: "YES",
        order_type: "limit",
        amount_usd: "25",
        limit_price_bps: 4400,
        expires_at: new Date("2026-06-05T00:00:00Z"),
        nonce: "7",
        maker_address: "0x0000000000000000000000000000000000000002",
        builder_address: null,
        metadata_hash: "0xmeta",
        signature: "0xsig",
        status: "open",
        created_at: new Date("2026-06-04T00:00:00Z"),
      }],
      rowCount: 1,
    });

    const response = await server.inject({
      method: "GET",
      url: "/api/orders?marketId=421614:1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        hash: "0xorder",
        marketId: "421614:1",
        side: "YES",
        amountUsd: 25,
        status: "open",
      }),
    ]);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("expires_at > now()"),
      ["421614:1"],
    );
  });

  it("computes parlay preview from indexed market probabilities", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: "421614:1", yes_probability: "60" },
        { id: "421614:2", yes_probability: "40" },
      ],
      rowCount: 2,
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/parlays/preview",
      payload: {
        legs: [
          { marketId: "421614:1", side: "YES" },
          { marketId: "421614:2", side: "NO" },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      naiveProbabilityBps: 3600,
      executable: false,
    });
  });

  it("does not fabricate opportunities when the table is empty", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/opportunities",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("rebuilds opportunities from incoherent exclusive outcome groups", async () => {
    process.env.RECLAIM_PROOF_WRITE_SECRET = "secret";
    queryMock.mockResolvedValueOnce({
      rows: [{
        group_id: "group-1",
        group_title: "Winner",
        market_id: "421614:1",
        total_probability_bps: 10850,
        liquidity_depth_usd: "75",
      }],
      rowCount: 1,
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/opportunities/rebuild",
      headers: { "x-adjudex-internal-secret": "secret" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ rebuilt: 1 });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("FROM market_groups"),
      [],
    );
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO market_opportunities"),
      expect.arrayContaining(["exclusive-group:group-1", "421614:1", 850]),
    );
  });

  it("keeps creator and order writes behind SIWE auth", async () => {
    const creatorResponse = await server.inject({
      method: "POST",
      url: "/api/creators",
      payload: { handle: "caster", channelUrl: "https://example.com" },
    });
    const orderResponse = await server.inject({
      method: "POST",
      url: "/api/orders",
      payload: {},
    });

    expect(creatorResponse.statusCode).toBe(401);
    expect(orderResponse.statusCode).toBe(401);
  });
});
