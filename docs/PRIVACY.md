# Privacy Policy — PariAI

**DRAFT — Has NOT been reviewed by legal counsel. Replace before mainnet launch.**

Effective date: TBD
Last updated: 2026-06-01

## 1. Who we are

PariAI is operated by **TBD legal entity** (Ukrainian or Estonian
company TBD post-S2). For data-protection questions, contact
`privacy@pariai.xyz`.

## 2. Data we collect

### 2.1 Wallet address
When you connect a wallet to use the Service, we collect your wallet
address. Your wallet address is **public information on the blockchain**.
We use it to:
- Display your portfolio
- Match on-chain positions to your in-app session
- Enforce admin allowlists (for market import features)

### 2.2 SIWE authentication
When you sign in with Ethereum (SIWE), we issue a session cookie. We
store the wallet address + session expiry + a server-side nonce. The
cookie is `HttpOnly`, `Secure`, `SameSite=Lax`.

### 2.3 Watchlists and preferences
When you watchlist a market or change settings, we store the address
+ preferences pair in our database.

### 2.4 Notification preferences
If you opt in to email notifications, we store an email address linked
to your wallet address. Verification is via a one-time signed message.
You can delete this record at any time from `/settings`.

### 2.5 Server logs
Our backend logs request metadata for security, billing, and debugging:
- HTTP method, path, status code, response time
- IP-derived country code (NOT the IP itself; we read CDN headers only)
- User-Agent string (truncated)
- Wallet address (when authenticated)

Logs are retained for **30 days** then auto-deleted.

### 2.6 Telemetry / analytics
We use **Plausible Analytics** (cookieless, no PII collection) for
aggregate page-view stats. Plausible does not set tracking cookies or
share data with third parties.

We do NOT use Google Analytics, Meta Pixel, or any cross-site tracker.

### 2.7 Error tracking
Production errors are sent to **Sentry**. Sentry receives:
- Stack traces (scrubbed of secrets per redact list)
- Browser/Node version
- Wallet address (if request was authenticated)
- A random `digest` value linking client/server logs

Sentry data is retained for **90 days**.

## 3. What we do NOT collect

- Real names
- Government IDs
- Birthdates
- Bank or card details (no fiat handling on-chain side; fiat on-ramps
  are third-party widgets that bypass our servers entirely)
- Phone numbers
- Precise location data
- Browser fingerprints

## 4. On-chain data is public

Everything on Arbitrum is permanently public:
- Your wallet address
- Every bet, claim, and refund you make
- The markets you create
- Your portfolio composition

We cannot delete this data. It exists outside our control.

## 5. Sharing

We share data only with:

| Recipient | Purpose | Lawful basis (GDPR) |
|---|---|---|
| Sentry (US) | Error tracking | Legitimate interest |
| Plausible (EU) | Aggregate analytics | Legitimate interest |
| Resend (US) | Email delivery (only if you opt in to notifications) | Contract |
| Cloudflare / Vercel | CDN, edge routing | Legitimate interest |
| Pinata (US) | IPFS pinning of public market evidence | Legitimate interest |
| Doppler (US) | Secret management (no user data — only service config) | N/A |
| Legal authorities | When required by valid legal process | Legal obligation |

We do not sell or rent personal data.

## 6. Your rights (GDPR)

If you are in the EU/EEA you have the right to:

- **Access**: request a copy of the data we hold about you.
- **Rectification**: correct inaccurate data.
- **Erasure**: request deletion of off-chain data we hold (we cannot
  delete on-chain records — that's a property of the blockchain).
- **Restriction**: ask us to limit processing.
- **Portability**: receive your data in machine-readable form.
- **Objection**: object to processing based on legitimate interest.
- **Complaint**: lodge a complaint with your national supervisory
  authority.

To exercise rights, email `privacy@pariai.xyz` with your wallet address
signed with that wallet (proof of ownership).

## 7. Cookies

We use exactly **one cookie**: the SIWE session cookie (Section 2.2).
It's strictly necessary for authentication and does not require a
consent banner under GDPR.

Plausible Analytics is cookieless. Sentry uses no cookies in our
configuration.

## 8. Data retention

| Data | Retention |
|---|---|
| Server access logs | 30 days |
| SIWE sessions | Until expiry (default 7 days) or sign-out |
| Sentry errors | 90 days |
| Watchlists / preferences | Until you delete them or 2 years of inactivity |
| Email addresses | Until you delete them |
| Notification events | 90 days |
| On-chain data | Forever (we don't control it) |

## 9. Children

The Service is not intended for users under 18. We do not knowingly
collect data from minors.

## 10. International transfers

Some of our subprocessors (Sentry, Resend, Pinata) are based in the
US. For EU users, we rely on the EU-US Data Privacy Framework. EEA
users have the right to copies of relevant safeguards.

## 11. Security

- All data in transit uses TLS 1.2+
- Database is encrypted at rest
- Secrets stored in Doppler with audit log
- Bug bounty program (see [SECURITY.md](../SECURITY.md))

We will notify affected users of a personal-data breach within 72 hours
of discovery if it poses a high risk to your rights.

## 12. Changes

Material changes are announced 7 days in advance via Discord and X.

## 13. Contact

- Privacy questions: `privacy@pariai.xyz`
- Security disclosure: see [SECURITY.md](../SECURITY.md)
- Data Protection Officer (DPO): TBD (required only if processing
  scales to GDPR Article 37 thresholds)

---

**This is a non-binding draft.** Final Privacy Policy must be reviewed
by a qualified attorney with crypto + GDPR experience before mainnet
launch.
