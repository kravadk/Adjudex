"use client";

import type { LucideIcon } from "lucide-react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";

// Shared empty / error / loading state blocks (foresee-style panel,
// rounded-[16px], Rubik weights). Use these instead of inline ad-hoc
// states so every tab feels consistent.

type CommonProps = {
  title?: string;
  body?: string;
  action?: { label: string; onClick?: () => void; href?: string };
  Icon?: LucideIcon;
};

function Container({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[16px] flex flex-col items-center justify-center text-center px-6 py-12"
      style={{
        background: "var(--panel-bg)",
        border: "1px solid var(--line-soft)",
      }}
    >
      {children}
    </div>
  );
}

export function LoadingState({
  title = "Loading",
  body,
}: Pick<CommonProps, "title" | "body">) {
  return (
    <Container>
      <Loader2
        className="w-6 h-6 mb-3"
        style={{
          color: "var(--accent-bright)",
          animation: "spin 1s linear infinite",
        }}
      />
      <h3
        className="text-[15px] font-bold mb-1"
        style={{ color: "var(--tx)" }}
      >
        {title}
      </h3>
      {body && (
        <p
          className="text-[12.5px] max-w-sm font-medium"
          style={{ color: "var(--t3)" }}
        >
          {body}
        </p>
      )}
    </Container>
  );
}

export function EmptyState({
  title = "Nothing here yet",
  body,
  action,
  Icon = Inbox,
}: CommonProps) {
  return (
    <Container>
      <div
        className="inline-grid place-items-center w-12 h-12 rounded-full mb-3"
        style={{
          background: "var(--accent-soft)",
          color: "var(--accent-bright)",
        }}
      >
        <Icon className="w-5 h-5" strokeWidth={2.2} />
      </div>
      <h3
        className="text-[16px] font-bold mb-1.5"
        style={{
          color: "var(--tx)",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h3>
      {body && (
        <p
          className="text-[13px] max-w-sm font-medium leading-relaxed mb-4"
          style={{ color: "var(--t3)" }}
        >
          {body}
        </p>
      )}
      {action &&
        (action.href ? (
          <a
            href={action.href}
            className="inline-flex h-10 items-center px-5 rounded-full text-[13px] font-bold"
            style={{
              background: "var(--accent-bright)",
              color: "#ffffff",
            }}
          >
            {action.label}
          </a>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="inline-flex h-10 items-center px-5 rounded-full text-[13px] font-bold"
            style={{
              background: "var(--accent-bright)",
              color: "#ffffff",
            }}
          >
            {action.label}
          </button>
        ))}
    </Container>
  );
}

export function ErrorState({
  title = "Something went wrong",
  body,
  action,
}: CommonProps) {
  return (
    <Container>
      <div
        className="inline-grid place-items-center w-12 h-12 rounded-full mb-3"
        style={{
          background: "rgba(239,68,68,0.10)",
          color: "#ef4444",
        }}
      >
        <AlertCircle className="w-5 h-5" strokeWidth={2.2} />
      </div>
      <h3
        className="text-[16px] font-bold mb-1.5"
        style={{
          color: "var(--tx)",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h3>
      {body && (
        <p
          className="text-[13px] max-w-md font-medium leading-relaxed mb-4"
          style={{ color: "var(--t3)" }}
        >
          {body}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex h-10 items-center px-5 rounded-full text-[13px] font-bold border"
          style={{
            background: "var(--card-inner)",
            borderColor: "var(--line)",
            color: "var(--tx)",
          }}
        >
          {action.label}
        </button>
      )}
    </Container>
  );
}

// Compact inline variants (e.g. inside a card or right rail).
export function InlineLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="inline-flex items-center gap-2 text-[12px] font-semibold"
      style={{ color: "var(--t3)" }}
    >
      <Loader2 className="w-3.5 h-3.5" style={{ animation: "spin 1s linear infinite" }} />
      {label}
    </div>
  );
}

export function InlineError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="rounded-[10px] px-3 py-2.5 flex items-start gap-2 text-[12px] font-medium"
      style={{
        background: "rgba(239,68,68,0.06)",
        border: "1px solid rgba(239,68,68,0.30)",
        color: "#fca5a5",
      }}
    >
      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-[11px] font-bold uppercase tracking-wider underline"
          style={{ color: "#fca5a5" }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
