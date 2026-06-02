import Link from "next/link";
import { notFound } from "next/navigation";
import { EsportsGameClient } from "@/components/app/EsportsGameClient";

const GAME_LABELS: Record<string, string> = {
  cs2: "Counter-Strike 2",
  dota2: "Dota 2",
  lol: "League of Legends",
  valorant: "Valorant",
  r6: "Rainbow Six Siege",
  overwatch: "Overwatch",
  "rocket-league": "Rocket League",
  starcraft2: "StarCraft II",
  "call-of-duty": "Call of Duty",
};

const VALID_GAMES = Object.keys(GAME_LABELS);

export const dynamicParams = true;

export async function generateStaticParams() {
  return VALID_GAMES.map((game) => ({ game }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string }>;
}) {
  const { game } = await params;
  const label = GAME_LABELS[game];
  if (!label) return { title: "Esports markets" };
  return {
    title: `${label} prediction markets`,
    description: `Wallet-first parimutuel prediction markets for ${label}. Live pool depth, AI-judged resolution, USDC stake on Arbitrum.`,
  };
}

export default async function EsportsGamePage({
  params,
}: {
  params: Promise<{ game: string }>;
}) {
  const { game } = await params;
  const label = GAME_LABELS[game];
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
          Parimutuel pools tagged with game ={" "}
          <span className="font-mono" style={{ color: "var(--accent-bright)" }}>
            {game}
          </span>
          . Live status, pool depth, AI-judged resolution.
        </p>
      </div>
      <EsportsGameClient game={game} gameLabel={label} />
    </div>
  );
}
