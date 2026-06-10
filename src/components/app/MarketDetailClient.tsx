"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { BarChart3, ChevronLeft, Share2, Flame, Bot, Star, Copy, ExternalLink, LineChart } from "lucide-react";
import { keccak256, parseUnits, stringToBytes, zeroAddress, type Address } from "viem";
import { readContract, signTypedData, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import testUsdcAbi from "@/lib/abi/TestUSDC.json";
import { stakeTokenForChain } from "@/lib/stake-token";
import { describeTxError } from "@/lib/utils/decode-error";
import { useAccount } from "wagmi";
import { BetButton } from "@/components/dashboard/bet-button";
import { BetForm } from "@/components/dashboard/bet-form";
import { InlineBetTicket } from "@/components/dashboard/inline-bet-ticket";
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
import { MarketComments } from "@/components/dashboard/market-comments";
import { TabBar, type TabItem } from "@/components/dashboard/tab-bar";
import { OptimisticDisputePanel } from "@/components/dashboard/optimistic-dispute-panel";
import {
  ActivityFeedItem,
  CapsLabel,
  Pill,
  ResolutionTimer,
  type Activity,
} from "@/components/dashboard/market-atoms";
import { getServices } from "@/lib/services/provider";
import { useBet } from "@/lib/hooks/useBet";
import { isZeroDevGaslessEnabled } from "@/lib/zerodev/gasless-bet";
import type { ActivityEvent, Market, MarketTimelinePoint, Opportunity, OrderIntent, ResolutionDispute } from "@/lib/types/domain";
import { toMarketView, multiplierFromPct, formatUsd } from "@/lib/market-view";
import { wagmiConfig } from "@/lib/wagmi";
import outcomeSharePoolAbi from "@/lib/abi/OutcomeSharePool.json";
import adjudexOrderMatcherAbi from "@/lib/abi/AdjudexOrderMatcher.json";

export function MarketDetailClient({ id }: { id: string }) {
  const [market, setMarket] = useState<Market | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [betSide, setBetSide] = useState<"yes" | "no" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [marketEvents, setMarketEvents] = useState<ActivityEvent[]>([]);
  const [timeline, setTimeline] = useState<MarketTimelinePoint[]>([]);
  const [liquidity, setLiquidity] = useState<LiquiditySnapshot | null>(null);
  const [orders, setOrders] = useState<OrderIntent[]>([]);
  const [resolutionDisputes, setResolutionDisputes] = useState<ResolutionDispute[]>([]);
  const [marketGroup, setMarketGroup] = useState<MarketGroupSnapshot | null>(null);
  const [groupArbitrage, setGroupArbitrage] = useState<GroupArbitrageSnapshot | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [tradeMode, setTradeMode] = useState<"market" | "limit">("market");
  const [tab, setTab] = useState<"overview" | "rules" | "activity" | "discussion">("overview");
  const [activityError, setActivityError] = useState<string | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [watchlisted, setWatchlisted] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const { address } = useAccount();
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
    async function loadCompetitiveSurfaces(marketSnapshot: Market) {
      const requests: Array<Promise<void>> = [
        fetch(`/api/markets/${encodeURIComponent(id)}/liquidity`, { cache: "no-store" })
          .then(async (response) => {
            if (!response.ok) throw new Error(await response.text());
            if (active) setLiquidity((await response.json()) as LiquiditySnapshot);
          })
          .catch(() => {
            if (active) setLiquidity(null);
          }),
        fetch(`/api/orders?marketId=${encodeURIComponent(id)}`, { cache: "no-store" })
          .then(async (response) => {
            if (!response.ok) throw new Error(await response.text());
            if (active) setOrders((await response.json()) as OrderIntent[]);
          })
          .catch(() => {
            if (active) setOrders([]);
          }),
        fetch(`/api/markets/${encodeURIComponent(id)}/resolution`, { cache: "no-store" })
          .then(async (response) => {
            if (!response.ok) throw new Error(await response.text());
            const body = (await response.json()) as { disputes?: ResolutionDispute[] };
            if (active) setResolutionDisputes(body.disputes ?? []);
          })
          .catch(() => {
            if (active) setResolutionDisputes([]);
          }),
        fetch(`/api/markets/${encodeURIComponent(id)}/opportunities`, { cache: "no-store" })
          .then(async (response) => {
            if (!response.ok) throw new Error(await response.text());
            if (active) setOpportunities((await response.json()) as Opportunity[]);
          })
          .catch(() => {
            if (active) setOpportunities([]);
          }),
      ];

      if (marketSnapshot.groupId) {
        const groupId = marketSnapshot.groupId;
        requests.push(
          fetch(`/api/market-groups/${encodeURIComponent(groupId)}`, { cache: "no-store" })
            .then(async (response) => {
              if (!response.ok) throw new Error(await response.text());
              if (active) setMarketGroup((await response.json()) as MarketGroupSnapshot);
            })
            .catch(() => {
              if (active) setMarketGroup(null);
            }),
          fetch(`/api/market-groups/${encodeURIComponent(groupId)}/arbitrage`, { cache: "no-store" })
            .then(async (response) => {
              if (!response.ok) throw new Error(await response.text());
              if (active) setGroupArbitrage((await response.json()) as GroupArbitrageSnapshot);
            })
            .catch(() => {
              if (active) setGroupArbitrage(null);
            }),
        );
      } else {
        setMarketGroup(null);
        setGroupArbitrage(null);
      }

      await Promise.all(requests);
    }
    if (market) void loadCompetitiveSurfaces(market);
    return () => {
      active = false;
    };
  }, [id, market]);

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
    // Backend GETs can legitimately return an empty 200 body before any rows
    // are indexed; calling response.json() on "" throws "Unexpected end of JSON
    // input". Read text first and treat empty/unparseable as an empty list (a
    // calm empty state), reserving the error slot for real non-2xx failures.
    const readArray = async <T,>(r: Response): Promise<{ data: T[]; error: string | null }> => {
      let text = "";
      try {
        text = (await r.text()).trim();
      } catch {
        return { data: [], error: null };
      }
      if (!r.ok) return { data: [], error: text || `Service responded ${r.status}.` };
      if (!text) return { data: [], error: null };
      try {
        const parsed = JSON.parse(text);
        return { data: Array.isArray(parsed) ? (parsed as T[]) : [], error: null };
      } catch {
        return { data: [], error: null };
      }
    };
    async function loadProofSurfaces() {
      try {
        const [activityResponse, timelineResponse] = await Promise.all([
          fetch(`/api/markets/${encodeURIComponent(id)}/activity`, { cache: "no-store" }),
          fetch(`/api/markets/${encodeURIComponent(id)}/timeline`, { cache: "no-store" }),
        ]);
        if (!active) return;
        const activity = await readArray<ActivityEvent>(activityResponse);
        setMarketEvents(activity.data);
        setActivityError(activity.error);
        const tl = await readArray<MarketTimelinePoint>(timelineResponse);
        setTimeline(tl.data);
        setTimelineError(tl.error);
      } catch {
        if (!active) return;
        setMarketEvents([]);
        setTimeline([]);
        setActivityError(null);
        setTimelineError(null);
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

        <div className="stat-strip mb-5">
          {[
            { label: "Volume", value: formatUsd(view.volume) },
            { label: "Resolves in", value: <ResolutionTimer ms={view.resolvesInMs} /> },
            { label: "Traders", value: view.bettors.toLocaleString() },
            { label: "AI LPs", value: view.aiLpCount },
          ].map((s, i) => (
            <div key={i}>
              <div className="s-label">{s.label}</div>
              <div className="s-value">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Polymarket-style: hero (price + chart) in the main column, a sticky
            bet box on the right, and everything else behind tabs. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
          <div className="min-w-0 space-y-5">
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-gray-500">Current probability</span>
                <span className="text-[11px] font-mono tabular-nums" style={{ color: changeColor }}>
                  {positive ? "+" : ""}
                  {view.changePct.toFixed(1)}% 24h
                </span>
              </div>
              <ProbabilityBar yesPct={view.yesPct} size="lg" showLabels changePct={view.changePct} />
            </div>

            <div className="panel p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] text-gray-500">Probability - 7 days</span>
                <div className="flex items-center gap-3 text-[10.5px]">
                  <span className="flex items-center gap-1.5 text-gray-400">
                    <span className="w-3 h-0.5 bg-[#d9ff00]" /> YES
                  </span>
                  <span className="flex items-center gap-1.5 text-gray-400">
                    <span className="w-3 h-0.5 border-t border-dashed border-[#3b6ffa]" /> NO
                  </span>
                </div>
              </div>
              {timelineError ? (
                <div className="h-[180px] grid place-items-center rounded-[6px] border border-[color:var(--line)] bg-[color:var(--card-inner)] px-4 text-center text-[11px] text-[color:var(--t3)]">
                  Probability history is still indexing — check back shortly.
                </div>
              ) : hasHistory ? (
                <>
                  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[180px]">
                    <defs>
                      <linearGradient id="yesFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#d9ff00" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="#d9ff00" stopOpacity="0" />
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
                    <polyline fill="none" stroke="#d9ff00" strokeWidth={2} vectorEffect="non-scaling-stroke" points={yesLine} />
                    <polyline fill="none" stroke="#3b6ffa" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" points={noLine} />
                  </svg>
                  <div className="flex justify-between text-[10px] text-gray-500 mt-1 font-mono tabular-nums">
                    {["7d", "6d", "5d", "4d", "3d", "2d", "1d"].map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>
                  <TimelineMarkers points={timeline} explorerBase={explorerBase} />
                </>
              ) : (
                <div className="h-[180px] grid place-items-center text-[11px] text-[color:var(--t3)]">
                  Probability history appears after the first indexed snapshot.
                </div>
              )}
            </div>

            {/* Mobile-only trade entry (sticky aside is desktop). */}
            <div className="lg:hidden">
              {view.liquidityMode === "amm" ? (
                <AmmExitPanel market={market} liquidity={liquidity} address={address} />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <BetButton variant="yes" size="xl" price={yesPrice} multiplier={yesMult} onClick={() => setBetSide("yes")} />
                  <BetButton variant="no" size="xl" price={noPrice} multiplier={noMult} onClick={() => setBetSide("no")} />
                </div>
              )}
            </div>

            <TabBar
              tabs={[
                { id: "overview", label: "Overview" },
                { id: "rules", label: "Rules & on-chain" },
                { id: "activity", label: "Activity", count: marketEvents.length },
                { id: "discussion", label: "Discussion" },
              ] as TabItem<typeof tab>[]}
              active={tab}
              onChange={setTab}
            />

            {tab === "overview" && (
              <div className="space-y-4">
                <MarketGroupPanel group={marketGroup} arbitrage={groupArbitrage} />
                <OpportunityPanel opportunities={opportunities} />
                <PoolPanel
                  yesPoolUsd={view.volume * view.yesPct}
                  noPoolUsd={view.volume * (1 - view.yesPct)}
                  draftStakeUsd={undefined}
                  draftSide={undefined}
                />
                <RepriceFeed timeline={timeline} explorerBase={`${explorerBase}/tx/`} />
                <DecisionSidebar
                  category={view.category}
                  poolDepthUsd={view.volume}
                  resolvesInMs={view.resolvesInMs}
                  oracleType={market.oracleType}
                  isResolved={market.status === "resolved"}
                />
              </div>
            )}

            {tab === "rules" && (
              <div className="space-y-4">
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
                <OptimisticDisputePanel marketId={view.id} chainId={view.chainId} />
                <GmxSignalCards market={market} />
                <ResolutionTimelinePanel disputes={resolutionDisputes} explorerBase={explorerBase} />
                <div className="panel p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] text-gray-500">Trust layer</span>
                    <span className="caps">indexed proof</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
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
                <div className="panel p-4">
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
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
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
              </div>
            )}

            {tab === "activity" && (
              <div className="space-y-4">
                <div className="panel p-4">
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
                      <span className="w-1.5 h-1.5 rounded-full bg-[#d9ff00] animate-pulse" />
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
                <PositionsFeed events={marketEvents} explorerBase={`${explorerBase}/tx/`} />
              </div>
            )}

            {tab === "discussion" && <MarketComments marketId={id} />}
          </div>

          {/* Sticky bet box (desktop). Mobile uses the fixed bottom bar below. */}
          <aside className="hidden lg:block">
            <div className="sticky top-20 space-y-3">
              <TradeModePanel mode={tradeMode} onModeChange={setTradeMode} />
              {tradeMode === "market" ? (
                view.liquidityMode === "amm" ? (
                  <AmmExitPanel market={market} liquidity={liquidity} address={address} />
                ) : (
                  <InlineBetTicket
                    market={view}
                    onPlaced={() => {
                      setToast("Position confirmed");
                      window.setTimeout(() => setToast(null), 3000);
                    }}
                  />
                )
              ) : (
                <LimitOrderPanel market={market} orders={orders} bestBidBps={market.bestBidBps} bestAskBps={market.bestAskBps} address={address} />
              )}
            </div>
          </aside>
        </div>

        {toast && (
          <div className="fixed bottom-20 md:bottom-6 right-6 z-50 rounded-[6px] border border-[#262626] bg-[#1f1f1f] px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        )}
      </main>

      {view.liquidityMode !== "amm" && (
        <div className="fixed inset-x-0 bottom-14 z-40 border-t border-[#262626] bg-[#181818]/95 p-3 backdrop-blur md:hidden">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setBetSide("yes")}
              className="h-11 rounded-[6px] bg-[#d9ff00] px-3 text-left text-black shadow-lg active:scale-[0.98]"
            >
              <span className="block text-[10px] font-bold uppercase tracking-[0.12em]">YES</span>
              <span className="font-mono text-sm font-semibold">{Math.round(yesPrice * 100)}% - {yesMult.toFixed(2)}x</span>
            </button>
            <button
              onClick={() => setBetSide("no")}
              className="h-11 rounded-[6px] bg-[#3b6ffa] px-3 text-left text-white shadow-lg active:scale-[0.98]"
            >
              <span className="block text-[10px] font-bold uppercase tracking-[0.12em]">NO</span>
              <span className="font-mono text-sm font-semibold">{Math.round(noPrice * 100)}% - {noMult.toFixed(2)}x</span>
            </button>
          </div>
        </div>
      )}

      {betSide && (
        <BetForm
          market={view}
          side={betSide}
          onClose={() => setBetSide(null)}
          gaslessAvailable={isZeroDevGaslessEnabled()}
          onConfirm={async (stake, onStep, opts) => {
            try {
              await placeBet({
                marketId: view.id,
                side: betSide.toUpperCase() as "YES" | "NO",
                stakeUsd: stake,
                poolAddress: view.poolAddress,
                chainId: view.chainId,
              }, onStep, { gasless: opts.gasless });
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

type GmxSignal = {
  configured: boolean;
  found: boolean;
  symbol?: string;
  market?: string;
  marketTokenAddress?: string;
  liquidityUsd?: number;
  openInterestLongUsd?: number;
  openInterestShortUsd?: number;
  priceChangePercent24h?: number;
  fundingLongAprEstimate?: number;
  fundingShortAprEstimate?: number;
  apy?: { apy?: number; baseApy?: number; bonusApr?: number };
  performance?: { performance?: string };
  ohlcv?: Array<{ timestamp: number; close: string }>;
  trades?: { rows: Array<{ id: string; eventName: string; timestamp: number; transactionHash: string }> };
  sourceUrl?: string;
  evidence?: { fields?: string[]; resolutionUse?: string };
};

function GmxSignalCards({ market }: { market: Market }) {
  const descriptor = gmxDescriptorForMarket(market);
  const [signal, setSignal] = useState<GmxSignal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!descriptor) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (descriptor.symbol) params.set("symbol", descriptor.symbol);
      if (descriptor.marketTokenAddress) params.set("marketTokenAddress", descriptor.marketTokenAddress);
      params.set("limit", "24");
      void fetch(`/api/integrations/gmx/signal?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await response.text());
          return response.json() as Promise<GmxSignal>;
        })
        .then((nextSignal) => {
          setSignal(nextSignal);
          setError(null);
        })
        .catch((nextError) => {
          if (controller.signal.aborted) return;
          setSignal(null);
          setError(nextError instanceof Error ? nextError.message : "GMX signal unavailable.");
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // descriptor is recomputed each render from `market`; depend on its stable
    // primitive fields, not the object identity, to avoid a refetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor?.symbol, descriptor?.marketTokenAddress]);

  if (!descriptor) return null;
  if (error || signal?.found === false) {
    return (
      <div className="panel p-4 mb-5 border-[#34312e]">
        <div className="flex items-center gap-2 text-[12px] text-gray-400">
          <LineChart className="h-4 w-4" />
          GMX signal unavailable for {descriptor.symbol ?? descriptor.marketTokenAddress}.
        </div>
      </div>
    );
  }
  if (!signal) {
    return (
      <div className="panel p-4 mb-5">
        <div className="flex items-center gap-2 text-[12px] text-gray-500">
          <LineChart className="h-4 w-4" />
          Loading GMX market intelligence...
        </div>
      </div>
    );
  }

  const totalOi = (signal.openInterestLongUsd ?? 0) + (signal.openInterestShortUsd ?? 0);
  const lastClose = signal.ohlcv?.at(-1)?.close;
  const recentTrade = signal.trades?.rows?.[0];

  return (
    <div className="panel p-4 mb-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <LineChart className="h-4 w-4 text-[#CCE9E7]" />
        <span className="text-[11px] text-gray-500">GMX signal cards</span>
        <span className="caps">{signal.market ?? signal.symbol ?? "market"}</span>
        <div className="flex-1" />
        {signal.sourceUrl && (
          <a href={signal.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[#CCE9E7]">
            GMX <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <TrustItem label="Liquidity" value={formatUsd(signal.liquidityUsd ?? 0)} />
        <TrustItem label="Open interest" value={formatUsd(totalOi)} />
        <TrustItem label="24h move" value={signal.priceChangePercent24h === undefined ? undefined : `${signal.priceChangePercent24h.toFixed(2)}%`} />
        <TrustItem label="GMX APY" value={signal.apy?.apy === undefined ? undefined : `${(signal.apy.apy * 100).toFixed(2)}%`} optional />
        <TrustItem label="Funding long APR" value={signal.fundingLongAprEstimate === undefined ? undefined : `${signal.fundingLongAprEstimate.toFixed(2)}%`} optional />
        <TrustItem label="Funding short APR" value={signal.fundingShortAprEstimate === undefined ? undefined : `${signal.fundingShortAprEstimate.toFixed(2)}%`} optional />
        <TrustItem label="Last 1h close" value={lastClose} mono optional />
        <TrustItem label="30d performance" value={signal.performance?.performance} optional />
      </div>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <div className="rounded-[8px] border border-[#34312e] bg-[#211f1e] p-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-[#CCE9E7]" />
            <span className="caps">OHLCV evidence</span>
          </div>
          <div className="mt-2 text-[12px] text-gray-400">
            {signal.ohlcv?.length ? `${signal.ohlcv.length} hourly candles loaded from GMX.` : "No OHLCV candles returned."}
          </div>
        </div>
        <div className="rounded-[8px] border border-[#34312e] bg-[#211f1e] p-3">
          <div className="flex items-center gap-2">
            <ExternalLink className="h-3.5 w-3.5 text-[#CCE9E7]" />
            <span className="caps">Recent trade evidence</span>
          </div>
          <div className="mt-2 text-[12px] text-gray-400">
            {recentTrade
              ? `${recentTrade.eventName} at ${new Date(recentTrade.timestamp * 1000).toLocaleString()}`
              : "No recent GMX trades returned."}
          </div>
        </div>
      </div>
      {signal.evidence?.resolutionUse && (
        <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
          {signal.evidence.resolutionUse}
        </p>
      )}
    </div>
  );
}

function gmxDescriptorForMarket(market: Market): { symbol?: string; marketTokenAddress?: string } | null {
  const haystack = [market.title, market.description, market.sourceUrl, market.resolutionCriteria].filter(Boolean).join("\n");
  const address = haystack.match(/marketTokenAddress:\s*(0x[a-fA-F0-9]{40})/)?.[1];
  const symbol = haystack.match(/\b(BTC|ETH|SOL|ARB|AVAX|LINK|DOGE|XRP|BNB)\b/i)?.[1]?.toUpperCase();
  const gmxSource = /gmx\.io|GMX/i.test(haystack);
  if (!address && !symbol && !gmxSource) return null;
  return { symbol, marketTokenAddress: address };
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

type LiquiditySnapshot = {
  marketId: string;
  mode: "parimutuel" | "amm";
  yesReserveUsd: number;
  noReserveUsd: number;
  yesShares: number;
  noShares: number;
  vaultDebtUsd: number;
  vaultSurplusUsd: number;
  updatedAtIso: string | null;
};

type MarketGroupSnapshot = {
  id: string;
  title: string;
  outcomes: Array<{ id: string; marketId: string; label: string; probabilityBps: number; resolvedOutcome?: string }>;
};

type GroupArbitrageSnapshot = {
  groupId: string;
  totalProbabilityBps: number;
  overroundBps: number;
  coherent: boolean;
};

function TradeModePanel({
  mode,
  onModeChange,
}: {
  mode: "market" | "limit";
  onModeChange: (mode: "market" | "limit") => void;
}) {
  return (
    <div className="panel mb-5 flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="inline-flex rounded-[6px] border border-[#262626] bg-[#0b0b0b] p-1">
        {(["market", "limit"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onModeChange(item)}
            className={`rounded-[5px] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${
              mode === item ? "bg-[#CCE9E7] text-black" : "text-gray-500 hover:text-white"
            }`}
          >
            {item === "market" ? "Market" : "Limit"}
          </button>
        ))}
      </div>
      <span className="caps">{mode === "market" ? "pool execution" : "signed intents"}</span>
    </div>
  );
}

function AmmExitPanel({
  market,
  liquidity,
  address,
}: {
  market: Market;
  liquidity: LiquiditySnapshot | null;
  address?: string;
}) {
  const [mode, setMode] = useState<"buy" | "sell" | "lp">("buy");
  const [lpAction, setLpAction] = useState<"add" | "remove">("add");
  const [side, setSide] = useState<"YES" | "NO">("YES");
  // USDC for buy / lp-add, shares for sell, LP shares for lp-remove.
  const [amount, setAmount] = useState("10");
  const [quote, setQuote] = useState<{ amountUsd: number; priceBps: number; shares?: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (market.liquidityMode !== "amm") return null;

  const stakeToken = market.chainId ? stakeTokenForChain(market.chainId) : undefined;
  const amountLabel = mode === "sell" ? "Shares" : mode === "lp" && lpAction === "remove" ? "LP shares" : "USDC";
  const showSide = mode !== "lp";
  const showQuote = mode === "buy" || mode === "sell";
  const actionLabel = mode === "lp" ? (lpAction === "add" ? "Add" : "Remove") : mode === "buy" ? "Buy" : "Sell";

  async function refreshQuote() {
    setStatus(null);
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setQuote(null);
      setStatus("Invalid amount.");
      return;
    }
    if (!showQuote) {
      setQuote(null);
      return;
    }
    const payload =
      mode === "buy"
        ? { side, action: "buy", amountUsd: parsed }
        : { side, action: "sell", shares: parsed };
    const response = await fetch(`/api/markets/${encodeURIComponent(market.id)}/share-quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      setQuote(null);
      setStatus("AMM quote unavailable.");
      return;
    }
    const body = (await response.json()) as { amountUsd: number; priceBps: number; shares?: number };
    setQuote({ amountUsd: body.amountUsd, priceBps: body.priceBps, shares: body.shares });
  }

  async function ensureApproval(units: bigint) {
    if (!stakeToken || !market.poolAddress || !market.chainId || !address) return;
    const allowance = (await readContract(wagmiConfig, {
      address: stakeToken,
      abi: testUsdcAbi,
      functionName: "allowance",
      args: [address as Address, market.poolAddress as Address],
      chainId: market.chainId,
    })) as bigint;
    if (allowance < units) {
      setStatus("Approving USDC spend.");
      const approveHash = await writeContract(wagmiConfig, {
        address: stakeToken,
        abi: testUsdcAbi,
        functionName: "approve",
        args: [market.poolAddress as Address, 2n ** 256n - 1n],
        chainId: market.chainId,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: approveHash, chainId: market.chainId, timeout: 90_000 });
    }
  }

  async function execute() {
    if (!address) {
      setStatus("Connect wallet first.");
      return;
    }
    if (!market.poolAddress || !market.chainId) {
      setStatus("Pool address or chain id missing.");
      return;
    }
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setStatus("Invalid amount.");
      return;
    }
    const units = parseUnits(amount, 6);
    const sideIdx = side === "YES" ? 0 : 1;
    setBusy(true);
    try {
      let hash: `0x${string}`;
      if (mode === "buy") {
        await ensureApproval(units);
        setStatus("Waiting for wallet signature.");
        hash = await writeContract(wagmiConfig, {
          address: market.poolAddress as Address,
          abi: outcomeSharePoolAbi,
          functionName: "buy",
          args: [sideIdx, units],
          chainId: market.chainId,
        });
      } else if (mode === "sell") {
        setStatus("Waiting for wallet signature.");
        hash = await writeContract(wagmiConfig, {
          address: market.poolAddress as Address,
          abi: outcomeSharePoolAbi,
          functionName: "sell",
          args: [sideIdx, units],
          chainId: market.chainId,
        });
      } else if (lpAction === "add") {
        await ensureApproval(units);
        setStatus("Waiting for wallet signature.");
        hash = await writeContract(wagmiConfig, {
          address: market.poolAddress as Address,
          abi: outcomeSharePoolAbi,
          functionName: "addLiquidity",
          args: [units],
          chainId: market.chainId,
        });
      } else {
        setStatus("Waiting for wallet signature.");
        hash = await writeContract(wagmiConfig, {
          address: market.poolAddress as Address,
          abi: outcomeSharePoolAbi,
          functionName: "removeLiquidity",
          args: [units],
          chainId: market.chainId,
        });
      }
      setStatus("Confirming transaction.");
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId: market.chainId, timeout: 90_000 });
      if (mode === "buy" || mode === "sell") {
        setStatus("Syncing indexed share trade.");
        await fetch("/api/sync/share-transaction", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transactionHash: hash, chainId: market.chainId }),
        }).catch(() => undefined);
      }
      setStatus(`${actionLabel} confirmed.`);
      await refreshQuote();
    } catch (error) {
      const decoded = describeTxError(error);
      setStatus(decoded.rejected ? "Request cancelled." : decoded.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel p-4 mb-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500">AMM · constant product (x*y=k)</span>
        <Pill tone={liquidity?.mode === "amm" ? "accent" : "neutral"}>
          {liquidity?.mode === "amm" ? "indexed" : "awaiting index"}
        </Pill>
      </div>
      {liquidity?.mode === "amm" ? (
        <>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
            <TrustItem label="YES reserve" value={formatUsd(liquidity.yesReserveUsd)} />
            <TrustItem label="NO reserve" value={formatUsd(liquidity.noReserveUsd)} />
            <TrustItem label="Vault debt" value={formatUsd(liquidity.vaultDebtUsd)} />
            <TrustItem label="Vault surplus" value={formatUsd(liquidity.vaultSurplusUsd)} />
          </div>

          <div className="mt-3 inline-flex rounded-[7px] border border-[#262626] bg-[#111111] p-0.5">
            {(["buy", "sell", "lp"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setQuote(null);
                  setStatus(null);
                }}
                className={`rounded-[5px] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] ${
                  mode === m ? "bg-[#CCE9E7] text-black" : "text-gray-400"
                }`}
              >
                {m === "lp" ? "Liquidity" : m}
              </button>
            ))}
          </div>
          {mode === "lp" && (
            <div className="mt-2 inline-flex gap-2 text-[11px]">
              {(["add", "remove"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setLpAction(a)}
                  className={`rounded-[5px] border px-2.5 py-1 uppercase tracking-[0.1em] ${
                    lpAction === a ? "border-[#CCE9E7] text-white" : "border-[#262626] text-gray-500"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-[120px_1fr_140px_140px]">
            {showSide ? (
              <select
                value={side}
                onChange={(event) => setSide(event.target.value as "YES" | "NO")}
                className="rounded-[6px] border border-[#262626] bg-[#111111] px-3 py-2 text-[12px] text-white outline-none"
              >
                <option value="YES">YES</option>
                <option value="NO">NO</option>
              </select>
            ) : (
              <div className="hidden md:block" />
            )}
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              className="rounded-[6px] border border-[#262626] bg-[#111111] px-3 py-2 text-[12px] text-white outline-none"
              placeholder={amountLabel}
            />
            <button
              type="button"
              disabled={!showQuote}
              onClick={() => void refreshQuote()}
              className="rounded-[6px] border border-[#333] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-200 hover:border-[#CCE9E7] disabled:opacity-30"
            >
              Quote
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void execute()}
              className="rounded-[6px] bg-[#CCE9E7] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-black disabled:opacity-50"
            >
              {actionLabel}
            </button>
          </div>
          {(quote || status) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-gray-400">
              {quote && (
                <span>
                  {mode === "buy"
                    ? `${quote.shares ?? 0} shares`
                    : formatUsd(quote.amountUsd)}{" "}
                  at {(quote.priceBps / 100).toFixed(2)}%
                </span>
              )}
              {status && <span className="text-gray-500">{status}</span>}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-[6px] border border-[#262626] bg-[#111111] px-3 py-3 text-[11.5px] text-gray-500">
          No AMM liquidity rows are indexed for this market yet.
        </div>
      )}
    </div>
  );
}

function LimitOrderPanel({
  market,
  orders,
  bestBidBps,
  bestAskBps,
  address,
}: {
  market: Market;
  orders: OrderIntent[];
  bestBidBps?: number;
  bestAskBps?: number;
  address?: string;
}) {
  return (
    <>
      <LimitOrderComposer market={market} address={address} />
      <OrderbookPanel orders={orders} bestBidBps={bestBidBps} bestAskBps={bestAskBps} market={market} address={address} />
    </>
  );
}

// Reconstruct the exact on-chain OrderIntent struct the maker signed, so the
// matcher can verify the stored signature. amount is in 6-decimals; side and
// orderType are the uint8 the contract expects.
function toOnchainOrder(order: OrderIntent, localMarketId: bigint) {
  return {
    marketId: localMarketId,
    pool: order.pool as Address,
    side: order.side === "YES" ? 0 : 1,
    orderType: (order.orderType as string) === "sell" ? 1 : 0,
    amount: parseUnits(String(order.amountUsd), 6),
    limitPriceBps: BigInt(order.limitPriceBps),
    expiresAt: BigInt(Math.floor(new Date(order.expiresAtIso).getTime() / 1000)),
    nonce: BigInt(order.nonce),
    maker: order.maker as Address,
    builder: (order.builder ?? zeroAddress) as Address,
    metadataHash: order.metadataHash as `0x${string}`,
  };
}

// Resolve the ERC-20 a settlement leg moves: cash (USDC) or the side's outcome
// share token (read off the pool). Used for the taker fill allowance and the
// maker's approve-settlement step.
async function resolveSettlementToken(
  leg: "cash" | "shares",
  side: "YES" | "NO",
  pool: Address,
  chainId: number,
): Promise<Address> {
  if (leg === "cash") return stakeTokenForChain(chainId) as Address;
  const fn = side === "YES" ? "yesToken" : "noToken";
  const token = await readContract(wagmiConfig, {
    address: pool,
    abi: outcomeSharePoolAbi,
    functionName: fn,
  });
  return token as Address;
}

function LimitOrderComposer({ market, address }: { market: Market; address?: string }) {
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [orderType, setOrderType] = useState<"buy" | "sell">("buy");
  const [amountUsd, setAmountUsd] = useState("25");
  const [limitPrice, setLimitPrice] = useState("50");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const matcherAddress = process.env.NEXT_PUBLIC_ORDER_MATCHER_ADDRESS as `0x${string}` | undefined;

  async function submitOrder() {
    if (!address) {
      setStatus("Connect wallet first.");
      return;
    }
    if (!market.poolAddress || !market.chainId) {
      setStatus("Pool address or chain id missing.");
      return;
    }
    if (!matcherAddress || !/^0x[0-9a-fA-F]{40}$/.test(matcherAddress)) {
      setStatus("Order matcher address missing.");
      return;
    }
    const amount = Number(amountUsd);
    const price = Number(limitPrice);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || price <= 0 || price > 100) {
      setStatus("Invalid amount or price.");
      return;
    }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const localMarketIdRaw = market.id.split(":").pop() ?? market.id;
    if (!/^\d+$/.test(localMarketIdRaw)) {
      setStatus("Numeric chain market id required.");
      return;
    }
    const localMarketId = BigInt(localMarketIdRaw);
    const nonce = String(Date.now());
    const metadataHash = keccak256(stringToBytes(JSON.stringify({ marketId: market.id, source: "adjudex-ui" })));
    setBusy(true);
    setStatus("Waiting for wallet signature.");
    try {
      const signature = await signTypedData(wagmiConfig, {
        account: address as Address,
        domain: {
          name: "AdjudexOrderMatcher",
          version: "1",
          chainId: market.chainId,
          verifyingContract: matcherAddress,
        },
        types: {
          OrderIntent: [
            { name: "marketId", type: "uint256" },
            { name: "pool", type: "address" },
            { name: "side", type: "uint8" },
            { name: "orderType", type: "uint8" },
            { name: "amount", type: "uint256" },
            { name: "limitPriceBps", type: "uint256" },
            { name: "expiresAt", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "maker", type: "address" },
            { name: "builder", type: "address" },
            { name: "metadataHash", type: "bytes32" },
          ],
        },
        primaryType: "OrderIntent",
        message: {
          marketId: localMarketId,
          pool: market.poolAddress,
          side: side === "YES" ? 0 : 1,
          orderType: orderType === "buy" ? 0 : 1,
          amount: parseUnits(amountUsd, 6),
          limitPriceBps: BigInt(Math.round(price * 100)),
          expiresAt: BigInt(Math.floor(expiresAt.getTime() / 1000)),
          nonce: BigInt(nonce),
          maker: address as Address,
          builder: zeroAddress,
          metadataHash,
        },
      });
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketId: market.id,
          pool: market.poolAddress,
          side,
          orderType,
          amountUsd: amount,
          limitPriceBps: Math.round(price * 100),
          expiresAtIso: expiresAt.toISOString(),
          nonce,
          maker: address,
          builder: zeroAddress,
          metadataHash,
          signature,
        }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "SIWE session required." : "Order rejected.");
      setStatus("Signed order stored.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Order failed.");
    } finally {
      setBusy(false);
    }
  }

  // A signed order only settles if the matcher can move the maker's leg. Grant
  // that allowance up front: cash when buying, the outcome share token selling.
  async function approveSettlement() {
    if (!address) return setStatus("Connect wallet first.");
    if (!market.poolAddress || !market.chainId) return setStatus("Pool/chain missing.");
    if (!matcherAddress || !/^0x[0-9a-fA-F]{40}$/.test(matcherAddress)) return setStatus("Order matcher address missing.");
    const amount = Number(amountUsd);
    const price = Number(limitPrice);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || price <= 0 || price > 100) {
      return setStatus("Invalid amount or price.");
    }
    const shares = parseUnits(amountUsd, 6);
    const cost = (shares * BigInt(Math.round(price * 100))) / 10_000n;
    setBusy(true);
    setStatus("Approving settlement allowance…");
    try {
      const buys = orderType === "buy";
      const token = await resolveSettlementToken(buys ? "cash" : "shares", side, market.poolAddress as Address, market.chainId);
      const allowance = buys ? cost : shares;
      const approveHash = await writeContract(wagmiConfig, {
        address: token,
        abi: testUsdcAbi,
        functionName: "approve",
        args: [matcherAddress, allowance],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
      setStatus("Matcher approved to settle this order.");
    } catch (error) {
      setStatus(describeTxError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel p-4 mb-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500">Limit order</span>
        <span className="caps">EIP-712</span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[100px_100px_1fr_1fr_140px]">
        <select value={side} onChange={(event) => setSide(event.target.value as "YES" | "NO")} className="rounded-[6px] border border-[#262626] bg-[#111111] px-3 py-2 text-[12px] text-white outline-none">
          <option value="YES">YES</option>
          <option value="NO">NO</option>
        </select>
        <select value={orderType} onChange={(event) => setOrderType(event.target.value as "buy" | "sell")} className="rounded-[6px] border border-[#262626] bg-[#111111] px-3 py-2 text-[12px] text-white outline-none">
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        <input value={amountUsd} onChange={(event) => setAmountUsd(event.target.value)} inputMode="decimal" placeholder="USDC" className="rounded-[6px] border border-[#262626] bg-[#111111] px-3 py-2 text-[12px] text-white outline-none" />
        <input value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} inputMode="decimal" placeholder="Price %" className="rounded-[6px] border border-[#262626] bg-[#111111] px-3 py-2 text-[12px] text-white outline-none" />
        <button type="button" disabled={busy} onClick={() => void submitOrder()} className="rounded-[6px] bg-[#CCE9E7] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-black disabled:opacity-50">
          Sign
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10.5px] text-gray-600">Approve the matcher so takers can settle your order on-chain.</span>
        <button type="button" disabled={busy} onClick={() => void approveSettlement()} className="rounded-[5px] border border-[#2a2a2a] bg-[#232323] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-200 hover:border-[#3a3a3a] hover:text-white disabled:opacity-40">
          Approve settlement
        </button>
      </div>
      {status && <div className="mt-2 text-[11.5px] text-gray-500">{status}</div>}
    </div>
  );
}

function OrderbookPanel({ orders, bestBidBps, bestAskBps, market, address }: { orders: OrderIntent[]; bestBidBps?: number; bestAskBps?: number; market: Market; address?: string }) {
  const bids = orders.filter((order) => order.side === "YES").sort((a, b) => b.limitPriceBps - a.limitPriceBps).slice(0, 5);
  const asks = orders.filter((order) => order.side === "NO").sort((a, b) => a.limitPriceBps - b.limitPriceBps).slice(0, 5);
  if (orders.length === 0 && bestBidBps === undefined && bestAskBps === undefined) return null;
  return (
    <div className="panel p-4 mb-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500">Signed order intents</span>
        <span className="caps">settlement tx required</span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <TrustItem label="Best bid" value={bestBidBps === undefined ? undefined : `${(bestBidBps / 100).toFixed(2)}%`} optional />
        <TrustItem label="Best ask" value={bestAskBps === undefined ? undefined : `${(bestAskBps / 100).toFixed(2)}%`} optional />
        <TrustItem label="Open orders" value={orders.length.toString()} />
        <TrustItem label="Depth" value={formatUsd(orders.reduce((sum, order) => sum + order.amountUsd, 0))} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <OrderbookSide title="Bids" orders={bids} market={market} address={address} />
        <OrderbookSide title="Asks" orders={asks} market={market} address={address} />
      </div>
    </div>
  );
}

function OrderbookSide({ title, orders, market, address }: { title: string; orders: OrderIntent[]; market: Market; address?: string }) {
  return (
    <div className="rounded-[6px] border border-[#262626] bg-[#111111] p-3">
      <div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-gray-500">{title}</div>
      {orders.length === 0 ? (
        <div className="text-[11px] text-gray-500">No indexed open orders.</div>
      ) : (
        <div className="space-y-1.5">
          {orders.map((order) => (
            <div key={order.hash} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 text-[11px]">
              <span className="font-mono text-gray-300">{(order.limitPriceBps / 100).toFixed(2)}%</span>
              <span className="text-gray-400">{formatUsd(order.amountUsd)}</span>
              <FillButton order={order} market={market} address={address} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Taker-side fill: sign a crossing intent and settle the resting maker order
// on-chain via matchOrders. The taker approves only their own leg (cash if
// buying, the outcome share token if selling); the maker must have approved
// their leg when they posted, or the settlement reverts.
function FillButton({ order, market, address }: { order: OrderIntent; market: Market; address?: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const matcherAddress = process.env.NEXT_PUBLIC_ORDER_MATCHER_ADDRESS as `0x${string}` | undefined;
  const fillable = order.status === "open" && !!address && order.maker.toLowerCase() !== address?.toLowerCase();

  async function fill() {
    if (!address) return setStatus("Connect wallet.");
    if (!market.poolAddress || !market.chainId) return setStatus("Pool/chain missing.");
    if (!matcherAddress || !/^0x[0-9a-fA-F]{40}$/.test(matcherAddress)) return setStatus("Matcher address missing.");
    const localId = (market.id.split(":").pop() ?? market.id);
    if (!/^\d+$/.test(localId)) return setStatus("Numeric market id required.");
    const makerIsSell = (order.orderType as string) === "sell";
    const takerType = makerIsSell ? "buy" : "sell";
    setBusy(true);
    setStatus("Preparing fill…");
    try {
      const maker = toOnchainOrder(order, BigInt(localId));
      const amount = maker.amount;
      const cost = (amount * maker.limitPriceBps) / 10_000n;
      // Taker intent crosses the maker at the same price, same side, opposite type.
      const takerStruct = {
        marketId: BigInt(localId),
        pool: market.poolAddress as Address,
        side: order.side === "YES" ? 0 : 1,
        orderType: takerType === "sell" ? 1 : 0,
        amount,
        limitPriceBps: maker.limitPriceBps,
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
        nonce: BigInt(Date.now()),
        maker: address as Address,
        builder: zeroAddress as Address,
        metadataHash: keccak256(stringToBytes(JSON.stringify({ fill: order.hash }))),
      };
      setStatus("Sign your fill order…");
      const takerSignature = await signTypedData(wagmiConfig, {
        account: address as Address,
        domain: { name: "AdjudexOrderMatcher", version: "1", chainId: market.chainId, verifyingContract: matcherAddress },
        types: {
          OrderIntent: [
            { name: "marketId", type: "uint256" },
            { name: "pool", type: "address" },
            { name: "side", type: "uint8" },
            { name: "orderType", type: "uint8" },
            { name: "amount", type: "uint256" },
            { name: "limitPriceBps", type: "uint256" },
            { name: "expiresAt", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "maker", type: "address" },
            { name: "builder", type: "address" },
            { name: "metadataHash", type: "bytes32" },
          ],
        },
        primaryType: "OrderIntent",
        message: takerStruct,
      });
      // Approve the taker's leg: cash when buying, shares when selling.
      const takerBuys = takerType === "buy";
      const token = await resolveSettlementToken(takerBuys ? "cash" : "shares", order.side, market.poolAddress as Address, market.chainId);
      const allowanceNeeded = takerBuys ? cost : amount;
      if (allowanceNeeded > 0n) {
        setStatus("Approve settlement allowance…");
        const approveHash = await writeContract(wagmiConfig, {
          address: token,
          abi: testUsdcAbi,
          functionName: "approve",
          args: [matcherAddress, allowanceNeeded],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
      }
      setStatus("Settling on-chain…");
      const hash = await writeContract(wagmiConfig, {
        address: matcherAddress,
        abi: adjudexOrderMatcherAbi,
        functionName: "matchOrders",
        args: [takerStruct, takerSignature, [maker], [order.signature as `0x${string}`], 0n, zeroAddress],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setStatus("Filled. Indexer will mark it settled.");
    } catch (error) {
      setStatus(describeTxError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={!fillable || busy}
        onClick={() => void fill()}
        className="rounded-[5px] border border-[#2a2a2a] bg-[#232323] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-200 hover:border-[#3a3a3a] hover:text-white disabled:opacity-40"
        title={order.maker.toLowerCase() === address?.toLowerCase() ? "Your own order" : "Settle this order on-chain"}
      >
        {busy ? "…" : "Fill"}
      </button>
      {status && <span className="max-w-[160px] text-right text-[10px] text-gray-500">{status}</span>}
    </div>
  );
}

function MarketGroupPanel({ group, arbitrage }: { group: MarketGroupSnapshot | null; arbitrage: GroupArbitrageSnapshot | null }) {
  if (!group) return null;
  return (
    <div className="panel p-4 mb-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500">Exclusive outcome group</span>
        <Pill tone={arbitrage?.coherent ? "accent" : "neutral"}>
          {arbitrage ? `${(arbitrage.totalProbabilityBps / 100).toFixed(2)}% total` : "probability pending"}
        </Pill>
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-4">
        {group.outcomes.map((outcome) => (
          <TrustItem
            key={outcome.id}
            label={outcome.label}
            value={`${(outcome.probabilityBps / 100).toFixed(2)}%`}
          />
        ))}
      </div>
      {arbitrage && !arbitrage.coherent && (
        <div className="mt-3 rounded-[6px] border border-[#5f4421] bg-[#21180f] px-3 py-2 text-[11.5px] text-[#fbbf24]">
          Group probability is outside the coherence band by {(arbitrage.overroundBps / 100).toFixed(2)}%.
        </div>
      )}
    </div>
  );
}

function ResolutionTimelinePanel({ disputes, explorerBase }: { disputes: ResolutionDispute[]; explorerBase: string }) {
  if (disputes.length === 0) return null;
  return (
    <div className="panel p-4 mb-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500">Resolution timeline</span>
        <span className="caps">contract-indexed</span>
      </div>
      <div className="space-y-2">
        {disputes.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-[6px] border border-[#262626] bg-[#111111] px-3 py-2 text-[11.5px]">
            <span className="caps">{item.status}</span>
            {item.outcome && <span className="text-gray-300">{item.outcome}</span>}
            {item.challengerAddress && <span className="font-mono text-gray-500">{item.challengerAddress}</span>}
            {item.bondAmount > 0 && <span className="font-mono text-gray-400">bond {item.bondAmount}</span>}
            <span className="ml-auto font-mono text-gray-500">{formatAgo(item.createdAtIso)}</span>
            {item.transactionHash && (
              <a href={txUrl(explorerBase, item.transactionHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#7ef4c8]">
                tx <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OpportunityPanel({ opportunities }: { opportunities: Opportunity[] }) {
  if (opportunities.length === 0) return null;
  return (
    <div className="panel p-4 mb-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500">Opportunities</span>
        <span className="caps">no auto execution</span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {opportunities.map((item) => (
          <div key={item.id} className="rounded-[6px] border border-[#262626] bg-[#111111] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-gray-200">{item.title}</span>
              <span className="font-mono text-[11px] text-[#CCE9E7]">{(item.probabilityGapBps / 100).toFixed(2)}%</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-500">
              <span>Depth {formatUsd(item.liquidityDepthUsd)}</span>
              <span>Confidence {(item.confidence * 100).toFixed(1)}%</span>
            </div>
            {item.sourceUrl && (
              <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#7ef4c8]">
                source <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
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
