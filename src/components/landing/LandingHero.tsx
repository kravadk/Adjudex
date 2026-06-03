"use client";

import { HeroCanvas } from "./HeroCanvas";
import { MagneticButton } from "./MagneticButton";
import { PayoutSimulator } from "./PayoutSimulator";

export function LandingHero() {
  return (
    <section id="product" className="relative overflow-hidden">
      {/* Animated mesh + glows */}
      <div className="pointer-events-none absolute inset-0">
        <HeroCanvas className="absolute inset-0 h-full w-full opacity-60" />
        <div
          className="absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full"
          style={{ background: "radial-gradient(closest-side, rgba(217,255,0,0.10), transparent)" }}
        />
        <div
          className="absolute right-[-10%] top-1/3 h-[480px] w-[480px] rounded-full"
          style={{ background: "radial-gradient(closest-side, rgba(59,111,250,0.14), transparent)" }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "repeating-linear-gradient(115deg, rgba(255,255,255,0.012) 0 2px, transparent 2px 5px)",
            mixBlendMode: "overlay",
          }}
        />
      </div>

      <div className="relative mx-auto grid max-w-[1180px] items-center gap-12 px-5 pb-16 pt-32 md:grid-cols-[1.05fr_0.95fr] md:pt-40">
        <div>
          <span
            className="b-badge"
            style={{ background: "rgba(84,184,138,0.12)", color: "var(--green-tx)" }}
          >
            <span className="live-dot" style={{ margin: 0 }} />
            AI judge live · proof-anchored
          </span>

          <h1
            className="mt-5 text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[58px]"
            style={{ color: "var(--tx)" }}
          >
            Prediction markets
            <br />
            that{" "}
            <span
              style={{
                background: "linear-gradient(100deg, #d9ff00, #9be600 40%, #3b6ffa)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              settle themselves.
            </span>
          </h1>

          <p className="mt-5 max-w-[520px] text-[15.5px] leading-relaxed" style={{ color: "var(--t2)" }}>
            AI-native parimutuel markets on Arbitrum &amp; Robinhood Chain. Bet
            YES/NO in USDC against the counter-pool — an AI judge resolves with a
            2-hour challenge window and on-chain zkTLS proof. No order book. No
            house.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <MagneticButton href="/" variant="primary">
              Launch app
            </MagneticButton>
            <MagneticButton href="/how-it-works" variant="ghost" strength={0.2}>
              How it works
            </MagneticButton>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]" style={{ color: "var(--t3)" }}>
            <span>● Peer pool, not house</span>
            <span>● USDC settled</span>
            <span>● Gasless entry</span>
          </div>
        </div>

        <div className="md:pl-4">
          <PayoutSimulator />
        </div>
      </div>
    </section>
  );
}
