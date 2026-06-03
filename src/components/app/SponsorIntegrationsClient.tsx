"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChart3, CheckCircle2, ExternalLink, LineChart, RefreshCw, XCircle } from "lucide-react";

type SponsorStatus = {
  id: string;
  name: string;
  used: boolean;
  configured: boolean;
  evidence: string[];
};

type DuneSummary = {
  configured: boolean;
  error?: string;
  queryId?: string;
  executionId?: string;
  state?: string;
  rows?: unknown[];
};

type GmxSummary = {
  configured: boolean;
  chainId?: number;
  markets?: Array<{
    name: string;
    symbol?: string;
    marketTokenAddress?: string;
    ticker?: { totalLiquidityUsd?: number; openInterestUsd?: number };
  }>;
};

export function SponsorIntegrationsClient() {
  const [statuses, setStatuses] = useState<SponsorStatus[]>([]);
  const [dune, setDune] = useState<DuneSummary | null>(null);
  const [gmx, setGmx] = useState<GmxSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [nextStatuses, nextDune, nextGmx] = await Promise.all([
        getJson<SponsorStatus[]>("/api/integrations/sponsors"),
        getJson<DuneSummary>("/api/integrations/dune/summary"),
        getJson<GmxSummary>("/api/integrations/gmx/markets?limit=6"),
      ]);
      setStatuses(nextStatuses);
      setDune(nextDune);
      setGmx(nextGmx);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Integration dashboard unavailable.");
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

  async function refreshDune() {
    setBusy("dune");
    setError(null);
    try {
      const refreshed = await postJson<DuneSummary>("/api/integrations/dune/summary/refresh", {});
      setDune((current) => ({ ...current, ...refreshed }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh Dune query.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pb-10">
      <section className="mb-5 rounded-[8px] border p-4" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[8px]" style={{ background: "#211f1e", color: "var(--accent-bright)" }}>
            <BarChart3 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold" style={{ color: "var(--tx)" }}>
              Sponsor Integrations
            </h1>
            <p className="text-[12.5px]" style={{ color: "var(--t3)" }}>
              Evidence, live data paths, and admin refresh controls for partner tech.
            </p>
          </div>
          <div className="flex-1" />
          <button onClick={load} disabled={loading} className="btn ghost" style={{ opacity: loading ? 0.55 : 1 }}>
            <RefreshCw className="h-3.5 w-3.5" />
            {loading ? "Loading..." : "Reload"}
          </button>
          <Link href="/rhc" className="btn">
            RHC markets
          </Link>
        </div>
        {error && (
          <div className="mt-3 rounded-[8px] border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-300">
            {error}
          </div>
        )}
      </section>

      <section className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {statuses.map((status) => (
          <div key={status.id} className="rounded-[8px] border p-3" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
            <div className="flex items-center gap-2">
              {status.used ? (
                <CheckCircle2 className="h-4 w-4 text-lime-300" />
              ) : (
                <XCircle className="h-4 w-4" style={{ color: "var(--t4)" }} />
              )}
              <h2 className="text-[14px] font-semibold" style={{ color: "var(--tx)" }}>
                {status.name}
              </h2>
              <div className="flex-1" />
              <span className={status.configured ? "b-badge ok" : "b-badge pend"}>
                <span className="d" />
                {status.configured ? "configured" : "needs env"}
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              {status.evidence.map((item) => (
                <div key={item} className="text-[12px] leading-relaxed" style={{ color: "var(--t3)" }}>
                  {item}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-[8px] border p-4" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" style={{ color: "var(--accent-bright)" }} />
            <h2 className="text-[14px] font-semibold" style={{ color: "var(--tx)" }}>
              Dune Summary
            </h2>
            <div className="flex-1" />
            <button onClick={refreshDune} disabled={busy === "dune"} className="btn ghost" style={{ opacity: busy === "dune" ? 0.55 : 1 }}>
              <RefreshCw className="h-3.5 w-3.5" />
              {busy === "dune" ? "Refreshing..." : "Refresh query"}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Metric label="Query" value={dune?.queryId ?? "not configured"} />
            <Metric label="Execution" value={dune?.executionId ?? "-"} />
            <Metric label="State" value={dune?.state ?? dune?.error ?? "-"} />
          </div>
          <pre className="mt-3 max-h-[260px] overflow-auto rounded-[8px] border p-3 text-[11.5px]" style={{ borderColor: "var(--line-soft)", background: "#211f1e", color: "var(--t2)" }}>
            {JSON.stringify(dune?.rows ?? [], null, 2)}
          </pre>
        </div>

        <div className="rounded-[8px] border p-4" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
          <div className="flex items-center gap-2">
            <LineChart className="h-4 w-4" style={{ color: "var(--accent-bright)" }} />
            <h2 className="text-[14px] font-semibold" style={{ color: "var(--tx)" }}>
              GMX Markets
            </h2>
            <div className="flex-1" />
            <Link href="/create" className="btn ghost">
              <ExternalLink className="h-3.5 w-3.5" />
              Import
            </Link>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {(gmx?.markets ?? []).map((market) => (
              <div key={market.marketTokenAddress ?? market.name} className="rounded-[8px] border p-3" style={{ borderColor: "var(--line-soft)", background: "#211f1e" }}>
                <div className="truncate text-[13px] font-medium" style={{ color: "var(--tx)" }}>
                  {market.symbol ?? market.name}
                </div>
                <div className="mt-1 truncate font-mono text-[11px]" style={{ color: "var(--t4)" }}>
                  {market.marketTokenAddress ?? "no market token"}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Metric label="Liquidity" value={formatUsd(market.ticker?.totalLiquidityUsd)} />
                  <Metric label="Open interest" value={formatUsd(market.ticker?.openInterestUsd)} />
                </div>
              </div>
            ))}
            {(gmx?.markets ?? []).length === 0 && (
              <div className="rounded-[8px] border p-3 text-[12px]" style={{ borderColor: "var(--line-soft)", color: "var(--t3)" }}>
                GMX live feed has no rows yet or the API request failed.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="rounded-[8px] border p-2.5" style={{ borderColor: "var(--line-soft)", background: "#211f1e" }}>
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--t4)" }}>
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-[12px]" style={{ color: "var(--tx)" }}>
        {value ?? "-"}
      </div>
    </div>
  );
}

function formatUsd(value?: number) {
  if (!value || value <= 0) return "-";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
