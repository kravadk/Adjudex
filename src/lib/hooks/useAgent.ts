"use client";

import { useEffect, useState } from "react";
import { getServices } from "@/lib/services/provider";
import type { ActivityEvent, AgentBadge, AgentReputationPoint } from "@/lib/types/domain";

export function useAgent(id?: string) {
  const [agent, setAgent] = useState<AgentBadge | null>(null);
  const [moves, setMoves] = useState<ActivityEvent[]>([]);
  const [reputation, setReputation] = useState<AgentReputationPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void Promise.all([
      getServices().agentService.getAgent(id),
      getServices().agentService.getAgentMoves(id),
      getServices().agentService.getAgentReputation(id),
    ])
      .then(([nextAgent, nextMoves, nextReputation]) => {
        if (!active) return;
        setAgent(nextAgent);
        setMoves(nextMoves);
        setReputation(nextReputation);
        setError(null);
      })
      .catch((nextError) => {
        if (!active) return;
        setAgent(null);
        setMoves([]);
        setReputation([]);
        setError(nextError instanceof Error ? nextError.message : "Agent data is unavailable.");
      });
    return () => {
      active = false;
    };
  }, [id]);

  return { agent, moves, reputation, error };
}
