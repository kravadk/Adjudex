import Link from "next/link";
import { Flame } from "lucide-react";
import type { MarketView as Market } from "@/lib/market-view";
import {
  formatCountdown,
  formatUsd,
  multiplierFromPct,
} from "@/lib/market-view";
import { ProbabilityBar } from "./probability-bar";
import { BetButton } from "./bet-button";
import { AssetLogo } from "./asset-logo";
import { Sparkline } from "./sparkline";
import { AILPIndicator, ResolutionTimer } from "./market-atoms";
import { LiveStatusBadge } from "./live-status-badge";
import { MarketKindBadge } from "./market-kind-badge";
import { TraderStack } from "./trader-stack";

type Props = {
  market: Market;
  variant?: "default" | "featured" | "compact";
};

export function MarketCard({ market, variant = "default" }: Props) {
  const marketHref = `/market/${encodeURIComponent(market.id)}`;
  const yesPrice = market.yesPct;
  const noPrice = 1 - market.yesPct;
  const yesMult = multiplierFromPct(market.yesPct);
  const noMult = multiplierFromPct(noPrice);
  const positiveChange = market.changePct >= 0;
  const changeColor = positiveChange ? "#10b981" : "#ef4444";

  if (variant === "compact") {
    return (
      <Link
        href={marketHref}
        className="group flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-[4px] hover:bg-[#1f1f1f] transition-colors"
      >
        <AssetLogo
          ticker={market.ticker}
          assetClass={market.assetClass}
          size={24}
        />
        <div className="min-w-0 flex-1">
          <div className="text-white text-[13px] font-medium truncate leading-tight">
            {market.title}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5 font-mono tabular-nums">
            {formatUsd(market.volume, { compact: true })} vol -{" "}
            {formatCountdown(market.resolvesInMs)}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Sparkline
            values={market.yesHistory}
            width={48}
            height={18}
            color={changeColor}
          />
          <div className="text-right tabular-nums font-mono w-12">
            <div className="text-white text-[13px] font-semibold">
              {Math.round(market.yesPct * 100)}%
            </div>
            <div className="text-[10px]" style={{ color: changeColor }}>
              {positiveChange ? "+" : ""}
              {market.changePct.toFixed(1)}%
            </div>
          </div>
        </div>
      </Link>
    );
  }

  if (variant === "featured") {
    return (
      <div className="relative bg-[#1c1c1c] border border-[#2a2a2a] rounded-[8px] overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-0">
          <div className="p-5">
            <div className="flex items-start gap-3 mb-3">
              <AssetLogo
                ticker={market.ticker}
                assetClass={market.assetClass}
                size={32}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] text-gray-500 mb-0.5">
                  {market.category} - {market.asset}
                </div>
                <Link href={marketHref} className="block">
                  <h2 className="text-white text-[18px] font-semibold leading-tight tracking-tight hover:text-white/90">
                    {market.title}
                  </h2>
                </Link>
              </div>
            </div>
            <p className="text-gray-400 text-[12.5px] leading-relaxed mb-4 max-w-prose">
              {market.description}
            </p>
            <div className="flex items-baseline gap-6 mb-4 flex-wrap">
              <div>
                <div className="text-[10px] text-gray-500 mb-0.5">
                  YES probability
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[#10b981] font-mono tabular-nums text-[28px] font-semibold tracking-tight">
                    {Math.round(market.yesPct * 100)}%
                  </span>
                  <span
                    className="font-mono tabular-nums text-[12px]"
                    style={{ color: changeColor }}
                  >
                    {positiveChange ? "+" : ""}
                    {market.changePct.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[10px] text-gray-500 mb-0.5">Volume</div>
                <div className="text-white font-mono tabular-nums text-[18px] font-semibold">
                  {formatUsd(market.volume, { compact: true })}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-gray-500 mb-0.5">Traders</div>
                <div className="text-white font-mono tabular-nums text-[18px] font-semibold">
                  {market.bettors}
                </div>
              </div>
            </div>
            <ProbabilityBar yesPct={market.yesPct} size="md" />
            <div className="grid grid-cols-2 gap-2 mt-4 max-w-md">
              <BetButton
                variant="yes"
                size="lg"
                price={yesPrice}
                multiplier={yesMult}
                href={marketHref}
              />
              <BetButton
                variant="no"
                size="lg"
                price={noPrice}
                multiplier={noMult}
                href={marketHref}
              />
            </div>
          </div>
          <div className="bg-[#181818] border-l border-[#262626] p-4 flex flex-col justify-between gap-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-[0.08em]">
              YES last 7
            </div>
            {market.yesHistory.length >= 2 ? (
              <>
                <Sparkline
                  values={market.yesHistory}
                  width={188}
                  height={120}
                  color={changeColor}
                  fill
                  strokeWidth={1.5}
                />
                <div className="flex items-center justify-between text-[10.5px] text-gray-500 font-mono tabular-nums">
                  <span>
                    {Math.round(Math.min(...market.yesHistory) * 100)}%
                  </span>
                  <span>
                    {Math.round(Math.max(...market.yesHistory) * 100)}%
                  </span>
                </div>
              </>
            ) : (
              <div className="flex-1 grid place-items-center text-[10.5px] text-gray-500">
                No history yet
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // default variant
  return (
    <div
      className="group relative rounded-[16px] p-5 transition-colors"
      style={{
        background: "var(--panel-bg)",
        border: "1px solid var(--line-soft)",
      }}
    >
      <Link href={marketHref} className="block">
        <div className="flex items-start gap-3 mb-3">
          <AssetLogo
            ticker={market.ticker}
            assetClass={market.assetClass}
            size={28}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10.5px] text-gray-500 font-medium">
                {market.category}
              </span>
              <LiveStatusBadge
                market={{
                  status:
                    market.lifecycle === "resolved"
                      ? "resolved"
                      : market.lifecycle === "locked"
                        ? "locked"
                        : "open",
                  deadlineIso: market.deadlineIso,
                  matchStartsAtIso: market.matchStartsAtIso,
                }}
              />
              <MarketKindBadge kind={market.kind} />
              {market.isHot && (
                <span className="inline-flex items-center gap-1 text-[10.5px] text-[#CCE9E7]">
                  <Flame className="w-3 h-3" strokeWidth={2} />
                  <span className="font-mono tabular-nums">{market.bettors}</span>
                </span>
              )}
            </div>
            <h3 className="text-white text-[14px] font-semibold leading-snug">
              {market.title}
            </h3>
            {market.game && (market.teamA || market.teamB) && (
              <div
                className="text-[10.5px] font-mono tabular-nums mt-1"
                style={{ color: "var(--t3)" }}
              >
                {market.teamA ?? "TBD"} vs {market.teamB ?? "TBD"}
                {market.tournament && (
                  <span style={{ color: "var(--t4)" }}> · {market.tournament}</span>
                )}
              </div>
            )}
            {market.recentTraders && market.recentTraders.length > 0 && (
              <div className="mt-2">
                <TraderStack
                  addresses={market.recentTraders}
                  totalCount={market.bettors ?? market.recentTraders.length}
                />
              </div>
            )}
          </div>
        </div>
      </Link>

      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[#10b981] font-mono tabular-nums text-[13px] font-semibold">
            YES {Math.round(market.yesPct * 100)}%
          </span>
          <span
            className="font-mono tabular-nums text-[11px]"
            style={{ color: changeColor }}
          >
            {positiveChange ? "+" : ""}
            {market.changePct.toFixed(1)}%
          </span>
        </div>
        <ProbabilityBar yesPct={market.yesPct} size="sm" />
      </div>

      <div className="flex items-center justify-between gap-2 mb-3">
        <AILPIndicator count={market.aiLpCount} />
        <ResolutionTimer ms={market.resolvesInMs} />
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <BetButton
          variant="yes"
          size="md"
          price={yesPrice}
          multiplier={yesMult}
          href={marketHref}
        />
        <BetButton
          variant="no"
          size="md"
          price={noPrice}
          multiplier={noMult}
          href={marketHref}
        />
      </div>
    </div>
  );
}

