import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export const metadata = {
  title: "Changelog - Adjudex",
  description:
    "What shipped on Adjudex: observability, multisig, audit prep, fee mechanism, geo-block, on-ramps, scale infrastructure, and more.",
};

type Entry = {
  date: string;
  version: string;
  stage: string;
  title: string;
  body: string;
  links?: { label: string; href: string }[];
};

const ENTRIES: Entry[] = [
  {
    date: "2026-06-02",
    version: "0.7.0",
    stage: "S3.E",
    title: "Agent ecosystem",
    body:
      "Adjudex now exposes an agent ecosystem surface at /agents, a backend summary endpoint, and a confirmed-transaction registration path. Agents are recorded only after ReputationOracle emits AgentRegistered and the backend reconciles the receipt.",
  },
  {
    date: "2026-06-02",
    version: "0.6.0",
    stage: "S3.B",
    title: "Liquidity incentives",
    body:
      "Adjudex now has backend-configured liquidity incentive programs. Eligibility is computed from indexed positions, while rebate payouts appear only after a confirmed transaction is recorded by the backend.",
  },
  {
    date: "2026-06-02",
    version: "0.5.0",
    stage: "S3.D",
    title: "Mobile PWA shell",
    body:
      "Adjudex now ships an installable web app manifest, generated mobile icons, viewport metadata, service-worker registration, and an offline shell. The worker caches only static shell assets and never caches API, wallet, market, portfolio, balance, or transaction data.",
  },
  {
    date: "2026-06-02",
    version: "0.4.1",
    stage: "S3.A",
    title: "Retention analytics",
    body:
      "Authenticated product events now write to Postgres and power an admin-only D1, D7, and D30 cohort view. Metrics come from backend activity rows, not browser storage or generated client state.",
  },
  {
    date: "2026-06-02",
    version: "0.4.0",
    stage: "S3.C",
    title: "Scale infrastructure path",
    body:
      "The API can now use Redis-backed rate limits for multi-instance deployments and a short read-through Redis cache for public market lists. Wallet-scoped portfolio, settings, notifications, balances, and transaction state remain API/indexer-backed only.",
  },
  {
    date: "2026-06-01",
    version: "0.3.0",
    stage: "S2.F",
    title: "Changelog page",
    body:
      "Public roadmap progress is now visible at /changelog. Every shipped milestone is tied back to the maturity-roadmap stage so users can see how the product is moving toward scaled operations.",
  },
  {
    date: "2026-06-01",
    version: "0.3.0",
    stage: "S2.E",
    title: "On-call rotation and alert routing",
    body:
      "SLA target 99.5% backend uptime and less than 30s indexer lag p95. Telegram and email alert routing via Alertmanager. Severity classes P0-P3 with response-time targets. Incident-response template ready.",
    links: [
      {
        label: "docs/ONCALL.md",
        href: "https://github.com/adjudex/repo/blob/main/docs/ONCALL.md",
      },
    ],
  },
  {
    date: "2026-06-01",
    version: "0.3.0",
    stage: "S2.D",
    title: "Fiat on-ramp",
    body:
      "MoonPay and Transak widgets are wired into onboarding. Users can buy USDC on Arbitrum with a card and funds land directly in their wallet, with no custody by Adjudex.",
  },
  {
    date: "2026-06-01",
    version: "0.3.0",
    stage: "S2.C",
    title: "Geo-block and legal pages",
    body:
      "Backend rejects requests from US, CU, IR, KP, SY, RU, and BY with HTTP 451 from Cloudflare country headers. Terms of Service and Privacy Policy drafts are published at /legal/terms and /legal/privacy.",
    links: [
      { label: "Terms", href: "/legal/terms" },
      { label: "Privacy", href: "/legal/privacy" },
    ],
  },
  {
    date: "2026-06-01",
    version: "0.3.0",
    stage: "S2.B",
    title: "Mainnet readiness scaffolding",
    body:
      "Arbitrum One chain config is resolved by the frontend. Deployment template deployments/42161.example.json documents the shape, and docs/MAINNET.md defines the audit-gated cutover playbook.",
  },
  {
    date: "2026-06-01",
    version: "0.2.0",
    stage: "S1.G",
    title: "Notification worker and error boundaries",
    body:
      "Backend worker drains notification_events and dispatches via configured channel. Frontend error boundaries capture runtime errors and forward to Sentry when configured.",
  },
  {
    date: "2026-06-01",
    version: "0.2.0",
    stage: "S1.F",
    title: "IPFS production guard",
    body:
      "IPFS_PROVIDER=stub is rejected in NODE_ENV=production. Real production uses Pinata or web3.storage.",
  },
  {
    date: "2026-06-01",
    version: "0.2.0",
    stage: "S1.E",
    title: "1.5% platform fee",
    body:
      "ParimutuelPool.claim() takes a 150 bps fee from gross winnings and routes it to feeRecipient. refundAfterGrace is fee-free. New FeeCollected event supports indexer aggregation.",
  },
  {
    date: "2026-06-01",
    version: "0.2.0",
    stage: "S1.D",
    title: "Security disclosure policy and audit prep",
    body:
      "SECURITY.md documents disclosure handling. audits/README.md lists audit scope, target firms, and contract risk areas. Bug bounty activation plan is ready for Immunefi.",
  },
  {
    date: "2026-06-01",
    version: "0.2.0",
    stage: "S1.C",
    title: "Multisig governance",
    body:
      "Ownership-transfer tooling supports DRY_RUN and per-contract reasons. docs/GOVERNANCE.md documents threshold roadmap, Safe daily operations, and lost-key recovery.",
  },
  {
    date: "2026-06-01",
    version: "0.2.0",
    stage: "S1.B",
    title: "Production env validator",
    body:
      "pnpm env:check --profile=production rejects local-only resolver and storage providers. It requires Sentry DSN, Pinata JWT, log level, and Phala remote URL. Doppler and Infisical adoption is documented in docs/SECRETS.md.",
  },
  {
    date: "2026-06-01",
    version: "0.2.0",
    stage: "S1.A",
    title: "Observability stack",
    body:
      "Pino structured logger with redact list. Sentry SDK is environment-gated. Prometheus /metrics exposes request rate, errors, duration, and uptime. Grafana dashboard JSON is ready to import.",
  },
];

export default function ChangelogPage() {
  return (
    <div className="px-[22px] py-7 max-w-[820px] mx-auto">
      <div
        className="text-[10.5px] font-mono uppercase tracking-[0.14em] mb-2"
        style={{ color: "var(--accent-bright)" }}
      >
        Changelog - Stage by stage
      </div>
      <h1
        className="text-[28px] font-semibold tracking-[-0.02em] mb-2"
        style={{ color: "var(--tx)" }}
      >
        What shipped on Adjudex
      </h1>
      <p
        className="text-[13.5px] leading-relaxed mb-6 max-w-prose"
        style={{ color: "var(--t2)" }}
      >
        Every milestone here maps to a stage in our maturity roadmap (Level 7
        Product Hardening to Level 12 Scale Business). Stage tags like{" "}
        <span className="font-mono">S1.A</span> link to the corresponding
        workstream.
      </p>

      <ol className="space-y-5">
        {ENTRIES.map((entry, i) => (
          <li
            key={`${entry.date}-${entry.stage}-${i}`}
            className="panel"
            style={{ padding: 18, borderColor: "var(--line)" }}
          >
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span
                className="inline-flex items-center gap-1.5 text-[10.5px] font-mono uppercase tracking-[0.08em] px-2 py-0.5 rounded-full"
                style={{
                  background: "rgba(40,160,240,0.10)",
                  color: "var(--accent-bright)",
                  border: "1px solid rgba(40,160,240,0.25)",
                }}
              >
                <Sparkles className="w-3 h-3" />
                {entry.stage}
              </span>
              <span
                className="text-[10.5px] font-mono"
                style={{ color: "var(--t3)" }}
              >
                {entry.date} - v{entry.version}
              </span>
            </div>
            <h2
              className="text-[16px] font-semibold tracking-tight mb-2"
              style={{ color: "var(--tx)" }}
            >
              {entry.title}
            </h2>
            <p
              className="text-[12.5px] leading-relaxed"
              style={{ color: "var(--t2)" }}
            >
              {entry.body}
            </p>
            {entry.links && entry.links.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {entry.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-[11.5px] inline-flex items-center gap-1 underline"
                    style={{ color: "var(--accent-bright)" }}
                  >
                    {link.label} <ArrowRight className="w-3 h-3" />
                  </Link>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
