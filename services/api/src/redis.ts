type RedisCommand = Array<string | number>;

type RedisResult<T = unknown> = {
  result?: T;
  error?: string;
};

type RedisPipelineResult<T = unknown> = Array<RedisResult<T>>;

function redisConfig() {
  const url = process.env.REDIS_REST_URL?.trim();
  const token = process.env.REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return {
    url: url.replace(/\/$/, ""),
    token,
  };
}

export function isRedisConfigured(): boolean {
  return redisConfig() !== null;
}

export async function redisCommand<T = unknown>(command: RedisCommand): Promise<T | null> {
  const config = redisConfig();
  if (!config) return null;
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) {
    throw new Error(`redis_request_failed:${response.status}:${await response.text()}`);
  }
  const payload = (await response.json()) as RedisResult<T>;
  if (payload.error) throw new Error(`redis_command_failed:${payload.error}`);
  return payload.result ?? null;
}

export async function redisPipeline<T = unknown>(commands: RedisCommand[]): Promise<RedisPipelineResult<T> | null> {
  const config = redisConfig();
  if (!config) return null;
  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!response.ok) {
    throw new Error(`redis_pipeline_failed:${response.status}:${await response.text()}`);
  }
  const payload = (await response.json()) as RedisPipelineResult<T>;
  const failed = payload.find((item) => item.error);
  if (failed?.error) throw new Error(`redis_pipeline_command_failed:${failed.error}`);
  return payload;
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  const value = await redisCommand<string>(["GET", key]);
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function redisSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) return;
  await redisCommand(["SET", key, JSON.stringify(value), "EX", ttlSeconds]);
}
