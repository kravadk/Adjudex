# Security Policy

PariAI is a parimutuel prediction-market dApp on Arbitrum. This document
explains how to report vulnerabilities, what is in scope, and what our
disclosure timeline looks like.

## Supported versions

| Component | Status | Notes |
|---|---|---|
| Smart contracts on Arbitrum Sepolia | **Active** | See [deployments/421614.json](deployments/421614.json) |
| Smart contracts on Arbitrum One (mainnet) | **Not yet deployed** | Audit-gated (S2). See [docs/GOVERNANCE.md](docs/GOVERNANCE.md). |
| Backend API (`services/api`) | **Active** | Latest commit on `main` |
| Indexer (`services/indexer`) | **Active** | Latest commit on `main` |
| AI Judge worker (`services/ai-judge`) | **Active** | Phala TEE in production |
| Frontend (Next.js app in `src/`) | **Active** | Latest commit on `main` |

Only the latest commit on `main` receives security fixes. Forks /
self-hosters are responsible for back-porting.

## Reporting a vulnerability

**Do not file a public GitHub issue for security reports.**

Send a private report via one of these channels (in order of preference):

1. **Immunefi** — once our bug bounty is live (S1.D), report at
   `https://immunefi.com/bounty/pariai` (link will be published here)
2. **Encrypted email** — `security@pariai.xyz` (PGP key fingerprint:
   _TBD before mainnet, will be published here and on the website_)
3. **DM on X** — [@pariai_xyz](https://x.com/pariai_xyz) for initial
   contact only; we will move to encrypted email for details

Include:
- Affected component (contract name + address / file + commit hash)
- Vulnerability class (e.g. reentrancy, signature replay, oracle manipulation)
- Proof of concept / reproduction steps
- Suggested mitigation if known
- Your preferred name / handle for credit
- Whether you want a public CVE assigned

We will acknowledge within **48 hours** and provide an initial assessment
within **7 days**.

## Scope

### In scope

**Smart contracts** (currently deployed on Arbitrum Sepolia):
- [contracts/src/ParimutuelPool.sol](contracts/src/ParimutuelPool.sol)
- [contracts/src/MarketFactory.sol](contracts/src/MarketFactory.sol)
- [contracts/src/AIJudgeVerifier.sol](contracts/src/AIJudgeVerifier.sol)
- [contracts/src/BetQuoteVerifier.sol](contracts/src/BetQuoteVerifier.sol)
- [contracts/src/ProofAnchor.sol](contracts/src/ProofAnchor.sol)
- [contracts/src/ReputationOracle.sol](contracts/src/ReputationOracle.sol)
- [contracts/src/PriceOracle.sol](contracts/src/PriceOracle.sol)
- [contracts/src/TokenizedStockAdapter.sol](contracts/src/TokenizedStockAdapter.sol)

**Backend**:
- Any endpoint under `services/api/src/` that mutates state, validates
  signatures, or reads user-controlled input
- `services/ai-judge/` signer mechanism
- `services/indexer/` reorg handling and DB writes

**Frontend**:
- SIWE authentication flow
- Transaction signing UX (incorrect-chain warnings, approval-amount
  display)
- Anything in `src/lib/services/` that handles money values

### Severity classes (Immunefi-aligned)

| Class | Examples | Reward range |
|---|---|---|
| **Critical** | Direct theft of user funds; permanent freeze of contract; AI judge forgery; signature replay across markets | $25K–$100K (mainnet), $1K (testnet) |
| **High** | Temporary freeze; griefing that costs users gas; rate-limit bypass causing real cost | $5K–$25K, $500 testnet |
| **Medium** | Information disclosure of non-PII; minor invariant break | $500–$5K, $100 testnet |
| **Low** | Best practices, code quality | Acknowledgement only |
| **Informational** | Documentation, dependency hygiene | Acknowledgement only |

Exact reward sizes will be confirmed once mainnet is live and the
Immunefi program is funded. Testnet rewards are paid in USDC from team
funds.

### Out of scope

- Social engineering / phishing of team members
- Physical attacks
- DoS against RPC providers we don't control
- Issues in third-party dependencies (report upstream — we will track
  CVEs but cannot pay duplicate rewards)
- Already-known issues documented in `audits/`
- Anything that requires owner / signer key compromise (multisig
  governance is documented in [docs/GOVERNANCE.md](docs/GOVERNANCE.md))
- AI judge **policy** disagreements (e.g. "the AI ruled wrong") — these
  are resolution mechanism issues, use the 2-hour on-chain challenge
  window. Only **forgery / signature manipulation** is in scope.

## Disclosure timeline

Default: **90 days** from initial report to public disclosure, OR
date-of-patch + 30 days, whichever is sooner.

| Day | Action |
|---|---|
| 0 | Report received, acknowledged within 48h |
| 0–7 | Triage, severity assignment, reproducer confirmed |
| 7–30 | Fix developed, internal review |
| 30–60 | Coordinated rollout (multisig tx, frontend deploy) |
| 60–90 | Re-audit of fix (paid out of remediation budget) |
| 90+ | Public disclosure, CVE assignment if requested, payout |

Critical bugs accelerate this timeline — patch first, disclose after
multisig executes the fix.

## Audit history

See [audits/README.md](audits/README.md) for the index of completed
audits and their findings.

**Status** (as of S1):
- No external audit has been completed yet
- Internal review of `AIJudgeVerifier` V2 challenge window is in
  the codebase as inline comments
- External audit is planned with Cantina / Spearbit / Hats Finance
  before mainnet (S2.A gate)

## Safe harbour

If you act in good faith, follow this policy, and do not exploit a
vulnerability for personal gain beyond a bug bounty reward, **we will
not pursue legal action against you**. Specifically:

- Do not exfiltrate user data or funds beyond what is necessary to
  prove the vulnerability
- Stop probing as soon as you have a reproducer
- Do not disclose the vulnerability before our coordinated timeline
- Do not test on mainnet contracts after they're live — use Sepolia
  forks or our staging deploy

If your report includes evidence of **active exploitation by a third
party**, contact us immediately via DM on X for the fastest response.

## Credits

Researchers who report valid bugs are credited in:
- This file (post-disclosure)
- [audits/](audits/) directory for the patch commit
- Optional: public X shout-out (we'll ask first)

---

Last updated: 2026-06-01 (S1.D). Will be re-issued at mainnet launch
with the published PGP key and Immunefi program link.
