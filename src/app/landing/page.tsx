import type { Metadata } from "next";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingHero } from "@/components/landing/LandingHero";
import { MarketsMarquee } from "@/components/landing/MarketsMarquee";
import { LogoStrip } from "@/components/landing/LogoStrip";
import { HowItWorksInteractive } from "@/components/landing/HowItWorksInteractive";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { StatsBand } from "@/components/landing/StatsBand";
import { EcosystemGrid } from "@/components/landing/EcosystemGrid";
import { BuildersBand } from "@/components/landing/BuildersBand";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Adjudex — Prediction markets that settle themselves",
  description:
    "AI-native parimutuel prediction markets on Arbitrum & Robinhood Chain. Bet YES/NO in USDC against the counter-pool; an AI judge resolves with a 2-hour challenge window and on-chain zkTLS proof.",
  alternates: { canonical: "/landing" },
  openGraph: {
    title: "Adjudex — Prediction markets that settle themselves",
    description:
      "Parimutuel markets, AI-judged resolution, on-chain proof. Peer pool, not house.",
    type: "website",
  },
};

export default function LandingPage() {
  return (
    <div style={{ background: "var(--shell-bg)", color: "var(--tx)", minHeight: "100vh" }}>
      <LandingNav />
      <main>
        <LandingHero />
        <MarketsMarquee />
        <LogoStrip />
        <HowItWorksInteractive />
        <FeatureGrid />
        <StatsBand />
        <EcosystemGrid />
        <BuildersBand />
        <FinalCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
