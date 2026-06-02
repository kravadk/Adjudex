import type {
  Account,
  ActivityEvent,
  AgentBadge,
  AgentEcosystem,
  AgentReputationPoint,
  BetQuote,
  BetReceipt,
  ClaimReceipt,
  HistoryRow,
  LeaderRow,
  Market,
  MarketSpec,
  Position,
  ResolutionResult,
} from "@/lib/types/domain";
import type { PariServices } from "../types";

export function createApiServices(baseUrl = ""): PariServices {
  return {
    marketService: {
      listMarkets: (filters = {}) => getJson<Market[]>(`${baseUrl}/api/markets?${new URLSearchParams(flatten(filters))}`),
      getMarket: (id) => getJson<Market>(`${baseUrl}/api/markets/${encodeURIComponent(id)}`),
      subscribeMarket(id, callback) {
        const timer = window.setInterval(() => {
          void getJson<Market>(`${baseUrl}/api/markets/${encodeURIComponent(id)}`).then(callback).catch(() => undefined);
        }, 10_000);
        return () => window.clearInterval(timer);
      },
      generateSpec: (prompt) => postJson<MarketSpec>(`${baseUrl}/api/markets/generate`, { prompt }),
      deployMarket: (spec) => postJson<Market>(`${baseUrl}/api/markets`, spec),
    },
    betService: {
      previewBet: (input) => postJson<BetQuote>(`${baseUrl}/api/bets/preview`, input),
      placeBet: (quote) => postJson<BetReceipt>(`${baseUrl}/api/bets`, quote),
    },
    portfolioService: {
      getPositions: (address) => getJson<Position[]>(`${baseUrl}/api/portfolio/${encodeURIComponent(address)}/positions`),
      getHistory: (address) => getJson<HistoryRow[]>(`${baseUrl}/api/portfolio/${encodeURIComponent(address)}/history`),
      claim: (positionId, transactionHash, chainId) => {
        if (!Number.isFinite(chainId)) throw new Error("Cannot claim because the transaction chain is unknown.");
        return postJson<ClaimReceipt>(`${baseUrl}/api/claim`, { positionId, transactionHash, chainId });
      },
    },
    agentService: {
      listAgents: () => getJson<AgentBadge[]>(`${baseUrl}/api/agents`),
      getEcosystem: () => getJson<AgentEcosystem>(`${baseUrl}/api/agents/ecosystem`),
      getAgent: (id) => getJson<AgentBadge>(`${baseUrl}/api/agents/${encodeURIComponent(id)}`),
      getAgentMoves: (id) => getJson<ActivityEvent[]>(`${baseUrl}/api/agents/${encodeURIComponent(id)}/moves`),
      getAgentReputation: (id) => getJson<AgentReputationPoint[]>(`${baseUrl}/api/agents/${encodeURIComponent(id)}/reputation`),
    },
    leaderboardService: {
      getLeaders: (filters = {}) => getJson<LeaderRow[]>(`${baseUrl}/api/leaderboard?${new URLSearchParams(flatten(filters))}`),
    },
    activityService: {
      getRecent: (limit = 20) => getJson<ActivityEvent[]>(`${baseUrl}/api/activity?limit=${limit}`),
      subscribe(callback) {
        const seenIds = new Set<string>();
        const timer = window.setInterval(() => {
          void getJson<ActivityEvent[]>(`${baseUrl}/api/activity?limit=10`)
            .then((events) => {
              for (const event of [...events].reverse()) {
                if (seenIds.has(event.id)) continue;
                seenIds.add(event.id);
                callback(event);
              }
            })
            .catch(() => undefined);
        }, 10_000);
        return () => window.clearInterval(timer);
      },
    },
    walletService: {
      connect: () => postJson<Account>(`${baseUrl}/api/wallet/connect`, {}),
      disconnect: () => postJson<void>(`${baseUrl}/api/wallet/disconnect`, {}),
      getAccount: () => getJson<Account | null>(`${baseUrl}/api/wallet`),
    },
    oracleService: {
      getResolution: (marketId) => getJson<ResolutionResult | "pending">(`${baseUrl}/api/oracle/${encodeURIComponent(marketId)}`),
    },
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

function flatten(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, String(value)])
  );
}
