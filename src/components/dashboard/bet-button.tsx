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

  const colors = isYes
    ? "bg-[#10b981] text-black hover:bg-[#0ea674] hover:shadow-[0_0_14px_rgba(16,185,129,0.30),inset_0_1px_0_rgba(255,255,255,0.18)]"
    : "bg-[#ef4444] text-white hover:bg-[#dc2626] hover:shadow-[0_0_14px_rgba(239,68,68,0.30),inset_0_1px_0_rgba(255,255,255,0.16)]";

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
