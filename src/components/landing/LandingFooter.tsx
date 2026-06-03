import Image from "next/image";
import Link from "next/link";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Markets", href: "/" },
      { label: "Portfolio", href: "/portfolio" },
      { label: "Leaderboard", href: "/leaderboard" },
      { label: "Robinhood Chain", href: "/rhc" },
    ],
  },
  {
    title: "Ecosystem",
    links: [
      { label: "Integrations", href: "/integrations" },
      { label: "Proof of traction", href: "/analytics/sponsors" },
      { label: "Agents", href: "/agents" },
      { label: "Quests", href: "/quests" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "How it works", href: "/how-it-works" },
      { label: "Docs", href: "/docs" },
      { label: "Status", href: "/status" },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="border-t" style={{ borderColor: "var(--line-soft)" }}>
      <div className="mx-auto grid max-w-[1180px] gap-10 px-5 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="" width={30} height={30} className="rounded-[7px]" />
            <span className="text-[17px] font-bold tracking-tight" style={{ color: "var(--tx)" }}>
              adjudex
            </span>
          </div>
          <p className="mt-3 max-w-[280px] text-[13px] leading-relaxed" style={{ color: "var(--t3)" }}>
            Wallet-first parimutuel prediction markets. Peer pool, not house.
            AI-judged resolution with on-chain proof anchors.
          </p>
          <div className="mt-4 flex gap-3 text-[13px]">
            <a href="https://x.com/adjudex_xyz" target="_blank" rel="noreferrer" style={{ color: "var(--t2)" }}>
              X
            </a>
            <a href="https://t.me/adjudex" target="_blank" rel="noreferrer" style={{ color: "var(--t2)" }}>
              Telegram
            </a>
          </div>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title}>
            <div className="caps mb-3">{col.title}</div>
            <ul className="flex flex-col gap-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-[13.5px] transition-colors" style={{ color: "var(--t2)" }}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div
        className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-2 border-t px-5 py-5 text-[12px]"
        style={{ borderColor: "var(--line-soft)", color: "var(--t4)" }}
      >
        <span>© 2026 Adjudex · Testnet · Not financial advice.</span>
        <span>Arbitrum Sepolia · Robinhood Chain</span>
      </div>
    </footer>
  );
}
