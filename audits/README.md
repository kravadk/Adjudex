# Audits

This directory holds **external audit reports for Adjudex smart contracts**
plus internal security-review summaries.

## Status

| Audit | Firm | Scope | Status | Report |
|---|---|---|---|---|
| _planned_ | Cantina / Spearbit / Hats Finance | see below | **Not yet engaged** (S1.D) | — |

**No external audit has been completed yet.** External audit is the gate
for mainnet deploy (Stage 2 maturity roadmap). Until then, all contracts
live only on Arbitrum Sepolia with testnet USDC.

## Engagement plan (S1.D)

### Firm shortlist

1. **Cantina** ([cantina.xyz](https://cantina.xyz))
   - Community-driven, competitive bidding
   - Strong reputation for DeFi audits
   - Price: $20–50K for 2K LoC over 4–6 weeks
2. **Spearbit** ([spearbit.com](https://spearbit.com))
   - Lead-auditor model, individually-named researchers
   - Strong retrospective publications
   - Price: $40–80K
3. **Hats Finance** ([hats.finance](https://hats.finance))
   - Competitive (bug-bounty-style), continuous
   - Pay-on-finding model — economical for smaller projects
4. **Code4rena** ([code4rena.com](https://code4rena.com))
   - Largest pool of wardens; competitive
   - Less depth on single-pair audit but wide coverage
5. **OpenZeppelin** — top tier ($100K+), reserve for post-S2 re-audit

Avoid: **Certik** (low signal, formal "passed" stamp without deep
review).

### Recommended path

Initial audit — **Cantina competitive** ($20–30K, 4 weeks): covers ~80%
of the surface. After remediation — **Spearbit lead-auditor follow-up**
on the most critical contracts (`ParimutuelPool` + `AIJudgeVerifier`,
$15–25K, 2 weeks).

## Scope draft (for submission)

### In scope (~2,000 LoC)

| File | LoC | Notes |
|---|---|---|
| [contracts/src/ParimutuelPool.sol](../contracts/src/ParimutuelPool.sol) | ~450 | **Critical**: holds user funds, claim distribution math |
| [contracts/src/MarketFactory.sol](../contracts/src/MarketFactory.sol) | ~150 | Market creation, oracle binding |
| [contracts/src/AIJudgeVerifier.sol](../contracts/src/AIJudgeVerifier.sol) | ~350 | Verdict signing, 2h challenge window, dispute state machine |
| [contracts/src/BetQuoteVerifier.sol](../contracts/src/BetQuoteVerifier.sol) | ~200 | EIP-712 quote validation, nonce tracking |
| [contracts/src/ProofAnchor.sol](../contracts/src/ProofAnchor.sol) | ~120 | Reclaim zkTLS CID anchor |
| [contracts/src/ReputationOracle.sol](../contracts/src/ReputationOracle.sol) | ~200 | ERC-8004 self-attest registry |
| [contracts/src/PriceOracle.sol](../contracts/src/PriceOracle.sol) | ~180 | Chainlink wrapper + manual override |
| [contracts/src/TokenizedStockAdapter.sol](../contracts/src/TokenizedStockAdapter.sol) | ~140 | Registers TSLA/AAPL synthetic tokens |

### Out of scope

- `TestUSDC.sol`, `TestAggregatorV3.sol` — testnet-only, will not be deployed on mainnet
- Frontend (`src/`) and backend (`services/`) — not contracts; a separate application security review if needed
- Phala TEE attestation flow — separate audit of Phala SDK + dstack
- Reclaim zkTLS protocol — out of scope for our audit (Reclaim has its own audits)

### Topics of particular concern

Flag these specific risk areas to the auditor:

1. **Reentrancy in `ParimutuelPool.claim()`** — user receives USDC; the
   `claimed[user]` shared state must mutate BEFORE transfer.
2. **Signature replay in `BetQuoteVerifier`** — is the per-user nonce
   monotonic, is the domain separator correct (chainId +
   verifyingContract)?
3. **Challenge-window edge cases in `AIJudgeVerifier`** — what if a
   challenge is submitted in the last block before the deadline? What
   if the verdict signature is stale (signed before market open)?
4. **Funds permanently locked** — is there any scenario where
   `refundAfterGrace` can lock funds instead of releasing them?
5. **Integer overflow / precision loss** — pool ratio math in Solidity
   0.8.x (checked by default but can be bypassed via unchecked blocks).
6. **Front-running on `MarketFactory.createMarket`** — can an attacker
   propose a duplicate title before the creator?
7. **Oracle staleness in `PriceOracle`** — how do we handle a Chainlink
   feed that hasn't updated for >1h?

### Out-of-band invariants

Ask the audit firm to verify:
- `stakeYes[user] + stakeNo[user]` ≤ pool total for any user
- After `resolve(outcome)`: sum of claims = total pool - fee (once fee
  lands in S1.E — currently 0)
- `challenge()` after deadline reverts
- `finalize()` without a proposed verdict reverts

## Workflow after engagement

1. The audit firm receives a commit hash (frozen for review).
2. Report lands here — `audits/YYYY-MM-firmname-adjudex-v1.pdf`.
3. Findings tracked in `audits/YYYY-MM-firmname-findings.md`.
4. Each finding gets a remediation commit with a cross-reference
   `Refs: audits/...-finding-N` in the commit message.
5. The audit firm does a short follow-up on the patch hashes.
6. Final hash → mainnet deploy permission unlocked (S2.A gate).

## What we do ourselves (internal review)

- Compile + slither: `pnpm contracts:compile`
- Echidna fuzzing (TBD in S1.D — add harness)
- Mythril analysis (TBD)
- Foundry differential tests vs a Python math reference (for pool ratio)

This **does not replace** external audit but catches trivial bugs before
external review (cheaper).

## Further reading

- [SECURITY.md](../SECURITY.md) — disclosure policy
- [docs/GOVERNANCE.md](../docs/GOVERNANCE.md) — multisig flow
- [docs/RUNBOOK.md](../docs/RUNBOOK.md) — incident response
