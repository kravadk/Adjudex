#!/usr/bin/env node
// Adjudex MCP server. Exposes the public read API as Model Context Protocol
// tools so AI agents can discover and reason over Adjudex markets without
// bespoke integration. Read-only by design — placing bets requires a wallet
// signature, which stays client-side.
//
// Config: ADJUDEX_API_URL (default https://adjudex.xyz).
// Run: pnpm --filter @adjudex/mcp-server build && node dist/index.js
//   or: pnpm --filter @adjudex/mcp-server dev

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.ADJUDEX_API_URL ?? "https://adjudex.xyz").replace(/\/$/, "");

async function api(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`adjudex_api_${res.status}: ${path}`);
  return res.json();
}

function asText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: "adjudex", version: "0.1.0" });

server.tool(
  "list_markets",
  "List Adjudex prediction markets. Optionally filter by category, hot-only, or a text query.",
  {
    category: z.enum(["stocks", "crypto", "sports", "esports", "soft"]).optional(),
    hotOnly: z.boolean().optional(),
    query: z.string().optional(),
  },
  async ({ category, hotOnly, query }) => {
    const qs = new URLSearchParams();
    if (category) qs.set("category", category);
    if (hotOnly) qs.set("hotOnly", "1");
    if (query) qs.set("query", query);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return asText(await api(`/api/markets${suffix}`));
  },
);

server.tool(
  "get_market",
  "Get full detail for one market by id (title, probability, pool, deadline, resolution).",
  { id: z.string() },
  async ({ id }) => asText(await api(`/api/markets/${encodeURIComponent(id)}`)),
);

server.tool(
  "get_market_comments",
  "Get the discussion thread for a market.",
  { id: z.string() },
  async ({ id }) => asText(await api(`/api/markets/${encodeURIComponent(id)}/comments`)),
);

server.tool(
  "get_market_timeline",
  "Get the probability-over-time series for a market (for charting / trend analysis).",
  { id: z.string() },
  async ({ id }) => asText(await api(`/api/markets/${encodeURIComponent(id)}/timeline`)),
);

server.tool(
  "get_leaderboard",
  "Get the trader/agent leaderboard ranked by realized PnL.",
  { pool: z.enum(["humans", "ai", "combined"]).optional() },
  async ({ pool }) => asText(await api(`/api/leaderboard${pool ? `?pool=${pool}` : ""}`)),
);

server.tool(
  "get_trader",
  "Get a trader's public profile (PnL, volume, win rate, follower counts).",
  { address: z.string() },
  async ({ address }) => asText(await api(`/api/users/${encodeURIComponent(address)}`)),
);

server.tool(
  "get_agents",
  "List registered AI market-maker / resolver agents and their reputation.",
  {},
  async () => asText(await api(`/api/agents`)),
);

server.tool(
  "get_status",
  "Get platform readiness: chain RPC health, indexer lag, factory config.",
  {},
  async () => asText(await api(`/api/status`)),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr so it doesn't corrupt the stdio protocol on stdout.
  console.error(`[adjudex-mcp] connected. API base: ${BASE}`);
}

main().catch((err) => {
  console.error("[adjudex-mcp] fatal:", err);
  process.exit(1);
});
