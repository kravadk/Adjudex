"use client";

import { usePathname } from "next/navigation";
import { BottomTabBar } from "@/components/dashboard/bottom-tab-bar";
import { Footer } from "@/components/dashboard/footer";
import { JurisdictionBanner } from "@/components/dashboard/jurisdiction-banner";
import { LeftSidebar } from "@/components/dashboard/left-sidebar";
import { NetworkBanner } from "@/components/dashboard/network-banner";
import { RightRail } from "@/components/dashboard/right-rail";
import { TopUtility } from "@/components/dashboard/top-utility";

// Routes that opt out of the app chrome (sidebar / rails / footer) and render
// full-bleed — the marketing landing. Everything else keeps the dashboard shell.
const BARE_PREFIXES = ["/landing"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (bare) return <>{children}</>;

  return (
    <>
      <LeftSidebar />
      <div className="md:pl-[240px] min-h-screen">
        <div className="mx-auto max-w-[1480px] px-5 md:px-7">
          <TopUtility />
          <NetworkBanner />
          <div className="flex gap-8">
            <main className="flex-1 min-w-0">{children}</main>
            <RightRail />
          </div>
          <Footer />
        </div>
      </div>
      <BottomTabBar />
      <JurisdictionBanner />
    </>
  );
}
