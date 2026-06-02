import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  query: queryMock,
  transaction: vi.fn(),
}));

const { server } = await import("../server");

describe("reclaim proof API", () => {
  beforeEach(() => {
    queryMock.mockReset();
    process.env.RECLAIM_PROOF_WRITE_SECRET = "test-proof-secret";
  });

  afterAll(async () => {
    await server.close();
  });

  it("requires source-bound PariAI binding metadata before storing a proof", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/reclaim/proofs",
      headers: { "x-pariai-internal-secret": "test-proof-secret" },
      payload: {
        sessionId: "session-1",
        providerId: "provider-1",
        proof: {
          claimData: {
            context: JSON.stringify({ reclaimSessionId: "session-1" }),
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "reclaim_proof_binding_required" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects proof writes without the internal write secret", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/reclaim/proofs",
      payload: {
        sessionId: "session-1",
        providerId: "provider-1",
        proof: boundProof(),
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "reclaim_proof_write_unauthorized" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects proof reads without the internal secret", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/reclaim/proofs/session-1",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "reclaim_proof_read_unauthorized" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("persists binding metadata extracted from proof claimData context", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });

    const proof = {
      claimData: {
        provider: "provider-1",
        context: JSON.stringify({
          pariai: {
            marketId: "46630:7",
            sourceUrl: "https://example.com/source",
            chainId: 46630,
            poolAddress: "0x0000000000000000000000000000000000000007",
            walletAddress: "0x0000000000000000000000000000000000000008",
          },
        }),
      },
    };

    const response = await server.inject({
      method: "POST",
      url: "/api/reclaim/proofs",
      headers: { "x-pariai-internal-secret": "test-proof-secret" },
      payload: {
        sessionId: "session-1",
        providerId: "provider-1",
        proof,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sessionId: "session-1",
      providerId: "provider-1",
      marketId: "46630:7",
      sourceUrl: "https://example.com/source",
      chainId: 46630,
      poolAddress: "0x0000000000000000000000000000000000000007",
      walletAddress: "0x0000000000000000000000000000000000000008",
    });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO reclaim_proofs"),
      [
        "session-1",
        "provider-1",
        expect.stringMatching(/^0x[0-9a-f]{64}$/),
        JSON.stringify(proof),
        "46630:7",
        "https://example.com/source",
        46630,
        "0x0000000000000000000000000000000000000007",
        "0x0000000000000000000000000000000000000008",
      ],
    );
  });

  it("rejects nested unsigned PariAI binding metadata", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/reclaim/proofs",
      headers: { "x-pariai-internal-secret": "test-proof-secret" },
      payload: {
        sessionId: "session-1",
        providerId: "provider-1",
        proof: {
          claimData: {
            provider: "provider-1",
            context: JSON.stringify({ reclaimSessionId: "session-1" }),
          },
          wrapper: boundProof(),
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "reclaim_proof_binding_required" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("exposes stored binding metadata from proof reads", async () => {
    queryMock.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          session_id: "session-1",
          provider_id: "provider-1",
          proof_hash: "0x1234",
          proof: { ok: true },
          market_id: "46630:7",
          source_url: "https://example.com/source",
          chain_id: 46630,
          pool_address: "0x0000000000000000000000000000000000000007",
          wallet_address: "0x0000000000000000000000000000000000000008",
          verified_at: new Date("2026-05-31T00:00:00.000Z"),
        },
      ],
    });

    const response = await server.inject({
      method: "GET",
      url: "/api/reclaim/proofs/session-1",
      headers: { "x-pariai-internal-secret": "test-proof-secret" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      sessionId: "session-1",
      providerId: "provider-1",
      proofHash: "0x1234",
      proof: { ok: true },
      marketId: "46630:7",
      sourceUrl: "https://example.com/source",
      chainId: 46630,
      poolAddress: "0x0000000000000000000000000000000000000007",
      walletAddress: "0x0000000000000000000000000000000000000008",
      verifiedAtIso: "2026-05-31T00:00:00.000Z",
    });
  });
});

function boundProof() {
  return {
    claimData: {
      provider: "provider-1",
      context: JSON.stringify({
        pariai: {
          marketId: "46630:7",
          sourceUrl: "https://example.com/source",
        },
      }),
    },
  };
}
