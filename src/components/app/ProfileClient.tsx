"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, UserCheck } from "lucide-react";
import { useWallet } from "@/lib/hooks/useWallet";
import { showToast } from "@/components/dashboard/toast";

// Public trader profile. Read is open; follow/unfollow is SIWE-gated.
// Stats are derived server-side from indexed positions (same aggregation
// as the leaderboard) — no client-fabricated numbers.

type Profile = {
  address: string;
  volumeUsd: number;
  pnlUsd: number;
  marketsTouched: number;
  positionsCount: number;
  winRate: number;
  followerCount: number;
  followingCount: number;
  isFollowedByMe: boolean;
  isSelf: boolean;
};

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
function usd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function ProfileClient({ address }: { address: string }) {
  const { account } = useWallet();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(address)}`, { cache: "no-store" });
      if (res.ok) setProfile((await res.json()) as Profile);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    // Fetch-on-mount lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function toggleFollow() {
    if (!account || !profile || pending) return;
    setPending(true);
    const next = !profile.isFollowedByMe;
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(address)}/follow`, {
        method: next ? "POST" : "DELETE",
      });
      if (res.status === 401) {
        showToast({ kind: "error", title: "Sign in required", body: "Connect your wallet to follow." });
        return;
      }
      if (!res.ok) throw new Error(`follow_${res.status}`);
      setProfile((p) =>
        p
          ? {
              ...p,
              isFollowedByMe: next,
              followerCount: p.followerCount + (next ? 1 : -1),
            }
          : p,
      );
    } catch {
      showToast({ kind: "error", title: "Action failed", body: "Could not update follow." });
    } finally {
      setPending(false);
    }
  }

  const canFollow = account && profile && !profile.isSelf;

  return (
    <div className="px-[22px] py-5 pb-7">
      <div className="flex items-center gap-4 mb-5 flex-wrap">
        <div
          className="grid place-items-center w-14 h-14 rounded-full text-[18px] font-bold"
          style={{ background: "var(--card-inner)", color: "var(--accent-bright)" }}
        >
          {address.slice(2, 4).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold font-mono tracking-tight" style={{ color: "var(--tx)" }}>
            {short(address)}
          </h1>
          <p className="text-[12.5px]" style={{ color: "var(--t2)" }}>
            {profile ? `${profile.followerCount} followers · ${profile.followingCount} following` : "—"}
          </p>
        </div>
        <div className="flex-1" />
        {canFollow && (
          <button
            type="button"
            onClick={toggleFollow}
            disabled={pending}
            className={profile!.isFollowedByMe ? "btn ghost" : "btn primary"}
            style={{ height: 36, padding: "0 16px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {profile!.isFollowedByMe ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            {profile!.isFollowedByMe ? "Following" : "Follow"}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-[13px]" style={{ color: "var(--t3)" }}>
          Loading profile…
        </p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Realized PnL" value={profile ? usd(profile.pnlUsd) : "—"} tone={profile && profile.pnlUsd >= 0 ? "pos" : "neg"} />
          <Stat label="Volume" value={profile ? usd(profile.volumeUsd) : "—"} />
          <Stat label="Markets" value={profile ? String(profile.marketsTouched) : "—"} />
          <Stat label="Win rate" value={profile ? `${Math.round(profile.winRate * 100)}%` : "—"} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? "var(--green-tx, #10b981)" : tone === "neg" ? "#ef4444" : "var(--tx)";
  return (
    <div className="rounded-[16px] p-4" style={{ background: "var(--panel-bg)", border: "1px solid var(--line)" }}>
      <div className="text-[11px] font-mono uppercase tracking-[0.08em] mb-1.5" style={{ color: "var(--t3)" }}>
        {label}
      </div>
      <div className="text-[20px] font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
