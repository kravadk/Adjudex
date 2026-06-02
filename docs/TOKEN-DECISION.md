# Token Launch — Decision Framework

> **Default position**: PariAI does NOT launch a token until Stage 5
> exit-criteria are met AND there's a clear product reason. This doc
> exists so the decision is structured, not vibes-driven, when the
> conversation eventually happens.

## Hard prerequisites (all must be true)

If any of these are FALSE, the answer is automatically NO.

| Gate | Condition | How to measure |
|---|---|---|
| Revenue | $50K+ MRR sustained for 3 consecutive months | Stripe + on-chain fee dashboard |
| Audit | All contracts audited + clean for 6+ months on mainnet | audits/ |
| Compliance | Legal opinion from > 2 jurisdictions (US-exposure considered) | Counsel memo |
| Treasury | $500K+ runway WITHOUT token sale proceeds | Bank + multisig balance |
| Tokenomics rigour | Modeled lock-up, vesting, emissions, sink/source — peer-reviewed | Spreadsheet + outside expert |
| Community | DAU / MAU > 25%, paying customer NPS > 30 | Internal analytics |

If any gate fails, **don't even start the design exercise**.

## Why we'd say YES — value-capture rationale

A token only earns its place if it does one of these:

1. **Governance** — meaningful decisions delegated to holders (oracle
   choices, dispute resolution, fee parameters). Risk: governance theatre.
2. **Fee accrual** — token holders get a share of protocol fees (real-yield
   model). Most defensible legally but tightest unit economics.
3. **Coordination** — incentivize hard-to-organize behaviour (liquidity
   provision, market making, judge reputation staking). Concrete utility.
4. **Reputation collateral** — agents post token as bond to operate
   (analog of validator stake). Pairs with ERC-8004 reputation.

If we can't articulate **specifically which of the above we're solving**
in one sentence, we don't ship a token.

## Why we'd say NO

- "Other protocols have one" — irrelevant
- "It'll drive growth" — token launches almost always **lower** retention
  post-airdrop
- "VC said so" — pressure signal, not product signal
- "Marketing event" — burn the marketing budget instead, keep equity clean
- "We need treasury" — raise equity round instead, cheaper long-term

## Structure options (if YES)

### Option A — Non-financial utility token (preferred if at all)

- Token = right to participate as judge / agent
- Stake-to-act + slash-on-misconduct
- No protocol revenue redirected to holders
- Lowest regulatory risk; closest to "labour" model
- Examples to study: KNC v3, Augur REP, UMA voter

### Option B — Fee-accrual governance token

- Token = pro-rata share of protocol fees + governance vote
- Highest legal scrutiny (likely a security in many jurisdictions)
- Requires geo-block expansion + qualified-investor gating
- Examples: SUSHI (xSUSHI), GMX, Curve veCRV

### Option C — Liquidity bootstrap auction → governance

- Lock distribution to active users (not airdrop hunters)
- Phased unlock tied to product KPIs (D30 retention, $X TVL)
- Hardest to design well, highest fairness optics

**Default if forced**: Option A. Closer to ERC-8004 thesis.

## Distribution rules (if YES)

- **No retroactive airdrop to wallet snapshots**. We saw the bot
  problem on Polymarket, Hyperliquid, etc. Distribute to demonstrated
  active participants.
- **No insider FDV > 25%**. Founders + team + investors capped
  collectively at 25% with 4-year linear vest, 1-year cliff.
- **Community / treasury > 40%**. Real treasury, not "marketing wallet".
- **Locked liquidity provision** for at least 12 months post-TGE.

## Anti-token signals

If any of these become true, REVERSE the decision:

- Volume on mainnet collapses > 50% post-TGE (token cannibalising
  product attention)
- Governance proposals are all "increase emissions"
- Founder time spent on tokenomics > 40% of monthly
- Discord topic shifts from product to price
- Regulatory inquiry referencing the token specifically

## Timing — when to even start designing

S5 exit (3 months of $50K MRR + clean audit + 1500+ MAU) → 6-month
design + legal review window → soft launch on testnet (incentive
program) → review again → TGE only if all signals still positive.

**Realistic timeline from this doc to TGE**: 18-24 months MINIMUM
after S5 exit, assuming everything goes well.

## Decision log

| Date | Decision | Owner | Reason |
|---|---|---|---|
| 2026-06-02 | **NO** | Founder | No token launch within S1-S5 roadmap. Roadmap explicitly assumes no token. |

Future entries appended here when the topic gets re-opened.

## Counsel + auditors to engage (when YES decision is firm)

| Domain | Recommended firm |
|---|---|
| Securities law (US/EU) | Latham & Watkins, A&O Shearman, Orrick |
| Tax structuring | KPMG crypto practice, Deloitte digital assets |
| Smart contract audit (token) | Spearbit, Cantina, OpenZeppelin |
| Tokenomics review | Delphi Digital, Chaos Labs |
| Distribution mechanism design | Variant, Paradigm research arms |

Estimate $200-500K total advisory + audit spend for a credible launch.

## Links

- [docs/GOVERNANCE.md](GOVERNANCE.md) — multisig model that any token would inherit
- [docs/SECRETS.md](SECRETS.md) — key custody implications
- [docs/HIRING.md](HIRING.md) — compliance / legal headcount
- [SECURITY.md](../SECURITY.md) — bug bounty structure (token-relevant if launched)
