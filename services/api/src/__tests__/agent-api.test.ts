import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  query: queryMock,
  transaction: vi.fn(),
}));

const { server } = await import("../server");

const agentRow = {
  id: "agent-1",
  handle: "alpha-mm",
  emoji: "",
  reputation: "82",
  lifetime_pnl_usd: "125.5",
  markets_touched: 7,
  erc8004_address: "0x00000000000000000000000000000000000000aa",
  chain_id: 421614,
  registration_tx_hash: "0x00000000000000000000000000000000000000000000000000000000000000aa",
  strategy_description: "Market making on indexed markets",
  proof_url: "https://example.com/proof",
  last_action: "bet",
  registered_at: new Date("2026-06-01T00:00:00.000Z"),
};

describe("agent API", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns backend-backed reputation history for an agent", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [agentRow], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "rep-1",
            agent_id: "agent-1",
            reputation: "80",
            lifetime_pnl_usd: "100",
            markets_touched: 6,
            proof_url: null,
            reason: "indexed execution update",
            transaction_hash: "0x00000000000000000000000000000000000000000000000000000000000000ab",
            chain_id: 46630,
            created_at: new Date("2026-06-01T00:00:00.000Z"),
          },
        ],
        rowCount: 1,
      });

    const response = await server.inject({
      method: "GET",
      url: "/api/agents/agent-1/reputation",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        id: "rep-1",
        agentId: "agent-1",
        reputation: 80,
        lifetimePnlUsd: 100,
        marketsTouched: 6,
        reason: "indexed execution update",
        transactionHash: "0x00000000000000000000000000000000000000000000000000000000000000ab",
        chainId: 46630,
        atIso: "2026-06-01T00:00:00.000Z",
      },
    ]);
    expect(queryMock.mock.calls[1]?.[0]).toContain("FROM agent_reputation_history");
  });

  it("returns ecosystem summary from backend rows", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          agent_count: 1,
          active_agent_count: 1,
          total_pnl_usd: "125.5",
          average_reputation: "82",
          markets_touched: 7,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [agentRow], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: "act-1",
          kind: "ai-lp",
          chain_id: 421614,
          transaction_hash: "0x00000000000000000000000000000000000000000000000000000000000000bb",
          side: "YES",
          amount_usd: "10",
          wallet_short: null,
          agent_handle: "alpha-mm",
          market_title: "Market",
          market_id: "1",
          resolved_as: null,
          created_at: new Date("2026-06-01T01:00:00.000Z"),
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ volume_usd: "10" }], rowCount: 1 });

    const response = await server.inject({
      method: "GET",
      url: "/api/agents/ecosystem",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "active",
      agentCount: 1,
      activeAgentCount: 1,
      totalVolumeUsd: 10,
      totalPnlUsd: 125.5,
      averageReputation: 82,
      marketsTouched: 7,
      topAgents: [
        {
          id: "agent-1",
          handle: "alpha-mm",
          chainId: 421614,
          registrationTxHash: agentRow.registration_tx_hash,
          registeredAtIso: "2026-06-01T00:00:00.000Z",
        },
      ],
      recentMoves: [
        {
          id: "act-1",
          kind: "ai-lp",
          agentHandle: "alpha-mm",
          marketTitle: "Market",
          amountUsd: 10,
        },
      ],
    });
  });

  it("rejects agent registration without a confirmed transaction hash", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/agents/register",
      payload: { handle: "alpha-mm", chainId: 421614 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "transaction_hash_required" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("does not return reputation history for an unknown agent", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await server.inject({
      method: "GET",
      url: "/api/agents/missing/reputation",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "agent_not_found" });
  });
});
