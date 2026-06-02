"use client";

import { create } from "zustand";
import type { Account, ActivityEvent, Market, MarketFilters, Position } from "@/lib/types/domain";
import { getServices } from "@/lib/services/provider";

type UserState = {
  account: Account | null;
  isConnecting: boolean;
  setAccount: (account: Account | null) => void;
  hydrate: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

type MarketsState = {
  markets: Market[];
  filters: MarketFilters;
  isLoading: boolean;
  error: string | null;
  setFilter: (filters: MarketFilters) => Promise<void>;
  refresh: () => Promise<void>;
};

type PortfolioState = {
  positions: Position[];
  claimedIds: string[];
  error: string | null;
  refresh: (address: string) => Promise<void>;
  claim: (positionId: string, transactionHash: `0x${string}` | undefined, chainId: number) => Promise<void>;
};

type ActivityState = {
  events: ActivityEvent[];
  error: string | null;
  refresh: (limit?: number) => Promise<void>;
  prepend: (event: ActivityEvent) => void;
};

export const useUserStore = create<UserState>((set) => ({
  account: null,
  isConnecting: false,
  setAccount(account) {
    set({ account });
  },
  async hydrate() {
    set({ account: null });
  },
  async connect() {
    set({ isConnecting: true });
    set({ isConnecting: false });
    throw new Error("Use the wallet connector. Programmatic local wallet connect is not allowed.");
  },
  async disconnect() {
    set({ account: null, isConnecting: false });
  },
}));

export const useMarketsStore = create<MarketsState>((set, get) => ({
  markets: [],
  filters: {},
  isLoading: false,
  error: null,
  async setFilter(filters) {
    set({ filters });
    await get().refresh();
  },
  async refresh() {
    set({ isLoading: true, error: null });
    try {
      const markets = await getServices().marketService.listMarkets(get().filters);
      set({ markets, isLoading: false });
    } catch (error) {
      set({
        markets: [],
        isLoading: false,
        error: error instanceof Error ? error.message : "Market data is unavailable.",
      });
    }
  },
}));

export const usePortfolioStore = create<PortfolioState>((set) => ({
  positions: [],
  claimedIds: [],
  error: null,
  async refresh(address) {
    try {
      const positions = await getServices().portfolioService.getPositions(address);
      set({ positions, error: null });
    } catch (error) {
      set({
        positions: [],
        error: error instanceof Error ? error.message : "Portfolio data is unavailable.",
      });
    }
  },
  async claim(positionId, transactionHash, chainId) {
    await getServices().portfolioService.claim(positionId, transactionHash, chainId);
    set((state) => ({ claimedIds: [...state.claimedIds, positionId] }));
  },
}));

export const useActivityStore = create<ActivityState>((set) => ({
  events: [],
  error: null,
  async refresh(limit = 20) {
    try {
      const events = await getServices().activityService.getRecent(limit);
      set({ events, error: null });
    } catch (error) {
      set({
        events: [],
        error: error instanceof Error ? error.message : "Activity data is unavailable.",
      });
    }
  },
  prepend(event) {
    set((state) => ({ events: [event, ...state.events] }));
  },
}));
