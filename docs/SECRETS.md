# Secrets — Management & Rotation

This doc describes **where Adjudex secrets live**, **who is allowed to
read them**, and **how to rotate them** without downtime.

> Do not commit secrets to the repo. `.env*`, `deployments/*.json`
> (private keys), and `audits/` (while private) are in `.gitignore`. Any
> pull request that adds a real key must be rejected.

## Key roles

Each role is a **separate wallet**. Never reuse one key for two roles.

| Role | Env key | What it signs | Where it lives |
|---|---|---|---|
| **Deployer** | `DEPLOYER_PRIVATE_KEY` | Deploy/upgrade contracts | Hardware wallet → Gnosis Safe (S1.C) |
| **AI Judge signer** | `JUDGE_PRIVATE_KEY` | EIP-191 verdicts | Phala TEE (production) / dev: local |
| **Quote signer** | `QUOTE_SIGNER_PRIVATE_KEY` | EIP-712 bet quotes | Backend secret manager |
| **Proof anchor signer** | `PROOF_ANCHOR_PRIVATE_KEY` | `anchor(cid, sessionId)` calls | Backend secret manager |
| **MM agent** | `MM_AGENT_PRIVATE_KEY` | Counter-balance trades | Separate machine, hot wallet with small balance |
| **Market creator** | `MARKET_CREATOR_PRIVATE_KEY` | Auto-ingest `createSoftMarket` + `propose`/`finalize` txs | Backend secret manager; separate hot wallet, gas-only balance, rotatable |
| **PandaScore** | `PANDASCORE_TOKEN` | — (read-only feed) | Backend secret manager; CS2/Dota2 schedules + results |
| **football-data** | `FOOTBALL_DATA_TOKEN` | — (read-only feed) | Backend secret manager; football fixtures + results |
| **Reclaim shared secret** | `RECLAIM_PROOF_WRITE_SECRET` | Auth Next→backend | Backend secret manager |
| **Pinata** | `PINATA_JWT` | Pin requests | Backend secret manager |
| **Anthropic** | `ANTHROPIC_API_KEY` | Claude inference | AI judge only |
| **Sentry DSN** | `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` | Error capture | Public-OK (DSN with project-quota limits) |

## Secret manager (recommendation)

For S1 → S2 use **Doppler** (cheapest + cleanest CI / Vercel integration)
OR **Infisical** (open-source, self-hostable). AWS Secrets Manager is
overkill for our scale.

**Why not plain .env.local**: with 3+ services × 3+ envs (dev/staging/
prod), copying `.env` between machines = an inevitable leak. A secret
manager provides:
- Audit log (who read / changed)
- Per-service ACL
- Rotation without redeploy (live reload)
- CI integration (token-based pull at build/run time)

## Production flow

```
[Doppler project: adjudex]
  |-- config: dev          <- local development
  |-- config: staging      <- Sepolia
  |__ config: production   <- Arbitrum One (mainnet, post-audit)
```

Each service in production pulls its subset:

| Service | Config | Subset (examples) |
|---|---|---|
| Next (Vercel) | production | `NEXT_PUBLIC_*`, `RECLAIM_PROOF_WRITE_SECRET` |
| API (Fastify) | production | `DATABASE_URL`, `JUDGE_PRIVATE_KEY`, `IPFS_PROVIDER` + matching IPFS credential, `SENTRY_DSN` |
| Indexer | production | `DATABASE_URL`, `INDEXER_RPC_URL`, explicitly no signer keys |
| AI Judge (Phala CVM) | production | `ANTHROPIC_API_KEY`, derived TEE key (not env!) |
| MM Agent | production | `MM_AGENT_PRIVATE_KEY` (hot wallet), `MARKET_FACTORY_ADDRESS` |

## Rotation — playbook

### Scheduled rotation (every 90 days)

1. **Generate a new key** on the developer machine (offline if possible):
   `node -e "console.log(require('viem/accounts').generatePrivateKey())"`
2. **Register the new signer on-chain BEFORE disabling the old one** —
   this eliminates downtime:
   - `JUDGE`: `AIJudgeVerifier.setSigner(newAddr)` via multisig
   - `QUOTE`: `BetQuoteVerifier.rotateSigner(newAddr)` via multisig
   - `PROOF`: `ProofAnchor.setAuthorized(newAddr, true)` via multisig
3. **Update Doppler** — write the new private key to the production config
4. **Restart services** (Vercel auto-pulls; Fly/Railway: trigger redeploy)
5. **Verify** — run `pnpm e2e:live --chain=421614` → new key signs successfully
6. **Revoke the old**: `setAuthorized(oldAddr, false)` via multisig
7. **Inspect Doppler audit log** to confirm the old key is no longer read

### Emergency rotation (suspected compromise)

1. **Immediate**: revoke the compromised key on-chain (`setAuthorized(addr, false)`)
2. **Pause critical actions**: if it's the `JUDGE` key — pause challenge submissions
3. **Forensics**: collect the last 24h of tx events for that signer from Sentry / RUNBOOK
4. **Notify users** (Discord #announcements) — timeline + impact
5. **Run the regular rotation flow** (above) for the new signer
6. **Postmortem** in `docs/incidents/`

## Current (Sepolia / dev) — acceptable for now

| Item | Today | Production target |
|---|---|---|
| Deployer key | EOA in `.env.local` | Gnosis Safe (S1.C) + hardware wallet signers |
| AI Judge signer | `JUDGE_MODE=local` allowed | `JUDGE_MODE=phala`, derived inside CVM |
| Secret storage | `.env.local` files | Doppler / Infisical |
| Backup | none | Secret manager backup + offline encrypted copy of mnemonic |

## CI integration

`pnpm env:check --profile=production` blocks deploy if:
- `JUDGE_MODE=local` (forbidden in production)
- `MATCH_FIXTURE_MODE=1` (runtime fixture feeds are not supported)
- Any required env var is missing or malformed

Add to `.github/workflows/deploy.yml`:
```yaml
- name: Env validation
  run: pnpm env:check --profile=production
  env:
    DOPPLER_TOKEN: ${{ secrets.DOPPLER_PRODUCTION_TOKEN }}
```

## Things never to do

- Put private keys into `deployments/*.json` (addresses only).
- Hardcode DSN / API keys in code (env-gated only).
- Log full request bodies (may contain tokens) — the Pino redact list
  already covers the standard fields, but if you add a new shape, extend
  the redact paths.
- Pass private keys via Slack / email / Discord — only secret manager
  share link or in-person.
- Use the same key on testnet and mainnet.
- Dump keys via SSH `cat .env` — use `doppler run -- ...` instead.

## Links

- [docs/RUNBOOK.md](RUNBOOK.md) — incident response, deploy flow
- [docs/GOVERNANCE.md](GOVERNANCE.md) — multisig owner setup (S1.C)
- [scripts/check-env.ts](../scripts/check-env.ts) — production validator
