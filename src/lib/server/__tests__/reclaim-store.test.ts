import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalBackendUrl = process.env.BACKEND_API_URL;
const originalPublicApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalProofSecret = process.env.RECLAIM_PROOF_WRITE_SECRET;

describe("reclaim-store", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.BACKEND_API_URL = "https://backend.example";
    delete process.env.NEXT_PUBLIC_API_URL;
    process.env.RECLAIM_PROOF_WRITE_SECRET = "test-proof-secret";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv("BACKEND_API_URL", originalBackendUrl);
    restoreEnv("NEXT_PUBLIC_API_URL", originalPublicApiUrl);
    restoreEnv("RECLAIM_PROOF_WRITE_SECRET", originalProofSecret);
  });

  it("sends the internal proof secret when reading stored proofs", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          sessionId: "session-1",
          providerId: "provider-1",
          proofHash: "0x1234",
          proof: { ok: true },
          verifiedAtIso: "2026-05-31T00:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { getProof } = await import("../reclaim-store");

    await expect(getProof("session/1")).resolves.toMatchObject({
      sessionId: "session-1",
      providerId: "provider-1",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://backend.example/api/reclaim/proofs/session%2F1", {
      headers: {
        "x-pariai-internal-secret": "test-proof-secret",
      },
      cache: "no-store",
    });
  });

  it("fails closed without the internal proof secret when reading stored proofs", async () => {
    delete process.env.RECLAIM_PROOF_WRITE_SECRET;
    const fetchMock = vi.mocked(fetch);
    const { getProof } = await import("../reclaim-store");

    await expect(getProof("session-1")).rejects.toThrow(
      "RECLAIM_PROOF_WRITE_SECRET is required to read verified Reclaim proofs",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
