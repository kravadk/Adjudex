// Reclaim session bootstrap. UI POSTs providerId (from Reclaim dev portal),
// we hand back the attestor URL for the user to open. The resulting proof is
// delivered to /api/reclaim/callback by Reclaim's attestor service.

import { NextResponse } from "next/server";
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";
import type { Address } from "viem";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

type Body = {
  providerId?: string;
  marketId?: string;
  sourceUrl?: string;
  chainId?: number;
  poolAddress?: Address;
  walletAddress?: Address;
};

export async function POST(req: Request) {
  const limit = checkRateLimit({
    bucket: "reclaim:session",
    request: req,
    limit: 10,
    windowMs: 60_000,
  });
  if (!limit.ok) return rateLimitResponse(limit);

  const appId = process.env.RECLAIM_APP_ID;
  const appSecret = process.env.RECLAIM_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: "RECLAIM_APP_ID / RECLAIM_APP_SECRET not configured" },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const providerId = body.providerId ?? process.env.RECLAIM_PROVIDER_ID;
  if (!providerId) {
    return NextResponse.json({ error: "providerId required" }, { status: 400 });
  }
  if (!body.marketId || !body.sourceUrl) {
    return NextResponse.json(
      { error: "marketId and sourceUrl required for source-bound proof sessions" },
      { status: 400 },
    );
  }
  const normalizedSourceUrl = normalizeHttpUrl(body.sourceUrl);
  if (!normalizedSourceUrl) {
    return NextResponse.json({ error: "sourceUrl must be an absolute http(s) URL" }, { status: 400 });
  }
  if (body.chainId !== undefined && (!Number.isSafeInteger(body.chainId) || body.chainId <= 0)) {
    return NextResponse.json({ error: "chainId must be a positive integer" }, { status: 400 });
  }

  const publicBaseUrl = configuredPublicBaseUrl();
  if (!publicBaseUrl) {
    return NextResponse.json(
      { error: "RECLAIM_PUBLIC_BASE_URL required for callback registration" },
      { status: 503 },
    );
  }

  const reclaim = await ReclaimProofRequest.init(appId, appSecret, providerId);
  reclaim.setJsonContext({
    adjudex: {
      marketId: body.marketId,
      sourceUrl: normalizedSourceUrl,
      chainId: body.chainId ?? null,
      poolAddress: body.poolAddress ?? null,
      walletAddress: body.walletAddress ?? null,
    },
  });
  reclaim.setAppCallbackUrl(`${publicBaseUrl}/api/reclaim/callback`, true);

  const requestUrl = await reclaim.getRequestUrl();
  const statusUrl = reclaim.getStatusUrl();
  const sessionId =
    typeof (reclaim as { getSessionId?: () => string }).getSessionId === "function"
      ? (reclaim as { getSessionId: () => string }).getSessionId()
      : extractSessionId(requestUrl);

  return NextResponse.json({
    sessionId,
    requestUrl,
    statusUrl,
    providerId,
  });
}

function configuredPublicBaseUrl(): string | null {
  const configured =
    process.env.RECLAIM_PUBLIC_BASE_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.PUBLIC_APP_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = url.pathname.replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normalizeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function extractSessionId(url: string): string {
  try {
    const u = new URL(url);
    return u.searchParams.get("sessionId") ?? u.searchParams.get("session") ?? "";
  } catch {
    return "";
  }
}
