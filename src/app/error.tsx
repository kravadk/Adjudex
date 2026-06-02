"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error boundary:", error);
    reportToSentry(error);
  }, [error]);

  return (
    <div
      className="px-[22px] py-12 max-w-[680px] mx-auto"
      role="alert"
      aria-live="assertive"
    >
      <div
        className="text-[10.5px] font-mono uppercase tracking-[0.14em] mb-2"
        style={{ color: "#ef4444" }}
      >
        Runtime error
      </div>
      <h1
        className="text-[24px] font-semibold tracking-[-0.02em] mb-3"
        style={{ color: "var(--tx)" }}
      >
        Something went wrong on this page
      </h1>
      <p
        className="text-[13.5px] leading-relaxed mb-4"
        style={{ color: "var(--t2)" }}
      >
        The page hit an unexpected error. The team has been notified if
        production telemetry is enabled. You can retry, or head back to the
        dashboard.
      </p>
      {error.digest && (
        <p
          className="text-[11.5px] font-mono mb-5"
          style={{ color: "var(--t3)" }}
        >
          digest:{" "}
          <span style={{ color: "var(--accent-bright)" }}>{error.digest}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => reset()} className="btn primary">
          Retry this page
        </button>
        <Link href="/" className="btn ghost">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

type BrowserSentry = {
  captureException?: (error: unknown) => void;
};

type WindowWithSentry = Window & {
  Sentry?: BrowserSentry;
  __SENTRY__?: BrowserSentry;
};

function reportToSentry(error: unknown): void {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const sentry =
    (window as WindowWithSentry).Sentry ??
    (window as WindowWithSentry).__SENTRY__;
  sentry?.captureException?.(error);
}
