# AlgoVault — Release Checklist

Minimum verification required before shipping changes. The gate is: **no unverified claim may ship**.

Classify each item: **PASS**, **FAIL**, **BLOCKED**, or **NOT TESTED** (and explain why).

---

## 1. Documentation & architecture

- [ ] `docs/project-control/` set is coherent and current (STATE, ARCHITECTURE, FEATURE_INVENTORY, BUGS, ROADMAP, DECISIONS, RESOURCES, TESTING_STRATEGY, RELEASE_CHECKLIST, MASTER_CONTEXT).
- [ ] Architecture + data-flow maps match implementation.
- [ ] Feature inventory + bug register are synchronized with the tree.
- [ ] External resources/license inventory is up to date.
- [ ] MASTER_CONTEXT includes what AlgoVault is, problems solved, target users, core principles, major modules, architecture, priorities, long-term vision, technical constraints, and known limits.

---

## 2. Reliability

- [ ] `npx tsc --noEmit` passes.
- [ ] `npx eslint .` has no new errors in changed code (existing pre-existing findings are documented in BUGS_AND_REGRESSIONS; new regressions are not).
- [ ] `npx next build` passes.
- [ ] Relevant `npm run test:*` gates pass for the changed module (run at least the module's own suite).
- [ ] Repaired bugs have focused regression tests; neighboring functionality checked.
- [ ] Remaining failures documented honestly with evidence.
- [ ] No functionality removed casually.

---

## 3. Trading & market data

- [ ] Chart data pipeline is understood and correct (OHLC ordering, dup timestamps, missing intervals, volume interpretation, timezone, stale detection, market-closure behavior).
- [ ] Historical and realtime behavior represented honestly (no fabricated candles; stale data never presented as live).
- [ ] Drawings keep intended time/price coordinates through pan/zoom/timeframe/symbol changes/history load/refresh.
- [ ] Indicator calculations validated against reference values where possible; no future leakage.
- [ ] Execution remains DEMO-only, fail-closed; account environment + license verified before any execution path.
- [ ] Command states are distinguishable (requested/accepted/executed/rejected/unknown); no auto-retry that can duplicate.
- [ ] No unsafe duplicate-execution path.

---

## 4. Monitization & integrations

- [ ] Payments + subscriptions behavior audited (webhook signature + idempotency, subscription lifecycle, entitlements).
- [ ] License + entitlement behavior verified; server-side truth is authoritative.
- [ ] External integrations classified: verified / unverified / blocked.
- [ ] No unsupported claims about live functionality.

---

## 5. Premium UI/UX

- [ ] Global design system is coherent (tokens, theme, typography, spacing, layout, radius, elevation, iconography, controls, states).
- [ ] Dark + light themes are intentionally designed.
- [ ] Interface feels premium, modern, distinctive; no generic dashboard template.
- [ ] Animations serve a meaningful purpose; respects `prefers-reduced-motion`; no layout thrashing.
- [ ] Interaction states are consistent.
- [ ] Chart + dense workflows remain usable (readability, density without clutter, panels).
- [ ] Accessibility + reduced-motion behavior considered.
- [ ] Existing pages do not look like unrelated templates.
- [ ] No fake data or fake interactions presented as real.
- [ ] Responsive behavior verified where tooling permits.

---

## 6. Admin & security

- [ ] Sensitive routes have explicit server-side authorization.
- [ ] Admin UI shows only real/intended sections; incomplete capabilities clearly marked.
- [ ] Sensitive operations protected with appropriate permissions + confirmation.
- [ ] Firebase rules reviewed for cache coherence + server/client boundaries.
- [ ] Secrets not in source, tests, or docs; env-accessors fail-closed when keys missing.
- [ ] No sensitive information in logs.

---

## 7. Long-term readiness

- [ ] Developer platform direction documented (API boundaries, auth, rate limiting, versioning, structured errors, tests). No fabricated endpoints.
- [ ] Desktop + mobile evolution documented; web stays functional.
- [ ] External integrations + licensing risks understood.
- [ ] Longer-term brokerage ambitions separate from current demo trading; not represented as licensed capability.

---

## How to classify and record

| Status | Meaning |
|---|---|
| PASS | Verified by actual execution/report. |
| FAIL | Blocked by a real environmental constraint; exact blocker documented + what's needed to continue. |
| BLOCKED | Missing credentials/infra/permissions; not a code defect. |
| NOT TESTED | We did not run it; the report says so plainly. |

**Rule:** never claim tests passed unless they were run; never claim a live integration works unless it actually was exercised. Keep the checklist in sync with implementation; update it after each significant change.
