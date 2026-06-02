"use client";

import { useCallback, useEffect, useState } from "react";
import type { SystemStatus } from "@/lib/types/domain";

export function useSystemStatus(open = true) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      setStatus((await response.json()) as SystemStatus);
    } catch (nextError) {
      setStatus(null);
      setError(nextError instanceof Error ? nextError.message : "System status is unavailable.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [open, refresh]);

  return { status, error, isLoading, refresh };
}
