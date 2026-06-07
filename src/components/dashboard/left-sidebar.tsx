"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  Compass,
  Crown,
  Gift,
  Layers,
  Network,
  Send,
  Settings,
  Sparkles,
  Target,
  User,
  X as XIcon,
} from "lucide-react";

// Wide labeled left sidebar (foresee.lol style). 240px on md+, replaced
// by <BottomTabBar /> on mobile. Each item shows icon + label and the
// active row gets a darker background + bold weight.

type Item = {
  href: string;
  match: string;
  label: string;
  Icon: typeof Compass;
};

// Grouped so the core trading loop reads first and partner/data surfaces sit
// under "More" instead of competing with it. All routes are kept.
const NAV_SECTIONS: { title?: string; items: Item[] }[] = [
  {
    title: "Trade",
    items: [
      { href: "/", match: "/", label: "News Feed", Icon: Compass },
      { href: "/leaderboard", match: "/leaderboard", label: "Campaign", Icon: Crown },
      { href: "/portfolio", match: "/portfolio", label: "Profile", Icon: User },
    ],
  },
  {
    title: "Grow",
    items: [
      { href: "/feed", match: "/feed", label: "For You", Icon: Sparkles },
      { href: "/referrals", match: "/referrals", label: "Referrals", Icon: Gift },
      { href: "/quests", match: "/quests", label: "Quests", Icon: Target },
    ],
  },
  {
    title: "More",
    items: [
      { href: "/groups", match: "/groups", label: "Groups", Icon: Network },
      { href: "/rhc", match: "/rhc", label: "Robinhood Chain", Icon: Layers },
      { href: "/analytics/sponsors", match: "/analytics/sponsors", label: "Traction", Icon: BarChart3 },
      { href: "/integrations", match: "/integrations", label: "Integrations", Icon: Boxes },
      { href: "/settings", match: "/settings", label: "Settings", Icon: Settings },
    ],
  },
];

const SOCIAL: { href: string; label: string; Icon: typeof XIcon }[] = [
  { href: "https://x.com/adjudex_xyz", label: "X (Twitter)", Icon: XIcon },
  { href: "https://t.me/adjudex", label: "Telegram", Icon: Send },
];

function isActive(pathname: string, match: string): boolean {
  if (match === "/") return pathname === "/";
  return pathname === match || pathname.startsWith(`${match}/`);
}

export function LeftSidebar() {
  const pathname = usePathname();
  return (
    <aside
      className="hidden md:flex fixed top-0 left-0 z-40 h-screen w-[240px] flex-col py-4 px-3 border-r"
      style={{
        background: "var(--shell-bg, #0a0a0a)",
        borderColor: "var(--line-soft, #1a1a1a)",
      }}
      aria-label="Primary navigation"
    >
      {/* Logo */}
      <Link
        href="/"
        className="flex items-center gap-2.5 px-3 pb-5 mb-2"
        aria-label="Adjudex home"
      >
        <span
          className="grid place-items-center w-9 h-9 rounded-[8px] flex-shrink-0 overflow-hidden"
          style={{ background: "#0a0a0a" }}
        >
          <Image
            src="/logo.png"
            alt=""
            width={36}
            height={36}
            priority
            className="w-full h-full object-contain"
          />
        </span>
        <span
          className="text-[19px] font-bold tracking-tight"
          style={{ color: "var(--tx, #fafafa)" }}
        >
          adjudex
        </span>
      </Link>

      {/* Nav rows, grouped */}
      <nav className="flex flex-col gap-3 flex-1">
        {NAV_SECTIONS.map((section, si) => (
          <div key={section.title ?? si} className="flex flex-col gap-1">
            {section.title && (
              <span
                className="px-3 pb-0.5 text-[10px] font-bold uppercase tracking-[0.14em]"
                style={{ color: "var(--t4, #5f5a55)" }}
              >
                {section.title}
              </span>
            )}
            {section.items.map(({ href, match, label, Icon }) => {
              const active = isActive(pathname, match);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-label={label}
                  className="relative flex items-center gap-3 h-11 rounded-[10px] px-3 transition-colors"
                  style={{
                    background: active ? "var(--card-inner, #161616)" : "transparent",
                    color: active ? "var(--tx, #fafafa)" : "var(--t2, #a3a3a3)",
                  }}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full"
                      style={{ background: "#d9ff00" }}
                    />
                  )}
                  <Icon
                    className="w-[18px] h-[18px] flex-shrink-0"
                    strokeWidth={active ? 2.6 : 2}
                  />
                  <span
                    className="text-[15px]"
                    style={{
                      fontWeight: active ? 700 : 600,
                      letterSpacing: "-0.005em",
                    }}
                  >
                    {label}
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Social footer */}
      <div className="flex flex-col gap-1 pt-3 mt-auto border-t"
        style={{ borderColor: "var(--line-soft, #1a1a1a)" }}
      >
        {SOCIAL.map(({ href, label, Icon }) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={label}
            className="flex items-center gap-3 h-9 rounded-[10px] px-3 transition-colors"
            style={{ color: "var(--t3, #6b7280)" }}
          >
            <span
              className="grid place-items-center w-6 h-6 rounded-full flex-shrink-0"
              style={{
                background: "var(--card-inner, #161616)",
                border: "1px solid var(--line-soft, #1a1a1a)",
              }}
            >
              <Icon className="w-3 h-3" strokeWidth={2.2} />
            </span>
            <span className="text-[13px] font-semibold">{label}</span>
          </a>
        ))}
      </div>
    </aside>
  );
}
