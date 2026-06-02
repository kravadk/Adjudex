"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { AlertTriangle, ArrowRightLeft } from "lucide-react";

// Global banner shown when the connected wallet is on a chain we don't
// support. We don't render anything if the user is disconnected (the
// "Connect" CTA covers that case) or if they're already on the expected
// chain. Sits in the document flow so it pushes content down — not
// fixed/sticky — to make it obvious until the user acts.

const SUPPORTED = new Set<number>([arbitrumSepolia.id]);
const EXPECTED_CHAIN_ID = arbitrumSepolia.id;
const EXPECTED_LABEL = "Arbitrum Sepolia";

export function NetworkBanner() {
  const { isConnected } = useAccount();
  const activeChainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) return null;
  if (SUPPORTED.has(activeChainId)) return null;

  return (
    <div
      className="mb-3 rounded-[12px] flex items-center gap-3 px-4 py-3"
      style={{
        background: "rgba(245, 158, 11, 0.08)",
        border: "1px solid rgba(245, 158, 11, 0.30)",
      }}
      role="alert"
    >
      <AlertTriangle
        className="w-4 h-4 flex-shrink-0"
        style={{ color: "#f59e0b" }}
        strokeWidth={2.4}
      />
      <div className="min-w-0 flex-1">
        <div
          className="text-[13px] font-bold leading-snug"
          style={{ color: "#fbbf24" }}
        >
          Wrong network
        </div>
        <div
          className="text-[12px] font-medium leading-snug mt-0.5"
          style={{ color: "var(--t2)" }}
        >
          You&apos;re on chain {activeChainId}. Adjudex runs on {EXPECTED_LABEL}{" "}
          right now — switch to place positions and view balances.
        </div>
      </div>
      <button
        type="button"
        onClick={() => switchChain({ chainId: EXPECTED_CHAIN_ID })}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[12px] font-bold flex-shrink-0 disabled:opacity-50"
        style={{
          background: "#f59e0b",
          color: "#0a0a0a",
        }}
      >
        <ArrowRightLeft className="w-3.5 h-3.5" />
        {isPending ? "Switching…" : `Switch to ${EXPECTED_LABEL}`}
      </button>
    </div>
  );
}
