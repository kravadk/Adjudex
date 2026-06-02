# Audits

Цей каталог містить **звіти зовнішніх аудитів смарт-контрактів PariAI**
та зведення внутрішніх security reviews.

## Status

| Audit | Firm | Scope | Status | Report |
|---|---|---|---|---|
| _planned_ | Cantina / Spearbit / Hats Finance | див. нижче | **Not yet engaged** (S1.D) | — |

**Жодного зовнішнього аудиту ще не завершено.** Зовнішній аудит — gate
для mainnet deploy (Stage 2 maturity roadmap-у). До цього всі контракти
живуть тільки на Arbitrum Sepolia з testnet-USDC.

## Engagement plan (S1.D)

### Шорт-ліст firms

1. **Cantina** ([cantina.xyz](https://cantina.xyz))
   - Community-driven, competitive bidding
   - Сильна репутація на DeFi audits
   - Ціна: $20-50K на 2K LoC за 4-6 тижнів
2. **Spearbit** ([spearbit.com](https://spearbit.com))
   - Lead-auditor model, individually-named researchers
   - Хороші retrospective publications
   - Ціна: $40-80K
3. **Hats Finance** ([hats.finance](https://hats.finance))
   - Competitive (bug-bounty-style), continuous
   - Pay-on-finding model — economical для невеликих проектів
4. **Code4rena** ([code4rena.com](https://code4rena.com))
   - Найбільший pool wardens; competitive
   - Менша глибина на single-pair audit, але широке покриття
5. **OpenZeppelin** — top tier ($100K+), залишити для post-S2 re-audit

Уникати: **Certik** (low signal, формальний "passed" штамп без deep
review).

### Recommended path

Стартовий аудит — **Cantina competitive** ($20-30K, 4 тижні): покриває
80% поверхні. Після remediation — **Spearbit lead-auditor follow-up** на
найкритичніших контрактах (`ParimutuelPool` + `AIJudgeVerifier`,
$15-25K, 2 тижні).

## Scope draft (для submission)

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

- `TestUSDC.sol`, `TestAggregatorV3.sol` — testnet-only, не buduть deploy на mainnet
- Frontend (`src/`) і backend (`services/`) — не контракти; окреме application security review якщо буде
- Phala TEE attestation flow — окремий audit Phala SDK + dstack
- Reclaim zkTLS protocol — out of scope для нашого аудиту (Reclaim має власні audits)

### Topics of particular concern

Вкажемо аудитору ці specific risk areas:

1. **Reentrancy в `ParimutuelPool.claim()`** — користувач отримує USDC,
   shared state на `claimed[user]` має mutate ДО transfer
2. **Signature replay в `BetQuoteVerifier`** — чи nonce монотонний per
   user, чи domain separator коректний (chainId + verifyingContract)
3. **Challenge window edge-cases в `AIJudgeVerifier`** — що якщо
   challenge поданий в останній block перед deadline? Що якщо
   verdict-signature stale (signed before market open)?
4. **Funds locked permanentno** — чи є scenario де `refundAfterGrace`
   може заблокувати, не звільнити кошти?
5. **Integer overflow / precision loss** — pool ratio math в Solidity
   0.8.x (default checked, але можна обійти через unchecked blocks)
6. **Front-running на `MarketFactory.createMarket`** — чи може attacker
   запропонувати дублікат title раніше creator-а?
7. **Oracle staleness в `PriceOracle`** — як обробляється Chainlink feed
   що не оновлювався >1h?

### Out-of-band invariants

Audit-firm запросити перевірити:
- Сума `stakeYes[user] + stakeNo[user]` ≤ pool total для будь-якого user
- Після `resolve(outcome)`: sum claims = total pool - fee (коли fee
  буде implemented у S1.E — поки 0)
- `challenge()` після deadline reverts
- `finalize()` без proposed verdict reverts

## Workflow після engagement

1. Audit firm отримує commit hash (frozen для перевірки)
2. Звіт сюди — `audits/YYYY-MM-firmname-pariai-v1.pdf`
3. Findings tracked у `audits/YYYY-MM-firmname-findings.md`
4. Кожен finding отримує remediation commit з cross-reference у
   `Refs: audits/...-finding-N` повідомленні комміта
5. Re-audit firmname робить short follow-up на patch hashes
6. Final hash → mainnet deploy permission unlock (S2.A gate)

## Чого ми робимо самі (internal review)

- Compile + slither: `pnpm contracts:compile`
- Echidna fuzzing (TBD у S1.D — добавити harness)
- Mythril analysis (TBD)
- Foundry differential test проти math reference у Python (для pool ratio)

Це **не замінює** зовнішній аудит, але виловлює тривіальні баги перед
зовнішнім ревью (cheaper).

## Сторінки далі

- [SECURITY.md](../SECURITY.md) — disclosure policy
- [docs/GOVERNANCE.md](../docs/GOVERNANCE.md) — multisig flow
- [docs/RUNBOOK.md](../docs/RUNBOOK.md) — incident response
