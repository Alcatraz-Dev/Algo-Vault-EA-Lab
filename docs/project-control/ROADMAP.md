# AlgoVault — Roadmap

Organized into **Immediate reliability and safety**, **Existing functionality repairs**, **Architecture improvements**, **Premium UI/UX redesign**, **Trading & market-data improvements**, **Intelligence improvements**, **Developer platform**, **Desktop and mobile evolution**, **Longer-term regulated brokerage ambitions**.

Status column: **CONFIRMED** (in the plan), **OPTIONAL** (future idea).

| Phase | Workstream | Items | Order | Status |
|---|---|---|---|---|
| 1 | Baseline | Discover repo, map routes/modules, run baseline checks, record failures, flag risks. | 1 | DONE (BASELINE.md) |
| 2 | Full read-only audit | Route/page/layout map, capability inventory, service/data-flow diagrams, API auth boundary map, evidence-indexed gap matrix. | 1 | IN PROGRESS |
| 3 | Master documentation | `docs/project-control/` set (STATE, ARCHITECTURE, FEATURE_INVENTORY, BUGS, ROADMAP, DECISIONS, RESOURCES, TESTING_STRATEGY, RELEASE_CHECKLIST, MASTER_CONTEXT). | 1 | IN PROGRESS |
| 4 | Critical reliability & security fixes (P0) | Fix `candels/workspace` ordering bug; re-run tsc + lint + build together; confirm graph is green. | 3 | PLAN |
| 5 | Chart & market-data reliability (P1) | Fix BOS/CHoCH label congestion; separate event types; density-aware rendering; regression test; viewport-preservation browser test; dashboard chart engine narrative fix (`test:dashboard-charts` narrative still says "four."); deep-history UI limit. | 3 | PLAN |
| 6 | Indicators & overlays (P1) | Consolidate to shared deterministic functions; separate swing/BOS/CHoCH/liquidity/zones/signal/drawings/AI annotation layers; lifecycle test matrix. | 4 | PLAN |
| 7 | Trading workflow safety (P1) | Server-side entitlements + authorization; simulated-vs-live separation; order/position/pending-order lifecycle; idempotency; broker reconciliation; safety gates. | 5 | PLAN |
| 8 | Admin / Pro gating (P2) | Route-by-route admin/pro authorization audit; entitlement matrix; permission checks. | 5 | PLAN |
| 9 | Firebase / caching / server-client boundaries (P2) | Full security-rule audit; cache-coherence + server/client boundary documentation; change sets + rollback plan. | 5 | PLAN |
| 10 | Strategy engine & integrations (P2) | Compare strategy/backtest/replay on identical candles; eliminate look-ahead/data-model drift; deterministic fixtures + integration tests. | 4 | PLAN |
| 11 | Design system & global shell (P2) | Shared design tokens; theme management (dark + light intentionally); typography, spacing, layout, border radius, elevation, iconography, buttons, inputs, selects, dialogs, dropdowns, tooltips, tabs, nav, tables, data grids, charts widgets, loading/empty/error states, responsive, focus/keyboard, motion tokens. | 7 | PLAN |
| 12 | Global application shell (P2) | Navigation, sidebars, headers, user menus, workspace switching, notifications, breadcrumbs, responsive nav, theme controls, loading/navigation states. | 7 | PLAN |
| 13 | Pro Terminal redesign (P2) | Chart readability, information density without clutter, market/instrument selection, timeframe controls, watchlists, indicator controls, drawing tools, position/order panels, risk info, market/connection/account state, clear demo/live labeling, responsive panels, keyboard+pointer interaction. | 7 | PLAN |
| 14 | Marketplace redesign (P3) | Product discovery, search/filter, categories, product cards, credible performance info, transparent pricing, license/compatibility details, product pages, purchase flows, free-vs-paid, loading/empty/error. | 7 | PLAN |
| 15 | Candel Intelligence redesign (P3) | Evidence-first presentation, facts vs interpretations, confidence/uncertainty, source/timeframe visibility, explainable conclusions, market context, risk, limitations, historical setup, clear WAIT/NO_TRADE states, drill-down. | 7 | PLAN |
| 16 | Account, auth, onboarding, subs & checkout redesign (P3) | Clear plans/entitlements, transparent billing, subscription/license state, purchase confirmation, payment error recovery, accessible forms, success/failure feedback. | 7 | PLAN |
| 17 | Admin redesign (P3) | Users/products/orders/subscriptions/licenses/affiliates/payments/trading integrations/system health/audit/config; only real/intentional sections; permission-protected sensitive ops + confirmation. | 7 | PLAN |
| 18 | Developer platform visual foundations (P3) | API documentation, auth, SDK install, examples, market-data endpoints, intelligence endpoints, strategy/backtesting, execution APIs, webhooks, usage/limits, errors/troubleshooting. No fabricated endpoints. | 7 | PLAN |
| 19 | Business logic / charts consistency between modules (P2) | Reduce duplicated chart renderers into a single shared renderer/data contract; remove redundant paths. | 3 | PLAN |
| 20 | Testing strategy (P2) | Unit, integration, e2e, database, trading-safety, payment/webhook, UI regression, visual verification, mobile, external-integration limitations. | 1 | PLAN |
| 21 | Observability (P3) | Structured logging + diagnostics; async-workflow failure/retry/timeout/inconsistency observations. | 9 | PLAN |
| 22 | Developer platform API & SDK (P4) | Candidate API boundaries; auth; rate limiting/usage metering; licensing constraints; phased roadmap; versioning + structured errors + tests. | 11 | OPTIONAL |
| 23 | Desktop & mobile evolution (P4) | Shared business logic + API contracts; authentication/realtime; charting constraints; platform capabilities; offline where relevant; secure credential handling; distribution/upgrade/crash reporting/testing. | 12 | OPTIONAL |
| 24 | Longer-term regulated brokerage (P4) | Separate from current demo trading; never represented as existing licensed capability. | 12 | OPTIONAL |
| 25 | ERPNext optional integration (P3) | Disable by default; verify auth/credentials/data mapping/retry/idempotency/error handling/sync direction/duplicate prevention/permissions/recovery before enabling. | 9 | OPTIONAL |

### Sequencing rules
- **Do not redesign the entire application in one uncontrolled change.** Use the 12-step redesign sequence (audit → document direction → tokens → shell → pro terminal → marketplace → candel → account/onboarding/subs/checkout → admin → developer platform → verify all routes → regression checks).
- **No security fix relies solely on client-side validation.**
- **No unverified API is presented as working.**
- **No cherry-picked real-data claims** without having exercised them.
- **No unplanned feature expansion** during the initial audit; during implementation, repair first.
- New capabilities require a documented product purpose, architectural location, dependencies, and verification strategy.

### Phase gates
- **Phase 6 & 7** have acceptance gates: fully verified fixes + regression tests; design system with both themes intentionally designed; chart terminal with reliable interactions; all existing routes consistent; responsive + accessibility + reduced-motion checked; no generic dashboard templates; no fake data/interactions; no breaking business-logic changes.
- **Phase 8 release readiness** requires: full test suites, `tsc` + `lint` + production build, security-sensitive review, database + API compatibility, payment/trading safeguard review, key user journeys, UI consistency + responsiveness, documentation updated, unresolved-risk register.
