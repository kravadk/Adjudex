// Sentry integration that activates only when SENTRY_DSN is set in the
// environment. If the env is absent OR if @sentry/node is not installed,
// captureException/captureMessage become no-ops so callers can wire them
// unconditionally without breaking local development deployments.
//
// To enable: `pnpm add @sentry/node` in services/api, set SENTRY_DSN env.

type SentryShape = {
  init(options: Record<string, unknown>): void;
  captureException(err: unknown, ctx?: Record<string, unknown>): void;
  captureMessage(msg: string, level?: string): void;
  flush(timeoutMs?: number): Promise<boolean>;
};

let sentry: SentryShape | null = null;
let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (sentry) return;
  if (initPromise) return initPromise;
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  initPromise = (async () => {
    try {
      // Dynamic import so the module is optional. If the dep is not
      // installed, the catch below leaves Sentry disabled.
      // @ts-expect-error optional peer dep, install with `pnpm add @sentry/node` to enable.
      const mod = (await import("@sentry/node")) as Partial<SentryShape>;
      if (!mod?.init) {
        return;
      }
      mod.init({
        dsn,
        environment: process.env.NODE_ENV ?? "development",
        release: process.env.SENTRY_RELEASE,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
      });
      sentry = mod as SentryShape;
    } catch {
      // @sentry/node not installed — stay disabled, this is fine in dev.
    }
  })();
  return initPromise;
}

export async function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  await ensureInitialized();
  if (!sentry) return;
  try {
    sentry.captureException(err, context);
  } catch {
    // Sentry must never break the request path.
  }
}

export async function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
): Promise<void> {
  await ensureInitialized();
  if (!sentry) return;
  try {
    sentry.captureMessage(message, level);
  } catch {
    // ignore
  }
}

// Call from a graceful shutdown hook so in-flight events are flushed.
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!sentry) return;
  try {
    await sentry.flush(timeoutMs);
  } catch {
    // ignore
  }
}

export function isSentryEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN?.trim());
}
