// Match-resolve worker. Two stages, both idempotent and interval-driven:
//
//   A) PROPOSE  — markets past their deadline whose match now has a final
//      result. The deterministic winner from the results API is the
//      verdict; we bind the result payload into evidenceHash, sign it with
//      the judge key, and call AIJudgeVerifier.propose(). This opens the
//      on-chain 2h challenge window.
//   B) FINALIZE — proposed markets whose 2h window has elapsed and which
//      are still Pending (not disputed) on-chain. Calls finalize() so the
//      pool resolves and winners can claim.
//
// Convention: YES = teamA wins => outcome 0 (Side.YES). teamB win or draw
// => outcome 1 (Side.NO) — "teamA did not beat teamB".

import { keccak256, stringToHex } from "viem";
import { query } from "./db";
import { getMatchSourceByKind, type MatchResult } from "./feeds";
import {
  aiCrossCheck,
  hybridResolutionEnabled,
  type AiCrossCheck,
} from "./feeds/ai-verdict";
import {
  aiJudgeVerifierWriteAbi,
  ASSERTION_STATUS,
  autoPipelineConfigError,
  erc20Abi,
  getCreatorClients,
  optimisticResolverAbi,
  optimisticResolverAddress,
  PROPOSAL_STATUS,
  signJudgeVerdict,
} from "./feeds/chain";
import { captureException } from "./sentry";
import { emitCloudWatchMetric, incCounter, setGauge } from "./metrics";
import { enqueueMarketResolved } from "./webhooks";
import type { MatchSourceKind } from "./feeds";

const DEFAULT_INTERVAL_MS = 600_000; // 10 min
const CHALLENGE_WINDOW_MS = 2 * 60 * 60 * 1000; // matches AIJudgeVerifier
let timer: NodeJS.Timeout | null = null;
let running = false;
let configWarned = false;

type AutoRow = {
  market_id: string;
  pool_address: `0x${string}`;
  source_kind: MatchSourceKind;
  external_match_id: string;
  team_a: string;
  team_b: string;
  proposed_outcome: number | null;
  challenge_deadline: string | null;
  // Joined from `markets` (proposePass only) — used to give the hybrid
  // AI cross-check the real question/criteria for mirror markets.
  title?: string | null;
  description?: string | null;
  resolution_criteria?: string | null;
  // Resolver kind for this market ('optimistic-oracle' | 'zktls-ai-oracle').
  oracle_type?: string | null;
  // When an admin approved a previously-escalated market, skip the AI check.
  manual_cleared?: boolean;
};

function rawMarketId(marketId: string): bigint {
  const raw = marketId.includes(":") ? marketId.split(":")[1] : marketId;
  return BigInt(raw);
}

// teamA win => YES (0); teamB win or draw => NO (1).
function outcomeFromResult(result: MatchResult): 0 | 1 {
  return result.winner === "teamA" ? 0 : 1;
}

async function bumpAttempt(marketId: string, lastError: string | null): Promise<void> {
  await query(
    `UPDATE auto_markets SET resolve_attempts = resolve_attempts + 1, last_error = $2, updated_at = now() WHERE market_id = $1`,
    [marketId, lastError],
  );
}

type AssertionTuple = readonly [string, string, string, number, string, bigint, bigint, bigint, number];

// Optimistic resolver: assert the outcome with a bond (the AI is the asserter).
// Humans may then dispute it on-chain; settle/arbitrate happen in finalizePass.
async function assertOptimistic(
  row: AutoRow,
  outcome: 0 | 1,
  evidenceHash: `0x${string}`,
  marketIdBn: bigint,
): Promise<boolean> {
  const resolver = optimisticResolverAddress();
  if (!resolver) {
    await bumpAttempt(row.market_id, "optimistic_resolver_unset");
    return false;
  }
  const { walletClient, publicClient, account } = getCreatorClients();
  const bond = (await publicClient.readContract({
    address: resolver,
    abi: optimisticResolverAbi,
    functionName: "defaultBond",
  })) as bigint;

  if (bond > 0n) {
    const stakeToken = process.env.STAKE_TOKEN_ADDRESS?.trim() as `0x${string}` | undefined;
    if (!stakeToken) {
      await bumpAttempt(row.market_id, "stake_token_unset");
      return false;
    }
    const allowance = (await publicClient.readContract({
      address: stakeToken,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, resolver],
    })) as bigint;
    if (allowance < bond) {
      const approveTx = await walletClient.writeContract({
        address: stakeToken,
        abi: erc20Abi,
        functionName: "approve",
        args: [resolver, bond],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
    }
  }

  const txHash = await walletClient.writeContract({
    address: resolver,
    abi: optimisticResolverAbi,
    functionName: "assertOutcome",
    args: [row.pool_address, marketIdBn, outcome, evidenceHash],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    await bumpAttempt(row.market_id, `assert_reverted:${txHash}`);
    return false;
  }

  const a = (await publicClient.readContract({
    address: resolver,
    abi: optimisticResolverAbi,
    functionName: "assertions",
    args: [marketIdBn],
  })) as AssertionTuple;
  const challengeDeadline = new Date((Number(a[5]) + Number(a[6])) * 1000).toISOString();

  await query(
    `UPDATE auto_markets
        SET lifecycle = 'proposed', proposed_outcome = $2, proposed_at = now(),
            challenge_deadline = $3, last_error = NULL, updated_at = now()
      WHERE market_id = $1`,
    [row.market_id, outcome, challengeDeadline],
  );
  await query(
    `UPDATE markets
        SET status = 'resolving', resolution_evidence_hash = $2,
            resolution_proposer = $3, resolution_proposed_at = now(),
            resolution_tx_hash = $4, updated_at = now()
      WHERE id = $1`,
    [row.market_id, evidenceHash, account.address, txHash],
  );
  console.log(`[match-resolve] asserted (optimistic) market ${row.market_id} outcome=${outcome} tx=${txHash}`);
  return true;
}

// Settle an undisputed assertion after liveness. Disputed assertions wait for
// admin arbitration (resolveDispute); they are never auto-settled here.
async function settleOptimistic(
  marketIdBn: bigint,
): Promise<{ result: "settled" | "disputed" | "pending"; txHash?: string }> {
  const resolver = optimisticResolverAddress();
  if (!resolver) return { result: "pending" };
  const { walletClient, publicClient } = getCreatorClients();
  const a = (await publicClient.readContract({
    address: resolver,
    abi: optimisticResolverAbi,
    functionName: "assertions",
    args: [marketIdBn],
  })) as AssertionTuple;
  const status = Number(a[8]);
  if (status === ASSERTION_STATUS.DISPUTED) return { result: "disputed" };
  if (status === ASSERTION_STATUS.SETTLED) return { result: "settled" };
  const canSettle = (await publicClient.readContract({
    address: resolver,
    abi: optimisticResolverAbi,
    functionName: "canSettle",
    args: [marketIdBn],
  })) as boolean;
  if (!canSettle) return { result: "pending" };
  const txHash = await walletClient.writeContract({
    address: resolver,
    abi: optimisticResolverAbi,
    functionName: "settle",
    args: [marketIdBn],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") return { result: "pending" };
  return { result: "settled", txHash };
}

async function proposePass(): Promise<{ proposed: number; errors: number }> {
  let proposed = 0;
  let errors = 0;
  const { rows } = await query<AutoRow>(
    `SELECT a.market_id, a.pool_address, a.source_kind, a.external_match_id,
            a.team_a, a.team_b, a.proposed_outcome, a.challenge_deadline,
            a.manual_cleared, m.title, m.description, m.resolution_criteria, m.oracle_type
       FROM auto_markets a
       LEFT JOIN markets m ON m.id = a.market_id
      WHERE a.lifecycle = 'open' AND a.deadline_at < now()
      ORDER BY a.deadline_at ASC
      LIMIT 25`,
  );

  for (const row of rows) {
    try {
      const source = getMatchSourceByKind(row.source_kind);
      if (!source) {
        await bumpAttempt(row.market_id, `no_source:${row.source_kind}`);
        continue;
      }
      const result = await source.fetchResult(row.external_match_id);
      if (!result) {
        await bumpAttempt(row.market_id, "no_result");
        continue;
      }
      if (result.status === "canceled") {
        await query(
          `UPDATE auto_markets SET lifecycle = 'skipped', last_error = 'match_canceled', updated_at = now() WHERE market_id = $1`,
          [row.market_id],
        );
        continue;
      }
      if (result.status !== "finished" || result.winner == null) {
        await bumpAttempt(row.market_id, `pending:${result.status}`);
        continue;
      }

      const outcome = outcomeFromResult(result);

      // Hybrid resolution: for sources that mirror a third-party prediction
      // market, run an independent AI-judge cross-check before proposing.
      // A clear discrepancy escalates instead of auto-proposing; "uncertain"
      // (AI lacks current data) or "confirm" proceed. Deterministic sports
      // feeds skip this entirely.
      let aiCheck: AiCrossCheck | null = null;
      if (source.mirrorsExternalMarket && hybridResolutionEnabled() && !row.manual_cleared) {
        const outcomeLabel = outcome === 0 ? "YES" : "NO";
        const question =
          row.title?.trim() || row.description?.trim() || `${row.team_a} vs ${row.team_b}`;
        try {
          aiCheck = await aiCrossCheck({
            question,
            claimedOutcome: outcomeLabel,
            resolutionCriteria: row.resolution_criteria,
          });
        } catch (e) {
          // Transient AI/network error: don't block, retry next tick.
          await bumpAttempt(row.market_id, `ai_crosscheck_error:${(e as Error).message}`);
          continue;
        }
        if (aiCheck?.verdict === "dispute") {
          await query(
            `UPDATE auto_markets
                SET lifecycle = 'escalated', last_error = $2, updated_at = now()
              WHERE market_id = $1`,
            [row.market_id, `ai_dispute(${outcomeLabel}):${aiCheck.reasoning.slice(0, 400)}`],
          );
          // Lock the public market (betting already closed at deadline) so it
          // is not shown as freely tradeable while it awaits manual review.
          // Stays within the markets_status_check enum; the "escalated" reason
          // lives in auto_markets and is surfaced via the admin review endpoint.
          await query(
            `UPDATE markets SET status = 'locked', updated_at = now()
              WHERE id = $1 AND status = 'open'`,
            [row.market_id],
          );
          incCounter("adjudex_markets_escalated_total", { source: row.source_kind });
          console.warn(
            `[match-resolve] ESCALATED ${row.market_id}: Polymarket=${outcomeLabel} ` +
              `but AI disputes — ${aiCheck.reasoning.slice(0, 160)}`,
          );
          continue;
        }
      }

      const evidence = {
        source: row.source_kind,
        externalMatchId: row.external_match_id,
        teamA: row.team_a,
        teamB: row.team_b,
        winner: result.winner,
        scoreText: result.scoreText ?? null,
        fetchedAt: result.fetchedAtIso,
        // Hybrid cross-check provenance (omitted for deterministic sources;
        // undefined keys are dropped by JSON.stringify so their evidenceHash
        // is unchanged).
        aiVerdict: aiCheck?.verdict,
        aiReasoning: aiCheck?.reasoning,
        aiModel: aiCheck?.model,
      };
      const evidenceHash = keccak256(stringToHex(JSON.stringify(evidence)));
      const marketIdBn = rawMarketId(row.market_id);

      // Economic (optimistic) resolver: the AI asserts the outcome with a bond
      // instead of proposing to AIJudgeVerifier. Humans can then dispute it.
      if (row.oracle_type === "optimistic-oracle") {
        if (await assertOptimistic(row, outcome, evidenceHash, marketIdBn)) {
          proposed += 1;
          incCounter("adjudex_markets_proposed_total", { source: row.source_kind });
        }
        continue;
      }

      const signature = await signJudgeVerdict({
        pool: row.pool_address,
        marketId: marketIdBn,
        outcome,
        evidenceHash,
      });

      const { walletClient, publicClient, account, verifierAddress } = getCreatorClients();
      const txHash = await walletClient.writeContract({
        address: verifierAddress,
        abi: aiJudgeVerifierWriteAbi,
        functionName: "propose",
        args: [row.pool_address, marketIdBn, outcome, evidenceHash, signature],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        await bumpAttempt(row.market_id, `propose_reverted:${txHash}`);
        continue;
      }

      const challengeDeadline = new Date(Date.now() + CHALLENGE_WINDOW_MS).toISOString();
      await query(
        `UPDATE auto_markets
            SET lifecycle = 'proposed', proposed_outcome = $2, proposed_at = now(),
                challenge_deadline = $3, last_error = NULL, updated_at = now()
          WHERE market_id = $1`,
        [row.market_id, outcome, challengeDeadline],
      );
      await query(
        `UPDATE markets
            SET status = 'resolving', resolution_evidence_hash = $2,
                resolution_proposer = $3, resolution_proposed_at = now(),
                resolution_tx_hash = $4, updated_at = now()
          WHERE id = $1`,
        [row.market_id, evidenceHash, account.address, txHash],
      );
      proposed += 1;
      incCounter("adjudex_markets_proposed_total", { source: row.source_kind });
      console.log(`[match-resolve] proposed market ${row.market_id} outcome=${outcome} tx=${txHash}`);
    } catch (err) {
      errors += 1;
      await bumpAttempt(row.market_id, "propose_exception").catch(() => {});
      emitCloudWatchMetric("ResolutionFailures", 1);
      void captureException(err, { component: "match-resolve", stage: "propose", market: row.market_id });
    }
  }
  return { proposed, errors };
}

async function finalizePass(): Promise<{ finalized: number; errors: number }> {
  let finalized = 0;
  let errors = 0;
  const { rows } = await query<AutoRow>(
    `SELECT a.market_id, a.pool_address, a.source_kind, a.external_match_id, a.team_a, a.team_b,
            a.proposed_outcome, a.challenge_deadline, m.oracle_type
       FROM auto_markets a
       LEFT JOIN markets m ON m.id = a.market_id
      WHERE a.lifecycle = 'proposed' AND a.challenge_deadline IS NOT NULL AND a.challenge_deadline < now()
      ORDER BY a.challenge_deadline ASC
      LIMIT 25`,
  );

  for (const row of rows) {
    try {
      const { walletClient, publicClient, verifierAddress } = getCreatorClients();
      const marketIdBn = rawMarketId(row.market_id);

      // Optimistic resolver: settle if undisputed past liveness; disputed
      // assertions wait for admin arbitration (resolveDispute).
      if (row.oracle_type === "optimistic-oracle") {
        const r = await settleOptimistic(marketIdBn);
        if (r.result === "disputed") {
          await bumpAttempt(row.market_id, "disputed_needs_arbitration");
        } else if (r.result === "settled") {
          await markFinalized(row, r.txHash);
          finalized += 1;
          incCounter("adjudex_markets_finalized_total", { source: row.source_kind });
        } else {
          await bumpAttempt(row.market_id, "optimistic_settle_pending");
        }
        continue;
      }

      const proposal = (await publicClient.readContract({
        address: verifierAddress,
        abi: aiJudgeVerifierWriteAbi,
        functionName: "proposals",
        args: [marketIdBn],
      })) as readonly [string, number, string, bigint, number, string];
      const status = Number(proposal[4]);

      if (status === PROPOSAL_STATUS.DISPUTED) {
        await bumpAttempt(row.market_id, "disputed_needs_override");
        continue;
      }
      if (status === PROPOSAL_STATUS.FINALIZED) {
        await markFinalized(row);
        finalized += 1;
        continue;
      }
      if (status !== PROPOSAL_STATUS.PENDING) {
        await bumpAttempt(row.market_id, `unexpected_status:${status}`);
        continue;
      }

      const txHash = await walletClient.writeContract({
        address: verifierAddress,
        abi: aiJudgeVerifierWriteAbi,
        functionName: "finalize",
        args: [marketIdBn],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        await bumpAttempt(row.market_id, `finalize_reverted:${txHash}`);
        continue;
      }
      await markFinalized(row, txHash);
      finalized += 1;
      incCounter("adjudex_markets_finalized_total", { source: row.source_kind });
      console.log(`[match-resolve] finalized market ${row.market_id} tx=${txHash}`);
    } catch (err) {
      errors += 1;
      await bumpAttempt(row.market_id, "finalize_exception").catch(() => {});
      emitCloudWatchMetric("ResolutionFailures", 1);
      void captureException(err, { component: "match-resolve", stage: "finalize", market: row.market_id });
    }
  }
  return { finalized, errors };
}

async function markFinalized(row: AutoRow, txHash?: string): Promise<void> {
  const resolvedOutcome = row.proposed_outcome === 0 ? "YES" : "NO";
  await query(
    `UPDATE auto_markets SET lifecycle = 'finalized', last_error = NULL, updated_at = now() WHERE market_id = $1`,
    [row.market_id],
  );
  await query(
    `UPDATE markets
        SET status = 'resolved', resolved_outcome = $2,
            resolution_tx_hash = COALESCE($3, resolution_tx_hash), updated_at = now()
      WHERE id = $1`,
    [row.market_id, resolvedOutcome, txHash ?? null],
  );
  await enqueueMarketResolved(row.market_id, resolvedOutcome, txHash ?? null);
}

export async function resolveOnce(): Promise<{
  proposed: number;
  finalized: number;
  errors: number;
}> {
  const configError = autoPipelineConfigError();
  if (configError || !process.env.JUDGE_PRIVATE_KEY?.trim()) {
    if (!configWarned) {
      console.warn(`[match-resolve] disabled: ${configError ?? "JUDGE_PRIVATE_KEY missing"}`);
      configWarned = true;
    }
    return { proposed: 0, finalized: 0, errors: 0 };
  }
  configWarned = false;

  const a = await proposePass();
  const b = await finalizePass();
  setGauge("adjudex_match_resolve_last_proposed", a.proposed);
  setGauge("adjudex_match_resolve_last_finalized", b.finalized);
  return { proposed: a.proposed, finalized: b.finalized, errors: a.errors + b.errors };
}

export function startMatchResolveWorker(opts?: { intervalMs?: number }): void {
  if (timer) return;
  const intervalMs =
    opts?.intervalMs ?? Number(process.env.MATCH_RESOLVE_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const tick = () => {
    if (running) return;
    running = true;
    resolveOnce()
      .catch((err) => void captureException(err, { component: "match-resolve" }))
      .finally(() => {
        running = false;
      });
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
}

export function stopMatchResolveWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
