# Governance — Multisig Ownership Model

This doc describes **how Adjudex manages administrative actions on its contracts**:
who has authority, how many signatures are required, and how to perform
an upgrade without losing a key.

## Why Gnosis Safe

An EOA-deployer key is a single point of compromise = full compromise.
A multisig spreads the risk: no single signature can deploy a new signer,
change a parameter, or pause a contract. This is the **standard for
production Web3 projects**.

We use [Safe](https://safe.global) (formerly Gnosis Safe) — it's the
most battle-tested option on Arbitrum, has a free UI, and provides an
audit trail through the Safe Transaction Service.

## Threshold + signers

| Stage | Threshold | Signers |
|---|---|---|
| **S1 (Sepolia beta)** | 2 of 3 | Team (Leonid + 2 collaborators / advisors) |
| **S2 (mainnet)** | 3 of 5 | Team (3) + 2 external (audit firm partner, advisor) |
| **S5 (scale)** | 4 of 7 | Team (3) + community delegates (4 elected) |

Each signer holds their key in a hardware wallet (Ledger / Trezor).
**No hot-wallet signer in the multisig.**

## Setup playbook (S1)

```
1. Go to https://app.safe.global → Create Safe
2. Network: Arbitrum Sepolia (421614)
3. Add owners: 3 addresses (one of them — the current deployer EOA)
4. Threshold: 2
5. Deploy Safe — obtain SAFE_ADDRESS
6. Record SAFE_ADDRESS in deployments/421614.json as `governanceSafe`
7. Transfer ownership:
     SAFE_ADDRESS=0x... \
     DEPLOYER_PRIVATE_KEY=... \
     ARBITRUM_SEPOLIA_RPC_URL=... \
     CHAIN_ID=421614 \
     DRY_RUN=1 \
     pnpm tsx scripts/transfer-ownership.ts
   Inspect the dry-run output → make sure the targets are correct
8. Run without DRY_RUN — actual transfer
9. Verify on Arbiscan: owner() of each contract = SAFE_ADDRESS
10. Optional: remove the deployer EOA from Safe owners after you've
    verified the Safe works end-to-end
```

## Current ownable surface (Sepolia, as of S1.C)

| Contract | Address | Owner pattern | Multisig-ready |
|---|---|---|---|
| **AIJudgeVerifier** | [0xb0d1a133104b93d31bbb3ff6e766d38c7152bcef](https://sepolia.arbiscan.io/address/0xb0d1a133104b93d31bbb3ff6e766d38c7152bcef) | `owner` + `transferOwnership` | yes |
| **MarketFactory** | [0xe6c4876e1447ffad3fb5a4e3729d08852154b8f1](https://sepolia.arbiscan.io/address/0xe6c4876e1447ffad3fb5a4e3729d08852154b8f1) | Permissionless (no owner) | N/A |
| **ProofAnchor** | from deployments | OpenZeppelin `Ownable` + `transferOwnership` | yes |
| **BetQuoteVerifier** | from deployments | Immutable `_quoteSigner` | no (requires contract change) |
| **ReputationOracle** | [0xc867f72546c27360f05ee93e782d6fbbf2335cf1](https://sepolia.arbiscan.io/address/0xc867f72546c27360f05ee93e782d6fbbf2335cf1) | Self-attest, permissionless | N/A |
| **PriceOracle** | [0xf41055a507e42aa142fe7943aa8a742d9ffcdb9c](https://sepolia.arbiscan.io/address/0xf41055a507e42aa142fe7943aa8a742d9ffcdb9c) | `owner` WITHOUT `transferOwnership` | no (requires contract change) |
| **TokenizedStockAdapter** | [0x1c90df5f08c87655ee79e6f925d003094708d88e](https://sepolia.arbiscan.io/address/0x1c90df5f08c87655ee79e6f925d003094708d88e) | OpenZeppelin `Ownable` + `transferOwnership` | yes |

## Pre-mainnet contract changes

This is a **gate** for S2 (Public Release on Arbitrum One). Do not deploy
to mainnet until these contracts have been updated:

### 1. `BetQuoteVerifier` — add rotation
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

### 2. `PriceOracle` — add `transferOwnership`
Currently `owner` is immutable after constructor. We need:
```solidity
function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "owner=0");
    owner = newOwner;
}
```

### 3. (optional) `MarketFactory` — add pausable
Currently permissionless. For mainnet it's useful to add an emergency
pause:
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

This **breaks deployments compatibility** — there will be a separate
pair of contracts on mainnet (new MarketFactory); Sepolia keeps the old
one. That's fine.

## Daily ops through Safe

### How to execute an owner-action

Example: `AIJudgeVerifier.setSigner(newSigner)` through Safe.

```
1. Go to app.safe.global → your Safe
2. New Transaction → Contract Interaction
3. Address: 0xb0d1...bcef (AIJudgeVerifier)
4. ABI: paste setSigner(address) ABI
5. Parameters: newSigner = 0x...
6. Create — Safe asks the first signer to sign
7. Other signers visit and sign (until threshold is reached)
8. The last signer "Executes" → on-chain tx
```

### Inspecting pending transactions

`https://app.safe.global/transactions/queue?safe=arb1:<SAFE_ADDRESS>` —
shows all pending, who has signed, how many signatures remain.

### Audit trail

The Safe Transaction Service automatically logs every executed action.
For the Adjudex runbook, periodically screenshot this view (monthly) and
save it under `docs/governance-log/YYYY-MM.md` as an incident trail.

## What not to do

- Keep the deployer EOA active after Safe becomes owner. Remove it from
  `.env.production` after the ownership transfer.
- Add a signer without a quorum vote of all existing signers.
- Leave threshold = 1 in production (= EOA in practice).
- Store mnemonics for every signer in one location.
- Use the Safe Browser Extension from the deployer machine — only
  hardware-wallet flow.

## Recovery / lost-key playbook

If one of 3 keys is lost in a `2-of-3`:
1. Log in with the 2 retained keys to Safe.
2. `Settings → Owners → Remove owner` (lost one).
3. `Add owner` (new key for the recovered signer).
4. Sign + execute.
5. Verify the Safe owners list.

If 2 of 3 are lost in `2-of-3`: **catastrophic loss** — Safe is locked
permanently. That's why from S2+ we move to 3-of-5: tolerates losing 2
of 5 without losing control.

## Links

- [Safe app](https://app.safe.global)
- [docs/SECRETS.md](SECRETS.md) — key management
- [docs/RUNBOOK.md](RUNBOOK.md) — incident response
- [scripts/transfer-ownership.ts](../scripts/transfer-ownership.ts) — transfer script
