import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  query: queryMock,
  transaction: transactionMock,
}));

const { server } = await import("../server");

const originalStripeSecretKey = process.env.STRIPE_SECRET_KEY;
const originalStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

function stripeSignature(payload: string, secret: string, timestamp: number): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("billing API", () => {
  beforeEach(() => {
    queryMock.mockReset();
    transactionMock.mockReset();
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });
    transactionMock.mockImplementation(async (callback) => callback(queryMock));
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
  });

  afterEach(() => {
    restoreEnv("STRIPE_SECRET_KEY", originalStripeSecretKey);
    restoreEnv("STRIPE_WEBHOOK_SECRET", originalStripeWebhookSecret);
  });

  afterAll(async () => {
    await server.close();
  });

  it("rejects unsigned Stripe webhook events before persistence", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/billing/webhook/stripe",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        id: "evt_unsigned",
        type: "checkout.session.completed",
        data: { object: { id: "cs_unsigned" } },
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "webhook_signature_invalid" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("accepts a valid Stripe signature computed over the raw body", async () => {
    const payload = JSON.stringify({
      id: "evt_signed",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_signed",
          subscription: "sub_signed",
          client_reference_id: "0x00000000000000000000000000000000000000aa",
          metadata: {
            address: "0x00000000000000000000000000000000000000aa",
            tier: "pro",
          },
        },
      },
    });
    const timestamp = Math.floor(Date.now() / 1000);

    const response = await server.inject({
      method: "POST",
      url: "/api/billing/webhook/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": stripeSignature(payload, process.env.STRIPE_WEBHOOK_SECRET!, timestamp),
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO subscription_events"),
      expect.arrayContaining(["evt_signed", "checkout.session.completed"]),
    );
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO subscriptions"),
      expect.arrayContaining(["stripe_sub_signed"]),
    );
  });
});
