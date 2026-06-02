// Lightweight in-memory rate limiter. One bucket per `(ip, scope)` —
// `scope` lets callers group routes (e.g. "write", "read", "auth") so a
// burst on quotes does not starve health checks.
//
// Buildathon-grade. Production behind multiple Fastify instances should
// swap to Redis (token bucket) — the public API is small enough that
// callers won't need to change.

import type { FastifyReply, FastifyRequest } from "fastify";
import { isRedisConfigured, redisCommand, redisPipeline } from "./redis";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitConfig = {
  scope: string;
  limit: number;
  windowMs: number;
};

function clientIp(req: FastifyRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0];
  return req.ip ?? "unknown";
}

export async function rateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  config: RateLimitConfig,
): Promise<boolean> {
  if (process.env.RATE_LIMIT_BACKEND === "redis") {
    return redisRateLimit(req, reply, config);
  }

  return memoryRateLimit(req, reply, config);
}

async function memoryRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  config: RateLimitConfig,
): Promise<boolean> {
  const key = `${clientIp(req)}::${config.scope}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + config.windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > config.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    reply.header("Retry-After", String(retryAfterSeconds));
    reply.code(429).send({
      error: "rate_limited",
      scope: config.scope,
      retryAfterSeconds,
    });
    return false;
  }
  reply.header("X-RateLimit-Limit", String(config.limit));
  reply.header(
    "X-RateLimit-Remaining",
    String(Math.max(0, config.limit - bucket.count)),
  );
  return true;
}

async function redisRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  config: RateLimitConfig,
): Promise<boolean> {
  if (!isRedisConfigured()) {
    reply.code(503).send({
      error: "redis_rate_limit_not_configured",
      message: "RATE_LIMIT_BACKEND=redis requires REDIS_REST_URL and REDIS_REST_TOKEN.",
    });
    return false;
  }

  const key = `rl:${config.scope}:${clientIp(req)}`;
  const pipeline = await redisPipeline<number>([
    ["INCR", key],
    ["PTTL", key],
  ]);
  const count = Number(pipeline?.[0]?.result ?? 0);
  const ttlMs = Number(pipeline?.[1]?.result ?? -1);
  if (count === 1 || ttlMs < 0) {
    await redisCommand(["PEXPIRE", key, config.windowMs]);
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : config.windowMs) / 1000));
  if (count > config.limit) {
    reply.header("Retry-After", String(retryAfterSeconds));
    reply.header("X-RateLimit-Backend", "redis");
    reply.code(429).send({
      error: "rate_limited",
      scope: config.scope,
      retryAfterSeconds,
    });
    return false;
  }

  reply.header("X-RateLimit-Backend", "redis");
  reply.header("X-RateLimit-Limit", String(config.limit));
  reply.header("X-RateLimit-Remaining", String(Math.max(0, config.limit - count)));
  return true;
}

// Periodic GC so the Map cannot grow unbounded under sustained traffic.
const GC_INTERVAL_MS = 60_000;
let gcTimer: ReturnType<typeof setInterval> | null = null;

export function startRateLimitGc(): void {
  if (gcTimer) return;
  gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, GC_INTERVAL_MS);
  if (typeof gcTimer === "object" && "unref" in gcTimer) {
    (gcTimer as { unref: () => void }).unref();
  }
}

export function stopRateLimitGc(): void {
  if (gcTimer) {
    clearInterval(gcTimer);
    gcTimer = null;
  }
}

// Test-only: reset bucket state.
export function __resetRateLimitForTests(): void {
  buckets.clear();
}
