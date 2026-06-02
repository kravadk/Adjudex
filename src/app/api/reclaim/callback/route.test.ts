import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyProof } from "@reclaimprotocol/js-sdk";
import { putProof } from "@/lib/server/reclaim-store";
import { POST } from "./route";

vi.mock("@reclaimprotocol/js-sdk", () => ({
  verifyProof: vi.fn(),
}));

vi.mock("@/lib/server/reclaim-store", () => ({
  putProof: vi.fn(),
}));

const verifyProofMock = vi.mocked(verifyProof);
const putProofMock = vi.mocked(putProof);

describe("POST /api/reclaim/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyProofMock.mockResolvedValue({ isVerified: true } as Awaited<ReturnType<typeof verifyProof>>);
    putProofMock.mockResolvedValue({
      sessionId: "session-1",
      providerId: "provider-1",
      proof: {},
      proofHash: `0x${"11".repeat(32)}`,
      verifiedAtIso: "2026-05-31T00:00:00.000Z",
    });
  });

  it("rejects verified proofs without a real session id", async () => {
    const response = await POST(jsonRequest({
      providerId: "provider-1",
      claimData: {
        context: JSON.stringify({ pariai: { marketId: "42", sourceUrl: "https://example.com/source" } }),
      },
    }));

    await expect(response.json()).resolves.toEqual({ error: "reclaim_session_id_required" });
    expect(response.status).toBe(400);
    expect(putProofMock).not.toHaveBeenCalled();
  });

  it("rejects verified proofs without a real provider id", async () => {
    const response = await POST(jsonRequest({
      sessionId: "session-1",
      claimData: {
        context: JSON.stringify({ reclaimSessionId: "session-1" }),
      },
    }));

    await expect(response.json()).resolves.toEqual({ error: "reclaim_provider_id_required" });
    expect(response.status).toBe(400);
    expect(putProofMock).not.toHaveBeenCalled();
  });

  it("persists verified proofs with explicit session and provider ids", async () => {
    const proof = {
      claimData: {
        provider: "provider-1",
        context: JSON.stringify({ reclaimSessionId: "session-1" }),
      },
    };

    const response = await POST(jsonRequest(proof));

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sessionId: "session-1",
      proofHash: `0x${"11".repeat(32)}`,
    });
    expect(response.status).toBe(200);
    expect(putProofMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      providerId: "provider-1",
      proof,
    });
  });
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/reclaim/callback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
