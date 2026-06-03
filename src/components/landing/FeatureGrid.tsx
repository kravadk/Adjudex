import { Users, Scale, ShieldCheck, LineChart, Zap, Layers } from "lucide-react";
import { Reveal } from "./Reveal";
import { TiltCard } from "./TiltCard";

const FEATURES = [
  {
    Icon: Users,
    title: "Peer pool, not house",
    body: "Parimutuel pools: winners split the entire pool pro-rata. Your payout is the counter-pool — never a sportsbook taking the other side.",
  },
  {
    Icon: Scale,
    title: "AI-judged resolution",
    body: "An AI judge proposes the outcome, then a 2-hour challenge window lets anyone dispute before it finalizes on-chain.",
  },
  {
    Icon: ShieldCheck,
    title: "zkTLS proof anchors",
    body: "Resolution evidence is pinned to IPFS and anchored on-chain via ProofAnchor — every settled market is auditable to the byte.",
  },
  {
    Icon: LineChart,
    title: "GMX market intelligence",
    body: "Live GMX liquidity, open interest and funding power signal cards and auto-generated crypto markets — and ground AI verdicts.",
  },
  {
    Icon: Zap,
    title: "Gasless entry",
    body: "ZeroDev smart accounts let new users place their first bet without holding native ETH for gas.",
  },
  {
    Icon: Layers,
    title: "Multi-chain",
    body: "Live on Arbitrum Sepolia and deploy-ready on Robinhood Chain — RWA & tokenized-stock markets included.",
  },
];

export function FeatureGrid() {
  return (
    <section className="mx-auto max-w-[1180px] px-5 py-20">
      <Reveal className="mb-12 text-center">
        <div className="caps mb-2">Why Adjudex</div>
        <h2 className="text-[30px] font-semibold tracking-[-0.02em] sm:text-[40px]" style={{ color: "var(--tx)" }}>
          A self-settling market, end to end.
        </h2>
      </Reveal>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ Icon, title, body }, i) => (
          <Reveal key={title} delayMs={(i % 3) * 80}>
            <TiltCard className="h-full rounded-[16px] border p-5">
              <div className="grid h-11 w-11 place-items-center rounded-[12px]" style={{ background: "rgba(59,111,250,0.12)", color: "var(--accent-bright)" }}>
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-[16px] font-semibold" style={{ color: "var(--tx)" }}>
                {title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: "var(--t3)" }}>
                {body}
              </p>
            </TiltCard>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
