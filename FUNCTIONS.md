# Adjudex — Function Reference

Complete index of the on-chain, HTTP, and CLI surfaces. Signatures are the
external/public entry points; internal helpers are omitted. See
[README.md](README.md) for the conceptual overview.

---

## 1. Smart contracts (`contracts/src/`)

### MarketFactory
Deploys per-market pools; holds global fee config. `Ownable2Step`, `Pausable`.
- `createMarket(bytes32 specHash, uint256 deadline) → uint256 marketId` — hard market, creator is resolver.
- `createMarketWithSpec(bytes32 specHash, uint256 deadline, string specUri) → uint256` — + off-chain spec URI.
- `createSoftMarket(bytes32 specHash, uint256 deadline, address verifier, string specUri) → uint256` — AI-judged market (resolver = AIJudgeVerifier).
- `createAmmMarket(bytes32 specHash, uint256 deadline, address resolver, string specUri, uint256 seedAmount) → uint256` — deploys an `OutcomeSharePool`, registers it with the vault.
- `getMarket(uint256 marketId) → address pool`
- `pause()` / `unpause()` — owner only; halts new market creation.
- views: `pools(id)`, `specHashes(id)`, `specUris(id)`, `nextMarketId`, `feeBps`, `feeRecipient`, `quoteVerifier`, `liquidityVault`, `stakeToken`.

### ParimutuelPool
Binary YES/NO pool, USDC stake, winners split the pool pro-rata. `Pausable`, `ReentrancyGuard`, `SafeERC20`.
- `bet(uint8 side, uint256 amount) → uint256 positionId` — YES=0, NO=1.
- `betWithQuote(BetQuote q, bytes sig, uint8 side, uint256 amount) → uint256` — EIP-712 slippage-protected bet (needs quoteVerifier).
- `resolve(uint8 side)` — resolver only.
- `claim(uint256 positionId) → uint256 payout` — winning position redeems pro-rata.
- `refundAfterGrace(uint256 positionId) → uint256` — stake recovery if unresolved by `deadline + 14 days`.
- `transferResolver(address newResolver)` — hand resolution authority (e.g. to AIJudgeVerifier).
- `pause()` / `unpause()` — resolver only; new bets only.
- views: `getYesPct()` (0..10000 bps), `getTotalVolume()`, `getBettorCount()`, `yesPool`, `noPool`, `resolved`, `resolvedSide`.

### OutcomeSharePool
Binary AMM (constant-product FPMM); collateral as complete sets, winning share redeems 1:1. Custom errors. `Pausable`, `ReentrancyGuard`.
- `buy(uint8 side, uint256 amount) → uint256 sharesOut`
- `sell(uint8 side, uint256 shares) → uint256 amountOut`
- `quoteBuy(uint8 side, uint256 amount) → uint256` / `quoteSell(uint8 side, uint256 shares) → uint256` — view quotes.
- `addLiquidity(uint256 amount) → uint256 minted` / `removeLiquidity(uint256 lpAmount) → uint256 collateralOut`
- `seedFromVault(uint256 yesAmount, uint256 noAmount)` — vault only; opening line.
- `resolve(uint8 side)` — resolver only.
- `claim(uint8 side, uint256 shares) → uint256 payout` — winning shares 1:1.
- `repayVault(uint256 amount)` — return losing-side surplus to the vault after resolution.
- views: `invariant()`, `yesShares()`, `noShares()`, `yesBalanceOf(a)`, `noBalanceOf(a)`, `yesReserve`, `noReserve`, `totalLpShares`, `lpBalanceOf(a)`, `yesToken`, `noToken`.

### OutcomeShareToken
ERC-20 outcome share, minter-gated to its pool.
- `mint(address to, uint256 amount)` / `burn(address from, uint256 amount)` — pool only.
- `decimals() → 6`.

### LiquidityVault
Operator vault for AMM seed liquidity + debt/surplus accounting. `Ownable2Step`, `ReentrancyGuard`.
- `setFactory(address)` — owner; wired post-deploy.
- `registerMarket(address market, uint256 seedAmount)` — factory only; records + seeds a pool.
- `repay(uint256 amount)` — pool returns surplus collateral.
- `claimSurplus(address market, address recipient) → uint256` — owner reclaims closed-market surplus.

### AdjudexOrderMatcher
EIP-712 signed limit-order CLOB; settles maker/taker intents on-chain. `Ownable2Step`, `Pausable`, `ReentrancyGuard`.
- `matchOrders(OrderIntent taker, bytes takerSig, OrderIntent[] makers, bytes[] makerSigs, uint256 feeBps, address feeRecipient) → uint256 totalAmount` — atomic per-fill settlement (shares seller→buyer, cash buyer→seller).
- `hashOrder(OrderIntent) → bytes32` / `verify(OrderIntent, bytes sig) → bool` — EIP-712 helpers.
- `cancelOrder(OrderIntent)` / `cancelUpTo(uint256 nonce)` — maker cancellation.
- `setMaxFeeRateBps(uint256)` — owner. `pause()` / `unpause()`.

### AIJudgeVerifier (V2 optimistic)
`propose → 2h challenge → finalize`, owner override on dispute. `Ownable2Step`.
- `propose(address pool, uint256 marketId, uint8 outcome, bytes32 evidenceHash, bytes sig)` — judge-signed verdict.
- `challenge(uint256 marketId) payable` — anyone, within window (optional bond).
- `finalize(uint256 marketId)` — anyone, after window; calls `pool.resolve`.
- `overrideAndFinalize(uint256 marketId, uint8 outcome)` — owner only, when Disputed.
- `verifyAndResolve(...)` — legacy fast-track, gated by `fastTrackUntil`.
- `setFastTrackUntil(uint256)`, `setChallengeBond(uint256 marketId, uint256 wei)` — owner.
- views: `canFinalize(id) → bool`, `challengeDeadline(id)`, `proposals(id)`, `resolver()`.

### OptimisticOracleResolver
Permissionless UMA-style bonded resolver (alternative to AIJudgeVerifier). `Ownable2Step`.
- `assertOutcome(uint256 marketId, uint8 outcome)` — post a bonded assertion.
- `dispute(uint256 marketId)` — bond a counter-claim.
- `settle(uint256 marketId)` — finalize undisputed assertion after liveness.
- `resolveDispute(uint256 marketId, uint8 finalOutcome)` — owner/arbiter.
- views: `canSettle(id)`, `disputeDeadline(id)`, `assertions(id)`; setters `setDefaultBond`, `setDefaultLiveness`.

### ExclusiveOutcomeRegistry
Metadata for exclusive multi-outcome groups (exactly one YES). `Ownable2Step`.
- `createGroup(string title) → uint256 groupId` — owner.
- `linkOutcome(uint256 groupId, uint256 marketId, string label)` — owner; rejects duplicates.
- `resolveGroup(uint256 groupId, uint256 winningMarketId)` — owner; needs ≥2 outcomes.
- views: `groups(id)`, `outcomes(id, index)`, `marketLinked(id, marketId)`.

### ExclusiveGroupSettler
Atomic on-chain settlement of a resolved exclusive group (winner→YES, others→NO). Custom errors.
- `settle(uint256 groupId)` — permissionless, idempotent; resolves each child pool via the factory lookup. Never moves cross-pool collateral. Child pools must use it as their resolver.
- views: `registry`, `factory`.

### AdjudexTimelock
OpenZeppelin `TimelockController` wrapper — recommended owner for the Ownable2Step contracts so owner calls run through a delay + multisig. Key inherited surface: `schedule`, `scheduleBatch`, `execute`, `executeBatch`, `cancel`, `getMinDelay`, `updateDelay`, `hashOperation`, `isOperationReady`, `grantRole`/`revokeRole`.

### BetQuoteVerifier
EIP-712 verifier for signed bet quotes (slippage/deadline/nonce). One-shot per `(bettor, nonce)`.
- `consume(BetQuote q, bytes sig) → bytes32` — verify + mark used.
- views: `verify(q, sig) → bool`, `digest(q)`, `hashQuote(q)`, `domainSeparator()`.

### ProofAnchor
On-chain registry mapping a Reclaim sessionId → (proofHash, IPFS cid). `Ownable`.
- `anchor(string sessionId, bytes32 proofHash, bytes cid)` — authorized publisher.
- views: `getAnchor(sessionId)`, `getAnchorByKey(hash)`, `isAnchored(sessionId) → bool`.

### ReputationOracle
ERC-8004-style agent registry. `Ownable2Step`.
- `registerAgent(string handle) → bytes32 agentId` — self-attest.
- `setReputation(bytes32 agentId, uint256 rep)` / `rotateJudge(address)` — judge/owner.
- views: `getReputation(id)`, `getAgent(id)`, `agentCount()`.

### PriceOracle
Operator-set + Chainlink-fallback price feed, normalized to 8 decimals. `Ownable`.
- `setPrice(bytes32 key, uint256 price, uint256 updatedAt)`, `setFeed(bytes32 key, address aggregator)`, `setMaxStaleSec(uint256)` — owner.
- views: `getPrice(key) → (price, updatedAt)`, `keyFor(string symbol) → bytes32`.

### TokenizedStockAdapter
Registry of tokenized-equity adapters (AAPL/TSLA/…). `Ownable2Step`.
- `register(string ticker, address token) → bytes32 key`, `setActive(bytes32 key, bool)` — owner.
- views: `tokenOf(ticker) → (token, active)`, `tickerCount()`.

### ParlayPoolPrototype (testnet-only)
- `openDraft(Leg[] legs, uint256 stake, uint256 naiveProbabilityBps)`, `ownerSettle(uint256 draftId, bool won)`, `hashLegs(Leg[]) → bytes32`.

### Test helpers
- **TestUSDC** — `mint(to, amount)`, `decimals() → 6`. **TestAggregatorV3** — Chainlink-shape mock (`setAnswer`, `latestRoundData`, …).

---

## 2. HTTP API

Two layers: the **Fastify backend** (`services/api/src/server.ts`) owns Postgres /
SIWE / signing; **Next routes** (`src/app/api/**`) proxy to it and add edge
helpers (judge, reclaim, integrations). SIWE = wallet session cookie; admin =
`IMPORT_ADMIN_ADDRESSES` allowlist.

### Markets & trading
- `GET /api/markets` · `GET /api/markets/:id` · `/:id/activity` · `/:id/timeline` · `/:id/liquidity` · `/:id/resolution` · `/:id/opportunities`
- `POST /api/markets/validate` · `/api/markets/generate` (AI spec) · `POST /api/markets` (confirm created)
- `POST /api/bets/preview` · `POST /api/bets` (Next; confirm bet) · `POST /api/claim`
- `GET /api/markets/:id/share-quote` (Next) · `POST /api/sync/share-transaction` (Next) — AMM exit reconcile
- `GET/POST /api/orders` · `DELETE /api/orders/:hash` · `POST /api/orders/match-preview` — signed CLOB intents

### Resolution & proof
- `GET /api/oracle/:marketId` — resolution state
- `POST /api/judge/resolve` (Next) — sign AI verdict
- `POST /api/resolve` (Next) — server-side resolution helper
- `POST /api/reclaim/session|callback|get` (Next) · `GET/POST /api/reclaim/proofs[/:sessionId]` — zkTLS proof store (`RECLAIM_PROOF_WRITE_SECRET`)

### Competitive surfaces
- `GET/POST /api/market-groups` · `/:id` · `/:id/arbitrage` · `POST /:id/convert`
- `GET/POST /api/creators` · `/:handle` · `POST /:handle/markets`
- `POST /api/parlays/preview` · `POST /api/parlays` · `GET /api/parlays/:id`
- `GET /api/opportunities` · `POST /api/opportunities/rebuild`

### Portfolio, agents, social
- `GET /api/portfolio/:address/positions` · `/history`
- `GET /api/agents` · `/ecosystem` · `/:id` · `/:id/moves` · `/:id/reputation` · `POST /api/agents/register` (Next)
- `GET /api/leaderboard` · `GET /api/activity`
- `GET /api/users/:address` · `POST/DELETE /api/users/:address/follow`
- `GET /api/markets/:id/comments` · `DELETE /api/comments/:id`
- `GET /api/quests` · `GET /api/referrals/me` · `/stats`

### SIWE / user
- `POST /api/auth/nonce` · `/verify`
- `GET/PUT /api/settings` · `GET/POST /api/watchlist` · `DELETE /api/watchlist/:marketId`
- `GET /api/notifications` · `POST /api/notifications/read` · `PATCH /api/notifications/:id/read`
- `POST /api/wallet/connect|disconnect` · `GET /api/wallet`
- `POST /api/analytics/events`

### Admin (SIWE + allowlist)
- `GET /api/admin/escalated` · `POST /api/admin/escalated/:marketId {action:"approve"|"skip"}` — hybrid-resolution review queue
- `GET /api/admin/revenue` · `GET /api/analytics/retention` · `/webhooks`
- `GET /api/import/sources` · `POST /api/import/scan` · `GET /api/import/candidates` · `POST /api/import/candidates/:id/validate|deploy`
- `POST /api/import/gmx/scan` · `/api/import/rwa/scan` — sponsor market generators
- `POST /api/liquidity/programs` · `/payouts` (Next) · `GET /api/liquidity/incentives`

### Integrations (sponsor read/refresh)
- `GET /api/integrations/sponsors` · `/dune/summary` · `/dune/templates` · `POST /dune/summary/refresh`
- `GET /api/integrations/gmx/markets` · `/gmx/signal` · `/fhenix/prototype` · `/zerodev/session-policy`

### Health & feed
- `GET /health` · `GET /api/status` (DB/RPC/factory/indexer per chain) · `GET /metrics`
- `GET /api/feed` — personalised ranked feed (For You)

---

## 3. CLI / pnpm scripts

| Script | Purpose |
|---|---|
| `pnpm dev` / `dev:api` / `dev:indexer` | Run frontend / Fastify API / indexer locally |
| `pnpm build` · `start` · `serve` | Next build / start / build+start |
| `pnpm test` | Vitest (unit + contract compile/ABI + fuzzed economic invariants) |
| `pnpm test:e2e` | Playwright E2E |
| `pnpm contracts:compile` | solc compile + ABI-surface + invariant tests |
| `pnpm contracts:abi` | Write ABI JSON to `src/lib/abi/` |
| `pnpm contracts:deploy` | Deploy + wire the full stack (writes `deployments/{chainId}.json`, patches `.env.local`); `DRY_RUN=1` to preview |
| `pnpm contracts:deploy:rhc` | Same stack to Robinhood Chain testnet |
| `pnpm contracts:register-feeds` | Set PriceOracle feeds |
| `pnpm tsx scripts/deploy-timelock.ts` | Deploy `AdjudexTimelock` (governance owner) |
| `pnpm tsx scripts/transfer-ownership.ts` | Hand Ownable2Step contracts to a Safe/timelock (`SAFE_ADDRESS=`) |
| `pnpm tsx scripts/generate-judge-key.ts` | Generate AI-judge signer keypair (testnet) |
| `pnpm env:check [--profile=full\|production]` | Validate env by category (never prints secrets) |
| `pnpm e2e:live [--dry]` | Live testnet create→bet→propose→finalize→claim |
| `pnpm api:migrate` | Apply `services/api/db/schema.sql` (idempotent) |
| `pnpm indexer:backfill <from> <to>` | Re-emit indexer events for a block range |
| `forge test -vvv` | Bytecode-level Foundry tests (`forge install foundry-rs/forge-std` first) |
