"use client";

import type { MarketView } from "@/lib/market-view";
import { MarketCard } from "./market-card";
import { MultiOutcomeCard } from "./multi-outcome-card";

// Grouped grid of MarketCards (foresee.lol style). Markets with a
// `parentMarketId` collapse into the parent's MultiOutcomeCard; markets
// without a parent render as the existing single-outcome MarketCard.
// Sort + filter happen upstream in HomeClient — this component only
// receives the already-filtered list.

type Group =
  | { kind: "single"; market: MarketView }
  | { kind: "multi"; parent: MarketView; children: MarketView[] };

function groupMarkets(views: MarketView[]): Group[] {
  const byId = new Map(views.map((v) => [v.id, v] as const));
  const childrenByParent = new Map<string, MarketView[]>();
  for (const v of views) {
    if (v.parentMarketId && byId.has(v.parentMarketId)) {
      const list = childrenByParent.get(v.parentMarketId) ?? [];
      list.push(v);
      childrenByParent.set(v.parentMarketId, list);
    }
  }
  const seen = new Set<string>();
  const groups: Group[] = [];
  for (const v of views) {
    if (seen.has(v.id)) continue;
    if (v.parentMarketId && byId.has(v.parentMarketId)) {
      // Skip — will be rendered under its parent.
      continue;
    }
    const children = childrenByParent.get(v.id);
    if (children && children.length > 0) {
      groups.push({ kind: "multi", parent: v, children });
      seen.add(v.id);
      for (const c of children) seen.add(c.id);
    } else {
      groups.push({ kind: "single", market: v });
      seen.add(v.id);
    }
  }
  return groups;
}

export function MarketsGrid({
  views,
  emptyHint,
}: {
  views: MarketView[];
  emptyHint?: string;
}) {
  const groups = groupMarkets(views);
  if (groups.length === 0) {
    return (
      <div
        className="panel"
        style={{ padding: "40px 20px", textAlign: "center", color: "var(--t3)" }}
      >
        {emptyHint ?? "No markets to show."}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {groups.map((g) =>
        g.kind === "multi" ? (
          <MultiOutcomeCard
            key={g.parent.id}
            parent={g.parent}
            outcomes={g.children}
          />
        ) : (
          <MarketCard key={g.market.id} market={g.market} />
        ),
      )}
    </div>
  );
}
