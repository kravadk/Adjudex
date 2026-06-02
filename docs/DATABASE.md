# Database — Managed Postgres, Migrations, Backups

## Production provider — recommendation

| Provider | Pros | Cons | Pick? |
|---|---|---|---|
| **Neon** | Serverless branching (great for staging snapshots), 30-day PITR, generous free tier | Cold-starts on free tier; some viem connection patterns need pooler | **Recommended for S2** |
| Supabase | Generous free tier, integrated auth (not needed for us), realtime | Tight coupling to their SDK; we use plain pg | OK alternative |
| Crunchy Bridge | Enterprise-grade, dedicated compute, no surprises | $60+/mo minimum | Pick at S4 when revenue justifies |
| AWS RDS | Fully customisable, mature backups | DIY operations, harder to manage | Skip until S5 |

We provision **Neon Pro** at S2 (~$25/mo) — pgvector + 30-day PITR + read replica.

## Connection pooling

Adjudex services connect via `node-postgres` (`pg` package). Two URLs:

```
DATABASE_URL              direct connection (migrations, server start)
DATABASE_POOL_URL         pgBouncer pooled (runtime queries)
```

Neon provides both — set both env vars and the API code uses
`DATABASE_POOL_URL` if present, falls back to `DATABASE_URL`. **TODO**:
wire this fallback in `services/api/src/db.ts` (currently uses single
`DATABASE_URL`).

## Migrations

Run via `pnpm api:migrate` which executes [services/api/db/schema.sql](../services/api/db/schema.sql)
through `pg`. The schema is **idempotent** — every `CREATE TABLE` /
`ALTER TABLE` uses `IF NOT EXISTS` / `IF EXISTS` guards. Safe to run
on every deploy.

### Migration rules

- Always additive at first: `ADD COLUMN`, `CREATE INDEX CONCURRENTLY`
  (not in schema.sql since it can't be inside transaction)
- Never `DROP COLUMN` in same release as deploying app that stops
  reading it — wait one full release cycle
- Never `ALTER TYPE` of populated column in single transaction —
  rewrite via shadow column + backfill
- Constraint additions (`NOT NULL`, `UNIQUE`) must be done in two
  steps: add as `NOT VALID`, then `VALIDATE` in separate migration

### Test before mainnet

```bash
# 1. Reset local Postgres
docker compose down -v && docker compose up -d postgres

# 2. Run migration from scratch
DATABASE_URL=postgres://... pnpm api:migrate

# 3. Verify no warnings
DATABASE_URL=postgres://... pnpm test services/api/src/__tests__/schema-chain-defaults.test.ts
```

## Backups

### Daily snapshot

Neon takes a snapshot every 24h by default; PITR (point-in-time
recovery) allows restore to any second in the last 30 days.

### Verification cadence

| Cadence | What | Owner |
|---|---|---|
| Monthly | Restore last week's snapshot to a staging branch + smoke-test API | On-call rotation |
| Quarterly | Full disaster-recovery drill — restore cold, redeploy backend, verify E2E | All-hands |

### Restore playbook

```bash
# 1. Create staging branch from PITR point
neon branches create --parent prod --pit "2026-06-01T14:30:00Z" --name dr-test

# 2. Get connection string for branch
DATABASE_URL=$(neon branches show dr-test --json | jq -r .connection_string)

# 3. Verify counts match expectation
psql $DATABASE_URL -c "SELECT COUNT(*) FROM markets;"

# 4. Run API against branch
DATABASE_URL=$DATABASE_URL pnpm dev:api

# 5. Smoke-test from local browser → http://localhost:3001/api/markets

# 6. Tear down branch when verified
neon branches delete dr-test
```

## Read-replica for analytics

Once we have `cohort retention`, `revenue` queries that scan multi-million
rows, route them to a read replica:

```typescript
// services/api/src/db.ts — to add in S3
const writePool = new Pool({ connectionString: process.env.DATABASE_URL });
const readPool = new Pool({
  connectionString: process.env.DATABASE_READ_URL ?? process.env.DATABASE_URL,
});

export function query<T>(sql: string, params: unknown[], opts?: { readOnly?: boolean }) {
  return (opts?.readOnly ? readPool : writePool).query<T>(sql, params);
}
```

Neon read replicas are read-only and lag is < 1 second under normal load.

## Connection limits

Neon Pro caps at 10K concurrent connections globally but we'll hit
backend pool limits first:

- Default pg Pool: 10 connections per Node process
- 2 backend instances × 10 = 20 connections
- + indexer 5 connections = ~25
- + mm-agent 5 connections = ~30
- Stays well under Neon limit

For S3 (multi-instance backend), pin pool size in [services/api/src/db.ts](../services/api/src/db.ts)
with `max: 20` to avoid runaway.

## Slow query budget

Queries that take > 250ms p95 are tracked via Pino log
(`{durationMs: 312, queryType: "select-positions"}`) and reviewed
weekly. Worst offender either gets index added or query rewritten.

`pg_stat_statements` extension enabled on Neon — query via:
```sql
SELECT calls, total_exec_time, mean_exec_time, query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

## Data classification

| Table | PII? | Retention | Encrypted at rest |
|---|---|---|---|
| `markets` | No (public on-chain) | Forever | Yes (Neon default) |
| `positions` | Wallet address only | Forever | Yes |
| `agents` | ERC-8004 addresses only | Forever | Yes |
| `notification_events` | Wallet + free-text body | 90 days (delete delivered + 30d) | Yes |
| `user_emails` (S2) | Email PII | Until user deletes | Yes |
| `user_settings` | Preference JSON | 2y inactive → delete | Yes |
| `indexer_state` | Operational | Forever (compactable) | Yes |
| `siwe_sessions` | Wallet + nonce | Until expiry or sign-out | Yes |

GDPR erasure path: `DELETE FROM user_settings WHERE address = $1;
DELETE FROM user_emails WHERE address = $1; DELETE FROM
notification_events WHERE address = $1;` — on-chain rows untouchable.

## Failure modes

| Scenario | Impact | Mitigation |
|---|---|---|
| Neon outage | All API routes 5xx | Cache last `/api/markets` response in CDN with 60s TTL (Vercel ISR); user can still read main page during brief outages |
| Migration corrupts schema | Indexer stops, API can't write | `services/api/db/schema.sql` is idempotent + PITR available; rollback by restoring to pre-migration point |
| Run out of connections | API requests timeout | Pool size alert > 80% → page on-call; add instance or upgrade plan |
| DB cost spike (analytics) | Revenue impact | Read replica + slow-query log review |

## Links

- [services/api/db/schema.sql](../services/api/db/schema.sql) — schema source of truth
- [services/api/src/migrate.ts](../services/api/src/migrate.ts) — migration runner
- [docs/RUNBOOK.md](RUNBOOK.md) — incident response
- [docs/ONCALL.md](ONCALL.md) — alert thresholds
- [docs/PRIVACY.md](PRIVACY.md) — data retention contract with users
