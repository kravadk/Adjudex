// Server-side market deployer. Turns one normalized IngestMatch into an
// on-chain soft market (parimutuel pool resolved by AIJudgeVerifier) and
// records it in both `markets` (so the UI shows it) and `auto_markets`
// (pipeline bookkeeping + dedupe). Mirrors scripts/seed-soft-market.ts but
// runs unattended inside the API service.

import { decodeEventLog, keccak256, stringToHex } from "viem";
import { query } from "./db";
import type { IngestMatch } from "./feeds";
import {
  getCreatorClients,
  marketFactoryWriteAbi,
  optimisticResolutionEnabled,
  optimisticResolverAddress,
} from "./feeds/chain";
import { matchQuestion } from "./feeds/match-question";

export type DeployOutcome =
  | { status: "skipped"; reason: string }
  | { status: "deployed"; marketId: string; poolAddress: string; txHash: string };

const EMOJI: Record<string, string> = {
  cs2: "🔫",
  dota2: "🛡️",
  football: "⚽",
  esports: "🎮",
  sports: "🏟️",
};

function emojiFor(match: IngestMatch): string {
  if (match.emoji) return match.emoji;
  if (match.game && EMOJI[match.game]) return EMOJI[match.game];
  if (match.sport && EMOJI[match.sport]) return EMOJI[match.sport];
  return EMOJI[match.category] ?? "🎯";
}

// Arbitrum markets use the raw chain market id; other chains namespace it.
function canonicalMarketId(chainId: number, rawId: bigint): string {
  return chainId === 421614 ? rawId.toString() : `${chainId}:${rawId.toString()}`;
}

async function alreadyIngested(match: IngestMatch): Promise<boolean> {
  const { rows } = await query<{ market_id: string }>(
    `SELECT market_id FROM auto_markets WHERE source_kind = $1 AND external_match_id = $2 LIMIT 1`,
    [match.sourceKind, match.externalMatchId],
  );
  return rows.length > 0;
}

export async function deployMarketFromMatch(match: IngestMatch): Promise<DeployOutcome> {
  if (await alreadyIngested(match)) {
    return { status: "skipped", reason: "already_ingested" };
  }

  const spec = matchQuestion(match);
  // Generic mirror sources carry an explicit DB category; sports/esports
  // fall back to the source-side category discriminator.
  const dbCategory = match.marketCategory ?? match.category;
  const deadlineIso = match.closeAtIsoOverride ?? spec.deadlineIso;
  if (!deadlineIso) return { status: "skipped", reason: "no_deadline" };
  const deadlineMs = new Date(deadlineIso).getTime();
  if (Number.isNaN(deadlineMs)) return { status: "skipped", reason: "bad_deadline" };
  if (deadlineMs <= Date.now()) return { status: "skipped", reason: "deadline_in_past" };

  const { account, walletClient, publicClient, chainId, factoryAddress, verifierAddress } =
    getCreatorClients();

  // Resolver selection: opt-in economic (optimistic) resolver, else AIJudgeVerifier.
  // The pool's resolver is whatever createSoftMarket receives as `verifier`.
  const optimisticAddr = optimisticResolverAddress();
  const useOptimistic = optimisticResolutionEnabled() && Boolean(optimisticAddr);
  const resolverAddress = (useOptimistic && optimisticAddr ? optimisticAddr : verifierAddress) as `0x${string}`;
  const oracleType = useOptimistic ? "optimistic-oracle" : "zktls-ai-oracle";

  // Spec JSON is what the AI judge + auditors re-derive specHash from.
  const specPayload = {
    title: spec.title,
    description: spec.description,
    category: dbCategory,
    oracleType,
    asset: "USDC" as const,
    deadlineIso,
    feeBps: 100,
    sourceUrl: match.sourceUrl,
    resolutionCriteria: spec.resolutionCriteria,
  };
  const specJson = JSON.stringify(specPayload);
  const specHash = keccak256(stringToHex(specJson));
  const specUri = `data:application/json;base64,${Buffer.from(specJson, "utf8").toString("base64")}`;
  const deadlineSec = BigInt(Math.floor(deadlineMs / 1000));

  // Default to AMM (Polymarket-style share trading with mid-market exit). The
  // LiquidityVault seeds the pool with `seedAmount` (it must be pre-funded).
  // Set MARKET_MODE=parimutuel to fall back to the legacy bank-split pool.
  const useAmm = (process.env.MARKET_MODE ?? "amm").toLowerCase() === "amm";
  const liquidityMode = useAmm ? "amm" : "parimutuel";
  const seedAmount = BigInt(process.env.AMM_SEED_USDC ?? "1000") * 1_000_000n; // USDC = 6 decimals
  const txHash = useAmm
    ? await walletClient.writeContract({
        address: factoryAddress,
        abi: marketFactoryWriteAbi,
        functionName: "createAmmMarket",
        args: [specHash, deadlineSec, resolverAddress, specUri, seedAmount],
      })
    : await walletClient.writeContract({
        address: factoryAddress,
        abi: marketFactoryWriteAbi,
        functionName: "createSoftMarket",
        args: [specHash, deadlineSec, resolverAddress, specUri],
      });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    return { status: "skipped", reason: `tx_reverted:${txHash}` };
  }

  let rawMarketId: bigint | null = null;
  let poolAddress: `0x${string}` | null = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: marketFactoryWriteAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "MarketCreated") {
        const args = decoded.args as unknown as { marketId: bigint; pool: `0x${string}` };
        rawMarketId = args.marketId;
        poolAddress = args.pool;
        break;
      }
    } catch {
      // not our event
    }
  }
  if (rawMarketId == null || !poolAddress) {
    return { status: "skipped", reason: "market_created_event_missing" };
  }

  const marketId = canonicalMarketId(chainId, rawMarketId);
  const provenance = `Auto-ingested from ${match.sourceKind}; match ${match.externalMatchId}.`;

  await query(
    `INSERT INTO markets (
       id, pool_address, chain_id, factory_address, creator_address,
       title, description, category, oracle_type, status, asset, emoji,
       source_url, resolution_criteria, resolver_address, deadline_at,
       provenance_note, game, sport, tournament, league, team_a, team_b,
       match_starts_at, best_of_maps, stream_url, liquidity_mode
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$24,'open','USDC',$9,
       $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$25
     )
     ON CONFLICT (id) DO NOTHING`,
    [
      marketId,
      poolAddress,
      chainId,
      factoryAddress,
      account.address,
      spec.title,
      spec.description,
      dbCategory,
      emojiFor(match),
      match.sourceUrl,
      spec.resolutionCriteria,
      resolverAddress,
      new Date(deadlineMs).toISOString(),
      provenance,
      match.game ?? null,
      match.sport ?? null,
      match.tournament ?? null,
      match.league ?? null,
      match.teamA,
      match.teamB,
      new Date(match.matchStartsAtIso).toISOString(),
      match.bestOfMaps ?? null,
      match.streamUrl ?? null,
      oracleType,
      liquidityMode,
    ],
  );

  // Seed market_stats so the market is visible immediately. /api/markets
  // INNER JOINs market_stats; without a row the market would be hidden
  // until the indexer first syncs the pool. Starts 50/50, zero volume.
  await query(
    `INSERT INTO market_stats (market_id, volume_usd, yes_probability, bettors, ai_lp_count, is_hot)
     VALUES ($1, 0, 50, 0, 0, false)
     ON CONFLICT (market_id) DO NOTHING`,
    [marketId],
  );

  await query(
    `INSERT INTO auto_markets (
       market_id, pool_address, chain_id, source_kind, external_match_id,
       category, team_a, team_b, deadline_at, lifecycle
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open')
     ON CONFLICT (source_kind, external_match_id) DO NOTHING`,
    [
      marketId,
      poolAddress,
      chainId,
      match.sourceKind,
      match.externalMatchId,
      dbCategory,
      match.teamA,
      match.teamB,
      new Date(deadlineMs).toISOString(),
    ],
  );

  return { status: "deployed", marketId, poolAddress, txHash };
}
