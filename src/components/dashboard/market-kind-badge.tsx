import type { MarketKind } from "@/lib/types/domain";

// Small visual chip for sub-market kinds (S4.E). Hidden for the default
// moneyline kind so existing market cards stay visually clean.
//
// kind = "handicap" | "totals" | "prop" — anything other than "moneyline"
// gets a tinted chip in the card header so the user knows this is a
// derivative of a parent moneyline market.

const KIND_COPY: Record<Exclude<MarketKind, "moneyline">, { label: string; color: string }> = {
  handicap: { label: "Handicap", color: "rgb(168, 85, 247)" },   // violet
  totals:   { label: "Totals",   color: "rgb(245, 158, 11)" },   // amber
  prop:     { label: "Prop",     color: "rgb(34, 197, 94)" },    // green
};

export function MarketKindBadge({ kind }: { kind?: MarketKind | null }) {
  if (!kind || kind === "moneyline") return null;
  const copy = KIND_COPY[kind];
  if (!copy) return null;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-[0.06em]"
      style={{
        background: `${copy.color}1A`,
        color: copy.color,
        border: `1px solid ${copy.color}3F`,
      }}
    >
      {copy.label}
    </span>
  );
}
