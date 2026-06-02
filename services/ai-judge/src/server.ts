// PariAI AI Judge - Fastify worker that signs a market verdict.
//
// Modes:
//   server: uses JUDGE_PRIVATE_KEY env in a managed backend worker.
//   phala: when running inside a Phala CVM, derives a deterministic ECDSA key
//          via dstack-sdk and binds the verdict digest into a TDX quote.

import Fastify from "fastify";
import {
  concat,
  encodeAbiParameters,
  keccak256,
  stringToBytes,
  toHex,
  type Hex,
  type Address,
} from "viem";
import { signer, type SignerHandle } from "./signer.js";

const PORT = Number(process.env.JUDGE_PORT ?? 8090);
const HOST = process.env.JUDGE_HOST ?? "127.0.0.1";
const CHAIN_ID = Number(process.env.JUDGE_CHAIN_ID ?? 421614);
const SUPPORTED_CHAIN_IDS = supportedChainIds();
const MODE = (process.env.JUDGE_MODE ?? "phala") as "server" | "phala";

type ResolveBody = {
  pool: Address;
  marketId: string | number;
  chainId: number;
  sourceProofHash: Hex;
};

type MarketProofConfig = {
  title?: string | null;
  sourceUrl?: string | null;
  poolAddress?: string | null;
  chainId?: number | null;
  resolutionCriteria?: string | null;
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

function digest(
  chainId: number,
  pool: Address,
  marketId: bigint,
  outcome: 0 | 1,
  evidenceHash: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "bytes32" },
      ],
      [BigInt(chainId), pool, marketId, outcome, evidenceHash as `0x${string}`],
    ),
  );
}

function parseMarketContractId(marketId: string | number) {
  const raw = String(marketId).split(":").at(-1);
  if (!raw || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

function backendUrl() {
  const configured = process.env.JUDGE_BACKEND_API_URL?.trim() || process.env.BACKEND_API_URL?.trim();
  return configured ? configured.replace(/\/$/, "") : null;
}

async function getCanonicalMarket(marketId: string | number): Promise<MarketProofConfig> {
  const baseUrl = backendUrl();
  if (!baseUrl) throw new Error("market_config_backend_not_configured");

  const response = await fetch(`${baseUrl}/api/markets/${encodeURIComponent(String(marketId))}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`market_config_read_failed:${response.status}:${await response.text()}`);
  }
  return (await response.json()) as MarketProofConfig;
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

async function start() {
  const app = Fastify({ logger: { level: "info" } });
  const handle: SignerHandle = await signer(MODE);
  app.log.info(
    { mode: handle.mode, signer: handle.address, attestation: !!handle.attest },
    "AI judge ready",
  );

  app.get("/signer", async () => ({
    mode: handle.mode,
    signer: handle.address,
    chainId: CHAIN_ID,
  }));

  app.post<{ Body: ResolveBody }>("/resolve", async (req, reply) => {
    const remoteSecret = process.env.JUDGE_REMOTE_SECRET;
    if (!remoteSecret) {
      return reply.code(503).send({ error: "remote_secret_not_configured" });
    }
    if (req.headers.authorization !== `Bearer ${remoteSecret}`) {
      return reply.code(401).send({ error: "remote_secret_required" });
    }
    const body = req.body ?? ({} as ResolveBody);
    if ("question" in body || "context" in body) {
      return reply.code(400).send({
        error: "caller_prompt_not_allowed",
        message: "Remote judge resolves only canonical backend market data, not caller-supplied prompts.",
      });
    }
    const { pool, marketId, chainId, sourceProofHash } = body;
    if (!pool || marketId === undefined || !chainId || !sourceProofHash) {
      return reply.code(400).send({ error: "pool, marketId, chainId, sourceProofHash required" });
    }
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      return reply.code(400).send({ error: "chain_id_invalid" });
    }
    if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
      return reply
        .code(400)
        .send({ error: "chain_not_supported", supportedChainIds: [...SUPPORTED_CHAIN_IDS] });
    }
    const contractMarketId = parseMarketContractId(marketId);
    if (contractMarketId === null) {
      return reply.code(400).send({ error: "market_id_invalid" });
    }

    let market: MarketProofConfig;
    try {
      market = await getCanonicalMarket(marketId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "market_config_read_failed";
      return reply.code(message === "market_config_backend_not_configured" ? 503 : 502).send({
        error: message === "market_config_backend_not_configured"
          ? "market_config_backend_not_configured"
          : "market_config_read_failed",
        message,
      });
    }
    if (market.chainId !== undefined && market.chainId !== null && Number(market.chainId) !== chainId) {
      return reply.code(400).send({ error: "market_chain_mismatch" });
    }
    if (market.poolAddress && market.poolAddress.toLowerCase() !== pool.toLowerCase()) {
      return reply.code(400).send({ error: "market_pool_mismatch" });
    }
    if (!market.sourceUrl?.trim()) {
      return reply.code(400).send({ error: "market_source_required" });
    }
    const canonicalQuestion = canonicalResolutionQuestion(market);
    if (!canonicalQuestion) {
      return reply.code(400).send({ error: "market_question_required" });
    }
    const context = `Verified zkTLS proof hash: ${sourceProofHash}`;

    let claudeResult: Awaited<ReturnType<typeof askClaude>>;
    try {
      claudeResult = await askClaude(canonicalQuestion, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : "provider_request_failed";
      return reply
        .code(message.startsWith("provider_not_configured") ? 503 : 502)
        .send({
          error: message.startsWith("provider_not_configured") ? "provider_not_configured" : "provider_request_failed",
          message,
        });
    }

    const outcome: 0 | 1 = claudeResult.outcome;
    const reasoning = claudeResult.reasoning;
    const reasoningHash = keccak256(stringToBytes(reasoning));
    const evidenceHash = keccak256(concat([reasoningHash, sourceProofHash]));
    const inner = digest(chainId, pool, contractMarketId, outcome, evidenceHash);
    const signature = await handle.signDigest(inner);
    const attestation = handle.attest ? await handle.attest(inner) : null;

    return {
      pool,
      marketId: String(marketId),
      outcome,
      outcomeLabel: outcome === 0 ? "YES" : "NO",
      evidenceHash,
      reasoning,
      canonicalQuestion,
      signature,
      signer: handle.address,
      chainId,
      issuedAtIso: new Date().toISOString(),
      digest: toHex(inner),
      mode: handle.mode,
      attestation,
    };
  });

  await app.listen({ port: PORT, host: HOST });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

function supportedChainIds(): Set<number> {
  const configured = process.env.JUDGE_SUPPORTED_CHAIN_IDS?.trim();
  if (configured) {
    return new Set(
      configured
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    );
  }
  return new Set([CHAIN_ID]);
}
