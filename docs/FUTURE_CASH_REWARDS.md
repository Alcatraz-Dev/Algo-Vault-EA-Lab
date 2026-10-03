# Future Cash Rewards — Architecture Only (DISABLED)

**Current production state: cash rewards are OFF and cannot be turned on from
any UI, API, or database value.**

This document describes the architecture a future, compliance-reviewed
deployment could use. It is **not** a legal opinion and provides **no legal
conclusions** — every jurisdiction, KYC/AML, tax and payout question below must
be reviewed by qualified counsel and AlgoVault's compliance owners before any
activation.

---

## 1. Why cash is disabled today

- AlgoVault Performance Arena is a **simulated** trading environment. Virtual
  capital has no cash value; rewards are platform rewards only (AV Points, Pro
  days, AI/research/backtest credits, badges, competition access).
- Enabling monetary rewards would engage payment, licensing, KYC/AML, tax and
  gambling/contest-adjacent regulation in many jurisdictions — none of which
  has been reviewed or implemented.
- The product constitution forbids cash payouts in this stage of the product.

## 2. The server-side gate (implemented and tested)

```
CASH_REWARDS_ENABLED = false        # env var, server-only, default false
```

- Read exclusively by `lib/performance-arena/flags.ts` →
  `isCashRewardsEnabled()`.
- There is **no RTDB key**, **no admin endpoint**, and **no request body field**
  that can change it. Admin API explicitly rejects `CASH` reward grants with
  `403 CASH_REWARDS_DISABLED`.
- `POST /api/performance-arena/payouts` delegates to
  `lib/performance-arena/payout.ts` → `requestCashReward()`, which:
  1. rejects `CASH_REWARDS_DISABLED` while the flag is off (checked FIRST,
     before any payload validation — a forged/malformed request changes
     nothing), and
  2. still rejects `NO_PAYOUT_PROVIDER` when the flag is on, because **no
     payout provider is registered in this codebase**.
- Tested invariant (`npm run test:arena` → `cash-invariant` suite): no user
  can cause a cash reward to be issued while the flag is false, even with a
  fully forged eligibility object; and even flag=true cannot produce a payout.

## 3. Implemented architecture seams (no live flow)

`lib/performance-arena/payout.ts` + `types.ts` define:

| Interface | Purpose | Status |
|---|---|---|
| `PayoutProvider` | Adapter contract (`requestPayout`) for a future provider | Registry **empty** |
| `PayoutAccount` | Opaque provider reference — no sensitive data stored | Type only |
| `PayoutRequest` | Request lifecycle record (drafted → always `rejected` today) | Helper rejects by construction |
| `PayoutEligibility` | Aggregates jurisdiction + KYC + tax + fraud + approval | Implemented, always blocked while flag off |
| `KYCStatus` | `not_submitted \| pending \| verified \| rejected` | Type only — **no KYC data collected today** |
| `TaxStatus` | `not_collected \| pending \| cleared \| action_required` | Type only — **no tax data collected today** |
| `JurisdictionEligibility` | Country + policy-version result | Implemented conservatively (empty allow-list ⇒ ineligible) |
| `FraudReview` | `not_required \| pending \| cleared \| flagged` | Type only (arena fraud flags exist for review) |
| `PayoutApproval` | `pending \| approved \| denied` (manual/policy) | Type only |

`RewardType` already includes `CASH`, and `RewardEligibility` reports
`DISABLED` for it — so the future flow slots into the existing eligibility and
ledger machinery **without rebuilding** the Challenge Engine, Performance
Engine, Reward Engine or Trader Profile.

## 4. Future flow (unchanged design)

```
Challenge Passed → Performance Result → Reward Eligibility → Jurisdiction Check
→ Identity/KYC Check → Fraud Review → Tax/Compliance Check
→ Manual/Policy Approval → Payout Request → Payout Provider → Completed
```

The current implementation **stops at "Reward Eligibility"**. Every subsequent
step is an adapter to be added later.

## 5. Required before any activation (human/compliance checklist)

1. **Compliance & legal review** — determine whether prize/contest rewards are
   permissible per jurisdiction; define the reviewed country allow-list
   (`evaluateJurisdiction` already consumes one; it ships EMPTY).
2. **Licensing** — payments/licensing analysis for the operating entities.
3. **KYC/AML** — vendor selection, identity verification thresholds, sanctions
   screening; design must collect the *minimum* necessary data.
4. **Tax** — withholding/reporting obligations (e.g. 1099-class reporting),
   tax interview flow, record retention.
5. **Fraud review** — connect `fraudFlags` to a manual review workflow with
   documented policy; define challenge-manipulation criteria.
6. **Approval policy** — manual/policy approval step with maker-checker
   audit trail.
7. **Payout provider integration** — implement a `PayoutProvider` (Stripe,
   PayPal etc.), register it **only** in a controlled deployment, and re-run:
   - `npm run test:arena` (cash-invariant suite must be updated deliberately),
   - security review of the new route,
   - load/abuse testing of eligibility + rate limits.
8. **Deployment safeguards** — set `CASH_REWARDS_ENABLED=true` only via
   controlled infrastructure config with review; keep the flag out of any
   admin UI permanently; consider a second independent server-side guard
   (e.g. separate env var for provider registration) so a single mistaken
   variable cannot enable payouts.
9. **Terms & UX** — rewrite reward terms, disclosures and disclaimers for
   monetary programs; remove any ambiguity that virtual performance converts
   to money.

## 6. Explicit non-goals (unchanged)

Even in a future cash deployment, AlgoVault must not become a broker, custody
customer funds, execute real-money trades, promise profits, enable withdrawals
of virtual capital, issue cryptocurrency/tokens, or represent virtual capital
as real.

---

*Document version: arena-cash-v1. No part of this file is legal advice.*
