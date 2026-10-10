# AlgoVault — Testing Strategy

Practical strategy that fits the actual repository. Do not add tests that merely repeat implementation assumptions.

---

## 1. Unit tests

Target deterministic business logic:

- Indicator calculations (EMA/SMA, RSI, pivots,Fvgs, order blocks, Liquidity, Smart Money structure)
- Market-structure calculations (detectStructure, BOS/CHoCH)
- Risk calculations (side-aware, leverage, position sizing)
- Data transformations (candle normalization, aggregation, dedup, pagination)
- Permission decisions (admin, owner, product owner, read/write)
- Subscription & entitlement logic
- License validation
- Utility functions (date, formatting, validation)

Status baseline: chart engine 93, trading 32, unified trading 112, mobile 140, dashboard charts 8 — all green.

---

## 2. Integration tests

Target meaningful combinations:

- Firebase access: use emulator + fixtures where appropriate.
- API routes: auth/authorization, validation, envelope, error shape.
- Stripe webhook handling: signature verification + idempotency + lifecycle.
- Trading command lifecycle: requested → accepted → executed → rejected → unknown; never auto-retry uncertain ops into dupes.
- Market-data normalization: ordering, missing intervals, OHLC consistency, timezone.
- Intelligence pipeline boundaries: facts → interpretation → conclusion → limitations.
- License lifecycle: create, validate, activate, expire, renewal, revoke, revoke-conflict.

Status baseline: some integration tests exist in `tests/` and `lib/*/__tests__/`.

---

## 3. End-to-end tests

Prioritize existing critical user journeys:

- Authentication (login, auth state, session, recovery).
- Instrument selection + chart loading + chart interactions.
- Subscription/entitlement checks on protected routes.
- Marketplace purchase flow using safe test mode (no real payments).
- License activation + invalidation.
- Admin authorization + permission checks.
- Demo account connection (MT5 gateway / unified trading).
- Demo trading-command lifecycle where the test environment supports it.
- Pro terminal viewport preservation on history prepend (browser).

Status baseline: `test:e2e-viewport` (playwright) exists but the headless browser is **not installed here**; not run at baseline. Chart engine 93 tests pass; production build + type-check pass.

---

## 4. Visual regression & UX verification (redesign)

Verify, don't claim:

- Dark theme + light theme (intentional design, not color inversion).
- Responsive layouts (desktop/tablet/mobile).
- Navigation, dialogs, forms, chart controls, empty states, loading states, error states.
- Hover and focus states, keyboard accessibility, focus visibility.
- Contrast, reduced-motion support, form validation.
- Chart resizing and panel behavior.
- Mobile layout (E2E + browser snapshots).
- Consistency across existing routes after redesign.

Status baseline: visual verification **not performed** at baseline; tooling gap (headless browser not installed). Marked "not tested" — do not claim otherwise later.

---

## 5. Trading safety tests

- Simulated vs live paths are distinct and safe.
- Idempotency: same command re-sent does not double-execute.
- Command id/expiration + stale-command protection.
- Acknowledgement + duplicate-order prevention.
- Execution state machine: requested/accepted/executed/rejected/unknown.
- No auto-retry on uncertain outcomes (no dupes).
- Demo-first: live trading is gated; demo labeling is visible.

Status baseline: `test:unified-trading` (112) passes and encodes late-timeout + phantom-record + no-invented-fill semantics; `test:trading` (32) covers side-aware risk; demo-First gate verified by architecture doc, not by a live run.

---

## 6. Payment & webhook tests

- Signature verification on every webhook.
- Idempotency: duplicate events are absorbed, not replayed.
- Subscription lifecycle: trial, active, past_due, canceled, expired.
- Entitlement sync: server-side truth; client cannot bypass.
- License creation/revocation + race safety.
- No real monetary flow in tests; no side-effecting payment without explicit intent.

---

## 7. Database testing

- RTDB paths: producers → consumers trace; atomic updates & transactions where needed; duplicate-write prevention.
- Server-side privileged operations + client access boundaries.
- Cache coherence + server/client boundary.
- Rule changes documented + rollback plan.

Status baseline: rules exist but full security-rule + cache audit not complete.

---

## 8. Required test categories that must exist before a change ships

1. Unit tests for deterministic logic.
2. Integration tests for the affected API/database/payment path.
3. E2E for the critical user journey (if it exists).
4. Visual regression for redesigned components (dark/light, responsive, focus, reduced motion).
5. Trading-safety tests for trading-related changes.
6. Regression tests for every fixed bug.

---

## 9. Browser automation

When tooling is available, use browser automation/screenshots to verify:

- Responsive layouts.
- Flow from auth → chart → trading → marketplace → admin.
- Chart resize + pan/zoom + drawing lifecycle.
- Reduced-motion + keyboard-only usage.

Status baseline: headless browser not installed here; E2E confirmed "not tested."

---

## 10. Documentation for external integrations

For every external service (Firebase, Stripe, MT5/Testing, market data providers, AI providers, ERPNext, Telegram), record:

- What it does for AlgoVault.
- What the verification state is (verified locally via emulator/test mode, unverified, blocked by env/credentials).
- What a live run requires.

Do not claim a third-party integration works against a live system unless that test has actually been performed.
