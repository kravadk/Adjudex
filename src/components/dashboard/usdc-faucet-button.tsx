"use client";

import { useState } from "react";
import { Droplet } from "lucide-react";
import { useAccount, useBalance } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { parseUnits, type Address } from "viem";
import testUsdcAbi from "@/lib/abi/TestUSDC.json";
import { wagmiConfig } from "@/lib/wagmi";

const STAKE_TOKEN = process.env.NEXT_PUBLIC_STAKE_TOKEN_ADDRESS as
  | Address
  | undefined;

const FAUCET_AMOUNT = parseUnits("1000", 6);
type SupportedChainId = (typeof wagmiConfig.chains)[number]["id"];

export function UsdcFaucetButton() {
  const { address, isConnected, chainId } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: balance, refetch } = useBalance({
    address,
    token: STAKE_TOKEN,
    query: { enabled: Boolean(address && STAKE_TOKEN) },
  });

  const balanceLabel = balance
    ? `${Number(balance.formatted).toFixed(2)} USDC`
    : "- USDC";

  async function mintTestUsdc() {
    if (!STAKE_TOKEN || !address) return;
    if (!chainId || !isSupportedChainId(chainId)) {
      setError("Connect to a configured testnet before minting test USDC.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const hash = await writeContract(wagmiConfig, {
        address: STAKE_TOKEN,
        abi: testUsdcAbi,
        functionName: "mint",
        args: [address as Address, FAUCET_AMOUNT],
        chainId,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId });
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected || !STAKE_TOKEN) return null;

  return (
    <button
      type="button"
      onClick={mintTestUsdc}
      disabled={busy}
      title={error ?? `Mint 1,000 test USDC. Balance: ${balanceLabel}`}
      className="hidden md:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[9px] border text-xs transition-colors"
      style={{
        background: "#211f1e",
        borderColor: "#34312e",
        color: "var(--t2)",
        opacity: busy ? 0.6 : 1,
        cursor: busy ? "wait" : "pointer",
      }}
    >
      <Droplet className="w-3.5 h-3.5" />
      <span className="font-mono tabular-nums">{balanceLabel}</span>
      <span style={{ color: "var(--t3)" }}>/ faucet</span>
    </button>
  );
}

function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return wagmiConfig.chains.some((chain) => chain.id === chainId);
}
