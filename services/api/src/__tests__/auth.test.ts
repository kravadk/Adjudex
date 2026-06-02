import { describe, expect, it } from "vitest";
import { buildSiweMessage, configuredSiweDomain, expiredSessionCookie, isNonceExpired, sessionCookie } from "../auth";

describe("auth helpers", () => {
  it("builds a wallet ownership message with nonce and domain", () => {
    const message = buildSiweMessage({
      domain: "adjudex.test",
      address: "0x0000000000000000000000000000000000000001",
      chainId: 46630,
      nonce: "abc123",
      issuedAtIso: "2026-05-27T00:00:00.000Z",
    });

    expect(message).toContain("adjudex.test wants you to sign in with your Ethereum account");
    expect(message).toContain("Chain ID: 46630");
    expect(message).toContain("Nonce: abc123");
  });

  it("expires nonces after fifteen minutes", () => {
    const createdAt = new Date("2026-05-27T00:00:00.000Z");
    const now = new Date("2026-05-27T00:16:00.000Z");

    expect(isNonceExpired(createdAt, now)).toBe(true);
  });

  it("normalizes the configured SIWE domain from a canonical app URL", () => {
    expect(configuredSiweDomain({ NEXT_PUBLIC_APP_URL: "https://Auth.Adjudex.test/app" })).toBe("auth.adjudex.test");
  });

  it("falls back to the production SIWE domain when config is missing", () => {
    expect(configuredSiweDomain({})).toBe("adjudex.app");
  });

  it("marks session cookies secure in production and expires the same cookie on logout", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const mutableEnv = process.env as Record<string, string | undefined>;
    mutableEnv.NODE_ENV = "production";

    expect(sessionCookie("token-1")).toContain("; Secure");
    expect(expiredSessionCookie()).toBe("adjudex_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure");

    if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = originalNodeEnv;
  });
});
