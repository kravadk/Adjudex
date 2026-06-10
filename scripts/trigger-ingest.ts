// Run one auto-ingest pass on demand: scans the real feeds (Polymarket mirror,
// pandascore esports, football-data, GMX, RWA) and auto-deploys fresh markets to
// the MARKET_FACTORY_ADDRESS in the loaded env. Same code path Render runs on an
// interval — useful to populate a freshly-switched factory immediately.
// Run: pnpm tsx --env-file=.env.local scripts/trigger-ingest.ts
import { ingestOnce } from "../services/api/src/match-ingest-worker";
import { createPolymarketSource } from "../services/api/src/feeds/polymarket";

async function main() {
  console.log("factory:", process.env.MARKET_FACTORY_ADDRESS);
  if (process.env.POLYMARKET_INGEST_ENABLED === "1") {
    try {
      const src = createPolymarketSource();
      const m = await src.fetchUpcoming();
      console.log(`polymarket fetchUpcoming: ${m.length} matches`);
      for (const x of m.slice(0, 3)) console.log("  -", x.questionOverride || x.titleOverride || `${x.teamA} vs ${x.teamB}`);
    } catch (e) {
      console.error("polymarket fetch ERROR:", e);
    }
  }
  console.log("running ingestOnce()...");
  const r = await ingestOnce();
  console.log("ingest result:", JSON.stringify(r));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  });
