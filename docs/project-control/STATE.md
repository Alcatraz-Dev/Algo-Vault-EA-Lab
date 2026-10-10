# AlgoVault — Project State (Verified 2026-10-10)

This file records what exists today, in one place. It is updated after every significant change; the full history of changes lives in `RECOVERY_LOG.md`.

## Baseline snapshot (pre-recovery)

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | `2def94bf0d675eda460d3bc6f265a6a45192ba88` |
| Status | Clean working tree |
| Build (`next build`) | Green |
| Type-check (`tsc --noEmit`) | Green |
| Lint (`eslint .`) | Fails — pre-existing `no-explicit-any` + `no-require-imports` (413 errors) + 1 functional defect (candels workspace ordering) |
| Test gate batch (chart/trading/unified/mobile/dashboard) | Green (93 / 32 / 112 / 140 / 8) |

## Current inventory (what the platform is today)

### Working / verified
- Production build, type-check, and a representative test batch are green at baseline.
- Canonical candle data engine (`lib/chart-engine`): normalization, aggregation, dedup, pagination of OHLC; server-side OHLC history path.
- Firebase RTDB-backed services (Auth + RTDB) with committed security rules.
- Stripe subscription/licensing, marketplace, copy trading, EA/marketplace flows, plugins runtime, Telegram/Discord delivery, analytics.
- The native chart and terminal (`components/pro-scalping-terminal/`) are functional: real candles, overlays computed from real data, drawing tools, viewport state machine, live-candle sync.
- Chart engine tests, trading tests, unified trading tests, mobile tests, and dashboard charts tests all pass.

### Partially implemented / unverified
- Deep-history capability (>300 bars) is available at data level; the UI does not yet communicate the limit, and no instrumented end-to-end browser test of viewport preservation on history prepend yet.
- Realtime feed: engine merges quotes and retains last-known history; a live session was not verified end-to-end in the inspected environment.
- Indicators/overlays: several computed in the terminal from real data, but the full indicator list has no shared-parity test.
- Smart Money structure: deterministic but simplified; BOS/CHoCH layer currently renders all event + swing labels (a confirmed visual congestion bug).
- Trading execution: APIs and flows exist but full end-to-end semantics, safety gates, idempotency, and broker reconciliation were not audited.
- Admin/Pro gating, account entitlements, and API-side authorization: routes exist; dedicated audit not completed.
- Firebase security-rule, cache-coherence, and server/client boundary audit: not completed.
- Strategy research/backtesting correctness and future-leakage coverage: not independently verified.

### Blockers / risks
- No guaranteed realtime feed in an inspected session (`MARKET CLOSED`/`RECONNECTING` observed) — the UI must stay honest about connection state.
- Lint hygiene on the existing tree (`no-explicit-any`, `no-require-imports`) is pre-existing; sweeping it wholesale is tracked as P3/LINT, not a priority in the first batch.
- Environment: headless browser for `test:e2e-viewport` is not installed here; mobile app is not run locally.
- Secrets are not in the repo (gitignored `.env.local` + committed `.env.example` template); the repo cannot run a real Stripe/Firebase backend locally without them.

## Priority queue (current)

| Phase | Work | Status |
|---|---|---|
| 0 — Discovery | Baseline report written | Done |
| 1 — Full read-only audit | Route map, capability map, API boundary map, bug register | In progress |
| 2 — Master documentation | `docs/project-control/` set (this dir) | In progress |
| 3 — Critical reliability/security fixes | E.g., candels workspace ordering bug (lint-driven) | Planned |
| 4 — Shared design system + global shell | Design tokens + theme + shell components | Planned |
| 5 — Pro terminal / chart reliability | Data + rendering fixes, viewport/drawing behavior, indicator validation | Planned |
| 6 — Progressive product redesign | Marketplace → Candel → account/onboarding → subscriptions/checkout → admin | Planned |
| 7 — Remaining architecture/integration work | High-priority defects, test coverage, observability, optional integrations | Planned |
| 8 — Release readiness | Full gate suite, release-readiness report | Planned |

## Completed work blocks

| Block | Date | What changed |
|---|---|---|
| BR-000 | 2026-10-10 | Docs baseline: `docs/project-control/BASELINE.md` |
| BR-000 | 2026-10-10 | Docs: created `docs/project-control/` directory skeleton (STATE, ARCHITECTURE, FEATURE_INVENTORY, BUGS_AND_REGRESSIONS, ROADMAP, DECISIONS, RESOURCES_AND_LICENSES, TESTING_STRATEGY, RELEASE_CHECKLIST, MASTER_CONTEXT) |

## Pending work

- P0: candels workspace ordering bug (lint-driven fix).
- P0: re-run tsc + lint + build together to confirm no regression from BR-000 repairs.
- P1: confirm chart + terminal data/rendering gates (tsc, focused lint, chart tests, browser-driven interaction tests).
- P2: Smart Money structure label congestion fix + regression test.
- P2/P3: Firebase security, cache coherence, server/client boundary audit.
- P3: Lint hygiene sweep (optional); deep-history UI limit; realtime session validation.
