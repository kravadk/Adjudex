"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Flame, UserPlus, UserCheck } from "lucide-react";

// Social signal panel for /agent/[id] (S6.C.2). Renders:
//   - Streak chip: "W3" / "L2" / "no streak"
//   - Last-10 form indicator: row of W/L pips
//   - Follower count + Follow / Unfollow button (SIWE-gated)
//
// Strictly social proof. Follower count is UI-only; it does NOT
// influence on-chain ERC-8004 reputation.

type SocialPayload = {
  followerCount: number;
  isFollowedByMe: boolean;
  recentFollowers: string[];
  streak: { current: number; kind: "W" | "L" } | null;
  last10: ("W" | "L")[];
};

export function AgentSocial({ agentId }: { agentId: string }) {
  const { isConnected } = useAccount();
  const [data, setData] = useState<SocialPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/social`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setError(`social_${res.status}`);
        return;
      }
      const payload = (await res.json()) as SocialPayload;
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    }
  }, [agentId]);

  useEffect(() => {
    // Intentional: one-shot load on mount + on agentId change. The
    // load() helper drives setState internally; this is the standard
    // pattern for "fetch external data and hydrate into component
    // state" — not a React-managed external store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toggle = async () => {
    if (!data || pending) return;
    setPending(true);
    const willFollow = !data.isFollowedByMe;
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/follow`, {
        method: willFollow ? "POST" : "DELETE",
      });
      if (!res.ok) {
        setError(`follow_${res.status}`);
        return;
      }
      await load();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span
          className="text-[10px] font-mono uppercase tracking-[0.14em]"
          style={{ color: "var(--t3)" }}
        >
          Social signal
        </span>
        {data && (
          <FollowButton
            isFollowed={data.isFollowedByMe}
            disabled={!isConnected || pending}
            onClick={toggle}
          />
        )}
      </div>

      {error && (
        <p className="text-[11px]" style={{ color: "#ef4444" }}>
          {error}
        </p>
      )}

      {data && (
        <>
          <div className="flex items-baseline gap-3 mb-3">
            <span
              className="text-[24px] font-mono font-bold tabular-nums"
              style={{ color: "var(--tx)" }}
            >
              {data.followerCount}
            </span>
            <span className="text-[11px]" style={{ color: "var(--t3)" }}>
              {data.followerCount === 1 ? "follower" : "followers"}
            </span>
          </div>

          {data.streak && (
            <div className="flex items-center gap-2 mb-3">
              <Flame
                className="h-4 w-4"
                style={{ color: data.streak.kind === "W" ? "#10b981" : "#ef4444" }}
              />
              <span
                className="text-[14px] font-mono font-bold tabular-nums"
                style={{
                  color: data.streak.kind === "W" ? "#10b981" : "#ef4444",
                }}
              >
                {data.streak.kind}
                {data.streak.current}
              </span>
              <span className="text-[11px]" style={{ color: "var(--t3)" }}>
                current streak
              </span>
            </div>
          )}

          {data.last10.length > 0 && (
            <div>
              <span
                className="text-[10px] font-mono uppercase tracking-[0.08em] block mb-1.5"
                style={{ color: "var(--t3)" }}
              >
                Form · last {data.last10.length}
              </span>
              <div className="flex gap-1">
                {data.last10.map((pip, i) => (
                  <span
                    key={i}
                    title={pip === "W" ? "Win" : "Loss"}
                    className="grid place-items-center w-6 h-6 rounded-[5px] text-[10px] font-mono font-bold"
                    style={{
                      background:
                        pip === "W"
                          ? "rgba(16,185,129,0.15)"
                          : "rgba(239,68,68,0.15)",
                      color: pip === "W" ? "#10b981" : "#ef4444",
                      border: `1px solid ${
                        pip === "W"
                          ? "rgba(16,185,129,0.3)"
                          : "rgba(239,68,68,0.3)"
                      }`,
                    }}
                  >
                    {pip}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!data.streak && data.last10.length === 0 && (
            <p
              className="text-[11px] leading-relaxed"
              style={{ color: "var(--t3)" }}
            >
              No resolved markets yet — streak will appear after the first
              judged outcome.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function FollowButton({
  isFollowed,
  disabled,
  onClick,
}: {
  isFollowed: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = isFollowed ? UserCheck : UserPlus;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border px-2.5 text-[11px] font-mono uppercase tracking-[0.06em] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: isFollowed ? "rgba(16,185,129,0.10)" : "#211f1e",
        borderColor: isFollowed ? "rgba(16,185,129,0.35)" : "#34312e",
        color: isFollowed ? "#10b981" : "var(--t2)",
      }}
    >
      <Icon className="h-3 w-3" />
      {isFollowed ? "Following" : "Follow"}
    </button>
  );
}
