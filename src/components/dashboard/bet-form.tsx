"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X, Clock, Zap } from "lucide-react";
import { useAccount, useBalance } from "wagmi";
import { USER_SETTINGS_EVENT } from "@/components/app/UserSettingsEffects";
import type { MarketView as Market } from "@/lib/market-view";
import { formatUsd } from "@/lib/market-view";
import { getServices } from "@/lib/services/provider";
import { HARD_CUTOFF_MS } from "@/lib/market-live-status";
import { stakeTokenForChain } from "@/lib/stake-token";
import { describeTxError } from "@/lib/utils/decode-error";
import { ConfettiBurst } from "./confetti-burst";
import { showToast } from "./toast";
import type { BetQuote, UserSettings } from "@/lib/types/domain";

type Props = {
  market: Market;
  side: "yes" | "no";
  onClose: () => void;
  onConfirm?: (stake: number, onStep: (step: string) => void, opts: { gasless: boolean }) => Promise<void> | void;
  gaslessAvailable?: boolean;
};

export function BetForm({ market, side, onClose, onConfirm, gaslessAvailable = false }: Props) {
  const { address } = useAccount();
  const stakeTokenAddress = stakeTokenForChain(market.chainId);
  const { data: onchainBalance, isLoading: balanceFetching } = useBalance({
    address,
    token: stakeTokenAddress,
    query: { enabled: Boolean(address && stakeTokenAddress) },
  });

  const notConnected = !address;
  // Distinguish "still loading the balance" from a real zero so we never block
  // the form as insufficient-balance before the read resolves.
  const balanceLoading = Boolean(address && stakeTokenAddress) && balanceFetching && !onchainBalance;
  const walletBalance = onchainBalance ? Number(onchainBalance.formatted) : 0;
  const [stake, setStake] = useState(() => Math.max(1, Math.min(50, Math.floor((walletBalance || 100) / 10))));
  const [stakeTouched, setStakeTouched] = useState(false);
  const [quote, setQuote] = useState<BetQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [gasless, setGasless] = useState(true);

  const sideColor = side === "yes" ? "#10b981" : "#ef4444";
  const sideLabel = side.toUpperCase() as "YES" | "NO";
  const maxStake = Math.max(1, Math.floor(walletBalance > 0 ? walletBalance : 1000));
  const overBalance = !balanceLoading && !notConnected && stake > Math.floor(walletBalance);
  const poolImpact = quote?.poolImpactPct ?? 0;
  const highImpact = poolImpact > 5;

  // Live countdown to lock + T-5s hard cutoff. Re-render every second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const deadlineTs = new Date(market.deadlineIso).getTime();
  const msToDeadline = Number.isFinite(deadlineTs)
    ? Math.max(0, deadlineTs - now)
    : Infinity;
  const hardCutoff = Number.isFinite(deadlineTs) && msToDeadline <= HARD_CUTOFF_MS;
  const closingSoon = !hardCutoff && msToDeadline < 60_000;

  const clampStake = useCallback((value: number) => {
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(maxStake, Math.round(value)));
  }, [maxStake]);

  const updateStake = useCallback((value: number) => {
    setStakeTouched(true);
    setStake(clampStake(value));
  }, [clampStake]);

  useEffect(() => {
    let cancelled = false;

    async function loadDefaultStake() {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (!response.ok) return;
        const settings = (await response.json()) as UserSettings;
        if (!cancelled && !stakeTouched) setStake(clampStake(settings.defaultStakeUsd));
      } catch {
        return;
      }
    }

    function onSettingsUpdated(event: Event) {
      const settings = (event as CustomEvent<UserSettings>).detail;
      if (settings && !stakeTouched) setStake(clampStake(settings.defaultStakeUsd));
    }

    window.addEventListener(USER_SETTINGS_EVENT, onSettingsUpdated);
    void loadDefaultStake();

    return () => {
      cancelled = true;
      window.removeEventListener(USER_SETTINGS_EVENT, onSettingsUpdated);
    };
  }, [clampStake, stakeTouched]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setQuoteLoading(true);
        setQuoteError(null);
        const nextQuote = await getServices().betService.previewBet({
          marketId: market.id,
          side: sideLabel,
          stakeUsd: stake,
          address,
        });
        if (!controller.signal.aborted) setQuote(nextQuote);
      } catch (error) {
        if (controller.signal.aborted) return;
        setQuote(null);
        setQuoteError(error instanceof Error ? error.message : "Backend quote is unavailable.");
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [address, market.id, sideLabel, stake]);

  function addStep(step: string) {
    setSteps((current) => [...current, step]);
  }

  async function confirm() {
    if (notConnected || balanceLoading || overBalance || hardCutoff || !quote || quoteLoading || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setSteps([]);
    try {
      addStep("Waiting for wallet");
      await onConfirm?.(stake, addStep, { gasless: gaslessAvailable && gasless });
      addStep("Portfolio and market refreshed");
      setCelebrate(true);
      showToast({
        kind: "success",
        title: `${sideLabel} position confirmed`,
        body: `$${stake.toLocaleString()} staked. Portfolio updated.`,
      });
      window.setTimeout(onClose, 900);
    } catch (error) {
      const decoded = describeTxError(error);
      // A deliberate wallet cancellation is not a failure — surface it quietly.
      setSubmitError(decoded.rejected ? null : decoded.message);
      addStep(decoded.rejected ? "Cancelled" : `Failed: ${decoded.message}`);
      showToast({
        kind: decoded.rejected ? "info" : "error",
        title: decoded.title,
        body: decoded.message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4"
      onClick={submitting ? undefined : onClose}
    >
      <ConfettiBurst trigger={celebrate} onDone={() => setCelebrate(false)} />
      <div
        className="w-full overflow-hidden rounded-t-[10px] border border-[#2a2a2a] bg-[#181818] md:max-w-md md:rounded-[8px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#2a2a2a] p-4">
          <div className="min-w-0">
            <div className="truncate text-[11px] text-gray-500">{market.title}</div>
            <div className="text-[18px] font-semibold tracking-tight" style={{ color: sideColor }}>
              Position on {sideLabel}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[5px] border border-[#2a2a2a] bg-[#232323] text-gray-400 hover:text-white disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <div className="font-mono text-[36px] font-semibold tracking-tight text-white tabular-nums">${stake}</div>
              <div className="font-mono text-[11px] text-gray-500 tabular-nums">Wallet: {formatUsd(walletBalance, { compact: true })}</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={maxStake}
                step={1}
                value={stake}
                onChange={(event) => updateStake(Number(event.target.value))}
                disabled={submitting}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full disabled:opacity-50"
                style={{
                  background: `linear-gradient(to right, ${sideColor} 0%, ${sideColor} ${(stake / maxStake) * 100}%, #2a2a2a ${(stake / maxStake) * 100}%, #2a2a2a 100%)`,
                }}
              />
              <button onClick={() => updateStake(Math.floor(walletBalance))} disabled={submitting} className="rounded-[4px] border border-[#2a2a2a] px-2 py-1 text-[11px] font-medium text-gray-400 hover:border-[#3a3a3a] hover:text-white disabled:opacity-40">
                Max
              </button>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5">
              {[10, 50, 100, 500].map((value) => (
                <button key={value} onClick={() => updateStake(value)} disabled={submitting} className="rounded-[3px] border border-[#262626] px-2 py-0.5 font-mono text-[10.5px] text-gray-400 tabular-nums hover:border-[#3a3a3a] hover:text-white disabled:opacity-40">
                  ${value}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[6px] border border-[#262626] bg-[#1f1f1f] p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="text-[10.5px] uppercase tracking-[0.08em] text-gray-500">Backend quote</div>
              {quoteLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500" />}
            </div>
            {quoteError ? (
              <div className="rounded-[6px] border border-[#5b3535] bg-[#241b1b] px-3 py-2 text-[11.5px] text-[#fca5a5]">
                Quote unavailable. Configure API/indexer state before trading.
              </div>
            ) : quote ? (
              <dl className="space-y-1.5 text-[12px]">
                <QuoteRow label={`${sideLabel} price`} value={`${(quote.price * 100).toFixed(2)}%`} />
                <QuoteRow label="Expected shares" value={quote.shares.toFixed(4)} />
                <QuoteRow label="Potential payout" value={formatUsd(quote.potentialPayoutUsd)} />
                <QuoteRow label="Pool impact" value={`${poolImpact.toFixed(2)}%`} tone={highImpact ? "warn" : undefined} />
                <QuoteRow label="Estimated gas" value={quote.estimatedGasUsd ? formatUsd(quote.estimatedGasUsd) : "RPC estimate unavailable"} />
                <QuoteRow label="Contract" value={quote.requiredContract ?? "not configured"} mono />
                <QuoteRow label="Function" value={quote.requiredFunction ?? "bet"} mono />
              </dl>
            ) : (
              <div className="text-[11.5px] text-gray-500">Waiting for backend quote...</div>
            )}
          </div>

          {notConnected && <Warning>Connect your wallet to place a position.</Warning>}
          {balanceLoading && (
            <div className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-[11.5px]" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid #2a2a2a", color: "#9ca3af" }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking your USDC balance...
            </div>
          )}
          {overBalance && <Warning>Insufficient USDC. Balance <span className="font-mono">${walletBalance.toFixed(2)}</span>.</Warning>}
          {highImpact && <Warning>This position has high pool impact. Consider splitting into smaller positions.</Warning>}
          {hardCutoff && (
            <Warning>
              <Clock className="w-3.5 h-3.5 inline-block mr-1" />
              Deadline reached. Positions disabled to avoid race with on-chain lock.
            </Warning>
          )}
          {closingSoon && !hardCutoff && (
            <div
              className="rounded-[6px] px-3 py-2 text-[11.5px] font-mono tabular-nums"
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.40)",
                color: "#fca5a5",
              }}
            >
              <Clock className="w-3.5 h-3.5 inline-block mr-1" />
              Closing in {Math.max(0, Math.ceil(msToDeadline / 1000))}s. Hard
              cutoff at T-{Math.round(HARD_CUTOFF_MS / 1000)}s.
            </div>
          )}
          {submitError && <Warning>{submitError}</Warning>}

          {steps.length > 0 && (
            <div className="rounded-[6px] border border-[#262626] bg-[#1f1f1f] p-3">
              <div className="mb-2 text-[10.5px] uppercase tracking-[0.08em] text-gray-500">Transaction timeline</div>
              <div className="space-y-2">
                {steps.map((step, index) => (
                  <div key={`${step}-${index}`} className="flex items-start gap-2 text-[11.5px] text-gray-300">
                    {index === steps.length - 1 && submitting ? (
                      <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-[color:var(--accent-bright)]" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-[color:var(--green-dot)]" />
                    )}
                    <span className="min-w-0 break-words">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {gaslessAvailable && (
            <button
              type="button"
              onClick={() => setGasless((on) => !on)}
              disabled={submitting}
              className="flex w-full items-start gap-2.5 rounded-[6px] border px-3 py-2.5 text-left disabled:opacity-50"
              style={{ borderColor: gasless ? "var(--accent-bright)" : "#2a2a2a", background: "#1f1f1f" }}
            >
              <span
                className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] border"
                style={{
                  borderColor: gasless ? "var(--accent-bright)" : "#3a3a3a",
                  background: gasless ? "var(--accent-bright)" : "transparent",
                }}
              >
                {gasless && <Zap className="h-3 w-3 text-black" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-white">Gasless bet — no ETH needed</span>
                <span className="block text-[11px] leading-relaxed text-gray-500">
                  Routed through a ZeroDev smart account; the USDC approval and bet are
                  sponsored. Untick to sign a normal wallet transaction instead.
                </span>
              </span>
            </button>
          )}

          <button
            onClick={() => void confirm()}
            disabled={notConnected || balanceLoading || overBalance || hardCutoff || !quote || quoteLoading || submitting}
            className={`inline-flex h-11 w-full items-center justify-between gap-2 rounded-[5px] px-4 text-[12.5px] font-bold uppercase tracking-wider shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
              side === "yes"
                ? "bg-[#10b981] text-black hover:bg-[#0ea674]"
                : "bg-[#ef4444] text-white hover:bg-[#dc2626]"
            }`}
          >
            <span>{confirmLabel({ submitting, notConnected, balanceLoading, hardCutoff, stake })}</span>
            <span className="font-mono normal-case tracking-normal opacity-95 tabular-nums">
              {quote ? `${formatUsd(quote.potentialPayoutUsd, { compact: true })} payout` : "quote required"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function confirmLabel(s: {
  submitting: boolean;
  notConnected: boolean;
  balanceLoading: boolean;
  hardCutoff: boolean;
  stake: number;
}): string {
  if (s.notConnected) return "Connect wallet";
  if (s.submitting) return "Processing...";
  if (s.balanceLoading) return "Checking balance...";
  if (s.hardCutoff) return "Betting closed";
  return `Open position $${s.stake}`;
}

function QuoteRow({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "warn" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gray-400">{label}</dt>
      <dd className={`truncate text-right tabular-nums ${mono ? "font-mono" : "font-mono"}`} style={{ color: tone === "warn" ? "#f59e0b" : "var(--tx)" }}>
        {value}
      </dd>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[6px] px-3 py-2 text-[11.5px]" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.35)", color: "#fbbf24" }}>
      <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}
