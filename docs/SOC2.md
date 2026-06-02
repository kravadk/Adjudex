# SOC 2 Readiness — Roadmap & Evidence Map

Цей doc описує що потрібно для SOC 2 Type II report — і **коли** його
варто починати. SOC 2 не безкоштовний (15-50K USD/yr + significant
internal ops time), тому ми НЕ робимо його доки enterprise tier не
почав давати $5K+ MRR.

## Гейт — коли починати

Не починати раніше:

| Сигнал | Тригер |
|---|---|
| Enterprise tier ARR | > $30K (enterprise sales bottleneck є compliance) |
| Inbound від procurement | > 2 запити за квартал з vendor security questionnaire |
| Data sensitivity | Зберігаємо PII PHI або обробляємо bank-tier data flow |
| Investor pressure | Series B / pre-IPO діагностика |

Якщо жодне з цього — **SOC 2 пуста витрата**. Краще писати docs/PRIVACY.md
зрозуміло і відповідати ad-hoc.

## Що це таке (стисло)

**SOC 2 Type II** = independent audit що перевіряє: політики +
implementation + докази операційності протягом 6+ місяців. П'ять "Trust
Services Criteria" (TSC):

- **Security** (обов'язковий) — захист системи
- **Availability** — SLA, monitoring
- **Processing Integrity** — accuracy of data
- **Confidentiality** — non-public data protection
- **Privacy** — PII handling

Мінімум: Security TSC. Enterprise клієнти зазвичай вимагають Security +
Availability + Confidentiality. Privacy додаємо коли користувачів > 100K.

## Vendor selection

| Auditor | Price | Pros / Cons |
|---|---|---|
| Drata + small CPA firm | $15-25K/yr | Recommended for first audit. Automation-heavy. |
| Vanta + boutique CPA | $20-35K/yr | Same model, slightly more UI polish |
| Big 4 (Deloitte / EY) | $80-150K+ | Only if Fortune-500 customer demands |
| Self-audited | Don't. | Fails procurement check. |

Recommended: **Drata** (controls automation tool) + a partner CPA firm
that signs the actual report (Drata has a list).

## Evidence map → existing artefacts

Auditor will ask for evidence in 10+ buckets. Map to what we already
have:

| Control area | Where evidence lives |
|---|---|
| Access management | [docs/SECRETS.md](SECRETS.md), [docs/GOVERNANCE.md](GOVERNANCE.md) — multisig + Doppler audit log |
| Vendor risk | [docs/PRIVACY.md](PRIVACY.md) §5 (subprocessor list) |
| Incident response | [docs/RUNBOOK.md](RUNBOOK.md), [docs/ONCALL.md](ONCALL.md) |
| Change management | GitHub PR + CI workflow (`.github/workflows/ci.yml`) |
| Production monitoring | [monitoring/grafana-dashboard.json](../monitoring/grafana-dashboard.json), [services/api/src/metrics.ts](../services/api/src/metrics.ts) |
| Encryption | TLS via Cloudflare, Postgres at-rest via Neon default |
| Backup + recovery | [docs/DATABASE.md](DATABASE.md) §Restore playbook |
| Logging + monitoring | Pino structured logs, Sentry retention 90d |
| Vulnerability management | [SECURITY.md](../SECURITY.md), [audits/](../audits/), Immunefi bounty |
| HR / onboarding | [docs/HIRING.md](HIRING.md) (when team > 3) |
| Risk assessment | TBD — annual risk register doc |
| Data classification | [docs/DATABASE.md](DATABASE.md) §Data classification |
| Geo restrictions | [services/api/src/geo-block.ts](../services/api/src/geo-block.ts), [docs/TERMS.md](TERMS.md) |

## Pre-audit checklist (gaps to close)

- [ ] Annual Risk Register doc (`docs/RISK-REGISTER.md`)
- [ ] Incident response policy formal sign-off (current is operational, not policy)
- [ ] BCP / DR plan documented end-to-end (not just runbook)
- [ ] Code of Conduct + Acceptable Use Policy
- [ ] Employee onboarding/offboarding checklist
- [ ] Access review cadence (quarterly) + log
- [ ] Annual penetration test (third-party, separate from bug bounty)
- [ ] Mandatory security training tracking
- [ ] Cookie + tracking consent log for EU users

## Timeline + cost ranges

| Phase | Time | Cost (USD) |
|---|---|---|
| Type I (snapshot — auditor visits, observes controls) | 1-3 months | $15-25K + Drata $9K/yr |
| Type II observation window | 6-12 months | $0 additional (controls run) |
| Type II report issuance | 2-4 weeks | $10-15K |
| Annual renewal | 12 months | $20-35K |

Total first-year: **$50-75K** including platform. Subsequent years
$30-50K/yr.

## What SOC 2 does NOT cover

- Smart contract security (use [audits/](../audits/) for that)
- Token / regulatory compliance (use [docs/TOKEN-DECISION.md](TOKEN-DECISION.md))
- PCI DSS — only Stripe handles cards, we never see PAN
- HIPAA — irrelevant unless healthcare data involved
- ISO 27001 — separate certification, mostly overlaps SOC 2 but more
  prescriptive; defer until international enterprise demand

## Scale-up version

For Stage 5+ multi-region multi-product play:
- ISO 27001 in addition to SOC 2 Type II
- Privacy TSC addition (Privacy + Confidentiality combined)
- Continuous-control monitoring (Drata/Vanta) + dedicated GRC headcount

## Посилання

- [Drata](https://drata.com) — recommended automation platform
- [Vanta](https://vanta.com) — alternative
- [docs/RUNBOOK.md](RUNBOOK.md)
- [docs/ONCALL.md](ONCALL.md)
- [docs/PRIVACY.md](PRIVACY.md)
- [docs/HIRING.md](HIRING.md)
- [SECURITY.md](../SECURITY.md)
