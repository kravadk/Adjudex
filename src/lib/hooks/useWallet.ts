"use client";

import { useEffect } from "react";
import { useUserStore } from "@/lib/store";

export function useWallet() {
  const account = useUserStore((state) => state.account);
  const isConnecting = useUserStore((state) => state.isConnecting);
  const hydrate = useUserStore((state) => state.hydrate);
  const connect = useUserStore((state) => state.connect);
  const disconnect = useUserStore((state) => state.disconnect);

  useEffect(() => {
    if (!account) void hydrate();
  }, [account, hydrate]);

  return { account, isConnecting, hydrate, connect, disconnect };
}
