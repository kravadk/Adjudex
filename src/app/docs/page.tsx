import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight } from "lucide-react";
import { DocsStatusClient } from "@/components/app/DocsStatusClient";

const TOC: { id: string; label: string }[] = [
  { id: "guide-what", label: "What is a parimutuel market" },
  { id: "guide-judge", label: "How resolution works" },
  { id: "guide-checklist", label: "Pre-position checklist" },
  { id: "guide-mistakes", label: "Common mistakes" },
  { id: "guide-status", label: "Live system status" },
  { id: "guide-proof", label: "Source-of-truth proof" },
];

export default function DocsPage() {
  return (
    <div className="px-[22px] py-5 pb-7">
      <div className="mb-[18px]">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]" style={{ color: "var(--tx)" }}>
          Terminal guide
        </h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed" style={{ color: "var(--t2)" }}>
          A practical guide to Adjudex&apos;s parimutuel terminal: how to read pool depth,
          live reprice triggers, AI-judged resolution, and the on-chain proof surface
          before opening a position.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-[14px]">
        <div className="grid gap-[14px]">
          <GuideSection id="guide-what" title="What is a parimutuel market">
            <p>
              Every market on Adjudex is a parimutuel pool: USDC staked on YES and
              USDC staked on NO. When the market resolves, winners share the
              entire pool pro-rata. There is no order book, no resting orders,
              no spread, and no house position. You always trade against the
              other side of the pool.
            </p>
            <p>
              The implied probability is the YES side&apos;s share of the total pool.
              Your &quot;execution&quot; is just adding stake to one side — it moves the
              implied probability and dilutes everyone&apos;s pro-rata share.
            </p>
          </GuideSection>

          <GuideSection id="guide-judge" title="How resolution works">
            <p>
              Soft markets resolve through an <strong>optimistic AI Judge</strong>:
            </p>
            <ol className="space-y-1.5 mt-2">
              <li>1. Off-chain judge worker signs a verdict with EIP-191.</li>
              <li>2. <code>propose(...)</code> stores the verdict on chain.
                <em> Claims are still locked.</em></li>
              <li>3. Anyone can <code>challenge(marketId)</code> within a 2-hour
                window. A challenge flips status to Disputed.</li>
              <li>4. After the window closes, <code>finalize(marketId)</code> runs
                <code>pool.resolve(outcome)</code> and unlocks claims.</li>
              <li>5. Disputed proposals require <code>overrideAndFinalize</code>
                from the owner.</li>
            </ol>
            <p>
              Hard markets use Chainlink-shaped price feeds via{" "}
              <code>PriceOracle</code>. Reclaim zkTLS proofs (if attached) are
              pinned to IPFS and anchored on-chain through{" "}
              <code>ProofAnchor</code>.
            </p>
          </GuideSection>

          <GuideSection id="guide-checklist" title="Pre-position checklist">
            <Checklist
              items={[
                "You understand the category and the resolution method.",
                "Pool depth is non-trivial — your stake will not dominate the pool.",
                "Resolution timing is comfortable — at least 30 minutes to lock.",
                "You are connected to the right chain with enough USDC.",
                "You read the latest reprice triggers and understand why the price is where it is.",
              ]}
            />
          </GuideSection>

          <GuideSection id="guide-mistakes" title="Common mistakes">
            <Mistake
              title="Treating a market like a fan vote"
              body="A high-conviction pick can still be a bad position if the price is too high or pool depth is too shallow. Conviction is not edge."
            />
            <Mistake
              title="Ignoring reprice triggers"
              body="When you see a sudden jump in implied probability, the reprice feed tells you why — a judge proposal, a challenge, or a large position. Read it before reacting."
            />
            <Mistake
              title="Position size dominating the pool"
              body="If your stake is more than ~10% of the pool, your own position moves the price against you. Check the dilution preview in the pool depth panel."
            />
            <Mistake
              title="Acting in the last 60 seconds before lock"
              body="Late-window positions face the highest reprice risk and the least time to react. Plan ahead."
            />
          </GuideSection>

          <div id="guide-status" />
          <DocsStatusClient />
          <section id="guide-proof" className="panel" style={{ scrollMarginTop: 80 }}>
            <div className="panel-head">
              <span className="panel-title">Source of truth</span>
            </div>
            <div className="panel-body">
              <pre
                className="overflow-auto rounded-[8px] p-4 text-[12px] leading-relaxed"
                style={{ background: "#211f1e", border: "1px solid #34312e", color: "var(--t2)" }}
              >{`Wallet -> MarketFactory / ParimutuelPool
        -> Indexer
        -> Postgres
        -> Fastify API
        -> Next UI

Source proof -> Verifier -> Pool resolution
AI agents -> Wallet tx -> Pool events`}</pre>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <ProofCard title="Contracts" body="Markets are created through MarketFactory and settle in ParimutuelPool contracts." />
                <ProofCard title="Indexer" body="Pool state plus BetPlaced, MarketResolved, Claimed, Refunded, and verifier logs are ingested into Postgres before market/activity/timeline data is shown." />
                <ProofCard title="API" body="Backend routes return explicit errors when DB/RPC/indexer configuration is missing." />
                <ProofCard title="UI" body="The product fails closed instead of rendering generated market, portfolio, or activity data." />
                <ProofCard title="Creator studio" body="Market drafts are validated by the backend for source URL, binary question, future deadline, fee range, oracle path, and duplicate risk before deployment." />
                <ProofCard title="Importer" body="Public event sources become normalized candidates, then validated specs, then confirmed MarketFactory deployments. No external liquidity or odds are copied." />
                <ProofCard title="SIWE persistence" body="Settings, watchlist, and notifications are wallet-scoped backend records. There is no browser-storage fallback." />
                <ProofCard title="Agents" body="AI agent profiles and leaderboards come from backend/indexed records with ERC-8004 addresses, reputation, moves, and proof links." />
                <ProofCard title="Quotes" body="Bet previews are backend/contract-derived from current pool reads, including price, shares, payout, and pool impact." />
                <ProofCard title="Recovery" body="POST /api/sync/transaction verifies RPC receipts, chain identity, confirmation depth, known events, and reconciles DB records when possible." />
                <ProofCard title="Portfolio" body="Claimable payout is derived from indexed final pool stats and winning side; open P&L uses normalized current probability." />
                <ProofCard title="Resolution" body="Source evidence is bound to the market, then submitted through the configured verifier path before on-chain final payout state changes." />
              </div>
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-[14px]">
          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">On this page</span>
            </div>
            <ul className="px-4 py-3 space-y-1.5">
              {TOC.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`#${t.id}`}
                    className="text-[12.5px] hover:underline inline-flex items-center gap-1.5"
                    style={{ color: "var(--t2)" }}
                  >
                    <ChevronRight className="w-3 h-3" style={{ color: "var(--t4)" }} />
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">Use this page to decide</span>
            </div>
            <div className="px-4 py-3 space-y-3 text-[12px] leading-relaxed">
              <div>
                <div
                  className="text-[10.5px] font-mono uppercase tracking-[0.08em] mb-1.5"
                  style={{ color: "var(--t3)" }}
                >
                  Good fit if
                </div>
                <ul className="space-y-1" style={{ color: "var(--t2)" }}>
                  <li>You want to verify how resolution actually works on chain.</li>
                  <li>You prefer wallet-first, USDC-centered workflows.</li>
                  <li>You want to read pool depth and reprice triggers before acting.</li>
                </ul>
              </div>
              <div>
                <div
                  className="text-[10.5px] font-mono uppercase tracking-[0.08em] mb-1.5"
                  style={{ color: "var(--t3)" }}
                >
                  Next steps
                </div>
                <ol className="space-y-1" style={{ color: "var(--t2)" }}>
                  <li>1. Read &quot;How resolution works&quot; below.</li>
                  <li>2. Check &quot;Pre-position checklist&quot;.</li>
                  <li>
                    3.{" "}
                    <Link
                      href="/#markets-table"
                      className="hover:underline inline-flex items-center gap-1"
                      style={{ color: "var(--accent-bright)" }}
                    >
                      Open markets <ArrowRight className="w-3 h-3" />
                    </Link>
                  </li>
                </ol>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">Useful links</span>
            </div>
            <div className="panel-body flex flex-col gap-2">
              <DocLink href="/api/status" label="Backend status (JSON)" />
              <DocLink href="/create" label="Create / importer" />
              <DocLink href="/resolve" label="Resolver" />
              <DocLink href="/portfolio" label="Portfolio" />
              <DocLink href="/agents" label="Agent ecosystem" />
              <DocLink href="/leaderboard" label="Leaderboard" />
              <DocLink href="/liquidity" label="Liquidity incentives" />
            </div>
          </section>

          <section
            className="panel"
            style={{ borderColor: "rgba(245,158,11,0.4)" }}
          >
            <div className="panel-head">
              <span
                className="panel-title inline-flex items-center gap-1.5"
                style={{ color: "var(--amber-tx)" }}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Common mistakes
              </span>
            </div>
            <ul
              className="px-4 py-3 space-y-1.5 text-[12px] leading-relaxed"
              style={{ color: "var(--t2)" }}
            >
              <li>Treating a market like a fan vote.</li>
              <li>Ignoring reprice triggers.</li>
              <li>Position size dominating the pool.</li>
              <li>Acting in the last 60 seconds before lock.</li>
            </ul>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">Product rule</span>
            </div>
            <div className="panel-body text-[12.5px] leading-relaxed" style={{ color: "var(--t2)" }}>
              User-facing markets, balances, positions, activity, timelines, resolution,
              settings, watchlist, and notifications must come from contracts, indexer,
              Postgres/API, SIWE-authenticated backend persistence, or confirmed chain reads.
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function GuideSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="panel"
      style={{ scrollMarginTop: 80 }}
    >
      <div className="panel-head">
        <span className="panel-title">{title}</span>
      </div>
      <div
        className="panel-body text-[12.5px] leading-relaxed space-y-3"
        style={{ color: "var(--t2)" }}
      >
        {children}
      </div>
    </section>
  );
}

function Checklist({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <span
            className="inline-grid place-items-center w-4 h-4 rounded-full flex-shrink-0 mt-[3px]"
            style={{
              background: "rgba(95,194,149,0.15)",
              color: "var(--green-tx)",
            }}
          >
            <CheckCircle2 className="w-3 h-3" />
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Mistake({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-[8px] px-3 py-2.5 mb-2"
      style={{
        background: "rgba(245,158,11,0.06)",
        border: "1px solid rgba(245,158,11,0.20)",
      }}
    >
      <div
        className="text-[12.5px] font-semibold mb-0.5"
        style={{ color: "var(--amber-tx)" }}
      >
        {title}
      </div>
      <div className="text-[12px]" style={{ color: "var(--t2)" }}>
        {body}
      </div>
    </div>
  );
}

function ProofCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[8px] p-3" style={{ background: "var(--card-inner)", border: "1px solid var(--line)" }}>
      <div className="text-[13px] font-semibold" style={{ color: "var(--tx)" }}>
        {title}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--t2)" }}>
        {body}
      </p>
    </div>
  );
}

function DocLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="btn ghost justify-start">
      {label}
    </Link>
  );
}
