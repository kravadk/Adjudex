import { CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { requireBackendUrl } from "@/lib/server/backend-api";

export const metadata = {
  title: "Status · PariAI",
  description:
    "Live system status for PariAI — backend API, indexer health per chain, AI judge worker, database. Refreshed every 30 seconds.",
};

// Public status page (S5.C). Server-rendered each visit so users see a
// fresh snapshot without trusting an in-app JS toggle. Pairs with the
// per-region deploy story in docs/RUNBOOK.md — region tags come from the
// `region` field in /api/status. We do NOT bypass geo-block here because
// the status page is in the geo-block allowlist for /api/status.

type StatusPayload = {
  ok: boolean;
  region?: string;
  database?: { ok: boolean; error?: string };
  rpc?: { ok: boolean; configured: boolean; blockNumber?: number };
  chains?: Record<
    string,
    {
      ok: boolean;
      indexer?: {
        lastBlock?: number;
        lastStatus?: string;
        lagBlocks?: number;
        reorgRecent?: boolean;
        updatedAt?: string;
      };
    }
  >;
};

async function loadStatus(): Promise<StatusPayload | null> {
  try {
    const res = await fetch(`${requireBackendUrl()}/api/status`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as StatusPayload;
  } catch {
    return null;
  }
}

export default async function StatusPage() {
  const status = await loadStatus();
  if (!status) {
    return (
      <div className="px-[22px] py-7 max-w-[820px] mx-auto">
        <Heading />
        <div
          className="panel p-5"
          style={{ borderColor: "rgba(239,68,68,0.35)" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4" style={{ color: "#ef4444" }} />
            <span className="text-[14px] font-semibold" style={{ color: "var(--tx)" }}>
              Status page unreachable
            </span>
          </div>
          <p className="text-[12.5px]" style={{ color: "var(--t2)" }}>
            The backend `/api/status` endpoint did not respond. This usually
            means the API instance is down — see incident channel.
          </p>
        </div>
      </div>
    );
  }

  const chains = Object.entries(status.chains ?? {});
  return (
    <div className="px-[22px] py-7 max-w-[820px] mx-auto">
      <Heading />

      <Card
        label="Backend API"
        ok={status.ok}
        detail={
          status.region
            ? `Region: ${status.region}`
            : "Region not reported — single-instance deploy"
        }
      />

      <Card
        label="Database"
        ok={status.database?.ok ?? false}
        detail={status.database?.error ?? "Postgres connection healthy"}
      />

      <Card
        label="Default RPC"
        ok={(status.rpc?.ok ?? false) && (status.rpc?.configured ?? false)}
        detail={
          status.rpc?.blockNumber
            ? `Block #${status.rpc.blockNumber}`
            : "RPC configured, no recent block reported"
        }
      />

      {chains.length > 0 && (
        <div className="mt-4">
          <h2
            className="text-[14px] font-semibold tracking-tight mb-2"
            style={{ color: "var(--tx)" }}
          >
            Indexers
          </h2>
          {chains.map(([slug, chain]) => (
            <Card
              key={slug}
              label={`Indexer · ${slug}`}
              ok={Boolean(chain.ok)}
              detail={
                chain.indexer
                  ? `Last block: ${chain.indexer.lastBlock ?? "—"} · Lag: ${chain.indexer.lagBlocks ?? "—"} blocks${
                      chain.indexer.reorgRecent ? " · ⚠ recent reorg" : ""
                    }`
                  : "No indexer state reported"
              }
            />
          ))}
        </div>
      )}

      <p
        className="text-[10.5px] font-mono mt-6"
        style={{ color: "var(--t3)" }}
      >
        Snapshot at {new Date().toISOString()}. Refresh manually or visit
        every 30s for live ops; production also feeds Statuspage at
        status.pariai.xyz.
      </p>
    </div>
  );
}

function Heading() {
  return (
    <div className="mb-6">
      <div
        className="text-[10.5px] font-mono uppercase tracking-[0.14em] mb-2"
        style={{ color: "var(--accent-bright)" }}
      >
        Live status
      </div>
      <h1
        className="text-[28px] font-semibold tracking-[-0.02em]"
        style={{ color: "var(--tx)" }}
      >
        System health
      </h1>
      <p
        className="text-[13.5px] mt-1 max-w-prose"
        style={{ color: "var(--t2)" }}
      >
        Per-component status read from the backend `/api/status` snapshot.
        Green = healthy and within SLA. Yellow = degraded but functional.
        Red = down or out-of-bounds.
      </p>
    </div>
  );
}

function Card({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string;
}) {
  const Icon = ok ? CheckCircle2 : AlertCircle;
  const color = ok ? "var(--green-tx)" : "#f59e0b";
  return (
    <div
      className="panel p-4 mb-2"
      style={{ borderColor: "var(--line)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="text-[13.5px] font-semibold"
          style={{ color: "var(--tx)" }}
        >
          {label}
        </span>
        <span className="inline-flex items-center gap-1.5" style={{ color }}>
          <Icon className="w-4 h-4" />
          <span
            className="text-[11px] font-mono uppercase tracking-[0.08em]"
          >
            {ok ? "Operational" : "Degraded"}
          </span>
        </span>
      </div>
      {detail && (
        <p
          className="text-[12px] font-mono mt-1.5"
          style={{ color: "var(--t3)" }}
        >
          {detail}
        </p>
      )}
    </div>
  );
}
