"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, MoreHorizontal, RefreshCw, Wallet2, X } from "lucide-react";
import { useChainId } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Address } from "viem";
import parimutuelPoolAbi from "@/lib/abi/ParimutuelPool.json";
import { ConfettiBurst } from "@/components/dashboard/confetti-burst";
import { showToast } from "@/components/dashboard/toast";
import { usePortfolio } from "@/lib/hooks/usePortfolio";
import { useMarkets } from "@/lib/hooks/useMarkets";
import { useWallet } from "@/lib/hooks/useWallet";
import { toMarketView, formatUsd, type MarketView } from "@/lib/market-view";
import { wagmiConfig } from "@/lib/wagmi";
import { describeTxError } from "@/lib/utils/decode-error";
import type { HistoryRow, Position } from "@/lib/types/domain";

const REFUND_GRACE_MS = 14 * 24 * 60 * 60 * 1000;
type SupportedChainId = (typeof wagmiConfig.chains)[number]["id"];
type ClaimFilter = "all" | "claimable" | "pending" | "claimed" | "refunded" | "lost";

export function PortfolioClient() {
  const { account, connect } = useWallet();
  const activeChainId = useChainId();
  const { positions, refresh, error: portfolioError } = usePortfolio();
  const { markets, error: marketsError } = useMarkets();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>("all");
  const [celebrate, setCelebrate] = useState(false);
  const [claimState, setClaimState] = useState<{
    positionId?: string;
    transactionHash?: `0x${string}`;
    step?: string;
    error?: string;
  }>({});

  useEffect(() => {
    if (!account) return;
    void fetch(portfolioHistoryPath(account.address), {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<HistoryRow[]>;
      })
      .then((rows) => {
        setHistory(rows);
        setHistoryError(null);
      })
      .catch((error) => {
        setHistory([]);
        setHistoryError(error instanceof Error ? error.message : "Portfolio history is unavailable.");
      });
  }, [account]);

  const marketById = useMemo(() => {
    const map = new Map<string, MarketView>();
    for (const m of markets) map.set(m.id, toMarketView(m));
    return map;
  }, [markets]);

  const open = useMemo(() => {
    return positions
      .map((p) => {
        const market = marketById.get(p.marketId);
        const nowPrice = market
          ? p.side === "YES"
            ? market.yesPct / 100
            : 1 - market.yesPct / 100
          : null;
        const sharesQty = p.avgPrice > 0 ? p.stakeUsd / p.avgPrice : 0;
        const pnl = nowPrice === null ? null : (nowPrice - p.avgPrice) * sharesQty;
        return { p, market, nowPrice, pnl };
      })
      .sort(
        (a, b) =>
          Number(a.p.status === "claimable" || a.p.status === "claimed") -
            Number(b.p.status === "claimable" || b.p.status === "claimed") ||
          (b.pnl ?? Number.NEGATIVE_INFINITY) - (a.pnl ?? Number.NEGATIVE_INFINITY),
      );
  }, [positions, marketById]);

  const totals = useMemo(() => {
    const staked = positions.reduce((s, p) => s + p.stakeUsd, 0);
    const openExposure = positions
      .filter((p) => p.status === "open")
      .reduce((s, p) => s + p.stakeUsd, 0);
    const claimable = positions
      .filter((p) => p.status === "claimable")
      .reduce((s, p) => s + (p.payoutUsd ?? 0), 0);
    const realized = history.reduce(
      (s, h) => s + (h.payoutUsd - h.stakeUsd),
      0,
    );
    const unrealized = open.reduce((s, x) => s + (x.pnl ?? 0), 0);
    const wins = history.filter((h) => h.payoutUsd > h.stakeUsd).length;
    const losses = history.filter((h) => h.payoutUsd <= h.stakeUsd).length;
    return {
      staked,
      openExposure,
      claimable,
      realized,
      unrealized,
      total: staked + realized + unrealized,
      wins,
      losses,
    };
  }, [positions, history, open]);

  const portfolioUnavailable = Boolean(portfolioError || historyError);

  const claimCenter = useMemo(() => {
    return {
      claimable: positions.filter((p) => p.status === "claimable"),
      pending: positions.filter((p) => p.status === "open"),
      claimed: positions.filter((p) => p.status === "claimed"),
      refunded: positions.filter((p) => p.status === "refunded"),
      lost: positions.filter((p) => p.status === "lost"),
    };
  }, [positions]);

  const filteredPositions = useMemo(() => {
    if (claimFilter === "all") return open;
    const status = claimFilter === "pending" ? "open" : claimFilter;
    return open.filter((item) => item.p.status === status);
  }, [claimFilter, open]);

  const selectedPosition = useMemo(() => {
    if (!selectedPositionId) return null;
    return open.find((item) => item.p.id === selectedPositionId) ?? null;
  }, [open, selectedPositionId]);

  function canRefundAfterGrace(position: Position, market?: MarketView) {
    if (!market?.poolAddress || position.status !== "open") return false;
    const deadline = new Date(market.deadlineIso).getTime();
    return Number.isFinite(deadline) && Date.now() >= deadline + REFUND_GRACE_MS;
  }

  // Real cumulative-PnL series from settled history.
  const performance = useMemo(() => {
    const sorted = [...history].sort(
      (a, b) =>
        new Date(a.createdAtIso).getTime() -
        new Date(b.createdAtIso).getTime(),
    );
    let running = 0;
    const series: number[] = [0];
    for (const h of sorted) {
      running += h.payoutUsd - h.stakeUsd;
      series.push(running);
    }
    return series;
  }, [history]);

  async function refreshHistory() {
    if (!account) return;
    const response = await fetch(portfolioHistoryPath(account.address), { cache: "no-store" });
    setHistory(response.ok ? ((await response.json()) as HistoryRow[]) : []);
  }

  async function claimPosition(position: Position, market?: MarketView) {
    if (!market?.poolAddress || !account) return;
    const chainId = resolveRecoveryChainId(market, activeChainId);
    if (!chainId) {
      setClaimState({
        positionId: position.id,
        step: "Claim failed",
        error: "Cannot claim because the transaction chain is unknown.",
      });
      return;
    }
    const onChainId = parsePositionContractId(position.id);
    if (onChainId === null) {
      setClaimState({
        positionId: position.id,
        step: "Claim failed",
        error: "Cannot claim because the position id is not a valid contract position id.",
      });
      return;
    }
    let submittedHash: `0x${string}` | undefined;
    setClaimState({ positionId: position.id, step: "Waiting for wallet" });
    try {
      const hash = await writeContract(wagmiConfig, {
        address: market.poolAddress as Address,
        abi: parimutuelPoolAbi,
        functionName: "claim",
        args: [onChainId],
        chainId,
      });
      submittedHash = hash;
      setClaimState({ positionId: position.id, transactionHash: hash, step: "Transaction submitted" });
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId, timeout: 90_000 });
      setClaimState({ positionId: position.id, transactionHash: hash, step: "Backend recording receipt" });
      await syncClaim(position.id, hash, chainId);
      setClaimState({ positionId: position.id, transactionHash: hash, step: "Portfolio updating" });
      await Promise.all([refresh(account.address), refreshHistory()]);
      setClaimState({ positionId: position.id, transactionHash: hash, step: "Claim confirmed" });
      setCelebrate(true);
      showToast({
        kind: "success",
        title: "Position claimed",
        body: `Payout transferred to your wallet.`,
      });
      setTimeout(() => setClaimState({}), 3500);
    } catch (error) {
      const decoded = describeTxError(error);
      setClaimState({
        positionId: position.id,
        transactionHash: submittedHash,
        step: decoded.rejected ? "Cancelled" : "Claim failed",
        error: decoded.rejected ? undefined : decoded.message,
      });
      showToast({
        kind: decoded.rejected ? "info" : "error",
        title: decoded.rejected ? decoded.title : "Claim failed",
        body: decoded.message,
      });
    }
  }

  async function refundPosition(position: Position, market?: MarketView) {
    if (!market?.poolAddress || !account) return;
    const chainId = resolveRecoveryChainId(market, activeChainId);
    if (!chainId) {
      setClaimState({
        positionId: position.id,
        step: "Refund failed",
        error: "Cannot refund because the transaction chain is unknown.",
      });
      return;
    }
    const onChainId = parsePositionContractId(position.id);
    if (onChainId === null) {
      setClaimState({
        positionId: position.id,
        step: "Refund failed",
        error: "Cannot refund because the position id is not a valid contract position id.",
      });
      return;
    }
    let submittedHash: `0x${string}` | undefined;
    setClaimState({ positionId: position.id, step: "Waiting for wallet" });
    try {
      const hash = await writeContract(wagmiConfig, {
        address: market.poolAddress as Address,
        abi: parimutuelPoolAbi,
        functionName: "refundAfterGrace",
        args: [onChainId],
        chainId,
      });
      submittedHash = hash;
      setClaimState({ positionId: position.id, transactionHash: hash, step: "Refund transaction submitted" });
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId, timeout: 90_000 });
      setClaimState({ positionId: position.id, transactionHash: hash, step: "Backend recording refund" });
      await retrySync(hash, chainId);
      setClaimState({ positionId: position.id, transactionHash: hash, step: "Refund confirmed" });
      setTimeout(() => setClaimState({}), 3500);
    } catch (error) {
      const decoded = describeTxError(error);
      setClaimState({
        positionId: position.id,
        transactionHash: submittedHash,
        step: decoded.rejected ? "Cancelled" : "Refund failed",
        error: decoded.rejected ? undefined : decoded.message,
      });
      showToast({
        kind: decoded.rejected ? "info" : "error",
        title: decoded.rejected ? decoded.title : "Refund failed",
        body: decoded.message,
      });
    }
  }

  async function syncClaim(positionId: string, transactionHash: `0x${string}`, chainId: number) {
    const response = await fetch("/api/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positionId, transactionHash, chainId }),
    });
    if (!response.ok) throw new Error(await response.text());
  }

  async function retrySync(transactionHash?: `0x${string}` | string, chainId?: number) {
    if (!transactionHash) return;
    if (!chainId) {
      setClaimState((current) => ({
        ...current,
        transactionHash: transactionHash as `0x${string}`,
        step: "Backend sync failed",
        error: "Cannot sync transaction because the chain is unknown.",
      }));
      return;
    }
    setClaimState((current) => ({ ...current, transactionHash: transactionHash as `0x${string}`, step: "Retrying backend sync", error: undefined }));
    try {
      const response = await fetch("/api/sync/transaction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionHash, chainId }),
      });
      if (!response.ok) throw new Error(await response.text());
      if (account) await Promise.all([refresh(account.address), refreshHistory()]);
      setClaimState((current) => ({ ...current, step: "Backend sync complete", error: undefined }));
    } catch (error) {
      setClaimState((current) => ({
        ...current,
        step: "Backend sync failed",
        error: error instanceof Error ? error.message : "Could not sync transaction.",
      }));
    }
  }

  if (!account) {
    return (
      <div className="px-[22px] py-5">
        <div className="panel">
          <div className="panel-body text-center py-12">
            <div
              className="w-12 h-12 rounded-full grid place-items-center mx-auto mb-3"
              style={{
                background: "#2a2826",
                border: "1px solid #3a3633",
                color: "var(--t2)",
              }}
            >
              <Wallet2 className="w-5 h-5" />
            </div>
            <h2
              className="text-[16px] font-semibold mb-1"
              style={{ color: "var(--tx)" }}
            >
              Wallet disconnected
            </h2>
            <p
              className="text-[12.5px] mb-4 max-w-sm mx-auto"
              style={{ color: "var(--t2)" }}
            >
              Connect your wallet to see your bets, claims, and PnL.
            </p>
            <button onClick={connect} className="btn primary">
              Connect wallet
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-[22px] py-5 pb-7">
      <ConfettiBurst trigger={celebrate} onDone={() => setCelebrate(false)} />
      {/* page head */}
      <div className="flex items-center gap-4 mb-[18px] flex-wrap">
        <div>
          <h1
            className="text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--tx)" }}
          >
            Portfolio
          </h1>
          <p className="text-[12.5px] mt-1 font-mono" style={{ color: "var(--t3)" }}>
            {account.walletShort}
          </p>
        </div>
        <div className="flex-1" />
        <span className="b-badge ok">
          <span className="d" /> Connected
        </span>
      </div>

      {portfolioUnavailable ? (
        <section className="panel reveal">
          <div className="panel-body py-10">
            <div className="mx-auto max-w-xl rounded-[8px] border border-[#7f1d1d] bg-[#2a1717] p-4 text-center">
              <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-[#fca5a5]" />
              <div className="text-sm font-semibold" style={{ color: "var(--tx)" }}>Portfolio data unavailable</div>
              <p className="mt-2 text-[12px]" style={{ color: "var(--t2)" }}>
                Backend/indexer data could not be loaded, so Adjudex is not showing zero balances or empty history.
              </p>
              <div className="mt-3 font-mono text-[11px] text-[#fca5a5]">
                {portfolioError ?? historyError}
              </div>
              <button
                className="btn primary mt-4"
                onClick={() => {
                  void refresh(account.address);
                  void refreshHistory();
                }}
              >
                Retry
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
      {/* stats x 4 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px] mb-4">
        <StatCard
          label="Open Exposure"
          num={formatUsd(totals.openExposure)}
          tone={totals.total >= 0 ? "pos" : "neg"}
        />
        <StatCard label="Claimable" num={formatUsd(totals.claimable)} />
        <StatCard
          label="Realized PnL"
          num={`${totals.realized >= 0 ? "+" : "-"}${formatUsd(Math.abs(totals.realized))}`}
          tone={totals.realized >= 0 ? "pos" : "neg"}
        />
        <StatCard
          label="Unrealized"
          num={`${totals.unrealized >= 0 ? "+" : "-"}${formatUsd(Math.abs(totals.unrealized))}`}
          tone={totals.unrealized >= 0 ? "pos" : "neg"}
        />
      </div>

      {marketsError && (
        <div className="mb-4 rounded-[8px] border border-[#78350f] bg-[#2a1f12] px-3 py-2 text-[12px] text-[#fbbf24]">
          Market prices unavailable. Current price and unrealized PnL are hidden for positions whose market cannot be loaded.
        </div>
      )}

      {/* chart + positions */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-[14px] mb-4">
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">
              Cumulative realized PnL
              <Info className="w-3.5 h-3.5" style={{ color: "var(--t4)" }} />
            </span>
            <div className="flex-1" />
            <button className="dots-btn">
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-4 pt-3 pb-4">
            <PnlChart series={performance} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">
              Quick summary
              <Info className="w-3.5 h-3.5" style={{ color: "var(--t4)" }} />
            </span>
          </div>
          <div className="px-4 py-4 space-y-3">
            <SummaryRow k="Open positions" v={String(open.length)} />
            <SummaryRow k="Total staked" v={formatUsd(totals.staked)} />
            <SummaryRow k="Settled" v={String(history.length)} />
            <SummaryRow k="Win / Loss" v={`${totals.wins} / ${totals.losses}`} />
            <SummaryRow
              k="Win rate"
              v={
                history.length === 0
                  ? "-"
                  : `${Math.round(
                      (history.filter((h) => h.payoutUsd > h.stakeUsd).length /
                        history.length) *
                        100,
                    )}%`
              }
            />
            <SummaryRow
              k="Best win"
              v={
                history.length === 0
                  ? "-"
                  : formatUsd(
                      Math.max(
                        ...history.map((h) => h.payoutUsd - h.stakeUsd),
                        0,
                      ),
                    )
              }
            />
          </div>
        </section>
      </div>

      <section className="panel mb-4">
        <div className="panel-head">
          <span className="panel-title">Claim center</span>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
          <ClaimBucket label="All positions" count={positions.length} value={formatUsd(totals.staked)} active={claimFilter === "all"} onClick={() => setClaimFilter("all")} />
          <ClaimBucket label="Claimable now" count={claimCenter.claimable.length} value={formatUsd(totals.claimable)} tone="ok" active={claimFilter === "claimable"} onClick={() => setClaimFilter("claimable")} />
          <ClaimBucket label="Pending resolution" count={claimCenter.pending.length} value={formatUsd(claimCenter.pending.reduce((s, p) => s + p.stakeUsd, 0))} active={claimFilter === "pending"} onClick={() => setClaimFilter("pending")} />
          <ClaimBucket label="Already claimed" count={claimCenter.claimed.length} value={formatUsd(claimCenter.claimed.reduce((s, p) => s + (p.payoutUsd ?? 0), 0))} active={claimFilter === "claimed"} onClick={() => setClaimFilter("claimed")} />
          <ClaimBucket label="Refunded" count={claimCenter.refunded.length} value={formatUsd(claimCenter.refunded.reduce((s, p) => s + (p.payoutUsd ?? p.stakeUsd), 0))} tone="ok" active={claimFilter === "refunded"} onClick={() => setClaimFilter("refunded")} />
          <ClaimBucket label="Lost" count={claimCenter.lost.length} value={formatUsd(claimCenter.lost.reduce((s, p) => s + p.stakeUsd, 0))} tone="muted" active={claimFilter === "lost"} onClick={() => setClaimFilter("lost")} />
        </div>
      </section>

      {/* open positions table */}
      <section className="panel mb-4">
        <div className="panel-head">
          <span className="panel-title">
            {claimFilter === "all" ? "Positions" : claimFilter === "pending" ? "Pending resolution" : `${claimFilter[0].toUpperCase()}${claimFilter.slice(1)} positions`}
            <span
              className="ml-1 font-mono text-[10.5px]"
              style={{ color: "var(--t3)" }}
            >
              ({filteredPositions.length})
            </span>
          </span>
        </div>
        {filteredPositions.length === 0 ? (
          <div
            className="text-center py-10 text-[12.5px]"
            style={{ color: "var(--t3)" }}
          >
            {positions.length === 0
              ? "No positions yet. Open a position from any market to see it here."
              : "No positions match this claim-center filter."}
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Market</th>
                <th>Side</th>
                <th className="right">Stake</th>
                <th className="right">Entry</th>
                <th className="right">Now</th>
                <th className="right">PnL</th>
                <th>Status</th>
                <th className="right"></th>
              </tr>
            </thead>
            <tbody>
              {filteredPositions.map(({ p, market, nowPrice, pnl }) => (
                <tr key={p.id} onClick={() => setSelectedPositionId(p.id)} style={{ cursor: "pointer" }}>
                  <td>
                    <Link
                      href={marketPath(p.marketId)}
                      className="hover:underline"
                      style={{ color: "var(--tx)" }}
                    >
                      {market?.title ?? `Market #${p.marketId}`}
                    </Link>
                  </td>
                  <td>
                    <SideBadge side={p.side} />
                  </td>
                  <td className="num right">{formatUsd(p.stakeUsd)}</td>
                  <td className="num right" style={{ color: "var(--t2)" }}>
                    ${p.avgPrice.toFixed(2)}
                  </td>
                  <td className="num right" style={{ color: "var(--t2)" }}>
                    {nowPrice === null ? "Unavailable" : `$${nowPrice.toFixed(2)}`}
                  </td>
                  <td
                    className="num right"
                    style={{
                      color: pnl === null ? "var(--t3)" : pnl >= 0 ? "var(--green-tx)" : "#ef4444",
                      fontWeight: 600,
                    }}
                  >
                    {pnl === null ? "Unavailable" : `${pnl >= 0 ? "+" : "-"}${formatUsd(Math.abs(pnl))}`}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="right">
                    {p.status === "claimable" && market?.poolAddress && (
                      <button
                        onClick={async (event) => {
                          event.stopPropagation();
                          await claimPosition(p, market);
                        }}
                        className="btn primary"
                        disabled={claimState.positionId === p.id && claimState.step !== "Claim confirmed"}
                        style={{
                          height: 28,
                          padding: "0 11px",
                          fontSize: 12,
                          opacity: claimState.positionId === p.id ? 0.65 : 1,
                        }}
                      >
                        {claimState.positionId === p.id ? "Claiming" : "Claim"}
                      </button>
                    )}
                    {canRefundAfterGrace(p, market) && (
                      <button
                        onClick={async (event) => {
                          event.stopPropagation();
                          await refundPosition(p, market);
                        }}
                        className="btn primary"
                        disabled={claimState.positionId === p.id && claimState.step !== "Refund confirmed"}
                        style={{
                          height: 28,
                          padding: "0 11px",
                          fontSize: 12,
                          opacity: claimState.positionId === p.id ? 0.65 : 1,
                        }}
                      >
                        {claimState.positionId === p.id ? "Refunding" : "Refund"}
                      </button>
                    )}
                    {p.transactionHash && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void retrySync(p.transactionHash, resolveRecoveryChainId(market, activeChainId));
                        }}
                        className="ml-2 inline-flex h-7 items-center gap-1 rounded-[5px] border border-[color:var(--line)] px-2 text-[11px] text-[color:var(--t2)] hover:text-[color:var(--tx)]"
                      >
                        <RefreshCw className="h-3 w-3" /> Sync
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* history table */}
      <section className="panel reveal">
        <div className="panel-head">
          <span className="panel-title">
            History
            <span
              className="ml-1 font-mono text-[10.5px]"
              style={{ color: "var(--t3)" }}
            >
              ({history.length})
            </span>
          </span>
        </div>
        {history.length === 0 ? (
          <div
            className="text-center py-10 text-[12.5px]"
            style={{ color: "var(--t3)" }}
          >
            No resolved bets yet.
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Market</th>
                <th>Side</th>
                <th className="right">Stake</th>
                <th className="right">Payout</th>
                <th className="right">PnL</th>
                <th>Result</th>
                <th className="right">Proof</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const pnl = h.payoutUsd - h.stakeUsd;
                const market = marketById.get(h.marketId);
                const proofHref = txUrl(explorerForMarket(market), h.transactionHash);
                return (
                  <tr key={h.id}>
                    <td className="id">{h.createdAtIso.slice(0, 10)}</td>
                    <td style={{ color: "var(--tx)" }}>
                      {market?.title ?? h.marketId}
                    </td>
                    <td>
                      <SideBadge side={h.side} />
                    </td>
                    <td className="num right" style={{ color: "var(--t2)" }}>
                      {formatUsd(h.stakeUsd)}
                    </td>
                    <td className="num right">{formatUsd(h.payoutUsd)}</td>
                    <td
                      className="num right"
                      style={{
                        color: pnl >= 0 ? "var(--green-tx)" : "#ef4444",
                        fontWeight: 600,
                      }}
                    >
                      {pnl >= 0 ? "+" : "-"}
                      {formatUsd(Math.abs(pnl))}
                    </td>
                    <td>
                      <span className={`b-badge ${pnl >= 0 ? "ok" : "ref"}`}>
                        <span className="d" /> {pnl >= 0 ? "Won" : "Lost"}
                      </span>
                    </td>
                    <td className="right">
                      {proofHref ? (
                        <a
                          href={proofHref}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-[color:var(--accent-bright)] hover:text-[color:var(--tx)]"
                        >
                          tx <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-[11px]" style={{ color: "var(--t4)" }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
        </>
      )}

      {selectedPosition && (
        <PositionDrawer
          item={selectedPosition}
          claimState={claimState}
          refundable={canRefundAfterGrace(selectedPosition.p, selectedPosition.market)}
          onClaim={() => void claimPosition(selectedPosition.p, selectedPosition.market)}
          onRefund={() => void refundPosition(selectedPosition.p, selectedPosition.market)}
          onRetrySync={() => void retrySync(selectedPosition.p.transactionHash ?? claimState.transactionHash, resolveRecoveryChainId(selectedPosition.market, activeChainId))}
          onClose={() => setSelectedPositionId(null)}
        />
      )}
    </div>
  );
}

/* primitives */

function StatCard({
  label,
  num,
  tone,
}: {
  label: string;
  num: string;
  unit?: string;
  tone?: "pos" | "neg";
}) {
  const color =
    tone === "pos"
      ? "var(--green-tx)"
      : tone === "neg"
        ? "#ef4444"
        : "var(--tx)";
  return (
    <div className="stat-card reveal">
      <span className="stat-label">{label}</span>
      <div className="stat-row">
        <span className="stat-num" style={{ color }}>
          {num}
        </span>
      </div>
      <div className="stat-foot">
        <span className="ic" />
        <span className="delta">live</span>
      </div>
    </div>
  );
}

function ClaimBucket({
  label,
  count,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  value: string;
  tone?: "ok" | "muted";
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[8px] border p-3 text-left transition-colors hover:border-[color:var(--accent)]"
      style={{
        borderColor: active ? "var(--accent)" : "var(--line)",
        background: active ? "rgba(40,160,240,.10)" : "var(--card-bg)",
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--t3)" }}>
        {label}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="font-mono text-[22px] font-semibold tabular-nums" style={{ color: tone === "ok" ? "var(--green-tx)" : tone === "muted" ? "var(--t3)" : "var(--tx)" }}>
          {count}
        </span>
        <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--t2)" }}>
          {value}
        </span>
      </div>
    </button>
  );
}

function PositionDrawer({
  item,
  claimState,
  refundable,
  onClaim,
  onRefund,
  onRetrySync,
  onClose,
}: {
  item: { p: Position; market?: MarketView; nowPrice: number | null; pnl: number | null };
  claimState: { positionId?: string; transactionHash?: `0x${string}`; step?: string; error?: string };
  refundable: boolean;
  onClaim: () => void;
  onRefund: () => void;
  onRetrySync: () => void;
  onClose: () => void;
}) {
  const { p, market, nowPrice, pnl } = item;
  const explorer = explorerForMarket(market);
  const potentialPayout = p.payoutUsd ?? (nowPrice === null ? null : p.shares * nowPrice);
  const activeClaim = claimState.positionId === p.id;
  const proofHash = claimState.transactionHash ?? p.transactionHash;
  const proofHref = txUrl(explorer, proofHash);
  return (
    <div className="fixed inset-0 z-50 bg-black/45" onMouseDown={onClose}>
      <aside
        className="ml-auto flex h-full w-full max-w-md flex-col border-l border-[color:var(--line)] bg-[color:var(--panel-bg)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[color:var(--line-soft)] px-4 py-3">
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--tx)" }}>Position detail</div>
            <div className="text-[11px] font-mono" style={{ color: "var(--t3)" }}>{p.id}</div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-[6px] border border-[color:var(--line)] text-[color:var(--t2)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <Link href={marketPath(p.marketId)} className="block rounded-[8px] border border-[color:var(--line)] bg-[#211f1e] p-3 hover:border-[color:var(--accent)]">
            <div className="text-sm font-medium" style={{ color: "var(--tx)" }}>{market?.title ?? `Market #${p.marketId}`}</div>
            <div className="mt-1 text-[11px]" style={{ color: "var(--t3)" }}>Open market</div>
          </Link>
          <div className="mt-4 space-y-2">
            <DetailRow label="Side" value={p.side} />
            <DetailRow label="Stake" value={formatUsd(p.stakeUsd)} />
            <DetailRow label="Shares" value={p.shares.toFixed(4)} />
            <DetailRow label="Entry price" value={`${(p.avgPrice * 100).toFixed(2)}%`} />
            <DetailRow label="Current implied price" value={nowPrice === null ? "Unavailable" : `${(nowPrice * 100).toFixed(2)}%`} />
            <DetailRow label="Potential payout" value={potentialPayout === null ? "Unavailable" : formatUsd(potentialPayout)} />
            <DetailRow label="Unrealized PnL" value={pnl === null ? "Unavailable" : `${pnl >= 0 ? "+" : "-"}${formatUsd(Math.abs(pnl))}`} tone={pnl === null ? undefined : pnl >= 0 ? "ok" : "bad"} />
            <DetailRow label="Claim status" value={p.status} />
            <DetailRow label="Created" value={p.createdAtIso.slice(0, 10)} mono />
          </div>
          {(p.status === "claimable" || refundable || activeClaim) && (
            <div className="mt-4 rounded-[8px] border border-[color:var(--line)] bg-[#211f1e] p-3">
              <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--tx)" }}>
                {claimState.error ? <AlertTriangle className="h-4 w-4 text-[#fca5a5]" /> : <CheckCircle2 className="h-4 w-4 text-[color:var(--accent-bright)]" />}
                {refundable ? "Refund transaction timeline" : "Claim transaction timeline"}
              </div>
              <div className="mt-2 text-[11px]" style={{ color: claimState.error ? "#fca5a5" : "var(--t2)" }}>
                {activeClaim
                  ? claimState.error ?? claimState.step ?? (refundable ? "Ready to refund" : "Ready to claim")
                  : refundable
                    ? "Grace period passed. Refund stake from the pool contract."
                    : "Ready to claim from the pool contract."}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {p.status === "claimable" && (
                  <button onClick={onClaim} className="btn primary" style={{ height: 30, padding: "0 12px", fontSize: 12 }}>
                    {activeClaim && claimState.step !== "Claim confirmed" ? "Claiming" : "Claim payout"}
                  </button>
                )}
                {refundable && (
                  <button onClick={onRefund} className="btn primary" style={{ height: 30, padding: "0 12px", fontSize: 12 }}>
                    {activeClaim && claimState.step !== "Refund confirmed" ? "Refunding" : "Refund stake"}
                  </button>
                )}
                {proofHash && (
                  <button
                    onClick={onRetrySync}
                    className="inline-flex h-[30px] items-center gap-1.5 rounded-[6px] border border-[color:var(--line)] px-3 text-[12px] text-[color:var(--t2)] hover:text-[color:var(--tx)]"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Retry sync
                  </button>
                )}
              </div>
            </div>
          )}
          {proofHref && (
            <a
              href={proofHref}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex items-center justify-between rounded-[6px] border border-[color:var(--line)] bg-[#211f1e] px-3 py-2 text-xs text-[color:var(--t2)] hover:text-[color:var(--tx)]"
            >
              Open transaction proof
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </aside>
    </div>
  );
}

function DetailRow({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "ok" | "bad" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-[6px] border border-[color:var(--line)] bg-[#201f1e] px-3 py-2">
      <span className="text-[11px]" style={{ color: "var(--t3)" }}>{label}</span>
      <span className={`truncate text-right text-xs ${mono ? "font-mono" : ""}`} style={{ color: tone === "ok" ? "var(--green-tx)" : tone === "bad" ? "#ef4444" : "var(--tx)" }}>
        {value}
      </span>
    </div>
  );
}

function explorerForMarket(market?: MarketView): string {
  if (market?.chainId === 46630 || market?.chainId === Number(process.env.NEXT_PUBLIC_RHC_CHAIN_ID)) {
    return process.env.NEXT_PUBLIC_RHC_EXPLORER_URL || "";
  }
  return process.env.NEXT_PUBLIC_ARBITRUM_EXPLORER_URL || "https://sepolia.arbiscan.io";
}

function portfolioHistoryPath(address: string): string {
  return `/api/portfolio/${encodeURIComponent(address)}/history`;
}

function txUrl(explorer: string, hash?: string | null): string | undefined {
  if (!explorer || !hash) return undefined;
  return `${explorer.replace(/\/$/, "")}/tx/${encodeURIComponent(hash)}`;
}

function marketPath(marketId: string): string {
  return `/market/${encodeURIComponent(marketId)}`;
}

function parsePositionContractId(positionId: string): bigint | null {
  const raw = positionId.includes("#") ? positionId.split("#").at(-1) : positionId;
  if (!raw || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

function resolveRecoveryChainId(market: MarketView | undefined, activeChainId: number | undefined): SupportedChainId | undefined {
  const chainId = market?.chainId ?? activeChainId;
  if (!chainId || !Number.isFinite(chainId)) return undefined;
  return isSupportedChainId(chainId) ? chainId : undefined;
}

function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return wagmiConfig.chains.some((chain) => chain.id === chainId);
}

function SummaryRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12.5px]" style={{ color: "var(--t3)" }}>
        {k}
      </span>
      <span
        className="font-mono text-[13px]"
        style={{ color: "var(--tx)", fontWeight: 600 }}
      >
        {v}
      </span>
    </div>
  );
}

function SideBadge({ side }: { side: "YES" | "NO" }) {
  return (
    <span
      className="font-mono font-bold text-[10px] uppercase tracking-wider px-2 py-1 rounded"
      style={{
        background:
          side === "YES"
            ? "rgba(95,194,149,0.15)"
            : "rgba(239,68,68,0.15)",
        color: side === "YES" ? "var(--green-tx)" : "#ef4444",
      }}
    >
      {side}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "claimable")
    return (
      <span className="b-badge ok">
        <span className="d" /> Claimable
      </span>
    );
  if (status === "claimed")
    return (
      <span className="b-badge ref">
        <span className="d" /> Claimed
      </span>
    );
  if (status === "refunded")
    return (
      <span className="b-badge ok">
        <span className="d" /> Refunded
      </span>
    );
  if (status === "lost")
    return (
      <span className="b-badge ref">
        <span className="d" /> Lost
      </span>
    );
  return (
    <span className="b-badge pend">
      <span className="d" /> Open
    </span>
  );
}

function PnlChart({ series }: { series: number[] }) {
  const W = 720;
  const H = 200;
  if (series.length < 2) {
    return (
      <div
        className="h-[200px] grid place-items-center text-[12px]"
        style={{ color: "var(--t3)" }}
      >
        No settled bets yet - your PnL curve will appear here.
      </div>
    );
  }
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const pts = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * W;
      const y = H - ((v - min) / range) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const zeroY = H - ((0 - min) / range) * H;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-[200px]"
    >
      <defs>
        <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <line
          key={g}
          x1={0}
          x2={W}
          y1={g * H}
          y2={g * H}
          stroke="var(--line-soft)"
          strokeDasharray="2 4"
        />
      ))}
      <line
        x1={0}
        x2={W}
        y1={zeroY}
        y2={zeroY}
        stroke="#6f6a65"
        strokeDasharray="3 3"
      />
      <path
        d={`M0,${H} L${pts} L${W},${H} Z`}
        fill="url(#pnlFill)"
      />
      <polyline
        fill="none"
        stroke="var(--accent-bright)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        points={pts}
      />
    </svg>
  );
}

