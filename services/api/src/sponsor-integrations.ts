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
        "Set DUNE_API_KEY and DUNE_ADJUDEX_SUMMARY_QUERY_ID for live dashboard data.",
      ],
    },
    {
      id: "gmx",
      name: "GMX",
      used: true,
      configured: true,
      evidence: [
        "@gmx-io/sdk is installed and used by /api/integrations/gmx/markets.",
        `GMX chain id defaults to ${configuredGmxChainId()}.`,
      ],
    },
    {
      id: "openzeppelin",
      name: "OpenZeppelin",
      used: true,
      configured: true,
      evidence: [
        "Contracts import @openzeppelin/contracts ERC20, IERC20, Ownable, and ReentrancyGuard.",
        "TestUSDC uses ERC20; ProofAnchor and TokenizedStockAdapter use Ownable transferOwnership.",
        "ParimutuelPool uses OpenZeppelin ReentrancyGuard for bet, resolve, claim, and refund paths.",
      ],
    },
    {
      id: "aws",
      name: "AWS",
      used: true,
      configured: Boolean(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION),
      evidence: [
        "AWS App Runner blueprints live in infra/aws/apprunner-api.yaml and infra/aws/apprunner-web.yaml.",
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
    compileCommand: `pnpm add -D ${packageName} && solc/contracts toolchain with Fhenix import remapping`,
    capabilities: [
      "encrypted YES/NO amount inputs",
      "per-wallet encrypted position storage",
      "resolver-triggered public total reveal after deadline",
    ],
  };
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
  const { GmxApiSdk } = await import("@gmx-io/sdk/v2");
  const chainId = configuredGmxChainId();
  const apiUrl = process.env.GMX_API_URL?.trim() || defaultGmxApiUrl(chainId);
  const sdk = new GmxApiSdk({ chainId, apiUrl });
  const markets = (await sdk.fetchMarkets()) as GmxMarket[];
  const addresses = markets
    .map((market) => market.marketTokenAddress)
    .filter((address): address is string => Boolean(address))
    .slice(0, Math.max(1, Math.min(limit, 50)));
  const tickers = addresses.length
    ? ((await sdk.fetchMarketsTickers({ addresses }).catch(() => [])) as GmxMarketTicker[])
    : [];
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

export async function buildGmxImportCandidates(limit = 8): Promise<ImportCandidateDraft[]> {
  const summary = await fetchGmxMarkets(limit);
  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return summary.markets.map((market) => {
    const marketLabel = market.symbol ?? market.name;
    const tokenAddress = market.marketTokenAddress ?? marketLabel;
    const sourceUrl = `https://app.gmx.io/#/pools?chain=${summary.chainId}`;
    const totalLiquidityUsd = Number(market.ticker?.totalLiquidityUsd ?? 0);
    const thresholdUsd = totalLiquidityUsd > 0 ? Math.max(100_000, Math.floor(totalLiquidityUsd * 0.5)) : 100_000;
    const resolutionCriteria = [
      `Resolve YES if the GMX API for chain ${summary.chainId} lists ${marketLabel} as an active market and reports at least ${thresholdUsd} USD total pool liquidity before the deadline.`,
      "Use the marketTokenAddress as the primary identifier.",
      market.marketTokenAddress ? `marketTokenAddress: ${market.marketTokenAddress}` : "",
      "Resolve NO if the market is delisted, absent from the GMX API, or reported liquidity is below the threshold at resolution time.",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      id: stableSponsorId(`gmx:${summary.chainId}:${tokenAddress}`),
      sourceId: "gmx",
      title: `GMX ${marketLabel} liquidity market`,
      sourceUrl,
      sourcePublishedAtIso: new Date().toISOString(),
      eventDateIso: deadline,
      category: "crypto",
      question: `Will GMX ${marketLabel} keep at least ${formatUsd(thresholdUsd)} listed pool liquidity for the next 7 days?`,
      description: [
        `Generated from live GMX market metadata on chain ${summary.chainId}.`,
        market.marketTokenAddress ? `Market token: ${market.marketTokenAddress}.` : "",
        market.ticker?.totalLiquidityUsd ? `Current listed pool liquidity is about ${formatUsd(market.ticker.totalLiquidityUsd)}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      oracleType: "zktls-ai-oracle",
      asset: "USDC",
      deadlineIso: deadline,
      resolutionCriteria,
      confidence: market.marketTokenAddress ? 0.82 : 0.64,
      status: "needs_review",
      riskFlags: market.marketTokenAddress ? [] : ["source_url_missing"],
    };
  });
}

function configuredGmxChainId(): ContractsChainId {
  const chainId = Number(process.env.GMX_CHAIN_ID ?? "42161");
  if (GMX_SUPPORTED_CHAIN_IDS.has(chainId as ContractsChainId)) return chainId as ContractsChainId;
  return 42161;
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
  return {
    symbol: ticker.symbol,
    totalLiquidityUsd,
    openInterestUsd:
      usdBigIntToNumber(ticker.longInterestUsd) + usdBigIntToNumber(ticker.shortInterestUsd),
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
