// One-off: delete the OLD-factory (parimutuel) markets so the new AMM factory's
// market ids (which equal the raw on-chain id on Arbitrum) stop colliding with
// the old ids 3..31 in the DB. `auto_markets` has NO foreign key to `markets`
// (its PK is market_id), so it is NOT covered by ON DELETE CASCADE and must be
// cleared explicitly — clearing it also frees the auto-ingest dedup so the
// auto-deployer (MARKET_MODE=amm) re-creates the same markets as AMM.
// USER runs this with the External DATABASE_URL (append ?sslmode=require):
//   $env:DATABASE_URL="postgresql://...render.com/adjudex?sslmode=require"
//   pnpm tsx scripts/delete-old-markets.ts
import { query, transaction, closeDatabase } from "../services/api/src/db";

const OLD_FACTORY = (process.env.OLD_FACTORY || "0xe6c4876e1447ffad3fb5a4e3729d08852154b8f1").toLowerCase();

async function main() {
  if (!process.env.DATABASE_URL && !process.env.DATABASE_POOL_URL) {
    throw new Error("DATABASE_URL is required (the Render External URL, with ?sslmode=require).");
  }
  const { rows } = await query<{ n: number }>(
    "SELECT count(*)::int AS n FROM markets WHERE lower(factory_address) = $1",
    [OLD_FACTORY],
  );
  console.log(`old-factory (${OLD_FACTORY}) markets to delete: ${rows[0].n}`);
  if (rows[0].n === 0) {
    console.log("nothing to delete.");
    await closeDatabase();
    return;
  }
  await transaction(async (execute) => {
    const a = await execute(
      "DELETE FROM auto_markets WHERE market_id IN (SELECT id FROM markets WHERE lower(factory_address) = $1)",
      [OLD_FACTORY],
    );
    const m = await execute("DELETE FROM markets WHERE lower(factory_address) = $1", [OLD_FACTORY]);
    console.log(`deleted: auto_markets ${a.rowCount} rows, markets ${m.rowCount} rows (cascaded stats/positions/liquidity/...).`);
  });
  console.log("Done. The MARKET_MODE=amm auto-deployer re-creates these as AMM (ids no longer collide; dedup cleared).");
  await closeDatabase();
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
