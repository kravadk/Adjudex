"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Hammer } from "lucide-react";
import { useAccount, useReadContract } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Address } from "viem";
import aiJudgeVerifierAbi from "@/lib/abi/AIJudgeVerifier.json";
import { wagmiConfig } from "@/lib/wagmi";

type Props = {
  marketId: string;
  verifierAddress?: Address;
  chainId?: number;
  poolResolved?: boolean;
  resolvedOutcome?: "YES" | "NO";
  evidenceProofTxHash?: string;
};

// On-chain proposal status enum from AIJudgeVerifier.sol
const STATUS_NONE = 0;
const STATUS_PENDING = 1;
const STATUS_CHALLENGED = 2;
const STATUS_RESET = 3;
const STATUS_ESCALATED = 4;
const STATUS_FINALIZED = 5;

export function ResolutionStatus({
  marketId,
  verifierAddress,
  chainId,
  poolResolved,
  resolvedOutcome,
  evidenceProofTxHash,
}: Props) {
  const { address } = useAccount();
  const [busy, setBusy] = useState<"challenge" | "finalize" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmedTx, setConfirmedTx] = useState<string | null>(null);

  const onchainMarketId = parseOnchainMarketId(marketId);
  const enabled = Boolean(verifierAddress && onchainMarketId !== null);

  const { data: proposalRaw, refetch: refetchProposal } = useReadContract({
    address: verifierAddress,
    abi: aiJudgeVerifierAbi,
    functionName: "proposals",
    args: enabled && onchainMarketId !== null ? [onchainMarketId] : undefined,
    chainId,
    query: { enabled, refetchInterval: 15_000 },
  });

  const { data: canFinalize } = useReadContract({
    address: verifierAddress,
    abi: aiJudgeVerifierAbi,
    functionName: "canFinalize",
    args: enabled && onchainMarketId !== null ? [onchainMarketId] : undefined,
    chainId,
    query: { enabled, refetchInterval: 15_000 },
  });

  const { data: deadlineRaw } = useReadContract({
    address: verifierAddress,
    abi: aiJudgeVerifierAbi,
    functionName: "challengeDeadline",
    args: enabled && onchainMarketId !== null ? [onchainMarketId] : undefined,
    chainId,
    query: { enabled, refetchInterval: 15_000 },
  });

  // proposals(marketId) returns tuple (pool, outcome, evidenceHash, proposedAt, status, challenger, challengeCount, bondPosted)
  const tuple = proposalRaw as
    | readonly [Address, number, `0x${string}`, bigint, number, Address, number, bigint]
    | undefined;
  const status = tuple ? Number(tuple[4]) : STATUS_NONE;
  const proposedOutcome = tuple ? (Number(tuple[1]) === 0 ? "YES" : "NO") : null;
  const evidenceHash = tuple?.[2] ?? null;
  const challenger = tuple?.[5] ?? null;
  const deadline = deadlineRaw ? Number(deadlineRaw) : 0;

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const secondsRemaining = Math.max(0, deadline - now);

  async function call(fn: "challenge" | "finalize") {
    if (!verifierAddress || !enabled || onchainMarketId === null) return;
    setError(null);
    setBusy(fn);
    try {
      const hash = await writeContract(wagmiConfig, {
        address: verifierAddress,
        abi: aiJudgeVerifierAbi,
        functionName: fn,
        args: [onchainMarketId],
        chainId,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId });
      setConfirmedTx(hash);
      void refetchProposal();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${fn} failed`);
    } finally {
      setBusy(null);
    }
  }

  if (poolResolved) {
    return (
      <div
        className="rounded-[8px] border p-4"
        style={{
          background: "var(--card-inner)",
          borderColor: "var(--line)",
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 className="w-4 h-4" style={{ color: "var(--green-tx)" }} />
          <span
            className="text-[13px] font-semibold"
            style={{ color: "var(--tx)" }}
          >
            Resolved · outcome {resolvedOutcome ?? proposedOutcome ?? "?"}
          </span>
        </div>
        {evidenceHash && (
          <div className="text-[11px] font-mono break-all" style={{ color: "var(--t3)" }}>
            evidence {evidenceHash}
          </div>
        )}
        {evidenceProofTxHash && (
          <a
            href={`https://sepolia.arbiscan.io/tx/${evidenceProofTxHash}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-[11px] hover:underline"
            style={{ color: "var(--accent-bright)" }}
          >
            View proof tx →
          </a>
        )}
      </div>
    );
  }

  if (!enabled) return null;

  if (status === STATUS_NONE) {
    return (
      <div
        className="rounded-[8px] border p-3 text-[12px]"
        style={{
          background: "var(--card-inner)",
          borderColor: "var(--line)",
          color: "var(--t2)",
        }}
      >
        <Clock className="inline-block w-3.5 h-3.5 mr-1.5" />
        Awaiting AI judge proposal.
      </div>
    );
  }

  return (
    <div
      className="rounded-[8px] border p-4 space-y-3"
      style={{
        background: "var(--card-inner)",
        borderColor:
          status === STATUS_CHALLENGED || status === STATUS_RESET || status === STATUS_ESCALATED
            ? "rgba(245,158,11,0.4)"
            : "var(--line)",
      }}
    >
      <div className="flex items-center gap-2">
        {status === STATUS_PENDING && (
          <>
            <Clock className="w-4 h-4" style={{ color: "var(--accent-bright)" }} />
            <span
              className="text-[13px] font-semibold"
              style={{ color: "var(--tx)" }}
            >
              Proposed · {proposedOutcome}
            </span>
            <span
              className="text-[11px] font-mono ml-auto"
              style={{ color: "var(--t3)" }}
            >
              window: {formatCountdown(secondsRemaining)}
            </span>
          </>
        )}
        {(status === STATUS_CHALLENGED || status === STATUS_RESET || status === STATUS_ESCALATED) && (
          <>
            <AlertTriangle
              className="w-4 h-4"
              style={{ color: "var(--amber-tx)" }}
            />
            <span
              className="text-[13px] font-semibold"
              style={{ color: "var(--tx)" }}
            >
              {status === STATUS_RESET
                ? "Reset - new proposal required"
                : status === STATUS_ESCALATED
                  ? "Escalated - multisig override required"
                  : "Challenged"}
            </span>
          </>
        )}
        {status === STATUS_FINALIZED && (
          <>
            <CheckCircle2
              className="w-4 h-4"
              style={{ color: "var(--green-tx)" }}
            />
            <span
              className="text-[13px] font-semibold"
              style={{ color: "var(--tx)" }}
            >
              Finalized · {proposedOutcome}
            </span>
          </>
        )}
      </div>

      {evidenceHash && (
        <div className="text-[11px] font-mono break-all" style={{ color: "var(--t3)" }}>
          evidence {evidenceHash}
        </div>
      )}
      {challenger && challenger !== "0x0000000000000000000000000000000000000000" && (
        <div className="text-[11px] font-mono" style={{ color: "var(--t3)" }}>
          challenger {challenger.slice(0, 6)}…{challenger.slice(-4)}
        </div>
      )}

      {status === STATUS_PENDING && (
        <div className="flex gap-2">
          <button
            onClick={() => call("challenge")}
            disabled={!address || busy !== null || secondsRemaining === 0}
            className="btn ghost"
            title={
              !address
                ? "Connect wallet to challenge"
                : secondsRemaining === 0
                  ? "Challenge window closed"
                  : "Open a dispute on this proposal"
            }
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {busy === "challenge" ? "Submitting…" : "Challenge"}
          </button>
          <button
            onClick={() => call("finalize")}
            disabled={!address || busy !== null || !canFinalize}
            className="btn primary"
            title={
              !canFinalize
                ? "Window still open — wait for it to close"
                : "Finalize and unlock claims"
            }
          >
            <Hammer className="w-3.5 h-3.5" />
            {busy === "finalize" ? "Finalizing…" : "Finalize"}
          </button>
        </div>
      )}

      {error && (
        <div
          className="text-[11px] rounded-[6px] px-2 py-1.5"
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.35)",
            color: "#fca5a5",
          }}
        >
          {error}
        </div>
      )}
      {confirmedTx && (
        <a
          href={`https://sepolia.arbiscan.io/tx/${confirmedTx}`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] hover:underline"
          style={{ color: "var(--accent-bright)" }}
        >
          tx {confirmedTx.slice(0, 10)}… →
        </a>
      )}
    </div>
  );
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "closed";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function parseOnchainMarketId(marketId: string): bigint | null {
  const raw = marketId.includes(":") ? marketId.split(":").at(-1) : marketId;
  if (!raw || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}
