"use client";

import { useState } from "react";
import { Gavel } from "lucide-react";

// Admin-only manual resolution for markets outside the auto-ingest pipeline.
// Propose signs an AI-judge verdict and calls AIJudgeVerifier.propose (opens the
// challenge window); Finalize calls finalize() after the window. Both require an
// admin session (IMPORT_ADMIN_ADDRESSES) — the backend enforces it.

export function ManualResolveClient() {
  const [marketId, setMarketId] = useState("");
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState<"propose" | "finalize" | "arbitrate" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (action: "propose" | "finalize" | "arbitrate") => {
    if (!marketId.trim()) {
      setError("Enter a market id.");
      return;
    }
    setBusy(action);
    setResult(null);
    setError(null);
    try {
      const body =
        action === "propose"
          ? JSON.stringify({ outcome, evidence: evidence.trim() || undefined })
          : action === "arbitrate"
            ? JSON.stringify({ finalOutcome: outcome })
            : undefined;
      const res = await fetch(`/api/admin/markets/${encodeURIComponent(marketId.trim())}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const text = await res.text();
      if (!res.ok) {
        setError(`${action} failed (${res.status}): ${text}`);
        return;
      }
      setResult(`${action} ok: ${text}`);
    } catch {
      setError(`${action} failed.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-[22px] py-5 pb-7 max-w-[680px]">
      <div className="flex items-center gap-2 mb-1">
        <Gavel className="w-5 h-5 text-[#d9ff00]" />
        <h1 className="text-white text-[22px] font-bold tracking-tight">Manual resolution</h1>
      </div>
      <p className="text-[13px] text-gray-400 mb-5 max-w-prose">
        Admin-only. Propose an AI-judge verdict for a market that the auto pipeline
        does not handle, then finalize after the challenge window. Requires an admin
        session and the on-chain creator/judge keys configured on the backend.
      </p>

      <div className="panel p-4 space-y-3">
        <input
          value={marketId}
          onChange={(e) => setMarketId(e.target.value)}
          placeholder="Market id (e.g. 421614:7)"
          className="w-full rounded-[6px] border border-[#2a2a2a] bg-[#161616] px-3 py-2 text-[13px] text-white outline-none focus:border-[#3b6ffa]"
        />
        <div className="flex items-center gap-2">
          {(["YES", "NO"] as const).map((side) => (
            <button
              key={side}
              onClick={() => setOutcome(side)}
              className="h-9 px-4 rounded-[6px] text-[12.5px] font-bold border"
              style={{
                background: outcome === side ? (side === "YES" ? "#d9ff00" : "#3b6ffa") : "transparent",
                color: outcome === side ? (side === "YES" ? "#0a0a0a" : "#fff") : "var(--t2)",
                borderColor: outcome === side ? "transparent" : "var(--line-soft)",
              }}
            >
              {side}
            </button>
          ))}
        </div>
        <textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="Evidence / rationale (optional, stored in the verdict hash)"
          rows={3}
          className="w-full rounded-[6px] border border-[#2a2a2a] bg-[#161616] px-3 py-2 text-[12.5px] text-white outline-none focus:border-[#3b6ffa]"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void call("propose")}
            disabled={busy !== null}
            className="h-9 px-4 rounded-[6px] bg-[#d9ff00] text-black text-[12.5px] font-bold disabled:opacity-40"
          >
            {busy === "propose" ? "Proposing…" : "Propose verdict"}
          </button>
          <button
            onClick={() => void call("finalize")}
            disabled={busy !== null}
            className="h-9 px-4 rounded-[6px] border border-[#2a2a2a] text-gray-200 text-[12.5px] font-bold disabled:opacity-40"
          >
            {busy === "finalize" ? "Finalizing…" : "Finalize"}
          </button>
          <button
            onClick={() => void call("arbitrate")}
            disabled={busy !== null}
            className="h-9 px-4 rounded-[6px] border border-[#2a2a2a] text-gray-200 text-[12.5px] font-bold disabled:opacity-40"
            title="Resolve a disputed optimistic assertion to the selected outcome"
          >
            {busy === "arbitrate" ? "Arbitrating…" : "Arbitrate dispute"}
          </button>
        </div>
        {result && <div className="text-[11.5px] text-[#5fc295] break-all">{result}</div>}
        {error && <div className="text-[11.5px] text-[#fca5a5] break-all">{error}</div>}
      </div>
    </div>
  );
}
