<div align="center">
  <img src="public/logo.png" alt="Adjudex" width="128" height="128" />
  <h1>Adjudex</h1>
  <p><strong>AI-native parimutuel prediction markets on Arbitrum.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
    <img src="https://img.shields.io/badge/Solidity-0.8.26-363636?logo=solidity" alt="Solidity 0.8.26" />
    <img src="https://img.shields.io/badge/chain-Arbitrum%20Sepolia-28a0f0?logo=arbitrum" alt="Arbitrum Sepolia" />
    <img src="https://img.shields.io/badge/license-MIT-d9ff00" alt="MIT License" />
  </p>
</div>

---

Parimutuel pools with an optimistic AI judge, on-chain Reclaim zkTLS proof
anchors, EIP-712 signed bet quotes, and a hardened Postgres-backed indexer.

Adjudex takes a strict view of where data lives. Markets, balances,
positions, activity, timelines, resolution status, settings, watchlists,
and notifications must come from contracts, the indexer, the
Postgres-backed API, SIWE-authenticated backend persistence, or confirmed
chain reads. If a service is missing, the UI returns explicit empty
states — never fabricates records.

---

## Product flow

```text
Discover -> Trust -> Connect -> Act -> Track -> Resolve -> Share
```

The end-to-end on-chain lifecycle:

```text
createMarket -> approve -> bet -> indexer picks up event ->
  propose (AI judge) -> 2h challenge window ->
    finalize -> claim -> portfolio reflects payout
```

---

## Feature highlights

**Trading**
- Parimutuel YES/NO pools with USDC stake; winners split the total pool
  pro-rata.
- Opt-in AMM markets via `OutcomeSharePool`: buy/sell outcome shares,
  vault-seeded liquidity, chain-event indexing, and a real Exit/Sell panel
  on AMM market pages.
- Signed limit orders via EIP-712 order intents: the UI signs real intents,
  the backend stores only signed rows, and settlement is guarded by
  `AdjudexOrderMatcher`.
- One-click USDC faucet on testnet; `approve(MAX_UINT256)` so each
  wallet approves the stake token once per pool.
- BetForm with real on-chain balance, accurate post-bet probability
  projection, slippage in bps with color tone, and explicit
  insufficient-balance / high-slippage warning banners.
- EIP-712 signed bet quotes (`/api/bets/quote` → `BetQuoteVerifier`).

**Resolution**
- Optimistic AI judge: `propose` → 2h challenge window → `finalize`.
- Anyone can `challenge` inside the window; owner can
  `overrideAndFinalize` a disputed proposal.
- AI verdict optionally produced inside Phala TEE; signed with
  `JUDGE_PRIVATE_KEY` (or remote TEE worker via `JUDGE_REMOTE_URL`).
- Reclaim zkTLS proof pinned to IPFS and anchored on-chain via
  `ProofAnchor.anchor()` — every resolved market can be traced back to
  the exact proof bytes.

**Markets**
- Create flow: AI spec generator (Claude) + manual editor.
- Market Importer: scans RSS/API/event sources, normalizes
  source-backed candidates, admin (SIWE + allowlist) validates and
  deploys.
- Per-market detail: probability chart, live trust panel, BetForm,
  `<ResolutionStatus>`, activity feed, market timeline, watchlist
  toggle, share-proof links.

**Portfolio**
- Real cumulative-PnL chart from settled history (no synthetic seeds).
- Open positions with claim center; claim flow verifies receipt via
  `/api/sync/transaction` and recovers from missing events.
- Position drawer with entry / current price, refund-after-grace
  fallback when a resolver vanishes.

**Discovery**
- Markets table with status badges, volume bar chart, live activity
  feed (`/api/activity`).
- Leaderboard: humans + AI agents ranked by realized PnL.
- Agent profiles with on-chain moves (tx-proven) and ERC-8004-style
  reputation.
- ⌘K command palette for fuzzy search across markets, agents, routes.

**Wallet-scoped persistence**
- SIWE login + 7-day session cookie. Watchlist, settings,
  notifications, importer admin — all persisted server-side per address.
- Notification center surfaces `bet_confirmed`, `market_resolved`,
  `payout_claimable` events.

**Operations**
- Hardened indexer: confirmation depth, reorg detection (rewinds
  cursor), per-chain status (`ok | reorg | error`), CLI backfill
  (`pnpm indexer:backfill <from> <to>`).
- In-memory rate limiter on the Fastify backend (30 writes / 240 reads
  per minute per IP).
- SIWE + admin allowlist on importer routes; `RECLAIM_PROOF_WRITE_SECRET`
  on server-to-server proof writes.
- `pnpm env:check [--profile=full]` — required rules across FRONTEND /
  BACKEND / INDEXER / AGENTS / IPFS, never prints secret values.
- `pnpm e2e:live [--dry]` — full create → bet → propose → finalize →
  claim flow on testnet, every tx hash logged.
- `<SystemStatusDrawer>` shows live `/api/status` per chain.

**Multi-chain ready**
- Arbitrum Sepolia today; Robinhood Chain (RHC, `46630`) is deploy-ready:
  `pnpm contracts:deploy:rhc` (with a `DRY_RUN=1` preview), a dedicated
  `/rhc` markets tab, an RHC-native `/rhc/create` flow, and a second
  indexer process — see [`docs/RHC-DEPLOY.md`](docs/RHC-DEPLOY.md).
- Stylus Rust port of `AIJudgeVerifier` V2 (k256 ECDSA, sha3 keccak,
  same ABI) for native Rust execution on Arbitrum.

**Sponsor & ecosystem integrations**
- **GMX** market intelligence (GMX API snapshot + `@gmx-io/sdk` v2
  enrichment): live liquidity / open interest / funding / APY / OHLCV /
  trades. Powers GMX **signal cards** on crypto market pages,
  auto-generated **liquidity / OI-imbalance /
  funding** markets (`POST /api/import/gmx/scan`), and a live GMX snapshot
  folded into the AI-judge `evidenceHash` for GMX-sourced verdicts.
- **RWA / tokenized stocks**: `POST /api/import/rwa/scan` generates
  tokenized-equity (AAPL/TSLA/NVDA/…) and RWA-volume market drafts for RHC.
- **Dune** transparency: results proxy + admin refresh + reproducible query
  templates, surfaced on a public **/analytics/sponsors** proof-of-traction
  page (cross-chain volume / markets / bettors / payouts).
- **ZeroDev** gasless: kernel smart-account first-bet via paymaster/bundler,
  exposed as a per-bet "Gasless" toggle in the BetForm
  (`NEXT_PUBLIC_ZERODEV_GASLESS_ENABLED`).
- **Fhenix** sealed-market prototype (`contracts/prototypes`, encrypted
  `euint64` positions with post-deadline reveal — prototype, not deployed).
- **OpenZeppelin** hardening: every owned contract on `Ownable2Step`;
  `ParimutuelPool` + `MarketFactory` `Pausable`; `ParimutuelPool` uses
  `SafeERC20` + `ReentrancyGuard` on every value path.
- **AWS** App Runner blueprints + CloudWatch alarms fed by EMF metrics
  (`WebhookFailures` / `ResolutionFailures` / `RpcLagBlocks`, gated by
  `CLOUDWATCH_EMF`). See [`docs/AWS.md`](docs/AWS.md).
- **Developer surfaces**: outbound **webhooks** (HMAC-signed,
  `market.resolved` / `market.created`) and an MCP server
  (`services/mcp-server`) wrapping the read API as agent tools.

## Competitive gap implementation

This repository now includes the core production-gap primitives from the
9lives / Polymarket / Forkast / parlay backlog, with staged rollout instead
of replacing the stable parimutuel v1 pool.

**Liquidity and exits**
- `OutcomeSharePool` is the opt-in binary AMM/share pool. It supports
  `buy`, `sell`, `quoteBuy`, `quoteSell`, `claim`, and vault-seeded initial
  reserves.
- `LiquidityVault` registers factory-created AMM pools, sends seed
  liquidity, calls the pool seed hook, tracks market debt/surplus, and
  exposes repayment / surplus claiming.
- `MarketFactory.createAmmMarket` deploys AMM markets beside existing
  parimutuel markets and emits both `MarketCreated` and `AmmMarketCreated`.
- Backend and indexer parse AMM events (`SharesBought`, `SharesSold`,
  `LiquidityAdded`, `VaultSeeded`) into `market_liquidity`,
  `share_trades`, and `vault_exposure`.
- Market detail exposes an AMM Exit/Sell panel only when
  `market.liquidityMode === "amm"`. The sell action is a real wallet
  transaction, then `/api/sync/share-transaction` reconciles trusted receipt
  logs. It no longer trusts client-supplied amount/share numbers.

**Signed order intents**
- `AdjudexOrderMatcher` implements EIP-712 order hashing/verification,
  EOA + EIP-1271 signature support, cancellation, nonce invalidation, fee cap,
  and guarded beta matching.
- Backend orderbook APIs store signed intents only:
  `POST /api/orders`, `GET /api/orders?marketId=`, `DELETE /api/orders/:hash`,
  and `POST /api/orders/match-preview`.
- Market detail includes a `Market / Limit` segmented control. Limit mode
  signs a real EIP-712 intent in the browser and submits it to the backend;
  settlement still requires an on-chain matcher transaction.

**Exclusive outcomes and negative-risk metadata**
- `ExclusiveOutcomeRegistry` creates exclusive outcome groups, links child
  binary markets, rejects duplicate child links, and enforces exactly one YES
  group resolution.
- Backend stores `market_groups`, `market_group_outcomes`,
  `market_group_positions`, and `neg_risk_conversions`.
- UI reads real group data and shows total implied probability plus
  incoherence warnings. Conversions are recorded as proof/accounting records;
  full production settlement is intentionally staged.

**Resolution hardening**
- `AIJudgeVerifier` now tracks `Pending`, `Challenged`, `Reset`,
  `Escalated`, and `Finalized` lifecycle states.
- First valid challenge resets the proposal and requires fresh evidence.
  Second challenge escalates to owner/multisig override.
- Optional challenge bonds are emitted and indexed into the dispute timeline.

**Creator, parlays, and opportunities**
- `/creator` provides SIWE-backed creator profiles and market attribution.
  Market cards/details surface `creatorHandle` and `streamUrl` only when they
  come from backend state.
- `/parlays` and the parlay APIs provide a non-executable correlated-risk
  preview/draft flow by default.
- `ParlayPoolPrototype` is a testnet-only escrow prototype and deploys only
  when `PARLAY_PROTOTYPE_ENABLED=1`.
- `/feed` and market detail read opportunity cards from
  `market_opportunities`. `POST /api/opportunities/rebuild` uses the internal
  secret and rebuilds opportunities from real exclusive-outcome probability
  gaps. No automatic execution or custody is included.

**Real data rule**
- Runtime UI/API surfaces use backend rows, indexed chain events, contract
  reads, SIWE-authenticated persistence, or explicit empty states.
- Test fixtures remain allowed inside tests. Runtime sample/fallback match
  fixture paths were removed instead of being displayed as real market data.

**Still staged / not claimed as production-complete**
- Matching orders on-chain from the UI, richer cancel/open-order management,
  full negative-risk settlement, GMX-derived opportunity scanning, and deeper
  audit-level contract tests are still staged work.
- AMM/order/parlay primitives are beta protocol surfaces. They are opt-in and
  do not change existing deployed parimutuel market behavior.

## What is on chain today

| Contract                | Purpose |
|---|---|
| `MarketFactory`         | Deploys a new `ParimutuelPool` per market, emits `MarketCreated`. |
| `ParimutuelPool`        | Holds yes/no USDC pools. Bet, resolve, claim, refundAfterGrace. |
| `OutcomeSharePool`      | Opt-in binary AMM market with buy/sell outcome-share accounting and claim after resolution. |
| `LiquidityVault`        | Operator vault for registered AMM seed liquidity, debt repayment, and surplus accounting. |
| `AdjudexOrderMatcher`   | EIP-712 signed order-intent matcher with cancellation, nonce replay protection, and EIP-1271 support. |
| `ExclusiveOutcomeRegistry` | Protocol metadata for exclusive multi-outcome groups and exactly-one-YES finalization. |
| `ParlayPoolPrototype`   | Testnet-only parlay draft escrow prototype, deployed only with `PARLAY_PROTOTYPE_ENABLED=1`. |
| `AIJudgeVerifier` (V2)  | Optimistic resolution: `propose` → 2h challenge window → `finalize`. Owner can `overrideAndFinalize` if disputed. Backwards-compatible `verifyAndResolve` gated by `fastTrackUntil`. |
| `ProofAnchor`           | Public registry mapping a Reclaim sessionId → (`proofHash`, IPFS `cid`). Emits `ProofAnchored`. |
| `BetQuoteVerifier`      | EIP-712 verifier for signed bet quotes (slippage, deadline, nonce). Currently a standalone verifier consumed by the API; pool integration is the next contract upgrade. |
| `ReputationOracle`      | ERC-8004-style agent registry (handles + reputation). |
| `PriceOracle`           | Operator-set + Chainlink fallback, normalized to 8 decimals. |
| `TokenizedStockAdapter` | Registry of tokenized-equity adapters (TSLA, AAPL, …). |
| `TestUSDC`              | ERC-20 with public `mint()` for testnet. |
| `TestAggregatorV3`      | Chainlink-shape test feed for `PriceOracle` testing. |

`AIJudgeVerifier` now keeps a dispute ledger on-chain: the first valid
challenge resets a pending proposal and requires a fresh evidence hash; a
second challenge escalates to owner/multisig override. The backend/indexer
mirrors those events into `resolution_disputes` for the market timeline.

**OpenZeppelin hardening:** `MarketFactory`, `AIJudgeVerifier`, `ProofAnchor`,
`ReputationOracle`, `PriceOracle`, and `TokenizedStockAdapter` use
`Ownable2Step` (transfer → accept handshake). `MarketFactory` and
`ParimutuelPool` are `Pausable` (creation / new-bets only — `claim` and
`refundAfterGrace` stay open). `ParimutuelPool` settles via `SafeERC20` with
`ReentrancyGuard` on `bet` / `betWithQuote` / `resolve` / `claim` /
`refundAfterGrace`. Run `scripts/transfer-ownership.ts` to hand every owner to
a governance Safe (the Safe calls `acceptOwnership` to finish).

Stylus port: `contracts/stylus/ai-judge-verifier` mirrors the V2 Solidity
ABI in pure Rust (k256 ECDSA, sha3 keccak). Build with
`cargo stylus check` from WSL2.

---

## Stack at a glance

| Service              | Source              | Process            | Purpose |
|---|---|---|---|
| Frontend (Next.js 16) | `src/`             | `pnpm dev`         | UI, wallet, viem reads, quote consumer |
| Backend (Fastify)    | `services/api/`     | `pnpm dev:api`     | Indexed reads, SIWE, importer, EIP-712 quote signer, rate-limit, market-list cache |
| Indexer worker       | `services/indexer/` | `pnpm dev:indexer` | Block sync + reorg detection + Postgres write |
| AI resolver worker   | `services/ai-judge/`| run separately     | Signs source-backed verdicts through the configured resolver path |
| Market-maker agent   | `services/mm-agent/`| opt-in             | Counter-balances open pools |
| Postgres             | external            | —                  | Single source of indexed state |

The frontend talks to the backend when `NEXT_PUBLIC_BACKEND=api`.
Direct on-chain mode can read configured contracts, but portfolio,
activity, agents, notifications, settings, importer, and proof surfaces
still require backend/indexer state.

**Deployment:** the Next.js frontend ships to **Vercel**
([DEPLOY-VERCEL.md](DEPLOY-VERCEL.md)); the Fastify backend
(`services/api`) runs on **Render** at `https://adjudex-api.onrender.com`
([DEPLOY-RENDER.md](DEPLOY-RENDER.md)). Vercel's `NEXT_PUBLIC_API_URL` /
`BACKEND_API_URL` point at the Render host.

---

## Quick start (local)

```bash
pnpm install

# 1. provision Postgres, then:
pnpm api:migrate

# 2. confirm env wiring
pnpm env:check                  # soft profile: frontend + indexer minimums
pnpm env:check --profile=full   # strict: requires all signers + providers

# 3. start backend + indexer + frontend (separate terminals)
pnpm dev:api
pnpm dev:indexer
pnpm dev

# 4. open http://localhost:3000 and visit /status
```

The frontend does not create or resolve markets by itself. `BACKEND_API_URL`
or `NEXT_PUBLIC_API_URL` must point at the Fastify API, normally
`http://127.0.0.1:8787` locally. If only `pnpm dev` is running, `/api/markets`
will proxy to nothing and the UI will show no fresh backend state.

### Automatic market creation

Auto-created markets come from the backend auto-ingest workers, not from the
browser. The API starts them only when `MATCH_INGEST_ENABLED=1`.

Required runtime pieces:

- Postgres with `pnpm api:migrate` applied (`DATABASE_URL`).
- At least one real match feed token: `PANDASCORE_TOKEN` for CS2/Dota2 or
  `FOOTBALL_DATA_TOKEN` for football.
- On-chain deploy config: `ARBITRUM_SEPOLIA_RPC_URL`,
  `MARKET_FACTORY_ADDRESS`, `AI_JUDGE_VERIFIER_ADDRESS`.
- A gas-only hot wallet in `MARKET_CREATOR_PRIVATE_KEY` to call
  `createSoftMarket`.
- `JUDGE_PRIVATE_KEY` so the resolve worker can sign verdict evidence and
  call propose/finalize.

New auto markets are inserted into `markets`, `auto_markets`, and
`market_stats` after a successful on-chain `MarketCreated` receipt. They open
at 50/50 because odds are parimutuel: the YES/NO pool ratio changes only from
real indexed bets or AMM share trades. Feeds schedule and settle matches; they
do not supply odds.

Use `/status` to see whether the auto-market pipeline is ready. The
`Auto markets` block shows the worker flag, active sources, deployer/resolver
config, lifecycle counts, and recent `auto_markets.last_error` rows.

See [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for the full bring-up matrix,
incident triage, and live verification flow.

---

## Environment

`pnpm env:check` is the authoritative list. Common buckets:

**Frontend (`NEXT_PUBLIC_*`)**
- `NEXT_PUBLIC_BACKEND` — `api` | `onchain`
- `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL`
- `NEXT_PUBLIC_MARKET_FACTORY_ADDRESS`
- `NEXT_PUBLIC_STAKE_TOKEN_ADDRESS`
- `NEXT_PUBLIC_RHC_STAKE_TOKEN_ADDRESS` (when RHC uses a separate TestUSDC)
- `NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS`
- `NEXT_PUBLIC_PROOF_ANCHOR_ADDRESS`
- `NEXT_PUBLIC_BET_QUOTE_VERIFIER_ADDRESS`

**Backend (Fastify)**
- `DATABASE_URL=postgres://...`
- `DATABASE_POOL_URL=postgres://...` - optional PgBouncer/pooler URL for runtime traffic
- `ARBITRUM_SEPOLIA_RPC_URL`
- `SIWE_DOMAIN`
- `IMPORT_ADMIN_ADDRESSES` — comma-separated 0x allowlist for importer routes
- `RECLAIM_PROOF_WRITE_SECRET` — shared secret for Next → backend proof writes
- `QUOTE_SIGNER_PRIVATE_KEY` + `BET_QUOTE_VERIFIER_ADDRESS` — EIP-712 quote signer
- `JUDGE_PRIVATE_KEY` (local) or `JUDGE_REMOTE_URL` + `JUDGE_REMOTE_SECRET` (Phala)
- `STATUS_INDEXER_STALE_MS`, `STATUS_INDEXER_LAG_BLOCKS` — health thresholds
- `TRANSACTION_SYNC_MIN_CONFIRMATIONS` — recovery confirmation depth

**Stage 3 scale infrastructure**
- `RATE_LIMIT_BACKEND=memory|redis` - use `redis` for multi-instance API.
- `REDIS_REST_URL`, `REDIS_REST_TOKEN` - Upstash-compatible Redis REST endpoint.
- `MARKETS_CACHE_BACKEND=memory|redis` - use `redis` for `GET /api/markets`.
- `MARKETS_CACHE_TTL_SECONDS=15` - short market-list cache TTL.

**Stage 3 retention analytics**
- `IMPORT_ADMIN_ADDRESSES` / `ADMIN_WALLET_ADDRESSES` - admin allowlist for
  `/api/analytics/retention`.
- `user_activity_events` stores wallet-scoped product events from backend
  routes and SIWE-authenticated client events. It is the source for D1/D7/D30
  cohorts.

**Stage 3 mobile PWA**
- `NEXT_PUBLIC_ENABLE_PWA_DEV=1` - optional local development switch for
  service-worker registration. Production registers automatically.
- `public/sw.js` caches only static shell assets and `/offline`. API,
  market, portfolio, wallet, balance, and transaction requests stay
  network-only.

**Stage 3 liquidity incentives**
- `GET /api/liquidity/incentives` reads the active incentive program and
  computes eligible traders from indexed `positions`.
- `POST /api/liquidity/programs` is SIWE-admin only and configures a program
  window, top-percent cutoff, rebate bps, minimum volume, and optional budget.
- `POST /api/liquidity/payouts` is SIWE-admin only and records a payout only
  after transaction sync verifies the submitted tx hash and chain.

**Stage 3 agent ecosystem**
- `GET /api/agents/ecosystem` returns registry readiness, top agents, recent
  agent-tagged moves, volume, PnL, and reputation metrics from backend rows.
- `POST /api/agents/register` accepts a handle, chain ID, and tx hash, then
  records the agent only after RPC receipt sync finds `AgentRegistered` from
  the configured `ReputationOracle`.
- `REPUTATION_ORACLE_ADDRESS` is the Arbitrum Sepolia registry. Use
  `RHC_REPUTATION_ORACLE_ADDRESS` when RHC has a separate deployment.

**Indexer**
- `INDEXER_RPC_URL`, `INDEXER_CHAIN_ID`, `INDEXER_ID`
- `INDEXER_INTERVAL_MS` (e.g. `12000`)
- `INDEXER_MAX_BLOCK_RANGE` (e.g. `2000`)
- `INDEXER_CONFIRMATIONS` (default `3`) — block depth before indexing

**IPFS (ProofAnchor)**
- `IPFS_PROVIDER` - `pinata` | `web3storage` | `kubo`
- `PINATA_JWT` or `WEB3_STORAGE_TOKEN` or `IPFS_API_URL`
- `PROOF_ANCHOR_DEPLOYER_KEY` — wallet that submits `anchor()` tx

**Agents**
- `MM_AGENT_PRIVATE_KEY`
- `REPUTATION_ORACLE_ADDRESS`, optional `RHC_REPUTATION_ORACLE_ADDRESS`
- `ANTHROPIC_API_KEY` (for AI judge / spec generation)

**Reclaim zkTLS**
- `RECLAIM_APP_ID`, `RECLAIM_APP_SECRET`, `RECLAIM_PROVIDER_ID`
- `RECLAIM_PUBLIC_BASE_URL` — public URL the attestor calls back

---

## Resolution lifecycle (V2 optimistic)

```text
AI judge service
   │  signs verdict
   │  (EIP-191 over keccak(chainId,pool,marketId,outcome,evidenceHash))
   ▼
propose(marketId, outcome, evidenceHash, sig)        — judge service
   │
   ▼
status = Pending     (2h challenge window)
   │
   ├── challenge(marketId) ─► status = Disputed      — anyone, within window
   │
   ▼
finalize(marketId) ─► pool.resolve(outcome)          — anyone, after window
   │
   ▼
status = Finalized   (claims unlock)

overrideAndFinalize(marketId, outcome)               — owner only
   ▼
status = Finalized   (only when previously Disputed)
```

The `<ResolutionStatus>` component on `/market/:id` reads
`proposals(marketId)`, `canFinalize`, `challengeDeadline` via wagmi and
surfaces stage-aware Challenge / Finalize buttons with live countdown.

`verifyAndResolve(...)` is retained but gated by `fastTrackUntil` (default
`0` = disabled). Use only for fast testnet checks where instant resolve is
explicitly desired.

---

## Reclaim → IPFS → on-chain proof anchor

1. User runs zkTLS via Reclaim, attestor `POST`s the proof to
   `/api/reclaim/callback`.
2. Next route verifies the proof, persists it via `putProof()` (backed by
   the API), pins the canonical JSON via `IPFS_PROVIDER` (returns a CID).
3. Route calls `ProofAnchor.anchor(sessionId, proofHash, cid)` from the
   anchor wallet. This emits `ProofAnchored(sessionIdHash, proofHash,
   publisher, cid, anchoredAt)` so any indexer / client can resolve a
   proof from on-chain state alone.
4. The same `proofHash` is folded into `evidenceHash` when the AI judge
   signs its verdict — so a finalized market is cryptographically tied to
   the anchored proof.

`IPFS_PROVIDER` must use a real pinning path (`pinata`, `web3storage`, or
`kubo`). Missing or unsupported providers fail the proof flow before any
on-chain anchor is attempted.

> **Deployment status:** the on-chain anchor step (3) requires a deployed
> `ProofAnchor` and `NEXT_PUBLIC_PROOF_ANCHOR_ADDRESS` / `PROOF_ANCHOR_DEPLOYER_KEY`.
> The contract is in `scripts/deploy-contracts.ts` but the current Sepolia
> snapshot ([`deployments/421614.json`](deployments/421614.json), 2026-05-27)
> predates it — re-run `pnpm contracts:deploy` to deploy the full stack. Until
> then the proof is verified, persisted and IPFS-pinned, but the anchor step
> degrades to `anchor.status='skipped'` rather than writing on-chain.

---

## EIP-712 signed bet quotes

The backend (`POST /api/bets/quote`) returns a `BetQuote` (pool, side,
stake, `minShares`, `maxPoolImpactBps`, deadline, nonce, bettor) plus a
signature from `QUOTE_SIGNER_PRIVATE_KEY`. The `BetQuoteVerifier` contract
binds the signature to its EIP-712 domain (`Adjudex Bet Quote / 1`) and
verifies / consumes it (one-shot per `(bettor, nonce)`).

This is a standalone verifier today — the next pool upgrade will add a
`betWithQuote(quote, signature)` wrapper that calls
`BetQuoteVerifier.consume()` before executing the bet, giving on-chain
slippage protection.

---

## Live testnet E2E

```bash
pnpm e2e:live --dry     # env preflight + plan only
pnpm e2e:live           # full flow against the configured chain
```

The script runs: env preflight → RPC sanity →
`createSoftMarket` → `mint` test USDC → `approve` + `bet YES` →
sign verdict → `propose` → bump `fastTrackUntil` (best-effort) →
poll `canFinalize` → `finalize` → `claim`. Every tx hash is printed.

Required env (`pnpm env:check --profile=full` will tell you what's
missing):
- `DEPLOYER_PRIVATE_KEY`, `JUDGE_PRIVATE_KEY`, `ARBITRUM_SEPOLIA_RPC_URL`
- `NEXT_PUBLIC_MARKET_FACTORY_ADDRESS`, `NEXT_PUBLIC_STAKE_TOKEN_ADDRESS`,
  `NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS`

---

## Indexer hardening

`services/indexer/src/index.ts` runs `syncOnce()` on `INDEXER_INTERVAL_MS`:

1. Read head, compute `safeHead = head - INDEXER_CONFIRMATIONS` (only
   confirmed blocks are indexed).
2. Probe stored `last_block_hash`: if the block at the cursor changed
   hashes, mark `last_status='reorg'`, rewind by `2 * confirmations`, and
   replay.
3. Sync market state + events in `[fromBlock, toBlock]`.
4. Capture new tip hash, write `indexer_state` (status, error, reorg
   timestamp, updated_at).

`GET /api/status` exposes `indexer.lastStatus`, `lastError`,
`lastReorgAtIso`, `reorgRecent`, `lagBlocks`, `stale`, `ageSeconds`.

Backfill / replay:

```bash
pnpm indexer:backfill 12345 99999
```

Re-emits events into the schema (ON CONFLICT DO NOTHING/UPDATE) without
touching the live cursor.

---

## Security & ops

- **Rate limit** — `services/api/src/rate-limit.ts` is an in-memory
  token bucket (30 writes / 240 reads per minute per IP, configurable).
  Health endpoints (`/health`, `/api/status`) are unmetered. Swap to
  Redis for multi-instance backend.
- **Admin allowlist** — `parseAdminAllowlist()` / `isAdminAddress()` in
  `services/api/src/auth.ts` reads `IMPORT_ADMIN_ADDRESSES` (or legacy
  `ADMIN_WALLET_ADDRESSES`). Importer routes call `requireImportAdmin()`
  which returns 401 / 403 / 503 with explicit error codes.
- **SIWE sessions** — wallet-scoped writes (settings, watchlist,
  notifications, importer, proof storage) require SIWE.
- **Env validation** — `pnpm env:check [--profile=full]` runs required rules
  across FRONTEND / BACKEND / INDEXER / AGENTS / IPFS. Exits non-zero
  with categorized missing/invalid lists. Wire into CI.

---

## Frontend surfaces

### Pages

| Route               | Purpose |
|---|---|
| `/`                 | Dashboard: stats, volume bar chart, live activity feed, markets table |
| `/market/:id`       | Trust panel, probability chart, BetForm (slippage + balance + warnings), `<ResolutionStatus>` (Challenge / Finalize), AI/zkTLS trust panel, activity, timeline |
| `/portfolio`        | Wallet stats, real cumulative-PnL chart, open positions (claim center), history |
| `/agents`           | Agent ecosystem, registry readiness, onboarding, recent indexed moves |
| `/leaderboard`      | Humans + AI agents ranked by realized PnL |
| `/agent/:id`        | Agent profile, recent moves with tx proof, reputation |
| `/create`           | Spec generator + Market Importer flow |
| `/resolve`          | Source-proof resolution UI (`<ResolutionClient>`) |
| `/rhc`              | Robinhood Chain markets tab (indexed RHC markets + RPC/indexer health) |
| `/rhc/create`       | RHC-native market creation flow (RHC factory + RWA import candidates) |
| `/integrations`     | Sponsor integration status: Alchemy / RHC / Dune / GMX / ZeroDev / Fhenix / OZ / AWS |
| `/analytics/sponsors` | Public proof-of-traction: cross-chain totals + Dune-backed metrics + query templates |
| `/docs`             | In-app live status + proof panel (`<DocsStatusClient>`) — backend, RPC, factory, indexer readiness |
| `/api/status`       | Live readiness JSON (DB, RPC, factory, indexer per chain) |

### UI building blocks worth knowing

- **Header** ([header.tsx](src/components/dashboard/header.tsx)) — wallet
  ConnectButton, chain badge, USDC faucet button, command palette
  trigger, notification bell.
- **Bottom tab bar** ([bottom-tab-bar.tsx](src/components/dashboard/bottom-tab-bar.tsx))
  — mobile nav across Markets / Portfolio / Create / Leaderboard.
- **Command palette** ([command-palette.tsx](src/components/dashboard/command-palette.tsx))
  — ⌘K-style fuzzy search across markets, agents, routes.
- **Notification center** ([notification-center.tsx](src/components/dashboard/notification-center.tsx))
  — drawer for `bet_confirmed`, `market_resolved`, `payout_claimable`
  events; bridges `GET/POST/PATCH /api/notifications`.
- **System status drawer** ([system-status-drawer.tsx](src/components/dashboard/system-status-drawer.tsx))
  — live `/api/status` panel (DB / RPC / factory / indexer per chain,
  reorg + lag indicators).
- **USDC faucet** ([usdc-faucet-button.tsx](src/components/dashboard/usdc-faucet-button.tsx))
  — one-click `TestUSDC.mint(1000)` for the connected wallet on testnet.
- **BetForm** ([bet-form.tsx](src/components/dashboard/bet-form.tsx))
  — real on-chain balance, slippage in bps with tone (green/amber/red),
  pool-impact + insufficient-balance warning banners.
- **ResolutionStatus** ([resolution-status.tsx](src/components/dashboard/resolution-status.tsx))
  — stage-aware Challenge / Finalize buttons gated by `canFinalize`
  + countdown to `challengeDeadline`.

### Wallet-scoped user features (require SIWE)

These persist across sessions per wallet address via the Postgres
backend; the frontend never falls back to browser storage for any of
them.

- **SIWE auth** — `POST /api/auth/nonce` → wallet signs SIWE message →
  `POST /api/auth/verify` issues the `adjudex_session` cookie (HttpOnly,
  SameSite=Strict, 7-day TTL).
- **Wallet session API** — `POST /api/wallet/connect`,
  `POST /api/wallet/disconnect`, `GET /api/wallet` for the active
  wallet session state shown by `<WalletButton>` /
  `<UserSettingsEffects>`.
- **Settings** — `GET/PUT /api/settings`. Notifications on/off, default
  chain, slippage prefs.
- **Watchlist** — `GET/POST /api/watchlist`, `DELETE
  /api/watchlist/:marketId`. Mark a market and receive
  `market_resolved` notifications when it resolves.
- **Notifications** — `GET /api/notifications`,
  `POST /api/notifications/read`, `PATCH /api/notifications/:id/read`.
  Events: `bet_confirmed`, `market_resolved`, `payout_claimable`.
  Surfaced by `<NotificationCenter>` drawer.

---

## API map

Adjudex runs two HTTP layers:
- **Fastify backend** (`services/api/`) — owns Postgres, SIWE sessions,
  importer, EIP-712 quote signer, transaction recovery.
- **Next API routes** (`src/app/api/**/route.ts`) — thin proxies +
  edge-friendly helpers (Reclaim session/callback, judge signer, public
  GET surfaces). Frontend hits these first; many proxy through to
  Fastify.

### Fastify backend (`services/api/src/server.ts`)

**Health & sync**
- `GET /health`, `GET /api/status` — DB / RPC / factory / indexer per chain
- `POST /api/sync/transaction` — verify receipt + reconcile DB

**Markets**
- `GET /api/markets`, `GET /api/markets/:id`
- `GET /api/markets/:id/activity`, `/timeline`
- `POST /api/markets/validate`, `/generate`, `/api/markets`

**Trading**
- `POST /api/bets/preview` — quote derived from pool snapshot
- `POST /api/bets/quote` — EIP-712 signed quote (`BetQuoteVerifier`)
- `POST /api/bets` — confirm a placed bet against a tx receipt
- `POST /api/claim`
- `GET /api/markets/:id/liquidity`, `POST /api/markets/:id/share-quote`
- `POST /api/sync/share-transaction`
- `GET/POST /api/orders`, `DELETE /api/orders/:hash`, `POST /api/orders/match-preview`

**Competitive surfaces**
- `POST /api/market-groups`, `GET /api/market-groups/:id`, `/api/market-groups/:id/arbitrage`, `/convert`
- `GET /api/markets/:id/resolution`
- `GET/POST /api/creators`, `POST /api/creators/:handle/markets`
- `POST /api/parlays/preview`, `POST /api/parlays`, `GET /api/parlays/:id`
- `GET /api/opportunities`, `GET /api/markets/:id/opportunities`
- `POST /api/opportunities/rebuild` - internal-secret rebuild from real exclusive-outcome probability gaps

**Portfolio & agents**
- `GET /api/portfolio/:address/positions`, `/history`
- `GET /api/agents`, `/ecosystem`, `/:id`, `/:id/moves`, `/:id/reputation`
- `POST /api/agents/register`
- `GET /api/leaderboard`
- `GET /api/activity` — global activity feed
- `GET /api/oracle/:marketId` — oracle resolution state for a market
- `GET /api/liquidity/incentives` - active incentive eligibility from indexed positions

**SIWE / user**
- `POST /api/auth/nonce`, `/verify`
- `GET/PUT /api/settings`
- `GET/POST /api/watchlist`, `DELETE /api/watchlist/:marketId`
- `GET /api/notifications`, `POST /api/notifications/read`,
  `PATCH /api/notifications/:id/read`
- `POST /api/analytics/events` records allowlisted authenticated product
  events.
- `GET /api/analytics/retention` returns admin-only D1/D7/D30 cohorts from
  `user_activity_events`.

**Importer (SIWE + admin allowlist)**
- `GET /api/import/sources`
- `POST /api/import/scan`
- `GET /api/import/candidates`
- `POST /api/import/candidates/:id/validate`
- `POST /api/import/candidates/:id/deploy`
- `POST /api/liquidity/programs`
- `POST /api/liquidity/payouts`

**Resolution & proof**
- `POST /api/reclaim/proofs`, `GET /api/reclaim/proofs/:sessionId`
  — server-to-server proof store keyed by `RECLAIM_PROOF_WRITE_SECRET`
- `POST /api/resolve`

### Next API routes (`src/app/api/**/route.ts`)

These run inside Next.js and are what the browser actually hits:

- `GET /api/status` — proxies the Fastify status payload
- `GET /api/markets`, `GET /api/markets/:id`, `GET /api/markets/:id/activity`,
  `/timeline`, `/liquidity`, `/resolution`, `/opportunities`, `/share-quote`
- `POST /api/markets/validate`, `/generate`
- `GET/POST /api/orders`, `DELETE /api/orders/:hash`,
  `POST /api/orders/match-preview`
- `GET/POST /api/market-groups`, `GET /api/market-groups/:id`,
  `POST /api/market-groups/:id/convert`,
  `GET /api/market-groups/:id/arbitrage`
- `GET/POST /api/creators`, `GET /api/creators/:handle`,
  `POST /api/creators/:handle/markets`
- `POST /api/parlays/preview`, `POST /api/parlays`,
  `GET /api/parlays/:id`
- `GET /api/opportunities`, `POST /api/opportunities/rebuild`
- `POST /api/sync/share-transaction`
- `GET /api/portfolio/:address/positions`, `/history`
- `GET /api/agents`, `GET /api/agents/ecosystem`,
  `GET /api/agents/:id`, `/:id/moves`, `/:id/reputation`
- `POST /api/agents/register`
- `GET /api/leaderboard`
- `GET /api/activity`
- `GET /api/liquidity/incentives`
- `POST /api/bets/preview`, `POST /api/bets`
- `POST /api/claim`
- `GET /api/oracle/:marketId`
- `POST /api/sync/transaction`
- `POST /api/auth/nonce`, `POST /api/auth/verify`
- `GET/PUT /api/settings`
- `GET/POST /api/watchlist`, `DELETE /api/watchlist/:marketId`
- `GET/POST /api/notifications`, `POST /api/notifications/read`,
  `PATCH /api/notifications/:id/read`
- `POST /api/analytics/events`
- `GET /api/analytics/retention`
- `GET /api/import/sources`, `POST /api/import/scan`,
  `GET /api/import/candidates`,
  `POST /api/import/candidates/:id/validate`, `/deploy`
- `POST /api/liquidity/programs`, `POST /api/liquidity/payouts`
- `POST /api/wallet/connect`, `POST /api/wallet/disconnect`,
  `GET /api/wallet` — wallet session state
- `POST /api/reclaim/session` — Reclaim app session bootstrap
- `POST /api/reclaim/callback` — Reclaim attestor callback;
  verifies → `putProof()` → IPFS pin → `ProofAnchor.anchor()`
- `GET /api/reclaim/get` — fetch verified proof by sessionId
- `POST /api/resolve` — server-side resolution helper
- `POST /api/judge/resolve` — sign AI judge verdict
  (Claude → EIP-191 → ECDSA signature) for `AIJudgeVerifier.propose`

---

## Repository layout

```text
src/                        Next.js app, UI, route proxies, viem service layer
contracts/src/              Solidity sources
contracts/stylus/           Rust/Stylus port of AIJudgeVerifier (V2 ABI)
contracts/__tests__/        Compile + invariant tests (vitest + solc)
services/api/               Fastify API, Postgres schema, SIWE, importer, sync
services/api/db/schema.sql  Indexer + product tables
services/indexer/           Chain indexer (reorg + confirmations + backfill)
services/ai-judge/          Resolver worker (TEE/local)
services/mm-agent/          AI market-maker agent service
scripts/check-env.ts        Env validation (`pnpm env:check`)
scripts/e2e-live.ts         Live testnet E2E (`pnpm e2e:live`)
scripts/compile-abis.ts     Solidity → ABI JSON
scripts/deploy-contracts.ts Testnet deploy + .env.local patcher
deployments/                Per-chain deployment snapshots
public/sw.js                PWA shell worker; API and trading data stay network-only
src/app/manifest.ts         Installable web app manifest
src/app/offline/page.tsx    Offline shell without cached trading state
docs/                       ARCHITECTURE.md, RUNBOOK.md
```

---

## Contracts: compile, deploy, ABIs

```bash
pnpm contracts:compile         # vitest + solc compile + invariant tests
pnpm contracts:abi             # write ABI JSONs to src/lib/abi/
pnpm contracts:deploy          # deploy to ARBITRUM_SEPOLIA_RPC_URL
pnpm contracts:deploy:rhc      # deploy the same stack to Robinhood Chain testnet
pnpm contracts:register-feeds  # register Chainlink-shape PriceOracle feeds
```

`contracts:deploy` writes `deployments/{chainId}.json` and patches
`.env.local` with every new address (regular + `NEXT_PUBLIC_*` pair).
Requires `DEPLOYER_PRIVATE_KEY`. Set `JUDGE_PUBLIC_ADDRESS` and
`QUOTE_SIGNER_PUBLIC_ADDRESS` to also deploy `AIJudgeVerifier` and
`BetQuoteVerifier`.

For Robinhood Chain, set `ADJUDEX_TESTNET_ONLY=1`, `RHC_RPC_URL` or
`ALCHEMY_RHC_API_KEY`, and run `pnpm contracts:deploy:rhc`. That writes
`deployments/46630.json` by default and patches `RHC_*` plus
`NEXT_PUBLIC_RHC_*` addresses for `/rhc` and `/rhc/create`.

`contracts:register-feeds` reads `scripts/register-feed.ts` config and
sets price feeds on `PriceOracle` for the configured asset symbols.

Current Arbitrum Sepolia (`421614`) snapshot — see
[`deployments/421614.json`](deployments/421614.json) for the live record.

---

## Verification gates

Before any PR / release:

```bash
pnpm env:check --profile=full       # required env present
npx tsc --noEmit                    # 0 errors
pnpm lint                           # 0 warnings
pnpm test                           # full unit + contract invariant suite
pnpm contracts:compile              # ABI + solc surface
pnpm e2e:live --dry                 # script wiring sanity (no chain writes)
```

For visible feature verification: `pnpm dev`, then walk
Markets → Portfolio → Create → Market detail → Resolve flow and confirm
each surface shows real indexed / chain-derived state (no placeholder
records).

---

## Internals reference

The sections below are an inventory of every shipped surface. They are
authoritative — if something is in the codebase and not listed here, it
is a documentation bug.

### Frontend internals (`src/lib/`)

**Hooks** (`src/lib/hooks/*.ts`)
- `useMarkets` — list markets via the configured service layer
- `useMarketDetail` — single market + timeline + activity
- `usePortfolio` — open positions, history, claimable amounts
- `useBet` — quote + signed approve + bet transaction lifecycle
- `useLeaderboard` — humans + AI agents ranked by realized PnL
- `useActivity` — global activity feed (`/api/activity`)
- `useAgent` — single agent profile, recent moves
- `useSystemStatus` — `/api/status` polling for the status drawer
- `useWallet` — wagmi account + hydration

**Stores** (`src/lib/store/`, all zustand, no persistence — sources of
truth live in contracts / Postgres)
- `useUserStore` — account, session, connect/disconnect
- `useMarketsStore` — filters, refresh trigger
- `usePortfolioStore` — positions cache, claim state
- `useActivityStore` — live event stream

**Service layer** (`src/lib/services/`)
- `provider.ts` — selects between `api | onchain` via
  `NEXT_PUBLIC_BACKEND`.
- `onchain/` — direct viem reads (markets, positions, oracle, spec
  cache, judge state)
- `api/create-api-services.ts` — Fastify-backed mirror of the onchain
  service surface
- backend/indexer services — production data path for market, portfolio, activity, and agent records

**Domain types** (`src/lib/types/domain.ts`)
- Core: `Market`, `MarketSpec`, `MarketFilters`, `MarketTimelinePoint`,
  `MarketValidationResult`
- Trading: `BetPreviewInput`, `BetQuote`, `BetReceipt`, `Position`,
  `HistoryRow`, `ClaimReceipt`, `ResolutionResult`
- Discovery: `AgentBadge`, `AgentReputationPoint`, `ActivityEvent`,
  `LeaderRow`
- System: `Account`, `UserStats`, `UserSettings`, `WatchlistItem`,
  `NotificationEvent`, `ChainRuntimeStatus`, `ChainSystemStatus`,
  `IndexerStatus`, `SystemStatus`
- Importer: `ImportSource`, `ImportCandidate`

**Adapters / formatters**
- `src/lib/market-view.ts` — Market → UI view (ticker, asset class,
  lifecycle, badges)
- `src/lib/market-lifecycle.ts` — computed market state
  (`draft | open | locked | resolving | resolved | claimable | archived`)
- `src/lib/utils.ts` — `shortenAddress`, formatting helpers

**Wagmi setup** (`src/lib/wagmi.ts`)
- Chains: Arbitrum Sepolia (always), Robinhood Chain Testnet
  (conditional on `NEXT_PUBLIC_RHC_RPC_URL`)
- Connectors: `injected()` — MetaMask + any EIP-1193 wallet
- Transports: HTTP per chain
- `ssr: true` enabled for Next.js App Router

### App client components (`src/components/app/`)

Each client component owns a Next.js route or a major lifecycle effect:

- `HomeClient.tsx` — `/` dashboard (stats, volume bar chart, live
  activity, markets table)
- `MarketDetailClient.tsx` — `/market/:id` (probability chart, trust
  panel, BetForm, ResolutionStatus, activity, timeline)
- `PortfolioClient.tsx` — `/portfolio` (stats, cumulative-PnL chart,
  open positions, claim center, history)
- `AgentEcosystemClient.tsx` - `/agents` registry status, onboarding, top
  agents, and recent moves.
- `LeaderboardClient.tsx` — `/leaderboard` ranked table
- `CreateMarketClient.tsx` — `/create` spec generator + importer
- `AgentProfileClient.tsx` — `/agent/:id` profile, moves, reputation
- `ResolutionClient.tsx` — `/resolve` source-proof flow
- `DocsStatusClient.tsx` — `/docs` live readiness panel
- `WalletButton.tsx` — RainbowKit ConnectButton.Custom integration
- `WalletProviders.tsx` — wagmi + react-query + RainbowKit root
- `UserSettingsEffects.tsx` — applies wallet-scoped preferences
  (theme, default chain, notification opt-in)

### Backend helpers (`services/api/src/`)

- `server.ts` — Fastify entrypoint, all route handlers, global
  `onRequest` rate-limit hook
- `auth.ts` — SIWE message builder, nonce TTL (15 min), session TTL
  (7 d), cookie serialization, `parseAdminAllowlist()`,
  `isAdminAddress()`
- `rate-limit.ts` — in-memory token bucket (30 write / 240 read per
  minute per IP), periodic GC, `__resetRateLimitForTests`
- `db.ts` — `pg` connection pool, `query()` + `transaction()` wrappers
- `migrate.ts` — applies `db/schema.sql` idempotently
- `market-validation.ts` — draft validation rules (see below)
- `user-preferences.ts` — settings patch validator
- `importer.ts` — `configuredImportSources()`, `scanImportSource()`,
  `validateImportCandidate()`
- `format.ts` — `asNumber()`, `walletShort()`, `toIso()` shared
  serializers

### Service workers

**`services/indexer/`**
- Single-file worker (`src/index.ts`) running on
  `INDEXER_INTERVAL_MS`
- Indexed events: `MarketCreated`, `BetPlaced`, `MarketResolved`,
  `Claimed`, `Refunded`, `Proposed`, `Challenged`, `Finalized`,
  `Overridden`, `ProofAnchored`, `AgentRegistered`,
  `ReputationUpdated`
- Reorg detection via persisted `last_block_hash`, rewind by
  `2 * INDEXER_CONFIRMATIONS`
- Confirmation depth via `safeHead = head - INDEXER_CONFIRMATIONS`
- CLI: `pnpm indexer:backfill <fromBlock> <toBlock>` re-emits without
  touching the cursor
- Status surface via `indexer_state(last_block, last_block_hash,
  last_status, last_error, last_reorg_at, updated_at)` →
  `/api/status.indexer.*`

**`services/mm-agent/`** (AI Market-Maker)
- Strategy: counter-balance LP — place a minority-side bet whenever
  `|yes% - 50%| > imbalanceThresholdBps`
- Config env: `MM_BET_USDC`, `MM_MAX_EXPOSURE`, `MM_IMBALANCE_BPS`,
  `MM_INTERVAL_MS`, `MM_AGENT_HANDLE`, `MM_AGENT_PRIVATE_KEY`
- Tracks per-market exposure cap, skips zero-volume markets, auto
  registers handle in `ReputationOracle`

**`services/ai-judge/`**
- Modes: `local` (uses `JUDGE_PRIVATE_KEY` directly) or `phala` (TEE
  CVM via dstack-sdk + `DSTACK_SIMULATOR_ENDPOINT`)
- Endpoint: `POST /resolve { pool, marketId, chainId, question,
  context?, reclaimSessionId? }`
- Returns: `outcome (0|1), evidenceHash, signature, reasoning,
  attestation?`
- Flow: Claude Sonnet 4.6 (`ANTHROPIC_API_KEY`) → JSON parse → keccak
  reasoning → optional XOR-fold with Reclaim proofHash → EIP-191 sign
- Env: `JUDGE_MODE`, `JUDGE_HOST`, `JUDGE_PORT`,
  `JUDGE_SUPPORTED_CHAIN_IDS`, `JUDGE_REMOTE_URL`,
  `JUDGE_REMOTE_SECRET`

### Database tables (`services/api/db/schema.sql`)

21 tables, grouped by owner:

**Indexed product state** (written by indexer)
- `markets` — id, spec, status, chain, pool address, resolution fields
- `market_stats` — volume, yes_probability, bettors, hot flag
- `market_timeline` — per-event probability + volume snapshots
- `agents` — handle, ERC-8004 address, chain ID, registration tx,
  reputation, lifetime PnL
- `agent_reputation_history` — per-update reputation snapshots
- `positions` — bettor, market, side, stake, avg price, shares,
  block/tx identity, status
- `claims` — payout per position, tx identity
- `refunds` — refund-after-grace payouts, tx identity
- `activity_events` — feed entries (bet, ai-lp, resolution, claim,
  refund)
- `notification_events` — `bet_confirmed`, `market_resolved`,
  `payout_claimable`
- `indexer_state` — per-chain cursor (`last_block`, `last_block_hash`,
  `last_status`, `last_error`, `last_reorg_at`)
- `transaction_syncs` — `/api/sync/transaction` audit log

**SIWE / user**
- `auth_nonces` — pending SIWE nonces (TTL 15 min)
- `auth_sessions` — issued session tokens (TTL 7 d)
- `user_settings` — per-address preferences
- `watchlist` — per-address market watch entries
- `user_activity_events` - wallet-scoped product events used for retention cohorts.

**Liquidity incentives**
- `liquidity_incentive_programs` - admin-configured program windows and
  eligibility policy.
- `liquidity_incentive_payouts` - recorded rebate payout transactions.

**Importer (admin)**
- `import_sources` — configured public RSS / API feeds
- `import_candidates` — normalized drafts, validation errors,
  spec hash
- `import_candidate_sources` — provenance fields per candidate
- `import_deployments` — link candidate → deployed `MarketCreated` tx

**Proof**
- `reclaim_proofs` — verified Reclaim payloads keyed by sessionId
  (writes gated by `RECLAIM_PROOF_WRITE_SECRET`)

### Contract events (`contracts/src/`)

20 events across 10 contracts; indexer consumes the bolded ones:

| Contract | Events |
|---|---|
| `ParimutuelPool` | **`BetPlaced`**, **`MarketResolved`**, **`Claimed`**, **`Refunded`**, `ResolverTransferred`, `Transfer` (soulbound position) |
| `MarketFactory` | **`MarketCreated`**, `MarketResolved` |
| `AIJudgeVerifier` | **`Proposed`**, **`Challenged`**, **`Finalized`**, **`Overridden`**, `Resolved` (legacy V1 alias) |
| `ProofAnchor` | **`ProofAnchored`** |
| `BetQuoteVerifier` | **`QuoteConsumed`** |
| `ReputationOracle` | **`AgentRegistered`**, **`ReputationUpdated`** |
| `PriceOracle` | `PriceSet`, `FeedSet` |
| `TokenizedStockAdapter` | `AssetRegistered`, `AssetActiveSet` |
| `TestUSDC` | `Transfer`, `Approval` (ERC-20 standard) |
| `TestAggregatorV3` | `AnswerUpdated` |

### Validation rules

**Market drafts** (`market-validation.ts` — used by `/api/markets/validate`
and importer `validateImportCandidate`)
- title: starts with a binary verb (Will / Does / Is / Has …), ends
  with `?`
- description: required
- sourceUrl: required, must be `http://` or `https://`
- resolutionCriteria: required
- category: whitelist (`stocks | crypto | sports | soft | macro`)
- oracleType: whitelist (`chainlink-price | zktls-ai-oracle | manual`)
- asset: whitelist (`USDC | tokenized-AAPL | tokenized-TSLA | …`)
- deadlineIso: must parse and be in the future
- feeBps: 0–500 bps (0–5%)

**User settings** (`user-preferences.ts` — used by `PUT /api/settings`)
- `chain`: `arbitrum-sepolia | rhc`
- `currency`: `USD | USDC`
- `notificationsEnabled`, `animationsEnabled`, `compactMode`: boolean
- `defaultStakeUsd`: 1 – 100_000
- `explorerPreference`: `default | arbiscan | rhc`

**Importer risk flags** (raised on candidates, surfaced in admin review)
- `source_url_missing`
- `deadline_missing`
- `deadline_not_future`
- `resolution_criteria_missing`
- `oracle_path_unconfigured`
- `ambiguous_binary_question`

### Test coverage

**Contract invariants** (`contracts/__tests__/contracts-compile.test.ts`)
- All `.sol` files compile clean
- ABI surface assertions for every contract (e.g. `propose`,
  `challenge`, `finalize`, `canFinalize`, `challengeDeadline`,
  `BET_QUOTE_TYPEHASH`, `QuoteConsumed`, `ProofAnchored`)
- Parimutuel math (winning pool / total pool payout)
- Refund-after-grace solvency
- Double-claim rejection
- Transfer-resolver authorization

**Backend** (`services/api/src/__tests__/*.test.ts`)
- `auth.test.ts` — cookie format, nonce TTL, admin allowlist parse
- `auth-api.test.ts` — SIWE nonce/verify route flow
- `agent-api.test.ts` — agent listing + detail
- `bet-preview.test.ts` — quote generation from pool snapshot
- `importer.test.ts` — RSS / JSON parsing + normalization
- `import-deploy.test.ts` — deploy verifies factory tx + ties
  candidate to `MarketCreated`
- `market-validation.test.ts` — every draft rule above
- `reclaim-proofs.test.ts` — Reclaim proof lifecycle, secret gating
- `schema-chain-defaults.test.ts` — DB defaults per chain
- `transaction-chain-identity.test.ts` — receipt parsing + event log
  decoding + chain-mismatch rejection
- `user-preferences.test.ts` — settings patch validator

Run everything with `pnpm test` (current count: **205 passing**).

### Scripts catalog (`scripts/`)

| Script | npm alias | Purpose |
|---|---|---|
| `check-env.ts` | `pnpm env:check [--profile=full]` | Env validation by category |
| `compile-abis.ts` | `pnpm contracts:abi` | Solidity → ABI JSON for `src/lib/abi/` |
| `deploy-contracts.ts` | `pnpm contracts:deploy` / `pnpm contracts:deploy:rhc` | Arbitrum Sepolia or Robinhood Chain testnet deploy + `.env.local` patcher |
| `register-feed.ts` | `pnpm contracts:register-feeds` | Wire Chainlink-shape feeds into `PriceOracle` |
| `e2e-live.ts` | `pnpm e2e:live [--dry]` | Live create → bet → propose → finalize → claim |
| `seed-market.ts` | manual | Seed a hard market (Chainlink-resolved) |
| `seed-soft-market.ts` | manual | Seed a soft market (AI-judge-resolved) |
| `generate-judge-key.ts` | manual | Mint a fresh ECDSA keypair for the AI judge |
| `bootstrap-mm-agent.ts` | manual | Initialise the MM agent account + reputation |
| `verify-onchain.ts` | manual | Sanity-check deployed contract state |

### Env key catalog

`pnpm env:check` is the authoritative validator. Common keys grouped:

**Frontend** — `NEXT_PUBLIC_BACKEND`,
`NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL`,
`NEXT_PUBLIC_MARKET_FACTORY_ADDRESS`,
`NEXT_PUBLIC_STAKE_TOKEN_ADDRESS`,
`NEXT_PUBLIC_RHC_STAKE_TOKEN_ADDRESS`,
`NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS`,
`NEXT_PUBLIC_PROOF_ANCHOR_ADDRESS`,
`NEXT_PUBLIC_BET_QUOTE_VERIFIER_ADDRESS`,
`NEXT_PUBLIC_RHC_RPC_URL`, `NEXT_PUBLIC_RHC_CHAIN_ID`,
`NEXT_PUBLIC_RHC_MARKET_FACTORY_ADDRESS`,
`NEXT_PUBLIC_RHC_AI_JUDGE_VERIFIER_ADDRESS`,
`NEXT_PUBLIC_REPUTATION_ORACLE_ADDRESS`,
`NEXT_PUBLIC_ORDER_MATCHER_ADDRESS`,
`NEXT_PUBLIC_LIQUIDITY_VAULT_ADDRESS`,
`NEXT_PUBLIC_EXCLUSIVE_OUTCOME_REGISTRY_ADDRESS`,
`NEXT_PUBLIC_PARLAY_POOL_PROTOTYPE_ADDRESS`,
`NEXT_PUBLIC_TOKENIZED_STOCK_ADAPTER_ADDRESS`,
`NEXT_PUBLIC_PRICE_ORACLE_ADDRESS`,
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_ARBITRUM_EXPLORER_URL`,
`NEXT_PUBLIC_RHC_EXPLORER_URL`,
`NEXT_PUBLIC_FAUCET_URL`,
`NEXT_PUBLIC_WALLET_ENABLED`,
`NEXT_PUBLIC_AI_JUDGE_ENABLED`,
`NEXT_PUBLIC_ZERODEV_GASLESS_ENABLED`,
`NEXT_PUBLIC_ZERODEV_BUNDLER_RPC_URL`,
`NEXT_PUBLIC_ZERODEV_PAYMASTER_ENABLED`,
`NEXT_PUBLIC_BACKEND_URL`

**Backend** — `DATABASE_URL`, `ARBITRUM_SEPOLIA_RPC_URL`,
`RHC_RPC_URL`, `RHC_CHAIN_ID`, `SIWE_DOMAIN`,
`ORDER_MATCHER_ADDRESS`, `LIQUIDITY_VAULT_ADDRESS`,
`EXCLUSIVE_OUTCOME_REGISTRY_ADDRESS`, `PARLAY_PROTOTYPE_ENABLED`,
`PARLAY_POOL_PROTOTYPE_ADDRESS`,
`CREATOR_MARKETS_ENABLED`, `OPPORTUNITIES_ENABLED`,
`JUDGE_PRIVATE_KEY`, `JUDGE_REMOTE_URL`, `JUDGE_REMOTE_SECRET`,
`QUOTE_SIGNER_PRIVATE_KEY`, `BET_QUOTE_VERIFIER_ADDRESS`,
`IMPORT_ADMIN_ADDRESSES` (or legacy `ADMIN_WALLET_ADDRESSES`),
`RECLAIM_PROOF_WRITE_SECRET`, `IMPORT_SOURCE_URLS`,
`STATUS_INDEXER_STALE_MS`, `STATUS_INDEXER_LAG_BLOCKS`,
`TRANSACTION_SYNC_MIN_CONFIRMATIONS`,
`MARKET_FACTORY_ADDRESS`, `STAKE_TOKEN_ADDRESS`,
`RHC_MARKET_FACTORY_ADDRESS`, `RHC_STAKE_TOKEN_ADDRESS`,
`MATCH_INGEST_ENABLED`, `PANDASCORE_TOKEN`, `PANDASCORE_GAMES`,
`FOOTBALL_DATA_TOKEN`, `MARKET_CREATOR_PRIVATE_KEY`,
`MATCH_INGEST_INTERVAL_MS`, `MATCH_RESOLVE_INTERVAL_MS`,
`RESULT_BUFFER_SEC`,
`REPUTATION_ORACLE_ADDRESS`, `BACKEND_API_URL`, `PUBLIC_APP_URL`,
`DUNE_API_KEY`, `DUNE_ADJUDEX_SUMMARY_QUERY_ID`, `DUNE_API_BASE_URL`,
`DUNE_QUERY_PERFORMANCE`, `GMX_CHAIN_ID`, `GMX_API_URL`,
`ZERODEV_PROJECT_ID`, `ZERODEV_PAYMASTER_POLICY_ID`,
`ZERODEV_BUNDLER_RPC_URL`, `ZERODEV_CHAIN_IDS`,
`ZERODEV_SESSION_TTL_HOURS`, `ZERODEV_SESSION_SPEND_CAP_USDC`,
`FHENIX_RPC_URL`, `FHENIX_CHAIN_ID`, `AWS_REGION`,
`RESOLUTION_EVIDENCE_BUCKET`, `CLOUDWATCH_EMF`, `CLOUDWATCH_NAMESPACE`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`,
`STRIPE_PRICE_ESPORTS_PRO`, `STRIPE_PRICE_TRADING_PRO`,
`STRIPE_PRICE_AGENT_PRO`, `STRIPE_PRICE_ENTERPRISE`

**Indexer** — `INDEXER_RPC_URL`, `INDEXER_CHAIN_ID`,
`INDEXER_ID`, `INDEXER_INTERVAL_MS`,
`INDEXER_MAX_BLOCK_RANGE`, `INDEXER_CONFIRMATIONS`

**AI Judge worker** — `JUDGE_MODE`, `JUDGE_HOST`, `JUDGE_PORT`,
`JUDGE_CHAIN_ID`, `JUDGE_SUPPORTED_CHAIN_IDS`,
`DSTACK_SIMULATOR_ENDPOINT`, `ANTHROPIC_API_KEY`

**MM agent** — `MM_AGENT_PRIVATE_KEY`, `MM_AGENT_HANDLE`,
`MM_BET_USDC`, `MM_MAX_EXPOSURE`, `MM_IMBALANCE_BPS`,
`MM_INTERVAL_MS`

**Reclaim / IPFS** — `RECLAIM_APP_ID`, `RECLAIM_APP_SECRET`,
`RECLAIM_PROVIDER_ID`, `RECLAIM_PUBLIC_BASE_URL`,
`IPFS_PROVIDER`, `IPFS_API_URL`, `PINATA_JWT`,
`WEB3_STORAGE_TOKEN`, `PROOF_ANCHOR_DEPLOYER_KEY`,
`PROOF_ANCHOR_ADDRESS`

**Misc** — `NODE_ENV`, `PORT`, `ADJUDEX_TESTNET_ONLY`,
`DEPLOYER_PRIVATE_KEY`, `JUDGE_PUBLIC_ADDRESS`,
`QUOTE_SIGNER_PUBLIC_ADDRESS`

---

## Hard rules

- Never commit secrets. `.env*`, `.data/`, `deployments/*.json` are
  git-ignored.
- One key per role — separate deployer / judge / quote signer / proof
  anchor wallets.
- `NEXT_PUBLIC_BACKEND=api` is the production product path; direct on-chain mode is limited to configured contract reads.
- AI output is never source of truth alone. It must be bound to
  evidenceHash + (optional) anchored Reclaim proof and verified
  on-chain via `AIJudgeVerifier`.
- Indexer must run with `INDEXER_CONFIRMATIONS >= 3` on testnet,
  higher on mainnet.
- Owner key for `AIJudgeVerifier.overrideAndFinalize` and
  `setFastTrackUntil` must live behind a multisig in production.
- `pnpm env:check --profile=full` must pass before a production release.

---

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — full data flow,
  contracts, AI roles, indexer model, V2 lifecycle.
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — bring-up order, incident
  triage matrix, live E2E playbook.
