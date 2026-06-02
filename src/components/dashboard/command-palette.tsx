"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeDollarSign, BarChart3, Copy, ExternalLink, FileText, Search, Settings, ShieldCheck, Wallet, X, Plus, Bot } from "lucide-react";
import type { AgentBadge, Market } from "@/lib/types/domain";

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
};

const STATIC_COMMANDS = [
  { label: "Open portfolio", href: "/portfolio", icon: Wallet, description: "Track positions and claimable payouts." },
  { label: "Create market", href: "/create", icon: Plus, description: "Deploy a real market through MarketFactory." },
  { label: "Open resolver", href: "/resolve", icon: ShieldCheck, description: "Resolve indexed markets through source evidence and verifier proof." },
  { label: "Open agents", href: "/agents", icon: Bot, description: "View agent ecosystem, onboarding, and reputation." },
  { label: "Open retention analytics", href: "/analytics/retention", icon: BarChart3, description: "View D1, D7, and D30 cohorts from backend events." },
  { label: "Open liquidity incentives", href: "/liquidity", icon: BadgeDollarSign, description: "View indexed volume eligibility and recorded rebate payouts." },
  { label: "Open docs / proof", href: "/docs", icon: FileText, description: "Architecture, data flow, and product proof." },
  { label: "Open backend status", href: "/api/status", icon: ShieldCheck, description: "API, DB, RPC, factory, and indexer health." },
];

type PaletteAction =
  | { id: string; kind: "route"; href: string }
  | { id: string; kind: "external"; href: string }
  | { id: string; kind: "settings" }
  | { id: string; kind: "copy"; label: string; value: string };

export function CommandPalette({ open, onClose, onOpenSettings }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [markets, setMarkets] = useState<Market[]>([]);
  const [agents, setAgents] = useState<AgentBadge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
  const explorerUrl = process.env.NEXT_PUBLIC_ARBITRUM_EXPLORER_URL || "https://sepolia.arbiscan.io";
  const rhcExplorerUrl = process.env.NEXT_PUBLIC_RHC_EXPLORER_URL;
  const faucetUrl = process.env.NEXT_PUBLIC_FAUCET_URL || "https://faucet.quicknode.com/arbitrum/sepolia";

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setError(null);
        const params = new URLSearchParams();
        if (query.trim()) params.set("query", query.trim());
        const response = await fetch(`/api/markets?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await response.text());
        setMarkets(((await response.json()) as Market[]).slice(0, 6));
      } catch (nextError) {
        if (controller.signal.aborted) return;
        setMarkets([]);
        setError(nextError instanceof Error ? nextError.message : "Market search is unavailable.");
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    async function loadAgents() {
      try {
        setAgentError(null);
        const response = await fetch("/api/agents", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await response.text());
        setAgents(await response.json() as AgentBadge[]);
      } catch (nextError) {
        if (controller.signal.aborted) return;
        setAgents([]);
        setAgentError(nextError instanceof Error ? nextError.message : "Agent search is unavailable.");
      }
    }
    void loadAgents();
    return () => controller.abort();
  }, [open]);

  const filteredCommands = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return STATIC_COMMANDS;
    return STATIC_COMMANDS.filter((command) => command.label.toLowerCase().includes(needle));
  }, [query]);

  const filteredAgents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? agents.filter((agent) =>
          [
            agent.handle,
            agent.erc8004Address,
            agent.strategyDescription ?? "",
            agent.lastAction ?? "",
          ].some((value) => value.toLowerCase().includes(needle))
        )
      : agents;
    return matches.slice(0, 5);
  }, [agents, query]);

  const paletteActions = useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = [
      ...filteredCommands.map((command) => ({ id: `command:${command.href}`, kind: "route" as const, href: command.href })),
      { id: "settings", kind: "settings" },
      ...filteredAgents.map((agent) => ({ id: `agent:${agent.id}`, kind: "route" as const, href: `/agent/${encodeURIComponent(agent.id)}` })),
      ...markets.map((market) => ({ id: `market:${market.id}`, kind: "route" as const, href: `/market/${encodeURIComponent(market.id)}` })),
      { id: "copy:api", kind: "copy", label: "api", value: apiUrl },
      { id: "external:explorer", kind: "external", href: explorerUrl },
    ];
    if (rhcExplorerUrl) actions.push({ id: "external:rhc", kind: "external", href: rhcExplorerUrl });
    actions.push({ id: "external:faucet", kind: "external", href: faucetUrl });
    return actions;
  }, [apiUrl, explorerUrl, faucetUrl, filteredAgents, filteredCommands, markets, rhcExplorerUrl]);
  const boundedSelectedIndex = Math.min(selectedIndex, Math.max(paletteActions.length - 1, 0));
  const selectedAction = paletteActions[boundedSelectedIndex];

  const copyText = useCallback(async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  }, []);

  const activateAction = useCallback((action: PaletteAction | undefined) => {
    if (!action) return;
    if (action.kind === "settings") {
      onClose();
      onOpenSettings();
      return;
    }
    if (action.kind === "copy") {
      void copyText(action.label, action.value);
      return;
    }
    if (action.kind === "external") {
      window.open(action.href, "_blank", "noreferrer");
      return;
    }
    onClose();
    router.push(action.href);
  }, [copyText, onClose, onOpenSettings, router]);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!open) setQuery("");
      }
      if (event.key === "Escape" && open) onClose();
      if (!open) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) => Math.min(Math.min(current, paletteActions.length - 1) + 1, paletteActions.length - 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(Math.min(current, paletteActions.length - 1) - 1, 0));
      }
      if (event.key === "Enter") {
        event.preventDefault();
        activateAction(selectedAction);
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [activateAction, onClose, open, paletteActions.length, selectedAction]);

  function isSelected(id: string) {
    return selectedAction?.id === id;
  }

  function selectAction(id: string) {
    const nextIndex = paletteActions.findIndex((action) => action.id === id);
    if (nextIndex >= 0) setSelectedIndex(nextIndex);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm p-3 md:p-6" onMouseDown={onClose}>
      <div
        className="mx-auto mt-16 w-full max-w-2xl overflow-hidden rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-bg)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[color:var(--line-soft)] px-4 py-3">
          <Search className="h-4 w-4 text-[color:var(--t3)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search markets, agents, navigation, proof links..."
            aria-activedescendant={selectedAction?.id}
            className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--tx)] outline-none placeholder:text-[color:var(--t3)]"
          />
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-[6px] border border-[color:var(--line)] text-[color:var(--t2)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-3">
          <SectionTitle>Navigate</SectionTitle>
          <div className="space-y-1.5">
            {filteredCommands.map((command) => {
              const Icon = command.icon;
              const actionId = `command:${command.href}`;
              return (
                <Link
                  id={actionId}
                  key={command.label}
                  href={command.href}
                  onClick={onClose}
                  onMouseEnter={() => selectAction(actionId)}
                  className={`flex items-center gap-3 rounded-[6px] border px-3 py-2 hover:border-[color:var(--line)] hover:bg-[#34322f] ${isSelected(actionId) ? "border-[color:var(--accent)] bg-[#34322f]" : "border-transparent"}`}
                >
                  <Icon className="h-4 w-4 text-[color:var(--accent-bright)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-[color:var(--tx)]">{command.label}</span>
                    <span className="block truncate text-[11px] text-[color:var(--t3)]">{command.description}</span>
                  </span>
                </Link>
              );
            })}
            <button
              id="settings"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
              onMouseEnter={() => selectAction("settings")}
              className={`flex w-full items-center gap-3 rounded-[6px] border px-3 py-2 text-left hover:border-[color:var(--line)] hover:bg-[#34322f] ${isSelected("settings") ? "border-[color:var(--accent)] bg-[#34322f]" : "border-transparent"}`}
            >
              <Settings className="h-4 w-4 text-[color:var(--accent-bright)]" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-[color:var(--tx)]">Open settings / status</span>
                <span className="block truncate text-[11px] text-[color:var(--t3)]">Wallet, network, API, RPC, DB, and indexer state.</span>
              </span>
            </button>
          </div>

          <SectionTitle>Agents</SectionTitle>
          {agentError ? (
            <div className="rounded-[6px] border border-[color:var(--line)] bg-[#201d1d] px-3 py-2 text-xs text-[color:var(--t2)]">
              Agent search unavailable. Configure backend API and database to search registered agents.
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="rounded-[6px] border border-[color:var(--line)] bg-[#201f1e] px-3 py-2 text-xs text-[color:var(--t3)]">
              No registered agents matched this query.
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredAgents.map((agent) => {
                const actionId = `agent:${agent.id}`;
                return (
                  <Link
                    id={actionId}
                    key={agent.id}
                    href={`/agent/${encodeURIComponent(agent.id)}`}
                    onClick={onClose}
                    onMouseEnter={() => selectAction(actionId)}
                    className={`flex items-center gap-3 rounded-[6px] border px-3 py-2 hover:border-[color:var(--line)] hover:bg-[#34322f] ${isSelected(actionId) ? "border-[color:var(--accent)] bg-[#34322f]" : "border-transparent"}`}
                  >
                    <Bot className="h-4 w-4 text-[color:var(--accent-bright)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[color:var(--tx)]">{agent.handle}</span>
                      <span className="block truncate text-[11px] text-[color:var(--t3)]">
                        rep {agent.reputation} - {agent.marketsTouched} markets - {agent.strategyDescription ?? agent.erc8004Address}
                      </span>
                    </span>
                    <span className={`font-mono text-[11px] tabular-nums ${agent.lifetimePnlUsd >= 0 ? "text-[color:var(--green-tx)]" : "text-[#ef4444]"}`}>
                      {agent.lifetimePnlUsd >= 0 ? "+" : "-"}${Math.abs(agent.lifetimePnlUsd).toFixed(0)}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          <SectionTitle>Markets</SectionTitle>
          {error ? (
            <div className="rounded-[6px] border border-[color:var(--line)] bg-[#201d1d] px-3 py-2 text-xs text-[color:var(--t2)]">
              Market search unavailable. Configure backend API and database to search indexed markets.
            </div>
          ) : markets.length === 0 ? (
            <div className="rounded-[6px] border border-[color:var(--line)] bg-[#201f1e] px-3 py-2 text-xs text-[color:var(--t3)]">
              No indexed markets matched this query.
            </div>
          ) : (
            <div className="space-y-1.5">
              {markets.map((market) => {
                const actionId = `market:${market.id}`;
                return (
                  <Link
                    id={actionId}
                    key={market.id}
                    href={`/market/${encodeURIComponent(market.id)}`}
                    onClick={onClose}
                    onMouseEnter={() => selectAction(actionId)}
                    className={`block rounded-[6px] border px-3 py-2 hover:border-[color:var(--line)] hover:bg-[#34322f] ${isSelected(actionId) ? "border-[color:var(--accent)] bg-[#34322f]" : "border-transparent"}`}
                  >
                    <span className="block truncate text-sm text-[color:var(--tx)]">{market.title}</span>
                    <span className="block text-[11px] text-[color:var(--t3)]">{market.status} - {Math.round(market.yesProbability)}% YES - {market.poolAddress ?? "pool pending"}</span>
                  </Link>
                );
              })}
            </div>
          )}

          <SectionTitle>Proof links</SectionTitle>
          <div className="grid gap-1.5 md:grid-cols-2">
            <PaletteButton id="copy:api" icon={Copy} label={copied === "api" ? "API URL copied" : "Copy API URL"} selected={isSelected("copy:api")} onMouseEnter={() => selectAction("copy:api")} onClick={() => void copyText("api", apiUrl)} />
            <PaletteAnchor id="external:explorer" icon={ExternalLink} label="Open Arbitrum explorer" href={explorerUrl} selected={isSelected("external:explorer")} onMouseEnter={() => selectAction("external:explorer")} />
            {rhcExplorerUrl && <PaletteAnchor id="external:rhc" icon={ExternalLink} label="Open RHC explorer" href={rhcExplorerUrl} selected={isSelected("external:rhc")} onMouseEnter={() => selectAction("external:rhc")} />}
            <PaletteAnchor id="external:faucet" icon={ExternalLink} label="Open faucet" href={faucetUrl} selected={isSelected("external:faucet")} onMouseEnter={() => selectAction("external:faucet")} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-1 pb-1 pt-3 text-[10px] uppercase tracking-[0.14em] text-[color:var(--t3)]">{children}</div>;
}

function PaletteButton({ id, icon: Icon, label, selected, onClick, onMouseEnter }: { id: string; icon: typeof Copy; label: string; selected: boolean; onClick: () => void; onMouseEnter: () => void }) {
  return (
    <button id={id} onClick={onClick} onMouseEnter={onMouseEnter} className={`flex items-center gap-2 rounded-[6px] border bg-[#211f1e] px-3 py-2 text-left text-xs text-[color:var(--t2)] hover:text-[color:var(--tx)] ${selected ? "border-[color:var(--accent)]" : "border-[color:var(--line)]"}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function PaletteAnchor({ id, icon: Icon, label, href, selected, onMouseEnter }: { id: string; icon: typeof ExternalLink; label: string; href: string; selected: boolean; onMouseEnter: () => void }) {
  return (
    <a id={id} href={href} target="_blank" rel="noreferrer" onMouseEnter={onMouseEnter} className={`flex items-center gap-2 rounded-[6px] border bg-[#211f1e] px-3 py-2 text-xs text-[color:var(--t2)] hover:text-[color:var(--tx)] ${selected ? "border-[color:var(--accent)]" : "border-[color:var(--line)]"}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}
