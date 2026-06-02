import { afterEach, describe, expect, it, vi } from "vitest";

describe("backend API configuration", () => {
  const originalBackendUrl = process.env.BACKEND_API_URL;
  const originalPublicApiUrl = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    process.env.BACKEND_API_URL = originalBackendUrl;
    process.env.NEXT_PUBLIC_API_URL = originalPublicApiUrl;
    vi.resetModules();
  });

  it("rejects missing backend URLs", async () => {
    process.env.BACKEND_API_URL = "";
    process.env.NEXT_PUBLIC_API_URL = "";

    const { requireBackendUrl } = await import("../backend-api");

    expect(() => requireBackendUrl()).toThrow("BACKEND_API_URL must point to a real backend API.");
  });

  it("rejects relative backend URLs", async () => {
    process.env.BACKEND_API_URL = "/api";

    const { requireBackendUrl } = await import("../backend-api");

    expect(() => requireBackendUrl()).toThrow("BACKEND_API_URL must point to a real backend API.");
  });

  it("uses absolute backend URLs and trims trailing slashes", async () => {
    process.env.BACKEND_API_URL = "https://backend.adjudex.internal/";

    const { requireBackendUrl } = await import("../backend-api");

    expect(requireBackendUrl()).toBe("https://backend.adjudex.internal");
  });
});
