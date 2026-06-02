import { NextResponse } from "next/server";

type RateLimitOptions = {
  bucket: string;
  request: Request;
  limit: number;
  windowMs: number;
};

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitRecord>();

export function checkRateLimit(options: RateLimitOptions) {
  const now = Date.now();
  const id = clientId(options.request);
  const key = `${options.bucket}:${id}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { ok: true as const };
  }

  current.count += 1;
  if (current.count <= options.limit) return { ok: true as const };

  const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  return {
    ok: false as const,
    retryAfterSeconds,
    resetAt: current.resetAt,
  };
}

export function rateLimitResponse(result: Exclude<ReturnType<typeof checkRateLimit>, { ok: true }>) {
  return NextResponse.json(
    {
      error: "rate_limited",
      message: "Too many requests for this action. Retry after the rate-limit window resets.",
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "retry-after": String(result.retryAfterSeconds),
        "x-ratelimit-reset": String(result.resetAt),
      },
    },
  );
}

export function resetRateLimitsForTests() {
  buckets.clear();
}

function clientId(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const wallet = request.headers.get("x-adjudex-wallet")?.trim().toLowerCase();
  return forwarded || realIp || wallet || "anonymous";
}
