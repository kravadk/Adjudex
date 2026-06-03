"use client";

import { useEffect, useState } from "react";
import { Activity, BarChart3, Database, Layers, RefreshCw } from "lucide-react";

type ChainRow = {
  chainId: number;
  markets: number;
  openMarkets: number;
  resolvedMarkets: number;
  volumeUsd: number;
  bettors: number;
  positions: number;
  payoutsUsd: number;
};

type DuneSummary = {
  configured: boolean;
  queryId?: string;
  executionId?: string;
  state?: string;
  rows?: unknown[];
};

type DuneTemplate = { id: string; title: string; description: string; sql: string };

const CHAIN_NAMES: Record<number, string> = {
  421614: "Arbitrum Sepolia",
  42161: "Arbitrum One",
  46630: "Robinhood Chain",
};

function chainName(id: number): string {
  return CHAIN_NAMES[id] ?? `Chain ${id}`;
}

export function SponsorTractionClient() {
  const [chains, setChains] = useState<ChainRow[]>([]);
  const [dune, setDune] = useState<DuneSummary | null>(null);
  const [templates, setTemplates] = useState<DuneTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [chainsRes, duneRes, templatesRes] = await Promise.all([
        getJson<{ rows: ChainRow[] }>("/api/analytics/chains"),
        getJson<DuneSummary>("/api/integrations/dune/summary").catch(() => null),
        getJson<DuneTemplate[]>("/api/integrations/dune/templates").catch(() => []),
      ]);
      setChains(chainsRes.rows ?? []);
      setDune(duneRes);
      setTemplates(templatesRes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Traction data unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const totals = chains.reduce(
    (acc, row) => ({
      markets: acc.markets + row.markets,
      volumeUsd: acc.volumeUsd + row.volumeUsd,
      bettors: acc.bettors + row.bettors,
      resolvedMarkets: acc.resolvedMarkets + row.resolvedMarkets,
      payoutsUsd: acc.payoutsUsd + row.payoutsUsd,
    }),
    { markets: 0, volumeUsd: 0, bettors: 0, resolvedMarkets: 0, payoutsUsd: 0 },
  );

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 pt-6">
      <section className="mb-5 rounded-[8px] border p-4" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[8px]" style={{ background: "#211f1e", color: "var(--accent-bright)" }}>
            <BarChart3 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold" style={{ color: "var(--tx)" }}>
              Proof of traction
            </h1>
            <p className="text-[12.5px]" style={{ color: "var(--t3)" }}>
              Public, on-chain-derived metrics across every chain Adjudex runs on. Reproducible with the Dune templates below.
            </p>
          </div>
          <div className="flex-1" />
          <button onClick={load} disabled={loading} className="btn ghost" style={{ opacity: loading ? 0.55 : 1 }}>
            <RefreshCw className="h-3.5 w-3.5" />
            {loading ? "Loading..." : "Reload"}
          </button>
        </div>
        {error && (
          <div className="mt-3 rounded-[8px] border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-300">{error}</div>
        )}
      </section>

      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Markets" value={totals.markets.toLocaleString("en-US")} />
        <Stat label="Volume" value={formatUsd(totals.volumeUsd)} />
        <Stat label="Bettors" value={totals.bettors.toLocaleString("en-US")} />
        <Stat label="Resolved" value={totals.resolvedMarkets.toLocaleString("en-US")} />
        <Stat label="Payouts" value={formatUsd(totals.payoutsUsd)} />
      </section>

      <section className="mb-5">
        <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold" style={{ color: "var(--tx)" }}>
          <Layers className="h-4 w-4" style={{ color: "var(--accent-bright)" }} />
          By chain
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {chains.map((row) => (
            <div key={row.chainId} className="rounded-[8px] border p-3.5" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium" style={{ color: "var(--tx)" }}>{chainName(row.chainId)}</span>
                <span className="font-mono text-[11px]" style={{ color: "var(--t4)" }}>{row.chainId}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Stat label="Markets" value={String(row.markets)} small />
                <Stat label="Open" value={String(row.openMarkets)} small />
                <Stat label="Resolved" value={String(row.resolvedMarkets)} small />
                <Stat label="Volume" value={formatUsd(row.volumeUsd)} small />
                <Stat label="Bettors" value={String(row.bettors)} small />
                <Stat label="Payouts" value={formatUsd(row.payoutsUsd)} small />
              </div>
            </div>
          ))}
          {chains.length === 0 && !loading && (
            <div className="rounded-[8px] border p-3 text-[12px]" style={{ borderColor: "var(--line-soft)", color: "var(--t3)" }}>
              No indexed markets yet.
            </div>
          )}
        </div>
      </section>

      <section className="mb-5 rounded-[8px] border p-4" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold" style={{ color: "var(--tx)" }}>
          <Database className="h-4 w-4" style={{ color: "var(--accent-bright)" }} />
          Dune
        </h2>
        {dune?.configured ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Stat label="Query" value={dune.queryId ?? "-"} small />
            <Stat label="State" value={dune.state ?? "-"} small />
            <Stat label="Rows" value={String(dune.rows?.length ?? 0)} small />
          </div>
        ) : (
          <p className="text-[12px]" style={{ color: "var(--t3)" }}>
            Dune live data not configured on this deployment. The query templates below reproduce these metrics on any Dune account.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold" style={{ color: "var(--tx)" }}>
          <Activity className="h-4 w-4" style={{ color: "var(--accent-bright)" }} />
          Reproduce it — Dune query templates
        </h2>
        <div className="flex flex-col gap-3">
          {templates.map((tpl) => (
            <div key={tpl.id} className="rounded-[8px] border p-3.5" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
              <div className="text-[13px] font-medium" style={{ color: "var(--tx)" }}>{tpl.title}</div>
              <div className="mt-0.5 text-[12px]" style={{ color: "var(--t3)" }}>{tpl.description}</div>
              <pre className="mt-2 overflow-auto rounded-[8px] border p-3 text-[11px]" style={{ borderColor: "var(--line-soft)", background: "#211f1e", color: "var(--t2)" }}>
                {tpl.sql}
              </pre>
            </div>
          ))}
          {templates.length === 0 && (
            <div className="rounded-[8px] border p-3 text-[12px]" style={{ borderColor: "var(--line-soft)", color: "var(--t3)" }}>
              No query templates available.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-[8px] border p-2.5" style={{ borderColor: "var(--line-soft)", background: "#211f1e" }}>
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--t4)" }}>{label}</div>
      <div className={`mt-1 truncate font-mono ${small ? "text-[12px]" : "text-[15px]"}`} style={{ color: "var(--tx)" }}>
        {value}
      </div>
    </div>
  );
}

function formatUsd(value: number): string {
  if (!value || value <= 0) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
