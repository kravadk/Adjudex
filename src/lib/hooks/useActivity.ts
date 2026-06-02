"use client";

import { useEffect } from "react";
import { getServices } from "@/lib/services/provider";
import { useActivityStore } from "@/lib/store";

export function useActivity(limit = 20) {
  const events = useActivityStore((state) => state.events);
  const error = useActivityStore((state) => state.error);
  const refresh = useActivityStore((state) => state.refresh);
  const prepend = useActivityStore((state) => state.prepend);
  useEffect(() => {
    void refresh(limit);
    return getServices().activityService.subscribe(prepend);
  }, [limit, prepend, refresh]);
  return { events, error, refresh, prepend };
}
