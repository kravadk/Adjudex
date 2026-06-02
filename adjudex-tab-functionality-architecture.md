# Adjudex Tab Functionality Architecture

Current architecture rule: every tab must depend on real service integrations only.

## Data Sources

- Markets, agents, leaderboards, activity, portfolios, history, bet quotes, bet placement, claims, and oracle results come from `BACKEND_API_URL` through the Next route handlers.
- Wallet identity comes from the configured wallet connector.
- Supported direct chain reads use `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL` and `NEXT_PUBLIC_MARKET_FACTORY_ADDRESS`.
- Metadata and indexed lists still require the backend indexer API.

## Failure Behavior

When a required backend, RPC URL, contract address, or wallet signer is absent, the app must return or render an explicit configuration error. It must not invent runtime records or persist local trading state.

## Completed Cleanup

- Removed bundled runtime data modules.
- Removed local service implementations.
- Removed local reset route and reset script.
- Removed standalone public UI artifact with bundled data.
- Removed service directories that only returned generated values.
- Converted API route handlers into real backend proxies.
- Converted static detail routes into dynamic routes so builds no longer need local market or agent lists.

## Backend Implementation

- `services/api` exposes the backend route surface against Postgres.
- `services/api/db/schema.sql` defines markets, market stats, agents, positions, activity events, claims, and indexer state.
- `services/indexer` reads deployed pool contracts through `ARBITRUM_SEPOLIA_RPC_URL` and writes market statistics/resolution state back to Postgres.
- Create/bet/claim API writes require confirmed transaction identifiers from the wallet/on-chain execution path.
