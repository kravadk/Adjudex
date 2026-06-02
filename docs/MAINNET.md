# Mainnet Deploy Runbook (Arbitrum One — 42161)

Цей doc описує **як перейти з Sepolia на Arbitrum One** після того як
audit clean і Stage 2 gates пройдено.

> **DO NOT** виконати кроки нижче без:
> 1. Завершеного external audit (звіт у [audits/](../audits/))
> 2. Усі critical/high findings remediated + re-audited
> 3. Bug bounty активний на Immunefi
> 4. Gnosis Safe готовий (3-of-5 threshold для mainnet — див. [GOVERNANCE.md](GOVERNANCE.md))
> 5. Pinata / Sentry / managed Postgres provisioned
> 6. `pnpm env:check --profile=production` зелений
> 7. ToS + Privacy опубліковані

## Pre-flight checklist

```
[ ] audit report public в audits/YYYY-MM-firmname-pariai.pdf
[ ] all P0/P1 findings closed
[ ] Immunefi bounty page live (announcement-ready)
[ ] Gnosis Safe 3-of-5 deployed на Arbitrum One
[ ] Deployer EOA topped up with > 0.05 ETH (deploy ~ 0.01-0.03 ETH gas)
[ ] Mainnet RPC URL (Alchemy / QuickNode dedicated — NOT public RPCs)
[ ] Doppler/Infisical production config has all prod secrets
[ ] Arbiscan API key for contract verification
[ ] PINATA_JWT funded для prod IPFS pinning
[ ] Sentry projects created (backend + frontend separately)
[ ] Postgres production instance (managed: Supabase / Neon / Crunchy)
[ ] Backup verified (restore-from-snapshot smoke test)
```

## Step 1. Prepare contracts for mainnet

Mainnet deploy відрізняється від Sepolia:
- **NO TestUSDC** — use canonical Arbitrum One USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- **Deployer** має бути EOA, але одразу transfer-ownership на Safe
- **feeRecipient** = Safe address (не deployer)

Закоментуй TestUSDC deploy крок у [scripts/deploy-contracts.ts](../scripts/deploy-contracts.ts) коли запускаєш з `CHAIN_ID=42161`, або зроби branching в скрипті — це зараз manual step.

## Step 2. Deploy

```bash
# Set env (use Doppler in real prod, .env.local for dry-run only):
export ARBITRUM_ONE_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/<key>
export ARBITRUM_SEPOLIA_RPC_URL=$ARBITRUM_ONE_RPC_URL  # script uses this var name still
export DEPLOYER_PRIVATE_KEY=0x...                       # hot deployer, will hand off to Safe
export STAKE_TOKEN_ADDRESS=0xaf88d065e77c8cC2239327C5EDb3A432268e5831
export MARKET_FACTORY_FEE_BPS=150
export MARKET_FACTORY_FEE_RECIPIENT=<gnosis_safe_address>
export JUDGE_PUBLIC_ADDRESS=<judge_signer_address>
export QUOTE_SIGNER_ADDRESS=<quote_signer_address>
export CHAIN_ID=42161

# Sanity dry-run with simulated tx (modify deploy-contracts.ts if you
# don't already have a --dry-run flag; otherwise just review the script
# inputs above carefully).

pnpm contracts:deploy
```

Result: новий `deployments/42161.json` з реальними addresses + tx hashes.

## Step 3. Verify on Arbiscan

```bash
# Get the source-verified flat for each contract:
forge flatten contracts/src/ParimutuelPool.sol > flat/ParimutuelPool.flat.sol
# ... repeat per contract

# Submit verification:
# https://arbiscan.io/verifyContract
# Compiler: 0.8.26+commit.<hash>
# License: MIT
# Optimization: enabled, 200 runs (match deploy settings)
# Source: paste flat
```

Альтернатива: `npx hardhat verify <address> <constructor-args>` якщо hardhat config.

## Step 4. Transfer ownership на Gnosis Safe

```bash
SAFE_ADDRESS=<safe>           \
DEPLOYER_PRIVATE_KEY=<dep>    \
ARBITRUM_SEPOLIA_RPC_URL=<arbitrum_one_rpc>  \
CHAIN_ID=42161                \
DRY_RUN=1                     \
pnpm tsx scripts/transfer-ownership.ts

# Review output. If OK, run without DRY_RUN.
```

**УВАГА**: для mainnet `BetQuoteVerifier` + `PriceOracle` + `TokenizedStockAdapter`
потребують contract changes (додати `transferOwnership`) — див. [GOVERNANCE.md](GOVERNANCE.md#pre-mainnet-contract-changes).

## Step 5. Wire frontend to mainnet

```bash
# In Doppler production config:
NEXT_PUBLIC_ONCHAIN_CHAIN_ID=42161
NEXT_PUBLIC_ONCHAIN_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/<key>
NEXT_PUBLIC_ONCHAIN_MARKET_FACTORY_ADDRESS=<from deployments/42161.json>
NEXT_PUBLIC_STAKE_TOKEN_ADDRESS=0xaf88d065e77c8cC2239327C5EDb3A432268e5831
NEXT_PUBLIC_AI_JUDGE_VERIFIER_ADDRESS=<from deployments>
NEXT_PUBLIC_PROOF_ANCHOR_ADDRESS=<from deployments>
NEXT_PUBLIC_ARBISCAN_URL=https://arbiscan.io
```

Push to Vercel → it auto-deploys main branch with new env.

Sepolia stays available as opt-in dev — set `NEXT_PUBLIC_ONCHAIN_*` to override
when running locally.

## Step 6. Activate backend services

```bash
# Doppler production now has:
ARBITRUM_SEPOLIA_RPC_URL=<arbitrum_one_rpc>  # variable name historic, value is mainnet
DATABASE_URL=<managed_postgres>
JUDGE_MODE=phala
JUDGE_REMOTE_URL=<phala_cvm_endpoint>
IPFS_PROVIDER=pinata
PINATA_JWT=<jwt>
SENTRY_DSN=<dsn>
NODE_ENV=production

# Validator must pass:
pnpm env:check --profile=production
# expected: "OK: all required keys present"

# Then deploy:
# - Vercel auto-deploys frontend on push to main
# - Backend API: redeploy in Fly / Railway / Render
# - Indexer: redeploy
# - AI Judge: Phala CVM rebuild
```

## Step 7. Smoke test on mainnet

```bash
# Use a small USDC amount (~$10) — test with real money, but tiny.
ARBITRUM_SEPOLIA_RPC_URL=<mainnet_rpc> \
DEPLOYER_PRIVATE_KEY=<small_balance_eoa> \
pnpm e2e:live --chain=42161 --usdc-amount=10
```

Expected: market created → bet placed → judge proposed → finalize → claim
all succeed. Якщо щось fails — pause всі writes (через Safe) і
investigate перш ніж відкривати для public users.

## Step 8. Public announcement

- Update README "Live on Arbitrum One" badge
- Publish [SECURITY.md](../SECURITY.md) PGP key + Immunefi link
- Twitter announcement з audit report
- Discord #announcements
- Add to L2BEAT / DefiLlama listings (optional)

## Rollback / Pause playbook

Якщо в перші 30 днів виявлено P0 vulnerability:

1. **Immediate**: Pause через Safe — `MarketFactory.setPaused(true)` (потребує pre-mainnet contract change від [GOVERNANCE.md](GOVERNANCE.md))
2. **Notify**: Discord + X + email до beta users
3. **Drain support**: open Etherscan-based withdraw для тих, хто хоче exit
4. **Fix + re-audit**: patch + new audit pass на critical paths
5. **Resume**: tx через Safe щоб `setPaused(false)`
6. **Postmortem**: `docs/incidents/2026-MM-DD-pause.md`

## Cost estimate (single-deploy)

| Item | Cost (USD eq) |
|---|---|
| Mainnet gas (10 contracts) | $30-100 |
| Arbiscan verification | free |
| Alchemy dedicated RPC | $50-200/mo |
| Pinata pinning | $20/mo for 1GB |
| Sentry | free tier under 5K errors/mo |
| Postgres (Supabase Pro / Neon Pro) | $25-49/mo |
| Vercel hobby vs Pro | $0-20/mo |
| Audit (S2.A) | $20-80K one-time |

Total monthly infra (excl. audit): **~$100-300/mo**.

## Links

- [audits/](../audits/) — audit reports
- [SECURITY.md](../SECURITY.md) — disclosure policy
- [docs/GOVERNANCE.md](GOVERNANCE.md) — multisig setup
- [docs/SECRETS.md](SECRETS.md) — secret manager flow
- [docs/RUNBOOK.md](RUNBOOK.md) — incident response
- [scripts/deploy-contracts.ts](../scripts/deploy-contracts.ts) — deploy script
- [scripts/transfer-ownership.ts](../scripts/transfer-ownership.ts) — ownership transfer
