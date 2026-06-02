import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProof } from "@/lib/server/reclaim-store";
import { GET } from "./route";

vi.mock("@/lib/server/reclaim-store", () => ({
  getProof: vi.fn(),
}));

const getProofMock = vi.mocked(getProof);

describe("GET /api/reclaim/get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a session id", async () => {
    const response = await GET(new Request("http://localhost/api/reclaim/get"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "sessionId required" });
    expect(getProofMock).not.toHaveBeenCalled();
  });

  it("returns polling metadata without exposing raw proof JSON", async () => {
    getProofMock.mockResolvedValue({
      sessionId: "session-1",
      providerId: "provider-1",
      proofHash: `0x${"11".repeat(32)}`,
      proof: { sensitive: "raw-zktls-proof" },
      marketId: "42",
      sourceUrl: "https://example.com/source",
      chainId: 421614,
      poolAddress: "0x0000000000000000000000000000000000000001",
      walletAddress: "0x0000000000000000000000000000000000000002",
      verifiedAtIso: "2026-05-31T00:00:00.000Z",
    });

    const response = await GET(new Request("http://localhost/api/reclaim/get?sessionId=session-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      found: true,
      proof: {
        sessionId: "session-1",
        proofHash: `0x${"11".repeat(32)}`,
        marketId: "42",
        sourceUrl: "https://example.com/source",
        chainId: 421614,
        poolAddress: "0x0000000000000000000000000000000000000001",
        walletAddress: "0x0000000000000000000000000000000000000002",
        verifiedAtIso: "2026-05-31T00:00:00.000Z",
      },
    });
    expect(JSON.stringify(body)).not.toContain("raw-zktls-proof");
  });
});
