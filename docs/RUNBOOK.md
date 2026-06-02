# PariAI — Operations Runbook

This runbook is the single source for bringing the full PariAI stack up on
testnet and verifying it end-to-end. It covers env config, deploys, indexer
hardening, and the live verification script.

## 1. Stack at a glance

| Service | Source | Process |
|---|---|---|
| Frontend (Next.js) | `src/` | `pnpm dev` (port 3000) |
| Backend (Fastify) | `services/api/` | `pnpm dev:api` |
| Indexer worker | `services/indexer/` | `pnpm dev:indexer` |
| AI judge worker | `services/ai-judge/` | run separately (Phala or local) |
| Market-maker agent | `services/mm-agent/` | optional, opt-in |

All four backend processes hit the same Postgres database
(`DATABASE_URL`). Frontend talks to backend via `NEXT_PUBLIC_BACKEND_URL`
when `NEXT_PUBLIC_BACKEND=api`, else reads chain directly via viem.

## 2. Env validation (gate)

Before bringing anything up:

```bash
pnpm env:check                  # soft profile - frontend + indexer minimums
pnpm env:check --profile=full   # strict, requires every signer + provider
```

The script reads `process.env` and `.env.local`, never prints values, and
exits non-zero with a per-category failure list (FRONTEND / BACKEND /
INDEXER / AGENTS / IPFS). Wire it into CI / deploy preflight.

## 3. Bring-up order

1. **Postgres**
   - Provision DB, set `DATABASE_URL=postgres://...`
   - `pnpm api:migrate` applies `services/api/db/schema.sql` (idempotent).
2. **Deploy contracts** (one-time per chain)
   - Set `DEPLOYER_PRIVATE_KEY`, `ARBITRUM_SEPOLIA_RPC_URL`,
     `ARBITRUM_RHC_TESTNET_OPT_IN=1` in `.env.local`.
   - Optional: `JUDGE_PUBLIC_ADDRESS`, `QUOTE_SIGNER_PUBLIC_ADDRESS` to
     also deploy `AIJudgeVerifier` + `BetQuoteVerifier`.
   - `pnpm contracts:deploy` writes `deployments/{chainId}.json` and
     patches `.env.local` with every new address (regular + `NEXT_PUBLIC_*`).
3. **Indexer**
   - Set `INDEXER_RPC_URL`, `INDEXER_CHAIN_ID=421614`, `INDEXER_ID`,
     `INDEXER_INTERVAL_MS=12000`, `INDEXER_MAX_BLOCK_RANGE=2000`,
     `INDEXER_CONFIRMATIONS=3`.
   - `pnpm dev:indexer` is long-running. Status surfaces via
     `GET /api/status` (`indexer.lastStatus`, `lagBlocks`, `reorgRecent`).
4. **Backend**
   - Set `SIWE_DOMAIN`, `IMPORT_ADMIN_ADDRESSES` (comma-separated 0x list),
     `RECLAIM_PROOF_WRITE_SECRET`, `QUOTE_SIGNER_PRIVATE_KEY`,
     `BET_QUOTE_VERIFIER_ADDRESS`.
   - `pnpm dev:api`. Global rate-limit hook is active (30 writes/min,
     240 reads/min per IP).
5. **Frontend**
   - `NEXT_PUBLIC_BACKEND=api`, `NEXT_PUBLIC_BACKEND_URL=http://...`.
   - `pnpm dev` (or `pnpm build && pnpm start`).

## 4. Indexer hardening - what it does

`services/indexer/src/index.ts` runs `syncOnce()` on `INDEXER_INTERVAL_MS`:

1. Read head, compute `safeHead = head - INDEXER_CONFIRMATIONS` so only
   confirmed blocks are indexed.
2. Probe `last_block_hash`: re-fetch the block at our cursor. If its hash
   diverged, mark `last_status='reorg'`, rewind the cursor by
   `2 * INDEXER_CONFIRMATIONS`, and replay.
3. Iterate markets, sync state + events in `[fromBlock, toBlock]`.
4. Capture the new tip hash and persist via `writeIndexerStatus()`.

Failures during the interval are caught and written as `last_status='error'`
with `last_error`. `GET /api/status` exposes `indexer.lastStatus`,
`indexer.lastError`, `indexer.lastReorgAtIso`, `indexer.lagBlocks` and
`indexer.reorgRecent` so any operator dashboard or alerting can pick it up.

### Backfill / replay

```bash
pnpm indexer:backfill 12345 99999   # one-shot replay of a block window
```

Useful after a known reorg or when wiring a new chain. Does not touch the
indexer cursor - purely re-emits events into the existing schema (ON
CONFLICT DO NOTHING / DO UPDATE on event id).

## 5. Live E2E verification

```bash
pnpm e2e:live           # uses .env.local; runs against the configured chain
pnpm e2e:live --dry     # plan-only, no chain writes
```

This script:

1. Confirms RPC + Postgres are reachable.
2. Creates a soft market via MarketFactory.
3. Mints test USDC, approves the pool, places a bet.
4. Waits up to 60s for the indexer to pick up the bet.
5. Submits a propose via AIJudgeVerifier (V2 path).
6. Reads `canFinalize` until true (you may need to bump fastTrack on
   testnet to skip the 2h window).
7. Calls finalize, then claim, then verifies the indexer reflects the
   resolved + claimable state.

Every tx hash is logged. Failures print the offending step + raw error.

## 6. Resolution lifecycle

| Step | Caller | Contract | UI surface |
|---|---|---|---|
| propose | AI judge service | AIJudgeVerifier.propose | "Proposed - 2h window" |
| challenge | anyone (within window) | AIJudgeVerifier.challenge | "Challenge" button |
| finalize | anyone (after window) | AIJudgeVerifier.finalize | "Finalize" button |
| override | owner | AIJudgeVerifier.overrideAndFinalize | hidden in V1, owner CLI |
| claim | winning bettors | ParimutuelPool.claim | Portfolio Claim button |

The `<ResolutionStatus>` component on the market detail page reads
`proposals(marketId)`, `canFinalize(marketId)`, `challengeDeadline(marketId)`
and surfaces stage-aware buttons. Tx links go to Arbiscan Sepolia.

## 7. Proof anchor (Reclaim to IPFS to on-chain)

1. User runs zkTLS via Reclaim; attestor POSTs to `/api/reclaim/callback`.
2. Next route verifies the proof, persists it via `putProof()`, pins the
   JSON via `IPFS_PROVIDER` (`pinata|web3storage|kubo|stub`), and calls
   `ProofAnchor.anchor(sessionId, proofHash, cid)`.
3. Indexer (or any external reader) can resolve a proof from on-chain
   alone: read `anchors[keccak(sessionId)]` then fetch JSON from IPFS by CID.

`stub` provider returns deterministic `localcid-{hex}` so dev/CI works
without network. Production must set `IPFS_PROVIDER=pinata` + `PINATA_JWT`
(or web3storage / kubo equivalent).

## 8. Rate limits, admin allowlist

- `services/api/src/rate-limit.ts` is an in-memory token bucket: 30 writes
  + 240 reads / minute / IP. Swap to Redis bucket for multi-instance.
- `parseAdminAllowlist()` in `services/api/src/auth.ts` reads
  `IMPORT_ADMIN_ADDRESSES` (or legacy `ADMIN_WALLET_ADDRESSES`). Importer
  routes call `requireImportAdmin()`: 401 if no session, 403 if not
  allowlisted, 503 if no list configured.

## 9. Deployed addresses (Arbitrum Sepolia, chainId 421614)

Snapshot lives in `deployments/421614.json`. Frontend reads same values
from `NEXT_PUBLIC_*_ADDRESS` env vars set by `contracts:deploy`. Confirm
on Arbiscan: `https://sepolia.arbiscan.io/address/{address}`

## 10. Incident triage

| Symptom | First check |
|---|---|
| `/api/status` `database.ok=false` | `DATABASE_URL`, Postgres connectivity |
| `indexer.lastStatus='reorg'` repeating | bump `INDEXER_CONFIRMATIONS` |
| `indexer.lagBlocks` growing | RPC throughput; raise interval or split chains |
| Reclaim anchor missing tx | `PROOF_ANCHOR_DEPLOYER_KEY` unset; re-anchor manually |
| 429 from API | rate-limit triggered; check IP, consider whitelist |
| BetForm shows "Quote unavailable" | `/api/bets/quote` needs `QUOTE_SIGNER_PRIVATE_KEY` + `BET_QUOTE_VERIFIER_ADDRESS` |

## 11. Hard rules

- **Never commit secrets.** `.env*` is git-ignored. `.data/` (Reclaim
  proof cache) is git-ignored. `deployments/*.json` is git-ignored.
- **Separate keys per role** - deployer / judge / quote signer / proof
  anchor must each be a distinct key.
- **Always run `pnpm env:check --profile=full` before a production
  release.** CI must gate on exit code.
