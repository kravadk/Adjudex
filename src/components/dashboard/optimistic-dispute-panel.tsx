"use client";

import { useCallback, useEffect, useState } from "react";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Address } from "viem";
import { wagmiConfig } from "@/lib/wagmi";
import { useUserStore } from "@/lib/store";
import { stakeTokenForChain } from "@/lib/stake-token";

// Dispute / settle UI for markets resolved by the OptimisticOracleResolver. The
// AI asserts an outcome with a bond; anyone may dispute it (matching bond) before
// the liveness window closes, or permissionlessly settle it afterwards. Disputed
// assertions escalate to admin arbitration. Renders nothing for non-optimistic
// markets or once settled.

const RESOLVER_ABI = [
  { type: "function", name: "dispute", stateMutability: "nonpayable", inputs: [{ name: "marketId", type: "uint256" }], outputs: [] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ name: "marketId", type: "uint256" }], outputs: [] },
] as const;
const ERC20_ABI = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

type Assertion = {
  optimistic: boolean;
  resolver?: string;
  status?: "none" | "asserted" | "disputed" | "settled";
  outcome?: "YES" | "NO" | null;
  bond?: string;
  disputeDeadline?: number | null;
};

export function OptimisticDisputePanel({ marketId, chainId }: { marketId: string; chainId?: number }) {
  const account = useUserStore((s) => s.account);
  const [data, setData] = useState<Assertion | null>(null);
  const [busy, setBusy] = useState<"dispute" | "settle" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/markets/${encodeURIComponent(marketId)}/assertion`, { cache: "no-store" });
      if (res.ok) setData((await res.json()) as Assertion);
    } catch {
      // best-effort
    }
  }, [marketId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!data?.optimistic || !data.resolver || data.status === "none" || data.status === "settled" || !data.status || !chainId) {
    return null;
  }

  const resolver = data.resolver as Address;
  const onChainId = BigInt(marketId.includes(":") ? marketId.split(":")[1] : marketId);
  const deadlineMs = (data.disputeDeadline ?? 0) * 1000;
  const windowOpen = data.status === "asserted" && now > 0 && now < deadlineMs;
  const canSettle = data.status === "asserted" && now > 0 && now >= deadlineMs;
  const bondUsd = data.bond ? Number(BigInt(data.bond)) / 1e6 : 0;

  const dispute = async () => {
    if (!account) {
      setMsg("Connect wallet to dispute.");
      return;
    }
    setBusy("dispute");
    setMsg(null);
    try {
      const token = stakeTokenForChain(chainId);
      const bond = BigInt(data.bond ?? "0");
      if (token && bond > 0n) {
        const allowance = (await readContract(wagmiConfig, {
          address: token,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [account.address as Address, resolver],
          chainId,
        })) as bigint;
        if (allowance < bond) {
          const approveHash = await writeContract(wagmiConfig, {
            address: token,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [resolver, bond],
            chainId,
          });
          await waitForTransactionReceipt(wagmiConfig, { hash: approveHash, chainId, timeout: 90_000 });
        }
      }
      const hash = await writeContract(wagmiConfig, {
        address: resolver,
        abi: RESOLVER_ABI,
        functionName: "dispute",
        args: [onChainId],
        chainId,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId, timeout: 90_000 });
      setMsg("Dispute submitted — escalated to arbitration.");
      await load();
    } catch (e) {
      setMsg(`Dispute failed: ${(e as Error).message.slice(0, 140)}`);
    } finally {
      setBusy(null);
    }
  };

  const settle = async () => {
    setBusy("settle");
    setMsg(null);
    try {
      const hash = await writeContract(wagmiConfig, {
        address: resolver,
        abi: RESOLVER_ABI,
        functionName: "settle",
        args: [onChainId],
        chainId,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId, timeout: 90_000 });
      setMsg("Settled.");
      await load();
    } catch (e) {
      setMsg(`Settle failed: ${(e as Error).message.slice(0, 140)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-gray-500">Economic resolution (optimistic)</span>
        <span className="text-[11px] font-mono" style={{ color: data.status === "disputed" ? "#e9a23b" : "#d9ff00" }}>
          {data.status}
        </span>
      </div>
      <p className="text-[12.5px] text-gray-300 leading-relaxed">
        AI asserted <b>{data.outcome}</b>.{" "}
        {data.status === "disputed"
          ? "Disputed — awaiting admin arbitration; the correct side takes both bonds."
          : windowOpen
            ? `Anyone can dispute by staking $${bondUsd.toFixed(2)} before the window closes.`
            : "Dispute window closed — settle to resolve the market."}
      </p>
      {data.status === "asserted" && (
        <div className="flex items-center gap-2 mt-3">
          {windowOpen && (
            <button
              onClick={() => void dispute()}
              disabled={busy !== null}
              className="h-9 px-4 rounded-[6px] bg-[#3b6ffa] text-white text-[12.5px] font-bold disabled:opacity-40"
            >
              {busy === "dispute" ? "Disputing…" : `Dispute ($${bondUsd.toFixed(2)})`}
            </button>
          )}
          {canSettle && (
            <button
              onClick={() => void settle()}
              disabled={busy !== null}
              className="h-9 px-4 rounded-[6px] bg-[#d9ff00] text-black text-[12.5px] font-bold disabled:opacity-40"
            >
              {busy === "settle" ? "Settling…" : "Settle"}
            </button>
          )}
        </div>
      )}
      {msg && <div className="mt-2 text-[11.5px] text-gray-400 break-all">{msg}</div>}
    </div>
  );
}
