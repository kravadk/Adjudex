# Frontend Brief

Build UI against the typed service interfaces in `src/lib/services/types.ts`.

All data-bearing views must render real backend or RPC data, or show an explicit configuration/error state when those systems are unavailable. Do not ship bundled markets, wallet balances, portfolio rows, activity rows, leaderboard entries, agent entries, or generated resolution output.

Wallet state must come from the wallet connector. Trading, claims, market creation, and resolution flows must call the configured backend API or chain execution path.
