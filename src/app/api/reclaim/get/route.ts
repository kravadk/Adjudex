// Poll a Reclaim session to see whether the user's proof has arrived
// (i.e. /callback ran and the proof verified).

import { NextResponse } from "next/server";
import { getProof } from "@/lib/server/reclaim-store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  let proof: Awaited<ReturnType<typeof getProof>>;
  try {
    proof = await getProof(sessionId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "reclaim proof backend read failed" },
      { status: 503 },
    );
  }
  if (!proof) {
    return NextResponse.json({ found: false });
  }
  return NextResponse.json({
    found: true,
    proof: {
      sessionId: proof.sessionId,
      proofHash: proof.proofHash,
      marketId: proof.marketId,
      sourceUrl: proof.sourceUrl,
      chainId: proof.chainId,
      poolAddress: proof.poolAddress,
      walletAddress: proof.walletAddress,
      verifiedAtIso: proof.verifiedAtIso,
    },
  });
}
