import {
  SiMeta,
  SiNba,
  SiDogecoin,
  SiSolana,
  SiGoogle,
  SiApple,
  SiTesla,
  SiNvidia,
  SiBitcoin,
  SiEthereum,
  SiLitecoin,
  SiRobinhood,
} from "@icons-pack/react-simple-icons";
import type { AssetClass } from "@/lib/market-view";

type Props = {
  ticker: string;
  assetClass: AssetClass;
  size?: 20 | 24 | 28 | 32 | 40;
  className?: string;
};

const BRAND_MAP: Record<
  string,
  React.ComponentType<{ size?: number; color?: string }>
> = {
  META: SiMeta,
  GSW: SiNba,
  DOGE: SiDogecoin,
  SOL: SiSolana,
  // Tokenized equities
  GOOGL: SiGoogle,
  GOOG: SiGoogle,
  AAPL: SiApple,
  TSLA: SiTesla,
  NVDA: SiNvidia,
  // Crypto / GMX underlyings
  BTC: SiBitcoin,
  WBTC: SiBitcoin,
  ETH: SiEthereum,
  WETH: SiEthereum,
  LTC: SiLitecoin,
  // Robinhood Chain RWA markets
  RWA: SiRobinhood,
};

// Per-asset-class gradient so a ticker chip reads as intentional, not a gray
// placeholder box. Sports uses the lime brand accent (dark text); the rest use
// distinct dark gradients.
const ASSET_GRADIENT: Record<string, string> = {
  crypto: "linear-gradient(135deg,#3b6ffa,#16245e)",
  stocks: "linear-gradient(135deg,#10b981,#064e3b)",
  sports: "linear-gradient(135deg,#d9ff00,#7a8c00)",
  esports: "linear-gradient(135deg,#a855f7,#5b21b6)",
  soft: "linear-gradient(135deg,#5b6472,#222831)",
};

export function AssetLogo({
  ticker,
  assetClass,
  size = 24,
  className = "",
}: Props) {
  const Brand = BRAND_MAP[ticker];
  const box = { width: size + 8, height: size + 8 } as const;
  const gradient = ASSET_GRADIENT[assetClass] ?? ASSET_GRADIENT.soft;
  const darkText = assetClass === "sports";
  const fg = darkText ? "#0a0a0a" : "#ffffff";
  const wrap = `inline-flex items-center justify-center flex-shrink-0 rounded-md border border-white/10 ${className}`;
  const label = `${ticker} (${assetClass})`;

  if (Brand) {
    return (
      <span className={wrap} style={{ ...box, background: gradient }} aria-label={label} title={label}>
        <Brand size={size} color={fg} />
      </span>
    );
  }
  return (
    <span
      className={`${wrap} font-mono tabular-nums text-[10.5px] font-bold tracking-wider`}
      style={{ ...box, background: gradient, color: fg }}
      aria-label={label}
      title={label}
    >
      {ticker.slice(0, 3)}
    </span>
  );
}
