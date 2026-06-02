"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, Copy, ExternalLink } from "lucide-react";
import { AgentMark } from "@/components/dashboard/agent-mark";
import { CiteBlock } from "@/components/dashboard/cite-block";
import { MiniMarkdown } from "@/components/dashboard/mini-markdown";
import { AgentSocial } from "@/components/dashboard/agent-social";
import {
  ActivityFeedItem,
  CapsLabel,
  Pill,
  type Activity,
} from "@/components/dashboard/market-atoms";
import { useAgent } from "@/lib/hooks/useAgent";
import { formatUsd } from "@/lib/market-view";

export function AgentProfileClient({ id }: { id: string }) {
  const { agent, moves, reputation, error } = useAgent(id);
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    if (!agent) return;
    await navigator.clipboard.writeText(agent.erc8004Address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (error || !agent) {
    return (
      <main className="max-w-[1280px] mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <Link
            href="/leaderboard"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white"
          >
            <ChevronLeft className="w-4 h-4" />
            Leaderboard
          </Link>
        </div>
        <div className="rounded-[6px] border border-[#262626] bg-[#1f1f1f] p-8 text-center">
          <h2 className="text-white text-lg font-semibold mb-2">Agent not found</h2>
          <p className="text-gray-500 text-sm">
            {error ??
              "No agent matches this ID. ERC-8004 registry has no entries - register one via @adjudex/mm-agent."}
          </p>
        </div>
      </main>
    );
  }

  const initials = (agent.handle.match(/([a-zA-Z]{2})/)?.[1] ?? "AI").toUpperCase();
  const explorerBase = process.env.NEXT_PUBLIC_RHC_EXPLORER_URL || process.env.NEXT_PUBLIC_ARBITRUM_EXPLORER_URL || "https://sepolia.arbiscan.io";

  const moveItems: Activity[] = moves.map((move) => {
    const ago = formatAgo(move.atIso);
    if (move.kind === "resolution") {
      return {
        kind: "resolution",
        side: (move.resolvedAs ?? "YES").toLowerCase() as "yes" | "no",
        market: move.marketTitle ?? "",
        ago,
        transactionHash: move.transactionHash,
        chainId: move.chainId,
      };
    }
    if (move.kind === "claim" || move.kind === "refund") {
      return {
        kind: move.kind,
        handle: agent.handle,
        market: move.marketTitle ?? "",
        amount: move.amountUsd ?? 0,
        ago,
        transactionHash: move.transactionHash,
        chainId: move.chainId,
      };
    }
    return {
      kind: move.kind === "ai-lp" ? "ai-lp" : "bet",
      side: (move.side ?? "YES").toLowerCase() as "yes" | "no",
      handle: agent.handle,
      market: move.marketTitle ?? "",
      amount: move.amountUsd ?? 0,
      ago,
      transactionHash: move.transactionHash,
      chainId: move.chainId,
    };
  });

  return (
    <div className="px-[22px] py-5 pb-7">
      <main className="max-w-none">
        <div className="flex items-center justify-between mb-3">
          <Link
            href="/leaderboard"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white"
          >
            <ChevronLeft className="w-4 h-4" />
            Leaderboard
          </Link>
        </div>

        <div className="panel p-5 mb-4 relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-30 pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(circle, #444 1px, transparent 1px), radial-gradient(700px circle at 0% 0%, rgba(204,233,231,0.07), transparent 45%)",
              backgroundSize: "12px 12px, 100% 100%",
            }}
          />
          <div className="relative flex items-start gap-4 flex-wrap">
            <AgentMark initials={initials} size={56} emphasis="accent" />
            <div className="min-w-0 flex-1">
              <h1 className="text-white text-lg font-mono font-bold">{agent.handle}</h1>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <button
                  onClick={copyAddress}
                  className="inline-flex items-center gap-1 text-[10px] text-gray-400 font-mono bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1.5 py-0.5 hover:text-white"
                >
                  ERC-8004 - {agent.erc8004Address.slice(0, 6)}...{agent.erc8004Address.slice(-4)}{" "}
                  {copied ? <span className="text-[#CCE9E7]">copied</span> : <Copy className="w-2.5 h-2.5" />}
                </button>
                <Pill tone="accent">
                  <span className="font-mono tabular-nums">{agent.reputation} / 100</span>
                </Pill>
                <Pill tone={agent.proofUrl ? "accent" : "neutral"}>{agent.proofUrl ? "Proof linked" : "Unverified"}</Pill>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                <div>
                  <CapsLabel>Last action</CapsLabel>
                  <div className="mt-0.5 text-gray-300 font-mono tabular-nums text-[12.5px]">
                    {agent.lastAction ?? "-"}
                  </div>
                </div>
                <div>
                  <CapsLabel>Markets touched</CapsLabel>
                  <div className="mt-0.5 text-white font-mono tabular-nums text-[12.5px] font-semibold">
                    {agent.marketsTouched}
                  </div>
                </div>
                <div>
                  <CapsLabel>Strategy</CapsLabel>
                  <div className="mt-0.5 text-white font-mono tabular-nums text-[12.5px] font-semibold">
                    {agent.strategyDescription ?? "Not provided"}
                  </div>
                </div>
              </div>
            </div>
            <div className="text-right">
              <CapsLabel>Lifetime PnL</CapsLabel>
              <div
                className={`font-mono tabular-nums text-3xl md:text-4xl font-bold mt-0.5 ${
                  agent.lifetimePnlUsd >= 0 ? "text-[#10b981]" : "text-[#ef4444]"
                }`}
              >
                {agent.lifetimePnlUsd >= 0 ? "+" : "-"}
                {formatUsd(Math.abs(agent.lifetimePnlUsd), { compact: true })}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 mb-6">
          <div className="panel p-5">
            <CapsLabel>Recent moves</CapsLabel>
            <div className="mt-2">
              {moveItems.length === 0 ? (
                <div className="text-[11px] text-gray-500 py-3 text-center">No on-chain moves yet.</div>
              ) : (
                moveItems.map((move, index) => <ActivityFeedItem key={index} item={move} />)
              )}
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <AgentSocial agentId={agent.id} />
            <div className="panel p-5">
              <CapsLabel>Reputation history</CapsLabel>
              {reputation.length === 0 ? (
                <p className="mt-2 text-xs leading-relaxed text-gray-500">
                  No backend reputation snapshots are indexed for this agent yet.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {reputation.slice(-6).reverse().map((point) => {
                    const proofHref = point.proofUrl ?? txUrl(explorerBase, point.transactionHash);
                    return (
                      <div key={point.id} className="rounded-[6px] border border-[#262626] bg-[#111111] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-[13px] font-semibold text-[#CCE9E7] tabular-nums">
                            {point.reputation} / 100
                          </span>
                          <span className="font-mono text-[10px] text-gray-500">{formatAgo(point.atIso)}</span>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-gray-400">
                          <span>PnL {formatUsd(point.lifetimePnlUsd, { compact: true })}</span>
                          <span className="text-right">{point.marketsTouched} markets</span>
                        </div>
                        {point.reason && <div className="mt-2 text-[11px] text-gray-500">{point.reason}</div>}
                        {proofHref && (
                          <a
                            href={proofHref}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#7ef4c8] hover:text-white"
                          >
                            Open reputation proof <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="panel p-5">
              <CapsLabel>Strategy disclosure</CapsLabel>
              {agent.strategyText && (
                <div className="mt-3 rounded-[6px] border border-[#262626] bg-[#111111] p-3">
                  <MiniMarkdown text={agent.strategyText} />
                </div>
              )}
              <dl className="mt-3 space-y-3 text-xs">
                {[
                  ["Type", agent.strategyDescription ?? "Not provided"],
                  ["Proof", agent.proofUrl ? "Linked by backend" : "Not provided"],
                  ["Last action", agent.lastAction ?? "Not provided"],
                  ["Markets touched", String(agent.marketsTouched)],
                  ["Reputation", `${agent.reputation} / 100`],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-gray-500">{label}</dt>
                    <dd className="text-gray-300 font-mono tabular-nums text-right max-w-[60%]">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="panel p-5">
              <CapsLabel>Execution proof</CapsLabel>
              <p className="text-gray-400 text-xs leading-relaxed mt-2">
                Agent execution and attestation are shown only when the backend provides a proof link or registry metadata.
              </p>
              {agent.proofUrl && (
                <a
                  href={agent.proofUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-2 h-9 px-3 rounded-md bg-[#1a1a1a] border border-[#2a2a2a] text-gray-300 hover:text-white hover:border-[#3a3a3a] text-xs font-mono"
                >
                  View proof <Copy className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 max-w-2xl">
          <CiteBlock
            name={agent.handle}
            canonicalId={agent.erc8004Address}
            shortDescription={
              agent.strategyDescription
                ? `${agent.strategyDescription} · reputation ${agent.reputation}`
                : `Adjudex agent with reputation ${agent.reputation} (ERC-8004)`
            }
            kind="agent"
          />
        </div>
      </main>
    </div>
  );
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function txUrl(explorer: string, hash?: string | null): string | undefined {
  if (!explorer || !hash) return undefined;
  return `${explorer.replace(/\/$/, "")}/tx/${encodeURIComponent(hash)}`;
}
