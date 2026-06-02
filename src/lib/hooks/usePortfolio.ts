"use client";

import { useEffect } from "react";
import { usePortfolioStore, useUserStore } from "@/lib/store";

export function usePortfolio() {
  const account = useUserStore((state) => state.account);
  const positions = usePortfolioStore((state) => state.positions);
  const claimedIds = usePortfolioStore((state) => state.claimedIds);
  const error = usePortfolioStore((state) => state.error);
  const refresh = usePortfolioStore((state) => state.refresh);
  const claim = usePortfolioStore((state) => state.claim);
  useEffect(() => {
    if (account) void refresh(account.address);
  }, [account, refresh]);
  return { positions, claimedIds, error, refresh, claim, account };
}
