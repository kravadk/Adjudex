"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

type Step = {
  n: string;
  title: string;
  body: string;
  yes: number; // pool YES share for the diagram
  state: string;
  stateTone: "open" | "resolving" | "final";
};

const STEPS: Step[] = [
  {
    n: "01",
    title: "Pick a market",
    body: "Crypto, esports, stocks/RWAs, sports — binary YES/NO markets, many auto-ingested and GMX-informed.",
    yes: 50,
    state: "Open",
    stateTone: "open",
  },
  {
    n: "02",
    title: "Bet against the pool",
    body: "Stake USDC on YES or NO. There's no order book and no house — you're matched against the counter-pool.",
    yes: 64,
    state: "Open · taking bets",
    stateTone: "open",
  },
  {
    n: "03",
    title: "AI judge resolves",
    body: "An AI judge proposes the outcome with on-chain zkTLS evidence, then a 2-hour challenge window lets anyone dispute.",
    yes: 64,
    state: "Resolving · 2h challenge",
    stateTone: "resolving",
  },
  {
    n: "04",
    title: "Finalize & claim",
    body: "After the window, anyone finalizes and winners claim their pro-rata share of the whole pool. Proof stays on-chain.",
    yes: 100,
    state: "Finalized · YES",
    stateTone: "final",
  },
];

export function HowItWorksInteractive() {
  const [active, setActive] = useState(0);
  const paused = useRef(false);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = window.setInterval(() => {
      if (!paused.current) setActive((a) => (a + 1) % STEPS.length);
    }, 3800);
    return () => window.clearInterval(id);
  }, []);

  const step = STEPS[active];
  const toneColor =
    step.stateTone === "final" ? "#d9ff00" : step.stateTone === "resolving" ? "#e9a23b" : "#5fc295";

  return (
    <section
      id="how-it-works"
      className="mx-auto max-w-[1100px] px-5 py-20"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
    >
      <div className="mb-10 text-center">
        <div className="caps mb-2">How it works</div>
        <h2 className="text-[30px] font-semibold tracking-[-0.02em] sm:text-[40px]" style={{ color: "var(--tx)" }}>
          From pick to payout, on-chain.
        </h2>
      </div>

      <div className="grid items-start gap-8 md:grid-cols-2">
        {/* Steps */}
        <ol className="flex flex-col gap-2.5">
          {STEPS.map((s, i) => {
            const on = i === active;
            return (
              <li key={s.n}>
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  className="flex w-full items-start gap-4 rounded-[14px] border p-4 text-left transition-all"
                  style={{
                    borderColor: on ? "var(--accent)" : "var(--line)",
                    background: on ? "rgba(59,111,250,0.06)" : "var(--card)",
                  }}
                >
                  <span
                    className="font-mono text-[15px] font-semibold tabular-nums"
                    style={{ color: on ? "var(--brand-primary)" : "var(--t4)" }}
                  >
                    {s.n}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold" style={{ color: "var(--tx)" }}>
                      {s.title}
                    </span>
                    <span
                      className="mt-1 block text-[13px] leading-relaxed transition-all"
                      style={{ color: "var(--t3)", maxHeight: on ? 80 : 0, opacity: on ? 1 : 0, overflow: "hidden" }}
                    >
                      {s.body}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Animated pool diagram */}
        <div
          className="sticky top-24 rounded-[16px] border p-6"
          style={{ borderColor: "var(--line)", background: "var(--card)" }}
        >
          <div className="flex items-center justify-between">
            <span className="caps">Pool state</span>
            <span className="b-badge" style={{ background: "rgba(255,255,255,0.05)", color: toneColor }}>
              <span className="d" style={{ background: toneColor }} />
              {step.state}
            </span>
          </div>

          <div className="mt-6 flex items-end gap-4" style={{ height: 180 }}>
            <PoolColumn label="YES" pct={step.yes} color="#d9ff00" win={step.stateTone === "final"} />
            <PoolColumn label="NO" pct={100 - step.yes} color="#3b6ffa" win={false} dim={step.stateTone === "final"} />
          </div>

          <div className="mt-5 flex items-center justify-between text-[12px]" style={{ color: "var(--t3)" }}>
            <span>Total pool</span>
            <span className="font-mono tabular-nums" style={{ color: "var(--tx)" }}>
              ${(10000 + active * 1500).toLocaleString("en-US")}
            </span>
          </div>
          {step.stateTone === "final" && (
            <div
              className="mt-3 flex items-center gap-2 rounded-[10px] border p-2.5 text-[12px]"
              style={{ borderColor: "rgba(217,255,0,0.3)", background: "rgba(217,255,0,0.05)", color: "var(--brand-primary)" }}
            >
              <ArrowRight className="h-3.5 w-3.5" />
              Winners split the full pool · proof anchored on-chain
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PoolColumn({
  label,
  pct,
  color,
  win,
  dim = false,
}: {
  label: string;
  pct: number;
  color: string;
  win: boolean;
  dim?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-end" style={{ height: "100%" }}>
      <span className="mb-2 font-mono text-[13px] font-semibold tabular-nums" style={{ color }}>
        {Math.round(pct)}%
      </span>
      <div
        className="w-full rounded-t-[8px]"
        style={{
          height: `${Math.max(4, pct)}%`,
          background: color,
          opacity: dim ? 0.25 : 1,
          boxShadow: win ? `0 0 30px -4px ${color}` : "none",
          transition: "height 0.5s cubic-bezier(0.22,0.61,0.36,1), opacity 0.4s, box-shadow 0.4s",
        }}
      />
      <span className="mt-2 caps">{label}</span>
    </div>
  );
}
