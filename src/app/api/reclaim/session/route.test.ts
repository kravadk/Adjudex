import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";
import { POST } from "./route";

vi.mock("@reclaimprotocol/js-sdk", () => ({
  ReclaimProofRequest: {
    init: vi.fn(),
  },
}));

const reclaimInitMock = vi.mocked(ReclaimProofRequest.init);
const originalEnv = new Map<string, string | undefined>([
  ["RECLAIM_APP_ID", process.env.RECLAIM_APP_ID],
  ["RECLAIM_APP_SECRET", process.env.RECLAIM_APP_SECRET],
  ["RECLAIM_PROVIDER_ID", process.env.RECLAIM_PROVIDER_ID],
  ["RECLAIM_PUBLIC_BASE_URL", process.env.RECLAIM_PUBLIC_BASE_URL],
]);

describe("POST /api/reclaim/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RECLAIM_APP_ID = "app-id";
    process.env.RECLAIM_APP_SECRET = "app-secret";
    process.env.RECLAIM_PROVIDER_ID = "provider-id";
    process.env.RECLAIM_PUBLIC_BASE_URL = "https://adjudex.example";
  });

  afterEach(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("fails closed when Reclaim credentials are not configured", async () => {
    delete process.env.RECLAIM_APP_ID;

    const response = await POST(jsonRequest({ marketId: "42", sourceUrl: "https://example.com/source" }));

    await expect(response.json()).resolves.toMatchObject({
      error: "RECLAIM_APP_ID / RECLAIM_APP_SECRET not configured",
    });
    expect(response.status).toBe(503);
    expect(reclaimInitMock).not.toHaveBeenCalled();
  });

  it("requires market and source binding before creating a session", async () => {
    const response = await POST(jsonRequest({}));

    await expect(response.json()).resolves.toMatchObject({
      error: "marketId and sourceUrl required for source-bound proof sessions",
    });
    expect(response.status).toBe(400);
    expect(reclaimInitMock).not.toHaveBeenCalled();
  });

  it("fails closed when public callback base URL is not configured", async () => {
    delete process.env.RECLAIM_PUBLIC_BASE_URL;

    const response = await POST(jsonRequest({ marketId: "42", sourceUrl: "https://example.com/source" }));

    await expect(response.json()).resolves.toMatchObject({
      error: "RECLAIM_PUBLIC_BASE_URL required for callback registration",
    });
    expect(response.status).toBe(503);
    expect(reclaimInitMock).not.toHaveBeenCalled();
  });

  it("creates a Reclaim request with exact Adjudex market context", async () => {
    const setJsonContext = vi.fn();
    const setAppCallbackUrl = vi.fn();
    reclaimInitMock.mockResolvedValue({
      setJsonContext,
      setAppCallbackUrl,
      getRequestUrl: vi.fn(async () => "https://reclaim.example/request?sessionId=session-1"),
      getStatusUrl: vi.fn(() => "https://reclaim.example/status/session-1"),
      getSessionId: vi.fn(() => "session-1"),
    } as unknown as Awaited<ReturnType<typeof ReclaimProofRequest.init>>);

    const response = await POST(jsonRequest({
      marketId: "46630:7",
      sourceUrl: "https://Example.com/source#section",
      chainId: 46630,
      poolAddress: "0x0000000000000000000000000000000000000007",
      walletAddress: "0x0000000000000000000000000000000000000008",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      sessionId: "session-1",
      requestUrl: "https://reclaim.example/request?sessionId=session-1",
      statusUrl: "https://reclaim.example/status/session-1",
      providerId: "provider-id",
    });
    expect(reclaimInitMock).toHaveBeenCalledWith("app-id", "app-secret", "provider-id");
    expect(setJsonContext).toHaveBeenCalledWith({
      adjudex: {
        marketId: "46630:7",
        sourceUrl: "https://example.com/source",
        chainId: 46630,
        poolAddress: "0x0000000000000000000000000000000000000007",
        walletAddress: "0x0000000000000000000000000000000000000008",
      },
    });
    expect(setAppCallbackUrl).toHaveBeenCalledWith(
      "https://adjudex.example/api/reclaim/callback",
      true,
    );
  });
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/reclaim/session", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000" },
    body: JSON.stringify(body),
  });
}
