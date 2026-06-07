// Proof-anchor worker. Pins stored Reclaim zkTLS proofs to IPFS and writes them
// to the on-chain ProofAnchor so the evidence is permanently verifiable. Mirrors
// the match-ingest worker lifecycle (single-instance, unref'd, Sentry-wrapped)
// and is gated by PROOF_ANCHOR_ENABLED=1 + IPFS config. Without config it is a
// no-op, so it is safe to leave running.

import { stringToHex, type Hex } from "viem";
import { query } from "./db";
import { autoPipelineConfigError, getCreatorClients } from "./feeds/chain";
import { ipfsConfigured, pinJsonToIpfs } from "./ipfs";
import { captureException } from "./sentry";

const DEFAULT_INTERVAL_MS = 120_000; // 2 min
const BATCH = 5;
let timer: NodeJS.Timeout | null = null;
let running = false;
let configWarned = false;

const proofAnchorAbi = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "string" },
      { name: "proofHash", type: "bytes32" },
      { name: "cid", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

function proofAnchorAddress(): `0x${string}` | null {
  const a = (process.env.PROOF_ANCHOR_ADDRESS || process.env.NEXT_PUBLIC_PROOF_ANCHOR_ADDRESS)?.trim();
  return a ? (a as `0x${string}`) : null;
}

export function proofAnchorConfigError(): string | null {
  const pipeline = autoPipelineConfigError();
  if (pipeline) return pipeline; // shares RPC + MARKET_CREATOR_PRIVATE_KEY
  if (!proofAnchorAddress()) return "PROOF_ANCHOR_ADDRESS missing";
  if (!ipfsConfigured()) return "IPFS_PROVIDER / IPFS_TOKEN missing";
  return null;
}

type ProofRow = { session_id: string; proof_hash: string; proof: unknown };

export async function anchorOnce(): Promise<{ anchored: number; errors: number }> {
  const configError = proofAnchorConfigError();
  if (configError) {
    if (!configWarned) {
      console.warn(`[proof-anchor] disabled: ${configError}`);
      configWarned = true;
    }
    return { anchored: 0, errors: 0 };
  }
  configWarned = false;

  const address = proofAnchorAddress()!;
  const { walletClient, publicClient, account } = getCreatorClients();
  const pending = await query<ProofRow>(
    `SELECT session_id, proof_hash, proof FROM reclaim_proofs
     WHERE anchor_tx_hash IS NULL AND proof_hash IS NOT NULL
     ORDER BY verified_at ASC LIMIT $1`,
    [BATCH],
  );

  let anchored = 0;
  let errors = 0;
  for (const row of pending.rows) {
    try {
      const proofHash = (row.proof_hash.startsWith("0x") ? row.proof_hash : `0x${row.proof_hash}`) as Hex;
      const cid = await pinJsonToIpfs(row.proof);
      const hash = await walletClient.writeContract({
        account,
        address,
        abi: proofAnchorAbi,
        functionName: "anchor",
        args: [row.session_id, proofHash, stringToHex(cid)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await query(
        `UPDATE reclaim_proofs SET anchor_tx_hash = $2, anchor_cid = $3, anchored_at = now() WHERE session_id = $1`,
        [row.session_id, hash, cid],
      );
      anchored += 1;
    } catch (err) {
      errors += 1;
      captureException(err, { component: "proof-anchor", sessionId: row.session_id });
    }
  }
  return { anchored, errors };
}

export function startProofAnchorWorker(opts?: { intervalMs?: number }): void {
  if (timer) return;
  const intervalMs = opts?.intervalMs ?? Number(process.env.PROOF_ANCHOR_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const tick = () => {
    if (running) return;
    running = true;
    anchorOnce()
      .catch((err) => void captureException(err, { component: "proof-anchor" }))
      .finally(() => {
        running = false;
      });
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
}

export function stopProofAnchorWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
