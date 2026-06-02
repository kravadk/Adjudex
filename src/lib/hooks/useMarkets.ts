"use client";

import { useEffect } from "react";
import { useMarketsStore } from "@/lib/store";

export function useMarkets() {
  const markets = useMarketsStore((state) => state.markets);
  const filters = useMarketsStore((state) => state.filters);
  const isLoading = useMarketsStore((state) => state.isLoading);
  const error = useMarketsStore((state) => state.error);
  const refresh = useMarketsStore((state) => state.refresh);
  const setFilter = useMarketsStore((state) => state.setFilter);
  useEffect(() => {
    if (markets.length === 0 && !isLoading) {
      void refresh();
    }
  }, [isLoading, markets.length, refresh]);
  return { markets, filters, isLoading, error, refresh, setFilter };
}
