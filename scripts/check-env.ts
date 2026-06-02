// Production env validation. Exits non-zero with a categorised report so
// CI/deploy pipelines can gate on it.
//
//   pnpm env:check                        -> soft mode (web + backend defaults)
//   pnpm env:check --profile=full         -> strict, requires every secret
//   pnpm env:check --profile=production   -> production-only invariants:
//                                            forbids JUDGE_MODE=local,
//                                            IPFS_PROVIDER=stub,
//                                            NEXT_PUBLIC_BACKEND=mock,
//                                            requires SENTRY_DSN, PINATA_JWT, etc.
//
// Categories:
//   FRONTEND  - anything Next reads (NEXT_PUBLIC_*, oracle URLs)
//   BACKEND   - Fastify API (Postgres, RPC, SIWE, signers)
//   INDEXER   - Postgres + RPC + indexer config
//   AGENTS    - mm-agent + ai-judge keys
//   IPFS      - ProofAnchor pin provider (only required if IPFS_PROVIDER != stub)
//   OBSERV    - Sentry, log level, alerting webhooks
//
// Each rule says (a) what env key, (b) which profile demands it, (c) what
// it controls. The script returns the missing+invalid keys grouped by
// category. Secrets are NEVER printed - only key names.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

type Profile = "soft" | "full" | "production";

type Rule = {
  key: string;
  category: "FRONTEND" | "BACKEND" | "INDEXER" | "AGENTS" | "IPFS" | "OBSERV";
  required: Profile[];
  format?: RegExp;
  description: string;
};

// Cross-rule production guards — values that must be REJECTED, not just
// formats. Run after individual rule checks under --profile=production.
type Forbid = {
  key: string;
  forbiddenValues: string[];
  reason: string;
};

const PRODUCTION_FORBID: Forbid[] = [
  {
    key: "JUDGE_MODE",
    forbiddenValues: ["local"],
    reason: "JUDGE_MODE=local exposes a host-held signing key; production must run inside Phala TEE (JUDGE_MODE=phala) with JUDGE_REMOTE_URL set.",
  },
  {
    key: "IPFS_PROVIDER",
    forbiddenValues: ["stub"],
    reason: "IPFS_PROVIDER=stub does not actually pin proofs. Production must use pinata / web3storage / kubo with a real credential.",
  },
  {
    key: "NEXT_PUBLIC_BACKEND",
    forbiddenValues: ["mock"],
    reason: "Mock service layer ships hard-coded fixtures and must never reach production.",
  },
  {
    key: "NODE_ENV",
    forbiddenValues: ["development", "test"],
    reason: "NODE_ENV must be 'production' under --profile=production.",
  },
];

const RULES: Rule[] = [
  // Frontend (Next)
  {
    key: "NEXT_PUBLIC_BACKEND",
    category: "FRONTEND",
    required: ["soft", "full"],
    format: /^(onchain|api|mock)$/,
    description: "frontend service-layer selector",
  },
  {
    key: "NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL",
    category: "FRONTEND",
    required: ["soft", "full"],
    format: /^https?:\/\//,
    description: "browser-side RPC for direct viem reads",
  },
  {
    key: "NEXT_PUBLIC_MARKET_FACTORY_ADDRESS",
    category: "FRONTEND",
    required: ["soft", "full"],
    format: /^0x[0-9a-fA-F]{40}$/,
    description: "MarketFactory deployment address",
  },
  {
    key: "NEXT_PUBLIC_STAKE_TOKEN_ADDRESS",
    category: "FRONTEND",
    required: ["soft", "full"],
    format: /^0x[0-9a-fA-F]{40}$/,
    description: "stake token (TestUSDC on Sepolia)",
  },
  {
    key: "NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS",
    category: "FRONTEND",
    required: ["full"],
    format: /^0x[0-9a-fA-F]{40}$/,
    description: "AIJudgeVerifier (V2 propose/finalize)",
  },
  {
    key: "NEXT_PUBLIC_PROOF_ANCHOR_ADDRESS",
    category: "FRONTEND",
    required: ["full"],
    format: /^0x[0-9a-fA-F]{40}$/,
    description: "ProofAnchor contract (Reclaim CID anchor)",
  },

  // Backend (Fastify)
  {
    key: "DATABASE_URL",
    category: "BACKEND",
    required: ["soft", "full"],
    format: /^postgres:\/\//,
    description: "Postgres connection string",
  },
  {
    key: "ARBITRUM_SEPOLIA_RPC_URL",
    category: "BACKEND",
    required: ["soft", "full"],
    format: /^https?:\/\//,
    description: "server-side RPC for verifying tx receipts",
  },
  {
    key: "SIWE_DOMAIN",
    category: "BACKEND",
    required: ["full"],
    description: "SIWE domain string (e.g. adjudex.app)",
  },
  {
    key: "JUDGE_PRIVATE_KEY",
    category: "BACKEND",
    required: ["full"],
    format: /^0x[0-9a-fA-F]{64}$/,
    description: "AI judge signing key",
  },
  {
    key: "QUOTE_SIGNER_PRIVATE_KEY",
    category: "BACKEND",
    required: ["full"],
    format: /^0x[0-9a-fA-F]{64}$/,
    description: "EIP-712 bet quote signer key",
  },
  {
    key: "BET_QUOTE_VERIFIER_ADDRESS",
    category: "BACKEND",
    required: ["full"],
    format: /^0x[0-9a-fA-F]{40}$/,
    description: "BetQuoteVerifier deployment for EIP-712 domain",
  },
  {
    key: "IMPORT_ADMIN_ADDRESSES",
    category: "BACKEND",
    required: ["full"],
    description: "comma-separated 0x admin allowlist",
  },
  {
    key: "RECLAIM_PROOF_WRITE_SECRET",
    category: "BACKEND",
    required: ["full"],
    description: "shared secret for Next -> backend proof writes",
  },

  // Indexer
  {
    key: "INDEXER_RPC_URL",
    category: "INDEXER",
    required: ["soft", "full"],
    format: /^https?:\/\//,
    description: "indexer worker RPC",
  },
  {
    key: "INDEXER_CHAIN_ID",
    category: "INDEXER",
    required: ["soft", "full"],
    format: /^\d+$/,
    description: "chain id (421614 = Arbitrum Sepolia)",
  },
  {
    key: "INDEXER_ID",
    category: "INDEXER",
    required: ["soft", "full"],
    description: "unique per-chain indexer slug",
  },
  {
    key: "INDEXER_INTERVAL_MS",
    category: "INDEXER",
    required: ["soft", "full"],
    format: /^\d+$/,
    description: "poll interval in ms",
  },
  {
    key: "INDEXER_MAX_BLOCK_RANGE",
    category: "INDEXER",
    required: ["soft", "full"],
    format: /^\d+$/,
    description: "per-sync block window",
  },
  {
    key: "INDEXER_CONFIRMATIONS",
    category: "INDEXER",
    required: ["full"],
    format: /^\d+$/,
    description: "block confirmation depth (reorg safety)",
  },

  // Agents
  {
    key: "MM_AGENT_PRIVATE_KEY",
    category: "AGENTS",
    required: ["full"],
    format: /^0x[0-9a-fA-F]{64}$/,
    description: "market-maker agent EOA",
  },
  {
    key: "ANTHROPIC_API_KEY",
    category: "AGENTS",
    required: ["full"],
    description: "Claude key for AI judge",
  },

  // IPFS
  {
    key: "IPFS_PROVIDER",
    category: "IPFS",
    required: ["full", "production"],
    format: /^(stub|pinata|web3storage|kubo)$/,
    description: "pin provider for Reclaim proofs",
  },
  {
    key: "PINATA_JWT",
    category: "IPFS",
    required: ["production"],
    description: "Pinata API JWT for pinning ProofAnchor CIDs",
  },

  // Observability (Sentry + structured logging + alert routing)
  {
    key: "SENTRY_DSN",
    category: "OBSERV",
    required: ["production"],
    format: /^https?:\/\/[a-z0-9]+@[a-z0-9.-]+\/[0-9]+$/i,
    description: "Sentry DSN for backend error capture",
  },
  {
    key: "NEXT_PUBLIC_SENTRY_DSN",
    category: "OBSERV",
    required: ["production"],
    format: /^https?:\/\/[a-z0-9]+@[a-z0-9.-]+\/[0-9]+$/i,
    description: "Sentry DSN for frontend error capture",
  },
  {
    key: "LOG_LEVEL",
    category: "OBSERV",
    required: ["production"],
    format: /^(trace|debug|info|warn|error|fatal)$/,
    description: "Pino logger level for backend services",
  },

  // Production-only chain + governance keys
  {
    key: "JUDGE_MODE",
    category: "BACKEND",
    required: ["production"],
    format: /^(phala|server)$/,
    description: "Judge execution mode (phala TEE required in prod)",
  },
  {
    key: "JUDGE_REMOTE_URL",
    category: "BACKEND",
    required: ["production"],
    format: /^https?:\/\//,
    description: "Phala CVM endpoint for the AI judge worker",
  },
  {
    key: "NODE_ENV",
    category: "BACKEND",
    required: ["production"],
    format: /^production$/,
    description: "Must be 'production' for production deploy",
  },
];

function parseProfile(argv: string[]): Profile {
  for (const arg of argv) {
    if (arg === "--profile=full") return "full";
    if (arg === "--profile=soft") return "soft";
    if (arg === "--profile=production") return "production";
  }
  return "soft";
}

function loadEnv(): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  const envPath = join(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (merged[key] === undefined) merged[key] = value;
    }
  }
  return merged;
}

function main() {
  const profile = parseProfile(process.argv.slice(2));
  const env = loadEnv();

  const missing: Rule[] = [];
  const invalid: Array<{ rule: Rule; reason: string }> = [];
  const optionalMissing: Rule[] = [];

  for (const rule of RULES) {
    const value = env[rule.key]?.trim();
    // "production" is a superset of "full": every key required under
    // --profile=full is also required under --profile=production, plus
    // production-only keys. Rules opt into production via required: ["production"].
    const isRequired =
      rule.required.includes(profile) ||
      (profile === "production" && rule.required.includes("full"));
    if (!value) {
      if (isRequired) missing.push(rule);
      else optionalMissing.push(rule);
      continue;
    }
    if (rule.format && !rule.format.test(value)) {
      invalid.push({ rule, reason: `does not match ${rule.format.source}` });
    }
  }

  console.log(`Profile: ${profile}`);
  console.log(`Checked ${RULES.length} rules\n`);

  const byCat = (rules: Rule[]) => {
    const out: Record<string, Rule[]> = {};
    for (const r of rules) (out[r.category] ??= []).push(r);
    return out;
  };

  if (missing.length) {
    console.error("MISSING required env keys:");
    const groups = byCat(missing);
    for (const cat of Object.keys(groups)) {
      console.error(`  [${cat}]`);
      for (const r of groups[cat]) console.error(`    - ${r.key}: ${r.description}`);
    }
    console.error("");
  }
  if (invalid.length) {
    console.error("INVALID env values:");
    for (const { rule, reason } of invalid) {
      console.error(`  - ${rule.key}: ${reason}`);
    }
    console.error("");
  }
  if (optionalMissing.length) {
    console.log("Optional keys not set (OK in this profile):");
    for (const r of optionalMissing) console.log(`  - ${r.key}: ${r.description}`);
    console.log("");
  }

  // Cross-rule production guards: reject literal forbidden values for
  // specific keys (e.g. JUDGE_MODE=local, IPFS_PROVIDER=stub).
  const forbidden: Array<{ forbid: Forbid; actual: string }> = [];
  if (profile === "production") {
    for (const f of PRODUCTION_FORBID) {
      const value = env[f.key]?.trim();
      if (value && f.forbiddenValues.includes(value)) {
        forbidden.push({ forbid: f, actual: value });
      }
    }
  }

  if (forbidden.length) {
    console.error("FORBIDDEN values in profile=production:");
    for (const { forbid, actual } of forbidden) {
      console.error(`  - ${forbid.key}=${actual}`);
      console.error(`    reason: ${forbid.reason}`);
    }
    console.error("");
  }

  if (missing.length || invalid.length || forbidden.length) {
    console.error(
      `FAIL: ${missing.length} missing, ${invalid.length} invalid, ${forbidden.length} forbidden in profile=${profile}`,
    );
    process.exit(1);
  }
  console.log(`OK: all required keys present and well-formed`);
}

main();
