"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { ChevronLeft, Share2, Flame, Bot, Star, Copy, ExternalLink } from "lucide-react";
import { BetButton } from "@/components/dashboard/bet-button";
import { BetForm } from "@/components/dashboard/bet-form";
import { ProbabilityBar } from "@/components/dashboard/probability-bar";
import { AssetLogo } from "@/components/dashboard/asset-logo";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ResolutionStatus } from "@/components/dashboard/resolution-status";
import { DecisionSidebar } from "@/components/dashboard/decision-sidebar";
import { PoolPanel } from "@/components/dashboard/pool-panel";
import { PositionsFeed } from "@/components/dashboard/positions-feed";
import { RepriceFeed } from "@/components/dashboard/reprice-feed";
import { WatchStream } from "@/components/dashboard/watch-stream";
import { LiveStatusBadge } from "@/components/dashboard/live-status-badge";
import {
  ActivityFeedItem,
  CapsLabel,
  Pill,
  ResolutionTimer,
  type Activity,
} from "@/components/dashboard/market-atoms";
import { getServices } from "@/lib/services/provider";
import { useBet } from "@/lib/hooks/useBet";
import type { ActivityEvent, Market, MarketTimelinePoint } from "@/lib/types/domain";
import { toMarketView, multiplierFromPct, formatUsd } from "@/lib/market-view";

export function MarketDetailClient({ id }: { id: string }) {
  const [market, setMarket] = useState<Market | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [betSide, setBetSide] = useState<"yes" | "no" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [marketEvents, setMarketEvents] = useState<ActivityEvent[]>([]);
  const [timeline, setTimeline] = useState<MarketTimelinePoint[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [watchlisted, setWatchlisted] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const { placeBet } = useBet();

  useEffect(() => {
    let active = true;
    void getServices()
      .marketService.getMarket(id)
      .then((m) => {
        if (!active) return;
        setMarket(m);
        setError(null);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Market unavailable.");
      });
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = getServices().marketService.subscribeMarket(id, (m) => {
        if (active) setMarket(m);
      });
    } catch {
      /* ignore; fallback to one-shot fetch */
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, [id]);

  useEffect(() => {
    let active = true;
    void fetch("/api/watchlist", { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setWatchlisted(false);
          return;
        }
        const items = (await response.json()) as Array<{ marketId: string }>;
        setWatchlisted(items.some((item) => item.marketId === id));
      })
      .catch(() => {
        if (active) setWatchlisted(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    let active = true;
    async function loadProofSurfaces() {
      try {
        const [activityResponse, timelineResponse] = await Promise.all([
          fetch(`/api/markets/${encodeURIComponent(id)}/activity`, { cache: "no-store" }),
          fetch(`/api/markets/${encodeURIComponent(id)}/timeline`, { cache: "no-store" }),
        ]);
        if (!active) return;
        if (activityResponse.ok) {
          setMarketEvents((await activityResponse.json()) as ActivityEvent[]);
          setActivityError(null);
        } else {
          setMarketEvents([]);
          setActivityError(await activityResponse.text());
        }
        if (timelineResponse.ok) {
          setTimeline((await timelineResponse.json()) as MarketTimelinePoint[]);
          setTimelineError(null);
        } else {
          setTimeline([]);
          setTimelineError(await timelineResponse.text());
        }
      } catch (error) {
        if (!active) return;
        setMarketEvents([]);
        setTimeline([]);
        const message = error instanceof Error ? error.message : "Indexed proof surfaces unavailable.";
        setActivityError(message);
        setTimelineError(message);
      }
    }
    void loadProofSurfaces();
    const timer = window.setInterval(() => void loadProofSurfaces(), 12_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [id]);

  if (error && !market) {
    return (
      <main className="max-w-[1280px] mx-auto px-4 py-5">
        <div className="rounded-[6px] border border-[#262626] bg-[#1f1f1f] p-8 text-gray-400">
          {error}
        </div>
      </main>
    );
  }
  if (!market) {
    return (
      <main className="max-w-[1280px] mx-auto px-4 py-5">
        <div className="rounded-[6px] border border-[#262626] bg-[#1f1f1f] p-8 text-gray-500">
          Loading market...
        </div>
      </main>
    );
  }

  if (error === "Market not found.") notFound();

  const currentMarket = market;
  const view = toMarketView(currentMarket);
  const yesPrice = view.yesPct;
  const noPrice = 1 - yesPrice;
  const yesMult = multiplierFromPct(yesPrice);
  const noMult = multiplierFromPct(noPrice);
  const positive = view.changePct >= 0;
  const changeColor = positive ? "#10b981" : "#ef4444";

  const W = 720;
  const H = 180;
  const ys = timeline.length
    ? timeline.map((point) => {
        const value = point.yesProbability;
        return value > 1 ? value / 100 : value;
      })
    : view.yesHistory;
  const hasHistory = ys.length >= 2;
  const pts = hasHistory
    ? ys.map((y, i) => {
        const x = (i / (ys.length - 1)) * W;
        return `${x.toFixed(1)},${(H - y * H).toFixed(1)}`;
      })
    : [];
  const yesLine = pts.join(" ");
  const noPts = hasHistory
    ? ys.map((y, i) => {
        const x = (i / (ys.length - 1)) * W;
        return `${x.toFixed(1)},${(H - (1 - y) * H).toFixed(1)}`;
      })
    : [];
  const noLine = noPts.join(" ");
  const areaPath = hasHistory
    ? `M0,${H} L${pts.join(" L")} L${W},${H} Z`
    : "";
  const explorerBase = getExplorerBase(currentMarket.chainId);
  const marketPath = `/market/${encodeURIComponent(id)}`;
  const marketUrl = typeof window !== "undefined" ? window.location.href : marketPath;
  const ogCardPath = `/api/og/${encodeURIComponent(market.id)}`;
  const creationTxUrl = txUrl(explorerBase, currentMarket.creationTxHash);
  const resolutionTxUrl = txUrl(explorerBase, currentMarket.resolutionTxHash);
  const resolutionProofTxUrl = txUrl(explorerBase, currentMarket.resolutionProofTxHash);
  const poolUrl = addressUrl(explorerBase, currentMarket.poolAddress);
  const factoryUrl = addressUrl(explorerBase, currentMarket.factoryAddress);
  const resolutionProposedAt = currentMarket.resolutionProposedAtIso
    ? new Date(currentMarket.resolutionProposedAtIso).toLocaleString()
    : undefined;
  const aiLpActivity = marketEvents
    .filter((event) => event.kind === "ai-lp")
    .map((event) => toActivity(event))
    .filter((event): event is Activity => Boolean(event));

  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setToast(`${label} copied`);
    setTimeout(() => setToast(null), 2200);
  }

  async function shareMarketLink() {
    const payload = {
      title: currentMarket.title,
      text: `Adjudex market proof: ${currentMarket.title}`,
      url: marketUrl,
    };
    if (navigator.share) {
      await navigator.share(payload);
      return;
    }
    await copyText(marketUrl, "Market link");
  }

  async function copyProofSummary() {
    const summary = [
      currentMarket.title,
      `Market: ${marketUrl}`,
      currentMarket.chainId ? `Chain: ${currentMarket.chainId}` : undefined,
      currentMarket.poolAddress ? `Pool: ${currentMarket.poolAddress}` : undefined,
      currentMarket.creationTxHash ? `Creation tx: ${currentMarket.creationTxHash}` : undefined,
      currentMarket.resolutionTxHash ? `Resolution tx: ${currentMarket.resolutionTxHash}` : undefined,
      currentMarket.resolutionEvidenceHash ? `Evidence hash: ${currentMarket.resolutionEvidenceHash}` : undefined,
      currentMarket.resolutionProofTxHash ? `Evidence tx: ${currentMarket.resolutionProofTxHash}` : undefined,
      currentMarket.resolutionProposer ? `Proposer: ${currentMarket.resolutionProposer}` : undefined,
      currentMarket.sourceUrl ? `Source: ${currentMarket.sourceUrl}` : undefined,
      currentMarket.proofUrl ? `Proof: ${currentMarket.proofUrl}` : undefined,
    ].filter(Boolean).join("\n");
    await copyText(summary, "Proof summary");
  }

  async function toggleWatchlist() {
    try {
      setWatchlistError(null);
      const response = await fetch(watchlisted ? `/api/watchlist/${encodeURIComponent(id)}` : "/api/watchlist", {
        method: watchlisted ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: watchlisted ? undefined : JSON.stringify({ marketId: id }),
      });
      if (!response.ok) throw new Error(await response.text());
      setWatchlisted((current) => !current);
      setToast(watchlisted ? "Removed from watchlist" : "Added to watchlist");
      setTimeout(() => setToast(null), 2200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Watchlist requires wallet sign-in.";
      setWatchlistError("Watchlist requires SIWE wallet sign-in. No browser fallback is used.");
      setToast(message);
      setTimeout(() => setToast(null), 3500);
    }
  }

  return (
    <div className="px-[22px] py-5 pb-7">
      <main className="max-w-none">
        <div className="flex items-center justify-between mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-gray-400 hover:text-white"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Markets
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void toggleWatchlist()}
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[5px] border text-[11px] ${
                watchlisted
                  ? "bg-[#CCE9E7] border-[#CCE9E7] text-black"
                  : "bg-[#232323] border-[#2a2a2a] text-gray-300 hover:text-white hover:border-[#3a3a3a]"
              }`}
            >
              <Star className="w-3 h-3" fill={watchlisted ? "currentColor" : "none"} /> Watch
            </button>
            <button
              onClick={() => void shareMarketLink()}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[5px] bg-[#232323] border border-[#2a2a2a] text-gray-300 hover:text-white hover:border-[#3a3a3a] text-[11px]"
            >
              <Share2 className="w-3 h-3" /> Share
            </button>
            <LiveStatusBadge
              market={{
                status: market.status,
                deadlineIso: market.deadlineIso,
                matchStartsAtIso: market.matchStartsAtIso,
              }}
              size="md"
            />
            {market.streamUrl && (
              <WatchStream
                streamUrl={market.streamUrl}
                title={
                  market.teamA && market.teamB
                    ? `${market.teamA} vs ${market.teamB}`
                    : market.title
                }
              />
            )}
          </div>
        </div>

        {market.status === "resolved" && (
          <div className="panel p-4 mb-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] text-gray-500">Resolution / proof</span>
              <Pill tone={market.resolvedOutcome === "YES" ? "yes" : "no"}>
                {market.resolvedOutcome ?? "resolved"}
              </Pill>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <TrustItem label="Outcome" value={market.resolvedOutcome} />
              <TrustItem label="Resolver" value={market.resolverAddress ?? market.oracleType} mono />
              <TrustItem label="Evidence hash" value={market.resolutionEvidenceHash} mono />
              <TrustItem label="Proposer" value={market.resolutionProposer} mono />
              <TrustItem label="Proposed at" value={resolutionProposedAt} />
              <ProofLink label="Evidence tx" value={market.resolutionProofTxHash} href={resolutionProofTxUrl} />
              <ProofLink label="Resolution tx" value={market.resolutionTxHash} href={resolutionTxUrl} />
              <ProofLink label="Source" value={market.sourceUrl} href={market.sourceUrl} />
              <ProofLink label="Source proof" value={market.proofUrl} href={market.proofUrl} />
            </div>
          </div>
        )}

        <div className="flex items-start gap-4 mb-5">
          <AssetLogo ticker={view.ticker} assetClass={view.assetClass} size={40} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-gray-500 mb-1">
              {view.category} - <span className="font-mono">{view.asset}</span>
              {view.hasAiJudge && <span className="ml-2 text-[#CCE9E7]">AI-assisted resolution</span>}
            </div>
            <h1 className="text-white text-[20px] md:text-[22px] font-semibold leading-tight tracking-tight">
              {view.title}
            </h1>
            <div className="text-[12px] text-gray-500 mt-1.5">
              Resolves via{" "}
              <span className="text-gray-300">
                {market.proofUrl ?? market.sourceUrl ? market.oracleType : "configured oracle path pending proof"}
              </span>
            </div>
            <p className="text-gray-400 text-[13px] mt-2 leading-relaxed max-w-prose">
              {view.description}
            </p>
            {(market.importCandidateId || market.provenanceNote || market.sourcePublishedAtIso) && (
              <div
                className="mt-3 rounded-[8px] border border-[#34312e] bg-[#211f1e] p-3 text-[11.5px] leading-relaxed"
                style={{ color: "var(--t2)" }}
              >
                <span className="caps mr-2">Provenance</span>
                {market.provenanceNote ?? "Imported from a public source and normalized by Adjudex."}
                {market.sourcePublishedAtIso && (
                  <span className="ml-2 font-mono" style={{ color: "var(--t3)" }}>
                    source {new Date(market.sourcePublishedAtIso).toLocaleString()}
                  </span>
                )}
                {market.sourceUrl && (
                  <a
                    href={market.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 underline underline-offset-2"
                    style={{ color: "var(--accent-bright)" }}
                  >
                    source
                  </a>
                )}
              </div>
            )}
            {view.isHot && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-[#CCE9E7] mt-3">
                <Flame className="w-3 h-3" strokeWidth={2} />
                <span className="font-mono tabular-nums">{view.bettors} traders</span>
              </span>
            )}
            {watchlistError && (
              <div className="mt-3 rounded-[6px] border border-[#5b3535] bg-[#241b1b] px-3 py-2 text-[11.5px] text-[#fca5a5]">
                {watchlistError}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 panel overflow-hidden mb-5">
          {[
            { label: "Volume", value: formatUsd(view.volume) },
            { label: "Resolves", value: <ResolutionTimer ms={view.resolvesInMs} /> },
            { label: "Traders", value: view.bettors.toLocaleString() },
            { label: "AI LPs", value: view.aiLpCount, accent: true },
          ].map((s, i) => (
            <div
              key={i}
              className="p-3.5 border-r border-b md:border-b-0 border-[#262626] last:border-r-0"
            >
              <div className="text-[11px] text-gray-500">{s.label}</div>
              <div
                className={`mt-0.5 font-mono tabular-nums text-[16px] font-semibold ${
                  s.accent ? "text-[#CCE9E7]" : "text-white"
                }`}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>

        <div className="mb-5">
          <ResolutionStatus
            marketId={view.id}
            verifierAddress={
              process.env.NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS as
                | `0x${string}`
                | undefined
            }
            chainId={view.chainId}
            poolResolved={market.status === "resolved"}
            resolvedOutcome={market.resolvedOutcome}
          />
        </div>

        {/* Trading surface — peer-pool primitives beside the trade form.
            Pool depth + reprice triggers replace CLOB liquidity + tape.
            Decision sidebar mirrors "Use this page to make a trading
            decision" pattern. Desktop = right-rail; mobile = stacked. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 mb-5">
          <div className="space-y-4 min-w-0">
            <PoolPanel
              yesPoolUsd={view.volume * view.yesPct}
              noPoolUsd={view.volume * (1 - view.yesPct)}
              draftStakeUsd={undefined}
              draftSide={undefined}
            />
            <RepriceFeed timeline={timeline} explorerBase={`${explorerBase}/tx/`} />
          </div>
          <div className="space-y-4 min-w-0">
            <DecisionSidebar
              category={view.category}
              poolDepthUsd={view.volume}
              resolvesInMs={view.resolvesInMs}
              oracleType={market.oracleType}
              isResolved={market.status === "resolved"}
            />
            <PositionsFeed events={marketEvents} explorerBase={`${explorerBase}/tx/`} />
          </div>
        </div>

        <div className="panel p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-gray-500">Trust layer</span>
            <span className="caps">indexed proof</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <TrustItem label="Pool" value={market.poolAddress} mono missingLabel="missing pool address" />
            <TrustItem label="Factory" value={market.factoryAddress} mono missingLabel="missing factory address" />
            <TrustItem label="Creation tx" value={market.creationTxHash} mono missingLabel="missing creation tx" />
            <TrustItem label="Resolver" value={market.resolverAddress ?? market.oracleType} mono missingLabel="missing resolver" />
            <TrustItem label="Source" value={market.sourceUrl} link missingLabel="missing source URL" />
            <TrustItem label="Source proof" value={market.proofUrl} link missingLabel="no source proof indexed" optional />
            <TrustItem label="Evidence hash" value={market.resolutionEvidenceHash} mono missingLabel="no evidence hash yet" optional />
            <TrustItem label="Evidence tx" value={resolutionProofTxUrl} link missingLabel="no evidence tx yet" optional />
            <TrustItem label="Proposer" value={market.resolutionProposer} mono missingLabel="no proposer yet" optional />
            <TrustItem label="Proposed at" value={resolutionProposedAt} missingLabel="not proposed yet" optional />
            <TrustItem label="Imported" value={market.importCandidateId ? "public source" : undefined} missingLabel="not imported" optional />
            <TrustItem label="Chain" value={market.chainId ? String(market.chainId) : undefined} mono missingLabel="missing chain id" />
          </div>
          {market.resolutionCriteria && (
            <div className="mt-3 rounded-[8px] border border-[#34312e] bg-[#211f1e] p-3">
              <span className="caps">Resolution rules</span>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-400">
                {market.resolutionCriteria}
              </p>
            </div>
          )}
        </div>

        <div className="panel p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-gray-500">Share proof</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void shareMarketLink()}
                className="inline-flex items-center gap-1.5 rounded-[5px] border border-[#2a2a2a] bg-[#232323] px-2.5 py-1.5 text-[11px] text-gray-300 hover:border-[#3a3a3a] hover:text-white"
              >
                <Share2 className="h-3 w-3" /> Share
              </button>
              <button
                onClick={() => void copyProofSummary()}
                className="inline-flex items-center gap-1.5 rounded-[5px] border border-[#2a2a2a] bg-[#232323] px-2.5 py-1.5 text-[11px] text-gray-300 hover:border-[#3a3a3a] hover:text-white"
              >
                <Copy className="h-3 w-3" /> Copy proof
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <ProofLink label="Market link" value={marketUrl} href={marketUrl} onCopy={() => void copyText(marketUrl, "Market link")} />
            <ProofLink
              label="OG card"
              value={ogCardPath}
              href={ogCardPath}
              onCopy={() => void copyText(`${window.location.origin}${ogCardPath}`, "OG card link")}
            />
            <ProofLink label="Pool contract" value={market.poolAddress} href={poolUrl} />
            <ProofLink label="Factory contract" value={market.factoryAddress} href={factoryUrl} />
            <ProofLink label="Creation tx" value={market.creationTxHash} href={creationTxUrl} />
            <ProofLink label="Resolution tx" value={market.resolutionTxHash} href={resolutionTxUrl} />
            <ProofLink label="Evidence hash" value={market.resolutionEvidenceHash} />
            <ProofLink label="Evidence tx" value={market.resolutionProofTxHash} href={resolutionProofTxUrl} />
            <ProofLink label="Proposer" value={market.resolutionProposer} href={addressUrl(explorerBase, market.resolutionProposer)} />
            <ProofLink label="Source" value={market.sourceUrl} href={market.sourceUrl} />
            <ProofLink label="Source proof" value={market.proofUrl} href={market.proofUrl} />
          </div>
        </div>

        <div className="panel p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-gray-500">Current probability</span>
            <span className="text-[11px] font-mono tabular-nums" style={{ color: changeColor }}>
              {positive ? "+" : ""}
              {view.changePct.toFixed(1)}% 24h
            </span>
          </div>
          <ProbabilityBar yesPct={view.yesPct} size="lg" showLabels changePct={view.changePct} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <div className="panel p-4 hover:border-[#10b981]/40 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] text-gray-500">Bet YES</span>
              <Pill tone="yes">YES</Pill>
            </div>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-white font-mono tabular-nums text-[32px] font-semibold tracking-tight">
                ${yesPrice.toFixed(2)}
              </span>
              <span className="text-gray-500 text-[11px]">/ share</span>
            </div>
            <div className="text-[11px] text-gray-500 mb-4">
              Pays{" "}
              <span className="text-[#10b981] font-mono tabular-nums font-semibold">
                {yesMult.toFixed(2)}x
              </span>{" "}
              if YES - implied{" "}
              <span className="font-mono tabular-nums">{Math.round(yesPrice * 100)}%</span>
            </div>
            <BetButton
              variant="yes"
              size="xl"
              price={yesPrice}
              multiplier={yesMult}
              onClick={() => setBetSide("yes")}
            />
          </div>
          <div className="panel p-4 hover:border-[#ef4444]/40 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] text-gray-500">Bet NO</span>
              <Pill tone="no">NO</Pill>
            </div>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-white font-mono tabular-nums text-[32px] font-semibold tracking-tight">
                ${noPrice.toFixed(2)}
              </span>
              <span className="text-gray-500 text-[11px]">/ share</span>
            </div>
            <div className="text-[11px] text-gray-500 mb-4">
              Pays{" "}
              <span className="text-[#ef4444] font-mono tabular-nums font-semibold">
                {noMult.toFixed(2)}x
              </span>{" "}
              if NO - implied{" "}
              <span className="font-mono tabular-nums">{Math.round(noPrice * 100)}%</span>
            </div>
            <BetButton
              variant="no"
              size="xl"
              price={noPrice}
              multiplier={noMult}
              onClick={() => setBetSide("no")}
            />
          </div>
        </div>

        <div className="panel p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-gray-500">Probability - 7 days</span>
            <div className="flex items-center gap-3 text-[10.5px]">
              <span className="flex items-center gap-1.5 text-gray-400">
                <span className="w-3 h-0.5 bg-[#10b981]" /> YES
              </span>
              <span className="flex items-center gap-1.5 text-gray-400">
                <span className="w-3 h-0.5 border-t border-dashed border-[#ef4444]" /> NO
              </span>
            </div>
          </div>
          {timelineError ? (
            <div className="h-[180px] grid place-items-center rounded-[6px] border border-[#7f1d1d] bg-[#2a1717] px-4 text-center text-[11px] text-[#fca5a5]">
              Indexed timeline unavailable: {timelineError}
            </div>
          ) : hasHistory ? (
            <>
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[180px]">
                <defs>
                  <linearGradient id="yesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0, 0.25, 0.5, 0.75, 1].map((g) => (
                  <line
                    key={g}
                    x1={0}
                    x2={W}
                    y1={g * H}
                    y2={g * H}
                    stroke="#262626"
                    strokeWidth={1}
                    strokeDasharray="2 4"
                  />
                ))}
                <path d={areaPath} fill="url(#yesFill)" />
                <polyline fill="none" stroke="#10b981" strokeWidth={2} vectorEffect="non-scaling-stroke" points={yesLine} />
                <polyline fill="none" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" points={noLine} />
              </svg>
              <div className="flex justify-between text-[10px] text-gray-500 mt-1 font-mono tabular-nums">
                {["7d", "6d", "5d", "4d", "3d", "2d", "1d"].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <TimelineMarkers points={timeline} explorerBase={explorerBase} />
            </>
          ) : (
            <div className="h-[180px] grid place-items-center text-[11px] text-gray-500">
              No indexed probability timeline yet
            </div>
          )}
        </div>

        <div className="panel p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500">AI Market-Makers</span>
              <Pill tone={view.aiLpCount > 0 ? "accent" : "neutral"}>
                {view.aiLpCount > 0 ? "indexed agent activity" : "no indexed activity"}
              </Pill>
            </div>
            <span className="text-[11px] text-gray-500 font-mono tabular-nums">
              {view.aiLpCount} active
            </span>
          </div>
          {aiLpActivity.length > 0 ? (
            <div className="space-y-2">
              {aiLpActivity.slice(0, 5).map((item, index) => (
                <ActivityFeedItem key={`${item.transactionHash ?? item.ago}:${index}`} item={item} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Bot}
              title="No AI LPs yet"
              description="No indexed AI liquidity-provider activity is available for this market."
            />
          )}
        </div>

        <div className="panel p-4">
          <div className="flex items-center justify-between mb-2">
            <CapsLabel>Activity on this market</CapsLabel>
            <span className="inline-flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
              live
            </span>
          </div>
          <div>
            {activityError ? (
              <div className="rounded-[6px] border border-[#7f1d1d] bg-[#2a1717] px-3 py-3 text-center text-[11px] text-[#fca5a5]">
                Indexed activity unavailable: {activityError}
              </div>
            ) : marketEvents.length === 0 ? (
              <div className="text-[11px] text-gray-500 py-3 text-center">
                No indexed activity for this market yet.
              </div>
            ) : (
              marketEvents.map((e, i) => {
                const item = toActivity(e);
                return item ? (
                  <ActivityFeedItem key={e.id ?? i} item={item} />
                ) : (
                  <div key={e.id ?? i} className="rounded-[6px] border border-[#78350f] bg-[#2a1f12] px-3 py-2 text-[11px] text-[#fbbf24]">
                    Malformed indexed event: {e.id}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {toast && (
          <div className="fixed bottom-20 md:bottom-6 right-6 z-50 rounded-[6px] border border-[#262626] bg-[#1f1f1f] px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-14 z-40 border-t border-[#262626] bg-[#181818]/95 p-3 backdrop-blur md:hidden">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setBetSide("yes")}
            className="h-11 rounded-[6px] bg-[#10b981] px-3 text-left text-black shadow-lg active:scale-[0.98]"
          >
            <span className="block text-[10px] font-bold uppercase tracking-[0.12em]">YES</span>
            <span className="font-mono text-sm font-semibold">{Math.round(yesPrice * 100)}% - {yesMult.toFixed(2)}x</span>
          </button>
          <button
            onClick={() => setBetSide("no")}
            className="h-11 rounded-[6px] bg-[#ef4444] px-3 text-left text-white shadow-lg active:scale-[0.98]"
          >
            <span className="block text-[10px] font-bold uppercase tracking-[0.12em]">NO</span>
            <span className="font-mono text-sm font-semibold">{Math.round(noPrice * 100)}% - {noMult.toFixed(2)}x</span>
          </button>
        </div>
      </div>

      {betSide && (
        <BetForm
          market={view}
          side={betSide}
          onClose={() => setBetSide(null)}
          onConfirm={async (stake, onStep) => {
            try {
              await placeBet({
                marketId: view.id,
                side: betSide.toUpperCase() as "YES" | "NO",
                stakeUsd: stake,
              }, onStep);
              setToast(`Bet placed: ${betSide.toUpperCase()} $${stake}`);
              setTimeout(() => setToast(null), 3500);
            } catch (e) {
              setToast(`Bet failed: ${(e as Error).message}`);
              setTimeout(() => setToast(null), 5000);
            }
          }}
        />
      )}
    </div>
  );
}

function toActivity(e: {
  kind: string;
  side?: string;
  walletShort?: string;
  agentHandle?: string;
  marketTitle?: string;
  amountUsd?: number;
  atIso: string;
  resolvedAs?: string;
  transactionHash?: string;
  chainId?: number;
}): Activity | null {
  const ago = formatAgo(e.atIso);
  if (e.kind === "resolution") {
    if (e.resolvedAs !== "YES" && e.resolvedAs !== "NO") return null;
    return {
      kind: "resolution",
      side: e.resolvedAs.toLowerCase() as "yes" | "no",
      market: e.marketTitle ?? "",
      ago,
      transactionHash: e.transactionHash,
      chainId: e.chainId,
    };
  }
  if (e.kind === "claim" || e.kind === "refund") {
    if (!e.walletShort || typeof e.amountUsd !== "number") return null;
    return {
      kind: e.kind,
      handle: e.walletShort,
      market: e.marketTitle ?? "",
      amount: e.amountUsd ?? 0,
      ago,
      transactionHash: e.transactionHash,
      chainId: e.chainId,
    };
  }
  const isAi = e.kind === "ai-lp";
  if (e.side !== "YES" && e.side !== "NO") return null;
  if (typeof e.amountUsd !== "number") return null;
  const handle = e.agentHandle ?? e.walletShort;
  if (!handle) return null;
  return {
    kind: isAi ? "ai-lp" : "bet",
    side: e.side.toLowerCase() as "yes" | "no",
    handle,
    market: e.marketTitle ?? "",
    amount: e.amountUsd,
    ago,
    transactionHash: e.transactionHash,
    chainId: e.chainId,
  };
}

function TrustItem({
  label,
  value,
  missingLabel,
  optional,
  mono,
  link,
}: {
  label: string;
  value?: string | null;
  missingLabel?: string;
  optional?: boolean;
  mono?: boolean;
  link?: boolean;
}) {
  const hasValue = Boolean(value);
  const displayValue = value ?? missingLabel ?? "missing";
  const toneClass = optional
    ? "border-[#3a3428] bg-[#15130f] text-[#fbbf24]"
    : "border-[#4b2525] bg-[#1b1111] text-[#fca5a5]";
  if (!hasValue) {
    return (
      <div className={`rounded-[6px] border p-3 ${toneClass}`}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-[0.12em] text-gray-500">{label}</div>
          <span className="text-[9px] uppercase tracking-[0.12em]">
            {optional ? "pending" : "required"}
          </span>
        </div>
        <div className="break-all text-xs">{displayValue}</div>
      </div>
    );
  }
  const rawValue = value ?? "";
  const display = rawValue.length > 42 ? `${rawValue.slice(0, 18)}...${rawValue.slice(-12)}` : rawValue;
  const content = (
    <span className={mono ? "font-mono tabular-nums" : undefined}>
      {display}
    </span>
  );

  return (
    <div className="rounded-[6px] border border-[#262626] bg-[#111111] p-3">
      <div className="text-[10px] uppercase tracking-[0.12em] text-gray-500 mb-1">{label}</div>
      {link ? (
        <a href={rawValue} target="_blank" rel="noreferrer" className="text-xs text-[#7ef4c8] hover:text-white break-all">
          {content}
        </a>
      ) : (
        <div className="text-xs text-gray-200 break-all">{content}</div>
      )}
    </div>
  );
}

function ProofLink({
  label,
  value,
  href,
  onCopy,
}: {
  label: string;
  value?: string | null;
  href?: string | null;
  onCopy?: () => void;
}) {
  if (!value) return null;
  const display = value.length > 46 ? `${value.slice(0, 20)}...${value.slice(-12)}` : value;
  return (
    <div className="rounded-[6px] border border-[#262626] bg-[#111111] p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.12em] text-gray-500">{label}</div>
        {onCopy && (
          <button onClick={onCopy} className="text-gray-500 hover:text-white" aria-label={`Copy ${label}`}>
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-xs text-[#7ef4c8] hover:text-white">
          <span className="truncate">{display}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      ) : (
        <div className="truncate text-xs text-gray-200">{display}</div>
      )}
    </div>
  );
}

function TimelineMarkers({
  points,
  explorerBase,
}: {
  points: MarketTimelinePoint[];
  explorerBase: string;
}) {
  const markers = points
    .filter((point) => point.eventKind !== "snapshot" || point.transactionHash)
    .slice(-6)
    .reverse();
  if (markers.length === 0) return null;
  const maxVolume = Math.max(...markers.map((point) => point.volumeUsd), 1);
  return (
    <div className="mt-4 border-t border-[#262626] pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] text-gray-500">Indexed timeline markers</span>
        <span className="caps">volume + tx proof</span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {markers.map((point) => {
          const href = txUrl(explorerBase, point.transactionHash);
          const yes = point.yesProbability > 1 ? point.yesProbability : point.yesProbability * 100;
          const volumeWidth = Math.max(4, (point.volumeUsd / maxVolume) * 100);
          return (
            <div key={point.id} className="rounded-[6px] border border-[#262626] bg-[#111111] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-[4px] border border-[#2a2a2a] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-gray-400">
                  {point.eventKind}
                </span>
                <span className="font-mono text-[10px] text-gray-500">
                  {formatAgo(point.atIso)}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span className="font-mono text-[12px] text-[#10b981]">{yes.toFixed(1)}% YES</span>
                <span className="font-mono text-[11px] text-gray-300">{formatUsd(point.volumeUsd)}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#262626]">
                <div className="h-full rounded-full bg-[#CCE9E7]" style={{ width: `${volumeWidth}%` }} />
              </div>
              {href && (
                <a href={href} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#7ef4c8] hover:text-white">
                  Open tx proof <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getExplorerBase(chainId?: number): string {
  if (chainId === 46630 || chainId === Number(process.env.NEXT_PUBLIC_RHC_CHAIN_ID)) {
    return process.env.NEXT_PUBLIC_RHC_EXPLORER_URL || "";
  }
  return process.env.NEXT_PUBLIC_ARBITRUM_EXPLORER_URL || "https://sepolia.arbiscan.io";
}

function txUrl(explorerBase: string, hash?: string | null): string | undefined {
  if (!explorerBase || !hash) return undefined;
  return `${explorerBase.replace(/\/$/, "")}/tx/${encodeURIComponent(hash)}`;
}

function addressUrl(explorerBase: string, address?: string | null): string | undefined {
  if (!explorerBase || !address) return undefined;
  return `${explorerBase.replace(/\/$/, "")}/address/${encodeURIComponent(address)}`;
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

