"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Wallet2 } from "lucide-react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { ActivityEvent } from "@/lib/types/domain";

type Props = {
  recentActivity?: ActivityEvent[];
};

// Adjudex homepage hero with:
//   - peer-pool tagline
//   - dual primary CTA ("Open markets" / "Read the terminal guide")
//   - Connect Wallet CTA shown only when user is NOT connected
//   - live activity ticker fed from /api/activity
export function Hero({ recentActivity = [] }: Props) {
  const { isConnected } = useAccount();
  return (
    <section
      className="panel reveal mb-4"
      style={{
        padding: "32px 28px 0",
        background:
          "linear-gradient(135deg, rgba(40,160,240,0.10) 0%, rgba(28,27,26,0) 60%)",
        borderColor: "#34302c",
      }}
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <div className="flex-1 min-w-0 pb-7">
          <div
            className="text-[10.5px] font-mono uppercase tracking-[0.14em] mb-3"
            style={{ color: "var(--accent-bright)" }}
          >
            Parimutuel terminal · AI-judged resolution
          </div>
          <h1
            className="text-[28px] md:text-[34px] font-semibold leading-tight tracking-[-0.02em] mb-3"
            style={{ color: "var(--tx)" }}
          >
            Peer pool, not house.
            <br />
            <span style={{ color: "var(--t2)" }}>
              Wallet-first prediction markets, every position settled
              from the counter-pool.
            </span>
          </h1>
          <p
            className="text-[13.5px] max-w-prose leading-relaxed mb-5"
            style={{ color: "var(--t2)" }}
          >
            Adjudex brings live market prices, resolution context, and
            on-chain proof anchors into one wallet-first surface.
            USDC-centered workflows, no order book, no sportsbook -
            you trade against the other side of the pool.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="#markets-table"
              className="btn primary"
              style={{ height: 38, padding: "0 16px", fontSize: 13 }}
            >
              Open markets
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/docs"
              className="btn ghost"
              style={{ height: 38, padding: "0 16px", fontSize: 13 }}
            >
              <BookOpen className="w-3.5 h-3.5" />
              Read the terminal guide
            </Link>
            {!isConnected && (
              <ConnectButton.Custom>
                {({ openConnectModal, mounted }) => (
                  <button
                    type="button"
                    onClick={openConnectModal}
                    disabled={!mounted}
                    className="btn ghost"
                    style={{
                      height: 38,
                      padding: "0 16px",
                      fontSize: 13,
                      borderColor: "var(--accent-bright)",
                      color: "var(--accent-bright)",
                    }}
                  >
                    <Wallet2 className="w-3.5 h-3.5" />
                    Connect wallet
                  </button>
                )}
              </ConnectButton.Custom>
            )}
          </div>
        </div>
      </div>
      <ActivityTicker events={recentActivity} />
    </section>
  );
}

// Marquee-style live activity ticker. Pulls events from /api/activity
// via the parent. Falls back to a quiet "waiting for events" message
// when the feed is empty.
function ActivityTicker({ events }: { events: ActivityEvent[] }) {
  const top = events.filter((e) => e.kind === "bet" || e.kind === "ai-lp").slice(0, 10);
  if (top.length === 0) {
    return (
      <div
        className="border-t mt-3 py-2 text-[11px] font-mono tabular-nums"
        style={{
          borderColor: "var(--line-soft)",
          color: "var(--t3)",
        }}
      >
        Waiting for on-chain positions...
      </div>
    );
  }
  return (
    <div
      className="border-t mt-3 py-2 overflow-hidden"
      style={{ borderColor: "var(--line-soft)" }}
    >
      <div
        className="flex gap-6 whitespace-nowrap"
        style={{
          animation: "ticker 60s linear infinite",
          willChange: "transform",
        }}
      >
        {[...top, ...top].map((event, idx) => (
          <TickerItem key={`${event.id}-${idx}`} event={event} />
        ))}
      </div>
      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

function TickerItem({ event }: { event: ActivityEvent }) {
  const sideColor = event.side === "YES" ? "var(--green-tx)" : "#ef4444";
  const amount =
    typeof event.amountUsd === "number"
      ? `$${event.amountUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : "—";
  return (
    <span
      className="inline-flex items-center gap-2 text-[11px] font-mono tabular-nums"
      style={{ color: "var(--t2)" }}
    >
      <span style={{ color: sideColor }}>{event.side ?? "·"}</span>
      <span style={{ color: "var(--tx)" }}>{amount}</span>
      <span style={{ color: "var(--t3)" }}>
        {event.marketTitle?.slice(0, 40) ?? "market"}
      </span>
      {event.agentHandle && (
        <span style={{ color: "var(--accent-bright)" }}>
          · {event.agentHandle}
        </span>
      )}
    </span>
  );
}
