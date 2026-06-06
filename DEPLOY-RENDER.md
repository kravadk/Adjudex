# Render Deploy — Adjudex backend (`adjudex-api`)

This is the **Fastify backend** of the Adjudex stack (`services/api`).
Render hosts it as a Web Service at
`https://adjudex-api.onrender.com`. The Next.js frontend on Vercel talks
to it via `NEXT_PUBLIC_API_URL` / `BACKEND_API_URL` — see
[DEPLOY-VERCEL.md](DEPLOY-VERCEL.md).

Postgres can be Render's managed Postgres or any external Postgres; the
backend only needs a `DATABASE_URL`.

## What runs here

- `services/api/src/server.ts` — Fastify entrypoint (markets, SIWE,
  importer, sync, quote signer, rate-limit). Binds `0.0.0.0:$PORT`.
- `services/api/src/migrate.ts` — applies `db/schema.sql` idempotently.

The indexer (`services/indexer`) and AI judge (`services/ai-judge`) are
separate processes. Run them as additional Render workers when you need
live block sync / resolution; the API serves whatever Postgres already
holds without them.

## One-time setup

### 1. Create the service

1. Render dashboard → **New → Web Service** → connect
   `github.com/kravadk/adjudex`.
2. **Branch**: the branch you deploy from.
3. **Root Directory**: leave repo root (`./`).
4. **Runtime**: Node.
5. **Build Command**: `pnpm install --frozen-lockfile`
6. **Start Command**: `pnpm --filter @adjudex/api start`
   (runs `tsx src/server.ts`).

### 2. Database migration

Run once after the database exists (Render **Shell** or a one-off job):

```bash
pnpm --filter @adjudex/api migrate
```

This applies `services/api/db/schema.sql`. It is idempotent — safe to
re-run after schema additions.

### 3. Environment variables

Render → **Environment**. `PORT` is injected by Render — **do not set it
manually** (the server reads `process.env.PORT`). `NODE_VERSION` pins the
Node runtime.

**Required for the API to boot + serve markets:**

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://...` | only hard requirement to start |
| `NODE_ENV` | `production` | |
| `ARBITRUM_SEPOLIA_RPC_URL` | `https://sepolia-rollup.arbitrum.io/rpc` | server-side tx-receipt verification |
| `MARKET_FACTORY_ADDRESS` | `0x...` | from `deployments/421614.json` |
| `STAKE_TOKEN_ADDRESS` | `0x...` | TestUSDC on Sepolia |
| `REPUTATION_ORACLE_ADDRESS` | `0x...` | agent registry |
| `AI_JUDGE_VERIFIER_ADDRESS` | `0x...` | propose / finalize |

`DATABASE_POOL_URL` is an optional PgBouncer/pooler URL used for runtime
traffic in preference to `DATABASE_URL`.

**Optional — enable per feature:**

| Variable | Enables |
|---|---|
| `JUDGE_PRIVATE_KEY` | AI-judge verdict signing (propose/finalize) |
| `QUOTE_SIGNER_PRIVATE_KEY` + `BET_QUOTE_VERIFIER_ADDRESS` | EIP-712 signed bet quotes (returns `503` until both set) |
| `SIWE_DOMAIN` | wallet login domain (falls back to app URL if unset) |
| `IMPORT_ADMIN_ADDRESSES` | comma-separated `0x` admin allowlist for importer routes |
| `RECLAIM_PROOF_WRITE_SECRET` | shared secret for Next → backend proof writes (must match Vercel) |
| `IPFS_PROVIDER` (`pinata`/`web3storage`/`kubo`) + token | Reclaim proof pinning |
| `MATCH_INGEST_ENABLED=1` + `PANDASCORE_TOKEN`/`FOOTBALL_DATA_TOKEN` + `MARKET_CREATOR_PRIVATE_KEY` | auto market ingest |
| `RATE_LIMIT_BACKEND=redis` + `REDIS_REST_URL` / `REDIS_REST_TOKEN` | shared rate limit across instances |
| `SENTRY_DSN`, `LOG_LEVEL` | observability |

`pnpm env:check --profile=full` (from the Render Shell) lists every
missing / invalid key by category without printing secret values.

## Deploys

Render auto-deploys on push to the configured branch. Build log runs
`pnpm install --frozen-lockfile`, then the start command boots Fastify on
`0.0.0.0:$PORT`.

Health check: `GET https://adjudex-api.onrender.com/health` and
`GET /api/status` (DB / RPC / factory / indexer readiness per chain).

## Common issues

- **`DATABASE_URL (or DATABASE_POOL_URL) is required.`** — env not set, or
  set on the wrong environment. The service exits on boot without it.
- **Service shows "no open ports" / times out** — a manually-set `PORT`
  is overriding Render's injected port. Delete the manual `PORT` var.
- **Markets load but bet/claim/confirm endpoints 5xx** —
  `ARBITRUM_SEPOLIA_RPC_URL` missing; the API can't verify tx receipts.
- **`quote_signer_not_configured` (503) on `/api/bets/quote`** — expected
  until both `QUOTE_SIGNER_PRIVATE_KEY` and `BET_QUOTE_VERIFIER_ADDRESS`
  are set (and the verifier is deployed).

## Links

- [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md) — the Next.js frontend
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — full bring-up matrix + incident triage
- [docs/SECRETS.md](docs/SECRETS.md) — production secret management
- [docs/MAINNET.md](docs/MAINNET.md) — Sepolia → Arbitrum One switch
