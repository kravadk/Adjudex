// AI Resolver V1 - POST { pool, marketId, question, context? }
// Returns { outcome (0|1), evidenceHash, signature, reasoning }.
//
// The route must call a configured provider. If Anthropic or a remote worker is
// unavailable, it returns an explicit error instead of producing a heuristic verdict.

import { NextResponse } from "next/server";
import {
  concat,
  encodeAbiParameters,
  keccak256,
  stringToBytes,
  toHex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { requireBackendUrl } from "@/lib/server/backend-api";
import { getProof } from "@/lib/server/reclaim-store";

type Body = {
  pool: Address;
  marketId: string | number;
  chainId: number;
  question?: string;
  reclaimSessionId?: string;
};

async function askClaude(
  question: string,
  context?: string,
): Promise<{ outcome: 0 | 1; reasoning: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("provider_not_configured: ANTHROPIC_API_KEY is required");
  const sys =
    'You are an impartial market resolver. The user gives you a YES/NO market question and optional context. Answer with strict JSON {"outcome":"YES"|"NO","reasoning":"..."} and no prose around the JSON. If genuinely undetermined, choose the side better supported by the context and explain why.';
  const userMsg = context
    ? `Question: ${question}\n\nContext: ${context}`
    : `Question: ${question}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: sys,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!res.ok) {
    throw new Error(`provider_request_failed: Claude API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    const parsed = JSON.parse(text.trim()) as { outcome: "YES" | "NO"; reasoning: string };
    return { outcome: parsed.outcome === "YES" ? 0 : 1, reasoning: parsed.reasoning };
  } catch {
    throw new Error(`provider_response_invalid: Could not parse Claude output: ${text.slice(0, 400)}`);
  }
}

function providerErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "provider_request_failed";
  const notConfigured = message.startsWith("provider_not_configured");
  return NextResponse.json(
    { error: notConfigured ? "provider_not_configured" : "provider_request_failed", message },
    { status: notConfigured ? 503 : 502 },
  );
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.pool || body.marketId === undefined || !body.chainId) {
    return NextResponse.json(
      { error: "pool, marketId, chainId required" },
      { status: 400 },
    );
  }
  const marketContractId = parseMarketContractId(body.marketId);
  if (marketContractId === null) {
    return NextResponse.json({ error: "market_id_invalid" }, { status: 400 });
  }
  if (!Number.isSafeInteger(body.chainId) || body.chainId <= 0) {
    return NextResponse.json({ error: "chain_id_invalid" }, { status: 400 });
  }
  const supportedChainIds = supportedJudgeChainIds();
  if (!supportedChainIds.has(body.chainId)) {
    return NextResponse.json(
      { error: "chain_not_supported", supportedChainIds: [...supportedChainIds] },
      { status: 400 },
    );
  }

  if (!body.reclaimSessionId) {
    return NextResponse.json(
      { error: "source_proof_required", message: "A verified source proof session is required before signing a verdict." },
      { status: 400 },
    );
  }

  let reclaimProofHash: `0x${string}` | null = null;
  let stored: Awaited<ReturnType<typeof getProof>>;
  try {
    stored = await getProof(body.reclaimSessionId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "reclaim proof backend read failed" },
      { status: 503 },
    );
  }
  if (!stored) {
    return NextResponse.json(
      { error: `reclaim session ${body.reclaimSessionId} has no verified proof yet` },
      { status: 404 },
    );
  }
  reclaimProofHash = stored.proofHash;
  const proofBinding = await validateProofBinding(String(body.marketId), body.chainId, body.pool, stored.proof);
  if (!proofBinding.ok) {
    return NextResponse.json(
      { error: proofBinding.error, message: proofBinding.message },
      { status: proofBinding.status },
    );
  }
  const canonicalQuestion = canonicalResolutionQuestion(proofBinding.market);
  if (!canonicalQuestion) {
    return NextResponse.json(
      {
        error: "market_question_required",
        message: "Market must define a canonical title before AI resolution can sign a verdict.",
      },
      { status: 400 },
    );
  }
  const combinedContext = `Verified zkTLS proof hash: ${stored.proofHash}`;

  const remoteUrl = process.env.JUDGE_REMOTE_URL;
  if (remoteUrl) {
    const remoteSecret = process.env.JUDGE_REMOTE_SECRET;
    if (!remoteSecret) {
      return NextResponse.json(
        {
          error: "remote_secret_not_configured",
          message: "JUDGE_REMOTE_SECRET is required when JUDGE_REMOTE_URL is configured.",
        },
        { status: 503 },
      );
    }
    const upstream = await fetch(`${remoteUrl.replace(/\/$/, "")}/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${remoteSecret}`,
      },
      body: JSON.stringify({
        pool: body.pool,
        marketId: String(body.marketId),
        chainId: body.chainId,
        sourceProofHash: reclaimProofHash,
      }),
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `remote resolver failed: ${upstream.status} ${await upstream.text()}` },
        { status: 502 },
      );
    }
    const result = (await upstream.json()) as Record<string, unknown>;
    if (Number(result.chainId) !== body.chainId) {
      return NextResponse.json(
        {
          error: "remote_chain_mismatch",
          expectedChainId: body.chainId,
          receivedChainId: result.chainId,
        },
        { status: 502 },
      );
    }
    const remoteReasoning = typeof result.reasoning === "string" ? result.reasoning : "";
    const remoteEvidenceHash = typeof result.evidenceHash === "string" ? result.evidenceHash : "";
    const expectedEvidenceHash = remoteReasoning
      ? keccak256(concat([keccak256(stringToBytes(remoteReasoning)), reclaimProofHash]))
      : "";
    if (!remoteReasoning || remoteEvidenceHash.toLowerCase() !== expectedEvidenceHash.toLowerCase()) {
      return NextResponse.json(
        {
          error: "remote_evidence_hash_mismatch",
          message: "Remote verdict evidenceHash must bind reasoning to the verified source proof.",
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ ...result, reclaimProofHash, canonicalQuestion });
  }

  const judgeKey = process.env.JUDGE_PRIVATE_KEY as `0x${string}` | undefined;
  if (!judgeKey) {
    return NextResponse.json(
      { error: "signer_not_configured", message: "JUDGE_PRIVATE_KEY or JUDGE_REMOTE_URL is required" },
      { status: 503 },
    );
  }

  let claudeResult: Awaited<ReturnType<typeof askClaude>>;
  try {
    claudeResult = await askClaude(canonicalQuestion, combinedContext || undefined);
  } catch (error) {
    return providerErrorResponse(error);
  }

  const outcome = claudeResult.outcome;
  const reasoning = claudeResult.reasoning;
  const reasoningHash = keccak256(stringToBytes(reasoning));
  const evidenceHash = keccak256(concat([reasoningHash, reclaimProofHash]));
  const account = privateKeyToAccount(judgeKey);

  const inner = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "bytes32" },
      ],
      [
        BigInt(body.chainId),
        body.pool,
        marketContractId,
        outcome,
        evidenceHash,
      ],
    ),
  );
  const signature = await account.signMessage({ message: { raw: inner } });

  return NextResponse.json({
    pool: body.pool,
    marketId: String(body.marketId),
    outcome,
    outcomeLabel: outcome === 0 ? "YES" : "NO",
    evidenceHash,
    reasoningHash,
    reclaimProofHash,
    canonicalQuestion,
    reasoning,
    signature,
    judge: account.address,
    chainId: body.chainId,
    issuedAtIso: new Date().toISOString(),
    digest: toHex(inner),
  });
}

function parseMarketContractId(marketId: string | number) {
  const raw = String(marketId).split(":").at(-1);
  if (!raw || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

type MarketProofConfig = {
  title?: string | null;
  sourceUrl?: string | null;
  poolAddress?: string | null;
  chainId?: number | null;
  resolutionCriteria?: string | null;
};

type ProofBindingContext = {
  marketId?: unknown;
  sourceUrl?: unknown;
  chainId?: unknown;
  poolAddress?: unknown;
};

async function validateProofBinding(
  marketId: string,
  chainId: number,
  pool: Address,
  proof: unknown,
): Promise<
  | { ok: true; market: MarketProofConfig }
  | { ok: false; status: number; error: string; message: string }
> {
  let response: Response;
  try {
    response = await fetch(`${requireBackendUrl()}/api/markets/${encodeURIComponent(marketId)}`, {
      cache: "no-store",
    });
  } catch (error) {
    return {
      ok: false,
      status: 503,
      error: "market_proof_config_unavailable",
      message: error instanceof Error ? error.message : "Market proof configuration is unavailable.",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status === 404 ? 404 : 503,
      error: "market_proof_config_unavailable",
      message: `Market proof configuration read failed: ${response.status} ${await response.text()}`,
    };
  }

  const market = (await response.json()) as MarketProofConfig;
  if (!market.sourceUrl) {
    return {
      ok: false,
      status: 400,
      error: "market_source_required",
      message: "Market must define sourceUrl before AI resolution can sign a verdict.",
    };
  }

  const binding = extractPariaiProofBinding(proof);
  if (!binding) {
    return {
      ok: false,
      status: 400,
      error: "source_proof_context_required",
      message: "Verified source proof must include Adjudex market binding context.",
    };
  }

  if (String(binding.marketId ?? "") !== marketId) {
    return {
      ok: false,
      status: 400,
      error: "source_proof_mismatch",
      message: "Verified source proof was created for a different market.",
    };
  }

  const expectedSourceUrl = normalizeComparableUrl(market.sourceUrl);
  const proofSourceUrl =
    typeof binding.sourceUrl === "string" ? normalizeComparableUrl(binding.sourceUrl) : null;
  if (!expectedSourceUrl || proofSourceUrl !== expectedSourceUrl) {
    return {
      ok: false,
      status: 400,
      error: "source_proof_mismatch",
      message: "Verified source proof was created for a different source URL.",
    };
  }

  if (binding.chainId !== undefined && binding.chainId !== null && Number(binding.chainId) !== chainId) {
    return {
      ok: false,
      status: 400,
      error: "source_proof_mismatch",
      message: "Verified source proof was created for a different chain.",
    };
  }

  if (typeof binding.poolAddress === "string" && binding.poolAddress.toLowerCase() !== pool.toLowerCase()) {
    return {
      ok: false,
      status: 400,
      error: "source_proof_mismatch",
      message: "Verified source proof was created for a different pool.",
    };
  }

  if (market.chainId !== undefined && market.chainId !== null && Number(market.chainId) !== chainId) {
    return {
      ok: false,
      status: 400,
      error: "market_chain_mismatch",
      message: "Selected market chain does not match the requested resolution chain.",
    };
  }

  if (market.poolAddress && market.poolAddress.toLowerCase() !== pool.toLowerCase()) {
    return {
      ok: false,
      status: 400,
      error: "market_pool_mismatch",
      message: "Selected market pool does not match the requested resolution pool.",
    };
  }

  return { ok: true, market };
}

function canonicalResolutionQuestion(market: MarketProofConfig): string | null {
  const title = market.title?.trim();
  if (!title) return null;
  const criteria = market.resolutionCriteria?.trim();
  const source = market.sourceUrl?.trim();
  return [
    `Market question: ${title}`,
    criteria ? `Resolution criteria: ${criteria}` : "",
    source ? `Canonical source URL: ${source}` : "",
  ].filter(Boolean).join("\n");
}

function extractPariaiProofBinding(proof: unknown): ProofBindingContext | null {
  const raw = topLevelClaimContext(proof);
  if (!raw) return null;
  const parsed = parseContext(raw);
  const adjudex = parsed?.adjudex;
  return adjudex && typeof adjudex === "object" && !Array.isArray(adjudex)
    ? (adjudex as ProofBindingContext)
    : null;
}

function topLevelClaimContext(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const claimData = record.claimData;
  if (claimData && typeof claimData === "object" && !Array.isArray(claimData)) {
    const context = (claimData as Record<string, unknown>).context;
    if (typeof context === "string") return context;
  }
  const proof = record.proof;
  if (proof && typeof proof === "object" && !Array.isArray(proof)) {
    const proofClaimData = (proof as Record<string, unknown>).claimData;
    if (proofClaimData && typeof proofClaimData === "object" && !Array.isArray(proofClaimData)) {
      const context = (proofClaimData as Record<string, unknown>).context;
      if (typeof context === "string") return context;
    }
  }
  return null;
}

function parseContext(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeComparableUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return null;
  }
}

function supportedJudgeChainIds(): Set<number> {
  const configured = readChainIdList("JUDGE_SUPPORTED_CHAIN_IDS");
  if (configured.size > 0) return configured;

  const ids = new Set<number>([421614]);
  const rhcChainId = readPositiveIntegerEnv("NEXT_PUBLIC_RHC_CHAIN_ID")
    ?? readPositiveIntegerEnv("RHC_CHAIN_ID")
    ?? 46630;
  ids.add(rhcChainId);

  const legacyJudgeChainId = readPositiveIntegerEnv("JUDGE_CHAIN_ID");
  if (legacyJudgeChainId) ids.add(legacyJudgeChainId);

  return ids;
}

function readChainIdList(name: string): Set<number> {
  const raw = process.env[name]?.trim();
  if (!raw) return new Set();
  const ids = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return new Set(ids);
}

function readPositiveIntegerEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
