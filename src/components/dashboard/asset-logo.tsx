import { SiMeta, SiNba, SiDogecoin, SiSolana } from "@icons-pack/react-simple-icons";
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
};

export function AssetLogo({
  ticker,
  assetClass,
  size = 24,
  className = "",
}: Props) {
  const Brand = BRAND_MAP[ticker];
  const box = { width: size + 8, height: size + 8 };
  const wrap = `inline-flex items-center justify-center flex-shrink-0 rounded-md bg-[#1c1c1c] border border-[#2a2a2a] ${className}`;
  const label = `${ticker} (${assetClass})`;

  if (Brand) {
    return (
      <span className={wrap} style={box} aria-label={label} title={label}>
        <Brand size={size} color="#e5e5e5" />
      </span>
    );
  }
  return (
    <span
      className={`${wrap} font-mono tabular-nums text-[10.5px] font-semibold text-gray-300 tracking-wider`}
      style={box}
      aria-label={label}
      title={label}
    >
      {ticker.slice(0, 3)}
    </span>
  );
}
