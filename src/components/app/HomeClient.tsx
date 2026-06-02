"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIcon, BadgeDollarSign, BarChart3, Bot, FileText, Plus, MoreHorizontal, Info, Search, ShieldCheck, Star, Wallet2 } from "lucide-react";
import {
  ActivityFeedItem,
  type Activity,
} from "@/components/dashboard/market-atoms";
import { Hero } from "@/components/dashboard/hero";
import { PillarGrid } from "@/components/dashboard/pillar-grid";
import { HomeNav, type HomeNavTab } from "@/components/dashboard/home-nav";
import { MarketsGrid } from "@/components/dashboard/markets-grid";
import { useActivity } from "@/lib/hooks/useActivity";
import { useMarkets } from "@/lib/hooks/useMarkets";
import { useSystemStatus } from "@/lib/hooks/useSystemStatus";
import { useWallet } from "@/lib/hooks/useWallet";
import { toMarketView, formatUsd, type MarketView } from "@/lib/market-view";
import type { WatchlistItem } from "@/lib/types/domain";

const RANGES = ["Daily", "Weekly", "Monthly"] as const;
type Range = (typeof RANGES)[number];

function greetingNow(): string {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeClient() {
  const { markets, isLoading: marketsLoading, error: marketsError } = useMarkets();
  const { account } = useWallet();
  const { events, error: activityError } = useActivity(9);
  const { status, error: statusError } = useSystemStatus();
  const [range, setRange] = useState<Range>("Monthly");
  const [tableQuery, setTableQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [heroTab, setHeroTab] = useState<HomeNavTab>("discover");
  const [sortMode, setSortMode] = useState<"volume" | "new">("volume");
  const [watchlistIds, setWatchlistIds] = useState<string[]>([]);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  const views: MarketView[] = useMemo(
    () => markets.map((m) => toMarketView(m)),
    [markets],
  );
  const totalVolume = useMemo(
    () => views.reduce((s, v) => s + v.volume, 0),
    [views],
  );
  const totalBettors = useMemo(
    () => views.reduce((s, v) => s + v.bettors, 0),
    [views],
  );
  const totalAiLps = useMemo(
    () => views.reduce((s, v) => s + v.aiLpCount, 0),
    [views],
  );
  const resolvedCount = useMemo(
    () => events.filter((e) => e.kind === "resolution").length,
    [events],
  );
  const openCount = useMemo(
    () => views.filter((v) => v.lifecycle === "open").length,
    [views],
  );
  const resolvingCount = useMemo(
    () => views.filter((v) => v.lifecycle === "locked" || v.lifecycle === "resolving").length,
    [views],
  );

  const tableRows = useMemo(() => {
    const q = tableQuery.trim().toLowerCase();
    return views
      .filter((v) => categoryFilter === "all" || v.rawCategory === categoryFilter)
      .filter((v) =>
        q
          ? v.title.toLowerCase().includes(q) ||
            v.ticker.toLowerCase().includes(q)
          : true,
      )
      .sort((a, b) => b.volume - a.volume);
  }, [views, tableQuery, categoryFilter]);
  const watchedViews = useMemo(() => {
    const ids = new Set(watchlistIds);
    return views.filter((view) => ids.has(view.id));
  }, [views, watchlistIds]);

  const activityItems: Activity[] = events.map(eventToActivity);
  const walletShort = account?.walletShort ?? "0x...";
  const productDataError = marketsError || activityError;
  const dataUnavailable = Boolean(productDataError) && views.length === 0;

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/watchlist", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        const items = (await response.json()) as WatchlistItem[];
        setWatchlistIds(items.map((item) => item.marketId));
        setWatchlistError(null);
      })
      .catch((nextError) => {
        if (controller.signal.aborted) return;
        setWatchlistIds([]);
        setWatchlistError(nextError instanceof Error ? nextError.message : "Watchlist requires wallet sign-in.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setWatchlistLoading(false);
      });
    return () => controller.abort();
  }, [account?.address]);

  return (
    <div className="pb-10">
      <HomeNav
        hero={heroTab}
        setHero={setHeroTab}
        category={
          (categoryFilter as "all" | "stocks" | "crypto" | "sports" | "esports" | "soft")
        }
        setCategory={(c) => setCategoryFilter(c)}
        sort={sortMode}
        setSort={setSortMode}
      />
      <div className="mb-7">
        <MarketsGrid
          views={(() => {
            const filtered = views.filter(
              (v) => categoryFilter === "all" || v.rawCategory === categoryFilter,
            );
            return sortMode === "volume"
              ? [...filtered].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
              : [...filtered].sort((a, b) =>
                  (b.deadlineIso ?? "").localeCompare(a.deadlineIso ?? ""),
                );
          })()}
          emptyHint={
            marketsError
              ? "Markets unavailable. Check backend, DB, RPC, and indexer status."
              : "No markets to show in this category yet."
          }
        />
      </div>
      {/* Legacy hero/pillargrid/table preserved below for opt-in
          drill-down. Set SHOW_LEGACY_HOME = true to render them. */}
      {SHOW_LEGACY_HOME && (
      <>
      <Hero recentActivity={events} />
      <PillarGrid />

      {/* page head */}
      <div className="flex items-center gap-4 mb-[18px] flex-wrap">
        <h1
          className="text-[22px] font-semibold tracking-[-0.01em]"
          style={{ color: "var(--tx)" }}
        >
          {greetingNow()},{" "}
          <span className="font-mono" style={{ color: "var(--t2)" }}>
            {walletShort}
          </span>
        </h1>
        <div className="flex-1" />
        <div className="seg">
          {RANGES.map((r) => (
            <button
              key={r}
              className={r === range ? "on" : ""}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <Link href="/create" className="btn primary">
          <Plus className="w-3.5 h-3.5" />
          New market
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-[14px] mb-4">
        <ProductEntry
          href="/"
          title="Live Markets"
          detail={marketsError ? "backend unavailable" : marketsLoading ? "loading indexed markets" : `${views.length} indexed markets`}
          icon={<ActivityIcon className="w-4 h-4" />}
        />
        <ProductEntry
          href="/portfolio"
          title="My Portfolio"
          detail={account ? account.walletShort : "Connect wallet"}
          icon={<Wallet2 className="w-4 h-4" />}
        />
        <ProductEntry
          href="/create"
          title="Create Market"
          detail="Studio + importer"
          icon={<Plus className="w-4 h-4" />}
        />
        <ProductEntry
          href="/agents"
          title="Agents"
          detail={`${totalAiLps} AI LP signals`}
          icon={<Bot className="w-4 h-4" />}
        />
        <ProductEntry
          href="/api/status"
          title="System Status"
          detail={status ? `block ${status.rpc.blockNumber ?? "n/a"}` : statusError ? "backend unavailable" : "checking"}
          icon={<ShieldCheck className="w-4 h-4" />}
        />
        <ProductEntry
          href="/analytics/retention"
          title="Retention"
          detail="D1 / D7 / D30"
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <ProductEntry
          href="/liquidity"
          title="Liquidity"
          detail="Incentives"
          icon={<BadgeDollarSign className="w-4 h-4" />}
        />
        <ProductEntry
          href="/docs"
          title="Docs / Proof"
          detail="Architecture"
          icon={<FileText className="w-4 h-4" />}
        />
      </div>

      {dataUnavailable && (
        <section className="panel mb-4 p-5">
          <div className="grid gap-2">
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--tx)" }}>
              Indexed market data unavailable
            </h2>
            <p className="max-w-[760px] text-[12.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
              Adjudex only renders markets and activity from the backend/indexer. The current request failed, so the dashboard is not showing fabricated totals or fallback records.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href="/api/status" className="btn">
                Check system status
              </Link>
              <Link href="/create" className="btn primary">
                Create market
              </Link>
              <Link href="/docs" className="btn">
                Open setup guide
              </Link>
            </div>
            <p className="font-mono text-[11px]" style={{ color: "var(--t4)" }}>
              {productDataError}
            </p>
          </div>
        </section>
      )}

      {/* stats x 4 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px] mb-4">
        <StatCard label="Total Volume" num={dataUnavailable ? "Unavailable" : formatUsd(totalVolume)} hint="USDC across pools" />
        <StatCard label="Active Markets" num={dataUnavailable ? "Unavailable" : String(openCount)} unit={dataUnavailable ? undefined : "markets"} hint={`${resolvingCount} locked/resolving`} />
        <StatCard label="AI LPs" num={dataUnavailable ? "Unavailable" : String(totalAiLps)} unit={dataUnavailable ? undefined : "agents"} hint="ERC-8004 registered" />
        <StatCard label="Traders" num={dataUnavailable ? "Unavailable" : String(totalBettors)} unit={dataUnavailable ? undefined : "addresses"} hint={`${resolvedCount} resolved 24h`} />
      </div>

      <section className="panel mb-4">
        <div className="panel-head">
          <span className="panel-title">
            Watchlist
            <Star className="w-3.5 h-3.5" style={{ color: "var(--t4)" }} />
          </span>
          <div className="flex-1" />
          <span className="caps">SIWE backend</span>
        </div>
        <div className="px-4 py-3">
          {watchlistLoading ? (
            <div className="text-[12px]" style={{ color: "var(--t3)" }}>
              Loading backend-persisted watchlist...
            </div>
          ) : watchlistError ? (
            <div className="grid gap-2 rounded-[8px] border p-3" style={{ borderColor: "var(--line)", background: "#211f1e" }}>
              <div className="text-[12.5px] font-medium" style={{ color: "var(--tx)" }}>
                Sign in to load your watchlist
              </div>
              <div className="text-[12px] leading-relaxed" style={{ color: "var(--t3)" }}>
                Watchlist is wallet-scoped and stored only through the backend after SIWE authentication.
              </div>
            </div>
          ) : watchedViews.length === 0 ? (
            <div className="grid gap-2 rounded-[8px] border p-3" style={{ borderColor: "var(--line)", background: "#211f1e" }}>
              <div className="text-[12.5px] font-medium" style={{ color: "var(--tx)" }}>
                No watched markets yet
              </div>
              <div className="text-[12px] leading-relaxed" style={{ color: "var(--t3)" }}>
                Open a market and press Watch. The record will be persisted by the backend for this wallet.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {watchedViews.slice(0, 6).map((market) => (
                <WatchlistCard key={market.id} market={market} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* chart + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-[14px] mb-4">
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">
              Volume by Market
              <Info className="w-3.5 h-3.5" style={{ color: "var(--t4)" }} />
            </span>
            <div className="flex-1" />
            <button className="dots-btn">
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-4 pt-3 pb-1 flex items-center gap-3 flex-wrap">
            <span className="text-[13px]" style={{ color: "var(--t2)" }}>
              Total
              <b className="ml-2 font-mono text-[17px]" style={{ color: "var(--tx)" }}>
                {formatUsd(totalVolume)}
              </b>
            </span>
            <span className="caps flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: "var(--accent)" }}
              />
              YES pool
            </span>
            <span className="caps flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full border"
                style={{ borderColor: "#6f6a65" }}
              />
              NO pool
            </span>
          </div>
          <div className="px-4 pb-4">
            <VolumeBars views={views} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">
              Live Activity
              <Info className="w-3.5 h-3.5" style={{ color: "var(--t4)" }} />
            </span>
            <div className="flex-1" />
            <span className="caps inline-flex items-center">
              <span className="live-dot" />
              live
            </span>
          </div>
          <div className="px-4 py-2">
            {activityError ? (
              <div className="grid gap-1 py-6 text-center">
                <div className="text-[12px]" style={{ color: "var(--tx)" }}>Activity unavailable</div>
                <div className="text-[11px]" style={{ color: "var(--t4)" }}>{activityError}</div>
              </div>
            ) : activityItems.length === 0 ? (
              <div
                className="text-[12px] py-6 text-center"
                style={{ color: "var(--t3)" }}
              >
                Waiting for on-chain events...
              </div>
            ) : (
              activityItems.slice(0, 8).map((a, i) => (
                <ActivityFeedItem key={i} item={a} />
              ))
            )}
          </div>
        </section>
      </div>

      {/* markets table */}
      <section id="markets-table" className="panel reveal" style={{ scrollMarginTop: 80 }}>
        <div
          className="flex items-center gap-3 px-4 py-3 border-b"
          style={{ borderColor: "var(--line-soft)" }}
        >
          <span className="panel-title">
            All Markets
            <Info className="w-3.5 h-3.5" style={{ color: "var(--t4)" }} />
          </span>
          <div className="flex items-center gap-1 ml-2 flex-wrap">
            {(["all", "stocks", "crypto", "sports", "esports", "soft"] as const).map((c) => {
              const active = categoryFilter === c;
              const label = c === "all" ? "All" : c === "soft" ? "Politics" : c[0].toUpperCase() + c.slice(1);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategoryFilter(c)}
                  className="h-7 px-2.5 rounded-full text-[11px] font-medium tracking-tight transition-colors"
                  style={{
                    background: active ? "var(--accent-bright)" : "#211f1e",
                    color: active ? "#0a0a0a" : "var(--t2)",
                    border: `1px solid ${active ? "var(--accent-bright)" : "#34312e"}`,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex-1" />
          <label
            className="flex items-center gap-2 w-[230px] h-8 px-3 rounded-[8px] border"
            style={{
              background: "#211f1e",
              borderColor: "#34312e",
              color: "var(--t3)",
            }}
          >
            <Search className="w-3.5 h-3.5" />
            <input
              value={tableQuery}
              onChange={(e) => setTableQuery(e.target.value)}
              placeholder="Search markets..."
              className="flex-1 bg-transparent outline-none text-[12.5px]"
              style={{ color: "var(--tx)", fontFamily: "inherit" }}
            />
          </label>
          <Link href="/create" className="btn primary">
            <Plus className="w-3.5 h-3.5" />
            Add Market
          </Link>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Market</th>
              <th>Category</th>
              <th>Status</th>
              <th>AI market-makers</th>
              <th className="right">YES%</th>
              <th className="right">Volume</th>
              <th className="right">Traders</th>
              <th className="right">Resolves</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ color: "var(--t3)", padding: "32px 14px", textAlign: "center" }}>
                  {marketsError ? "Markets unavailable. Check backend, DB, RPC, and indexer status." : "No live markets indexed yet. Create a market or configure a real indexed data source."}
                </td>
              </tr>
            ) : (
              tableRows.map((m) => (
                <tr key={m.id}>
                  <td className="id">{m.ticker}</td>
                  <td>
                    <Link
                      href={`/market/${encodeURIComponent(m.id)}`}
                      className="hover:underline"
                      style={{ color: "var(--tx)" }}
                    >
                      {m.title}
                    </Link>
                  </td>
                  <td style={{ color: "var(--t2)" }}>{m.category}</td>
                  <td>
                    <StatusBadge lifecycle={m.lifecycle} />
                  </td>
                  <td>
                    {m.aiLpCount > 0 ? (
                      <span className="b-badge ok">
                        <span className="d" /> {m.aiLpCount} AI LP{m.aiLpCount === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="b-badge ref">
                        <span className="d" /> none indexed
                      </span>
                    )}
                  </td>
                  <td className="num right">{Math.round(m.yesPct * 100)}%</td>
                  <td className="num right">{formatUsd(m.volume, { compact: true })}</td>
                  <td className="num right">{m.bettors}</td>
                  <td className="num right" style={{ color: "var(--t2)" }}>
                    {formatCountdownShort(m.resolvesInMs)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
      </>
      )}
    </div>
  );
}

const SHOW_LEGACY_HOME = false;

/* primitives */

function StatCard({
  label,
  num,
  unit,
  hint,
}: {
  label: string;
  num: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="stat-card reveal">
      <span className="stat-label">{label}</span>
      <div className="stat-row">
        <span className="stat-num">{num}</span>
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      <div className="stat-foot">
        <span className="ic">
          <Plus className="w-3 h-3" />
        </span>
        <span className="delta">{hint ?? ""}</span>
      </div>
    </div>
  );
}

function ProductEntry({
  href,
  title,
  detail,
  icon,
}: {
  href: string;
  title: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="reveal rounded-[8px] border p-3 transition-colors hover:border-[#4a4641]"
      style={{ background: "var(--card)", borderColor: "var(--line)" }}
    >
      <div className="flex items-center gap-2" style={{ color: "var(--accent-bright)" }}>
        {icon}
        <span className="text-[12.5px] font-semibold" style={{ color: "var(--tx)" }}>
          {title}
        </span>
      </div>
      <div className="mt-2 truncate text-[11.5px]" style={{ color: "var(--t3)" }}>
        {detail}
      </div>
    </Link>
  );
}

function WatchlistCard({ market }: { market: MarketView }) {
  const positiveChange = market.changePct >= 0;
  const changeColor = positiveChange ? "#10b981" : "#ef4444";
  return (
    <Link
      href={`/market/${encodeURIComponent(market.id)}`}
      className="grid gap-2 rounded-[8px] border p-3 transition-colors hover:border-[#4a4641]"
      style={{ background: "#211f1e", borderColor: "var(--line)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--t3)" }}>
            {market.ticker} / {market.lifecycle}
          </div>
          <div className="mt-1 line-clamp-2 text-[13px] font-semibold leading-snug" style={{ color: "var(--tx)" }}>
            {market.title}
          </div>
        </div>
        <div className="shrink-0 rounded-[6px] border px-2 py-1 text-right" style={{ borderColor: "var(--line-soft)" }}>
          <div className="font-mono text-[13px] font-semibold" style={{ color: "var(--tx)" }}>
            {Math.round(market.yesPct * 100)}%
          </div>
          <div className="font-mono text-[10px]" style={{ color: changeColor }}>
            {positiveChange ? "+" : ""}
            {market.changePct.toFixed(1)}%
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px]" style={{ color: "var(--t3)" }}>
        <span className="font-mono">{formatUsd(market.volume, { compact: true })} vol</span>
        <span className="font-mono">{formatCountdownShort(market.resolvesInMs)}</span>
      </div>
    </Link>
  );
}

function VolumeBars({ views }: { views: MarketView[] }) {
  const top = [...views].sort((a, b) => b.volume - a.volume).slice(0, 12);
  if (top.length === 0) {
    return (
      <div
        className="h-[260px] grid place-items-center text-[12px]"
        style={{ color: "var(--t3)" }}
      >
        No volume yet - be the first to bet.
      </div>
    );
  }
  const max = Math.max(...top.map((v) => Math.max(v.volume, 1)));
  return (
    <div className="h-[260px] flex items-end gap-3 pt-4">
      {top.map((v, i) => {
        const yesH = Math.max(2, (v.volume * v.yesPct) / max * 240);
        const noH = Math.max(2, (v.volume * (1 - v.yesPct)) / max * 240);
        return (
          <Link
            key={v.id}
            href={`/market/${encodeURIComponent(v.id)}`}
            className="flex-1 min-w-0 flex flex-col items-center gap-1.5"
          >
            <div
              className="w-full flex flex-col justify-end"
              style={{ height: 240 }}
            >
              <div
                className="rounded-t-[3px] transition-all"
                style={{
                  height: yesH,
                  background: "var(--accent)",
                  animation: `growb 0.6s cubic-bezier(.22,.61,.36,1) ${i * 40}ms backwards`,
                  transformOrigin: "bottom",
                }}
              />
              <div
                className="border-t"
                style={{
                  height: noH,
                  borderColor: "#6f6a65",
                  background: "transparent",
                }}
              />
            </div>
            <span
              className="text-[10px] font-mono uppercase tracking-wider truncate w-full text-center"
              style={{ color: "var(--t3)" }}
            >
              {v.ticker}
            </span>
          </Link>
        );
      })}
      <style>{`@keyframes growb{from{transform:scaleY(0)}to{transform:scaleY(1)}}`}</style>
    </div>
  );
}

function StatusBadge({ lifecycle }: { lifecycle: MarketView["lifecycle"] }) {
  if (lifecycle === "draft")
    return (
      <span className="b-badge ref">
        <span className="d" /> Draft
      </span>
    );
  if (lifecycle === "archived")
    return (
      <span className="b-badge ref">
        <span className="d" /> Archived
      </span>
    );
  if (lifecycle === "claimable")
    return (
      <span className="b-badge ok">
        <span className="d" /> Claimable
      </span>
    );
  if (lifecycle === "resolved")
    return (
      <span className="b-badge ref">
        <span className="d" /> Resolved
      </span>
    );
  if (lifecycle === "resolving")
    return (
      <span className="b-badge pend">
        <span className="d" /> Resolving
      </span>
    );
  if (lifecycle === "locked")
    return (
      <span className="b-badge pend">
        <span className="d" /> Locked
      </span>
    );
  return (
    <span className="b-badge ok">
      <span className="d" /> Open
    </span>
  );
}

function formatCountdownShort(ms: number): string {
  if (ms <= 0) return "-";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/* activity event to Activity */

function eventToActivity(e: {
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
}): Activity {
  const ago = formatAgo(e.atIso);
  if (e.kind === "resolution") {
    return {
      kind: "resolution",
      side: (e.resolvedAs ?? "YES").toLowerCase() as "yes" | "no",
      market: e.marketTitle ?? "",
      ago,
      transactionHash: e.transactionHash,
      chainId: e.chainId,
    };
  }
  if (e.kind === "claim" || e.kind === "refund") {
    return {
      kind: e.kind,
      handle: e.walletShort ?? "0x...",
      market: e.marketTitle ?? "",
      amount: e.amountUsd ?? 0,
      ago,
      transactionHash: e.transactionHash,
      chainId: e.chainId,
    };
  }
  const isAi = e.kind === "ai-lp";
  return {
    kind: isAi ? "ai-lp" : "bet",
    side: (e.side ?? "YES").toLowerCase() as "yes" | "no",
    handle: e.agentHandle ?? e.walletShort ?? "0x...",
    market: e.marketTitle ?? "",
    amount: e.amountUsd ?? 0,
    ago,
    transactionHash: e.transactionHash,
    chainId: e.chainId,
  };
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
