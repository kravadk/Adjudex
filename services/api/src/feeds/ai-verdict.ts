// Independent AI-judge cross-check for hybrid resolution of mirror markets.
//
// When the resolve worker is about to propose a market whose source mirrors a
// third-party prediction market (Polymarket), it first asks Claude to audit
// the reported outcome. The AI is a guardrail, NOT a competing oracle: it
// only blocks ("dispute") when the reported outcome plainly contradicts the
// question or well-established facts. If it lacks current information it
// answers "uncertain" and the mirror proceeds. This catches mis-parsed /
// mis-mapped outcomes without stalling resolvable markets.
//
// Env:
//   ANTHROPIC_API_KEY            required to run the check (else pure mirror)
//   POLYMARKET_HYBRID_RESOLUTION=0   force-disable the cross-check
//   AI_VERDICT_MODEL             optional model override

const DEFAULT_MODEL = "claude-sonnet-4-6";

export type AiVerdict = "confirm" | "dispute" | "uncertain";

export type AiCrossCheck = {
  verdict: AiVerdict;
  reasoning: string;
  model: string;
};

// Hybrid cross-check runs only when an Anthropic key is present and it was not
// explicitly disabled. No key → fall back to pure mirror (Phase 1 behaviour).
export function hybridResolutionEnabled(): boolean {
  if (process.env.POLYMARKET_HYBRID_RESOLUTION === "0") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function model(): string {
  return process.env.AI_VERDICT_MODEL?.trim() || DEFAULT_MODEL;
}

// Pull the first balanced JSON object out of a model response that may be
// wrapped in prose or code fences.
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function normalizeVerdict(raw: unknown): AiVerdict {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "dispute") return "dispute";
  if (v === "confirm") return "confirm";
  return "uncertain";
}

// Returns null when no API key is configured (caller treats as pure mirror).
// Throws on transient network/HTTP errors so the caller can retry next tick.
// A parse failure resolves to "uncertain" (never blocks resolution).
export async function aiCrossCheck(input: {
  question: string;
  claimedOutcome: "YES" | "NO";
  resolutionCriteria?: string | null;
}): Promise<AiCrossCheck | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;

  const sys =
    "You audit prediction-market resolutions. You are given a YES/NO question " +
    "and the outcome that an external source (Polymarket) reports it resolved " +
    'to. Respond with strict JSON {"verdict":"confirm"|"dispute"|"uncertain",' +
    '"reasoning":"..."} and nothing else. Use "dispute" ONLY when the reported ' +
    "outcome plainly contradicts the question's meaning or well-established " +
    'facts. If you lack current information to verify the result, answer ' +
    '"uncertain" — never "dispute".';

  const userMsg = [
    `Question: ${input.question}`,
    input.resolutionCriteria ? `Resolution criteria: ${input.resolutionCriteria}` : "",
    `External source (Polymarket) reports outcome: ${input.claimedOutcome}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model(),
      max_tokens: 400,
      system: sys,
      messages: [{ role: "user", content: userMsg }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`ai_crosscheck_failed:${res.status}`);
  }

  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  const json = extractJson(text);
  if (!json) {
    return { verdict: "uncertain", reasoning: `unparsable_response: ${text.slice(0, 200)}`, model: model() };
  }
  try {
    const parsed = JSON.parse(json) as { verdict?: unknown; reasoning?: unknown };
    return {
      verdict: normalizeVerdict(parsed.verdict),
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      model: model(),
    };
  } catch {
    return { verdict: "uncertain", reasoning: `unparsable_json: ${text.slice(0, 200)}`, model: model() };
  }
}
