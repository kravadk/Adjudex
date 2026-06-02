"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X as XIcon } from "lucide-react";

// Tiny in-house toast manager (foresee-style, Rubik weights). Zero
// external deps — uses a module-level event bus that any client
// component can publish to via showToast().
//
// Usage:
//   import { showToast } from "@/components/dashboard/toast";
//   showToast({ kind: "success", title: "Position confirmed" });
//   showToast({ kind: "error", title: "Tx failed", body: err.message });
//
// Mount <ToastViewport /> once at the layout root so toasts render.

type Toast = {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  body?: string;
  ttl?: number;
};

type Listener = (next: Toast[]) => void;

const listeners = new Set<Listener>();
let toasts: Toast[] = [];
let nextId = 1;

function emit() {
  for (const l of listeners) l(toasts);
}

export function showToast(input: Omit<Toast, "id">): number {
  const id = nextId++;
  const ttl = input.ttl ?? 4500;
  toasts = [...toasts, { ...input, id, ttl }];
  emit();
  if (ttl > 0 && typeof window !== "undefined") {
    window.setTimeout(() => dismissToast(id), ttl);
  }
  return id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function ToastViewport() {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  if (list.length === 0) return null;
  return (
    <div
      className="fixed z-[70] flex flex-col gap-2 pointer-events-none"
      style={{ right: 20, bottom: 20, maxWidth: 360 }}
      aria-live="polite"
    >
      {list.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const palette = paletteFor(toast.kind);
  const Icon = palette.Icon;
  return (
    <div
      className="rounded-[12px] px-4 py-3 flex items-start gap-3 pointer-events-auto shadow-lg"
      style={{
        background: "var(--panel-bg)",
        border: `1px solid ${palette.border}`,
        boxShadow: "0 8px 24px -8px rgba(0,0,0,0.5)",
        minWidth: 280,
      }}
      role="status"
    >
      <Icon
        className="w-4 h-4 mt-0.5 flex-shrink-0"
        style={{ color: palette.icon }}
        strokeWidth={2.4}
      />
      <div className="min-w-0 flex-1">
        <div
          className="text-[13px] font-bold leading-snug"
          style={{ color: "var(--tx)", letterSpacing: "-0.005em" }}
        >
          {toast.title}
        </div>
        {toast.body && (
          <div
            className="text-[12px] font-medium leading-snug mt-0.5"
            style={{ color: "var(--t2)" }}
          >
            {toast.body}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        className="grid place-items-center w-5 h-5 rounded-full flex-shrink-0"
        style={{ color: "var(--t3)" }}
        aria-label="Dismiss"
      >
        <XIcon className="w-3 h-3" strokeWidth={2.4} />
      </button>
    </div>
  );
}

function paletteFor(kind: Toast["kind"]) {
  if (kind === "success") {
    return {
      Icon: CheckCircle2,
      icon: "var(--brand-primary)",
      border: "rgba(217,255,0,0.40)",
    };
  }
  if (kind === "error") {
    return {
      Icon: AlertCircle,
      icon: "#ef4444",
      border: "rgba(239,68,68,0.40)",
    };
  }
  return {
    Icon: Info,
    icon: "var(--accent-bright)",
    border: "rgba(59,111,250,0.40)",
  };
}
