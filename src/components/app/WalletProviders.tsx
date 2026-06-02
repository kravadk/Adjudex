"use client";

import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WagmiProvider, useAccount } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { useUserStore } from "@/lib/store";
import { shortenAddress } from "@/lib/utils";

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider locale="en-US">
          <WalletSync />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function WalletSync() {
  const { address } = useAccount();
  const setAccount = useUserStore((state) => state.setAccount);

  useEffect(() => {
    setAccount(address ? { address, walletShort: shortenAddress(address) } : null);
  }, [address, setAccount]);

  return null;
}
