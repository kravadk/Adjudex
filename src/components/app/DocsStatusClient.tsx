"use client";

import { RefreshCw } from "lucide-react";
import React from "react";
import type { ChainSystemStatus, SystemStatus } from "@/lib/types/domain";

type ExtendedIndexer = {
  id?: string;
  chainId?: number;
  lastBlock?: number;
  updatedAtIso?: string;
  stale?: boolean;
  lagging?: boolean;
  error?: string;
};

export function DocsStatusClient() {
  const [status, setStatus] = React.useState<SystemStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const loadStatus = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      setStatus((await response.json()) as SystemStatus);
      setError(null);
    } catch (nextError) {
      setStatus(null);
      setError(nextError instanceof Error ? nextError.message : "System status unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void loadStatus(), 0);
    return () => window.clearTimeout(timer);
  }, [loadStatus]);

  return (
    <section className="panel">
      <div className="panel-head justify-between">
        <span className="panel-title">Live system status</span>
        <button
          onClick={() => void loadStatus()}
          className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-[color:var(--line)] px-2 text-[11px] text-[color:var(--tx)] hover:border-[color:var(--accent)]"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
      <div className="panel-body">
        {error ? (
          <div className="rounded-[6px] border border-[#5b3535] bg-[#241b1b] px-3 py-2 text-[12px] text-[#fca5a5]">
            Status unavailable: {error}
          </div>
        ) : status ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <StatusTile label="API" ok={status.api} detail={status.api ? "online" : "offline"} />
              <StatusTile label="Database" ok={status.database.ok} detail={status.database.ok ? "reachable" : "unavailable"} />
              <StatusTile label="RPC" ok={status.rpc.ok} detail={status.rpc.blockNumber ? `block ${status.rpc.blockNumber}` : status.rpc.error ?? "not ready"} />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <ChainStatus title="Arbitrum Sepolia" chain={status.chains.arbitrumSepolia} />
              <ChainStatus title="Robinhood Chain" chain={status.chains.rhc} />
            </div>
          </div>
        ) : (
          <div className="rounded-[6px] border border-[color:var(--line)] px-3 py-2 text-[12px] text-[color:var(--t2)]">
            Loading configured backend status...
          </div>
        )}
      </div>
    </section>
  );
}

function ChainStatus({ title, chain }: { title: string; chain: ChainSystemStatus }) {
  const indexer = chain.indexer as ExtendedIndexer | null;
  const factoryReady = Boolean(chain.factoryAddress);
  const indexerReady = Boolean(indexer && !indexer.error && !indexer.stale && !indexer.lagging);
  const ready = factoryReady && chain.rpc.ok && indexerReady;
  return (
    <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--card-inner)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-[color:var(--tx)]">{title}</div>
        <span className={`rounded-[4px] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] ${ready ? "bg-[#10241d] text-[#7ef4c8]" : "bg-[#2a1f12] text-[#fbbf24]"}`}>
          {ready ? "ready" : "not ready"}
        </span>
      </div>
      <div className="grid gap-1.5 text-[12px]">
        <StatusLine label="Chain ID" value={String(chain.chainId)} ok />
        <StatusLine label="Factory" value={chain.factoryAddress ?? "not configured"} ok={factoryReady} mono />
        <StatusLine label="RPC" value={chain.rpc.ok ? `online${chain.rpc.blockNumber ? `, block ${chain.rpc.blockNumber}` : ""}` : chain.rpc.error ?? "not configured"} ok={chain.rpc.ok} />
        <StatusLine
          label="Indexer"
          value={indexer ? `block ${indexer.lastBlock ?? "n/a"}${indexer.error ? `, ${indexer.error}` : ""}` : "not synced"}
          ok={indexerReady}
        />
      </div>
    </div>
  );
}

function StatusTile({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--card-inner)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--t3)]">{label}</span>
        <span className={`h-2 w-2 rounded-full ${ok ? "bg-[#10b981]" : "bg-[#f59e0b]"}`} />
      </div>
      <div className="mt-1 truncate text-[13px] text-[color:var(--tx)]">{detail}</div>
    </div>
  );
}

function StatusLine({ label, value, ok, mono }: { label: string; value: string; ok: boolean; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[color:var(--t3)]">{label}</span>
      <span className={`min-w-0 truncate text-right ${mono ? "font-mono" : ""} ${ok ? "text-[color:var(--tx)]" : "text-[#fbbf24]"}`}>
        {value}
      </span>
    </div>
  );
}
