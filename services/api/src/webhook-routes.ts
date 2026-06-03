import type { FastifyInstance } from "fastify";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookSubscriptions,
} from "./webhooks";

type Session = {
  address: string;
  chainId?: number;
  domain?: string;
};

type RouteDeps = {
  requireSession(cookieHeader: string | undefined): Promise<Session | null>;
};

export function registerWebhookRoutes(server: FastifyInstance, deps: RouteDeps): void {
  server.get("/api/webhooks", async (request, reply) => {
    const session = await deps.requireSession(request.headers.cookie);
    if (!session) return reply.code(401).send({ error: "auth_required" });
    return listWebhookSubscriptions(session.address);
  });

  server.post<{ Body: { url?: unknown; eventTypes?: unknown } }>(
    "/api/webhooks",
    async (request, reply) => {
      const session = await deps.requireSession(request.headers.cookie);
      if (!session) return reply.code(401).send({ error: "auth_required" });

      const result = await createWebhookSubscription(session.address, request.body ?? {});
      if (!result.ok) return reply.code(400).send({ error: result.error });

      return reply.code(201).send(result.subscription);
    },
  );

  server.delete<{ Params: { id: string } }>("/api/webhooks/:id", async (request, reply) => {
    const session = await deps.requireSession(request.headers.cookie);
    if (!session) return reply.code(401).send({ error: "auth_required" });

    const deleted = await deleteWebhookSubscription(request.params.id, session.address);
    if (!deleted) return reply.code(404).send({ error: "webhook_not_found" });
    return { id: request.params.id, deleted: true };
  });
}
