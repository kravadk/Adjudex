import { keccak256, toBytes } from "viem";
import { validateMarketDraft } from "./market-validation";

export type ImportSource = {
  id: string;
  name: string;
  kind: "rss" | "json";
  url: string;
  category: "stocks" | "crypto" | "sports" | "soft" | "esports";
  oracleType: "chainlink-price" | "zktls-ai-oracle" | "manual";
  active: boolean;
};

export type EsportsGame =
  | "cs2"
  | "dota2"
  | "lol"
  | "valorant"
  | "r6"
  | "overwatch"
  | "rocket-league"
  | "starcraft2"
  | "call-of-duty"
  | "other";

const ESPORTS_GAMES: EsportsGame[] = [
  "cs2",
  "dota2",
  "lol",
  "valorant",
  "r6",
  "overwatch",
  "rocket-league",
  "starcraft2",
  "call-of-duty",
  "other",
];

export type RawImportEvent = {
  title: string;
  sourceUrl: string;
  publishedAtIso?: string;
  eventDateIso?: string;
  category?: ImportSource["category"];
  question?: string;
  description?: string;
  resolutionCriteria?: string;
  // Esports-specific opt-in fields. Populated when a JSON source feeds
  // PandaScore-shaped rows (matches with opponents + tournament + videogame).
  // For non-esports rows these stay undefined and downstream code ignores them.
  game?: EsportsGame;
  tournament?: string;
  teamA?: string;
  teamB?: string;
  streamUrl?: string;
  bestOfMaps?: number;
};

export type ImportCandidateDraft = {
  id: string;
  sourceId: string;
  title: string;
  sourceUrl: string;
  sourcePublishedAtIso?: string;
  eventDateIso?: string;
  category: ImportSource["category"];
  question: string;
  description: string;
  oracleType: ImportSource["oracleType"];
  asset: "USDC";
  deadlineIso?: string;
  resolutionCriteria?: string;
  confidence: number;
  status: "needs_review" | "rejected";
  riskFlags: string[];
  game?: EsportsGame;
  tournament?: string;
  teamA?: string;
  teamB?: string;
  streamUrl?: string;
  bestOfMaps?: number;
};

export type ImportCandidateSpec = {
  title: string;
  description: string;
  category: ImportSource["category"];
  oracleType: ImportSource["oracleType"];
  asset: "USDC";
  deadlineIso: string;
  feeBps: number;
  sourceUrl: string;
  resolutionCriteria: string;
};

export function configuredImportSources(): ImportSource[] {
  const raw = process.env.IMPORT_SOURCE_URLS?.trim();
  if (!raw) return [];

  const parsed = parseJsonSources(raw) ?? parseDelimitedSources(raw);
  return parsed.filter((source) => source.active);
}

export async function scanImportSource(source: ImportSource): Promise<ImportCandidateDraft[]> {
  const response = await fetch(source.url, {
    headers: { accept: "application/feed+json, application/json, application/rss+xml, application/atom+xml, text/xml;q=0.9, */*;q=0.1" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`source_fetch_failed:${response.status}`);
  }

  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const rawEvents =
    source.kind === "json" || contentType.includes("json") || body.trim().startsWith("{") || body.trim().startsWith("[")
      ? parseJsonEvents(body)
      : parseFeedEvents(body);

  return rawEvents
    .filter((event) => event.sourceUrl)
    .map((event) => normalizeEvent(source, event));
}

export function validateImportCandidate(input: {
  question: string;
  description: string;
  category: string;
  oracleType: string;
  asset: string;
  deadlineIso?: string;
  sourceUrl: string;
  resolutionCriteria?: string | null;
  riskFlags: string[];
}): { ok: boolean; errors: string[]; spec?: ImportCandidateSpec; specHash?: string; specUri?: string } {
  const errors: string[] = [];
  const fatalRiskFlags = new Set([
    "source_url_missing",
    "deadline_missing",
    "deadline_not_future",
    "resolution_criteria_missing",
    "oracle_path_missing",
    "generated_question_needs_review",
  ]);
  for (const flag of input.riskFlags) {
    if (fatalRiskFlags.has(flag)) errors.push(flag);
  }

  const validation = validateMarketDraft({
    title: input.question,
    description: input.description,
    category: input.category,
    oracleType: input.oracleType,
    asset: input.asset,
    deadlineIso: input.deadlineIso,
    feeBps: 100,
    sourceUrl: input.sourceUrl,
    resolutionCriteria: input.resolutionCriteria ?? undefined,
  });
  errors.push(...validation.errors);
  if (errors.length > 0 || !input.deadlineIso || !input.resolutionCriteria) {
    return { ok: false, errors: Array.from(new Set(errors)) };
  }

  const spec: ImportCandidateSpec = {
    title: input.question,
    description: input.description,
    category: input.category as ImportCandidateSpec["category"],
    oracleType: input.oracleType as ImportCandidateSpec["oracleType"],
    asset: "USDC",
    deadlineIso: input.deadlineIso,
    feeBps: 100,
    sourceUrl: input.sourceUrl,
    resolutionCriteria: input.resolutionCriteria,
  };
  const specJson = JSON.stringify(spec);
  const specHash = keccak256(toBytes(specJson));
  const specUri = `data:application/json;base64,${Buffer.from(specJson, "utf8").toString("base64")}`;
  return { ok: true, errors: [], spec, specHash, specUri };
}

function normalizeEvent(source: ImportSource, event: RawImportEvent): ImportCandidateDraft {
  const riskFlags: string[] = [];
  const cleanTitle = normalizeWhitespace(event.title);
  const question = event.question?.trim() || questionFromTitle(cleanTitle);
  if (!event.question?.trim()) riskFlags.push("generated_question_needs_review");

  const deadlineIso = deadlineFromEvent(event);
  if (!deadlineIso) riskFlags.push("deadline_missing");
  else if (new Date(deadlineIso).getTime() <= Date.now()) riskFlags.push("deadline_not_future");

  if (!event.sourceUrl) riskFlags.push("source_url_missing");
  if (!event.resolutionCriteria?.trim()) riskFlags.push("resolution_criteria_missing");
  if (!source.oracleType) riskFlags.push("oracle_path_missing");

  const status = riskFlags.includes("deadline_missing") || riskFlags.includes("deadline_not_future") ? "rejected" : "needs_review";
  const confidence = Math.max(0.1, 0.9 - riskFlags.length * 0.18);

  return {
    id: stableId(`${source.id}:${event.sourceUrl}:${cleanTitle}`),
    sourceId: source.id,
    title: cleanTitle,
    sourceUrl: event.sourceUrl,
    sourcePublishedAtIso: event.publishedAtIso,
    eventDateIso: event.eventDateIso,
    category: event.category ?? source.category,
    question,
    description: event.description?.trim() || `Imported from ${source.name}. Source URL is included for verification.`,
    oracleType: source.oracleType,
    asset: "USDC",
    deadlineIso,
    resolutionCriteria: event.resolutionCriteria?.trim(),
    confidence,
    status,
    riskFlags,
    game: event.game,
    tournament: event.tournament,
    teamA: event.teamA,
    teamB: event.teamB,
    streamUrl: event.streamUrl,
    bestOfMaps: event.bestOfMaps,
  };
}

function parseJsonSources(raw: string): ImportSource[] | null {
  try {
    const data = JSON.parse(raw) as unknown;
    const rows = Array.isArray(data) ? data : [data];
    return rows.map((row, index) => {
      const value = row as Partial<ImportSource> & { type?: string };
      return normalizeSource({
        id: value.id ?? `source-${index + 1}`,
        name: value.name ?? value.id ?? `Source ${index + 1}`,
        kind: (value.kind ?? value.type ?? "rss") as ImportSource["kind"],
        url: value.url ?? "",
        category: value.category ?? "soft",
        oracleType: value.oracleType ?? "manual",
        active: value.active ?? true,
      });
    });
  } catch {
    return null;
  }
}

function parseDelimitedSources(raw: string): ImportSource[] {
  return raw
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [id, name, kind, url, category, oracleType] = line.includes("|")
        ? line.split("|").map((part) => part.trim())
        : [`source-${index + 1}`, `Source ${index + 1}`, "rss", line, "soft", "manual"];
      return normalizeSource({
        id: id || `source-${index + 1}`,
        name: name || id || `Source ${index + 1}`,
        kind: (kind || "rss") as ImportSource["kind"],
        url,
        category: (category || "soft") as ImportSource["category"],
        oracleType: (oracleType || "manual") as ImportSource["oracleType"],
        active: true,
      });
    });
}

function normalizeSource(source: ImportSource): ImportSource {
  return {
    id: slug(source.id),
    name: source.name,
    kind: source.kind === "json" ? "json" : "rss",
    url: source.url,
    category: ["stocks", "crypto", "sports", "soft", "esports"].includes(source.category) ? source.category : "soft",
    oracleType: ["chainlink-price", "zktls-ai-oracle", "manual"].includes(source.oracleType) ? source.oracleType : "manual",
    active: source.active !== false,
  };
}

function parseJsonEvents(raw: string): RawImportEvent[] {
  const data = JSON.parse(raw) as unknown;
  const rows = Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown[] }).items)
      ? (data as { items: unknown[] }).items
      : Array.isArray((data as { events?: unknown[] }).events)
        ? (data as { events: unknown[] }).events
        : Array.isArray((data as { data?: unknown[] }).data)
          ? (data as { data: unknown[] }).data
          : [];

  return rows
    .map((row) => row as Record<string, unknown>)
    .map((row) => {
      const esports = extractEsportsFields(row);
      const title =
        stringField(row, "title", "name", "eventName") ||
        (esports.teamA && esports.teamB
          ? `${esports.teamA} vs ${esports.teamB}${esports.tournament ? ` · ${esports.tournament}` : ""}`
          : "");
      return {
        title,
        sourceUrl:
          stringField(row, "sourceUrl", "url", "link", "external_url") ||
          esports.streamUrl ||
          "",
        publishedAtIso: dateField(row, "publishedAt", "published_at", "date_published", "pubDate"),
        eventDateIso:
          dateField(row, "eventDate", "event_date", "deadline", "date") ??
          dateField(row, "scheduled_at", "begin_at", "begins_at", "starts_at"),
        category: categoryField(row.category) ?? (esports.game ? ("esports" as const) : undefined),
        question: stringField(row, "question"),
        description: stringField(row, "description", "summary", "content_text"),
        resolutionCriteria: stringField(row, "resolutionCriteria", "resolution_criteria", "criteria"),
        game: esports.game,
        tournament: esports.tournament,
        teamA: esports.teamA,
        teamB: esports.teamB,
        streamUrl: esports.streamUrl,
        bestOfMaps: esports.bestOfMaps,
      };
    })
    .filter((event) => event.title && event.sourceUrl);
}

// PandaScore-style match rows: { opponents: [{opponent: {name}}, ...],
// videogame: {slug}, league: {name}, serie: {full_name}, streams_list:
// [{embed_url, main}], number_of_games }. Falls back to flat shape too.
function extractEsportsFields(row: Record<string, unknown>): {
  game?: EsportsGame;
  tournament?: string;
  teamA?: string;
  teamB?: string;
  streamUrl?: string;
  bestOfMaps?: number;
} {
  const opponents = Array.isArray(row.opponents) ? row.opponents : null;
  let teamA: string | undefined;
  let teamB: string | undefined;
  if (opponents && opponents.length >= 1) {
    const a = (opponents[0] as Record<string, unknown>)?.opponent as
      | Record<string, unknown>
      | undefined;
    const b = (opponents[1] as Record<string, unknown> | undefined)?.opponent as
      | Record<string, unknown>
      | undefined;
    teamA = stringFromMaybe(a?.name) || stringFromMaybe(a?.acronym);
    teamB = stringFromMaybe(b?.name) || stringFromMaybe(b?.acronym);
  }
  teamA = teamA || stringField(row, "teamA", "team_a", "home", "team_home");
  teamB = teamB || stringField(row, "teamB", "team_b", "away", "team_away");

  let game: EsportsGame | undefined;
  const videogame = row.videogame as Record<string, unknown> | undefined;
  const vgSlug = stringFromMaybe(videogame?.slug) || stringField(row, "game", "videogame_slug");
  if (vgSlug) {
    const normalized = mapEsportsGameSlug(vgSlug);
    if (normalized) game = normalized;
  }

  const league = row.league as Record<string, unknown> | undefined;
  const serie = row.serie as Record<string, unknown> | undefined;
  const leagueName = stringFromMaybe(league?.name) || stringField(row, "league_name");
  const serieName = stringFromMaybe(serie?.full_name) || stringFromMaybe(serie?.name);
  const tournament =
    [leagueName, serieName].filter(Boolean).join(" · ") ||
    stringField(row, "tournament", "event") ||
    undefined;

  let streamUrl: string | undefined;
  const streams = row.streams_list as unknown[] | undefined;
  if (Array.isArray(streams) && streams.length) {
    const main = streams.find((s) => (s as Record<string, unknown>)?.main) ?? streams[0];
    streamUrl = stringFromMaybe((main as Record<string, unknown>)?.embed_url);
  }
  streamUrl = streamUrl || stringField(row, "streamUrl", "stream_url", "watchUrl");

  const bestOfRaw = row.number_of_games ?? row.best_of ?? row.bestOf;
  const bestOfMaps =
    typeof bestOfRaw === "number" && Number.isFinite(bestOfRaw) && bestOfRaw > 0
      ? Math.floor(bestOfRaw)
      : undefined;

  return {
    game,
    tournament: tournament || undefined,
    teamA: teamA || undefined,
    teamB: teamB || undefined,
    streamUrl: streamUrl || undefined,
    bestOfMaps,
  };
}

function mapEsportsGameSlug(value: string): EsportsGame | undefined {
  const v = value.toLowerCase().trim();
  if (!v) return undefined;
  if (ESPORTS_GAMES.includes(v as EsportsGame)) return v as EsportsGame;
  if (v === "csgo" || v === "cs" || v === "counter-strike" || v === "counter-strike-2") return "cs2";
  if (v === "dota" || v === "dota-2") return "dota2";
  if (v === "league-of-legends" || v === "leagueoflegends") return "lol";
  if (v === "val" || v === "valorant-vct") return "valorant";
  if (v === "rainbow-six-siege" || v === "rainbow6" || v === "r6s") return "r6";
  if (v === "ow2" || v === "overwatch-2") return "overwatch";
  if (v === "rl") return "rocket-league";
  if (v === "sc2" || v === "starcraft") return "starcraft2";
  if (v === "cod" || v === "modern-warfare" || v === "warzone") return "call-of-duty";
  return undefined;
}

function stringFromMaybe(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseFeedEvents(raw: string): RawImportEvent[] {
  const chunks = raw.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return chunks
    .map((chunk) => {
      const sourceUrl = xmlText(chunk, "link") || xmlAttr(chunk, "link", "href") || "";
      return {
        title: xmlText(chunk, "title"),
        sourceUrl,
        publishedAtIso: parseDate(xmlText(chunk, "pubDate") || xmlText(chunk, "published") || xmlText(chunk, "updated")),
        description: stripTags(xmlText(chunk, "description") || xmlText(chunk, "summary") || xmlText(chunk, "content")),
      };
    })
    .filter((event) => event.title && event.sourceUrl);
}

function deadlineFromEvent(event: RawImportEvent): string | undefined {
  if (!event.eventDateIso) return undefined;
  const date = new Date(event.eventDateIso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function questionFromTitle(title: string): string {
  const stripped = title.replace(/[?.!]+$/g, "").trim();
  return `Will ${stripped}?`;
}

function stableId(input: string): string {
  return `imp-${keccak256(toBytes(input)).slice(2, 18)}`;
}

function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "source";
}

function stringField(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function dateField(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value !== "string" && typeof value !== "number") continue;
    const parsed = parseDate(String(value));
    if (parsed) return parsed;
  }
  return undefined;
}

function categoryField(value: unknown): ImportSource["category"] | undefined {
  return typeof value === "string" && ["stocks", "crypto", "sports", "soft", "esports"].includes(value)
    ? (value as ImportSource["category"])
    : undefined;
}

function parseDate(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function xmlText(chunk: string, tag: string): string {
  const match = chunk.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(stripCdata(match[1]).trim()) : "";
}

function xmlAttr(chunk: string, tag: string, attr: string): string {
  const match = chunk.match(new RegExp(`<${tag}\\b[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function stripTags(value: string): string {
  return decodeXml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
