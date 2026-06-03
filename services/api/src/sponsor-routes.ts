import type { FastifyInstance } from "fastify";
import { duneQueryTemplates, fetchDuneSummary, fetchGmxMarkets, fetchGmxSignal, fhenixPrototypeStatus, sponsorStatuses, zeroDevSessionPolicy } from "./sponsor-integrations";

export function registerSponsorIntegrationRoutes(server: FastifyInstance): void {
  server.get("/api/integrations/sponsors", async () => sponsorStatuses());

  server.get("/api/integrations/dune/summary", async () => fetchDuneSummary());

  server.get("/api/integrations/dune/templates", async () => duneQueryTemplates());

  server.get("/api/integrations/zerodev/session-policy", async () => zeroDevSessionPolicy());

  server.get("/api/integrations/fhenix/prototype", async () => fhenixPrototypeStatus());

  server.get<{ Querystring: { limit?: string } }>("/api/integrations/gmx/markets", async (request, reply) => {
    try {
      const limit = Number(request.query.limit ?? "12");
      return await fetchGmxMarkets(Number.isFinite(limit) ? limit : 12);
    } catch (error) {
      request.log.warn({ err: error }, "GMX market fetch failed");
      return reply.code(502).send({
        configured: true,
        error: "gmx_request_failed",
        message: error instanceof Error ? error.message : "GMX SDK request failed.",
      });
    }
  });

  server.get<{ Querystring: { symbol?: string; marketTokenAddress?: string; limit?: string } }>("/api/integrations/gmx/signal", async (request, reply) => {
    const symbol = (request.query.symbol ?? "").trim();
    const marketTokenAddress = request.query.marketTokenAddress?.trim();
    if (!symbol && !marketTokenAddress) return reply.code(400).send({ error: "symbol_or_market_required" });
    try {
      const limit = Number(request.query.limit ?? "24");
      return await fetchGmxSignal(symbol, {
        marketTokenAddress,
        limit: Number.isFinite(limit) ? limit : 24,
      });
    } catch (error) {
      request.log.warn({ err: error }, "GMX signal fetch failed");
      return reply.code(502).send({
        configured: true,
        found: false,
        error: "gmx_request_failed",
        message: error instanceof Error ? error.message : "GMX SDK request failed.",
      });
    }
  });
}
