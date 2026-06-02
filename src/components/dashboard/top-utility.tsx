"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Search } from "lucide-react";
import { CommandPalette } from "./command-palette";
import { NotificationCenter } from "./notification-center";
import { SystemStatusDrawer } from "./system-status-drawer";
import { WalletDropdown } from "./wallet-dropdown";
import type { NotificationEvent } from "@/lib/types/domain";

// Top utility strip (foresee.lol style). Replaces the full-width header
// bar — only the search + notifications + wallet sit at the top-right
// of the content area. Primary navigation lives in <LeftSidebar> now.

export function TopUtility() {
  const router = useRouter();
  const [commandOpen, setCommandOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [searchValue, setSearchValue] = useState("");

  const loadUnread = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) {
        setUnreadCount(null);
        return;
      }
      const rows = (await response.json()) as NotificationEvent[];
      setUnreadCount(rows.filter((row) => !row.read).length);
    } catch {
      setUnreadCount(null);
    }
  }, []);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  useEffect(() => {
    // Intentional: one-shot fetch on mount + 30s polling. setState
    // happens inside loadUnread() — this is a data-fetch effect, not
    // an external-store subscription.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUnread();
    const timer = window.setInterval(() => void loadUnread(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadUnread]);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchValue.trim();
    if (!q) {
      setCommandOpen(true);
      return;
    }
    router.push(`/?q=${encodeURIComponent(q)}`);
    setCommandOpen(true);
  };

  return (
    <>
      <div
        className="sticky top-0 z-30 flex items-center gap-3 -mx-4 md:-mx-6 px-4 md:px-6 py-3 mb-5"
        style={{
          background: "var(--shell-bg)",
          borderBottom: "1px solid var(--line-soft)",
        }}
      >
        <form
          onSubmit={onSearchSubmit}
          className="flex h-10 flex-1 items-center gap-2.5 rounded-full border px-4 max-w-[480px]"
          style={{
            background: "var(--card-inner, #161616)",
            borderColor: "var(--line-soft, #1a1a1a)",
          }}
        >
          <Search className="h-4 w-4" style={{ color: "var(--t3, #6b7280)" }} />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onFocus={() => setCommandOpen(true)}
            placeholder="Search"
            className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:opacity-60"
            style={{ color: "var(--tx, #fafafa)" }}
            aria-label="Search"
          />
        </form>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStatusOpen(true)}
            className="hidden md:inline-flex h-10 items-center gap-2 rounded-full border px-3 text-[12px]"
            style={{
              background: "var(--card-inner, #161616)",
              borderColor: "var(--line-soft, #1a1a1a)",
              color: "var(--t2, #a3a3a3)",
            }}
            title="System status"
            aria-label="System status"
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--green-tx, #10b981)" }}
            />
            Live
          </button>
          <button
            type="button"
            onClick={() => setNotificationsOpen(true)}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border"
            style={{
              background: "var(--card-inner, #161616)",
              borderColor: "var(--line-soft, #1a1a1a)",
              color: "var(--t2, #a3a3a3)",
            }}
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unreadCount !== null && unreadCount > 0 && (
              <span
                className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full"
                style={{
                  background: "var(--accent-bright, #3b6ffa)",
                  boxShadow: "0 0 0 2px var(--card-inner, #161616)",
                }}
              />
            )}
          </button>
          <WalletDropdown />
        </div>
      </div>
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onOpenSettings={() => setStatusOpen(true)}
      />
      <SystemStatusDrawer
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
      />
      <NotificationCenter
        open={notificationsOpen}
        onClose={() => {
          setNotificationsOpen(false);
          void loadUnread();
        }}
      />
    </>
  );
}
