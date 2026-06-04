"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { BetSide, ParlayPreview } from "@/lib/types/domain";

type DraftLeg = { marketId: string; side: BetSide };

export default function ParlaysPage() {
  const [legs, setLegs] = useState<DraftLeg[]>([
    { marketId: "", side: "YES" },
    { marketId: "", side: "YES" },
  ]);
  const [preview, setPreview] = useState<ParlayPreview | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);

  function updateLeg(index: number, patch: Partial<DraftLeg>) {
    setLegs((current) => current.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));
  }

  async function requestPreview() {
    setBusy("preview");
    setMessage(null);
    setDraftId(null);
    try {
      const response = await fetch("/api/parlays/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legs }),
      });
      if (!response.ok) throw new Error(await response.text());
      setPreview((await response.json()) as ParlayPreview);
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : "Parlay preview failed.");
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    setBusy("save");
    setMessage(null);
    try {
      const response = await fetch("/api/parlays", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legs }),
      });
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as { id: string };
      setDraftId(body.id);
      setMessage("Parlay draft stored.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Parlay draft save failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-[980px] px-5 py-6">
      <div className="mb-5">
        <div className="caps mb-2">correlated risk beta</div>
        <h1 className="text-[22px] font-semibold text-white">Parlay builder</h1>
      </div>

      <section className="panel p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-[11px] text-gray-500">Legs</span>
          <button onClick={() => setLegs((current) => [...current, { marketId: "", side: "YES" }])} className="inline-flex h-8 items-center gap-2 rounded-[6px] border border-[#2a2a2a] bg-[#232323] px-2.5 text-[12px] text-gray-200">
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
        <div className="space-y-2">
          {legs.map((leg, index) => (
            <div key={index} className="grid grid-cols-[1fr_116px_36px] gap-2">
              <input value={leg.marketId} onChange={(event) => updateLeg(index, { marketId: event.target.value })} placeholder="market id" className="h-10 rounded-[6px] border border-[#2a2a2a] bg-[#111111] px-3 text-[13px] text-white outline-none focus:border-[#CCE9E7]" />
              <select value={leg.side} onChange={(event) => updateLeg(index, { side: event.target.value as BetSide })} className="h-10 rounded-[6px] border border-[#2a2a2a] bg-[#111111] px-3 text-[13px] text-white outline-none focus:border-[#CCE9E7]">
                <option value="YES">YES</option>
                <option value="NO">NO</option>
              </select>
              <button onClick={() => setLegs((current) => current.filter((_, i) => i !== index))} className="grid h-10 place-items-center rounded-[6px] border border-[#2a2a2a] bg-[#232323] text-gray-300" aria-label="Remove leg">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => void requestPreview()} disabled={busy !== null} className="h-9 rounded-[6px] bg-[#CCE9E7] px-3 text-[12px] font-medium text-black disabled:opacity-50">
            Preview
          </button>
          <button onClick={() => void saveDraft()} disabled={busy !== null} className="h-9 rounded-[6px] border border-[#2a2a2a] bg-[#232323] px-3 text-[12px] text-gray-200 disabled:opacity-50">
            Save draft
          </button>
        </div>
      </section>

      <section className="panel mt-4 p-4">
        <div className="mb-3 text-[11px] text-gray-500">Quote</div>
        {preview ? (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
            <Metric label="Naive probability" value={`${(preview.naiveProbabilityBps / 100).toFixed(2)}%`} />
            <Metric label="Executable" value={preview.executable ? "yes" : "prototype only"} />
            <Metric label="Leg count" value={preview.legs.length.toString()} />
            <div className="rounded-[6px] border border-[#5f4421] bg-[#21180f] p-3 text-[11.5px] text-[#fbbf24] md:col-span-3">
              {preview.correlationWarning}
            </div>
          </div>
        ) : (
          <div className="rounded-[6px] border border-[#262626] bg-[#111111] p-3 text-[11.5px] text-gray-500">
            No parlay quote loaded from the backend.
          </div>
        )}
      </section>

      {draftId && <div className="mt-4 rounded-[6px] border border-[#2a2a2a] bg-[#111111] p-3 text-[12px] text-gray-300">Draft id: <span className="font-mono">{draftId}</span></div>}
      {message && <div className="mt-4 rounded-[6px] border border-[#2a2a2a] bg-[#111111] p-3 text-[12px] text-gray-300">{message}</div>}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-[#262626] bg-[#111111] p-3">
      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-gray-500">{label}</div>
      <div className="font-mono text-[14px] text-white">{value}</div>
    </div>
  );
}
