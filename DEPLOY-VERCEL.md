# Vercel Deploy — Adjudex

This is the **Next.js frontend** of the Adjudex stack. Vercel hosts only
this surface. Backend (`services/api`), indexer, AI judge, and the
Solidity contracts run on different infrastructure (Fly / Railway /
Phala / Arbitrum).

## What ships to Vercel

- Next.js 16 App Router app at the repo root (`src/`, `public/`)
- All routes under `src/app/` including `/api/*` (Next route handlers)
- Static assets in `public/`
- `vercel.json` headers (PWA / security)

Everything else (`services/`, `contracts/`, `scripts/`, `tests/`, `docs/`,
`monitoring/`, `audits/`) is excluded by `.vercelignore`.

## Prerequisites

- Vercel account ([vercel.com](https://vercel.com))
- Vercel CLI (optional): `pnpm dlx vercel`
- GitHub repo pushed (Vercel reads from there)

## One-time setup

### 1. Connect repository

1. Push repo to GitHub: `git push -u origin main`
2. Vercel dashboard → **New Project** → import `github.com/kravadk/adjudex`
3. Framework preset: **Next.js** (auto-detected)
4. Root directory: **./** (leave default)
5. Build / Output settings: leave default — `vercel.json` overrides them
6. **Install Command** override: `pnpm install --frozen-lockfile`

### 2. Environment variables

Open **Settings → Environment Variables** in the Vercel project, paste
each row from `.env.example` and replace the empty values with real
ones. Required minimum for Sepolia preview:

| Variable | Example | Notes |
|---|---|---|
| `NEXT_PUBLIC_BACKEND` | `api` | `mock` blocked in prod |
| `NEXT_PUBLIC_API_URL` | `https://api.adjudex.xyz` | your Fastify host |
| `BACKEND_API_URL` | `https://api.adjudex.xyz` | server-side calls |
| `NEXT_PUBLIC_SITE_URL` | `https://adjudex.xyz` | for OG, sitemap |
| `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL` | `https://arb-sepolia.g.alchemy.com/v2/...` | dedicated RPC |
| `NEXT_PUBLIC_ONCHAIN_CHAIN_ID` | `421614` | Sepolia |
| `NEXT_PUBLIC_ONCHAIN_RPC_URL` | same as Arbitrum Sepolia | |
| `NEXT_PUBLIC_ONCHAIN_MARKET_FACTORY_ADDRESS` | `0x...` | from `deployments/421614.json` |
| `NEXT_PUBLIC_MARKET_FACTORY_ADDRESS` | same | |
| `NEXT_PUBLIC_STAKE_TOKEN_ADDRESS` | `0x...` | TestUSDC on Sepolia |
| `NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS` | `0x...` | |
| `NEXT_PUBLIC_PROOF_ANCHOR_ADDRESS` | `0x...` | |
| `NEXT_PUBLIC_REPUTATION_ORACLE_ADDRESS` | `0x...` | |
| `NEXT_PUBLIC_PRICE_ORACLE_ADDRESS` | `0x...` | |
| `NEXT_PUBLIC_TOKENIZED_STOCK_ADAPTER_ADDRESS` | `0x...` | |
| `NEXT_PUBLIC_ARBITRUM_EXPLORER_URL` | `https://sepolia.arbiscan.io` | |
| `NEXT_PUBLIC_WALLET_ENABLED` | `1` | enable wagmi providers |
| `NEXT_PUBLIC_SENTRY_DSN` | `https://...@sentry.io/...` | optional, for error tracking |
| `SENTRY_DSN` | same as above | server-side |
| `DATABASE_URL` | `postgres://...` | required if Next.js `/api/*` queries Postgres |

For each env: pick the **target environments** (Production / Preview /
Development) on Vercel's UI.

### 3. Domain

1. Vercel → **Settings → Domains** → add `adjudex.xyz`
2. Add DNS records at your registrar (Vercel shows exact values)
3. Wait for SSL provisioning (~1 min)
4. Update env `NEXT_PUBLIC_SITE_URL` to `https://adjudex.xyz`

## Production deploy

Every push to `main` triggers a Production deploy. Every push to a
non-main branch triggers a Preview deploy with a unique URL.

```bash
# Local smoke (run before pushing)
pnpm tsc --noEmit
pnpm lint
pnpm build

# Push
git push origin main
```

Vercel build log shows:
1. `pnpm install --frozen-lockfile` — installs root + workspace deps
2. `pnpm build` (`next build`) — compiles Next.js
3. Output → `.next/`
4. Deploy

## Common issues

- **`Cannot find module '@adjudex/api'`** — root doesn't depend on
  workspace packages. If you see this, check `package.json` dependencies
  don't import from `services/`.
- **`process.env.NEXT_PUBLIC_X is undefined` at runtime** — env var
  added after build. Force a redeploy from Vercel UI.
- **`ESLint failed during build`** — `next build` runs `next lint` by
  default. Fix locally with `pnpm lint --fix`, push.
- **`Module not found: next/font/google → Rubik`** — Vercel doesn't
  have network during build? Rare. Add `NEXT_TELEMETRY_DISABLED=1` env.
- **`Failed to load env from .env.local`** — Vercel ignores
  `.env.local`. Use Vercel env vars UI.

## Preview vs Production envs

- **Preview** envs: point to Sepolia + staging backend
- **Production** envs: point to Arbitrum One + production backend
  (post-S2 audit gate — see [docs/MAINNET.md](docs/MAINNET.md))

## Disabling Sentry / Reclaim in preview

If a Preview shouldn't write to Sentry, leave `NEXT_PUBLIC_SENTRY_DSN`
empty for Preview environment only.

If Reclaim isn't configured for Preview, set:
```
RECLAIM_PROOF_WRITE_SECRET=
PROOF_ANCHOR_DEPLOYER_KEY=
```
The app degrades to `anchor.status='skipped'` without breaking.

## CLI workflow (alternative to git push)

```bash
pnpm dlx vercel login
pnpm dlx vercel link        # interactive: pick org + project
pnpm dlx vercel              # preview deploy
pnpm dlx vercel --prod       # production deploy
```

## Custom build command (if needed)

`vercel.json` declares framework only; Vercel auto-detects pnpm and
runs `pnpm install --frozen-lockfile` + `pnpm build`. To override:

```json
{
  "buildCommand": "pnpm build",
  "installCommand": "pnpm install --frozen-lockfile --filter '.'"
}
```

(Add only if Vercel auto-detection fails — try first without.)

## Links

- [Vercel Next.js docs](https://vercel.com/docs/frameworks/nextjs)
- [Vercel pnpm workspaces guide](https://vercel.com/docs/projects/project-configuration/build-settings#install-command)
- [docs/MAINNET.md](docs/MAINNET.md) — when to switch from Sepolia preview to Arbitrum One production
- [docs/SECRETS.md](docs/SECRETS.md) — production secret management beyond Vercel UI
