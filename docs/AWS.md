# AWS Production Blueprint

This project can run on AWS with two App Runner services, RDS Postgres, and a Redis-compatible cache.

## Services

- API service: use `infra/aws/apprunner-api.yaml`, health check `/api/status`.
- Web service: use `infra/aws/apprunner-web.yaml`, health check `/`.
- Ops alarms and audit storage: use `infra/aws/ops-alarms.yaml`.
- Database: RDS Postgres 16+ with SSL required.
- Cache/rate limits: ElastiCache Serverless for Redis or Upstash-compatible Redis REST.
- Secrets: AWS Secrets Manager injected as App Runner environment variables.

## Required Secrets

- `DATABASE_URL`
- `SIWE_DOMAIN`
- `MARKET_FACTORY_ADDRESS`
- `ARBITRUM_SEPOLIA_RPC_URL` or `ALCHEMY_ARBITRUM_SEPOLIA_API_KEY`
- `RHC_MARKET_FACTORY_ADDRESS` plus `RHC_RPC_URL` or `ALCHEMY_RHC_API_KEY`
- `JUDGE_PRIVATE_KEY`
- `MARKET_CREATOR_PRIVATE_KEY`
- `RECLAIM_APP_ID`, `RECLAIM_APP_SECRET`, `RECLAIM_PROVIDER_ID`
- `DUNE_API_KEY`, `DUNE_ADJUDEX_SUMMARY_QUERY_ID`
- `ZERODEV_PROJECT_ID` and paymaster/bundler config when gasless flow is enabled
- `AWS_REGION`
- `RESOLUTION_EVIDENCE_BUCKET`

## Release Checks

1. Run database migrations against RDS before switching traffic.
2. Confirm `/api/status` reports healthy RPC, DB, and indexer rows.
3. Confirm `/integrations` shows configured Dune, GMX, RHC, ZeroDev, and AWS evidence.
4. Keep `MATCH_INGEST_ENABLED=0` until market factory, judge, and creator wallets are verified.
5. Enable App Runner auto deployments only after the first manual deployment passes smoke tests.
6. Publish app metrics into the `Adjudex` CloudWatch namespace for `WebhookFailures`, `ResolutionFailures`, and `RpcLagBlocks`. The API emits these as CloudWatch EMF log lines when `CLOUDWATCH_EMF=1` (App Runner -> CloudWatch Logs auto-extracts them) — set it so the `ops-alarms.yaml` alarms receive data.
7. Export pinned resolution evidence and audit-log snapshots to `RESOLUTION_EVIDENCE_BUCKET`.
