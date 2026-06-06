import Link from "next/link";

type Props = {
  variant: "yes" | "no";
  size?: "md" | "lg" | "xl";
  price?: number;
  multiplier?: number;
  label?: string;
  href?: string;
  onClick?: () => void;
};

export function BetButton({
  variant,
  size = "md",
  price,
  multiplier,
  label,
  href,
  onClick,
}: Props) {
  const isYes = variant === "yes";
  const heights = { md: "h-8", lg: "h-9", xl: "h-11" } as const;
  const fonts = {
    md: "text-[10.5px]",
    lg: "text-[11px]",
    xl: "text-[12.5px]",
  } as const;
  const padding = { md: "px-2.5", lg: "px-3", xl: "px-4" } as const;

  // Brand palette: YES = lime accent, NO = electric blue (not generic green/red).
  const colors = isYes
    ? "bg-[#d9ff00] text-black hover:bg-[#c7eb00] hover:shadow-[0_0_16px_rgba(217,255,0,0.35),inset_0_1px_0_rgba(255,255,255,0.25)]"
    : "bg-[#3b6ffa] text-white hover:bg-[#2f5fe0] hover:shadow-[0_0_16px_rgba(59,111,250,0.40),inset_0_1px_0_rgba(255,255,255,0.18)]";

  const cls = `
    ${heights[size]} ${padding[size]} ${fonts[size]}
    inline-flex items-center justify-between gap-2 w-full
    rounded-[5px] font-bold uppercase tracking-wider
    transition-all active:scale-[0.97]
    shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]
    ${colors}
  `;

  const content = (
    <>
      <span>{label || `Bet ${isYes ? "YES" : "NO"}`}</span>
      {(price !== undefined || multiplier !== undefined) && (
        <span className="font-mono tabular-nums font-semibold normal-case tracking-normal opacity-95">
          {price !== undefined ? `$${price.toFixed(2)}` : ""}
          {price !== undefined && multiplier !== undefined ? " · " : ""}
          {multiplier !== undefined ? `${multiplier.toFixed(2)}×` : ""}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cls}>
        {content}
      </Link>
    );
  }
  return (
    <button className={cls} onClick={onClick}>
      {content}
    </button>
  );
}
