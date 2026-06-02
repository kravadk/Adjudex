# On-Call & Alert Routing

This doc describes **who responds to incidents, how, and within what time**.

## SLA targets (S2 launch)

| Metric | Target | Reading |
|---|---|---|
| Backend uptime | 99.5% / month | `adjudex_uptime_seconds` |
| Indexer lag (p95) | < 30 seconds (~ 120 blocks Arbitrum) | `adjudex_indexer_lag_blocks` |
| API request error rate | < 0.5% / 5m | `rate(adjudex_errors_total[5m]) / rate(adjudex_requests_total[5m])` |
| API request duration (p95) | < 800 ms | `adjudex_request_duration_ms` summary |
| Time-to-first-response (P0) | 15 min | Manual log |
| Time-to-mitigation (P0) | 2 hours | Manual log |
| Time-to-mitigation (P1) | 8 hours | Manual log |
| Postmortem published | within 7 days of P0/P1 close | Manual log |

S3 raises uptime target to 99.9%; S5 — 99.99% with multi-region.

## Severity levels

| Sev | Definition | Examples | Response |
|---|---|---|---|
| **P0** | Funds at risk OR full outage > 5 min | Smart contract exploit, ALL routes 500, indexer 0 blocks > 1h, AI judge signing wrong outcome | Page on-call immediately, all-hands, incident channel |
| **P1** | Degraded but not data-loss | One route failing, indexer 50% behind, AI judge slow but correct | Page on-call within business hours |
| **P2** | Annoyance, no user impact | Sentry noise, log warnings, ticker stale | File issue, batch with weekly review |
| **P3** | Cosmetic | Typo, wrong color, missing icon | File issue |

## Rotation (S2 launch)

Team of 2-3 — split coverage by day:

| Day | Primary | Secondary |
|---|---|---|
| Mon | Leonid | Atikin |
| Tue | Atikin | Neor |
| Wed | Neor | Leonid |
| Thu | Leonid | Atikin |
| Fri | Atikin | Neor |
| Sat | Neor (low-activity day) | Leonid |
| Sun | Leonid (low-activity day) | Atikin |

Primary is paged first; secondary is backup if primary doesn't ack in 5 min.

S3 grows rotation to 4-5 people, switches to weekly shifts.

## Alert routing

```
Grafana / Prometheus
        │
        ▼
 Alertmanager (or Grafana alerts native)
        │
   ┌────┴────┐
   ▼         ▼
 Telegram   Email
 (bot)      (Resend)
   │         │
   ▼         ▼
 Primary   Secondary
 on-call   (CC team)
```

### Alert rules (Prometheus syntax)

```yaml
groups:
  - name: adjudex-p0
    interval: 30s
    rules:
      - alert: BackendDown
        expr: up{job="adjudex-api"} == 0
        for: 2m
        labels: { severity: P0 }
        annotations:
          summary: "Backend API is down"
          runbook: "https://github.com/adjudex/repo/blob/main/docs/RUNBOOK.md#backend-down"

      - alert: IndexerStuck
        expr: increase(adjudex_indexer_lag_blocks[5m]) > 0 and adjudex_indexer_lag_blocks > 100
        for: 10m
        labels: { severity: P0 }
        annotations:
          summary: "Indexer is falling behind (> 100 blocks for 10m)"

      - alert: HighErrorRate
        expr: |
          rate(adjudex_errors_total[5m]) /
          rate(adjudex_requests_total[5m]) > 0.05
        for: 5m
        labels: { severity: P1 }
        annotations:
          summary: "Error rate > 5% for 5 minutes"

  - name: adjudex-p1
    rules:
      - alert: SlowRequests
        expr: |
          (rate(adjudex_request_duration_ms_sum[5m]) /
           rate(adjudex_request_duration_ms_count[5m])) > 1000
        for: 10m
        labels: { severity: P1 }
        annotations:
          summary: "Mean request duration > 1s"

      - alert: ChallengeRaisedOnMarket
        expr: increase(adjudex_challenges_total[1h]) > 0
        labels: { severity: P1 }
        annotations:
          summary: "AI judge verdict was challenged on-chain; review evidence"
```

### Telegram bot setup

1. Create bot via `@BotFather` → get `BOT_TOKEN`
2. Create group, add bot, give admin
3. Get `chat_id` (visit `https://api.telegram.org/bot<TOKEN>/getUpdates`)
4. Configure Alertmanager webhook receiver:
```yaml
receivers:
  - name: telegram
    webhook_configs:
      - url: 'https://api.telegram.org/bot<TOKEN>/sendMessage'
        send_resolved: true
        http_config:
          authorization: { type: Bearer, credentials: '<TOKEN>' }
```

### Email fallback

Use Resend (same provider as in-app notifications):
```yaml
receivers:
  - name: email
    email_configs:
      - to: oncall@adjudex.xyz  # forwards to primary + secondary
        from: alerts@adjudex.xyz
        smarthost: smtp.resend.com:587
        auth_username: resend
        auth_password: <RESEND_API_KEY>
        send_resolved: true
```

## Incident response template

Create under `docs/incidents/YYYY-MM-DD-<slug>.md`:

```markdown
# Incident — <one-line title>

## Summary
- Started: 2026-XX-XX HH:MM UTC
- Detected: HH:MM UTC by <how — alert / user report / dashboard>
- Mitigated: HH:MM UTC
- Resolved: HH:MM UTC
- Severity: P0 / P1 / P2
- Impact: <count users affected, $ at risk, duration>

## Timeline (UTC)
| Time | Event |
|---|---|
| HH:MM | Alert fired |
| HH:MM | On-call acknowledged |
| HH:MM | Root cause identified |
| HH:MM | Mitigation applied |
| HH:MM | Verified recovery |

## Root cause
<technical explanation, file:line if applicable>

## Mitigation
<what fixed it>

## What went well
- ...

## What went poorly
- ...

## Action items
| # | Owner | Due | Description |
|---|---|---|---|
| 1 | Leonid | 2026-XX-XX | Add monitoring for X |
| 2 | Atikin | 2026-XX-XX | Patch contract Y (after re-audit) |
```

## Common P0 playbooks

### Backend down (5xx on / )
1. Check Vercel / Fly status page
2. `curl https://adjudex.xyz/api/status` from external location
3. Check Grafana panel "request rate" — did traffic spike?
4. Roll back to previous deploy if recent change
5. If DB-side: check Postgres host status (Supabase / Neon dashboard)
6. Notify users via Discord if outage > 10 min

### Indexer stuck
1. Check `/api/status` → `chains.*.indexer.lastBlock` + `lagBlocks`
2. SSH to indexer host: `journalctl -u adjudex-indexer -n 200`
3. Look for RPC errors (Alchemy rate limit, transient 5xx)
4. Restart: `systemctl restart adjudex-indexer` (or fly redeploy)
5. If stuck > 1h: pause new bets via Safe (`MarketFactory.setPaused(true)`) and notify users

### Smart contract exploit suspected
1. **Pause first, investigate after** — Safe → `setPaused(true)`
2. Notify users via X + Discord within 10 min
3. Snapshot relevant txs from Arbiscan
4. Engage audit firm for emergency review
5. Do NOT push any frontend changes until contracts are clean
6. Coordinated disclosure per [SECURITY.md](../SECURITY.md)

### AI judge wrong outcome
This is **NOT** a security incident — it's resolution UX. Process:
1. Within challenge window (2h after propose): anyone calls `challenge(marketId)` on AIJudgeVerifier
2. After window: contact governance Safe to call `overrideAndFinalize(marketId, correctOutcome)`
3. Document in postmortem — was it bad input, bad model, bad spec?

## Off-hours protocol

Outside business hours (UTC 22:00-08:00), only P0 alerts page. P1/P2
queue until morning. Primary on-call can decide to ack-and-defer if
fix is non-trivial AND no funds at risk.

## Posting public status

Use `https://status.adjudex.xyz` (Atlassian Statuspage / BetterUptime).
Open incident BEFORE mitigation (set "Investigating"), update every
30 min, mark "Resolved" after verification.

## Scale-up roadmap

If real-people on-call no longer scales (S5 territory):

- Auto-pause via on-chain monitor + threshold alerts
- Forta-bot integration for smart contract anomalies
- 24/7 SRE contractor (StatusUp, Squadcast, PagerDuty managed)

## Links

- [docs/RUNBOOK.md](RUNBOOK.md) — bring-up matrix + standing playbooks
- [SECURITY.md](../SECURITY.md) — vulnerability disclosure
- [docs/GOVERNANCE.md](GOVERNANCE.md) — multisig daily ops
- Grafana dashboard: [monitoring/grafana-dashboard.json](../monitoring/grafana-dashboard.json)
