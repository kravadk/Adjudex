"use client";

import { useEffect, useState } from "react";
import type { AgentEcosystem } from "@/lib/types/domain";

export function useAgentEcosystem() {
  const [ecosystem, setEcosystem] = useState<AgentEcosystem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/agents/ecosystem", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<AgentEcosystem>;
      })
      .then((nextEcosystem) => {
        if (!active) return;
        setEcosystem(nextEcosystem);
        setError(null);
      })
      .catch((nextError) => {
        if (!active) return;
        setEcosystem(null);
        setError(nextError instanceof Error ? nextError.message : "Agent ecosystem is unavailable.");
      });
    return () => {
      active = false;
    };
  }, []);

  return { ecosystem, error };
}
