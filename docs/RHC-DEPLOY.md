# Robinhood Chain (RHC) deployment runbook

Adjudex contracts and indexer are RHC-ready (chain id `46630`, Alchemy
`robinhood-testnet` RPC). This runbook takes RHC from config-ready to live.
Everything here is testnet-only.

## 0. Prerequisites

- A funded **deployer** hot wallet (a little testnet ETH for gas) — separate
  from the judge / market-creator keys.
- An RHC RPC: either `RHC_RPC_URL` or `ALCHEMY_RHC_API_KEY` (Alchemy
  `robinhood-testnet`).

## 1. Dry run (no keys, no funds, no transactions)

Verify the deploy path and that contracts compile for the RHC target:

```bash
DEPLOY_CHAIN=rhc DRY_RUN=1 pnpm contracts:deploy
```

This prints the target chain, deploy order, and bytecode sizes, then exits.
No RPC or private key is required.

## 2. Deploy for real

```bash
ADJUDEX_TESTNET_ONLY=1 \
DEPLOY_CHAIN=rhc \
RHC_RPC_URL=https://robinhood-testnet.g.alchemy.com/v2/<key> \
DEPLOYER_PRIVATE_KEY=0x<funded-deployer-key> \
JUDGE_PUBLIC_ADDRESS=0x<judge-address> \
QUOTE_SIGNER_PUBLIC_ADDRESS=0x<quote-signer-address> \
pnpm contracts:deploy
```

Deploys TestUSDC, AIJudgeVerifier, BetQuoteVerifier, MarketFactory,
ReputationOracle, PriceOracle, TokenizedStockAdapter, and ProofAnchor. The run
writes `deployments/46630.json` and patches `.env.local`.

## 3. Wire the frontend + backend

Copy the deployed addresses into your environment:

- `NEXT_PUBLIC_RHC_MARKET_FACTORY_ADDRESS` / `RHC_MARKET_FACTORY_ADDRESS`
- `NEXT_PUBLIC_RHC_AI_JUDGE_VERIFIER_ADDRESS`
- `NEXT_PUBLIC_STAKE_TOKEN_ADDRESS` (the RHC TestUSDC) as needed
- `NEXT_PUBLIC_RHC_RPC_URL` / `RHC_RPC_URL`, `NEXT_PUBLIC_RHC_CHAIN_ID=46630`

The `/rhc` tab and `/rhc/create` flow read these to target the RHC factory.

## 4. Start the RHC indexer

The indexer is single-chain per process. Run a second instance pointed at RHC:

```bash
INDEXER_ID=rhc-1 \
INDEXER_CHAIN_ID=46630 \
INDEXER_RPC_URL=https://robinhood-testnet.g.alchemy.com/v2/<key> \
RHC_MARKET_FACTORY_ADDRESS=0x<factory> \
pnpm --filter @adjudex/indexer start
```

`/api/status` then reports RHC RPC + indexer health (shown in the system-status
drawer), and `/api/markets?chainId=46630` returns indexed RHC markets.

## 5. Seed RWA markets

In the importer (admin), click **RWA stocks** to generate tokenized-equity and
RWA-volume candidates, confirm the template strikes against live quotes, then
create them on RHC via `/rhc/create`.

## Notes

- Ownership: `MarketFactory`, `ProofAnchor`, and `TokenizedStockAdapter` are
  `Ownable2Step` — after deploy, transfer to the governance Safe with
  `scripts/transfer-ownership.ts` (the Safe must then call `acceptOwnership`).
- Never reuse the deployer key for the judge, quote-signer, or market-creator
  roles. One key per role, gas-only funding.
