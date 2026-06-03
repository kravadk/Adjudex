import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Reveal } from "./Reveal";
import { TiltCard } from "./TiltCard";

const ITEMS = [
  { name: "GMX", body: "Live perp-market intelligence: liquidity, OI, funding, OHLCV — drives signal cards and auto-generated markets." },
  { name: "Dune", body: "Reproducible on-chain analytics and a public proof-of-traction dashboard." },
  { name: "ZeroDev", body: "Smart-account + paymaster gasless onboarding so the first bet needs no ETH." },
  { name: "Fhenix", body: "FHE sealed-market prototype: encrypted positions revealed only after the deadline." },
  { name: "OpenZeppelin", body: "Ownable2Step, Pausable, SafeERC20 and ReentrancyGuard across every contract." },
  { name: "AWS", body: "App Runner blueprints + CloudWatch alarms fed by app-emitted ops metrics." },
];

export function EcosystemGrid() {
  return (
    <section id="ecosystem" className="mx-auto max-w-[1180px] px-5 py-20">
      <Reveal className="mb-12 text-center">
        <div className="caps mb-2">Ecosystem</div>
        <h2 className="text-[30px] font-semibold tracking-[-0.02em] sm:text-[40px]" style={{ color: "var(--tx)" }}>
          Wired into the best of Arbitrum.
        </h2>
        <p className="mx-auto mt-3 max-w-[560px] text-[14px]" style={{ color: "var(--t3)" }}>
          Every integration is live in the app, not a logo on a slide.
        </p>
      </Reveal>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map((it, i) => (
          <Reveal key={it.name} delayMs={(i % 3) * 80}>
            <Link href="/integrations" className="block h-full">
              <TiltCard className="h-full rounded-[16px] p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[16px] font-semibold" style={{ color: "var(--tx)" }}>
                    {it.name}
                  </span>
                  <ArrowUpRight className="h-4 w-4" style={{ color: "var(--t3)" }} />
                </div>
                <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--t3)" }}>
                  {it.body}
                </p>
              </TiltCard>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
