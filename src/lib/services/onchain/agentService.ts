// On-chain AgentService.
//
// Agents are off-chain. ReputationOracle stores bytes32 -> uint256 only.
// Until an ERC-8004 registry is deployed, return an empty roster instead
// of fabricating AI agents.

import type { AgentBadge, ActivityEvent, AgentEcosystem } from "@/lib/types/domain";
import type { AgentService } from "../types";

export function createOnchainAgentService(): AgentService {
  return {
    async listAgents(): Promise<AgentBadge[]> {
      return [];
    },
    async getEcosystem(): Promise<AgentEcosystem> {
      return {
        status: "empty",
        registryConfigured: false,
        agentCount: 0,
        activeAgentCount: 0,
        totalVolumeUsd: 0,
        totalPnlUsd: 0,
        averageReputation: 0,
        marketsTouched: 0,
        topAgents: [],
        recentMoves: [],
      };
    },
    async getAgent(id: string): Promise<AgentBadge> {
      throw new Error(`Agent ${id} not found - on-chain registry not deployed yet.`);
    },
    async getAgentMoves(): Promise<ActivityEvent[]> {
      return [];
    },
    async getAgentReputation() {
      return [];
    },
  };
}


