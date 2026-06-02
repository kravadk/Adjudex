import { proxyToBackend } from "@/lib/server/backend-api";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export async function POST(request: Request) {
  const limit = checkRateLimit({
    bucket: "sync:transaction",
    request,
    limit: 20,
    windowMs: 60_000,
  });
  if (!limit.ok) return rateLimitResponse(limit);
  return proxyToBackend(request, "/api/sync/transaction");
}
