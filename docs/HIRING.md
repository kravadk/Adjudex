# Hiring — Stage 4 to Stage 5

Це **operational doc**, не job description. Описує: **коли** наймати,
**кого** наймати, в якому **порядку**, і **які сигнали** означають що
команда занадто маленька / занадто велика для поточного етапу.

## Когда наймати — гейти

Нічого не наймати, поки exit-criteria попереднього stage не закриті
(див. maturity roadmap у .planning/).

| Stage | MRR / volume tripwire | Hire ratio |
|---|---|---|
| S2 (Public release) | до $1K MRR | Founder-only, 2-3 people total |
| S3 (Product) | $1-5K MRR | + 1 contractor (growth / community) |
| S4 (Business) | $5-25K MRR | + 1 senior engineer (security/contracts) |
| S4 late | $25-50K MRR | + 1 SRE / DevOps |
| S5 (Scale) | $50K+ MRR | 8-15 team, functional split |

**Hard rule**: не наймати full-time engineer-а доки founder не пройде
місяць коли він **не торкався коду 5 робочих днів поспіль** через
process-overhead. Якщо founder досі весь час пише код — компанія ще
solo-mode, hire = розкид уваги.

## Hire #1 — Senior Solidity / Security Engineer (S4)

**Сигнал найму**: pull request зі змінами до `contracts/src/*.sol`
з'являється > 1 раз на квартал. Founder не встигає робити internal
code-review до кожного external audit.

**Profile**:
- 3+ роки production Solidity (DeFi, prediction markets, lending)
- Foundry + Hardhat fluent
- Audited at least one mainnet protocol з commit access
- Comfortable з MEV, oracle attacks, signature replay

**Не наймати**: bootcamp graduate, Web2 engineer що "learning Solidity",
консультант що працює paralelno на > 2 проекти.

**Compensation guidance** (станом на 2026, EU/UA market):
- Base: $100-180K/yr
- Equity: 0.5-2% (4-year vest, 1-year cliff)
- Sign-on if leaving senior IC role: $10-25K

## Hire #2 — Growth / Community Manager (S4 late)

**Сигнал найму**: Discord перетинає 500 active users, Twitter > 2K
followers, support questions > 5/day, founder проводить > 5h/week на
community ops.

**Profile**:
- Operated Discord / X для Web3 product (not Web2 SaaS — community
  expects crypto-native vocabulary)
- Wrote 10+ launch threads or content pieces that drove signups
- Comfortable з analytics tools (Mixpanel / PostHog), copy A/B testing

**Не наймати**: someone who only did paid ads, agency person without
direct-DM experience, anyone who calls community "users" instead of
"degens" / "traders".

**Compensation**: $60-100K + 0.25-0.75% equity. **Pay performance
bonus** tied to D30 retention or paid-conversion delta, not raw growth.

## Hire #3 — SRE / DevOps (S5 early)

**Сигнал найму**: pager > 2× per week, indexer restart > 1× per week,
deploy pipeline takes > 30 min, infra cost > 25% of revenue.

**Profile**:
- Ran production multi-region Postgres at scale (Neon, Crunchy, RDS)
- Comfortable з Cloudflare / Vercel / Fly platform engineering
- Prometheus + Grafana + Alertmanager fluent
- Bonus: Solidity indexer ops (subgraph / custom) experience

**Не наймати**: someone who only did managed-K8s (we're not K8s-heavy
yet), Web2 backend engineer без Web3 RPC pain.

**Compensation**: $130-200K + 0.5-1% equity.

## Hire #4 — Strategic Partnerships / BizDev (S5 mid)

**Сигнал найму**: enterprise inbound > 1/month, esports team partnership
inquiries > 2/month, founder spending > 10h/week on sales calls.

**Profile**: ex-DraftKings BD, Polymarket / Manifold partnerships, or
agency selling to esports teams.

## Hire #5+ — Functional split

| Function | When |
|---|---|
| Frontend engineer | When `src/components/` has > 100 files and 1 senior eng can't review all PRs |
| Backend engineer | When [services/api](../services/api/) hits 50+ routes |
| Designer / IC | When founder stops shipping UI for 2 sprints |
| Customer success | When > 10 enterprise customers |
| Compliance / legal counsel | When jurisdictions > 3 OR token decision = YES |

## Equity policy

- 4-year vest, 1-year cliff
- Acceleration: single-trigger 50% on involuntary termination, double-trigger 100% on acquisition
- Refresh grants at 2-year mark for retained ICs (0.25-0.5%)
- Pre-Series-A: equity stash 15-20% of fully-diluted; protect future hires
- Tax: provide 83(b) election help for US contractors, EE tax structuring for EU

## Anti-patterns

- Naimaty "10 engineers" одночасно — recipe для chaos
- Senior eng без code-ownership area — створює ambiguity
- "VP of Engineering" перед 5 ICs — premature
- Hiring CTO замість promoting from team — рідко працює у Web3
- Hiring growth person before product-retention доказана — leaky bucket

## Performance + departure

- 30-60-90 review framework для нових hires
- IC reviews each quarter
- Underperformer: 2 cycles to course-correct → PIP → exit
- Founder rule: якщо thinking "should I let X go" > 2 weeks, answer is yes

## Scale-up phase (S5+)

Beyond ~15 people, hire a recruiting partner / firm для top-of-funnel.
Cost: 20-25% of first-year salary, but worth it for engineering quality.

## Посилання

- [docs/RUNBOOK.md](RUNBOOK.md) — operational state
- [docs/ONCALL.md](ONCALL.md) — rotation that hire #3 inherits
- [docs/TOKEN-DECISION.md](TOKEN-DECISION.md) — gate for legal/finance hires
- [docs/SOC2.md](SOC2.md) — when compliance hire becomes mandatory
