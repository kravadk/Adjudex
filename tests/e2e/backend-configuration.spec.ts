import { expect, test } from "@playwright/test";

test("data API fails closed when no real backend is configured", async ({ request }) => {
  test.skip(
    Boolean(process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL),
    "A real backend is configured for this run."
  );

  const response = await request.get("/api/markets");
  const body = await response.json();

  expect(response.status()).toBe(503);
  expect(body).toEqual(expect.objectContaining({ error: "backend_not_configured" }));
});
