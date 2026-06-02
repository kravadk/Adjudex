# Terms of Service — Adjudex

**DRAFT — Has NOT been reviewed by legal counsel. Replace before mainnet launch.**

Effective date: TBD (set on production deploy)
Last updated: 2026-06-01

## 1. Acceptance

By connecting a wallet to `adjudex.xyz` ("Adjudex", "the Service", "we"),
you agree to these Terms of Service ("Terms"). If you do not agree, do
not connect a wallet and do not use the Service.

## 2. Eligibility

You may use Adjudex only if **all** of the following are true:

- You are at least 18 years old (or the age of majority in your
  jurisdiction, whichever is higher).
- You are not a resident of, located in, or accessing from the
  **United States**, **Cuba**, **Iran**, **North Korea**, **Syria**,
  **Russia**, or **Belarus**.
- You are not subject to any sanctions list maintained by the U.S.
  Department of the Treasury OFAC, the U.N. Security Council, the EU,
  or HM Treasury.
- Using prediction markets is not prohibited by the laws of your
  jurisdiction.

We attempt to enforce the country list above via CDN-reported IP
geolocation. **Circumventing this block (VPN, proxy, etc.) is a
material breach of these Terms.**

## 3. The Service

Adjudex is a **non-custodial parimutuel prediction-market protocol**
deployed on the Arbitrum blockchain. Key points:

- We **do not hold user funds**. Stakes are deposited into open-source
  Solidity contracts that we do not control after deployment.
- We **do not operate as a counterparty**. Winners receive a
  proportional share of the pool funded by losing stakes.
- We **do not provide investment advice**.
- The site is a thin frontend — the underlying smart contracts remain
  reachable directly (via Etherscan, Foundry, etc.) regardless of
  whether the website is online.

## 4. No financial product

Positions on Adjudex are **NOT**:
- Securities under the Securities Act of 1933
- Swaps under the Commodity Exchange Act
- Investments under the laws of any covered jurisdiction
- Insurance contracts

If your jurisdiction classifies prediction-market positions as
regulated financial products, you may not use the Service.

## 5. Fees

Adjudex charges a **1.5% protocol fee** taken from each winning claim.
The fee is on-chain (configured at MarketFactory deployment, not
mutable per-market). Losing stakes are not charged a fee. The
`refundAfterGrace` recovery path does not charge a fee.

## 6. Risks

Using Adjudex involves significant risks, including:

- **Total loss of staked capital**. Wrong-side positions return zero.
- **Smart contract vulnerabilities**. While audited, no audit is
  exhaustive.
- **AI judge errors**. The optimistic resolution mechanism allows a
  2-hour challenge window, but if no party challenges, the AI verdict
  becomes final.
- **Network risks**. Arbitrum reorgs, RPC outages, MEV.
- **Gas costs**. You pay gas; losing positions still cost gas.
- **Regulatory risk**. Laws change. We may discontinue the Service.

YOU TAKE FULL RESPONSIBILITY FOR YOUR DECISIONS.

## 7. Acceptable use

You must NOT:

- Use the Service from a prohibited jurisdiction (see Section 2)
- Use bots to spam markets or pools below their economic viability
- Attempt to manipulate AI judge resolution through bribery or
  intimidation of any party involved in resolution
- Exploit vulnerabilities for personal gain (see [SECURITY.md](../SECURITY.md)
  for the responsible disclosure policy)
- Scrape the Service in violation of `robots.txt` or rate limits
- Use the Service for money laundering, terrorist financing, or any
  illegal activity
- Create markets that incite violence, hate, or discrimination

## 8. Disclaimers

THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTY
OF ANY KIND, EXPRESS OR IMPLIED. WE DISCLAIM ALL WARRANTIES INCLUDING
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
NON-INFRINGEMENT.

We do not warrant that:
- The Service will be uninterrupted or error-free
- Smart contracts are bug-free
- AI judge verdicts are correct
- Market resolution will occur within any specific timeframe

## 9. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY ARISING
OUT OF YOUR USE OF THE SERVICE WILL NOT EXCEED THE GREATER OF (A) FEES
PAID BY YOU IN THE 12 MONTHS BEFORE THE EVENT, OR (B) USD 100.

WE WILL NOT BE LIABLE FOR INDIRECT, CONSEQUENTIAL, SPECIAL,
INCIDENTAL, OR PUNITIVE DAMAGES.

## 10. Indemnification

You agree to indemnify and hold us harmless from any claim arising out
of your breach of these Terms, your use of the Service, or your
violation of any law.

## 11. Modifications

We may modify these Terms at any time by posting an updated version.
Material changes will be announced via Discord and X at least 7 days
in advance. Continued use after the effective date constitutes
acceptance.

## 12. Governing law

These Terms are governed by the laws of **TBD jurisdiction** (likely
Ukraine or Estonia — set when legal entity is finalized). Disputes
will be resolved in TBD venue.

EU/EEA users have rights under the GDPR that are not waivable; nothing
in these Terms limits those rights.

## 13. Contact

- Security disclosure: see [SECURITY.md](../SECURITY.md)
- General: contact@adjudex.xyz (email goes live with mainnet)
- Discord: TBD link

---

**This is a non-binding draft.** Final Terms must be reviewed by a
qualified attorney with crypto-securities expertise (recommended firms:
A&O Shearman crypto group, K&L Gates digital assets, Orrick fintech
practice) before mainnet launch.
