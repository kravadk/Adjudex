"use client";

import { useEffect, useState } from "react";
import { Bell, Check, ExternalLink, X } from "lucide-react";
import type { NotificationEvent } from "@/lib/types/domain";
import { notify, requestNotificationPermission } from "@/lib/notify";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function NotificationCenter({ open, onClose }: Props) {
  const [items, setItems] = useState<NotificationEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [readBusy, setReadBusy] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | "unknown">(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    return Notification.permission;
  });

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void (async () => {
      try {
        setError(null);
        const response = await fetch("/api/notifications", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await response.text());
        const nextItems = (await response.json()) as NotificationEvent[];
        setItems(nextItems);
        const latest = nextItems.find((item) => !item.read);
        if (latest && permission === "granted") notify(latest.title, { body: latest.body });
      } catch (nextError) {
        if (controller.signal.aborted) return;
        setItems([]);
        setError(nextError instanceof Error ? nextError.message : "Notifications unavailable.");
      }
    })();
    return () => controller.abort();
  }, [open, permission]);

  if (!open) return null;

  const unreadCount = items.filter((item) => !item.read).length;

  async function enableBrowserAlerts() {
    setSettingsError(null);
    const nextPermission = await requestNotificationPermission();
    setPermission(nextPermission);
    if (nextPermission !== "granted") return;
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationsEnabled: true }),
      });
      if (!response.ok) throw new Error(await response.text());
    } catch {
      setSettingsError("Wallet sign-in is required to persist notification preferences.");
    }
  }

  async function markAllRead() {
    setReadBusy("all");
    try {
      const response = await fetch("/api/notifications/read", { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      setItems((current) => current.map((item) => ({ ...item, read: true })));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not mark notifications read.");
    } finally {
      setReadBusy(null);
    }
  }

  async function markRead(id: string) {
    setReadBusy(id);
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
      if (!response.ok) throw new Error(await response.text());
      const updated = (await response.json()) as NotificationEvent;
      setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not mark notification read.");
    } finally {
      setReadBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onMouseDown={onClose}>
      <aside
        className="absolute right-3 top-16 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-bg)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[color:var(--line-soft)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--tx)]">
            <Bell className="h-4 w-4 text-[color:var(--accent-bright)]" />
            Notifications
            {unreadCount > 0 && (
              <span className="rounded-[999px] border border-[color:var(--line)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--accent-bright)]">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={() => void markAllRead()}
                disabled={readBusy === "all"}
                className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[color:var(--line)] px-2 text-[11px] text-[color:var(--t2)] hover:text-[color:var(--tx)] disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Read all
              </button>
            )}
            <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-[6px] border border-[color:var(--line)] text-[color:var(--t2)]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-3">
          <div className="mb-3 rounded-[6px] border border-[color:var(--line)] bg-[#201f1e] px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-[color:var(--tx)]">Browser alerts</div>
                <div className="mt-1 text-[11px] text-[color:var(--t3)]">
                  Optional, requested only after this action and only mirrors backend notification events.
                </div>
              </div>
              <button
                onClick={() => void enableBrowserAlerts()}
                className="h-8 rounded-[6px] border border-[color:var(--line)] px-2 text-[11px] text-[color:var(--t2)] hover:text-[color:var(--tx)]"
              >
                {permission === "granted" ? "Enabled" : "Enable"}
              </button>
            </div>
            {settingsError && <div className="mt-2 text-[11px] text-[#fca5a5]">{settingsError}</div>}
          </div>
          {error ? (
            <div className="rounded-[6px] border border-[color:var(--line)] bg-[#201f1e] px-3 py-2 text-xs text-[color:var(--t2)]">
              Sign in with wallet to load backend-persisted notifications. No browser/local fallback is used.
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-[6px] border border-[color:var(--line)] bg-[#201f1e] px-3 py-2 text-xs text-[color:var(--t3)]">
              No notification events indexed for this wallet yet.
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className={`rounded-[6px] border px-3 py-2 ${item.read ? "border-[color:var(--line)] bg-[#201f1e]" : "border-[#CCE9E7]/25 bg-[#202321]"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-medium text-[color:var(--tx)]">{item.title}</div>
                    {!item.read && (
                      <button
                        onClick={() => void markRead(item.id)}
                        disabled={readBusy === item.id}
                        className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-[color:var(--line)] px-1.5 py-0.5 text-[10px] text-[color:var(--t2)] hover:text-[color:var(--tx)] disabled:opacity-50"
                      >
                        <Check className="h-2.5 w-2.5" /> Read
                      </button>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-[color:var(--t3)]">{item.body}</div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--t4)]">{item.kind}</div>
                    {item.marketId && (
                      <a
                        href={`/market/${encodeURIComponent(item.marketId)}`}
                        className="inline-flex items-center gap-1 text-[10px] text-[color:var(--accent-bright)] hover:text-[color:var(--tx)]"
                      >
                        Market <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
