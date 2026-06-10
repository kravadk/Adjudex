"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Zap } from "lucide-react";
import { useAccount, useBalance } from "wagmi";
import type { MarketView as Market } from "@/lib/market-view";
import { formatUsd, multiplierFromPct } from "@/lib/market-view";
import { getServices } from "@/lib/services/provider";
import { useBet } from "@/lib/hooks/useBet";
import { HARD_CUTOFF_MS } from "@/lib/market-live-status";
import { stakeTokenForChain } from "@/lib/stake-token";
import { describeTxError } from "@/lib/utils/decode-error";
import { isZeroDevGaslessEnabled } from "@/lib/zerodev/gasless-bet";
import { ConfettiBurst } from "./confetti-burst";
import { showToast } from "./toast";
import type { BetQuote } from "@/lib/types/domain";

// Inline bet ticket that lives in the sticky desktop aside (the modal BetForm
// stays as the mobile fallback). Reuses the exact execution path —
// useBet().placeBet — and the backend quote service, so behaviour matches the
// tested modal flow; the only additions are the YES/NO toggle and inline layout.
const QUICK = [10, 25, 100];

export function InlineBetTicket({ market, onPlaced }: { market: Market; onPlaced?: () => void }) {
  const gaslessAvailable = isZeroDevGaslessEnabled();
  const { placeBet } = useBet();
  const { address } = useAccount();
  const stakeTokenAddress = stakeTokenForChain(market.chainId);
  const { data: onchainBalance, isLoading: balanceFetching } = useBalance({
    address,
    token: stakeTokenAddress,
    query: { enabled: Boolean(address && stakeTokenAddress) },
  });

  const [side, setSide] = useState<"yes" | "no">("yes");
  const [stake, setStake] = useState(25);
  const [quote, setQuote] = useState<BetQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [gasless, setGasless] = useState(true);

  const sideLabel = side.toUpperCase() as "YES" | "NO";
  const notConnected = !address;
  const balanceLoading = Boolean(address && stakeTokenAddress) && balanceFetching && !onchainBalance;
  const walletBalance = onchainBalance ? Number(onchainBalance.formatted) : 0;
  const maxStake = Math.max(1, Math.floor(walletBalance > 0 ? walletBalance : 1000));
  const overBalance = !balanceLoading && !notConnected && stake > Math.floor(walletBalance);
  const price = side === "yes" ? market.yesPct : 1 - market.yesPct;
  const mult = multiplierFromPct(price);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const deadlineTs = new Date(market.deadlineIso).getTime();
  const msToDeadline = Number.isFinite(deadlineTs) ? Math.max(0, deadlineTs - now) : Infinity;
  const hardCutoff = Number.isFinite(deadlineTs) && msToDeadline <= HARD_CUTOFF_MS;

  const clamp = useCallback((v: number) => (Number.isFinite(v) ? Math.max(1, Math.min(maxStake, Math.round(v))) : 1), [maxStake]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setQuoteLoading(true);
        const next = await getServices().betService.previewBet({ marketId: market.id, side: sideLabel, stakeUsd: stake, address });
        if (!controller.signal.aborted) setQuote(next);
      } catch {
        if (!controller.signal.aborted) setQuote(null);
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [address, market.id, sideLabel, stake]);

  const disabled = notConnected || balanceLoading || overBalance || hardCutoff || submitting;
  const payout = quote ? quote.potentialPayoutUsd : stake * mult;

  async function confirm() {
    if (disabled) return;
    setSubmitting(true);
    setSubmitError(null);
    setSteps([]);
    const addStep = (s: string) => setSteps((c) => [...c, s]);
    try {
      addStep("Waiting for wallet");
      await placeBet({ marketId: market.id, side: sideLabel, stakeUsd: stake, poolAddress: market.poolAddress, chainId: market.chainId }, addStep, { gasless: gaslessAvailable && gasless });
      addStep("Portfolio and market refreshed");
      setCelebrate(true);
      showToast({ kind: "success", title: `${sideLabel} position confirmed`, body: `$${stake.toLocaleString()} staked.` });
      onPlaced?.();
    } catch (error) {
      const decoded = describeTxError(error);
      setSubmitError(decoded.rejected ? null : decoded.message);
      addStep(decoded.rejected ? "Cancelled" : `Failed: ${decoded.message}`);
      showToast({ kind: decoded.rejected ? "info" : "error", title: decoded.title, body: decoded.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel-raised p-4 space-y-3.5">
      <ConfettiBurst trigger={celebrate} onDone={() => setCelebrate(false)} />

      {/* YES / NO segmented toggle */}
      <div className="grid grid-cols-2 gap-1.5 rounded-[7px] bg-[color:var(--card-inner)] p-1">
        {(["yes", "no"] as const).map((s) => {
          const sActive = side === s;
          const sColor = s === "yes" ? "var(--yes-bg)" : "var(--no-bg)";
          const sTx = s === "yes" ? "var(--yes-tx)" : "var(--no-tx)";
          const sPct = s === "yes" ? market.yesPct : 1 - market.yesPct;
          return (
            <button
              key={s}
              onClick={() => setSide(s)}
              className="h-11 rounded-[6px] px-3 text-left transition-all active:scale-[0.98]"
              style={{
                background: sActive ? sColor : "transparent",
                color: sActive ? sTx : "var(--t2)",
                border: sActive ? "none" : "1px solid var(--line)",
              }}
            >
              <span className="block text-[10px] font-bold uppercase tracking-[0.12em]">{s}</span>
              <span className="font-mono text-[13px] font-semibold tabular-nums">{Math.round(sPct * 100)}% · {multiplierFromPct(sPct).toFixed(2)}x</span>
            </button>
          );
        })}
      </div>

      {/* Stake amount */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--t3)]">Amount</span>
          <span className="font-mono text-[11px] tabular-nums text-[color:var(--t3)]">Wallet: {formatUsd(walletBalance, { compact: true })}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex flex-1 items-center rounded-[6px] border border-[color:var(--line)] bg-[color:var(--card-inner)] px-2.5">
            <span className="font-mono text-[15px] text-[color:var(--t3)]">$</span>
            <input
              type="number"
              min={1}
              value={stake}
              onChange={(e) => setStake(clamp(Number(e.target.value)))}
              disabled={submitting}
              className="h-10 w-full bg-transparent px-1 font-mono text-[18px] font-semibold tabular-nums text-white outline-none disabled:opacity-50"
            />
          </div>
          <button onClick={() => setStake(clamp(walletBalance))} disabled={submitting} className="h-10 rounded-[6px] border border-[color:var(--line)] px-2.5 text-[11px] font-medium text-[color:var(--t2)] hover:text-white disabled:opacity-40">
            Max
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          {QUICK.map((v) => (
            <button key={v} onClick={() => setStake(clamp(v))} disabled={submitting} className="rounded-[4px] border border-[color:var(--line)] px-2 py-0.5 font-mono text-[10.5px] tabular-nums text-[color:var(--t2)] hover:text-white disabled:opacity-40">
              ${v}
            </button>
          ))}
        </div>
      </div>

      {/* Payout preview */}
      <div className="rounded-[6px] border border-[color:var(--line)] bg-[color:var(--card-inner)] px-3 py-2.5">
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-[color:var(--t2)] inline-flex items-center gap-1.5">
            Potential payout
            {quoteLoading && <Loader2 className="h-3 w-3 animate-spin text-[color:var(--t3)]" />}
          </span>
          <span className="font-mono text-[15px] font-semibold tabular-nums text-white">{formatUsd(payout)}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between text-[11px] text-[color:var(--t3)]">
          <span>{sideLabel} @ {(price * 100).toFixed(0)}%</span>
          <span className="font-mono tabular-nums">to win {formatUsd(Math.max(0, payout - stake))}</span>
        </div>
      </div>

      {notConnected && <Note tone="warn">Connect your wallet to place a position.</Note>}
      {overBalance && <Note tone="warn">Insufficient USDC · balance <span className="font-mono">${walletBalance.toFixed(2)}</span>.</Note>}
      {hardCutoff && <Note tone="warn"><Clock className="mr-1 inline h-3 w-3" />Deadline reached — betting closed.</Note>}
      {submitError && <Note tone="warn">{submitError}</Note>}

      {steps.length > 0 && (
        <div className="rounded-[6px] border border-[color:var(--line)] bg-[color:var(--card-inner)] p-2.5 space-y-1.5">
          {steps.map((step, i) => (
            <div key={`${step}-${i}`} className="flex items-start gap-2 text-[11px] text-[color:var(--t2)]">
              {i === steps.length - 1 && submitting ? (
                <Loader2 className="mt-0.5 h-3 w-3 animate-spin text-[color:var(--accent-bright)]" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-3 w-3 text-[color:var(--green-dot)]" />
              )}
              <span className="min-w-0 break-words">{step}</span>
            </div>
          ))}
        </div>
      )}

      {gaslessAvailable && (
        <button
          type="button"
          onClick={() => setGasless((on) => !on)}
          disabled={submitting}
          className="flex w-full items-center gap-2 rounded-[6px] border px-3 py-2 text-left text-[11.5px] disabled:opacity-50"
          style={{ borderColor: gasless ? "var(--accent-bright)" : "var(--line)", background: "var(--card-inner)" }}
        >
          <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] border" style={{ borderColor: gasless ? "var(--accent-bright)" : "#3a3a3a", background: gasless ? "var(--accent-bright)" : "transparent" }}>
            {gasless && <Zap className="h-3 w-3 text-black" />}
          </span>
          <span className="text-[color:var(--t2)]">Gasless bet — no ETH needed</span>
        </button>
      )}

      <button
        onClick={() => void confirm()}
        disabled={disabled}
        className="inline-flex h-11 w-full items-center justify-between gap-2 rounded-[6px] px-4 text-[12.5px] font-bold uppercase tracking-wider transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          background: side === "yes" ? "var(--yes-bg)" : "var(--no-bg)",
          color: side === "yes" ? "var(--yes-tx)" : "var(--no-tx)",
        }}
      >
        <span>{label({ submitting, notConnected, balanceLoading, hardCutoff, stake })}</span>
        <span className="font-mono normal-case tracking-normal tabular-nums opacity-95">{formatUsd(payout, { compact: true })}</span>
      </button>
    </div>
  );
}

function label(s: { submitting: boolean; notConnected: boolean; balanceLoading: boolean; hardCutoff: boolean; stake: number }) {
  if (s.notConnected) return "Connect wallet";
  if (s.submitting) return "Processing…";
  if (s.balanceLoading) return "Checking balance…";
  if (s.hardCutoff) return "Betting closed";
  return `Bet $${s.stake}`;
}

function Note({ children, tone }: { children: React.ReactNode; tone: "warn" }) {
  return (
    <div className="flex items-start gap-2 rounded-[6px] px-3 py-2 text-[11.5px]" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.35)", color: "#fbbf24" }}>
      {tone === "warn" && <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" />}
      <span>{children}</span>
    </div>
  );
}
