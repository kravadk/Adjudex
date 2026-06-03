"use client";

import { useMemo, useState } from "react";

// Interactive parimutuel payout simulator. Uses the real pool math:
//   payout = stake * (totalPool + stake) / (winningPool + stake)   (if you win)
// so visitors *feel* "peer pool, not house" — your payout is the counter-pool
// split, and bigger stakes dilute their own odds (pool impact). Demo pool only.
const SEED_YES = 6200;
const SEED_NO = 3800;

export function PayoutSimulator() {
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [stake, setStake] = useState(50);

  const m = useMemo(() => {
    const yes = SEED_YES;
    const no = SEED_NO;
    const total = yes + no;
    const impliedBefore = side === "YES" ? yes / total : no / total;
    const winning = side === "YES" ? yes : no;
    const newTotal = total + stake;
    const newWinning = winning + stake;
    const payout = (stake * newTotal) / newWinning;
    const multiplier = payout / stake;
    const newYesPct = side === "YES" ? (yes + stake) / newTotal : yes / newTotal;
    const impactPct = Math.abs(newYesPct - yes / total) * 100;
    return {
      impliedBefore: impliedBefore * 100,
      payout,
      multiplier,
      newYesPct: newYesPct * 100,
      impactPct,
    };
  }, [side, stake]);

  const yesColor = "#d9ff00";
  const noColor = "#3b6ffa";

  return (
    <div
      className="rounded-[16px] border p-5"
      style={{
        borderColor: "var(--line)",
        background: "linear-gradient(180deg, rgba(20,20,20,0.92), rgba(14,14,14,0.92))",
        boxShadow: "0 30px 80px -40px rgba(0,0,0,0.9)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="caps">Payout simulator</span>
        <span className="b-badge ok"><span className="d" />demo pool</span>
      </div>

      {/* Side toggle */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {(["YES", "NO"] as const).map((s) => {
          const on = side === s;
          const c = s === "YES" ? yesColor : noColor;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className="h-11 rounded-[10px] text-[13px] font-bold tracking-wide transition-all active:scale-[0.97]"
              style={{
                background: on ? c : "transparent",
                color: on ? (s === "YES" ? "#0a0a0a" : "#fff") : "var(--t2)",
                border: `1px solid ${on ? c : "var(--line)"}`,
              }}
            >
              Bet {s}
            </button>
          );
        })}
      </div>

      {/* Stake slider */}
      <div className="mt-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="caps">Your stake</span>
          <span className="font-mono text-[22px] font-semibold" style={{ color: "var(--tx)" }}>
            ${stake}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={500}
          step={1}
          value={stake}
          onChange={(e) => setStake(Number(e.target.value))}
          aria-label="Stake in USDC"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full"
          style={{
            background: `linear-gradient(to right, ${side === "YES" ? yesColor : noColor} 0%, ${
              side === "YES" ? yesColor : noColor
            } ${(stake / 500) * 100}%, #2a2a2a ${(stake / 500) * 100}%, #2a2a2a 100%)`,
          }}
        />
      </div>

      {/* Live readout */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="If you win" value={`$${m.payout.toFixed(0)}`} accent />
        <Stat label="Multiplier" value={`${m.multiplier.toFixed(2)}x`} />
        <Stat label="Implied" value={`${m.impliedBefore.toFixed(0)}%`} />
      </div>

      {/* Pool bar */}
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-[11px]" style={{ color: "var(--t3)" }}>
          <span>YES {m.newYesPct.toFixed(0)}%</span>
          <span>pool impact +{m.impactPct.toFixed(2)}%</span>
          <span>NO {(100 - m.newYesPct).toFixed(0)}%</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: "#2a2a2a" }}>
          <div style={{ width: `${m.newYesPct}%`, background: yesColor, transition: "width 0.25s ease" }} />
          <div style={{ width: `${100 - m.newYesPct}%`, background: noColor, transition: "width 0.25s ease" }} />
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
          Winners split the entire pool pro-rata — your payout comes from the
          counter-pool, never a house. Bigger stakes move the line.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-[10px] border p-2.5" style={{ borderColor: "var(--line-soft)", background: "#161616" }}>
      <div className="caps">{label}</div>
      <div
        className="mt-1 font-mono text-[16px] font-semibold tabular-nums"
        style={{ color: accent ? "var(--brand-primary)" : "var(--tx)" }}
      >
        {value}
      </div>
    </div>
  );
}
