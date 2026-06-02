// Reclaim attestor callback. Receives the user's zkTLS proof, verifies it
// server-side, persists it keyed by sessionId.

import { NextResponse } from "next/server";
import { verifyProof } from "@reclaimprotocol/js-sdk";
import { putProof } from "@/lib/server/reclaim-store";
import { pinJson } from "@/lib/server/ipfs";
import { anchorProof, type AnchorOutcome } from "@/lib/server/proof-anchor";

export const runtime = "nodejs";

type ProofWithContext = {
  providerId?: string;
  identifier?: string;
  claimData?: { context?: string; provider?: string; providerId?: string };
  sessionId?: string;
};

async function readProof(req: Request): Promise<unknown | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await req.json();
    } catch {
      return null;
    }
  }
  const text = await req.text();
  if (!text) return null;
  try {
    return JSON.parse(decodeURIComponent(text));
  } catch {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}

function pickSessionId(proof: ProofWithContext): string | null {
  if (proof.sessionId?.trim()) return proof.sessionId.trim();
  const ctxRaw = proof.claimData?.context;
  if (!ctxRaw) return null;
  try {
    const ctx = JSON.parse(ctxRaw) as { reclaimSessionId?: string; sessionId?: string };
    return ctx.reclaimSessionId?.trim() || ctx.sessionId?.trim() || null;
  } catch {
    return null;
  }
}

function pickProviderId(proof: ProofWithContext): string | null {
  return proof.providerId?.trim()
    || proof.claimData?.providerId?.trim()
    || proof.claimData?.provider?.trim()
    || null;
}

export async function POST(req: Request) {
  const proof = (await readProof(req)) as ProofWithContext | null;
  if (!proof) {
    return NextResponse.json({ error: "no proof in body" }, { status: 400 });
  }
  const sessionId = pickSessionId(proof);
  if (!sessionId) {
    return NextResponse.json({ error: "reclaim_session_id_required" }, { status: 400 });
  }
  const providerId = pickProviderId(proof);
  if (!providerId) {
    return NextResponse.json({ error: "reclaim_provider_id_required" }, { status: 400 });
  }

  let ok = false;
  try {
    const result = await verifyProof(proof as Parameters<typeof verifyProof>[0], { providerId });
    ok = result.isVerified;
  } catch (e) {
    return NextResponse.json(
      { error: `verification threw: ${(e as Error).message}` },
      { status: 400 },
    );
  }
  if (!ok) {
    return NextResponse.json({ error: "proof did not verify" }, { status: 400 });
  }

  let stored: Awaited<ReturnType<typeof putProof>>;
  try {
    stored = await putProof({ sessionId, providerId, proof });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "reclaim proof backend write failed" },
      { status: 503 },
    );
  }

  // Pin the verified proof off-chain and anchor (sessionId → proofHash → cid)
  // on-chain via ProofAnchor.anchor(). Both steps are best-effort: failures
  // do not invalidate the stored proof, the response just reports the
  // degraded state so clients (or the indexer) can retry later.
  let cid: string | null = null;
  let pinError: string | null = null;
  try {
    const pinned = await pinJson(proof);
    cid = pinned.cid;
  } catch (error) {
    pinError = error instanceof Error ? error.message : "ipfs pin failed";
  }

  let anchorOutcome: AnchorOutcome | null = null;
  if (cid) {
    try {
      anchorOutcome = await anchorProof({
        sessionId: stored.sessionId,
        proofHash: stored.proofHash,
        cid,
      });
    } catch (error) {
      anchorOutcome = {
        anchored: false,
        reason: "missing-rpc",
        detail: error instanceof Error ? error.message : "anchor tx failed",
      };
    }
  }

  return NextResponse.json({
    ok: true,
    sessionId: stored.sessionId,
    proofHash: stored.proofHash,
    cid,
    pinError,
    anchor:
      anchorOutcome === null
        ? null
        : anchorOutcome.anchored
          ? {
              status: "anchored",
              txHash: anchorOutcome.result.txHash,
              sessionIdHash: anchorOutcome.result.sessionIdHash,
            }
          : { status: "skipped", reason: anchorOutcome.reason, detail: anchorOutcome.detail ?? null },
  });
}

