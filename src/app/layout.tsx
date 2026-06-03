import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Rubik } from "next/font/google";
import { PwaServiceWorker } from "@/components/app/PwaServiceWorker";
import { WalletProviders } from "@/components/app/WalletProviders";
import { UserSettingsEffects } from "@/components/app/UserSettingsEffects";
import { BottomTabBar } from "@/components/dashboard/bottom-tab-bar";
import { Footer } from "@/components/dashboard/footer";
import { JurisdictionBanner } from "@/components/dashboard/jurisdiction-banner";
import { LeftSidebar } from "@/components/dashboard/left-sidebar";
import { NetworkBanner } from "@/components/dashboard/network-banner";
import { RightRail } from "@/components/dashboard/right-rail";
import { ToastViewport } from "@/components/dashboard/toast";
import { TopUtility } from "@/components/dashboard/top-utility";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";

// Rubik — the font foresee.lol uses (via @expo-google-fonts/rubik on
// their side). Single-family across the whole site; Geist stays loaded
// only as a fallback in case Google Fonts CDN is unreachable.
const rubik = Rubik({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-rubik",
});

const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist-mono",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://adjudex.xyz";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Adjudex - AI-native prediction markets",
    template: "%s · Adjudex",
  },
  description:
    "Parimutuel prediction markets with AI market-makers, zkTLS-attested resolution, indexed proof, and portfolio lifecycle on Arbitrum and Robinhood Chain.",
  applicationName: "Adjudex",
  manifest: "/manifest.webmanifest",
  alternates: {
    canonical: "/",
  },
  appleWebApp: {
    capable: true,
    title: "Adjudex",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Adjudex",
    description:
      "AI-native prediction markets with real contracts, indexed proof, and auditable portfolio lifecycle.",
    type: "website",
    siteName: "Adjudex",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Adjudex",
    description:
      "AI-native prediction markets with real contracts, indexed proof, and auditable portfolio lifecycle.",
    site: "@adjudex_xyz",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#d9ff00",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${rubik.variable} ${geist.variable} ${geistMono.variable}`}
    >
      <head>
        {/* Wallet-extension noise filter. Multiple EVM wallets (e.g. Phantom +
            MetaMask) race to define window.ethereum; the loser throws
            "Cannot redefine property: ethereum" from inside its own injected
            script. That is not an app error — swallow extension-originated
            errors (capture phase, early) so they never reach the Next overlay,
            our error boundary, or Sentry. App errors are untouched. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof window==="undefined")return;var ext=function(s){return typeof s==="string"&&s.indexOf("chrome-extension://")!==-1;};var noise=function(m){return typeof m==="string"&&/Cannot redefine property: (ethereum|solana|web3|tron|aptos)/i.test(m);};window.addEventListener("error",function(e){if(ext(e.filename)||noise(e&&e.message)||(e&&e.error&&ext(e.error.stack))){e.stopImmediatePropagation();e.preventDefault();}},true);window.addEventListener("unhandledrejection",function(e){var r=e&&e.reason;var m=r&&(r.message||String(r));var s=r&&r.stack;if(noise(m)||ext(s)){e.stopImmediatePropagation();e.preventDefault();}},true);})();`,
          }}
        />
      </head>
      <body
        className="min-h-full text-[color:var(--tx)] pb-14 md:pb-0"
        style={{
          background: "var(--shell-bg)",
          fontFamily: "var(--font-rubik), var(--font-geist), system-ui, sans-serif",
        }}
        suppressHydrationWarning
      >
        <WalletProviders>
          <UserSettingsEffects />
          <PwaServiceWorker />
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
          <ToastViewport />
        </WalletProviders>
      </body>
    </html>
  );
}
