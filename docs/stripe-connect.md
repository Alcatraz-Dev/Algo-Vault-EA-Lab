# Stripe Connect V2 — Implementation Notes

This document describes how AlgoVault integrates Stripe Connect V2 (connected
accounts, Direct Charges with platform application fees, connected-account
products, developer storefronts, and subscriptions) plus the webhook topology.

All Stripe API calls go through **one** SDK client exported from
`lib/stripe.ts` (`stripeClient`). The SDK (installed `stripe@22.6.2`, tracks API
version **v2442**) determines the API version — do **not** hardcode an
`apiVersion`, and never create a second `new Stripe(...)` client.

---

## 1. Environment variables

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Platform secret key (server only). Never expose client-side. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the **V1** webhook endpoint (`/api/webhooks/stripe`). |
| `STRIPE_V2_WEBHOOK_SECRET` | *Optional.* Signing secret for the **V2 thin-event** Event Destination. Falls back to `STRIPE_WEBHOOK_SECRET` when unset (e.g. local CLI testing). Set it to the Event Destination's signing secret in production. |
| `STRIPE_SUBSCRIPTION_PRICE_ID` | *TODO.* `price_...` ID of the platform subscription price used by the store subscription flow via `customer_account` (Android support). |
| `NEXT_PUBLIC_APP_URL` | Base URL used for Account Link refresh/return URLs and checkout success/cancel URLs. |

> **Security:** `STRIPE_SECRET_KEY` must never appear client-side. There is no
> `NEXT_PUBLIC_STRIPE_SECRET_KEY`. Keep the key in server-only environment
> variables / the server runtime.

---

## 2. Connected accounts (V2 only)

Account creation lives in `app/api/developer/stripe/route.ts` (POST):

- Uses `stripeClient.v2.core.accounts.create(...)` — **no** top-level
  `type: "express" | "standard" | "custom"` (that field does not exist in V2).
 - Requests **both** the **merchant** and **recipient** configurations
   up front, with their capabilities requested together:

   ```jsonc
   configuration: {
     customer: {},                      // enables customer_account / billing portal
     merchant: {
       capabilities: { card_payments: { requested: true } }
     },
     recipient: {
       capabilities: {
         stripe_balance: { stripe_transfers: { requested: true } }
       }
     }
   },
   dashboard: "full",
   defaults: {
     currency,
     responsibilities: {
       fees_collector: "stripe",        // platform merchant of record (Direct Charges)
       losses_collector: "stripe",
     },
   },
   identity: { country: "<ISO alpha-2>", entity_type: "individual" },
   metadata: { firebaseUID: "<uid>" }
   ```

   `card_payments` is the required prerequisite for
   `stripe_transfers` — both must be requested in the same
   configuration call, otherwise Stripe returns
   `capability_not_available_without_other_capability`.
   - `card_payments` (merchant) → enables Direct Charges + application fee
     (AlgoVault is merchant of record, handles fees and losses).
   - `stripe_transfers` (recipient) → enables developer payouts / separate
     charge-and-transfer flows (kept for backward compatibility).
 - Country comes from the developer profile (`COUNTRY_ISO_MAP`) when known;
   otherwise it falls back to `us` (TODO: make this configurable per country).
 - **Idempotent:** an existing `users/{uid}/stripeConnect.accountId` is always
   reused; a pre-existing legacy account is updated to request both merchant
   `card_payments` and recipient `stripe_transfers`. The update is wrapped in a
   try/catch so that if Stripe rejects it, the onboarding link is still created.
 - Onboarding link: `stripeClient.v2.core.accountLinks.create` with
   `use_case.type: "account_onboarding"`, and refresh/return URLs pointing at
   `/developer/dashboard?stripe=refresh|return`. The `configurations` array is
   derived dynamically from the account's actual configurations (e.g.
   `["merchant", "customer", "recipient"]`).

Status (GET) is **always read from Stripe** (source of truth) via
`stripeClient.v2.core.accounts.retrieve(accountId, { include: [...] })` and
cached at `users/{uid}/stripeConnect` for the admin page. Labels returned:
`"Payments Active"`, `"Requirements Due"`, `"Restricted"`, `"Stripe Connected"`,
`"Onboarding Required"`. V2 requirements (`{ entries, summary }`) are flattened
into the legacy `requirements.{currentlyDue,eventuallyDue,pastDue,
currentDeadline}` shape so the admin dashboard keeps working.

A reverse index `stripeAccounts/{accountId} = { uid, accountId, updatedAt }`
lets the storefront and webhooks resolve an account ID to its owner without an
RTDB deep query.

---

## 3. Direct Charges, products, and the developer storefront

- **Products:** `app/api/developer/products/route.ts` creates Stripe products
  and prices **on the developer's connected account** (`{ stripeAccount }`),
  gated on merchant `card_payments` status being `active` ("Complete Stripe
  onboarding before accepting payments."). Pricing types map to Stripe
  one-time prices; `subscriptionPeriod: "month"` maps to recurring prices.
- **Storefront:** `app/store/[accountId]` (public page) lists the developer's
  active products from the connected account
  (`stripeClient.products.list({ limit: 20, active: true, expand: ["data.default_price"] }, { stripeAccount })`).
  *TODO:* `accountId` is currently exposed in the URL; revisit if storefront
  pages must be friendlier.
- **Checkout:** `app/api/store/checkout/route.ts` creates a Checkout Session on
  the seller's connected account (`{ stripeAccount, idempotencyKey }`):
  - Payment mode → `payment_intent_data.application_fee_amount`
  - Subscription mode → `subscription_data.application_fee_percent`
  - The application fee is computed **server-side** from the developer's plan
    (`lib/stripe.ts`: `DEVELOPER_FEE_RATES` / `platformFeeRate()` —
    `dev_starter` 5%, `dev_pro` 2%, `dev_enterprise` 0%). It is duplicated from
    `lib/subscription.ts` because that module pulls in Firebase client code.
  - Subscription mode (Android): when the buyer owns a connected account, the
    subscription is attached with `customer_account: <buyerAccountId>`;
    otherwise Stripe creates a regular Customer.
- **Orders** are finalized by the webhook (webhook-confirmed state, **not** the
  checkout redirect) and stored at `orders/{buyerUid}/{orderId}`.

---

## 4. Subscriptions & Billing Portal

- Store (connected) subscriptions are mirrored at
  `subscriptions/{uid}/{subscriptionId}` when their Checkout session completes
  (webhook), with `accountId`/`stripeAccountId`, `sellerUid`, `productId`,
  `priceId`, `orderId`, `status`, `customerAccountId`.
- `app/api/store/subscription-status/route.ts` returns the user's records and
  refreshes live status from the connected account when a `accountId` is passed.
- `app/api/store/billing-portal/route.ts` and `app/api/billing/...` open the
  Billing Portal. Connected subscriptions use
  `billingPortal.sessions.create({ customer_account: accountId, return_url })`
  (ownership enforced server-side); platform subscriptions use
  `billingPortal.sessions.create({ customer: <customerId>, return_url })`.
- `STRIPE_SUBSCRIPTION_PRICE_ID` (see env table above) is the *TODO* price ID
  for the platform subscription used in the `customer_account` flow; it is not
  hardcoded anywhere in code.

---

## 5. Webhooks — `/api/webhooks/stripe`

Single route for **both** delivery modes (see `app/api/webhooks/stripe/route.ts`):

1. Peek at the parsed body:
   - `object === "v2.core.event_notification"` (or a `v2.`-prefixed type) →
     **V2 thin event** path.
   - otherwise → **V1** `constructEvent` path.
2. **Idempotency:** every event is claimed atomically in
   `webhook_events/{eventId}` (thin events keyed `v2:{id}`). If processing
   throws, the claim is released so Stripe's retry reprocesses.

### V2 thin events (Event Destination)

- Verified with `stripeClient.parseEventNotification(body, signature, secret)`
  (there is no `parseThinEvent` in SDK 22.6.2).
- Relevant types (all confirmed against the installed SDK):
  - `v2.core.account[requirements].updated`
  - `v2.core.account[configuration.merchant].capability_status_updated`
  - `v2.core.account[configuration.customer].capability_status_updated`
  - `v2.core.account[configuration.recipient].capability_status_updated`
  - `v2.core.account.created` / `updated` / `closed`
  - `v2.core.account_link.returned`
  - `v2.core.event_destination.ping` (ack only)
- Account events resolve the owner via `stripeAccounts/{accountId}` (from
  `related_object.id`) and re-run the shared status logic in
  `lib/stripe-connect-utils.ts`, refreshing the cache.

### V1 events

- `checkout.session.completed` — donations, platform subscriptions
  (`orderType === "subscription"` / `sub_` orders), marketplace product
  licenses (`products/{id}` then `bots/{id}` fallback), and **store orders**
  (`orderType === "store"` on the connected account, including the
  `subscriptions/{uid}/{subscriptionId}` mirror for subscription mode).
- `customer.subscription.updated` / `deleted` / `created` — syncs status to
  `users/{uid}/subscription`, `users/{uid}/developerSubscription`, and the
  `subscriptions/{uid}/...` mirror.
- `invoice.paid` / `invoice.payment_failed` — resolves the subscription from
  `data.object.subscription`, then syncs status (`active` / `past_due`).
- Ack-only (no local write): `payment_method.attached/detached/updated`,
  `customer.updated`, `customer.tax_id.created/updated/deleted`,
  `billing_portal.configuration.created/updated`, `billing_portal.session.created`.

### Connect delivery note (Direct Charge)

Checkout Sessions created **on a connected account** belong to that account, so
their events are delivered to the **connected account's** webhook/Event
Destination, not the platform's standard endpoint. Point Connect forwarding at
this same route; the store-order metadata tells the handler which order to
finalize. (See the Stripe CLI commands below.)

---

## 6. Local development with the Stripe CLI

Start the app (`npm run dev`) and listen:

```bash
# V1 webhook events (donations, marketplace purchases, subscriptions)
stripe listen \
  --forward-to http://localhost:3000/api/webhooks/stripe \
  --events checkout.session.completed,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed

# V2 thin events (account status) — Event Destination style
stripe listen \
  --thin-events 'v2.core.account[requirements].updated,v2.core.account[configuration.merchant].capability_status_updated,v2.core.account[configuration.customer].capability_status_updated,v2.core.account[configuration.recipient].capability_status_updated' \
  --forward-thin-to http://localhost:3000/api/webhooks/stripe

# Connected-account (store / Direct Charge) events
stripe listen \
  --forward-to http://localhost:3000/api/webhooks/stripe \
  --forward-connect-to http://localhost:3000/api/webhooks/stripe
```

Set the printed `whsec_...` values in `.env.local`:
- V1 → `STRIPE_WEBHOOK_SECRET`
- thin events → `STRIPE_V2_WEBHOOK_SECRET` (or leave unset locally so the code
  falls back to `STRIPE_WEBHOOK_SECRET`).

---

## 7. Testing notes

- `.env.local` may contain a test-mode `sk_test_...` key. A standalone script
  that creates a V2 account (merchant `card_payments`), an Account Link,
  retrieves the account, and closes it can validate the integration against
  Stripe test mode — but **do not** run destructive calls against live data.
- Account status is always authoritative from Stripe; the dashboard cache at
  `users/{uid}/stripeConnect` is refreshed on GET, after onboarding, and on V2
  thin events.
- Validate with `npm run lint` and `npm run build`, and grep for:
  - `type: "express" | "standard" | "custom"` in account creation (must be absent)
  - stray `new Stripe(` or `stripe.` usages (must all be `stripeClient`)
  - `STRIPE_SECRET_KEY` in client code (must not exist)

---

## 8. Official references

- Connect V2 accounts: https://docs.stripe.com/api/v2/core/accounts
- Connect webhooks: https://docs.stripe.com/connect/webhooks
- Thin events: https://docs.stripe.com/api/v2/events
- Billing Portal `customer_account`:
  https://docs.stripe.com/api/customer_accounts (search "Billing Portal")