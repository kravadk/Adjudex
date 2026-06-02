"use client";

import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import { Bot, CheckCircle2, ExternalLink, Loader2, RadioTower, Send, ShieldCheck } from "lucide-react";
import { AgentMark } from "@/components/dashboard/agent-mark";
import { ActivityFeedItem, CapsLabel, Pill, type Activity } from "@/components/dashboard/market-atoms";
import { useAgentEcosystem } from "@/lib/hooks/useAgentEcosystem";
import { formatUsd } from "@/lib/market-view";
import type { ActivityEvent, AgentBadge } from "@/lib/types/domain";

type RegisterState =
  | { status: "idle"; message?: string }
  | { status: "submitting"; message?: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function AgentEcosystemClient() {
  const { ecosystem, error } = useAgentEcosystem();
  const [registerState, setRegisterState] = useState<RegisterState>({ status: "idle" });
  const [form, setForm] = useState({
    handle: "",
    transactionHash: "",
    chainId: process.env.NEXT_PUBLIC_RHC_CHAIN_ID || process.env.NEXT_PUBLIC_ONCHAIN_CHAIN_ID || "421614",
    strategyDescription: "",
    proofUrl: "",
  });

  const recentMoves = useMemo(() => {
    return (ecosystem?.recentMoves ?? []).map((move) => eventToActivity(move));
  }, [ecosystem?.recentMoves]);

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegisterState({ status: "submitting", message: "Verifying confirmed transaction..." });
    try {
      const response = await fetch("/api/agents/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: form.handle,
          transactionHash: form.transactionHash,
          chainId: Number(form.chainId),
          strategyDescription: form.strategyDescription,
          proofUrl: form.proofUrl,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const body = await response.json() as { agent: AgentBadge };
      setRegisterState({ status: "success", message: `${body.agent.handle} registered from confirmed ReputationOracle event.` });
    } catch (nextError) {
      setRegisterState({
        status: "error",
        message: nextError instanceof Error ? nextError.message : "Agent registration failed.",
      });
    }
  }

  if (error || !ecosystem) {
    return (
      <main className="px-[22px] py-5 pb-7">
        <section className="panel p-6">
          <CapsLabel>Agent ecosystem</CapsLabel>
          <h1 className="mt-2 text-[22px] font-semibold text-[color:var(--tx)]">Agent data unavailable</h1>
          <p className="mt-2 max-w-[760px] text-[12.5px] leading-relaxed text-[color:var(--t3)]">
            Adjudex reads agents from the backend and ReputationOracle-indexed records. The current request failed, so no agent roster or activity is shown.
          </p>
          <p className="mt-3 font-mono text-[11px] text-[color:var(--t4)]">{error}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/api/status" className="btn">Check system status</Link>
            <Link href="/docs" className="btn">Open setup guide</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="px-[22px] py-5 pb-7">
      <div className="mb-[18px] flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-[color:var(--tx)]">
            Agent ecosystem
          </h1>
          <p className="mt-1 text-[12.5px] text-[color:var(--t3)]">
            ERC-8004 agents, indexed moves, and reputation proofs from backend records.
          </p>
        </div>
        <div className="flex-1" />
        <Link href="/leaderboard" className="btn">
          <Bot className="h-3.5 w-3.5" />
          Leaderboard
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-[14px] lg:grid-cols-5">
        <StatCard label="Agents" value={String(ecosystem.agentCount)} detail="registered" />
        <StatCard label="Active" value={String(ecosystem.activeAgentCount)} detail="with indexed action" />
        <StatCard label="Volume" value={formatUsd(ecosystem.totalVolumeUsd, { compact: true })} detail="agent-tagged" />
        <StatCard
          label="PnL"
          value={`${ecosystem.totalPnlUsd >= 0 ? "+" : "-"}${formatUsd(Math.abs(ecosystem.totalPnlUsd), { compact: true })}`}
          detail="lifetime"
          tone={ecosystem.totalPnlUsd >= 0 ? "pos" : "neg"}
        />
        <StatCard label="Avg rep" value={ecosystem.averageReputation.toFixed(1)} detail="0-100" />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <CapsLabel>Registry status</CapsLabel>
            <Pill tone={ecosystem.registryConfigured ? "accent" : "neutral"}>
              {ecosystem.registryConfigured ? "Oracle configured" : "Oracle missing"}
            </Pill>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <StatusLine
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Source of truth"
              value="ReputationOracle event + backend index"
            />
            <StatusLine
              icon={<RadioTower className="h-4 w-4" />}
              label="Oracle"
              value={ecosystem.reputationOracleAddress ?? "Configure REPUTATION_ORACLE_ADDRESS"}
              mono
            />
          </div>
          {ecosystem.status === "empty" && (
            <div className="mt-4 rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel-2)] p-4">
              <h2 className="text-[14px] font-semibold text-[color:var(--tx)]">No agents indexed yet</h2>
              <p className="mt-2 max-w-[760px] text-[12px] leading-relaxed text-[color:var(--t3)]">
                Register an agent through the on-chain ReputationOracle first. Adjudex will only show it after the confirmed transaction is reconciled by the backend.
              </p>
            </div>
          )}
        </section>

        <section className="panel p-5">
          <CapsLabel>Register confirmed agent</CapsLabel>
          <form className="mt-3 grid gap-3" onSubmit={submitRegistration}>
            <Input label="Handle" value={form.handle} onChange={(value) => setForm((current) => ({ ...current, handle: value }))} placeholder="alpha-mm" />
            <Input label="Transaction hash" value={form.transactionHash} onChange={(value) => setForm((current) => ({ ...current, transactionHash: value }))} placeholder="0x..." mono />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input label="Chain ID" value={form.chainId} onChange={(value) => setForm((current) => ({ ...current, chainId: value }))} placeholder="421614" mono />
              <Input label="Proof URL" value={form.proofUrl} onChange={(value) => setForm((current) => ({ ...current, proofUrl: value }))} placeholder="https://..." />
            </div>
            <Input label="Strategy" value={form.strategyDescription} onChange={(value) => setForm((current) => ({ ...current, strategyDescription: value }))} placeholder="Market-making strategy summary" />
            <button className="btn primary h-9 justify-center" disabled={registerState.status === "submitting"}>
              {registerState.status === "submitting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Verify registration
            </button>
            {registerState.status !== "idle" && (
              <p
                className={`rounded-[6px] border px-3 py-2 text-[11px] ${
                  registerState.status === "success"
                    ? "border-[rgba(126,244,200,0.35)] text-[color:var(--green-tx)]"
                    : registerState.status === "error"
                      ? "border-[rgba(239,68,68,0.4)] text-[#ef4444]"
                      : "border-[color:var(--line)] text-[color:var(--t3)]"
                }`}
              >
                {registerState.message}
              </p>
            )}
          </form>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="panel p-5">
          <CapsLabel>Top agents</CapsLabel>
          <div className="mt-3 space-y-2">
            {ecosystem.topAgents.length === 0 ? (
              <p className="py-5 text-center text-[12px] text-[color:var(--t3)]">No registered agents are available from the backend.</p>
            ) : (
              ecosystem.topAgents.map((agent) => <AgentRow key={agent.id} agent={agent} />)
            )}
          </div>
        </section>

        <section className="panel p-5">
          <CapsLabel>Recent agent moves</CapsLabel>
          <div className="mt-2">
            {recentMoves.length === 0 ? (
              <p className="py-5 text-center text-[12px] text-[color:var(--t3)]">No indexed agent activity yet.</p>
            ) : (
              recentMoves.map((move, index) => <ActivityFeedItem key={index} item={move} />)
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? "var(--green-tx)" : tone === "neg" ? "#ef4444" : "var(--tx)";
  return (
    <div className="stat-card reveal">
      <span className="stat-label">{label}</span>
      <div className="stat-row">
        <span className="stat-num" style={{ color }}>{value}</span>
      </div>
      <div className="stat-foot">
        <span className="ic" />
        <span className="delta">{detail}</span>
      </div>
    </div>
  );
}

function StatusLine({ icon, label, value, mono }: { icon: ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel-2)] p-3">
      <div className="flex items-center gap-2 text-[color:var(--t2)]">
        {icon}
        <span className="text-[11px] uppercase tracking-[0.14em]">{label}</span>
      </div>
      <div className={`mt-2 break-all text-[12px] text-[color:var(--tx)] ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  mono?: boolean;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--t3)]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`h-9 rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 text-[12px] text-[color:var(--tx)] outline-none placeholder:text-[color:var(--t4)] focus:border-[color:var(--accent-bright)] ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}

function AgentRow({ agent }: { agent: AgentBadge }) {
  const initials = (agent.handle.match(/([a-zA-Z]{2})/)?.[1] ?? "AI").toUpperCase();
  const explorer = explorerForChain(agent.chainId);
  const proofHref = agent.proofUrl ?? txUrl(explorer, agent.registrationTxHash);
  return (
    <Link href={`/agent/${encodeURIComponent(agent.id)}`} className="flex items-center gap-3 rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel-2)] p-3 hover:border-[color:var(--accent)]">
      <AgentMark initials={initials} size={32} emphasis="accent" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[13px] font-semibold text-[color:var(--tx)]">{agent.handle}</div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[10.5px] text-[color:var(--t3)]">
          <span>rep {agent.reputation}</span>
          <span>{agent.marketsTouched} markets</span>
          <span>{formatUsd(agent.lifetimePnlUsd, { compact: true })}</span>
        </div>
      </div>
      {proofHref && (
        <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--green-tx)]">
          proof <ExternalLink className="h-3 w-3" />
        </span>
      )}
      {!proofHref && <CheckCircle2 className="h-4 w-4 text-[color:var(--t4)]" />}
    </Link>
  );
}

function eventToActivity(event: ActivityEvent): Activity {
  const ago = formatAgo(event.atIso);
  if (event.kind === "resolution") {
    return {
      kind: "resolution",
      side: (event.resolvedAs ?? "YES").toLowerCase() as "yes" | "no",
      market: event.marketTitle ?? "",
      ago,
      transactionHash: event.transactionHash,
      chainId: event.chainId,
    };
  }
  if (event.kind === "claim" || event.kind === "refund") {
    return {
      kind: event.kind,
      handle: event.agentHandle ?? event.walletShort ?? "Agent",
      market: event.marketTitle ?? "",
      amount: event.amountUsd ?? 0,
      ago,
      transactionHash: event.transactionHash,
      chainId: event.chainId,
    };
  }
  return {
    kind: event.kind === "ai-lp" ? "ai-lp" : "bet",
    side: (event.side ?? "YES").toLowerCase() as "yes" | "no",
    handle: event.agentHandle ?? event.walletShort ?? "Agent",
    market: event.marketTitle ?? "",
    amount: event.amountUsd ?? 0,
    ago,
    transactionHash: event.transactionHash,
    chainId: event.chainId,
  };
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

function explorerForChain(chainId?: number) {
  const rhcChainId = Number(process.env.NEXT_PUBLIC_RHC_CHAIN_ID ?? 46630);
  if (chainId === rhcChainId) return process.env.NEXT_PUBLIC_RHC_EXPLORER_URL ?? "";
  return process.env.NEXT_PUBLIC_ARBITRUM_EXPLORER_URL ?? "https://sepolia.arbiscan.io";
}

function txUrl(explorer: string, hash?: string | null): string | undefined {
  if (!explorer || !hash) return undefined;
  return `${explorer.replace(/\/$/, "")}/tx/${encodeURIComponent(hash)}`;
}
