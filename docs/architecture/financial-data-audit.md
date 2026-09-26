# Financial Data Audit (Phase 9)

## 1. Existing Financial Entities

| Entity | Source | Persistence | Notes |
|---|---|---|---|
| Checkout session | /api/checkout/create/route.ts | Stripe + RTDB orders/ | Stripe Checkout Session |
| Order | RTDB orders/, app/admin/orders | Firebase RTDB | No separate SQL order DB |
| Customer | Firebase Auth + RTDB users/ | Firebase | Business customer = user profile |
| Product | Marketplace / plugin catalog | Firebase RTDB / plugin DB | PluginRecord / Marketplace product |
| License (plugin) | lib/plugins/licensing.ts | pluginLicenses/ RTDB | Authorization authoritative |
| Payment | Stripe Checkout / webhook | Stripe (authoritative) | Webhook verifies |
| Refund | Stripe webhook (charge.refunded / invoice.refunded) | Stripe (authoritative) | Verified only |
| Subscription | Stripe + RTDB users/{uid}/subscription | Stripe + RTDB | Subscription status tracked |
| Developer/Vendor | Developer accounts / Stripe Connect | RTDB + Stripe Connect | No standalone payout engine |
| Affiliate | Growth tracking (lib/growth/tracking.ts) | RTDB | Conversion tracking only |
| Commission | None standalone for marketplace | N/A | Only trading backtest (simulated) |

## 2. Existing Monetary Fields

- Stripe Checkout: `amount`, `currency`, `unit_amount`, `price_data`
- Subscription: `price`, `currency`, `interval`
- Plugin pricing: `pricing.type`, `pricing.intervalMonths`, `pricing.currency`
- License: `amount`, `currency` (from order data)
- No fee data stored in AlgoVault (Stripe fee not exposed to platform)

## 3. Currency Handling

- Primary: `usd` (lowercase in checkout/subscription data)
- No exchange-rate source exists in codebase
- No silent conversion performed
- Multi-currency: not implemented; must preserve original currency

## 4. Stripe Identifiers

- `stripeCustomerId`
- `stripePaymentIntentId`
- `stripeSubscriptionId`
- `session.id` (checkout session)
- `charge.id` / `invoice.id` (webhook events)

## 5. Refund Handling

- Stripe webhook handles `invoice.refunded` / `charge.refunded`
- Existing webhook returns `{ received: true, ... }`
- No separate AlgoVault refund record persistence (only Stripe is authoritative)

## 6. Commission Logic

- No marketplace developer/affiliate commission engine exists
- `commissionPerLot` exists only in trading/strategy-lab backtest (simulated cost, not marketplace payout)
- Growth tracking records affiliate conversions (`lib/growth/tracking.ts`) but does not calculate payouts
- Commission events (`commission.created`) intended only when underlying service creates them

## 7. Missing / Intentionally Not Implemented

- Net revenue / MRR / ARR / profit / LTV: NO source data available; must not invent
- Stripe fee extraction: fee data not available to platform; expose as unavailable
- Exchange rates: no source; must not invent conversions
- Historical accounting: no historical transaction database; only live Stripe + RTDB
- Developer payout ledger: not implemented
- Tax / VAT recording: not implemented

## 8. Source-of-Truth Rules (confirmed)

- Stripe = payment truth
- Firebase RTDB = application/realtime state
- Licensing = authorization truth
- Business Events = integration/event history (not source of truth for payments)
- ERPNext = future accounting destination (optional, disabled)
- Financial Layer = normalized financial interpretation (not authoritative)
