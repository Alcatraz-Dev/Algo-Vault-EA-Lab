# Phase 7 — Full Lifecycle Audit (2026-09-26)

## 1. Lifecycle Audit Map

| Business Transition | Authoritative Source | Event | Status |
|---|---|---|---|
| customer created | Existing account/user creation (Firebase + business customer) | customer.created | EMITTED at checkout/create boundary (Phase 6) |
| customer updated | Existing profile/update flows | customer.updated | NOT YET EMITTED (documented; add when existing update boundary found) |
| product created | Marketplace / admin product creation | product.created | NOT YET EMITTED (documented; add at product creation endpoint) |
| product updated | Product edit flows | product.updated | NOT YET EMITTED |
| order created | `/api/checkout/create/route.ts` | order.created | EMITTED (Phase 6) |
| order paid | Order status transition at authoritative server boundary | order.paid | NOT SEPARATE — see note below |
| payment succeeded | Stripe webhook (verified) | payment.succeeded | EMITTED (Phase 6 in webhook) |
| payment failed | Stripe webhook (verified) | payment.failed | EMITTED (Phase 6 in webhook) |
| payment refunded | Stripe webhook (verified) | payment.refunded | EMITTED (Phase 6 in webhook) |
| license activated | `lib/plugins/licensing.ts` (grantPluginLicense) | license.activated | EMITTED (Phase 6) |
| license created | Internal to activation (same operation) | license.created | NOT SEPARATE — creation is internal to activation |
| license expired | Existing expiration logic (`expirePluginLicenses`) | license.expired | NOT EMITTED (documented; add at expiration boundary) |
| license revoked | Existing revocation logic | license.revoked | NOT EMITTED (documented) |
| commission created | No standalone marketplace commission service exists | commission.created | NOT APPLICABLE — existing logic is trading/strategy-lab or growth affiliate tracking only |
| order cancelled | Existing cancellation endpoint (if exists) | order.cancelled | NOT EMITTED — document if cancellation boundary found |
| order refunded | Existing refund logic / Stripe refund | order.refunded | NOT EMITTED — document when order refund update exists |

## 3. order.paid Note

No separate `order.paid` persisted transition exists independently from the Stripe payment verification + checkout flow. The checkout creates a session; Stripe verifies; the existing architecture updates subscription/orders through Stripe webhook. `order.paid` is intentionally not a separate persisted state change — it is represented by `payment.succeeded` + existing subscription/order updates.

## 4. license.created Note

`grantPluginLicense` creates and activates in one atomic operation (`setPluginLicense` + `writeAuditLog`). There is no meaningful separate `license.created` event before activation — creation is internal. Only `license.activated` is emitted.

## 5. Commission Note

No marketplace developer/affiliate commission engine exists in `lib/` independent of trading/strategy-lab. The `commission.created` event exists in the event model but has no standalone marketplace boundary to emit from. The ERPNext adapter can receive it when appropriate.

## 7. Refund Lifecycle Note

`payment.refunded` is emitted from verified Stripe webhook. Existing order refund transition is handled by Stripe webhook / subscription update but does not have a separate `order.refunded` event emission yet. Add when authoritative order-state update is confirmed.

## 12. End-to-End Idempotency

- `order.created` uses `orderId` in idempotency key
- Stripe webhook uses `event.id` claim mechanism + dispatcher idempotency
- `license.activated` uses `plugin.id` + `userId`
- Duplicate webhook retries are safe (Stripe claim mechanism + event idempotency)

## 13. Failure Isolation Note

Verified: `ERPNEXT_ENABLED=false` skips adapter safely; global business events succeed independently.

## 15. Test Harness Note

No new framework introduced. Existing tests (`tests/lib/business-events/`) cover event creation, adapter skip, and idempotency. Full simulated lifecycle requires only event layer + mocked Stripe webhook + mocked licensing — no real financial transactions.
