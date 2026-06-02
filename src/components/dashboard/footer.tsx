import Link from "next/link";
import { ArrowRight, BookOpen, ExternalLink } from "lucide-react";

// Adjudex app footer - clustered nav (Core / Terminal / Resolution) +
// dual-CTA ("Open markets" / "Read the terminal guide") + related-reading.
export function Footer() {
  return (
    <footer
      className="mt-10 border-t"
      style={{ borderColor: "var(--line-soft)", background: "var(--win-bg)" }}
    >
      <div className="max-w-[1280px] mx-auto px-[22px] py-8 grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr_1fr] gap-6">
        <div>
          <div
            className="text-[14px] font-semibold tracking-tight mb-2"
            style={{ color: "var(--tx)" }}
          >
            Adjudex
          </div>
          <p
            className="text-[12.5px] leading-relaxed mb-3"
            style={{ color: "var(--t2)" }}
          >
            Wallet-first prediction markets. Peer pool, not house.
            AI-judged resolution with on-chain proof anchors.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/#markets-table"
              className="btn primary"
              style={{ height: 32, padding: "0 12px", fontSize: 12 }}
            >
              Open markets
              <ArrowRight className="w-3 h-3" />
            </Link>
            <Link
              href="/docs"
              className="btn ghost"
              style={{ height: 32, padding: "0 12px", fontSize: 12 }}
            >
              <BookOpen className="w-3 h-3" />
              Read the guide
            </Link>
          </div>
        </div>

        <FooterColumn
          title="Core"
          links={[
            { label: "Markets", href: "/" },
            { label: "Create a market", href: "/create" },
            { label: "Portfolio", href: "/portfolio" },
            { label: "Leaderboard", href: "/leaderboard" },
          ]}
        />

        <FooterColumn
          title="Terminal"
          links={[
            { label: "Live activity", href: "/" },
            { label: "Resolution status", href: "/resolve" },
            { label: "Terminal guide", href: "/docs" },
          ]}
        />

        <FooterColumn
          title="Resolution"
          links={[
            {
              label: "AIJudgeVerifier",
              href: "https://sepolia.arbiscan.io/",
              external: true,
            },
            {
              label: "ProofAnchor",
              href: "https://sepolia.arbiscan.io/",
              external: true,
            },
            {
              label: "ParimutuelPool",
              href: "https://sepolia.arbiscan.io/",
              external: true,
            },
          ]}
        />
      </div>

      <div
        className="border-t px-[22px] py-3 text-[10.5px] font-mono tabular-nums flex items-center justify-between max-w-[1280px] mx-auto"
        style={{ borderColor: "var(--line-soft)", color: "var(--t3)" }}
      >
        <span>parimutuel terminal · arbitrum sepolia · USDC stake</span>
        <span>v0.1.0</span>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string; external?: boolean }[];
}) {
  return (
    <div>
      <div
        className="text-[10.5px] font-mono uppercase tracking-[0.08em] mb-2"
        style={{ color: "var(--t3)" }}
      >
        {title}
      </div>
      <ul className="space-y-1.5">
        {links.map((l) => (
          <li key={l.label}>
            {l.external ? (
              <a
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] inline-flex items-center gap-1.5 hover:underline"
                style={{ color: "var(--t2)" }}
              >
                {l.label}
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <Link
                href={l.href}
                className="text-[12px] hover:underline"
                style={{ color: "var(--t2)" }}
              >
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
