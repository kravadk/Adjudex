import { defineChain, type Address, type Chain, isAddress } from "viem";
import { arbitrum, arbitrumSepolia, base, optimism, polygon } from "wagmi/chains";

const DEFAULT_RHC_CHAIN_ID = 46630;

// NEXT_PUBLIC_* vars must be accessed STATICALLY so Next.js/Turbopack
// can inline them into the browser bundle at build time. Dynamic
// `process.env[name]` lookups are NOT inlined and return undefined on
// the client. We build a static lookup map and route all NEXT_PUBLIC_*
// reads through it. Server-only vars keep using the dynamic path.
const PUBLIC_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_BACKEND: process.env.NEXT_PUBLIC_BACKEND,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL:
    process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL,
  NEXT_PUBLIC_ALCHEMY_ARBITRUM_SEPOLIA_API_KEY:
    process.env.NEXT_PUBLIC_ALCHEMY_ARBITRUM_SEPOLIA_API_KEY,
  NEXT_PUBLIC_MARKET_FACTORY_ADDRESS:
    process.env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS,
  NEXT_PUBLIC_REPUTATION_ORACLE_ADDRESS:
    process.env.NEXT_PUBLIC_REPUTATION_ORACLE_ADDRESS,
  NEXT_PUBLIC_STAKE_TOKEN_ADDRESS: process.env.NEXT_PUBLIC_STAKE_TOKEN_ADDRESS,
  NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS:
    process.env.NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS,
  NEXT_PUBLIC_PROOF_ANCHOR_ADDRESS:
    process.env.NEXT_PUBLIC_PROOF_ANCHOR_ADDRESS,
  NEXT_PUBLIC_PRICE_ORACLE_ADDRESS:
    process.env.NEXT_PUBLIC_PRICE_ORACLE_ADDRESS,
  NEXT_PUBLIC_TOKENIZED_STOCK_ADAPTER_ADDRESS:
    process.env.NEXT_PUBLIC_TOKENIZED_STOCK_ADAPTER_ADDRESS,
  NEXT_PUBLIC_RHC_CHAIN_ID: process.env.NEXT_PUBLIC_RHC_CHAIN_ID,
  NEXT_PUBLIC_RHC_RPC_URL: process.env.NEXT_PUBLIC_RHC_RPC_URL,
  NEXT_PUBLIC_ALCHEMY_RHC_API_KEY: process.env.NEXT_PUBLIC_ALCHEMY_RHC_API_KEY,
  NEXT_PUBLIC_RHC_EXPLORER_URL: process.env.NEXT_PUBLIC_RHC_EXPLORER_URL,
  NEXT_PUBLIC_RHC_MARKET_FACTORY_ADDRESS:
    process.env.NEXT_PUBLIC_RHC_MARKET_FACTORY_ADDRESS,
  NEXT_PUBLIC_ONCHAIN_CHAIN_ID: process.env.NEXT_PUBLIC_ONCHAIN_CHAIN_ID,
  NEXT_PUBLIC_ONCHAIN_RPC_URL: process.env.NEXT_PUBLIC_ONCHAIN_RPC_URL,
  NEXT_PUBLIC_ONCHAIN_MARKET_FACTORY_ADDRESS:
    process.env.NEXT_PUBLIC_ONCHAIN_MARKET_FACTORY_ADDRESS,
  NEXT_PUBLIC_ONCHAIN_ONE_HOUR_BLOCKS:
    process.env.NEXT_PUBLIC_ONCHAIN_ONE_HOUR_BLOCKS,
};

function readEnv(name: string): string | undefined {
  // Route NEXT_PUBLIC_* through the static map so Webpack/Turbopack
  // can inline the value into the browser bundle. Other env vars use
  // a dynamic lookup which only works server-side.
  const raw = name.startsWith("NEXT_PUBLIC_")
    ? PUBLIC_ENV[name]
    : process.env[name];
  const value = raw?.trim();
  return value ? value : undefined;
}

function readNumberEnv(name: string): number | undefined {
  const value = readEnv(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readAddressEnv(name: string): Address | undefined {
  const value = readEnv(name);
  if (!value) return undefined;
  if (!isAddress(value)) {
    throw new Error(`${name} must be a valid EVM address.`);
  }
  if (value.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new Error(`${name} cannot be the zero address.`);
  }
  return value as Address;
}

export function getRhcChainId(): number {
  return (
    readNumberEnv("NEXT_PUBLIC_RHC_CHAIN_ID") ??
    readNumberEnv("RHC_CHAIN_ID") ??
    DEFAULT_RHC_CHAIN_ID
  );
}

export function alchemyPublicRpcUrl(
  network: "arb-sepolia" | "arb-mainnet" | "robinhood-testnet",
  apiKey?: string,
): string | undefined {
  return apiKey ? `https://${network}.g.alchemy.com/v2/${apiKey}` : undefined;
}

export function getPublicArbitrumSepoliaRpcUrl(): string | undefined {
  return (
    readEnv("NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL") ??
    alchemyPublicRpcUrl("arb-sepolia", readEnv("NEXT_PUBLIC_ALCHEMY_ARBITRUM_SEPOLIA_API_KEY"))
  );
}

export function getPublicRhcRpcUrl(): string | undefined {
  return (
    readEnv("NEXT_PUBLIC_RHC_RPC_URL") ??
    alchemyPublicRpcUrl("robinhood-testnet", readEnv("NEXT_PUBLIC_ALCHEMY_RHC_API_KEY"))
  );
}

const rhcPublicRpcUrl = getPublicRhcRpcUrl();

export const robinhoodChainTestnet = defineChain({
  id: getRhcChainId(),
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: rhcPublicRpcUrl ? [rhcPublicRpcUrl] : [],
    },
  },
  blockExplorers: {
    default: {
      name: "Explorer",
      url: readEnv("NEXT_PUBLIC_RHC_EXPLORER_URL") ?? "",
    },
  },
  testnet: true,
});

export type DirectOnchainConfig = {
  chain: Chain;
  chainId: number;
  rpcUrl: string;
  factoryAddress: Address;
};

function chainFor(chainId: number, rpcUrl: string): Chain {
  if (chainId === arbitrum.id) return arbitrum;
  if (chainId === arbitrumSepolia.id) return arbitrumSepolia;
  // S5.B multi-chain expansion. Block times: Base/Optimism ~2s,
  // Polygon ~2s. Lookback math handled in getConfiguredOneHourLookbackBlocks.
  if (chainId === base.id) return base;
  if (chainId === optimism.id) return optimism;
  if (chainId === polygon.id) return polygon;
  if (chainId === robinhoodChainTestnet.id) return robinhoodChainTestnet;

  return defineChain({
    id: chainId,
    name: `Configured Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

function explicitDirectConfig(serviceName: string): DirectOnchainConfig | null {
  const chainId = readNumberEnv("NEXT_PUBLIC_ONCHAIN_CHAIN_ID");
  const rpcUrl = readEnv("NEXT_PUBLIC_ONCHAIN_RPC_URL");
  const factoryAddress = readAddressEnv("NEXT_PUBLIC_ONCHAIN_MARKET_FACTORY_ADDRESS");

  if (!chainId && !rpcUrl && !factoryAddress) return null;
  if (!chainId || !rpcUrl || !factoryAddress) {
    throw new Error(
      `${serviceName} requires NEXT_PUBLIC_ONCHAIN_CHAIN_ID, NEXT_PUBLIC_ONCHAIN_RPC_URL, and NEXT_PUBLIC_ONCHAIN_MARKET_FACTORY_ADDRESS when any explicit on-chain override is set.`,
    );
  }

  return {
    chain: chainFor(chainId, rpcUrl),
    chainId,
    rpcUrl,
    factoryAddress,
  };
}

export function resolveDirectOnchainConfig(serviceName: string): DirectOnchainConfig {
  const explicit = explicitDirectConfig(serviceName);
  if (explicit) return explicit;

  const rhcRpcUrl = getPublicRhcRpcUrl();
  const rhcFactoryAddress = readAddressEnv("NEXT_PUBLIC_RHC_MARKET_FACTORY_ADDRESS");
  if (rhcRpcUrl || rhcFactoryAddress) {
    if (!rhcRpcUrl || !rhcFactoryAddress) {
      throw new Error(
        `${serviceName} detected RHC configuration. Set NEXT_PUBLIC_RHC_RPC_URL or NEXT_PUBLIC_ALCHEMY_RHC_API_KEY, plus NEXT_PUBLIC_RHC_MARKET_FACTORY_ADDRESS, or set the NEXT_PUBLIC_ONCHAIN_* variables explicitly.`,
      );
    }
    const chainId = getRhcChainId();
    return {
      chain: chainFor(chainId, rhcRpcUrl),
      chainId,
      rpcUrl: rhcRpcUrl,
      factoryAddress: rhcFactoryAddress,
    };
  }

  const rpcUrl = getPublicArbitrumSepoliaRpcUrl();
  const factoryAddress = readAddressEnv("NEXT_PUBLIC_MARKET_FACTORY_ADDRESS");
  if (!rpcUrl || !factoryAddress) {
    throw new Error(
      `${serviceName} requires an explicit direct on-chain RPC and factory. Set NEXT_PUBLIC_ONCHAIN_* for the active chain, or configure the legacy Arbitrum Sepolia RPC/factory pair.`,
    );
  }

  return {
    chain: arbitrumSepolia,
    chainId: arbitrumSepolia.id,
    rpcUrl,
    factoryAddress,
  };
}

export function getConfiguredOneHourLookbackBlocks(chainId: number): bigint | null {
  const explicit = readNumberEnv("NEXT_PUBLIC_ONCHAIN_ONE_HOUR_BLOCKS");
  if (explicit) return BigInt(explicit);
  // Arbitrum One and Arbitrum Sepolia both target ~250ms blocks ⇒ ~14_400
  // blocks per hour. Other chains must set NEXT_PUBLIC_ONCHAIN_ONE_HOUR_BLOCKS.
  if (chainId === arbitrumSepolia.id) return 14_400n;
  if (chainId === arbitrum.id) return 14_400n;
  // Base / Optimism / Polygon: ~2s block time ⇒ ~1_800 blocks per hour.
  if (chainId === base.id) return 1_800n;
  if (chainId === optimism.id) return 1_800n;
  if (chainId === polygon.id) return 1_800n;
  return null;
}

// Multi-chain registry (S5.B). Public list of chains we ship indexer +
// frontend support for. Used by chain switcher UI to render selectable
// options without hard-coding everywhere. Sepolia stays opt-in (dev only).
export const SUPPORTED_CHAINS = [
  { id: arbitrum.id, slug: "arbitrum", label: "Arbitrum One", primary: true },
  { id: base.id, slug: "base", label: "Base" },
  { id: optimism.id, slug: "optimism", label: "Optimism" },
  { id: polygon.id, slug: "polygon", label: "Polygon" },
  { id: arbitrumSepolia.id, slug: "arbitrum-sepolia", label: "Arbitrum Sepolia (dev)", testnet: true },
] as const;

export function supportedChainBySlug(slug: string) {
  return SUPPORTED_CHAINS.find((c) => c.slug === slug) ?? null;
}

export function supportedChainById(chainId: number) {
  return SUPPORTED_CHAINS.find((c) => c.id === chainId) ?? null;
}

export function parseContractMarketId(marketId: string): bigint {
  const raw = marketId.split(":").at(-1);
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error(`Market id ${marketId} is not a contract market id.`);
  }
  return BigInt(raw);
}

export function displayMarketIdForChain(chainId: number, contractMarketId: bigint | string): string {
  const raw = String(contractMarketId);
  return chainId === arbitrumSepolia.id ? raw : `${chainId}:${raw}`;
}
