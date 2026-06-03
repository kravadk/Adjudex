"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Plus, RadioTower } from "lucide-react";
import { MarketsGrid } from "@/components/dashboard/markets-grid";
import { toMarketView, type MarketView } from "@/lib/market-view";
import type { Market } from "@/lib/types/domain";
import { getRhcChainId } from "@/lib/onchain-config";
import { useSystemStatus } from "@/lib/hooks/useSystemStatus";

export function RhcMarketsClient() {
  const chainId = getRhcChainId();
  const { status } = useSystemStatus();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/markets?chainId=${chainId}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await response.text());
          return response.json() as Promise<Market[]>;
        })
        .then((rows) => {
          setMarkets(rows);
          setError(null);
        })
        .catch((nextError) => {
          if (controller.signal.aborted) return;
          setMarkets([]);
          setError(nextError instanceof Error ? nextError.message : "Robinhood Chain markets unavailable.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [chainId]);

  const views: MarketView[] = useMemo(
    () => markets.map((market) => toMarketView(market)),
    [markets],
  );
  const rhcStatus = status?.chains?.rhc;
  const ready = Boolean(rhcStatus?.rpc.ok && rhcStatus.factoryAddress && rhcStatus.indexer);

  return (
    <div className="pb-10">
      <section className="mb-5 rounded-[8px] border p-4" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[8px]" style={{ background: "#211f1e", color: "var(--accent-bright)" }}>
            <RadioTower className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold" style={{ color: "var(--tx)" }}>
              Robinhood Chain Markets
            </h1>
            <p className="text-[12.5px]" style={{ color: "var(--t3)" }}>
              Chain ID {chainId} · Alchemy-backed RHC RPC · RWA-ready prediction markets
            </p>
          </div>
          <div className="flex-1" />
          <span className={ready ? "b-badge ok" : "b-badge pend"}>
            <span className="d" />
            {ready ? "RHC ready" : "RHC unavailable"}
          </span>
          <Link href="/rhc/create" className="btn primary">
            <Plus className="h-3.5 w-3.5" />
            New RHC market
          </Link>
        </div>
        {!ready && (
          <div className="mt-3 flex items-start gap-2 rounded-[8px] border p-3 text-[12px]" style={{ borderColor: "var(--line-soft)", color: "var(--t3)" }}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Set `ALCHEMY_RHC_API_KEY` or `RHC_RPC_URL`, plus `RHC_MARKET_FACTORY_ADDRESS`, then run the RHC indexer to make this venue live.
            </span>
          </div>
        )}
      </section>

      <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <RhcMetric label="Indexed RHC markets" value={loading ? "..." : String(views.length)} />
        <RhcMetric label="RPC" value={rhcStatus?.rpc.ok ? "online" : "offline"} />
        <RhcMetric label="Indexer" value={rhcStatus?.indexer?.id ?? "not configured"} />
      </section>

      <MarketsGrid
        views={views}
        emptyHint={
          error
            ? "Robinhood Chain market feed unavailable. Check backend status and RHC env."
            : loading
              ? "Loading Robinhood Chain markets..."
              : "No Robinhood Chain markets indexed yet."
        }
      />

      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/api/status" className="btn">
          <Activity className="h-3.5 w-3.5" />
          Status JSON
        </Link>
        <Link href="/integrations" className="btn">
          Sponsor evidence
        </Link>
      </div>
    </div>
  );
}

function RhcMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border p-3" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
      <div className="text-[11px] uppercase tracking-[0.12em]" style={{ color: "var(--t4)" }}>
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-[14px]" style={{ color: "var(--tx)" }}>
        {value}
      </div>
    </div>
  );
}
