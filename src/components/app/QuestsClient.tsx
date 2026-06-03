"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Target, Trophy } from "lucide-react";
import { useWallet } from "@/lib/hooks/useWallet";

// Quests + points. Completion is derived server-side from real activity
// (bets, comments, follows, claims, referrals) — see services/api quests.ts.
// No client-side fabrication: a quest is done only if the data says so.

type Quest = {
  id: string;
  title: string;
  description: string;
  points: number;
  target: number;
  progress: number;
  completed: boolean;
};

type QuestsResponse = {
  authenticated: boolean;
  pointsEarned: number;
  pointsTotal: number;
  quests: Quest[];
};

export function QuestsClient() {
  const { account } = useWallet();
  const [data, setData] = useState<QuestsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/quests", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as QuestsResponse);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch on mount and whenever the connected wallet changes (so
    // personalized progress loads right after sign-in).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, account?.address]);

  return (
    <div className="px-[22px] py-5 pb-7">
      <div className="mb-5 flex items-end justify-between flex-wrap gap-3">
        <div>
          <div
            className="text-[10.5px] font-mono uppercase tracking-[0.14em] mb-1.5"
            style={{ color: "var(--accent-bright)" }}
          >
            Earn · Level up
          </div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ color: "var(--tx)" }}>
            Quests
          </h1>
          <p className="text-[13px] mt-1 max-w-prose" style={{ color: "var(--t2)" }}>
            Complete actions to earn points. Progress is tracked from your
            real on-chain and platform activity.
          </p>
        </div>
        <div
          className="rounded-[16px] px-5 py-3 text-center"
          style={{ background: "var(--panel-bg)", border: "1px solid var(--line)" }}
        >
          <div className="flex items-center gap-1.5 justify-center" style={{ color: "var(--accent-bright)" }}>
            <Trophy className="w-4 h-4" />
            <span className="text-[22px] font-bold tabular-nums" style={{ color: "var(--tx)" }}>
              {data ? data.pointsEarned : 0}
            </span>
          </div>
          <div className="text-[10.5px] font-mono uppercase tracking-[0.08em] mt-0.5" style={{ color: "var(--t3)" }}>
            / {data ? data.pointsTotal : 0} pts
          </div>
        </div>
      </div>

      {!account && (
        <p className="text-[12.5px] mb-4" style={{ color: "var(--t3)" }}>
          Connect your wallet to track progress and earn points.
        </p>
      )}

      {loading ? (
        <p className="text-[13px]" style={{ color: "var(--t3)" }}>
          Loading quests…
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(data?.quests ?? []).map((q) => (
            <div
              key={q.id}
              className="rounded-[16px] p-4 flex items-start gap-3"
              style={{
                background: "var(--panel-bg)",
                border: `1px solid ${q.completed ? "var(--accent-bright)" : "var(--line)"}`,
              }}
            >
              <div
                className="grid place-items-center w-9 h-9 rounded-[10px] flex-shrink-0"
                style={{
                  background: q.completed ? "var(--accent-bright)" : "var(--card-inner)",
                  color: q.completed ? "#0a0a0a" : "var(--t3)",
                }}
              >
                {q.completed ? <Check className="w-4 h-4" /> : <Target className="w-4 h-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-semibold" style={{ color: "var(--tx)" }}>
                    {q.title}
                  </span>
                  <span
                    className="text-[12px] font-mono font-bold flex-shrink-0"
                    style={{ color: q.completed ? "var(--accent-bright)" : "var(--t3)" }}
                  >
                    +{q.points}
                  </span>
                </div>
                <p className="text-[12.5px] mt-0.5" style={{ color: "var(--t2)" }}>
                  {q.description}
                </p>
                {q.target > 1 && (
                  <div className="mt-2">
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ background: "var(--card-inner)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round((q.progress / q.target) * 100)}%`,
                          background: "var(--accent-bright)",
                        }}
                      />
                    </div>
                    <span className="text-[10.5px] font-mono mt-1 inline-block" style={{ color: "var(--t4)" }}>
                      {q.progress}/{q.target}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
