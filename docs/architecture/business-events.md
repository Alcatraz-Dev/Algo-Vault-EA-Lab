# Business Event Layer Architecture

Canonical provider-agnostic business event layer owned by AlgoVault.

## Event Model

```typescript
interface BusinessEvent<T> {
  eventId: string;
  eventType: BusinessEventType;
  version: 1;
  occurredAt: string;
  actor?: { type: "user" | "system" | "admin"; id?: string };
  entity: { type: "customer" | "order" | ...; id: string };
  correlationId?: string;
  idempotencyKey: string;
  payload: T;
}
```

## Lifecycle

pending → processing → processed/failed → dead-letter

Retries are idempotent. Duplicate webhook events are suppressed by `idempotencyKey`.

## Source-of-Truth Boundaries

- Stripe → payment source of truth
- Licensing Service → authorization source of truth
- Firebase RTDB → realtime application state
- ERPNext → business/accounting representation only (optional adapter)

## Adapters

- `erpnext.ts` — respects `ERPNEXT_ENABLED`; skips safely when disabled
- `stripe.ts` — notes event; does not replace Stripe
- `licensing.ts` — delegates to existing Licensing Service
- `firebase.ts` — writes audit to RTDB

## Isolation

ERPNext failure does not break:
- Marketplace
- Stripe
- Licensing
- Trading
- AI
- Market Intelligence

---

## Phase 7 — Actual Lifecycle Discovered (2026-09-26)

Audit of real codebase transitions:

- `customer.created`: emitted at checkout/create boundary (checkout/api)
- `order.created`: emitted at checkout success (checkout/api)
- `payment.succeeded`: emitted from verified Stripe webhook (`app/api/webhooks/stripe/route.ts`)
- `payment.failed`: emitted from Stripe webhook
- `payment.refunded`: emitted from Stripe webhook
- `license.activated`: emitted from `lib/plugins/licensing.ts` (`grantPluginLicense`)
- `license.created`: NOT SEPARATE (creation internal to activation)
- `license.expired`: NOT YET EMITTED (documented — add at expiration boundary)
- `order.paid`: NOT A SEPARATE PERSISTED STATE (represented by payment.succeeded + existing subscription/order updates)
- `commission.created`: NOT APPLICABLE — no standalone marketplace commission service exists outside trading/strategy backtest
- `product.created/updated`: NOT YET EMITTED — add at marketplace/admin product endpoints
- Correlation IDs used: `correlationId` passed through event payload; eventId unique per event
- Idempotency: `idempotencyKey` based on entityId + eventType + payload hash
- Failure isolation verified: ERPNext disabled skips safely; global events independent
