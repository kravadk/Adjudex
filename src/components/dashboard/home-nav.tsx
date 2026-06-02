"use client";

import { ArrowDownNarrowWide, BarChart3 } from "lucide-react";

// Foresee-style two-row top nav for /. Hero pills row (curated tabs)
// above a sub-category strip with active-underline + sort control.

export type HomeNavCategory = "all" | "stocks" | "crypto" | "sports" | "esports" | "soft";
export type HomeNavTab = "discover" | "esports" | "ape" | "for-you";

const HERO_TABS: { id: HomeNavTab; label: string; glow?: string; href?: string }[] = [
  { id: "discover", label: "Discover" },
  { id: "esports", label: "Esports", glow: "#ff7a00", href: "/esports/cs2" },
  { id: "ape", label: "Trending" },
  { id: "for-you", label: "For you", href: "/feed" },
];

const SUB_CATEGORIES: { id: HomeNavCategory | "live"; label: string; isLive?: boolean }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live", isLive: true },
  { id: "crypto", label: "Crypto" },
  { id: "sports", label: "Sports" },
  { id: "soft", label: "Politics" },
  { id: "esports", label: "Esports" },
  { id: "stocks", label: "Stocks" },
];

export function HomeNav({
  hero,
  setHero,
  category,
  setCategory,
  sort,
  setSort,
}: {
  hero: HomeNavTab;
  setHero: (h: HomeNavTab) => void;
  category: HomeNavCategory;
  setCategory: (c: HomeNavCategory) => void;
  sort: "volume" | "new";
  setSort: (s: "volume" | "new") => void;
}) {
  return (
    <div className="mb-5">
      {/* Hero pill row */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
        {HERO_TABS.map((tab) => {
          const active = hero === tab.id;
          return (
            <HeroPill
              key={tab.id}
              label={tab.label}
              active={active}
              glow={tab.glow}
              onClick={() => {
                setHero(tab.id);
                if (tab.href && typeof window !== "undefined") {
                  window.location.href = tab.href;
                }
              }}
            />
          );
        })}
      </div>

      {/* Sub-category strip */}
      <div className="flex items-center gap-1 border-b" style={{ borderColor: "var(--line-soft)" }}>
        <div className="flex items-center gap-1 overflow-x-auto flex-1 no-scrollbar">
          {SUB_CATEGORIES.map((cat) => {
            const isActive =
              cat.id === "live"
                ? false
                : category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  if (cat.id === "live") return;
                  setCategory(cat.id as HomeNavCategory);
                }}
                className="relative inline-flex items-center gap-1.5 px-3.5 py-3.5 text-[13.5px] uppercase whitespace-nowrap transition-colors"
                style={{
                  color: isActive ? "var(--tx)" : "var(--t3)",
                  letterSpacing: "0.06em",
                  fontWeight: isActive ? 800 : 700,
                }}
              >
                {cat.isLive && (
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{
                      background: "#10b981",
                      boxShadow: "0 0 6px #10b981",
                    }}
                  />
                )}
                {cat.label}
                {isActive && (
                  <span
                    className="absolute inset-x-3 -bottom-px h-[2px]"
                    style={{ background: "var(--tx)" }}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setSort(sort === "volume" ? "new" : "volume")}
          className="flex items-center gap-1.5 h-10 rounded-full border px-3.5 text-[12.5px] font-bold ml-2"
          style={{
            background: "var(--card-inner)",
            borderColor: "var(--line)",
            color: "var(--tx)",
          }}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          {sort === "volume" ? "Volume" : "New"}
          <ArrowDownNarrowWide className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function HeroPill({
  label,
  active,
  glow,
  onClick,
}: {
  label: string;
  active: boolean;
  glow?: string;
  onClick: () => void;
}) {
  const background = active ? "var(--accent-bright)" : glow ? "rgba(255,122,0,0.04)" : "var(--card-inner)";
  const color = active ? "#ffffff" : "var(--tx)";
  const borderColor = active
    ? "var(--accent-bright)"
    : glow
      ? glow
      : "var(--line-soft)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[46px] px-6 rounded-full text-[15px] transition-all"
      style={{
        background,
        color,
        border: `1.5px solid ${borderColor}`,
        boxShadow: glow && !active ? `0 0 22px -4px ${glow}` : undefined,
        fontWeight: 700,
        letterSpacing: "-0.005em",
      }}
    >
      {label}
    </button>
  );
}
