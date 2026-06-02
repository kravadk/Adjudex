export type OracleType = "chainlink-price" | "zktls-ai-oracle" | "manual";
export type MarketCategory = "stocks" | "crypto" | "sports" | "esports" | "soft";
export type MarketStatus = "draft" | "open" | "locked" | "resolving" | "resolved" | "claimable" | "archived";
export type BetSide = "YES" | "NO";
export type MarketKind = "moneyline" | "handicap" | "totals" | "prop";
export type EsportsGame =
  | "cs2"
  | "dota2"
  | "lol"
  | "valorant"
  | "r6"
  | "overwatch"
  | "rocket-league"
  | "starcraft2"
  | "call-of-duty"
  | "other";

export type Market = {
  id: string;
  poolAddress?: `0x${string}`;
  chainId?: number;
  factoryAddress?: string;
  creationTxHash?: string;
  creatorAddress?: string;
  emoji: string;
  title: string;
  description: string;
  category: MarketCategory;
  oracleType: OracleType;
  status: MarketStatus;
  asset: "USDC" | "tokenized-TSLA" | "tokenized-AAPL";
  volumeUsd: number;
  yesProbability: number;
  yesProbabilityChange1h: number;
  bettors: number;
  aiLpCount: number;
  isHot: boolean;
  deadlineIso: string;
  resolvedOutcome?: BetSide;
  sourceUrl?: string;
  resolutionCriteria?: string;
  resolverAddress?: string;
  resolutionTxHash?: string;
  resolutionEvidenceHash?: string;
  resolutionProposer?: string;
  resolutionProposedAtIso?: string;
  resolutionProofTxHash?: string;
  proofUrl?: string;
  importSourceId?: string;
  importCandidateId?: string;
  sourcePublishedAtIso?: string;
  provenanceNote?: string;
  // Esports-specific opt-in fields. All nullable: legacy non-esports
  // markets ignore them; importer / creator UI surface them when
  // category === "esports".
  game?: EsportsGame;
  tournament?: string;
  teamA?: string;
  teamB?: string;
  matchStartsAtIso?: string;
  bestOfMaps?: number;
  streamUrl?: string;
  // Sub-market grouping. `parentMarketId` links a prop market to the
  // moneyline market for the same event; `kind` distinguishes the type.
  parentMarketId?: string;
  kind?: MarketKind;
  // Social-proof preview (S6.A). Up to 3 most recent distinct trader
  // addresses on this market, ordered newest-first. Used by <TraderStack>
  // on market cards. The full bettor count stays in `bettors`.
  recentTraders?: string[];
};

export type AgentBadge = {
  id: string;
  handle: string;
  emoji: string;
  reputation: number;
  lifetimePnlUsd: number;
  marketsTouched: number;
  erc8004Address: string;
  chainId?: number;
  registrationTxHash?: string;
  registeredAtIso?: string;
  strategyDescription?: string;
  // Optional long-form markdown disclosure of how the agent trades.
  // Rendered on /agent/:id when present.
  strategyText?: string;
  // Optional category filter (e.g. "esports") so the leaderboard can
  // segment performance by where the agent trades.
  primaryCategory?: MarketCategory;
  proofUrl?: string;
  lastAction?: string;
};

export type AgentEcosystem = {
  status: "active" | "empty";
  registryConfigured: boolean;
  reputationOracleAddress?: string;
  agentCount: number;
  activeAgentCount: number;
  totalVolumeUsd: number;
  totalPnlUsd: number;
  averageReputation: number;
  marketsTouched: number;
  topAgents: AgentBadge[];
  recentMoves: ActivityEvent[];
};

export type AgentReputationPoint = {
  id: string;
  agentId: string;
  reputation: number;
  lifetimePnlUsd: number;
  marketsTouched: number;
  proofUrl?: string;
  reason?: string;
  transactionHash?: string;
  chainId?: number;
  atIso: string;
};

export type ActivityEvent = {
  id: string;
  kind: "bet" | "ai-lp" | "resolution" | "claim" | "refund";
  chainId?: number;
  transactionHash?: string;
  side?: BetSide;
  amountUsd?: number;
  walletShort?: string;
  agentHandle?: string;
  marketTitle?: string;
  resolvedAs?: BetSide;
  atIso: string;
};

export type UserStats = {
  walletShort: string;
  totalStakedUsd: number;
  winRate: number;
  openPositions: number;
};

export type Account = {
  address: string;
  walletShort: string;
};

export type MarketFilters = {
  category?: MarketCategory | "all";
  hotOnly?: boolean;
  query?: string;
};

export type MarketSpec = {
  title: string;
  description: string;
  category: MarketCategory;
  oracleType: OracleType;
  asset: Market["asset"];
  deadlineIso: string;
  feeBps: number;
  sourceUrl: string;
  resolutionCriteria: string;
};

export type BetPreviewInput = {
  marketId: string;
  side: BetSide;
  stakeUsd: number;
  address?: string;
};

export type BetQuote = BetPreviewInput & {
  price: number;
  shares: number;
  potentialPayoutUsd: number;
  poolImpactPct?: number;
  estimatedGasUsd?: number;
  requiredContract?: string;
  requiredFunction?: string;
  transactionHash?: `0x${string}`;
  positionId?: string;
  chainId?: number;
};

export type BetReceipt = {
  id: string;
  marketId: string;
  positionId: string;
  activityId: string;
  status: "confirmed";
  createdAtIso: string;
};

export type Position = {
  id: string;
  address: string;
  marketId: string;
  chainId?: number;
  side: BetSide;
  stakeUsd: number;
  avgPrice: number;
  shares: number;
  status: "open" | "claimable" | "claimed" | "lost" | "refunded";
  createdAtIso: string;
  transactionHash?: string;
  payoutUsd?: number;
};

export type HistoryRow = {
  id: string;
  positionId: string;
  marketId: string;
  chainId?: number;
  side: BetSide;
  stakeUsd: number;
  payoutUsd: number;
  transactionHash?: string;
  createdAtIso: string;
};

export type ClaimReceipt = {
  id: string;
  positionId: string;
  payoutUsd: number;
  status: "claimed";
  createdAtIso: string;
};

export type LeaderRow = {
  id: string;
  kind: "human" | "ai";
  handle: string;
  volumeUsd: number;
  pnlUsd: number;
  winRate: number;
  reputation?: number;
  marketsTouched?: number;
  // Optional dominant category for this trader (e.g. "esports"). Used
  // by the leaderboard "category" filter chips.
  primaryCategory?: MarketCategory;
};

export type ResolutionResult = {
  side: BetSide;
  resolvedAtIso: string;
};

export type ChainRuntimeStatus = {
  ok: boolean;
  configured: boolean;
  blockNumber?: number;
  chainId?: number;
  error?: string;
};

export type ChainSystemStatus = {
  chainId: number;
  factoryAddress: string | null;
  rpcConfigured: boolean;
  rpc: ChainRuntimeStatus;
  indexer: IndexerStatus | null;
};

export type IndexerStatus = { id: string; chainId: number; lastBlock: number; updatedAtIso: string };

export type SystemStatus = {
  api: boolean;
  database: { ok: boolean };
  rpc: ChainRuntimeStatus;
  chains: {
    arbitrumSepolia: ChainSystemStatus;
    rhc: ChainSystemStatus;
  };
  indexer: IndexerStatus | null;
};

export type MarketTimelinePoint = {
  id: string;
  marketId: string;
  chainId?: number;
  yesProbability: number;
  volumeUsd: number;
  eventKind: string;
  transactionHash?: string;
  blockHash?: string;
  blockNumber?: number;
  logIndex?: number;
  atIso: string;
};

export type UserSettings = {
  address: string;
  preferredChain: string;
  currencyDisplay: string;
  notificationsEnabled: boolean;
  animationsEnabled: boolean;
  compactMode: boolean;
  defaultStakeUsd: number;
  explorerPreference: string;
};

export type WatchlistItem = {
  marketId: string;
  createdAtIso: string;
};

export type NotificationEvent = {
  id: string;
  kind: string;
  marketId?: string;
  title: string;
  body: string;
  read: boolean;
  createdAtIso: string;
};

export type MarketValidationResult = {
  ok: boolean;
  errors: string[];
  warnings?: string[];
};

export type ImportSource = {
  id: string;
  name: string;
  kind: "rss" | "json";
  url: string;
  category: MarketCategory;
  oracleType: OracleType;
  active: boolean;
};

export type ImportCandidate = {
  id: string;
  sourceId: string;
  title: string;
  sourceUrl: string;
  sourcePublishedAtIso?: string;
  eventDateIso?: string;
  category: MarketCategory;
  question: string;
  description: string;
  oracleType: OracleType;
  asset: "USDC";
  deadlineIso?: string;
  resolutionCriteria?: string;
  confidence: number;
  status: "needs_review" | "rejected" | "validated" | "deployed";
  riskFlags: string[];
  validationErrors: string[];
  spec?: MarketSpec;
  specHash?: `0x${string}`;
  specUri?: string;
  createdAtIso: string;
  updatedAtIso: string;
};
