"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, XCircle } from "lucide-react";

// Admin review queue for hybrid-resolution escalations: mirror markets
// (Polymarket) whose AI cross-check disputed the reported outcome. The admin
// approves the mirror outcome (re-propose, skipping the AI check) or skips the
// market (stakes refunded after grace). Backend enforces SIWE admin.

type Escalated = {
  marketId: string;
  poolAddress: string;
  source: string;
  externalId: string;
  category: string;
  title: string | null;
  question: string;
  resolutionCriteria: string | null;
  sourceUrl: string | null;
  yesLabel: string;
  noLabel: string;
  aiReason: string | null;
  attempts: number;
  deadlineIso: string | null;
  escalatedAtIso: string | null;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}:${await res.text()}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status}:${await res.text()}`);
  return res.json() as Promise<T>;
}

function mapLoadError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "load_failed";
  return msg.startsWith("401") || msg.startsWith("403") ? "admin_only" : msg;
}

export function EscalatedReviewClient() {
  const [items, setItems] = useState<Escalated[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Reload button handler (event context — synchronous setState is fine).
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await getJson<Escalated[]>("/api/admin/escalated"));
    } catch (e) {
      setError(mapLoadError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch: state updates happen after the await (not synchronously in
  // the effect body) so they don't trigger cascading renders.
  useEffect(() => {
    let active = true;
    getJson<Escalated[]>("/api/admin/escalated")
      .then((data) => {
        if (!active) return;
        setItems(data);
        setError(null);
      })
      .catch((e) => {
        if (active) setError(mapLoadError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function act(marketId: string, action: "approve" | "skip") {
    setBusy(`${marketId}:${action}`);
    setError(null);
    try {
      await postJson(`/api/admin/escalated/${encodeURIComponent(marketId)}`, { action });
      setItems((prev) => prev.filter((m) => m.marketId !== marketId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "action_failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-[920px] px-4 py-6">
      <section
        className="mb-5 rounded-[8px] border p-4"
        style={{ borderColor: "var(--line)", background: "var(--card)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="grid h-10 w-10 place-items-center rounded-[8px]"
              style={{ background: "#211f1e", color: "#f59e0b" }}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-[18px] font-semibold" style={{ color: "var(--tx)" }}>
                Escalated resolutions
              </h1>
              <p className="text-[12.5px]" style={{ color: "var(--t3)" }}>
                Mirror markets where the AI cross-check disputed the source outcome. Approve the
                mirror result or skip (refund after grace).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-[12px]"
            style={{ borderColor: "var(--line)", color: "var(--tx)" }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Reload
          </button>
        </div>

        {error === "admin_only" ? (
          <div className="mt-3 rounded-[8px] border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] text-amber-300">
            Admin only. Connect an allowlisted wallet (IMPORT_ADMIN_ADDRESSES) and sign in (SIWE).
          </div>
        ) : error ? (
          <div className="mt-3 rounded-[8px] border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-300">
            {error}
          </div>
        ) : null}
      </section>

      {loading ? (
        <div className="rounded-[8px] border p-6 text-center text-[13px]" style={{ borderColor: "var(--line)", color: "var(--t3)" }}>
          Loading…
        </div>
      ) : items.length === 0 && !error ? (
        <div
          className="rounded-[8px] border p-8 text-center text-[13px]"
          style={{ borderColor: "var(--line)", color: "var(--t3)", background: "var(--card)" }}
        >
          <CheckCircle2 className="mx-auto mb-2 h-6 w-6" style={{ color: "#10b981" }} />
          No escalated markets. The hybrid resolver is clear.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((m) => (
            <article
              key={m.marketId}
              className="rounded-[8px] border p-4"
              style={{ borderColor: "var(--line)", background: "var(--card)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--t3)" }}>
                    <span>{m.source}</span>
                    <span>·</span>
                    <span>{m.category}</span>
                    <span>·</span>
                    <span>#{m.marketId}</span>
                  </div>
                  <h2 className="mt-1 text-[14px] font-semibold leading-snug" style={{ color: "var(--tx)" }}>
                    {m.question}
                  </h2>
                </div>
                {m.sourceUrl ? (
                  <Link
                    href={m.sourceUrl}
                    target="_blank"
                    className="inline-flex shrink-0 items-center gap-1 text-[11px]"
                    style={{ color: "var(--accent-bright)" }}
                  >
                    Polymarket <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : null}
              </div>

              <div
                className="mt-3 rounded-[8px] border border-amber-500/25 bg-amber-500/5 p-3 text-[12px] leading-relaxed"
                style={{ color: "#fcd9a8" }}
              >
                <span className="font-semibold">AI dispute: </span>
                {m.aiReason ?? "no reason recorded"}
              </div>

              {m.resolutionCriteria ? (
                <p className="mt-2 text-[11.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
                  {m.resolutionCriteria}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" style={{ color: "var(--t4)" }}>
                <span>YES = {m.yesLabel}</span>
                <span>NO = {m.noLabel}</span>
                <span>attempts: {m.attempts}</span>
                {m.deadlineIso ? <span>closed: {new Date(m.deadlineIso).toLocaleString()}</span> : null}
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act(m.marketId, "approve")}
                  className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                  style={{ background: "#10b981", color: "#04110c" }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {busy === `${m.marketId}:approve` ? "Approving…" : "Approve mirror"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act(m.marketId, "skip")}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                  style={{ borderColor: "var(--line)", color: "#fca5a5" }}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  {busy === `${m.marketId}:skip` ? "Skipping…" : "Skip (refund)"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
