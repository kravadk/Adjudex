// On-chain plumbing shared by the auto-ingest pipeline (deployer + resolve
// worker). A single hot wallet, MARKET_CREATOR_PRIVATE_KEY, signs the
// createSoftMarket / finalize transactions. It is intentionally NOT the
// deployer key and NOT the judge key — give it a small ETH balance for gas
// only, and rotate it freely. The judge verdict signature still comes from
// JUDGE_PRIVATE_KEY via the /api/judge/resolve route.

import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

export const AUTO_CHAIN_ID = 421614;

// Sign a judge verdict exactly the way AIJudgeVerifier.sol verifies it:
// inner = keccak256(abi.encode(chainId, pool, marketId, outcome, evidenceHash));
// signature = personal_sign(inner) by JUDGE_PRIVATE_KEY (EIP-191 prefix is
// applied by signMessage over the raw 32-byte digest). The verdict outcome
// is the deterministic match result; evidenceHash binds the result payload.
export async function signJudgeVerdict(input: {
  pool: `0x${string}`;
  marketId: bigint;
  outcome: number;
  evidenceHash: `0x${string}`;
}): Promise<`0x${string}`> {
  const key = process.env.JUDGE_PRIVATE_KEY?.trim();
  if (!key) throw new Error("JUDGE_PRIVATE_KEY missing");
  const judge = privateKeyToAccount(key as Hex);
  const inner = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "bytes32" },
      ],
      [BigInt(AUTO_CHAIN_ID), input.pool, input.marketId, input.outcome, input.evidenceHash],
    ),
  );
  return judge.signMessage({ message: { raw: inner } });
}

export function autoPipelineConfigError(): string | null {
  if (!process.env.ARBITRUM_SEPOLIA_RPC_URL?.trim()) return "ARBITRUM_SEPOLIA_RPC_URL missing";
  if (!process.env.MARKET_CREATOR_PRIVATE_KEY?.trim()) return "MARKET_CREATOR_PRIVATE_KEY missing";
  if (!process.env.MARKET_FACTORY_ADDRESS?.trim()) return "MARKET_FACTORY_ADDRESS missing";
  if (!process.env.AI_JUDGE_VERIFIER_ADDRESS?.trim()) return "AI_JUDGE_VERIFIER_ADDRESS missing";
  return null;
}

export function getCreatorClients() {
  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
  const account = privateKeyToAccount(process.env.MARKET_CREATOR_PRIVATE_KEY! as Hex);
  const transport = http(rpcUrl);
  return {
    account,
    chainId: AUTO_CHAIN_ID,
    factoryAddress: process.env.MARKET_FACTORY_ADDRESS! as `0x${string}`,
    verifierAddress: process.env.AI_JUDGE_VERIFIER_ADDRESS! as `0x${string}`,
    publicClient: createPublicClient({ chain: arbitrumSepolia, transport }),
    walletClient: createWalletClient({ account, chain: arbitrumSepolia, transport }),
  };
}

// createSoftMarket(specHash, deadline, verifier, specUri) + MarketCreated.
export const marketFactoryWriteAbi = [
  {
    type: "function",
    name: "createSoftMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "specHash", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "verifier", type: "address" },
      { name: "specUri", type: "string" },
    ],
    outputs: [{ name: "marketId", type: "uint256" }],
  },
  {
    type: "event",
    name: "MarketCreated",
    inputs: [
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: true, name: "pool", type: "address" },
      { indexed: true, name: "specHash", type: "bytes32" },
      { indexed: false, name: "creator", type: "address" },
      { indexed: false, name: "resolver", type: "address" },
      { indexed: false, name: "deadline", type: "uint256" },
      { indexed: false, name: "specUri", type: "string" },
    ],
  },
] as const;

// propose / finalize + the proposals view for the resolve worker.
export const aiJudgeVerifierWriteAbi = [
  {
    type: "function",
    name: "propose",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pool", type: "address" },
      { name: "marketId", type: "uint256" },
      { name: "outcome", type: "uint8" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "finalize",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "proposals",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "pool", type: "address" },
      { name: "outcome", type: "uint8" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "proposedAt", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "challenger", type: "address" },
    ],
  },
] as const;

// Proposal.status enum (matches AIJudgeVerifier.sol ordering).
export const PROPOSAL_STATUS = {
  NONE: 0,
  PENDING: 1,
  DISPUTED: 2,
  FINALIZED: 3,
} as const;

// Minimal ERC-20 for the bond/stake token (USDC) used by the optimistic flow.
export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// OptimisticOracleResolver: assert / dispute / settle / arbitrate + views.
export const optimisticResolverAbi = [
  {
    type: "function",
    name: "assertOutcome",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pool", type: "address" },
      { name: "marketId", type: "uint256" },
      { name: "outcome", type: "uint8" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },
  { type: "function", name: "dispute", stateMutability: "nonpayable", inputs: [{ name: "marketId", type: "uint256" }], outputs: [] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ name: "marketId", type: "uint256" }], outputs: [] },
  {
    type: "function",
    name: "resolveDispute",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }, { name: "finalOutcome", type: "uint8" }],
    outputs: [],
  },
  { type: "function", name: "defaultBond", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "canSettle", stateMutability: "view", inputs: [{ name: "marketId", type: "uint256" }], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "assertions",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "pool", type: "address" },
      { name: "asserter", type: "address" },
      { name: "disputer", type: "address" },
      { name: "outcome", type: "uint8" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "assertedAt", type: "uint64" },
      { name: "liveness", type: "uint64" },
      { name: "bond", type: "uint256" },
      { name: "status", type: "uint8" },
    ],
  },
] as const;

export function optimisticResolverAddress(): `0x${string}` | null {
  const a = process.env.OPTIMISTIC_ORACLE_RESOLVER_ADDRESS?.trim();
  return a ? (a as `0x${string}`) : null;
}

// Opt-in: new soft markets use the optimistic (bond/dispute) resolver instead
// of AIJudgeVerifier, and the resolve worker asserts + settles through it.
export function optimisticResolutionEnabled(): boolean {
  return process.env.OPTIMISTIC_RESOLUTION_ENABLED === "1" && Boolean(optimisticResolverAddress());
}

// Assertion.status enum (matches OptimisticOracleResolver.sol ordering).
export const ASSERTION_STATUS = { NONE: 0, ASSERTED: 1, DISPUTED: 2, SETTLED: 3 } as const;
