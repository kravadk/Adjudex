// Re-deploy real market specs (mirrored from the live /api/markets feed —
// Polymarket / sports / RWA questions) onto the CURRENT MARKET_FACTORY_ADDRESS
// with fresh deadlines, then place asymmetric YES/NO bets so the board shows
// real, non-50/50, active markets. Uses the production deployMarketFromMatch()
// path (on-chain createSoftMarket + markets/auto_markets DB rows) so the UI
// surfaces them immediately. Testnet only; single wallet for create + bets.
// Run: SEED_API_BASE=... MARKET_CREATOR_PRIVATE_KEY=<key> pnpm tsx --env-file=.env.local scripts/seed-real-board.ts
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { deployMarketFromMatch } from "../services/api/src/market-deployer";
import type { IngestMatch } from "../services/api/src/feeds/types";

// The auto-deployer signs with MARKET_CREATOR_PRIVATE_KEY; fall back to the
// deployer key so this one-off seed only needs DATABASE_URL added to run.
if (!process.env.MARKET_CREATOR_PRIVATE_KEY && process.env.DEPLOYER_PRIVATE_KEY) {
  process.env.MARKET_CREATOR_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
}

const rpc = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
const stake = process.env.STAKE_TOKEN_ADDRESS! as `0x${string}`;
const apiBase = process.env.SEED_API_BASE || "https://adjudex-api.onrender.com";
const count = Number(process.env.SEED_COUNT || "6");
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY! as Hex);
const ax = (h: string) => `https://sepolia.arbiscan.io/tx/${h}`;

const poolAbi = [
  { type: "function", name: "bet", stateMutability: "nonpayable", inputs: [{ name: "side", type: "uint8" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;
const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const pub = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
const w = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpc) });
const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const PLAN: Array<[number, number]> = [[12, 5], [6, 11], [15, 4], [9, 14], [20, 7], [5, 9]];

type ApiMarket = { id: string; title?: string; description?: string; category?: string; emoji?: string; sourceUrl?: string; resolutionCriteria?: string };

async function bet(pool: `0x${string}`, side: number, amount: bigint, label: string) {
  try {
    const h = await w.writeContract({ address: pool, abi: poolAbi, functionName: "bet", args: [side, amount] });
    const r = await pub.waitForTransactionReceipt({ hash: h });
    console.log(`    ${label}: ${r.status}  ${ax(h)}`);
  } catch (e) {
    console.log(`    ${label}: SKIP (${(e as Error).message.split("\n")[0].slice(0, 70)})`);
  }
}

async function main() {
  console.log("wallet:", account.address, "| factory:", process.env.MARKET_FACTORY_ADDRESS);
  const res = await fetch(`${apiBase}/api/markets?limit=40`);
  const all = (await res.json()) as ApiMarket[];
  const picks = all.slice(0, count);
  const close = new Date(Date.now() + 5 * 86400_000).toISOString();
  const start = new Date(Date.now() + 3600_000).toISOString();

  for (let i = 0; i < picks.length; i++) {
    const m = picks[i];
    const cat = (["crypto", "stocks", "sports", "soft", "macro"].includes(m.category || "") ? m.category : "crypto") as IngestMatch["marketCategory"];
    const match: IngestMatch = {
      externalMatchId: `seed-${m.id}-${i}-${close.slice(0, 10)}`,
      sourceKind: "polymarket",
      category: "external",
      marketCategory: cat,
      titleOverride: m.title,
      questionOverride: m.title,
      descriptionOverride: m.description || m.title,
      resolutionCriteriaOverride: m.resolutionCriteria || "Resolves per the linked source.",
      emoji: m.emoji,
      teamA: "Yes",
      teamB: "No",
      matchStartsAtIso: start,
      sourceUrl: m.sourceUrl || "https://polymarket.com",
      closeAtIsoOverride: close,
    };
    console.log(`\n  [${i + 1}/${picks.length}] "${(m.title || "").slice(0, 50)}"`);
    let out;
    try {
      out = await deployMarketFromMatch(match);
    } catch (e) {
      console.log(`    deploy ERROR: ${(e as Error).message.slice(0, 90)}`);
      continue;
    }
    if (out.status !== "deployed") {
      console.log(`    skipped: ${out.reason}`);
      continue;
    }
    const pool = out.poolAddress as `0x${string}`;
    console.log(`    deployed market ${out.marketId}  pool ${pool}  ${ax(out.txHash)}`);
    const [yes, no] = PLAN[i % PLAN.length];
    const allow = (await pub.readContract({ address: stake, abi: erc20Abi, functionName: "allowance", args: [account.address, pool] })) as bigint;
    if (allow < usdc(yes + no)) {
      const h = await w.writeContract({ address: stake, abi: erc20Abi, functionName: "approve", args: [pool, 2n ** 256n - 1n] });
      await pub.waitForTransactionReceipt({ hash: h });
    }
    await bet(pool, 0, usdc(yes), `bet YES $${yes}`);
    await bet(pool, 1, usdc(no), `bet NO $${no}`);
  }
  console.log("\nseed-real-board done.");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
