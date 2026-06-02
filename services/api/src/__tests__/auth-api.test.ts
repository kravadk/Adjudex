import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const verifyMessageMock = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  query: queryMock,
  transaction: transactionMock,
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    verifyMessage: verifyMessageMock,
  };
});

const { server } = await import("../server");

const originalSiweDomain = process.env.SIWE_DOMAIN;
const originalPublicAppUrl = process.env.PUBLIC_APP_URL;
const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalReclaimPublicBaseUrl = process.env.RECLAIM_PUBLIC_BASE_URL;

describe("auth API", () => {
  beforeEach(() => {
    queryMock.mockReset();
    transactionMock.mockReset();
    verifyMessageMock.mockReset();
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });
    transactionMock.mockImplementation(async (callback) => callback(queryMock));
    verifyMessageMock.mockResolvedValue(true);
    process.env.SIWE_DOMAIN = "auth.pariai.test";
    delete process.env.PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.RECLAIM_PUBLIC_BASE_URL;
  });

  afterEach(() => {
    restoreEnv("SIWE_DOMAIN", originalSiweDomain);
    restoreEnv("PUBLIC_APP_URL", originalPublicAppUrl);
    restoreEnv("NEXT_PUBLIC_APP_URL", originalNextPublicAppUrl);
    restoreEnv("RECLAIM_PUBLIC_BASE_URL", originalReclaimPublicBaseUrl);
  });

  afterAll(async () => {
    await server.close();
  });

  it("uses the configured SIWE domain instead of the request Host header when issuing a nonce", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/auth/nonce",
      headers: { host: "attacker.example" },
      payload: {
        address: "0x0000000000000000000000000000000000000001",
        chainId: 46630,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { nonce: string; message: string };
    expect(body.nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(body.message).toContain("auth.pariai.test wants you to sign in with your Ethereum account");
    expect(body.message).not.toContain("attacker.example");
    expect(queryMock).toHaveBeenCalledWith(
      "INSERT INTO auth_nonces (nonce, address, message, chain_id, domain) VALUES ($1, $2, $3, $4, $5)",
      [
        body.nonce,
        "0x0000000000000000000000000000000000000001",
        body.message,
        46630,
        "auth.pariai.test",
      ],
    );
  });

  it("atomically consumes a SIWE nonce and creates a session scoped to chain and domain", async () => {
    const message = [
      "auth.pariai.test wants you to sign in with your Ethereum account:",
      "0x0000000000000000000000000000000000000001",
      "",
      "Sign in to PariAI to manage settings, watchlist, and notifications.",
      "",
      "URI: https://pariai.app",
      "Version: 1",
      "Chain ID: 46630",
      "Nonce: nonce-1",
      "Issued At: 2026-06-01T00:00:00.000Z",
    ].join("\n");
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ chain_id: 46630, domain: "auth.pariai.test" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    transactionMock.mockImplementationOnce(async (callback) => callback(execute));
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          nonce: "nonce-1",
          address: "0x0000000000000000000000000000000000000001",
          message,
          created_at: new Date(),
          consumed_at: null,
          chain_id: 46630,
          domain: "auth.pariai.test",
        },
      ],
      rowCount: 1,
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: {
        address: "0x0000000000000000000000000000000000000001",
        nonce: "nonce-1",
        signature: "0xsignature",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("pariai_session=");
    expect(verifyMessageMock).toHaveBeenCalledWith({
      address: "0x0000000000000000000000000000000000000001",
      message,
      signature: "0xsignature",
    });
    expect(execute.mock.calls[0]?.[0]).toContain("consumed_at IS NULL");
    expect(execute.mock.calls[0]?.[0]).toContain("RETURNING chain_id, domain");
    expect(execute.mock.calls[0]?.[1]).toEqual(["nonce-1", "0x0000000000000000000000000000000000000001", 900000]);
    expect(execute.mock.calls[1]?.[0]).toBe(
      "INSERT INTO auth_sessions (token, address, chain_id, domain, expires_at) VALUES ($1, $2, $3, $4, $5)",
    );
    expect((execute.mock.calls[1]?.[1] as unknown[]).slice(1, 4)).toEqual([
      "0x0000000000000000000000000000000000000001",
      46630,
      "auth.pariai.test",
    ]);
  });

  it("does not create a session when nonce consumption loses the race", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 });
    transactionMock.mockImplementationOnce(async (callback) => callback(execute));
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          nonce: "nonce-1",
          address: "0x0000000000000000000000000000000000000001",
          message: "message",
          created_at: new Date(),
          consumed_at: null,
          chain_id: 46630,
          domain: "auth.pariai.test",
        },
      ],
      rowCount: 1,
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: {
        address: "0x0000000000000000000000000000000000000001",
        nonce: "nonce-1",
        signature: "0xsignature",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "nonce_invalid_or_expired" });
    expect(execute.mock.calls).toHaveLength(1);
  });

  it("revokes the backend session and expires the cookie on wallet disconnect", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/wallet/disconnect",
      headers: { cookie: "pariai_session=session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, revoked: true });
    expect(response.headers["set-cookie"]).toContain("pariai_session=;");
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    expect(queryMock).toHaveBeenCalledWith("DELETE FROM auth_sessions WHERE token = $1", ["session-token"]);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
