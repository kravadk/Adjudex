import type { Metadata } from "next";
import { MarketDetailClient } from "@/components/app/MarketDetailClient";
import { requireBackendUrl } from "@/lib/server/backend-api";
import type { Market } from "@/lib/types/domain";

export const dynamic = "force-dynamic";

async function loadMarket(id: string): Promise<Market | null> {
  try {
    const res = await fetch(
      `${requireBackendUrl()}/api/markets/${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as Market;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const market = await loadMarket(id);
  if (!market) {
    return { title: "Market · Adjudex" };
  }
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://adjudex.xyz").replace(/\/$/, "");
  const url = `${base}/market/${encodeURIComponent(id)}`;
  const title = `${market.title} · Adjudex`;
  const description =
    market.description?.slice(0, 200) ??
    "Parimutuel prediction market on Arbitrum with optimistic AI-judged resolution.";
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: [{ url: `${url}/opengraph-image` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const market = await loadMarket(id);
  return (
    <>
      {market && <MarketStructuredData id={id} market={market} />}
      <MarketDetailClient id={id} />
    </>
  );
}

// schema.org/PredictionContract is non-standard; the closest mainstream
// type is `Event` with `offers`. We expose the moneyline as two offer
// rows (YES, NO) priced by current implied probability. Search engines
// ingest this as a structured prediction; Twitter/Slack just ignore.
function MarketStructuredData({ id, market }: { id: string; market: Market }) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://adjudex.xyz").replace(/\/$/, "");
  const url = `${base}/market/${encodeURIComponent(id)}`;
  const yesProb = Math.max(0, Math.min(100, market.yesProbability ?? 50));
  const noProb = 100 - yesProb;
  const ld = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: market.title,
    description: market.description ?? undefined,
    endDate: market.deadlineIso ?? undefined,
    eventStatus:
      market.status === "resolved"
        ? "https://schema.org/EventCompleted"
        : market.status === "locked" || market.status === "resolving"
          ? "https://schema.org/EventPostponed"
          : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    location: {
      "@type": "VirtualLocation",
      url,
    },
    organizer: {
      "@type": "Organization",
      name: "Adjudex",
      url: base,
    },
    offers: [
      {
        "@type": "Offer",
        name: `YES — ${yesProb}% implied`,
        url,
        price: (yesProb / 100).toFixed(2),
        priceCurrency: "USDC",
        availability: "https://schema.org/InStock",
      },
      {
        "@type": "Offer",
        name: `NO — ${noProb}% implied`,
        url,
        price: (noProb / 100).toFixed(2),
        priceCurrency: "USDC",
        availability: "https://schema.org/InStock",
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
    />
  );
}
