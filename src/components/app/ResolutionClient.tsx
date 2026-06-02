"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Sparkles, ShieldCheck, ExternalLink } from "lucide-react";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Address, Hex } from "viem";
import { arbitrumSepolia } from "wagmi/chains";
import aiJudgeVerifierAbi from "@/lib/abi/AIJudgeVerifier.json";
import { CapsLabel, Pill } from "@/components/dashboard/market-atoms";
import { useMarkets } from "@/lib/hooks/useMarkets";
import { useWallet } from "@/lib/hooks/useWallet";
import { robinhoodChainTestnet, wagmiConfig } from "@/lib/wagmi";
import { toMarketView } from "@/lib/market-view";

type ReclaimSession = { sessionId: string; requestUrl: string; statusUrl: string };
type ReclaimProof = {
  proofHash: `0x${string}`;
  marketId?: string;
  sourceUrl?: string;
  chainId?: number;
  poolAddress?: string;
};
type ResolverVerdict = {
  outcome: 0 | 1;
  outcomeLabel: "YES" | "NO";
  evidenceHash: `0x${string}`;
  reasoning: string;
  signature: `0x${string}`;
  reclaimProofHash?: `0x${string}` | null;
  attestation?: { quote: string; reportData: string } | null;
  chainId: number;
};
type SupportedChainId = (typeof wagmiConfig.chains)[number]["id"];

const ARBITRUM_VERIFIER_ADDRESS = process.env.NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS as
  | Address
  | undefined;
const RHC_VERIFIER_ADDRESS = process.env.NEXT_PUBLIC_RHC_AI_JUDGE_VERIFIER_ADDRESS as
  | Address
  | undefined;

export function ResolutionClient() {
  const { markets } = useMarkets();
  const { account } = useWallet();
  const [marketIdInput, setMarketIdInput] = useState<string>("");
  const marketId = marketIdInput || markets[0]?.id || "";
  const question = markets.find((m) => m.id === marketId)?.title || "";
  const setMarketId = setMarketIdInput;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reclaim, setReclaim] = useState<ReclaimSession | null>(null);
  const [proof, setProof] = useState<ReclaimProof | null>(null);
  const [verdict, setVerdict] = useState<ResolverVerdict | null>(null);
  const [resolveTx, setResolveTx] = useState<Hex | null>(null);

  const selectedMarket = useMemo(() => {
    const m = markets.find((x) => x.id === marketId);
    return m ? toMarketView(m) : null;
  }, [marketId, markets]);
  const selectedVerifierAddress = selectedMarket?.chainId
    ? verifierAddressForChain(selectedMarket.chainId)
    : undefined;

  useEffect(() => {
    if (!reclaim || proof) return;
    let cancelled = false;
    const id = setInterval(async () => {
      if (cancelled) return;
      const res = await fetch(`/api/reclaim/get?sessionId=${encodeURIComponent(reclaim.sessionId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        found: boolean;
        proof?: ReclaimProof;
      };
      if (data.found && data.proof) {
        setProof(data.proof);
        clearInterval(id);
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [reclaim, proof]);

  async function startReclaim() {
    if (!selectedMarket) {
      setError("Select an indexed market before starting source proof.");
      return;
    }
    if (!selectedMarket.sourceUrl) {
      setError("Selected market must define source URL before source proof flow.");
      return;
    }
    setError(null);
    setBusy("reclaim");
    try {
      const res = await fetch("/api/reclaim/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketId: selectedMarket.id,
          sourceUrl: selectedMarket.sourceUrl,
          chainId: selectedMarket.chainId,
          poolAddress: selectedMarket.poolAddress,
          walletAddress: account?.address,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Reclaim session failed");
      }
      const data = (await res.json()) as ReclaimSession;
      setReclaim(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function requestResolution() {
    if (!selectedMarket?.poolAddress) {
      setError("Select a market with an on-chain pool first.");
      return;
    }
    if (!selectedMarket.chainId) {
      setError("Selected market has no chain id.");
      return;
    }
    if (!proof || !reclaim) {
      setError("Verified source proof is required before requesting a signed verdict.");
      return;
    }
    setBusy("resolution");
    setError(null);
    try {
      const body: Record<string, unknown> = {
        pool: selectedMarket.poolAddress,
        marketId: selectedMarket.id,
        chainId: selectedMarket.chainId,
      };
      body.reclaimSessionId = reclaim.sessionId;
      const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Resolution route ${res.status}`);
      }
      const data = (await res.json()) as ResolverVerdict;
      setVerdict(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function submitOnchain() {
    if (!verdict || !selectedMarket?.poolAddress || !selectedVerifierAddress) {
      setError(
        selectedMarket?.chainId === robinhoodChainTestnet.id
          ? "Missing RHC verifier address. Set NEXT_PUBLIC_RHC_AI_JUDGE_VERIFIER_ADDRESS."
          : "Missing Arbitrum verifier address. Set NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS.",
      );
      return;
    }
    if (!selectedMarket.chainId || !isSupportedChainId(selectedMarket.chainId)) {
      setError("Selected market chain is not configured in the wallet client.");
      return;
    }
    if (verdict.chainId !== selectedMarket.chainId) {
      setError("Verdict chain does not match the selected market chain.");
      return;
    }
    const contractMarketId = parseMarketContractId(selectedMarket.id);
    if (contractMarketId === null) {
      setError("Selected market id is not a valid contract market id.");
      return;
    }
    setBusy("onchain");
    setError(null);
    try {
      // V2 optimistic flow: propose() stores the signed verdict but does
      // NOT call pool.resolve() - payouts unlock only after CHALLENGE_WINDOW
      // (2h) via finalize(marketId), or via owner overrideAndFinalize after
      // a successful challenge.
      const hash = await writeContract(wagmiConfig, {
        address: selectedVerifierAddress,
        abi: aiJudgeVerifierAbi,
        functionName: "propose",
        args: [
          selectedMarket.poolAddress,
          contractMarketId,
          verdict.outcome,
          verdict.evidenceHash,
          verdict.signature,
        ],
        chainId: selectedMarket.chainId,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId: selectedMarket.chainId });
      setResolveTx(hash);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#1a1a1a]">
      <main className="max-w-[960px] mx-auto px-4 py-5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-4"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to markets
        </Link>

        <div className="mb-6">
          <Pill tone="accent">Configured AI Resolver</Pill>
          <h1 className="text-white text-2xl font-bold tracking-tight mt-3">
            Resolve a market with configured source evidence
          </h1>
          <p className="text-gray-400 text-[13px] leading-relaxed mt-2 max-w-prose">
            Attach source evidence when configured, request a verdict from the configured resolution provider,
            then submit the signed verdict through the verifier flow. Final payout status depends on the
            on-chain challenge and finalize path.
          </p>
        </div>

        {error && (
          <div className="rounded-[6px] border border-[#ef4444]/40 bg-[#ef4444]/5 px-4 py-3 text-[#ef4444] text-sm mb-4">
            {error}
          </div>
        )}

        <Card title="1. Pick the market">
          <label className="text-[11px] text-gray-500 mb-1.5 block">Market</label>
          {(() => {
            const indexed = markets.filter((m) => m.poolAddress);
            if (indexed.length === 0) {
              return (
                <div className="rounded-[5px] border border-[#f59e0b]/40 bg-[#f59e0b]/5 px-3 py-3 text-[#f59e0b] text-[12px] mb-3">
                  No indexed markets yet. Newly-created markets need a few
                  seconds before the pool address is discoverable. Refresh the
                  page after the create transaction confirms.
                </div>
              );
            }
            return (
              <select
                value={marketId}
                onChange={(e) => setMarketId(e.target.value)}
                className="w-full h-10 px-3 rounded-[5px] bg-[#1c1c1c] border border-[#2a2a2a] text-white text-sm mb-3"
              >
                {indexed.map((m) => (
                  <option key={m.id} value={m.id}>
                    #{m.id} - {m.title}
                  </option>
                ))}
              </select>
            );
          })()}
          <label className="text-[11px] text-gray-500 mb-1.5 block">Resolution question</label>
          <textarea
            value={question}
            readOnly
            className="w-full min-h-[64px] p-3 rounded-[5px] bg-[#1c1c1c] border border-[#2a2a2a] text-white text-sm leading-relaxed"
            placeholder="Select an indexed market to load its canonical question."
          />
          <div className="mt-2 text-[10.5px] text-gray-500">
            The signer uses the canonical market title and resolution criteria loaded from the backend.
          </div>
        </Card>

        <Card title="2. Attach source evidence (optional)">
          {!reclaim ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={startReclaim}
                disabled={busy === "reclaim"}
                className="h-10 px-4 rounded-[5px] bg-[#CCE9E7] text-black font-semibold text-[12.5px] hover:bg-[#E8FFFC] disabled:opacity-50"
              >
                {busy === "reclaim" ? "Starting..." : "Start source proof flow"}
              </button>
            </div>
          ) : proof ? (
            <div>
              <Pill tone="yes">Proof received</Pill>
              <div className="mt-2 text-[12px] text-gray-300">
                proof hash{" "}
                <code className="font-mono text-[#CCE9E7]">{proof.proofHash.slice(0, 20)}...</code>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[12px] text-gray-300 mb-2">
                Open the Reclaim attestor URL on your phone or in a new tab. We&apos;ll poll for
                provider-reported proof status.
              </div>
              <a
                href={reclaim.requestUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-[5px] bg-[#CCE9E7] text-black font-semibold text-[12.5px] hover:bg-[#E8FFFC]"
              >
                Open attestor <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <div className="mt-2 text-[10.5px] text-gray-500 font-mono">
                session {reclaim.sessionId.slice(0, 16)}...
              </div>
            </div>
          )}
          {!proof && (
            <div className="mt-3 text-[10.5px] text-[#f59e0b]">
              Source proof is required for production resolution. The resolution route will not sign a prompt-only verdict.
            </div>
          )}
        </Card>

        <Card title="3. Request configured resolution">
          <button
            onClick={requestResolution}
            disabled={!selectedMarket || busy === "resolution"}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-[5px] bg-gradient-to-r from-[#CCE9E7] to-[#64B3AE] text-black font-bold text-[12.5px] disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            {busy === "resolution" ? "Running..." : "Request resolver"}
          </button>
          {verdict && (
            <div className="mt-4 bg-[#1c1c1c] border border-[#2a2a2a] rounded-[6px] p-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Pill tone={verdict.outcomeLabel === "YES" ? "yes" : "no"}>
                  {verdict.outcomeLabel}
                </Pill>
                {verdict.attestation && (
                  <Pill tone="accent">
                    <ShieldCheck className="w-3 h-3" /> Attestation linked
                  </Pill>
                )}
                {verdict.reclaimProofHash && <Pill tone="accent">Source proof bound</Pill>}
              </div>
              <p className="text-gray-300 text-[12.5px] leading-relaxed">{verdict.reasoning}</p>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-[10.5px] font-mono text-gray-500">
                <div>evidenceHash - {verdict.evidenceHash.slice(0, 20)}...</div>
                <div>signature - {verdict.signature.slice(0, 20)}...</div>
              </div>
            </div>
          )}
        </Card>

        <Card title="4. Submit verdict on-chain">
          {!account ? (
            <div className="text-[12px] text-gray-400">
              Connect wallet to submit the verdict transaction.
            </div>
          ) : !verdict ? (
            <div className="text-[12px] text-gray-500">Generate a verdict first.</div>
          ) : resolveTx ? (
            <div>
              <Pill tone="accent">Proposed - 2h challenge window open</Pill>
              <div className="mt-2 text-[12px] text-gray-300">
                <a
                  href={txUrl(selectedMarket?.chainId, resolveTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#CCE9E7] underline"
                >
                  View propose tx
                </a>
              </div>
              <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
                Anyone may call <span className="font-mono">challenge(marketId)</span> within 2
                hours. After the window closes without a challenge, call{" "}
                <span className="font-mono">finalize(marketId)</span> to unlock payouts.
                Disputed proposals require owner <span className="font-mono">overrideAndFinalize</span>.
              </p>
            </div>
          ) : (
            <button
              onClick={submitOnchain}
              disabled={busy === "onchain" || !selectedVerifierAddress}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-[5px] bg-white text-black font-semibold text-[12.5px] hover:bg-gray-100 disabled:opacity-50"
            >
              {busy === "onchain" ? "Confirming..." : "propose() verdict"}
            </button>
          )}
          {selectedMarket?.chainId && !selectedVerifierAddress && (
            <div className="mt-2 text-[10.5px] text-[#f59e0b]">
              {selectedMarket.chainId === robinhoodChainTestnet.id
                ? "Configure the RHC verifier address after deploying the verifier."
                : "Configure the Arbitrum Sepolia verifier address after deploying the verifier."}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#1f1f1f] border border-[#262626] rounded-[6px] p-5 mb-3">
      <CapsLabel>{title}</CapsLabel>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function parseMarketContractId(marketId: string): bigint | null {
  const parts = marketId.split(":");
  if (parts.length > 2) return null;
  if (parts.length === 2 && !/^\d+$/.test(parts[0])) return null;
  const raw = parts.at(-1);
  if (!raw || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return wagmiConfig.chains.some((chain) => chain.id === chainId);
}

function verifierAddressForChain(chainId: number): Address | undefined {
  if (chainId === arbitrumSepolia.id) return ARBITRUM_VERIFIER_ADDRESS;
  if (chainId === robinhoodChainTestnet.id) return RHC_VERIFIER_ADDRESS;
  return undefined;
}

function txUrl(chainId: number | undefined, hash: string): string | undefined {
  const rhcChainId = Number(process.env.NEXT_PUBLIC_RHC_CHAIN_ID ?? 46630);
  const explorer =
    chainId === rhcChainId
      ? process.env.NEXT_PUBLIC_RHC_EXPLORER_URL
      : process.env.NEXT_PUBLIC_ARBITRUM_EXPLORER_URL || "https://sepolia.arbiscan.io";
  if (!explorer) return undefined;
  return `${explorer.replace(/\/$/, "")}/tx/${encodeURIComponent(hash)}`;
}
