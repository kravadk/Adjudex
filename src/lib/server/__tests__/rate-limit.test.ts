import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, rateLimitResponse, resetRateLimitsForTests } from "../rate-limit";

describe("server rate limit", () => {
  beforeEach(() => {
    resetRateLimitsForTests();
  });

  it("allows requests up to the configured bucket limit", () => {
    const request = new Request("http://localhost/api/auth/nonce", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });

    expect(checkRateLimit({ bucket: "auth:nonce", request, limit: 2, windowMs: 60_000 })).toEqual({ ok: true });
    expect(checkRateLimit({ bucket: "auth:nonce", request, limit: 2, windowMs: 60_000 })).toEqual({ ok: true });
    const limited = checkRateLimit({ bucket: "auth:nonce", request, limit: 2, windowMs: 60_000 });

    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("isolates buckets so one endpoint cannot exhaust another", () => {
    const request = new Request("http://localhost/api/sync/transaction", {
      headers: { "x-forwarded-for": "203.0.113.11" },
    });

    expect(checkRateLimit({ bucket: "sync:transaction", request, limit: 1, windowMs: 60_000 })).toEqual({ ok: true });
    expect(checkRateLimit({ bucket: "auth:nonce", request, limit: 1, windowMs: 60_000 })).toEqual({ ok: true });
  });

  it("returns explicit 429 metadata", async () => {
    const request = new Request("http://localhost/api/reclaim/session");
    expect(checkRateLimit({ bucket: "reclaim:session", request, limit: 1, windowMs: 60_000 })).toEqual({ ok: true });
    const limited = checkRateLimit({ bucket: "reclaim:session", request, limit: 1, windowMs: 60_000 });
    if (limited.ok) throw new Error("expected rate limit");

    const response = rateLimitResponse(limited);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({ error: "rate_limited" });
  });
});
