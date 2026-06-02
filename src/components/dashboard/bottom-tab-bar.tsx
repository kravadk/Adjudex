"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Gamepad2, Plus, Trophy, Wallet } from "lucide-react";

// Mobile-only tab bar. Mirrors the top-nav primary routes (Markets,
// Esports, Portfolio, Top) so the user always has the same destinations
// one tap away, with Create as the FAB in the middle. Desktop uses
// <Header /> instead.
const TABS = [
  { name: "Markets", href: "/", icon: BarChart3, match: "/" },
  { name: "Esports", href: "/esports/cs2", icon: Gamepad2, match: "/esports" },
  { name: "Create", href: "/create", icon: Plus, fab: true, match: "/create" },
  { name: "Portfolio", href: "/portfolio", icon: Wallet, match: "/portfolio" },
  { name: "Top", href: "/leaderboard", icon: Trophy, match: "/leaderboard" },
];

export function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0f0f0f]/95 backdrop-blur-xl border-t border-[#262626]">
      <div className="grid grid-cols-5 items-center h-14 px-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active =
            tab.match === "/"
              ? pathname === "/"
              : pathname === tab.match || pathname.startsWith(`${tab.match}/`);
          if (tab.fab) {
            return (
              <Link
                key={tab.name}
                href={tab.href}
                className="flex items-center justify-center"
              >
                <span className="w-11 h-11 rounded-full bg-[#CCE9E7] text-black inline-flex items-center justify-center shadow-[0_0_18px_rgba(204,233,231,0.40),inset_0_1px_0_rgba(255,255,255,0.25)] active:scale-[0.95] transition-transform">
                  <Icon className="w-5 h-5" strokeWidth={2.5} />
                </span>
              </Link>
            );
          }
          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={`flex flex-col items-center justify-center gap-0.5 h-full ${
                active ? "text-white" : "text-gray-500"
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={1.8} />
              <span className="text-[9px] font-medium uppercase tracking-wider">
                {tab.name}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
