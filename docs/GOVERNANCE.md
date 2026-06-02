# Governance — Multisig Ownership Model

Цей doc описує **як PariAI керує адміністративними діями над контрактами**:
хто має право, скільки підписів треба, як виконати upgrade без втрати
ключа.

## Чому Gnosis Safe

EOA-deployer ключ — це один компромет = повна compromission. Multisig
розводить ризик: жоден один підпис не може deploy новий signer / змінити
параметр / pause контракт. Це **стандарт для production Web3 проектів**.

Ми використовуємо [Safe](https://safe.global) (раніше Gnosis Safe) — це
найперевіреніше рішення на Arbitrum, безкоштовний UI, audit-trail в Safe
Transaction Service.

## Threshold + signers

| Stage | Threshold | Signers |
|---|---|---|
| **S1 (Sepolia beta)** | 2 of 3 | Team (Leonid, +2 collaborators / advisors) |
| **S2 (mainnet)** | 3 of 5 | Team (3) + 2 external (audit firm partner, advisor) |
| **S5 (scale)** | 4 of 7 | Team (3) + community delegates (4 elected) |

Кожен signer тримає свій ключ у hardware wallet (Ledger / Trezor).
**Жодного hot-wallet signer-а в multisig.**

## Setup playbook (S1)

```
1. Зайти на https://app.safe.global → Create Safe
2. Network: Arbitrum Sepolia (421614)
3. Add owners: 3 addresses (один з них — поточний deployer EOA)
4. Threshold: 2
5. Deploy Safe — отримати SAFE_ADDRESS
6. Записати SAFE_ADDRESS у deployments/421614.json як `governanceSafe`
7. Зробити transfer ownership:
     SAFE_ADDRESS=0x... \
     DEPLOYER_PRIVATE_KEY=... \
     ARBITRUM_SEPOLIA_RPC_URL=... \
     CHAIN_ID=421614 \
     DRY_RUN=1 \
     pnpm tsx scripts/transfer-ownership.ts
   Перевірити dry-run output → впевнитись що targets правильні
8. Запустити без DRY_RUN — фактичний transfer
9. Перевірити в Arbiscan: owner() кожного контракту = SAFE_ADDRESS
10. Видалити deployer EOA з owners Safe-у (опційно) — після того як
    переконались що Safe працює
```

## Що зараз ownable (Sepolia, станом на S1.C)

| Контракт | Address | Owner pattern | Multisig-ready |
|---|---|---|---|
| **AIJudgeVerifier** | [0xb0d1a133104b93d31bbb3ff6e766d38c7152bcef](https://sepolia.arbiscan.io/address/0xb0d1a133104b93d31bbb3ff6e766d38c7152bcef) | `owner` + `transferOwnership` | ✅ |
| **MarketFactory** | [0xe6c4876e1447ffad3fb5a4e3729d08852154b8f1](https://sepolia.arbiscan.io/address/0xe6c4876e1447ffad3fb5a4e3729d08852154b8f1) | Permissionless (no owner) | N/A |
| **ProofAnchor** | from deployments | Permissionless | N/A |
| **BetQuoteVerifier** | from deployments | Immutable `_quoteSigner` | ❌ (потребує contract change) |
| **ReputationOracle** | [0xc867f72546c27360f05ee93e782d6fbbf2335cf1](https://sepolia.arbiscan.io/address/0xc867f72546c27360f05ee93e782d6fbbf2335cf1) | Self-attest, permissionless | N/A |
| **PriceOracle** | [0xf41055a507e42aa142fe7943aa8a742d9ffcdb9c](https://sepolia.arbiscan.io/address/0xf41055a507e42aa142fe7943aa8a742d9ffcdb9c) | `owner` БЕЗ `transferOwnership` | ❌ (потребує contract change) |
| **TokenizedStockAdapter** | [0x1c90df5f08c87655ee79e6f925d003094708d88e](https://sepolia.arbiscan.io/address/0x1c90df5f08c87655ee79e6f925d003094708d88e) | `owner` БЕЗ `transferOwnership` | ❌ (потребує contract change) |

## Pre-mainnet contract changes

Це **gate** для S2 (Public Release на Arbitrum One). Не deploy на mainnet
доки ці контракти не оновлено:

### 1. `BetQuoteVerifier` — додати rotation
```solidity
address public quoteSigner;
address public owner;

event QuoteSignerRotated(address indexed oldSigner, address indexed newSigner);

constructor(address _quoteSigner, address _owner) {
    require(_quoteSigner != address(0), "signer=0");
    require(_owner != address(0), "owner=0");
    quoteSigner = _quoteSigner;
    owner = _owner;
}

function rotateQuoteSigner(address newSigner) external {
    require(msg.sender == owner, "not owner");
    require(newSigner != address(0), "signer=0");
    emit QuoteSignerRotated(quoteSigner, newSigner);
    quoteSigner = newSigner;
}

function transferOwnership(address newOwner) external {
    require(msg.sender == owner, "not owner");
    require(newOwner != address(0), "owner=0");
    owner = newOwner;
}
```

### 2. `PriceOracle` — додати `transferOwnership`
Зараз є `owner` immutable після constructor. Треба:
```solidity
function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "owner=0");
    owner = newOwner;
}
```

### 3. `TokenizedStockAdapter` — додати `transferOwnership`
Те саме що PriceOracle.

### 4. (опційно) `MarketFactory` — додати pausable
Зараз permissionless. Для mainnet корисно додати emergency pause:
```solidity
bool public paused;
address public owner;

modifier whenNotPaused() {
    require(!paused, "paused");
    _;
}

function setPaused(bool v) external onlyOwner {
    paused = v;
}

function createMarket(...) external whenNotPaused returns (...) { ... }
```

Це **breaks deployments compatibility** — буде окрема пара контрактів на
mainnet (новий MarketFactory), Sepolia залишається старим. Це нормально.

## Daily ops через Safe

### Як виконати owner-action

Приклад: `AIJudgeVerifier.setSigner(newSigner)` через Safe.

```
1. Зайти на app.safe.global → ваш Safe
2. New Transaction → Contract Interaction
3. Address: 0xb0d1...bcef (AIJudgeVerifier)
4. ABI: paste setSigner(address) ABI
5. Parameters: newSigner = 0x...
6. Create — Safe запропонує підписати першому signer-у
7. Інші signers заходять і підписують (поки threshold не досягнуто)
8. Останній signer "Executes" → on-chain tx
```

### Інспекція pending transactions

`https://app.safe.global/transactions/queue?safe=arb1:<SAFE_ADDRESS>` —
показує всі pending, ким підписано, скільки треба ще.

### Аудит-trail

Safe Transaction Service автоматично логує всі executed actions. Для
PariAI runbook-у періодично робити screenshot цього view (раз на місяць)
+ зберігати у `docs/governance-log/YYYY-MM.md` як incident-trail.

## Чого не робити

- Тримати deployer EOA активним після того як Safe — owner. Видалити з
  `.env.production` після ownership transfer.
- Adding signer без quorum-vote всіх existing signers
- Залишати threshold = 1 в production (= EOA по факту)
- Зберігати mnemonic phrase кожного signer-а в одному місці
- Користуватись Safe Browser Extension з deployer-machine — тільки
  hardware wallet flow

## Recovery / lost-key playbook

Якщо одна з 3 ключів втрачено в `2-of-3`:
1. Зайти з 2 збереженими ключами в Safe
2. `Settings → Owners → Remove owner` (втрачений)
3. `Add owner` (новий ключ від відновленого signer-а)
4. Підписати + execute
5. Перевірити Safe owners list

Якщо втрачено 2 з 3 в `2-of-3`: **catastrophic loss** — Safe навічно
заблокований. Тому на S2+ переходимо на 3-of-5: дозволяє втратити 2 з
5 без втрати контролю.

## Посилання

- [Safe app](https://app.safe.global)
- [docs/SECRETS.md](SECRETS.md) — ключове управління
- [docs/RUNBOOK.md](RUNBOOK.md) — incident response
- [scripts/transfer-ownership.ts](../scripts/transfer-ownership.ts) — transfer script
