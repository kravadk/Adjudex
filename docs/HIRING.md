# Hiring — Stage 4 to Stage 5

This is an **operational doc**, not a job description. It covers:
**when** to hire, **whom** to hire, in what **order**, and what
**signals** mean the team is too small / too big for the current stage.

## When to hire — gates

Don't hire anyone until the exit-criteria of the previous stage are
closed (see the maturity roadmap in `.planning/`).

| Stage | MRR / volume tripwire | Hire ratio |
|---|---|---|
| S2 (Public release) | up to $1K MRR | Founder-only, 2-3 people total |
| S3 (Product) | $1–5K MRR | + 1 contractor (growth / community) |
| S4 (Business) | $5–25K MRR | + 1 senior engineer (security/contracts) |
| S4 late | $25–50K MRR | + 1 SRE / DevOps |
| S5 (Scale) | $50K+ MRR | 8–15 team, functional split |

**Hard rule**: do not hire a full-time engineer until the founder has
gone a month where they **did not touch code for 5 working days in a
row** because of process overhead. If the founder is still in the code
all day, the company is still in solo mode and a hire = split attention.

## Hire #1 — Senior Solidity / Security Engineer (S4)

**Hiring signal**: a PR with changes to `contracts/src/*.sol` lands more
than once per quarter. The founder no longer has bandwidth for internal
code review before each external audit.

**Profile**:
- 3+ years of production Solidity (DeFi, prediction markets, lending)
- Foundry + Hardhat fluent
- Audited at least one mainnet protocol with commit access
- Comfortable with MEV, oracle attacks, signature replay

**Do not hire**: bootcamp graduate, Web2 engineer "learning Solidity",
consultant working in parallel on > 2 projects.

**Compensation guidance** (as of 2026, EU/UA market):
- Base: $100–180K/yr
- Equity: 0.5–2% (4-year vest, 1-year cliff)
- Sign-on if leaving a senior IC role: $10–25K

## Hire #2 — Growth / Community Manager (S4 late)

**Hiring signal**: Discord crosses 500 active users, Twitter > 2K
followers, support questions > 5/day, founder spending > 5h/week on
community ops.

**Profile**:
- Operated Discord / X for a Web3 product (not Web2 SaaS — community
  expects crypto-native vocabulary)
- Wrote 10+ launch threads or content pieces that drove signups
- Comfortable with analytics tools (Mixpanel / PostHog), copy A/B testing

**Do not hire**: someone who only ran paid ads, agency person without
direct-DM experience, anyone who calls community "users" instead of
"degens" / "traders".

**Compensation**: $60–100K + 0.25–0.75% equity. **Pay a performance
bonus** tied to D30 retention or paid-conversion delta, not raw growth.

## Hire #3 — SRE / DevOps (S5 early)

**Hiring signal**: pager > 2× per week, indexer restart > 1× per week,
deploy pipeline takes > 30 min, infra cost > 25% of revenue.

**Profile**:
- Ran production multi-region Postgres at scale (Neon, Crunchy, RDS)
- Comfortable with Cloudflare / Vercel / Fly platform engineering
- Prometheus + Grafana + Alertmanager fluent
- Bonus: Solidity indexer ops (subgraph / custom) experience

**Do not hire**: someone who only did managed-K8s (we're not K8s-heavy
yet), Web2 backend engineer without Web3 RPC pain.

**Compensation**: $130–200K + 0.5–1% equity.

## Hire #4 — Strategic Partnerships / BizDev (S5 mid)

**Hiring signal**: enterprise inbound > 1/month, esports team partnership
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
- Refresh grants at 2-year mark for retained ICs (0.25–0.5%)
- Pre-Series-A: equity stash 15–20% of fully-diluted; protect future hires
- Tax: provide 83(b) election help for US contractors, EE tax structuring for EU

## Anti-patterns

- Hiring "10 engineers" at once — recipe for chaos
- Senior eng without a code-ownership area — creates ambiguity
- "VP of Engineering" before 5 ICs — premature
- Hiring a CTO instead of promoting from team — rarely works in Web3
- Hiring growth before product retention is proven — leaky bucket

## Performance + departure

- 30-60-90 review framework for new hires
- IC reviews each quarter
- Underperformer: 2 cycles to course-correct → PIP → exit
- Founder rule: if you've been thinking "should I let X go" for > 2 weeks, the answer is yes

## Scale-up phase (S5+)

Beyond ~15 people, hire a recruiting partner / firm for top-of-funnel.
Cost: 20–25% of first-year salary, but worth it for engineering quality.

## Links

- [docs/RUNBOOK.md](RUNBOOK.md) — operational state
- [docs/ONCALL.md](ONCALL.md) — rotation that hire #3 inherits
- [docs/TOKEN-DECISION.md](TOKEN-DECISION.md) — gate for legal/finance hires
- [docs/SOC2.md](SOC2.md) — when a compliance hire becomes mandatory
