import { afterEach, describe, expect, it, vi } from "vitest";

const {
  alchemyRpcUrl,
  configuredArbitrumSepoliaRpcUrl,
  configuredRhcRpcUrl,
  executeDuneSummary,
  fetchDuneSummary,
  fhenixPrototypeStatus,
  sponsorStatuses,
  zeroDevSessionPolicy,
} = await import("../sponsor-integrations");

const ORIGINAL_ENV = { ...process.env };

describe("sponsor integrations", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("builds Alchemy RPC URLs for Arbitrum and Robinhood Chain", () => {
    expect(alchemyRpcUrl("arb-sepolia", "key")).toBe("https://arb-sepolia.g.alchemy.com/v2/key");
    expect(alchemyRpcUrl("robinhood-testnet", "key")).toBe(
      "https://robinhood-testnet.g.alchemy.com/v2/key",
    );
  });

  it("uses direct RPC before Alchemy fallback", () => {
    process.env.ARBITRUM_SEPOLIA_RPC_URL = "https://direct.example";
    process.env.ALCHEMY_ARBITRUM_SEPOLIA_API_KEY = "alchemy";
    process.env.ALCHEMY_RHC_API_KEY = "rhc-key";

    expect(configuredArbitrumSepoliaRpcUrl()).toBe("https://direct.example");
    expect(configuredRhcRpcUrl()).toBe("https://robinhood-testnet.g.alchemy.com/v2/rhc-key");
  });

  it("reports which sponsor integrations are genuinely configured", () => {
    process.env.DUNE_API_KEY = "dune";
    process.env.DUNE_ADJUDEX_SUMMARY_QUERY_ID = "123";
    process.env.ALCHEMY_RHC_API_KEY = "rhc-key";
    process.env.RHC_MARKET_FACTORY_ADDRESS = "0x0000000000000000000000000000000000000001";

    const statuses = sponsorStatuses();

    expect(statuses.find((s) => s.id === "dune")).toMatchObject({ used: true, configured: true });
    expect(statuses.find((s) => s.id === "robinhood-chain")).toMatchObject({
      used: true,
      configured: true,
    });
    expect(statuses.find((s) => s.id === "fhenix")).toMatchObject({ used: true, configured: false });
  });

  it("fetches Dune query results when configured", async () => {
    process.env.DUNE_API_KEY = "dune-key";
    process.env.DUNE_ADJUDEX_SUMMARY_QUERY_ID = "42";
    process.env.DUNE_API_BASE_URL = "https://dune.test/api/v1";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          execution_id: "exec-1",
          state: "QUERY_STATE_COMPLETED",
          result: { rows: [{ markets: 3 }] },
        }),
        { status: 200 },
      ),
    );

    await expect(fetchDuneSummary(fetchMock)).resolves.toMatchObject({
      configured: true,
      queryId: "42",
      executionId: "exec-1",
      rows: [{ markets: 3 }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dune.test/api/v1/query/42/results",
      expect.objectContaining({
        headers: { "X-Dune-API-Key": "dune-key", "Content-Type": "application/json" },
      }),
    );
  });

  it("executes the configured Dune query on refresh", async () => {
    process.env.DUNE_API_KEY = "dune-key";
    process.env.DUNE_ADJUDEX_SUMMARY_QUERY_ID = "42";
    process.env.DUNE_API_BASE_URL = "https://dune.test/api/v1";
    process.env.DUNE_QUERY_PERFORMANCE = "large";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ execution_id: "exec-2", state: "QUERY_STATE_PENDING" }), {
        status: 200,
      }),
    );

    await expect(executeDuneSummary(fetchMock)).resolves.toMatchObject({
      configured: true,
      queryId: "42",
      executionId: "exec-2",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dune.test/api/v1/query/42/execute",
      expect.objectContaining({
        method: "POST",
        headers: { "X-Dune-API-Key": "dune-key", "Content-Type": "application/json" },
        body: JSON.stringify({ performance: "large" }),
      }),
    );
  });

  it("does not claim live Dune data without required env", async () => {
    delete process.env.DUNE_API_KEY;
    delete process.env.DUNE_ADJUDEX_SUMMARY_QUERY_ID;

    await expect(fetchDuneSummary()).resolves.toMatchObject({
      configured: false,
      error: "dune_not_configured",
    });
  });

  it("builds a bounded ZeroDev session policy without exposing secrets", () => {
    process.env.ZERODEV_PROJECT_ID = "secret-project-id";
    process.env.ZERODEV_PAYMASTER_POLICY_ID = "secret-policy-id";
    process.env.ZERODEV_CHAIN_IDS = "421614,46630";
    process.env.ZERODEV_SESSION_SPEND_CAP_USDC = "125";

    const policy = zeroDevSessionPolicy();

    expect(policy).toMatchObject({
      configured: true,
      projectConfigured: true,
      paymasterConfigured: true,
      chains: [421614, 46630],
      spendCapUsdc: 125,
    });
    expect(policy.permissions.map((permission) => permission.selector)).toContain("0xc97085c7");
    expect(JSON.stringify(policy)).not.toContain("secret-project-id");
    expect(JSON.stringify(policy)).not.toContain("secret-policy-id");
  });

  it("reports Fhenix prototype readiness from env", () => {
    process.env.FHENIX_RPC_URL = "https://fhenix.test";
    process.env.FHENIX_CHAIN_ID = "8008135";

    expect(fhenixPrototypeStatus()).toMatchObject({
      configured: true,
      chainId: 8008135,
      prototypeContract: "contracts/prototypes/FhenixSealedMarketPrototype.sol",
    });
  });
});
