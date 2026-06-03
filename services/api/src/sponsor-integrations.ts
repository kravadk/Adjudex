import type { ContractsChainId } from "@gmx-io/sdk/configs/chains";
import { keccak256, toBytes } from "viem";
import type { ImportCandidateDraft } from "./importer";

type FetchLike = typeof fetch;

type SponsorStatus = {
  id: string;
  name: string;
  used: boolean;
  configured: boolean;
  evidence: string[];
};

type DuneResultResponse = {
  execution_id?: string;
  state?: string;
  result?: {
    rows?: unknown[];
    metadata?: unknown;
  };
};

type DuneExecuteResponse = {
  execution_id?: string;
  state?: string;
};

type GmxMarket = {
  marketTokenAddress?: string;
  indexTokenAddress?: string;
  longTokenAddress?: string;
  shortTokenAddress?: string;
  isListed?: boolean;
  name?: string;
  symbol?: string;
};

type GmxMarketTicker = {
  symbol?: string;
  marketTokenAddress?: string;
  availableLiquidityLong?: bigint;
  availableLiquidityShort?: bigint;
  poolAmountLongUsd?: bigint;
  poolAmountShortUsd?: bigint;
  longInterestUsd?: bigint;
  shortInterestUsd?: bigint;
  priceChangePercent24hBps?: bigint;
  // Funding factor per second, GMX 1e30-scaled. Sign tells which side pays;
  // magnitude is only annualized as an estimate (see gmxFundingApr).
  fundingRateLong?: bigint;
  fundingRateShort?: bigint;
};

type GmxMarketInfoRow = {
  name?: string;
  symbol?: string;
  marketToken?: string;
  marketTokenAddress?: string;
  indexToken?: string;
  indexTokenAddress?: string;
  longToken?: string;
  longTokenAddress?: string;
  shortToken?: string;
  shortTokenAddress?: string;
  isListed?: boolean;
  openInterestLong?: string | number | bigint;
  openInterestShort?: string | number | bigint;
  availableLiquidityLong?: string | number | bigint;
  availableLiquidityShort?: string | number | bigint;
  fundingRateLong?: string | number | bigint;
  fundingRateShort?: string | number | bigint;
};

const GMX_SUPPORTED_CHAIN_IDS = new Set<ContractsChainId>([42161, 421614, 43114, 43113, 3637, 4326]);

export function alchemyRpcUrl(network: "arb-sepolia" | "arb-mainnet" | "robinhood-testnet", apiKey?: string) {
  const key = apiKey?.trim();
  if (!key) return undefined;
  return `https://${network}.g.alchemy.com/v2/${key}`;
}

export function configuredRhcRpcUrl() {
  return (
    process.env.RHC_RPC_URL?.trim() ||
    alchemyRpcUrl("robinhood-testnet", process.env.ALCHEMY_RHC_API_KEY)
  );
}

export function configuredArbitrumSepoliaRpcUrl() {
  return (
    process.env.ARBITRUM_SEPOLIA_RPC_URL?.trim() ||
    alchemyRpcUrl("arb-sepolia", process.env.ALCHEMY_ARBITRUM_SEPOLIA_API_KEY)
  );
}

export function sponsorStatuses(): SponsorStatus[] {
  const rhcRpc = configuredRhcRpcUrl();
  const arbitrumRpc = configuredArbitrumSepoliaRpcUrl();
  const zeroDevPolicy = zeroDevSessionPolicy();
  return [
    {
      id: "alchemy",
      name: "Alchemy",
      used: Boolean(rhcRpc || arbitrumRpc),
      configured: Boolean(process.env.ALCHEMY_RHC_API_KEY || process.env.ALCHEMY_ARBITRUM_SEPOLIA_API_KEY),
      evidence: [
        "Alchemy RPC fallback for Arbitrum Sepolia and Robinhood Chain.",
        rhcRpc ? "Robinhood Chain RPC is resolvable." : "Set ALCHEMY_RHC_API_KEY or RHC_RPC_URL.",
        arbitrumRpc ? "Arbitrum Sepolia RPC is resolvable." : "Set ALCHEMY_ARBITRUM_SEPOLIA_API_KEY or ARBITRUM_SEPOLIA_RPC_URL.",
      ],
    },
    {
      id: "robinhood-chain",
      name: "Robinhood Chain",
      used: Boolean(rhcRpc),
      configured: Boolean(rhcRpc && process.env.RHC_MARKET_FACTORY_ADDRESS),
      evidence: [
        "Robinhood Chain testnet is wired into chain config, wagmi, backend health, and factory lookup.",
        rhcRpc ? "RHC RPC is configured." : "Set RHC_RPC_URL or ALCHEMY_RHC_API_KEY.",
      ],
    },
    {
      id: "dune",
      name: "Dune Analytics",
      used: true,
      configured: Boolean(process.env.DUNE_API_KEY && process.env.DUNE_ADJUDEX_SUMMARY_QUERY_ID),
      evidence: [
        "Backend Dune results proxy at /api/integrations/dune/summary.",
        "Reusable SQL templates are exposed at /api/integrations/dune/templates for traction, accuracy, chain comparison, and webhook delivery.",
        "Set DUNE_API_KEY and DUNE_ADJUDEX_SUMMARY_QUERY_ID for live dashboard data.",
      ],
    },
    {
      id: "gmx",
      name: "GMX",
      used: true,
      configured: true,
      evidence: [
        "@gmx-io/sdk is installed and used by /api/integrations/gmx/markets and /api/integrations/gmx/signal.",
        "GMX signal endpoint reads markets, tickers, rates, APY, annualized performance, OHLCV candles, and recent trades for market evidence.",
        `GMX chain id defaults to ${configuredGmxChainId()}.`,
      ],
    },
    {
      id: "openzeppelin",
      name: "OpenZeppelin",
      used: true,
      configured: true,
      evidence: [
        "Contracts import @openzeppelin/contracts ERC20, IERC20, SafeERC20, ReentrancyGuard, Ownable2Step, and Pausable.",
        "ParimutuelPool: ReentrancyGuard on every value path, SafeERC20 transfers, resolver-gated emergency pause (claims/refunds stay open).",
        "MarketFactory: Ownable2Step + Pausable creation. ProofAnchor and TokenizedStockAdapter use Ownable2Step two-step ownership handoff.",
      ],
    },
    {
      id: "aws",
      name: "AWS",
      used: true,
      configured: Boolean(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION),
      evidence: [
        "AWS App Runner blueprints live in infra/aws/apprunner-api.yaml and infra/aws/apprunner-web.yaml.",
        "CloudWatch alarms and encrypted S3 evidence export bucket live in infra/aws/ops-alarms.yaml.",
        "Production runbook for App Runner, RDS, Redis, and Secrets Manager lives in docs/AWS.md.",
        process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION
          ? "AWS region env is configured."
          : "Set AWS_REGION when deploying the App Runner services.",
      ],
    },
    {
      id: "zerodev",
      name: "ZeroDev",
      used: true,
      configured: zeroDevPolicy.configured,
      evidence: [
        "Bounded session-key policy is exposed at /api/integrations/zerodev/session-policy.",
        "Policy restricts calls to market creation, betting, claims, and refunds with zero native value.",
        "Client gasless bet flow uses ZeroDev Kernel account, ECDSA validator, bundler RPC, and optional paymaster sponsorship when NEXT_PUBLIC_ZERODEV_GASLESS_ENABLED=1.",
        zeroDevPolicy.configured
          ? "ZeroDev project/paymaster env is configured."
          : "Set ZERODEV_PROJECT_ID and ZERODEV_PAYMASTER_POLICY_ID or ZERODEV_BUNDLER_RPC_URL.",
      ],
    },
    {
      id: "fhenix",
      name: "Fhenix",
      used: true,
      configured: fhenixPrototypeStatus().configured,
      evidence: [
        "Sealed-market prototype lives at contracts/prototypes/FhenixSealedMarketPrototype.sol.",
        "Prototype uses CoFHE encrypted amounts and public-total reveal flow after deadline.",
        "@fhenixprotocol/cofhe-contracts is installed and pnpm contracts:compile:fhenix produces a prototype ABI.",
        fhenixPrototypeStatus().configured
          ? "Fhenix RPC/toolchain env is configured."
          : "Set FHENIX_RPC_URL and FHENIX_CHAIN_ID before deploying the prototype.",
      ],
    },
  ];
}

export function zeroDevSessionPolicy() {
  const projectId = process.env.ZERODEV_PROJECT_ID?.trim();
  const paymasterPolicyId = process.env.ZERODEV_PAYMASTER_POLICY_ID?.trim();
  const bundlerRpcUrl = process.env.ZERODEV_BUNDLER_RPC_URL?.trim();
  const spendCapUsdc = positiveIntegerEnv("ZERODEV_SESSION_SPEND_CAP_USDC", 250);
  const ttlHours = positiveIntegerEnv("ZERODEV_SESSION_TTL_HOURS", 24);
  const chainIds = (process.env.ZERODEV_CHAIN_IDS ?? `${process.env.INDEXER_CHAIN_ID ?? 421614},${process.env.RHC_CHAIN_ID ?? 46630}`)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  const now = Math.floor(Date.now() / 1000);

  return {
    configured: Boolean(projectId && (paymasterPolicyId || bundlerRpcUrl)),
    projectConfigured: Boolean(projectId),
    paymasterConfigured: Boolean(paymasterPolicyId),
    bundlerConfigured: Boolean(bundlerRpcUrl),
    validAfter: now,
    validUntil: now + ttlHours * 60 * 60,
    ttlHours,
    spendCapUsdc,
    chains: Array.from(new Set(chainIds)),
    permissions: [
      {
        label: "Create market",
        target: process.env.MARKET_FACTORY_ADDRESS?.trim() || "MARKET_FACTORY_ADDRESS",
        selector: selectorFor("createMarketWithSpec(bytes32,uint256,string)"),
        functionName: "createMarketWithSpec",
        valueLimitWei: "0",
      },
      {
        label: "Create RHC market",
        target: process.env.RHC_MARKET_FACTORY_ADDRESS?.trim() || "RHC_MARKET_FACTORY_ADDRESS",
        selector: selectorFor("createMarketWithSpec(bytes32,uint256,string)"),
        functionName: "createMarketWithSpec",
        valueLimitWei: "0",
      },
      {
        label: "Bet USDC",
        target: "selected ParimutuelPool",
        selector: selectorFor("bet(uint8,uint256)"),
        functionName: "bet",
        valueLimitWei: "0",
        maxAmountUsdc: spendCapUsdc,
      },
      {
        label: "Claim payout",
        target: "selected ParimutuelPool",
        selector: selectorFor("claim(uint256)"),
        functionName: "claim",
        valueLimitWei: "0",
      },
      {
        label: "Refund after grace",
        target: "selected ParimutuelPool",
        selector: selectorFor("refundAfterGrace(uint256)"),
        functionName: "refundAfterGrace",
        valueLimitWei: "0",
      },
    ],
  };
}

export function fhenixPrototypeStatus() {
  const rpcUrl = process.env.FHENIX_RPC_URL?.trim();
  const chainId = Number(process.env.FHENIX_CHAIN_ID ?? 0);
  const packageName = "@fhenixprotocol/cofhe-contracts";
  return {
    configured: Boolean(rpcUrl && Number.isSafeInteger(chainId) && chainId > 0),
    chainId: Number.isSafeInteger(chainId) && chainId > 0 ? chainId : undefined,
    rpcConfigured: Boolean(rpcUrl),
    prototypeContract: "contracts/prototypes/FhenixSealedMarketPrototype.sol",
    requiredPackage: packageName,
    compileCommand: "pnpm contracts:compile:fhenix",
    capabilities: [
      "encrypted YES/NO amount inputs",
      "per-wallet encrypted position storage",
      "resolver-triggered public total reveal after deadline",
    ],
  };
}

export function duneQueryTemplates() {
  return [
    {
      id: "adjudex-volume-users-markets",
      title: "Adjudex volume, users, markets",
      description: "Core traction panel for volume, active wallets, markets, and payouts.",
      sql: [
        "SELECT",
        "  date_trunc('day', created_at) AS day,",
        "  count(DISTINCT market_id) AS markets_touched,",
        "  count(DISTINCT lower(address)) AS active_wallets,",
        "  sum(stake_usd) AS volume_usd",
        "FROM positions",
        "GROUP BY 1",
        "ORDER BY 1 DESC;",
      ].join("\n"),
    },
    {
      id: "adjudex-resolution-accuracy",
      title: "Resolution accuracy and payout lifecycle",
      description: "Resolved markets, claimable/claimed positions, and payout totals.",
      sql: [
        "SELECT",
        "  m.chain_id,",
        "  count(*) FILTER (WHERE m.status = 'resolved') AS resolved_markets,",
        "  count(c.id) AS claims,",
        "  coalesce(sum(c.payout_usd), 0) AS payout_usd",
        "FROM markets m",
        "LEFT JOIN positions p ON p.market_id = m.id AND p.chain_id = m.chain_id",
        "LEFT JOIN claims c ON c.position_id = p.id AND c.chain_id = p.chain_id",
        "GROUP BY 1",
        "ORDER BY 1;",
      ].join("\n"),
    },
    {
      id: "adjudex-rhc-vs-arbitrum",
      title: "Robinhood Chain vs Arbitrum",
      description: "Compare market count, volume, bettors, and resolved market share by chain.",
      sql: [
        "SELECT",
        "  m.chain_id,",
        "  count(*) AS markets,",
        "  coalesce(sum(s.volume_usd), 0) AS volume_usd,",
        "  coalesce(sum(s.bettors), 0) AS bettors,",
        "  count(*) FILTER (WHERE m.status = 'resolved') AS resolved_markets",
        "FROM markets m",
        "LEFT JOIN market_stats s ON s.market_id = m.id",
        "GROUP BY 1",
        "ORDER BY volume_usd DESC;",
      ].join("\n"),
    },
    {
      id: "adjudex-webhook-delivery",
      title: "Webhook delivery reliability",
      description: "Success rate, retries, and failed endpoints for market.resolved webhooks.",
      sql: [
        "SELECT",
        "  event,",
        "  status,",
        "  count(*) AS deliveries,",
        "  avg(attempts) AS avg_attempts,",
        "  max(attempts) AS max_attempts",
        "FROM webhook_deliveries",
        "GROUP BY 1, 2",
        "ORDER BY deliveries DESC;",
      ].join("\n"),
    },
  ];
}

export async function fetchDuneSummary(fetchImpl: FetchLike = fetch) {
  const config = duneSummaryConfig();
  if (!config) {
    return {
      configured: false,
      error: "dune_not_configured",
      requiredEnv: ["DUNE_API_KEY", "DUNE_ADJUDEX_SUMMARY_QUERY_ID"],
    };
  }

  const response = await fetchImpl(`${config.baseUrl}/query/${encodeURIComponent(config.queryId)}/results`, {
    headers: duneHeaders(config.apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    return { configured: true, error: "dune_request_failed", status: response.status };
  }

  const body = (await response.json()) as DuneResultResponse;
  return {
    configured: true,
    queryId: config.queryId,
    executionId: body.execution_id,
    state: body.state,
    rows: body.result?.rows ?? [],
    metadata: body.result?.metadata,
  };
}

export async function executeDuneSummary(fetchImpl: FetchLike = fetch) {
  const config = duneSummaryConfig();
  if (!config) {
    return {
      configured: false,
      error: "dune_not_configured",
      requiredEnv: ["DUNE_API_KEY", "DUNE_ADJUDEX_SUMMARY_QUERY_ID"],
    };
  }

  const response = await fetchImpl(`${config.baseUrl}/query/${encodeURIComponent(config.queryId)}/execute`, {
    method: "POST",
    headers: duneHeaders(config.apiKey),
    body: JSON.stringify({ performance: process.env.DUNE_QUERY_PERFORMANCE?.trim() || "medium" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    return { configured: true, error: "dune_execute_failed", status: response.status };
  }

  const body = (await response.json()) as DuneExecuteResponse;
  return {
    configured: true,
    queryId: config.queryId,
    executionId: body.execution_id,
    state: body.state,
  };
}

export async function fetchGmxMarkets(limit = 12) {
  const chainId = configuredGmxChainId();
  const apiUrl = process.env.GMX_API_URL?.trim() || defaultGmxApiUrl(chainId);
  const { markets, tickers } = await fetchGmxMarketsInfoSnapshot(apiUrl);
  const tickersByAddress = new Map(
    tickers
      .filter((ticker) => ticker.marketTokenAddress)
      .map((ticker) => [ticker.marketTokenAddress!.toLowerCase(), ticker])
  );
  return {
    configured: true,
    chainId,
    apiUrl,
    markets: markets.slice(0, Math.max(1, Math.min(limit, 50))).map((market) => ({
      name: market.name ?? market.symbol ?? market.marketTokenAddress ?? "GMX market",
      symbol: market.symbol,
      marketTokenAddress: market.marketTokenAddress,
      indexTokenAddress: market.indexTokenAddress,
      longTokenAddress: market.longTokenAddress,
      shortTokenAddress: market.shortTokenAddress,
      isListed: market.isListed,
      ticker: market.marketTokenAddress ? tickerForResponse(tickersByAddress.get(market.marketTokenAddress.toLowerCase())) : undefined,
    })),
  };
}

// Live GMX market-intelligence signal for a single token (e.g. "BTC"), used
// as a context card on crypto market pages. Returns confident metrics
// (liquidity, long/short open interest, 24h price change) plus a best-effort
// annualized funding estimate that is hidden when the scaling looks
// implausible — we never surface a number we can't stand behind.
export async function fetchGmxSignal(rawSymbol: string, input: { marketTokenAddress?: string; limit?: number } = {}) {
  const symbol = normalizeGmxBase(rawSymbol);
  const requestedAddress = input.marketTokenAddress?.trim();
  const limit = Math.max(1, Math.min(input.limit ?? 24, 100));
  if (!symbol && !requestedAddress) return { configured: true, found: false, symbol: rawSymbol };

  const { GmxApiSdk } = await import("@gmx-io/sdk/v2");
  const chainId = configuredGmxChainId();
  const apiUrl = process.env.GMX_API_URL?.trim() || defaultGmxApiUrl(chainId);
  const sdk = new GmxApiSdk({ chainId, apiUrl });
  const { tickers } = await fetchGmxMarketsInfoSnapshot(apiUrl);

  const ticker =
    tickers.find((item) => requestedAddress && item.marketTokenAddress?.toLowerCase() === requestedAddress.toLowerCase()) ??
    tickers.find((item) => normalizeGmxBase(item.symbol) === symbol);
  if (!ticker) {
    return { configured: true, chainId, symbol, marketTokenAddress: requestedAddress, found: false };
  }
  const marketTokenAddress = ticker.marketTokenAddress;
  const marketSymbol = ticker.symbol ?? rawSymbol;
  const [rates, apy, performance, ohlcv, trades] = await Promise.all([
    marketTokenAddress
      ? sdk.fetchRates({ period: "7d", averageBy: "1d", address: marketTokenAddress }).catch(() => [])
      : Promise.resolve([]),
    sdk.fetchApy({ period: "7d" }).catch(() => ({ markets: {}, glvs: {} })),
    marketTokenAddress
      ? sdk.fetchPerformanceAnnualized({ period: "30d", address: marketTokenAddress }).catch(() => [])
      : Promise.resolve([]),
    marketSymbol
      ? sdk.fetchOhlcv({ symbol: marketSymbol, timeframe: "1h", limit }).catch(() => [])
      : Promise.resolve([]),
    marketTokenAddress
      ? sdk.searchTrades({
          forAllAccounts: true,
          marketsDirections: [{ marketAddress: marketTokenAddress, direction: "any" }],
          limit: Math.min(limit, 25),
        }).catch(() => ({ trades: [], nextCursor: null, hasMore: false }))
      : Promise.resolve({ trades: [], nextCursor: null, hasMore: false }),
  ]);
  const rate = Array.isArray(rates) ? rates[0] : undefined;
  // The catch-fallback gives `markets: {}` (no index signature), so narrow to
  // a string-keyed record before looking the market up by either casing.
  const apyMarkets = (apy.markets ?? {}) as Record<string, unknown>;
  const apyEntry = marketTokenAddress
    ? apyMarkets[marketTokenAddress] ?? apyMarkets[marketTokenAddress.toLowerCase()]
    : undefined;

  return {
    configured: true,
    found: true,
    chainId,
    symbol,
    market: marketSymbol,
    marketTokenAddress,
    liquidityUsd: usdBigIntToNumber(ticker.poolAmountLongUsd) + usdBigIntToNumber(ticker.poolAmountShortUsd),
    openInterestLongUsd: usdBigIntToNumber(ticker.longInterestUsd),
    openInterestShortUsd: usdBigIntToNumber(ticker.shortInterestUsd),
    priceChangePercent24h:
      ticker.priceChangePercent24hBps === undefined ? undefined : Number(ticker.priceChangePercent24hBps) / 100,
    fundingLongAprEstimate: gmxFundingApr(ticker.fundingRateLong),
    fundingShortAprEstimate: gmxFundingApr(ticker.fundingRateShort),
    rates: rate
      ? {
          marketAddress: rate.marketAddress,
          latest: rate.ratesSnapshots?.at(-1),
          snapshots: rate.ratesSnapshots?.slice(-7) ?? [],
        }
      : undefined,
    apy: apyEntry,
    performance: Array.isArray(performance) ? performance[0] : undefined,
    ohlcv: Array.isArray(ohlcv) ? ohlcv.slice(-limit) : [],
    trades: {
      hasMore: trades.hasMore,
      nextCursor: trades.nextCursor,
      rows: trades.trades.slice(0, Math.min(limit, 25)).map((trade) => ({
        id: trade.id,
        eventName: trade.eventName,
        account: trade.account,
        timestamp: trade.timestamp,
        transactionHash: trade.transactionHash,
        marketAddress: trade.marketAddress,
        isLong: trade.isLong,
        sizeDeltaUsd: usdBigIntToNumber(trade.sizeDeltaUsd),
        pnlUsd: usdBigIntToNumber(trade.pnlUsd),
        priceImpactUsd: usdBigIntToNumber(trade.priceImpactUsd),
      })),
    },
    evidence: {
      source: "GMX API + GMX SDK v2",
      fields: ["markets/info", "rates", "apy", "performance", "ohlcv", "trades"],
      resolutionUse:
        "Use the marketTokenAddress, latest rate snapshot, hourly OHLCV candles, and recent trade timestamps as cited settlement evidence.",
    },
    sourceUrl: `https://app.gmx.io/#/trade?chain=${chainId}`,
  };
}

async function fetchGmxMarketsInfoSnapshot(apiUrl: string) {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/markets/info`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GMX markets/info failed with ${response.status}`);
  }
  const body = (await response.json()) as { markets?: GmxMarketInfoRow[] } | GmxMarketInfoRow[];
  const rows = Array.isArray(body) ? body : Array.isArray(body.markets) ? body.markets : [];
  const markets: GmxMarket[] = rows.map((row) => ({
    name: row.name ?? row.symbol,
    symbol: row.symbol ?? row.name,
    marketTokenAddress: row.marketTokenAddress ?? row.marketToken,
    indexTokenAddress: row.indexTokenAddress ?? row.indexToken,
    longTokenAddress: row.longTokenAddress ?? row.longToken,
    shortTokenAddress: row.shortTokenAddress ?? row.shortToken,
    isListed: row.isListed,
  }));
  const tickers: GmxMarketTicker[] = rows.map((row) => ({
    symbol: row.symbol ?? row.name,
    marketTokenAddress: row.marketTokenAddress ?? row.marketToken,
    poolAmountLongUsd: toOptionalBigInt(row.availableLiquidityLong),
    poolAmountShortUsd: toOptionalBigInt(row.availableLiquidityShort),
    longInterestUsd: toOptionalBigInt(row.openInterestLong),
    shortInterestUsd: toOptionalBigInt(row.openInterestShort),
    fundingRateLong: toOptionalBigInt(row.fundingRateLong),
    fundingRateShort: toOptionalBigInt(row.fundingRateShort),
  }));
  return { markets, tickers };
}

// Reduce a free-form symbol ("BTC/USD [WBTC-USDC]", "eth", "SOL") to its base
// ticker for matching against a market-page heuristic symbol.
function normalizeGmxBase(symbol?: string): string {
  if (!symbol) return "";
  const head = symbol.trim().toUpperCase().split(/[/\s\-[]/)[0];
  return head.replace(/[^A-Z0-9]/g, "");
}

// GMX funding factor is a per-second, 1e30-scaled rate. Annualize to a %.
// Hide implausible magnitudes (|APR| > 1000%) rather than show a number that
// likely reflects a scaling mismatch.
function gmxFundingApr(rate?: bigint): number | undefined {
  if (rate === undefined) return undefined;
  const perSecond = Number(rate) / 1e30;
  if (!Number.isFinite(perSecond)) return undefined;
  const apr = perSecond * 31_536_000 * 100;
  if (!Number.isFinite(apr) || Math.abs(apr) > 1000) return undefined;
  return Number(apr.toFixed(2));
}

// Generate prediction-market candidates from live GMX market intelligence.
// Each GMX market yields up to three distinct markets, each resolvable by a
// single factual check against the GMX API field at the deadline:
//   1. liquidity  — pool depth stays above a threshold
//   2. OI balance — long open interest stays above short open interest
//   3. funding    — long funding rate stays non-negative
// We frame every question as a check on a named API field so resolution is
// unambiguous regardless of how GMX renders the value in its own UI.
export async function buildGmxImportCandidates(limit = 8): Promise<ImportCandidateDraft[]> {
  const summary = await fetchGmxMarkets(limit);
  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const sourceUrl = `https://app.gmx.io/#/pools?chain=${summary.chainId}`;
  const drafts: ImportCandidateDraft[] = [];

  for (const market of summary.markets) {
    const marketLabel = market.symbol ?? market.name;
    const addr = market.marketTokenAddress;
    const tokenAddress = addr ?? marketLabel;
    const ticker = market.ticker;
    const addrLine = addr ? `marketTokenAddress: ${addr}` : "";

    const mk = (
      kind: string,
      over: { title: string; question: string; description: string; resolutionCriteria: string; confidence: number },
    ): ImportCandidateDraft => ({
      id: stableSponsorId(`gmx:${kind}:${summary.chainId}:${tokenAddress}`),
      sourceId: "gmx",
      sourceUrl,
      sourcePublishedAtIso: now,
      eventDateIso: deadline,
      category: "crypto",
      oracleType: "zktls-ai-oracle",
      asset: "USDC",
      deadlineIso: deadline,
      status: "needs_review",
      riskFlags: addr ? [] : ["source_url_missing"],
      ...over,
    });

    // 1) Liquidity-depth market.
    const totalLiquidityUsd = Number(ticker?.totalLiquidityUsd ?? 0);
    const thresholdUsd = totalLiquidityUsd > 0 ? Math.max(100_000, Math.floor(totalLiquidityUsd * 0.5)) : 100_000;
    drafts.push(
      mk("liquidity", {
        title: `GMX ${marketLabel} liquidity market`,
        question: `Will GMX ${marketLabel} keep at least ${formatUsd(thresholdUsd)} listed pool liquidity for the next 7 days?`,
        description: [
          `Generated from live GMX market metadata on chain ${summary.chainId}.`,
          addr ? `Market token: ${addr}.` : "",
          totalLiquidityUsd > 0 ? `Current listed pool liquidity is about ${formatUsd(totalLiquidityUsd)}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
        resolutionCriteria: [
          `Resolve YES if the GMX API for chain ${summary.chainId} lists ${marketLabel} as an active market and reports at least ${thresholdUsd} USD total pool liquidity before the deadline.`,
          "Use the marketTokenAddress as the primary identifier.",
          addrLine,
          "Resolve NO if the market is delisted, absent from the GMX API, or reported liquidity is below the threshold at resolution time.",
        ]
          .filter(Boolean)
          .join("\n"),
        confidence: addr ? 0.82 : 0.64,
      }),
    );

    // 2) Open-interest-imbalance market (needs both sides reported).
    const oiLong = Number(ticker?.openInterestLongUsd ?? 0);
    const oiShort = Number(ticker?.openInterestShortUsd ?? 0);
    if (addr && oiLong > 0 && oiShort > 0) {
      const leader = oiLong >= oiShort ? "long" : "short";
      drafts.push(
        mk("oi", {
          title: `GMX ${marketLabel} open-interest imbalance`,
          question: `Will GMX ${marketLabel} long open interest still exceed short open interest in 7 days?`,
          description:
            `Generated from live GMX open interest on chain ${summary.chainId}. ` +
            `Current long OI ${formatUsd(oiLong)} vs short OI ${formatUsd(oiShort)} (${leader} leads).`,
          resolutionCriteria: [
            `Resolve YES if the GMX API for chain ${summary.chainId} reports longInterestUsd greater than shortInterestUsd for ${marketLabel} at the deadline.`,
            addrLine,
            "Resolve NO if short open interest is greater than or equal to long, or the market is delisted/absent at resolution time.",
          ]
            .filter(Boolean)
            .join("\n"),
          confidence: 0.8,
        }),
      );
    }

    // 3) Funding-direction market (needs a plausible funding estimate).
    const fundingLong = ticker?.fundingLongAprEstimate;
    if (addr && fundingLong !== undefined) {
      drafts.push(
        mk("funding", {
          title: `GMX ${marketLabel} funding direction`,
          question: `Will GMX ${marketLabel} report a non-negative long funding rate in 7 days?`,
          description:
            `Generated from live GMX funding on chain ${summary.chainId}. ` +
            `Current long funding is about ${fundingLong.toFixed(2)}% est. APR.`,
          resolutionCriteria: [
            `Resolve YES if the GMX API for chain ${summary.chainId} reports a non-negative fundingRateLong for ${marketLabel} at the deadline.`,
            addrLine,
            "Resolve NO if fundingRateLong is negative, or the market is delisted/absent at resolution time.",
          ]
            .filter(Boolean)
            .join("\n"),
          confidence: 0.74,
        }),
      );
    }
  }

  return drafts;
}

// Curated tokenized-equity universe for Robinhood Chain RWA markets. Strikes
// are ROUND TEMPLATE levels, not live quotes — there is no stock price feed in
// this codebase, so every candidate is flagged `strike_template` and left as
// needs_review for an admin to confirm against the real quote before deploy.
const RWA_EQUITIES: Array<{ symbol: string; name: string; venue: string; strike: number }> = [
  { symbol: "AAPL", name: "Apple", venue: "NASDAQ", strike: 250 },
  { symbol: "TSLA", name: "Tesla", venue: "NASDAQ", strike: 350 },
  { symbol: "NVDA", name: "NVIDIA", venue: "NASDAQ", strike: 170 },
  { symbol: "MSFT", name: "Microsoft", venue: "NASDAQ", strike: 480 },
  { symbol: "GOOGL", name: "Alphabet", venue: "NASDAQ", strike: 200 },
  { symbol: "AMZN", name: "Amazon", venue: "NASDAQ", strike: 230 },
];

// Generate RWA / tokenized-stock prediction-market candidates for Robinhood
// Chain. Equity markets ask whether a tokenized stock closes above a template
// strike; one venue-level market asks about tokenized-RWA settlement volume.
// All are needs_review drafts (admin confirms strike + deadline before deploy).
export function buildRwaImportCandidates(limit = 8): ImportCandidateDraft[] {
  const eventDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const volumeDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const drafts: ImportCandidateDraft[] = [];

  const equityCount = Math.max(1, Math.min(limit - 1, RWA_EQUITIES.length));
  for (const equity of RWA_EQUITIES.slice(0, equityCount)) {
    const quoteUrl = `https://www.google.com/finance/quote/${equity.symbol}:${equity.venue}`;
    drafts.push({
      id: stableSponsorId(`rwa:equity:${equity.symbol}`),
      sourceId: "rwa",
      title: `Tokenized ${equity.name} (${equity.symbol}) close`,
      sourceUrl: quoteUrl,
      sourcePublishedAtIso: now,
      eventDateIso: eventDate,
      category: "stocks",
      question: `Will tokenized ${equity.name} (${equity.symbol}) close above $${equity.strike} on the event date?`,
      description:
        `Robinhood Chain RWA market on tokenized ${equity.name}. ` +
        `The $${equity.strike} strike is a ROUND TEMPLATE level, not a live quote — ` +
        `confirm the current price and adjust the strike before deploying.`,
      oracleType: "zktls-ai-oracle",
      asset: "USDC",
      deadlineIso: eventDate,
      resolutionCriteria: [
        `Resolve YES if the official ${equity.venue} closing price for ${equity.symbol} on the event date is strictly above $${equity.strike}.`,
        `Cite the closing quote from a public source (e.g. ${quoteUrl}).`,
        "Resolve NO if the close is at or below the strike. If markets are closed on the event date, use the next trading day's close.",
      ].join("\n"),
      confidence: 0.6,
      status: "needs_review",
      riskFlags: ["strike_template"],
    });
  }

  drafts.push({
    id: stableSponsorId("rwa:volume:rhc"),
    sourceId: "rwa",
    title: "Robinhood Chain RWA volume",
    sourceUrl: "https://robinhood.com/",
    sourcePublishedAtIso: now,
    eventDateIso: volumeDeadline,
    category: "soft",
    question: "Will Robinhood Chain tokenized-RWA settlement volume exceed $10M over the next 30 days?",
    description:
      "Venue-level traction market on Robinhood Chain RWA settlement volume. " +
      "Resolve from on-chain settlement data (Adjudex indexer / Dune) for the RHC chain id.",
    oracleType: "zktls-ai-oracle",
    asset: "USDC",
    deadlineIso: volumeDeadline,
    resolutionCriteria: [
      "Resolve YES if total tokenized-RWA settlement volume on Robinhood Chain over the 30-day window exceeds $10,000,000 USD.",
      "Use the Adjudex indexer totals for the RHC chain id (or an equivalent public Dune query) as the volume source.",
      "Resolve NO if volume is at or below $10M at the deadline.",
    ].join("\n"),
    confidence: 0.55,
    status: "needs_review",
    riskFlags: ["threshold_template"],
  });

  return drafts;
}

function configuredGmxChainId(): ContractsChainId {
  const chainId = Number(process.env.GMX_CHAIN_ID ?? "42161");
  if (GMX_SUPPORTED_CHAIN_IDS.has(chainId as ContractsChainId)) return chainId as ContractsChainId;
  return 42161;
}

function toOptionalBigInt(value: string | number | bigint | undefined): bigint | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function defaultGmxApiUrl(chainId: ContractsChainId) {
  if (chainId === 421614) return "https://arbitrum-sepolia-api.gmxinfra.io";
  if (chainId === 43114) return "https://avalanche-api.gmxinfra.io";
  if (chainId === 43113) return "https://avalanche-fuji-api.gmxinfra.io";
  return "https://arbitrum-api.gmxinfra.io";
}

function duneSummaryConfig() {
  const apiKey = process.env.DUNE_API_KEY?.trim();
  const queryId = process.env.DUNE_ADJUDEX_SUMMARY_QUERY_ID?.trim();
  if (!apiKey || !queryId) return null;
  return {
    apiKey,
    queryId,
    baseUrl: (process.env.DUNE_API_BASE_URL ?? "https://api.dune.com/api/v1").replace(/\/$/, ""),
  };
}

function duneHeaders(apiKey: string) {
  return {
    "X-Dune-API-Key": apiKey,
    "Content-Type": "application/json",
  };
}

function selectorFor(signature: string) {
  return keccak256(toBytes(signature)).slice(0, 10);
}

function positiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function stableSponsorId(input: string): string {
  return `imp-${keccak256(toBytes(input)).slice(2, 18)}`;
}

function tickerForResponse(ticker?: GmxMarketTicker) {
  if (!ticker) return undefined;
  const totalLiquidityUsd =
    usdBigIntToNumber(ticker.poolAmountLongUsd) + usdBigIntToNumber(ticker.poolAmountShortUsd);
  const openInterestLongUsd = usdBigIntToNumber(ticker.longInterestUsd);
  const openInterestShortUsd = usdBigIntToNumber(ticker.shortInterestUsd);
  return {
    symbol: ticker.symbol,
    totalLiquidityUsd,
    openInterestUsd: openInterestLongUsd + openInterestShortUsd,
    openInterestLongUsd,
    openInterestShortUsd,
    fundingLongAprEstimate: gmxFundingApr(ticker.fundingRateLong),
    fundingShortAprEstimate: gmxFundingApr(ticker.fundingRateShort),
    priceChangePercent24h:
      ticker.priceChangePercent24hBps === undefined ? undefined : Number(ticker.priceChangePercent24hBps) / 100,
  };
}

function usdBigIntToNumber(value?: bigint) {
  if (value === undefined) return 0;
  return Number(value / 1_000_000_000_000_000_000_000_000_000_000n);
}

function formatUsd(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
