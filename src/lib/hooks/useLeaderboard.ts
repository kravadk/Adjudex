"use client";

import { useEffect, useState } from "react";
import { getServices } from "@/lib/services/provider";
import type { LeaderRow } from "@/lib/types/domain";

export function useLeaderboard(filters?: { range?: "7d" | "30d" | "all"; pool?: "humans" | "ai" | "combined" }) {
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getServices().leaderboardService.getLeaders(filters)
      .then((rows) => {
        if (!active) return;
        setLeaders(rows);
        setError(null);
      })
      .catch((nextError) => {
        if (!active) return;
        setLeaders([]);
        setError(nextError instanceof Error ? nextError.message : "Leaderboard data is unavailable.");
      });
    return () => {
      active = false;
    };
  }, [filters]);
  return { leaders, error };
}
