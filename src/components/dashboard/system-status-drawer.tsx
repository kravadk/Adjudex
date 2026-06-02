"use client";

import React, { useMemo } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { useAccount, useChainId, useSignMessage, useSwitchChain } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { broadcastUserSettings } from "@/components/app/UserSettingsEffects";
import { robinhoodChainTestnet } from "@/lib/wagmi";
import { useSystemStatus } from "@/lib/hooks/useSystemStatus";
import type { ChainRuntimeStatus, ChainSystemStatus, IndexerStatus, UserSettings } from "@/lib/types/domain";

type Props = {
  open: boolean;
  onClose: () => void;
};

const RECOVERY_CHAIN_IDS = new Set<number>([arbitrumSepolia.id, robinhoodChainTestnet.id]);

export function SystemStatusDrawer({ open, onClose }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, chains } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { status, error, isLoading, refresh } = useSystemStatus(open);
  const [settings, setSettings] = React.useState<UserSettings | null>(null);
  const [settingsError, setSettingsError] = React.useState<string | null>(null);
  const [settingsSaveError, setSettingsSaveError] = React.useState<string | null>(null);
  const [settingsSaveBusy, setSettingsSaveBusy] = React.useState(false);
  const [authBusy, setAuthBusy] = React.useState(false);
  const [syncHash, setSyncHash] = React.useState("");
  const [syncChainId, setSyncChainId] = React.useState("");
  const [syncBusy, setSyncBusy] = React.useState(false);
  const [syncResult, setSyncResult] = React.useState<string | null>(null);
  const [syncError, setSyncError] = React.useState<string | null>(null);

  const supportedChainIds = useMemo(() => chains.map((chain) => chain.id), [chains]);
  const activeRecoveryChainId = supportedChainIds.includes(chainId) && RECOVERY_CHAIN_IDS.has(chainId) ? String(chainId) : "";
  const selectedSyncChainIdValue = syncChainId || activeRecoveryChainId;
  const selectedSyncChainId = Number(selectedSyncChainIdValue);
  const canSyncTransaction =
    Boolean(syncHash.trim()) &&
    Number.isFinite(selectedSyncChainId) &&
    supportedChainIds.includes(selectedSyncChainId) &&
    RECOVERY_CHAIN_IDS.has(selectedSyncChainId) &&
    !syncBusy;
  const correctNetwork = supportedChainIds.includes(chainId);
  const activeChainStatus =
    chainId === robinhoodChainTestnet.id
      ? status?.chains.rhc
      : status?.chains.arbitrumSepolia;
  const activeFactory =
    chainId === robinhoodChainTestnet.id
      ? status?.chains.rhc.factoryAddress
      : status?.chains.arbitrumSepolia.factoryAddress;
  const activeIndexer =
    chainId === robinhoodChainTestnet.id
      ? status?.chains.rhc.indexer
      : status?.chains.arbitrumSepolia.indexer;
  const backendUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
  const explorerUrl =
    chainId === robinhoodChainTestnet.id
      ? process.env.NEXT_PUBLIC_RHC_EXPLORER_URL
      : process.env.NEXT_PUBLIC_ARBITRUM_EXPLORER_URL || "https://sepolia.arbiscan.io";

  React.useEffect(() => {
    if (!open) return;
    void loadSettings();
  }, [open]);

  async function loadSettings() {
    try {
      setSettingsError(null);
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      const nextSettings = (await response.json()) as UserSettings;
      setSettings(nextSettings);
      broadcastUserSettings(nextSettings);
    } catch (nextError) {
      setSettings(null);
      setSettingsError(nextError instanceof Error ? nextError.message : "Settings require wallet sign-in.");
    }
  }

  async function signIn() {
    if (!address) {
      setSettingsError("Connect wallet before signing in.");
      return;
    }
    if (!correctNetwork) {
      setSettingsError("Switch to a configured network before signing in.");
      return;
    }
    setAuthBusy(true);
    setSettingsError(null);
    try {
      const nonceResponse = await fetch("/api/auth/nonce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, chainId }),
      });
      if (!nonceResponse.ok) throw new Error(await nonceResponse.text());
      const noncePayload = (await nonceResponse.json()) as { nonce: string; message: string };
      const signature = await signMessageAsync({ message: noncePayload.message });
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, nonce: noncePayload.nonce, signature }),
      });
      if (!verifyResponse.ok) throw new Error(await verifyResponse.text());
      await loadSettings();
    } catch (nextError) {
      setSettingsError(nextError instanceof Error ? nextError.message : "SIWE sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function updateSettings(patch: Partial<UserSettings>) {
    setSettingsSaveBusy(true);
    setSettingsSaveError(null);
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    try {
      if (!response.ok) throw new Error(await response.text());
      const nextSettings = (await response.json()) as UserSettings;
      setSettings(nextSettings);
      broadcastUserSettings(nextSettings);
    } catch (nextError) {
      setSettingsSaveError(nextError instanceof Error ? nextError.message : "Settings were not saved.");
      await loadSettings();
    } finally {
      setSettingsSaveBusy(false);
    }
  }

  async function syncTransaction() {
    setSyncBusy(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      if (!Number.isFinite(selectedSyncChainId) || !supportedChainIds.includes(selectedSyncChainId) || !RECOVERY_CHAIN_IDS.has(selectedSyncChainId)) {
        throw new Error("Select a supported chain before syncing the transaction.");
      }
      const response = await fetch("/api/sync/transaction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionHash: syncHash.trim(), chainId: selectedSyncChainId }),
      });
      const payload = (await response.json()) as {
        status?: string;
        blockNumber?: number;
        reconciled?: Array<{ type: string; id?: string; marketId?: string }>;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "sync_failed");
      setSyncResult(`${payload.status ?? "unknown"} at block ${payload.blockNumber ?? "?"}; reconciled ${payload.reconciled?.map((item) => item.type).join(", ") || "none"}`);
    } catch (nextError) {
      setSyncError(nextError instanceof Error ? nextError.message : "Could not sync transaction.");
    } finally {
      setSyncBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45" onMouseDown={onClose}>
      <aside
        className="ml-auto flex h-full w-full max-w-md flex-col border-l border-[color:var(--line)] bg-[color:var(--panel-bg)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[color:var(--line-soft)] px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-[color:var(--tx)]">Settings / System Status</div>
            <div className="text-[11px] text-[color:var(--t3)]">Real backend, RPC, indexer, wallet, and contract readiness.</div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-[6px] border border-[color:var(--line)] text-[color:var(--t2)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--t3)]">Connection checklist</span>
            <button onClick={() => void refresh()} className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[color:var(--line)] px-2 text-[11px] text-[color:var(--t2)]">
              <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          <div className="space-y-2">
            <StatusRow label="Wallet connected" ok={isConnected} value={address ? shorten(address) : "Connect wallet"} />
            <StatusRow label="Correct network" ok={correctNetwork} value={chainId ? String(chainId) : "Not connected"} />
            <StatusRow label="API health" ok={Boolean(status?.api)} value={backendUrl} />
            <StatusRow label="DB health" ok={Boolean(status?.database.ok)} value={status?.database.ok ? "online" : "unavailable"} />
            <StatusRow label="Active RPC" ok={Boolean(activeChainStatus?.rpc.ok)} value={formatRpcStatus(activeChainStatus?.rpc)} />
            <StatusRow label="Factory address" ok={Boolean(activeFactory)} value={activeFactory ?? "not configured"} mono />
            <StatusRow label="Active indexer" ok={Boolean(activeIndexer)} value={activeIndexer ? `${activeIndexer.chainId} / ${activeIndexer.lastBlock}` : "no indexed state for active chain"} mono />
          </div>

          <div className="mt-3 grid gap-2">
            <StatusRow label="Arbitrum RPC" ok={Boolean(status?.chains.arbitrumSepolia.rpc.ok)} value={formatChainStatus(status?.chains.arbitrumSepolia)} mono />
            <StatusRow label="Arbitrum indexer" ok={Boolean(status?.chains.arbitrumSepolia.indexer)} value={formatIndexerStatus(status?.chains.arbitrumSepolia.indexer)} mono />
            <StatusRow label="RHC RPC" ok={Boolean(status?.chains.rhc.rpc.ok)} value={formatChainStatus(status?.chains.rhc)} mono />
            <StatusRow label="RHC indexer" ok={Boolean(status?.chains.rhc.indexer)} value={formatIndexerStatus(status?.chains.rhc.indexer)} mono />
          </div>

          {error && (
            <div className="mt-3 rounded-[6px] border border-[#5b3535] bg-[#241b1b] px-3 py-2 text-xs text-[#fca5a5]">
              {error}
            </div>
          )}

          <div className="mt-5 rounded-[8px] border border-[color:var(--line)] bg-[#211f1e] p-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--t3)]">Network helper</div>
            <div className="mt-3 grid gap-2">
              <button
                onClick={() => switchChain?.({ chainId: arbitrumSepolia.id })}
                className="h-9 rounded-[6px] border border-[color:var(--line)] px-3 text-left text-xs text-[color:var(--tx)] hover:border-[color:var(--accent)]"
              >
                Switch to Arbitrum Sepolia
              </button>
              {supportedChainIds.includes(robinhoodChainTestnet.id) && (
                <button
                  onClick={() => switchChain?.({ chainId: robinhoodChainTestnet.id })}
                  className="h-9 rounded-[6px] border border-[color:var(--line)] px-3 text-left text-xs text-[color:var(--tx)] hover:border-[color:var(--accent)]"
                >
                  Switch to Robinhood Chain
                </button>
              )}
            </div>
          </div>

          <div className="mt-5 rounded-[8px] border border-[color:var(--line)] bg-[#211f1e] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--t3)]">Wallet settings</div>
              {!settings && (
                <button
                  onClick={() => void signIn()}
                  disabled={!isConnected || authBusy}
                  className="h-7 rounded-[6px] border border-[color:var(--line)] px-2 text-[11px] text-[color:var(--tx)] disabled:opacity-40"
                >
                  {authBusy ? "Signing..." : "Sign in"}
                </button>
              )}
            </div>
            {settings ? (
              <div className="mt-3 grid gap-3">
                {settingsSaveError && (
                  <div className="rounded-[6px] border border-[#5b3535] bg-[#241b1b] px-3 py-2 text-[11.5px] text-[#fca5a5]">
                    Settings not saved: {settingsSaveError}
                  </div>
                )}
                {settingsSaveBusy && (
                  <div className="rounded-[6px] border border-[color:var(--line)] px-3 py-2 text-[11.5px] text-[color:var(--t2)]">
                    Saving settings to backend...
                  </div>
                )}
                <SettingSelect
                  label="Preferred chain"
                  value={settings.preferredChain}
                  options={["arbitrum-sepolia", "rhc"]}
                  onChange={(preferredChain) => void updateSettings({ preferredChain })}
                />
                <SettingSelect
                  label="Currency display"
                  value={settings.currencyDisplay}
                  options={["USD", "USDC"]}
                  onChange={(currencyDisplay) => void updateSettings({ currencyDisplay })}
                />
                <SettingInput
                  label="Default stake"
                  value={String(settings.defaultStakeUsd)}
                  onChange={(defaultStakeUsd) => void updateSettings({ defaultStakeUsd: Number(defaultStakeUsd) })}
                />
                <SettingSelect
                  label="Explorer"
                  value={settings.explorerPreference}
                  options={["default", "arbiscan", "rhc"]}
                  onChange={(explorerPreference) => void updateSettings({ explorerPreference })}
                />
                <SettingToggle
                  label="Notifications"
                  checked={settings.notificationsEnabled}
                  onChange={(notificationsEnabled) => void updateSettings({ notificationsEnabled })}
                />
                <SettingToggle
                  label="Animations"
                  checked={settings.animationsEnabled}
                  onChange={(animationsEnabled) => void updateSettings({ animationsEnabled })}
                />
                <SettingToggle
                  label="Compact mode"
                  checked={settings.compactMode}
                  onChange={(compactMode) => void updateSettings({ compactMode })}
                />
              </div>
            ) : (
              <div className="mt-3 rounded-[6px] border border-[color:var(--line)] px-3 py-2 text-[11.5px] text-[color:var(--t3)]">
                Settings, watchlist, and notifications are persisted only after SIWE sign-in. No local fallback is used.
                {settingsError && <div className="mt-2 text-[#fca5a5]">{settingsError}</div>}
              </div>
            )}
          </div>

          <div className="mt-5 rounded-[8px] border border-[color:var(--line)] bg-[#211f1e] p-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--t3)]">Transaction recovery</div>
            <div className="mt-3 grid gap-2">
              <input
                value={syncHash}
                onChange={(event) => setSyncHash(event.target.value)}
                placeholder="0x transaction hash"
                className="h-9 rounded-[6px] border border-[color:var(--line)] bg-[#201f1e] px-3 font-mono text-xs text-[color:var(--tx)] outline-none"
              />
              <select
                value={selectedSyncChainIdValue}
                onChange={(event) => setSyncChainId(event.target.value)}
                className="h-9 rounded-[6px] border border-[color:var(--line)] bg-[#201f1e] px-3 text-xs text-[color:var(--tx)] outline-none"
              >
                <option value="">Select chain</option>
                <option value={String(arbitrumSepolia.id)}>Arbitrum Sepolia</option>
                <option value={String(robinhoodChainTestnet.id)}>Robinhood Chain</option>
              </select>
              <button
                onClick={() => void syncTransaction()}
                disabled={!canSyncTransaction}
                className="h-9 rounded-[6px] border border-[color:var(--line)] px-3 text-left text-xs text-[color:var(--tx)] hover:border-[color:var(--accent)] disabled:opacity-40"
              >
                {syncBusy ? "Syncing..." : "Retry backend sync"}
              </button>
              {syncResult && <div className="rounded-[6px] border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-[11.5px] text-emerald-200">{syncResult}</div>}
              {syncError && <div className="rounded-[6px] border border-[#5b3535] bg-[#241b1b] px-3 py-2 text-[11.5px] text-[#fca5a5]">{syncError}</div>}
            </div>
          </div>

          <div className="mt-5 rounded-[8px] border border-[color:var(--line)] bg-[#211f1e] p-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--t3)]">Useful links</div>
            <div className="mt-3 grid gap-2">
              <a href="/api/status" target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-[6px] border border-[color:var(--line)] px-3 py-2 text-xs text-[color:var(--t2)] hover:text-[color:var(--tx)]">Backend health <ExternalLink className="h-3 w-3" /></a>
              <a href="/docs" className="flex items-center justify-between rounded-[6px] border border-[color:var(--line)] px-3 py-2 text-xs text-[color:var(--t2)] hover:text-[color:var(--tx)]">Docs / proof <ExternalLink className="h-3 w-3" /></a>
              {explorerUrl && <a href={explorerUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-[6px] border border-[color:var(--line)] px-3 py-2 text-xs text-[color:var(--t2)] hover:text-[color:var(--tx)]">Explorer <ExternalLink className="h-3 w-3" /></a>}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function StatusRow({ label, ok, value, mono }: { label: string; ok: boolean; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-[6px] border border-[color:var(--line)] bg-[#201f1e] px-3 py-2">
      <span className={`mt-1 h-2 w-2 rounded-full ${ok ? "bg-[color:var(--green-dot)]" : "bg-[#ef4444]"}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-[color:var(--tx)]">{label}</span>
        <span className={`block truncate text-[11px] text-[color:var(--t3)] ${mono ? "font-mono" : ""}`}>{value}</span>
      </span>
    </div>
  );
}

function formatRpcStatus(status: ChainRuntimeStatus | undefined) {
  if (!status) return "checking";
  if (status.blockNumber) return `block ${status.blockNumber}`;
  if (status.configured) return status.ok ? "online" : "configured, unavailable";
  return "not configured";
}

function formatChainStatus(status: ChainSystemStatus | undefined) {
  if (!status) return "checking";
  return `${status.chainId} / ${formatRpcStatus(status.rpc)}`;
}

function formatIndexerStatus(status: IndexerStatus | null | undefined) {
  if (!status) return "no indexed state";
  return `${status.chainId} / block ${status.lastBlock}`;
}

function shorten(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function SettingSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] text-[color:var(--t3)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-[6px] border border-[color:var(--line)] bg-[#201f1e] px-2 text-xs text-[color:var(--tx)] outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function SettingInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] text-[color:var(--t3)]">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-[6px] border border-[color:var(--line)] bg-[#201f1e] px-2 text-xs text-[color:var(--tx)] outline-none"
      />
    </label>
  );
}

function SettingToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-[6px] border border-[color:var(--line)] bg-[#201f1e] px-3 py-2">
      <span className="text-xs text-[color:var(--tx)]">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[color:var(--accent)]"
      />
    </label>
  );
}
