"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Gift, Users } from "lucide-react";
import { useWallet } from "@/lib/hooks/useWallet";
import { showToast } from "@/components/dashboard/toast";

// Referral surface. The backend already does attribution + rebate accrual
// (/api/referrals/*); this page exposes the shareable link + the user's
// referral stats. The link is address-based (?ref=0x...), captured on the
// landing page after the invitee connects.

type Stats = {
  refereeCount: number;
  totalFeesUsdCents: number;
  totalRebateUsdCents: number;
};

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ReferralsClient() {
  const { account } = useWallet();
  const [stats, setStats] = useState<Stats | null>(null);
  const [copied, setCopied] = useState(false);

  const referralLink =
    account?.address && typeof window !== "undefined"
      ? `${window.location.origin}/?ref=${account.address}`
      : "";

  const load = useCallback(async () => {
    if (!account?.address) return;
    try {
      const res = await fetch("/api/referrals/stats", { cache: "no-store" });
      if (res.ok) setStats((await res.json()) as Stats);
    } catch {
      // stats are best-effort; the link still works without them
    }
  }, [account?.address]);

  useEffect(() => {
    // Standard fetch-on-mount lifecycle; load() drives the stats state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function copyLink() {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast({ kind: "error", title: "Copy failed", body: "Copy the link manually." });
    }
  }

  return (
    <div className="px-[22px] py-5 pb-7">
      <div className="mb-5">
        <div
          className="text-[10.5px] font-mono uppercase tracking-[0.14em] mb-1.5"
          style={{ color: "var(--accent-bright)" }}
        >
          Invite · Earn rebates
        </div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ color: "var(--tx)" }}>
          Referrals
        </h1>
        <p className="text-[13px] mt-1 max-w-prose" style={{ color: "var(--t2)" }}>
          Share your link. When someone you invite trades, you earn a rebate on
          their fees — credited automatically on-chain.
        </p>
      </div>

      {!account ? (
        <section
          className="rounded-[16px] p-6 text-center"
          style={{ background: "var(--panel-bg)", border: "1px solid var(--line)" }}
        >
          <Gift className="w-7 h-7 mx-auto mb-2" style={{ color: "var(--t3)" }} />
          <p className="text-[14px] font-semibold" style={{ color: "var(--tx)" }}>
            Connect your wallet
          </p>
          <p className="text-[12.5px] mt-1" style={{ color: "var(--t2)" }}>
            Your referral link is tied to your wallet address.
          </p>
        </section>
      ) : (
        <>
          <section
            className="rounded-[16px] p-4 mb-4"
            style={{ background: "var(--panel-bg)", border: "1px solid var(--line)" }}
          >
            <div className="text-[11px] font-mono uppercase tracking-[0.08em] mb-2" style={{ color: "var(--t3)" }}>
              Your referral link
            </div>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 truncate rounded-[10px] px-3 py-2 text-[12.5px]"
                style={{ background: "var(--card-inner)", border: "1px solid var(--line-soft)", color: "var(--tx)" }}
              >
                {referralLink}
              </code>
              <button
                type="button"
                onClick={copyLink}
                className="btn primary inline-flex items-center gap-1.5"
                style={{ height: 38, padding: "0 14px", fontSize: 13 }}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </section>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard
              icon={<Users className="w-4 h-4" />}
              label="Friends referred"
              value={stats ? String(stats.refereeCount) : "—"}
            />
            <StatCard
              icon={<Gift className="w-4 h-4" />}
              label="Rebate earned"
              value={stats ? usd(stats.totalRebateUsdCents) : "—"}
            />
            <StatCard
              icon={<Gift className="w-4 h-4" />}
              label="Their fees"
              value={stats ? usd(stats.totalFeesUsdCents) : "—"}
            />
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div
      className="rounded-[16px] p-4"
      style={{ background: "var(--panel-bg)", border: "1px solid var(--line)" }}
    >
      <div className="flex items-center gap-1.5 mb-1.5" style={{ color: "var(--t3)" }}>
        {icon}
        <span className="text-[11px] font-mono uppercase tracking-[0.08em]">{label}</span>
      </div>
      <div className="text-[22px] font-bold tabular-nums" style={{ color: "var(--tx)" }}>
        {value}
      </div>
    </div>
  );
}
