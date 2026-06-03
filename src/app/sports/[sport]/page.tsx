import Link from "next/link";
import { notFound } from "next/navigation";
import { SportMarketsClient } from "@/components/app/SportMarketsClient";

const SPORT_LABELS: Record<string, string> = {
  football: "Football",
  basketball: "Basketball",
  tennis: "Tennis",
};

const VALID_SPORTS = Object.keys(SPORT_LABELS);

export const dynamicParams = true;

export async function generateStaticParams() {
  return VALID_SPORTS.map((sport) => ({ sport }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  const label = SPORT_LABELS[sport];
  if (!label) return { title: "Sports markets" };
  return {
    title: `${label} prediction markets`,
    description: `Wallet-first parimutuel prediction markets for ${label}. Live pool depth, AI-judged resolution, USDC stake on Arbitrum.`,
  };
}

export default async function SportPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  const label = SPORT_LABELS[sport];
  if (!label) notFound();
  return (
    <div className="px-[22px] py-5 pb-7">
      <div className="mb-5">
        <Link
          href="/"
          className="text-[11.5px] font-mono uppercase tracking-[0.08em] hover:underline"
          style={{ color: "var(--t3)" }}
        >
          ← Markets
        </Link>
        <h1
          className="text-[28px] font-semibold tracking-[-0.02em] mt-2"
          style={{ color: "var(--tx)" }}
        >
          {label} markets
        </h1>
        <p className="text-[13px] mt-1" style={{ color: "var(--t2)" }}>
          Parimutuel pools tagged with sport ={" "}
          <span className="font-mono" style={{ color: "var(--accent-bright)" }}>
            {sport}
          </span>
          . Auto-ingested fixtures, live pool depth, AI-judged resolution.
        </p>
      </div>
      <SportMarketsClient sport={sport} sportLabel={label} />
    </div>
  );
}
