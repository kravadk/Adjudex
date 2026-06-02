# Secrets — Management & Rotation

Цей doc описує **де живуть секрети PariAI**, **який має право їх читати**,
і **як проводити ротацію** без даунтайму.

> Не комітьте секрети в репо. `.env*`, `deployments/*.json` (приватні
> ключі), `audits/` (поки private) — у `.gitignore`. Будь-який pull
> request, що додає реальний ключ, має бути відхилений.

## Ролі ключів

Кожна роль — **окремий wallet**. Ніколи не використовуйте один ключ для
двох ролей.

| Роль | Env key | Що підписує | Де живе |
|---|---|---|---|
| **Deployer** | `DEPLOYER_PRIVATE_KEY` | Deploy/upgrade контрактів | Hardware wallet → Gnosis Safe (S1.C) |
| **AI Judge signer** | `JUDGE_PRIVATE_KEY` | EIP-191 verdicts | Phala TEE (production) / dev: local |
| **Quote signer** | `QUOTE_SIGNER_PRIVATE_KEY` | EIP-712 bet quotes | Backend secret manager |
| **Proof anchor signer** | `PROOF_ANCHOR_PRIVATE_KEY` | `anchor(cid, sessionId)` calls | Backend secret manager |
| **MM agent** | `MM_AGENT_PRIVATE_KEY` | Counter-balance trades | Окрема machine, hot wallet з малим балансом |
| **Reclaim shared secret** | `RECLAIM_PROOF_WRITE_SECRET` | Auth Next→backend | Backend secret manager |
| **Pinata** | `PINATA_JWT` | Pin requests | Backend secret manager |
| **Anthropic** | `ANTHROPIC_API_KEY` | Claude inference | AI judge only |
| **Sentry DSN** | `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` | Error capture | Public-OK (DSN з обмеженням project quota) |

## Secret manager (рекомендація)

Для S1 → S2 використовувати **Doppler** (cheapest + cleanest CI / Vercel
integration) АБО **Infisical** (open-source, можна self-host). AWS Secrets
Manager — overkill для нашого масштабу.

**Чому не plain .env.local**: коли є 3+ services × 3+ envs (dev/staging/
prod), копіювати .env по machines = неминучий витік. Secret manager дає:
- Audit log (хто читав / змінював)
- Per-service ACL
- Rotation без redeploy (live reload)
- CI integration (token-based pull at build/run time)

## Production flow

```
[Doppler project: pariai]
  ├── config: dev          ← локальна розробка
  ├── config: staging      ← Sepolia
  └── config: production   ← Arbitrum One (mainnet, post-audit)
```

Кожен service в production витягує свій subset:

| Service | Config | Subset (приклади) |
|---|---|---|
| Next (Vercel) | production | `NEXT_PUBLIC_*`, `RECLAIM_PROOF_WRITE_SECRET` |
| API (Fastify) | production | `DATABASE_URL`, `JUDGE_PRIVATE_KEY`, `PINATA_JWT`, `SENTRY_DSN` |
| Indexer | production | `DATABASE_URL`, `INDEXER_RPC_URL`, чітко без signer-ів |
| AI Judge (Phala CVM) | production | `ANTHROPIC_API_KEY`, derived TEE key (не env!) |
| MM Agent | production | `MM_AGENT_PRIVATE_KEY` (hot wallet), `MARKET_FACTORY_ADDRESS` |

## Ротація — playbook

### Планова ротація (раз на 90 днів)

1. **Згенерувати новий ключ** на машині розробника (offline якщо
   можливо): `node -e "console.log(require('viem/accounts').generatePrivateKey())"`
2. **Зареєструвати новий signer на контракті** перш ніж відключити
   старий — це eliminates downtime:
   - `JUDGE`: `AIJudgeVerifier.setSigner(newAddr)` через multisig
   - `QUOTE`: `BetQuoteVerifier.rotateSigner(newAddr)` через multisig
   - `PROOF`: `ProofAnchor.setAuthorized(newAddr, true)` через multisig
3. **Оновити Doppler** — записати новий приватний ключ у production config
4. **Restart services** (Vercel auto-pulls, Fly/Railway: trigger redeploy)
5. **Verify** — пройти `pnpm e2e:live --chain=421614` → новий ключ підписує
6. **Revoke старий**: `setAuthorized(oldAddr, false)` через multisig
7. **Перевірити audit log** Doppler що старий ключ більше ніхто не читає

### Аварійна ротація (suspected compromise)

1. **Immediate**: revoke compromised key on-chain ( `setAuthorized(addr, false)` )
2. **Pause critical actions**: якщо це `JUDGE` — пауза challenge submissions
3. **Forensics**: вибрати з Sentry / RUNBOOK останні 24h tx-events для цього signer-а
4. **Notify users** (Discord #announcements) — про timeline + impact
5. **Регулярна ротація flow** (вище) для нового signer-а
6. **Postmortem** у `docs/incidents/`

## Поточне (Sepolia / dev) — наразі прийнятно

| Item | Зараз | Production target |
|---|---|---|
| Deployer ключ | EOA в `.env.local` | Gnosis Safe (S1.C) + hardware wallet signers |
| AI Judge signer | `JUDGE_MODE=local` дозволений | `JUDGE_MODE=phala`, derived inside CVM |
| Secret storage | `.env.local` файли | Doppler / Infisical |
| Backup | none | Secret manager backup + offline encrypted copy of mnemonic |

## CI integration

`pnpm env:check --profile=production` блокує deploy якщо:
- `JUDGE_MODE=local` (production forbidden)
- `IPFS_PROVIDER=stub` (production forbidden)
- `NEXT_PUBLIC_BACKEND=mock` (production forbidden)
- Будь-який required env відсутній або має неправильний формат

Додати в `.github/workflows/deploy.yml`:
```yaml
- name: Env validation
  run: pnpm env:check --profile=production
  env:
    DOPPLER_TOKEN: ${{ secrets.DOPPLER_PRODUCTION_TOKEN }}
```

## Що ніколи не робити

- Класти приватні ключі в `deployments/*.json` (тільки addresses)
- Хардкодити DSN/API keys в коді (тільки env-gated)
- Логувати full request bodies (можуть містити tokens) — Pino redact list уже покриває стандартні поля, але якщо додаєте новий шейп — додайте path
- Передавати приватні ключі через Slack / email / Discord — тільки secret manager share link або in-person
- Використовувати той же ключ на testnet і mainnet
- Скидати ключі по SSH `cat .env` — використовуйте `doppler run -- ...`

## Посилання

- [docs/RUNBOOK.md](RUNBOOK.md) — incident response, deploy flow
- [docs/GOVERNANCE.md](GOVERNANCE.md) — multisig owner setup (S1.C)
- [scripts/check-env.ts](../scripts/check-env.ts) — production validator
