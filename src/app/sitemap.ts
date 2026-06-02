import type { MetadataRoute } from "next";

// Sitemap for Adjudex. Returns evergreen static routes plus per-game
// esports landing pages. Per-market entries are intentionally NOT in
// the sitemap right now — they're high-churn and adding them requires
// a DB roundtrip on every sitemap fetch. When we're ready to ship the
// market index entries, route this through /api/markets/sitemap.
//
// Configurable via NEXT_PUBLIC_SITE_URL (defaults to https://adjudex.xyz).
const GAMES = [
  "cs2",
  "dota2",
  "lol",
  "valorant",
  "r6",
  "overwatch",
  "rocket-league",
  "starcraft2",
  "call-of-duty",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base =
    (process.env.NEXT_PUBLIC_SITE_URL ?? "https://adjudex.xyz").replace(/\/$/, "");
  const now = new Date().toISOString();

  const evergreen: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "hourly", priority: 1.0 },
    { url: `${base}/how-it-works`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/leaderboard`, lastModified: now, changeFrequency: "hourly", priority: 0.7 },
    { url: `${base}/agents`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: `${base}/changelog`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${base}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${base}/legal/terms`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/legal/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];

  const games: MetadataRoute.Sitemap = GAMES.map((g) => ({
    url: `${base}/esports/${g}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.7,
  }));

  return [...evergreen, ...games];
}
