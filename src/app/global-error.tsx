"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error boundary:", error);
    reportToSentry(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
          padding: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
        }}
      >
        <main
          style={{
            maxWidth: 520,
            padding: 32,
            border: "1px solid #262626",
            borderRadius: 12,
            background: "#111111",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              textTransform: "uppercase",
              letterSpacing: 2,
              color: "#ef4444",
              marginBottom: 8,
            }}
          >
            Fatal error
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              margin: 0,
              marginBottom: 12,
            }}
          >
            Adjudex failed to load
          </h1>
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: "#a3a3a3",
              marginBottom: 20,
            }}
          >
            A top-level error prevented the page from rendering. Please retry,
            or refresh.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
                color: "#737373",
                marginBottom: 18,
              }}
            >
              digest: <span style={{ color: "#28a0f0" }}>{error.digest}</span>
            </p>
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              height: 38,
              padding: "0 18px",
              fontSize: 13,
              fontWeight: 600,
              background: "#28a0f0",
              color: "#0a0a0a",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </main>
      </body>
    </html>
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
