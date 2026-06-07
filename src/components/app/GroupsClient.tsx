"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers, Plus } from "lucide-react";

// Exclusive-outcome groups: browse existing groups (with implied-probability
// coherence) and create a new one from 2+ markets. Backed by the real
// /api/market-groups endpoints; the on-chain ExclusiveGroupSettler resolves a
// group's child markets atomically (winner YES, others NO).

type GroupOutcome = { id: string; marketId: string; label: string; probabilityBps: number };
type Group = {
  id: string;
  title: string;
  status: string;
  outcomes: GroupOutcome[];
  totalProbabilityBps: number;
  coherent: boolean;
};
type MarketLite = { id: string; title: string };

export function GroupsClient() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [markets, setMarkets] = useState<MarketLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [gRes, mRes] = await Promise.all([
        fetch("/api/market-groups", { cache: "no-store" }),
        fetch("/api/markets", { cache: "no-store" }),
      ]);
      const nextGroups = gRes.ok ? ((await gRes.json()) as Group[]) : [];
      const nextMarkets = mRes.ok
        ? ((await mRes.json()) as Array<{ id: string; title: string }>).map((m) => ({ id: m.id, title: m.title }))
        : [];
      setGroups(Array.isArray(nextGroups) ? nextGroups : []);
      setMarkets(nextMarkets);
    } catch {
      setError("Could not load groups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const create = useCallback(async () => {
    if (!title.trim() || picked.length < 2) {
      setError("Pick a title and at least 2 markets.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const evenBps = Math.round(10000 / picked.length);
      const outcomes = picked.map((marketId) => ({
        marketId,
        label: markets.find((m) => m.id === marketId)?.title ?? marketId,
        probabilityBps: evenBps,
      }));
      const res = await fetch("/api/market-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), outcomes }),
      });
      if (!res.ok) {
        setError(`Create failed: ${await res.text()}`);
        return;
      }
      setTitle("");
      setPicked([]);
      await load();
    } catch {
      setError("Create failed.");
    } finally {
      setSubmitting(false);
    }
  }, [title, picked, markets, load]);

  return (
    <div className="px-[22px] py-5 pb-7 max-w-[980px]">
      <div className="flex items-center gap-2 mb-1">
        <Layers className="w-5 h-5 text-[#d9ff00]" />
        <h1 className="text-white text-[22px] font-bold tracking-tight">Exclusive groups</h1>
      </div>
      <p className="text-[13px] text-gray-400 mb-5 max-w-prose">
        Group mutually-exclusive markets (exactly one resolves YES). Total implied
        probability should sum to ~100%; the on-chain settler resolves the whole
        group atomically once the winner is known.
      </p>

      {/* Create */}
      <div className="panel p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Plus className="w-4 h-4 text-gray-400" />
          <span className="text-[12px] text-gray-300 font-semibold uppercase tracking-wider">New group</span>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Group title (e.g. Who wins Group A?)"
          className="w-full mb-3 rounded-[6px] border border-[#2a2a2a] bg-[#161616] px-3 py-2 text-[13px] text-white outline-none focus:border-[#3b6ffa]"
        />
        <div className="max-h-[220px] overflow-y-auto rounded-[6px] border border-[#222] divide-y divide-[#1c1c1c]">
          {markets.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-gray-500">No markets to group yet.</div>
          ) : (
            markets.map((m) => (
              <label key={m.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[#1a1a1a]">
                <input type="checkbox" checked={picked.includes(m.id)} onChange={() => toggle(m.id)} />
                <span className="text-[12.5px] text-gray-200 truncate">{m.title}</span>
              </label>
            ))
          )}
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-[11px] text-gray-500">{picked.length} selected</span>
          <button
            onClick={() => void create()}
            disabled={submitting || picked.length < 2 || !title.trim()}
            className="h-9 px-4 rounded-[6px] bg-[#d9ff00] text-black text-[12.5px] font-bold disabled:opacity-40"
          >
            {submitting ? "Creating…" : "Create group"}
          </button>
        </div>
        {error && <div className="mt-2 text-[11.5px] text-[#fca5a5]">{error}</div>}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-[12px] text-gray-500">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="panel p-6 text-center text-[12.5px] text-gray-500">No groups yet.</div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const totalPct = (g.totalProbabilityBps / 100).toFixed(1);
            return (
              <div key={g.id} className="panel p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white text-[14px] font-semibold">{g.title}</span>
                  <span
                    className="text-[11px] font-mono px-2 py-0.5 rounded-full"
                    style={{
                      background: g.coherent ? "rgba(217,255,0,0.12)" : "rgba(233,162,59,0.14)",
                      color: g.coherent ? "#d9ff00" : "#e9a23b",
                    }}
                  >
                    Σ {totalPct}% · {g.coherent ? "coherent" : "overround"}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {g.outcomes.map((o) => (
                    <div key={o.id} className="flex items-center justify-between text-[12.5px]">
                      <span className="text-gray-300 truncate">{o.label}</span>
                      <span className="font-mono tabular-nums text-gray-400">{(o.probabilityBps / 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
