import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Coins,
  Droplet,
  Hammer,
  Layers,
  Wallet2,
} from "lucide-react";
import { FiatOnrampButton } from "@/components/dashboard/fiat-onramp";

// /how-it-works - 4-step onboarding guide. Lives outside /docs (which
// is the live status + proof panel) so a brand-new visitor can land
// on the first concrete how-to page without scanning JSON.
export const metadata = {
  title: "How Adjudex works",
  description:
    "Adjudex is a parimutuel prediction-market terminal. Connect wallet, mint test USDC, open a position, claim the winning side of the pool.",
};

export default function HowItWorksPage() {
  return (
    <div className="px-[22px] py-5 pb-7 max-w-[1080px] mx-auto">
      <div className="mb-6">
        <div
          className="text-[10.5px] font-mono uppercase tracking-[0.14em] mb-2"
          style={{ color: "var(--accent-bright)" }}
        >
          Onboarding · 4 steps
        </div>
        <h1
          className="text-[28px] font-semibold tracking-[-0.02em]"
          style={{ color: "var(--tx)" }}
        >
          How Adjudex works
        </h1>
        <p
          className="text-[13.5px] max-w-prose leading-relaxed mt-2"
          style={{ color: "var(--t2)" }}
        >
          Adjudex is a parimutuel prediction-market terminal. Every market
          is a peer pool: USDC staked on YES versus USDC staked on NO.
          Winners share the entire pool pro-rata. No order book, no house.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <Step
          n={1}
          icon={<Wallet2 className="w-4 h-4" />}
          title="Connect a wallet"
          body="Click Connect in the header. Any wagmi-compatible wallet works (MetaMask, Rainbow, Coinbase Wallet, WalletConnect). Switch to Arbitrum Sepolia."
          ctaHref="/"
          ctaLabel="Open the dashboard"
        />
        <Step
          n={2}
          icon={<Droplet className="w-4 h-4" />}
          title="Mint test USDC"
          body="On testnet there is a one-click faucet button in the header. It mints 1,000 test USDC to your wallet via TestUSDC.mint(). One approve per pool lets you place unlimited positions afterwards. On mainnet, buy USDC with a card via MoonPay or Transak — the on-ramp lands USDC directly in your wallet."
          extra={<FiatOnrampButton variant="ghost" />}
        />
        <Step
          n={3}
          icon={<Coins className="w-4 h-4" />}
          title="Open a position"
          body="Pick a market. Read pool depth and the reprice feed. Stake USDC on YES or NO. Your stake's share of the new pool is the only slippage that matters in parimutuel - no order book, no spread."
          ctaHref="/#markets-table"
          ctaLabel="Browse markets"
        />
        <Step
          n={4}
          icon={<Hammer className="w-4 h-4" />}
          title="Resolve and claim"
          body="When the market closes, the AI Judge proposes an outcome. Anyone can challenge inside the 2-hour window. After the window closes, finalize unlocks claims and winners withdraw their share of the pool."
          ctaHref="/portfolio"
          ctaLabel="View portfolio"
        />
      </div>

      <section className="panel mb-6" style={{ borderColor: "var(--line)" }}>
        <div className="panel-head">
          <span className="panel-title inline-flex items-center gap-2">
            <Layers className="w-3.5 h-3.5" style={{ color: "var(--accent-bright)" }} />
            What is a parimutuel pool?
          </span>
        </div>
        <div
          className="panel-body text-[12.5px] leading-relaxed space-y-3"
          style={{ color: "var(--t2)" }}
        >
          <p>
            A parimutuel pool collects every stake on every side. When the
            market resolves, the pool is divided pro-rata to the stakes on
            the winning side. There is no counterparty risk to a &quot;house&quot;
            because there is no house - winners are paid out of losers&apos;
            stakes.
          </p>
          <p>
            Implied probability is the YES side&apos;s share of the total pool.
            Your position changes that share, so opening a large position
            on a thin pool moves the price against you.
          </p>
        </div>
      </section>

      <section className="panel mb-6" style={{ borderColor: "var(--line)" }}>
        <div className="panel-head">
          <span className="panel-title inline-flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--green-tx)" }} />
            Resolution lifecycle
          </span>
        </div>
        <ol
          className="panel-body text-[12.5px] leading-relaxed space-y-2 list-decimal list-inside"
          style={{ color: "var(--t2)" }}
        >
          <li>
            Off-chain AI judge worker signs the verdict with EIP-191
            (key in Phala TEE or local).
          </li>
          <li>
            On-chain <code>propose(...)</code> stores the signed verdict.
            Claims stay locked.
          </li>
          <li>
            Two-hour challenge window opens. Anyone can call
            <code> challenge(marketId)</code>. A challenge flips status to
            Disputed and blocks the optimistic finalize path.
          </li>
          <li>
            After the window closes without a challenge,
            <code> finalize(marketId)</code> runs
            <code> pool.resolve(outcome)</code> and unlocks claims.
          </li>
          <li>
            Disputed proposals require <code>overrideAndFinalize</code> from
            the verifier owner (multisig in production).
          </li>
        </ol>
      </section>

      <div className="flex items-center gap-2">
        <Link href="/#markets-table" className="btn primary">
          Open markets <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <Link href="/docs" className="btn ghost">
          Live status &amp; proof
        </Link>
      </div>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  body,
  ctaHref,
  ctaLabel,
  extra,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="panel" style={{ padding: 18, borderColor: "var(--line)" }}>
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-grid place-items-center w-7 h-7 rounded-[8px]"
          style={{
            background: "rgba(40,160,240,0.08)",
            color: "var(--accent-bright)",
            border: "1px solid rgba(40,160,240,0.25)",
          }}
        >
          {icon}
        </span>
        <div
          className="text-[10.5px] font-mono uppercase tracking-[0.08em]"
          style={{ color: "var(--t3)" }}
        >
          Step {n}
        </div>
      </div>
      <h2
        className="text-[15px] font-semibold tracking-tight mb-1.5"
        style={{ color: "var(--tx)" }}
      >
        {title}
      </h2>
      <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--t2)" }}>
        {body}
      </p>
      {ctaHref && ctaLabel && (
        <Link
          href={ctaHref}
          className="mt-3 inline-flex items-center gap-1 text-[12px] hover:underline"
          style={{ color: "var(--accent-bright)" }}
        >
          {ctaLabel} <ArrowRight className="w-3 h-3" />
        </Link>
      )}
      {extra && <div className="mt-3">{extra}</div>}
    </div>
  );
}
