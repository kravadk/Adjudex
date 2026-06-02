// Assembles a full PariServices bundle backed by Arbitrum Sepolia contracts.
// Wallet connection is owned by RainbowKit/wagmi; this service never fabricates
// wallet state.

import type { PariServices } from "../types";
import { createOnchainMarketService } from "./marketService";
import { createOnchainBetService } from "./betService";
import { createOnchainPortfolioService } from "./portfolioService";
import { createOnchainActivityService } from "./activityService";
import { createOnchainLeaderboardService } from "./leaderboardService";
import { createOnchainAgentService } from "./agentService";
import { createOnchainOracleService } from "./oracleService";

export function createOnchainServices(): PariServices {
  return {
    marketService: createOnchainMarketService(),
    betService: createOnchainBetService(),
    portfolioService: createOnchainPortfolioService(),
    agentService: createOnchainAgentService(),
    leaderboardService: createOnchainLeaderboardService(),
    activityService: createOnchainActivityService(),
    walletService: {
      async connect() {
        throw new Error("Wallet connection is handled by RainbowKit.");
      },
      async disconnect() {
        return undefined;
      },
      async getAccount() {
        return null;
      },
    },
    oracleService: createOnchainOracleService(),
  };
}


