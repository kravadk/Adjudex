"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  ChevronDown,
  Coins,
  Copy,
  Gavel,
  LogOut,
  Plus,
  Settings as SettingsIcon,
  Trophy,
  Wallet,
} from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { UsdcFaucetButton } from "./usdc-faucet-button";

// Wallet-shaped dropdown that doubles as the secondary nav (Portfolio,
// Leaderboard, Create, Resolve, Settings) so the top bar can stay
// Polymarket-style 1-row without losing reachability.
//
// When disconnected: renders a single "Connect" pill (RainbowKit modal).
// When connected: renders the truncated address pill that opens a menu
// with account actions + secondary routes.

type MenuItem = {
  label: string;
  href: string;
  icon: typeof Wallet;
  hint?: string;
};

const MENU: MenuItem[] = [
  { label: "Portfolio", href: "/portfolio", icon: Wallet, hint: "Open positions, PnL, claims" },
  { label: "Leaderboard", href: "/leaderboard", icon: Trophy, hint: "Top traders + AI agents" },
  { label: "Create market", href: "/create", icon: Plus, hint: "Spec + deploy a new pool" },
  { label: "Resolve queue", href: "/resolve", icon: Gavel, hint: "Pending judge proposals" },
  { label: "Activity", href: "/#activity", icon: Activity, hint: "Recent bets and claims" },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
  { label: "Docs", href: "/docs", icon: BookOpen },
];

export function WalletDropdown() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        if (!connected) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className="flex h-8 items-center gap-1.5 rounded-[8px] border pl-2.5 pr-3 text-[12px] font-semibold transition-colors"
              style={{
                background: "var(--accent-bright)",
                borderColor: "var(--accent-bright)",
                color: "#0a0a0a",
                fontFamily: "var(--font-mono)",
              }}
            >
              <Wallet className="h-3.5 w-3.5" />
              CONNECT
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button
              type="button"
              onClick={openChainModal}
              className="flex h-8 items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-semibold"
              style={{
                background: "rgba(239,68,68,0.10)",
                borderColor: "rgba(239,68,68,0.35)",
                color: "#ef4444",
                fontFamily: "var(--font-mono)",
              }}
            >
              WRONG CHAIN
            </button>
          );
        }
        return (
          <ConnectedDropdown
            address={account.address}
            display={
              account.displayName ??
              `${account.address.slice(0, 6)}…${account.address.slice(-4)}`
            }
            onOpenAccountModal={openAccountModal}
          />
        );
      }}
    </ConnectButton.Custom>
  );
}

function ConnectedDropdown({
  address,
  display,
  onOpenAccountModal,
}: {
  address: string;
  display: string;
  onOpenAccountModal: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const node = wrapperRef.current;
      if (!node) return;
      if (!node.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — copy is a nice-to-have, never break the menu over it
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-2 rounded-[8px] border pl-1 pr-2.5"
        style={{ background: "#2a2826", borderColor: "#3a3633" }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="grid h-6 w-6 place-items-center rounded-[6px] text-[9px]"
          style={{
            background: "#1c1c1c",
            color: "var(--accent-bright)",
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
          }}
        >
          0x
        </span>
        <span
          className="text-[11.5px]"
          style={{ color: "var(--tx)", fontFamily: "var(--font-mono)" }}
        >
          {display}
        </span>
        <ChevronDown
          className="h-3 w-3 transition-transform"
          style={{
            color: "var(--t3)",
            transform: open ? "rotate(180deg)" : undefined,
          }}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-[260px] overflow-hidden rounded-[10px] border shadow-[0_24px_56px_-16px_rgba(0,0,0,0.7)]"
          style={{ background: "#161413", borderColor: "var(--line)" }}
        >
          <div
            className="flex items-center justify-between gap-2 border-b px-3 py-2.5"
            style={{ borderColor: "var(--line-soft)" }}
          >
            <span
              className="text-[11.5px]"
              style={{ color: "var(--t2)", fontFamily: "var(--font-mono)" }}
            >
              {display}
            </span>
            <button
              type="button"
              onClick={copy}
              className="inline-flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[10px]"
              style={{
                background: "#211f1e",
                color: copied ? "var(--accent-bright)" : "var(--t3)",
                fontFamily: "var(--font-mono)",
              }}
              title="Copy address"
            >
              <Copy className="h-3 w-3" />
              {copied ? "copied" : "copy"}
            </button>
          </div>

          <div className="px-2 py-2">
            <div className="mb-1.5 px-2">
              <UsdcFaucetButton />
            </div>
            {MENU.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                role="menuitem"
                className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-[12.5px] transition-colors hover:bg-[#211f1e]"
                style={{ color: "var(--t2)" }}
              >
                <item.icon
                  className="h-3.5 w-3.5 flex-shrink-0"
                  style={{ color: "var(--t3)" }}
                />
                <span className="flex-1" style={{ color: "var(--tx)" }}>
                  {item.label}
                </span>
                {item.hint && (
                  <span
                    className="hidden text-[10px] sm:inline"
                    style={{ color: "var(--t4)" }}
                  >
                    {item.hint.split(" ").slice(0, 3).join(" ")}
                  </span>
                )}
              </Link>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenAccountModal();
            }}
            role="menuitem"
            className="flex w-full items-center gap-2.5 border-t px-4 py-2.5 text-[12.5px] transition-colors hover:bg-[#211f1e]"
            style={{ borderColor: "var(--line-soft)", color: "var(--t2)" }}
          >
            <LogOut className="h-3.5 w-3.5" style={{ color: "var(--t3)" }} />
            <span style={{ color: "var(--tx)" }}>Wallet & disconnect</span>
            <span className="ml-auto text-[10px]" style={{ color: "var(--t4)" }}>
              RainbowKit
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// Small re-export so the header doesn't import the icon barrel twice.
export const WalletIcon = Coins;
