import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const queryMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const setGaugeMock = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  query: queryMock,
}));

vi.mock("../sentry", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("../metrics", () => ({
  setGauge: setGaugeMock,
}));

const {
  createWebhookSubscription,
  enqueueMarketResolved,
  listWebhookSubscriptions,
  normalizeWebhookEventTypes,
  validateWebhookUrl,
} = await import("../webhooks");
const { registerWebhookRoutes } = await import("../webhook-routes");
const { drainWebhookDeliveriesOnce, signWebhookBody } = await import("../webhook-worker");

describe("webhook validation", () => {
  it("accepts only normalized public HTTPS URLs without fragments", () => {
    expect(validateWebhookUrl(" https://example.com/hooks#adjudex ")).toEqual({
      ok: true,
      url: "https://example.com/hooks",
    });
    expect(validateWebhookUrl("http://example.com/hooks")).toEqual({
      ok: false,
      error: "https_url_required",
    });
    expect(validateWebhookUrl("https://localhost/hooks")).toEqual({
      ok: false,
      error: "private_url_blocked",
    });
    expect(validateWebhookUrl("https://192.168.1.10/hooks")).toEqual({
      ok: false,
      error: "private_url_blocked",
    });
  });

  it("deduplicates supported event types and falls back to market.resolved", () => {
    expect(normalizeWebhookEventTypes(["market.created", "market.created", "unknown"])).toEqual([
      "market.created",
    ]);
    expect(normalizeWebhookEventTypes(["unknown"])).toEqual(["market.resolved"]);
    expect(normalizeWebhookEventTypes(undefined)).toEqual(["market.resolved"]);
  });
});

describe("webhook subscription service", () => {
  afterEach(() => {
    queryMock.mockReset();
    captureExceptionMock.mockReset();
    setGaugeMock.mockReset();
  });

  it("creates subscriptions with a one-time secret and filtered events", async () => {
    const exec = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await createWebhookSubscription(
      "0xABC",
      { url: "https://example.com/hook", eventTypes: ["market.created", "bad"] },
      exec,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.subscription.url).toBe("https://example.com/hook");
    expect(result.subscription.eventTypes).toEqual(["market.created"]);
    expect(result.subscription.secret).toMatch(/^[0-9a-f]{48}$/);
    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO webhook_subscriptions"),
      [
        expect.stringMatching(/^[0-9a-f]{24}$/),
        "0xabc",
        "https://example.com/hook",
        expect.stringMatching(/^[0-9a-f]{48}$/),
        ["market.created"],
      ],
    );
  });

  it("lists subscriptions without exposing secrets", async () => {
    const rows = [
      {
        id: "sub-1",
        url: "https://example.com/hook",
        event_types: ["market.resolved"],
        active: true,
        created_at: new Date("2026-06-03T10:00:00.000Z"),
      },
    ];
    const exec = vi.fn().mockResolvedValue({ rows, rowCount: 1 });

    await expect(listWebhookSubscriptions("0xABC", exec)).resolves.toEqual([
      {
        id: "sub-1",
        url: "https://example.com/hook",
        eventTypes: ["market.resolved"],
        active: true,
        createdAtIso: "2026-06-03T10:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(await listWebhookSubscriptions("0xABC", exec))).not.toContain("secret");
  });

  it("fans out market.resolved deliveries to active subscribers", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "sub-1" }, { id: "sub-2" }], rowCount: 2 })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await enqueueMarketResolved("market-1", "YES", "0xtx", exec);

    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls[0]?.[0]).toContain("$1 = ANY(event_types)");
    const firstInsertValues = exec.mock.calls[1]?.[1] as unknown[];
    expect(firstInsertValues.slice(1, 3)).toEqual(["sub-1", "market.resolved"]);
    expect(JSON.parse(firstInsertValues[3] as string)).toMatchObject({
      event: "market.resolved",
      marketId: "market-1",
      outcome: "YES",
      transactionHash: "0xtx",
    });
  });
});

describe("webhook routes", () => {
  afterEach(() => {
    queryMock.mockReset();
    captureExceptionMock.mockReset();
    setGaugeMock.mockReset();
  });

  it("requires authentication before listing subscriptions", async () => {
    const app = Fastify();
    registerWebhookRoutes(app, { requireSession: async () => null });

    const response = await app.inject({ method: "GET", url: "/api/webhooks" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "auth_required" });
    await app.close();
  });

  it("creates and deletes subscriptions for the authenticated owner", async () => {
    const app = Fastify();
    registerWebhookRoutes(app, {
      requireSession: async () => ({ address: "0xABC" }),
    });
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/webhooks",
      payload: { url: "https://example.com/hook", eventTypes: ["market.created"] },
    });
    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      url: "https://example.com/hook",
      eventTypes: ["market.created"],
      active: true,
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/webhooks/sub-1",
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ id: "sub-1", deleted: true });
    expect(queryMock.mock.calls.at(-1)?.[1]).toEqual(["sub-1", "0xABC"]);
    await app.close();
  });

  it("rejects private webhook targets at the API boundary", async () => {
    const app = Fastify();
    registerWebhookRoutes(app, {
      requireSession: async () => ({ address: "0xABC" }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks",
      payload: { url: "https://127.0.0.1/hook" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "private_url_blocked" });
    await app.close();
  });
});

describe("webhook worker", () => {
  afterEach(() => {
    queryMock.mockReset();
    captureExceptionMock.mockReset();
    setGaugeMock.mockReset();
  });

  it("signs the exact body with sha256 HMAC", () => {
    const body = JSON.stringify({ event: "market.resolved", marketId: "market-1" });
    expect(signWebhookBody("secret", body)).toBe(
      `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`,
    );
  });

  it("delivers pending rows with signature headers", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "delivery-1",
            subscription_id: "sub-1",
            event: "market.resolved",
            payload: { event: "market.resolved", marketId: "market-1" },
            attempts: 0,
            url: "https://example.com/hook",
            secret: "secret",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await drainWebhookDeliveriesOnce(fetchMock);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ event: "market.resolved", marketId: "market-1" }),
        headers: expect.objectContaining({
          "x-adjudex-event": "market.resolved",
          "x-adjudex-delivery": "delivery-1",
          "x-adjudex-signature": signWebhookBody(
            "secret",
            JSON.stringify({ event: "market.resolved", marketId: "market-1" }),
          ),
        }),
      }),
    );
    expect(queryMock.mock.calls[1]?.[0]).toContain("status = 'delivered'");
  });

  it("keeps failed deliveries pending with bounded backoff before max attempts", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "delivery-1",
            subscription_id: "sub-1",
            event: "market.resolved",
            payload: { event: "market.resolved" },
            attempts: 1,
            url: "https://example.com/hook",
            secret: "secret",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));

    await drainWebhookDeliveriesOnce(fetchMock);

    expect(queryMock.mock.calls[1]?.[0]).toContain("next_attempt_at");
    expect(queryMock.mock.calls[1]?.[1]).toEqual(["delivery-1", 2, "http_503", "pending", 40]);
  });
});
