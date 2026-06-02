import type {
  Account,
  ActivityEvent,
  AgentBadge,
  AgentEcosystem,
  AgentReputationPoint,
  BetPreviewInput,
  BetQuote,
  BetReceipt,
  ClaimReceipt,
  HistoryRow,
  LeaderRow,
  Market,
  MarketFilters,
  MarketSpec,
  Position,
  ResolutionResult,
} from "@/lib/types/domain";

export type Unsubscribe = () => void;

export interface MarketService {
  listMarkets(filters?: MarketFilters): Promise<Market[]>;
  getMarket(id: string): Promise<Market>;
  subscribeMarket(id: string, cb: (market: Market) => void): Unsubscribe;
  generateSpec(prompt: string): Promise<MarketSpec>;
  deployMarket(spec: MarketSpec): Promise<Market>;
}

export interface BetService {
  previewBet(input: BetPreviewInput): Promise<BetQuote>;
  placeBet(quote: BetQuote): Promise<BetReceipt>;
}

export interface PortfolioService {
  getPositions(address: string): Promise<Position[]>;
  getHistory(address: string): Promise<HistoryRow[]>;
  claim(positionId: string, transactionHash: `0x${string}` | undefined, chainId: number): Promise<ClaimReceipt>;
}

export interface AgentService {
  listAgents(): Promise<AgentBadge[]>;
  getEcosystem(): Promise<AgentEcosystem>;
  getAgent(id: string): Promise<AgentBadge>;
  getAgentMoves(id: string): Promise<ActivityEvent[]>;
  getAgentReputation(id: string): Promise<AgentReputationPoint[]>;
}

export interface LeaderboardService {
  getLeaders(filters?: { range?: "7d" | "30d" | "all"; pool?: "humans" | "ai" | "combined" }): Promise<LeaderRow[]>;
}

export interface ActivityService {
  getRecent(limit?: number): Promise<ActivityEvent[]>;
  subscribe(cb: (event: ActivityEvent) => void): Unsubscribe;
}

export interface WalletService {
  connect(): Promise<Account>;
  disconnect(): Promise<void>;
  getAccount(): Promise<Account | null>;
}

export interface OracleService {
  getResolution(marketId: string): Promise<ResolutionResult | "pending">;
}

export type PariServices = {
  marketService: MarketService;
  betService: BetService;
  portfolioService: PortfolioService;
  agentService: AgentService;
  leaderboardService: LeaderboardService;
  activityService: ActivityService;
  walletService: WalletService;
  oracleService: OracleService;
};
