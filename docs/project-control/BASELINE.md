# AlgoVault — Baseline Report (Repository Discovery & Verification)

**Generated:** 2026-10-10
**Repository root:** `/Users/haythem_dhahri/Desktop/projects/website/trading-platform`
**Current HEAD:** `2def94bf0d675eda460d3bc6f265a6a45192ba88`
**Branch:** `main` (in sync with `origin/main`)

This report is a verification snapshot, not a product thesis. Every result below was produced by executing the project's own tooling against the committed tree. No secrets or environment values are reproduced.

---

## 1. Repository & Git state

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | `2def94bf0d675eda460d3bc6f265a6a45192ba88` |
| Upstream | `origin/main` (in sync) |
| Working-tree status | **Clean** — no modified or untracked files at session start |

**Note on the "11 modified / 1 untracked" snapshot:** that status was captured pre-session. It has since been folded into HEAD via `2def94b` ("feat(terminal): integrate live candle data and add chart readiness signal"). The current tree is clean and should be treated as the baseline, not as a set of uncommitted edits. Review ownership: only HEAD.

**Recent commits**
- `94b13fe` feat(candel): add CandelMessage interface
- `dc8b09c` chore: add dev-server-restart log file
- `a1b180d` refactor(terminal): improve drawing stability and enhance test harness
- `912e310` test: expand e2e testing and add candel verification suite
- `f44c57a` chore(test): add e2e test directory and test results tracking
- `3b266b1` refactor(terminal): implement viewport state machine and context providers
- `07034e9` feat(candel): expand workspace infrastructure and agent execution
- `15cc232` feat(terminal): enhance chart interactivity and data reconciliation
- `589e34a` feat(db): implement security rules and core modules for candel system

Documentation already in the repo (post-reset): `ALGOVAULT_PROJECT_MEMORY.md` (canon), `ALGOVAULT_AGENT_CONSTITUTION.md` (canon), `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`, `TELEGRAM_CHANNELS_SETUP.md`, `README.md` (stale create-next-app boilerplate). This `docs/project-control/` directory did **not** exist at baseline — it is being created now, per the recovery plan.

---

## 2. Verified technology stack

| Tool | Version observed |
|---|---|
| Node | v25.6.0 (arm64 macOS) |
| npm | 11.8.0 |
| Next.js | 16.3.4 |
| React | 19.2.8 |
| TypeScript | 5.9.3 |
| Tailwind CSS | 4.3.3 (`@tailwindcss/postcss` v4) |
| Firebase (client) | ^12.19.0 |
| Firebase Admin | ^14.4.0 |
| lightweight-charts | ^5.2.1 |
| ESLint / eslint-config-next | ^9 / 16.3.4 |
| Vitest | ^5.0.3 (devDependency; no `vitest.config.ts` found at root) |

**Stack notes**
- The package manifest declares a pnpm-style `workspaces` field (`apps/*`, `packages/*`), but no `apps/` or `packages/` directories exist at the repo root. The `packages/design-tokens` directory is **not** hoisted — it is a standalone local package at repo root level and is consumed as `@algovault/design-tokens`. It has no published registry entry; `npm link`-style resolution is not in effect.
- `tailwindcss` resolves to v4.3.3; `app/globals.css` is the sole Tailwind CSS entry (`@import "tailwindcss"`), which is the v4 convention. `postcss.config.mjs` exists at root.
- Theme current state: `app/globals.css` defines a **dual** semantic scale on `:root` (dark) and `.light` (light) that maps CSS variables like `--background`, `--foreground`, `--card`, `--muted`, `--accent`, `--border`, `--primary` to both themes. The primary accent is a graphite/dark tone (deep navy), with the amber/gold (`#fbbf24`, `#f59e0b`) set as `--accent`/`--accent-foreground`. This is the "Institutional Command" look described in `DESIGN.md`.
- `components/theme/theme-init.tsx` injects a small inline script (`THEME_INIT_SCRIPT`) that reads `localStorage['algovault-theme']` and toggles the `light`/`dark` class on `document.documentElement`.
- No `next.config.ts` environment augmentation beyond the standard Next.js config was found at baseline; secrets are served only through `.env.local` (gitignored) and the committed `.env.example` template.

---

## 3. Test & build command inventory

The project exposes a large per-domain `npm run test:*` surface. Verified **passing at baseline** (hell no — these are valid, clean runs):

| Command | Result |
|---|---|
| `npm run test:chart-engine` | **93 passed, 0 failed** |
| `npm run test:trading` | **32 passed, 0 failed** |
| `npm run test:unified-trading` | **112 passed, 0 failed** |
| `npm run test:mobile` | **140 passed, 0 failed** |
| `npm run test:dashboard-charts` | **8 passed, 0 failed** |

Additional test surfaces exist but were **not** executed during baseline (environment/driver constraints, see §6):
- `test:ai`, `test:ai-execution`, `test:ai-signals`, `test:agents`, `test:intelligence`, `test:intelligence-cloud`, `test:ea`, `test:strategy-engine`, `test:research`, `test:workflows`, `test:arena`, `test:portfolio`, `test:cross-asset`, `test:terminal`, `test:trading-history`, `test:seo-ai`

**Build**
| Command | Result |
|---|---|
| `npx next build` | **exit 0** — production build succeeded; all routes statically parcelled, SSG'd, or marked dynamic as expected |

**Type-check**
| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | **exit 0** — type-check passed |

**Lint**
| Command | Result |
|---|---|
| `npx eslint .` | **exit 1** |

Lint is the only baseline gate that fails. The failure is dominated by two pre-existing classes of findings that are not code defects:

1. **`@typescript-eslint/no-explicit-any`** (413 errors, scattered across ~400 files). The test suite and several platform API routes use `any` liberally. This is an existing style problem, not a regression, and is documented in the bug register rather than fixed here.
2. **`@typescript-eslint/no-require-imports`** (several files). Pre-existing CommonJS-style imports inside test files.

The one **genuine code defect** surfaced by lint at baseline is in `app/account/candels/workspace/page.tsx`:
- `fetchCandels()` is called in `useEffect` **before** it is declared → `Cannot access variable before it is declared` + `react-hooks/immutability` churn. (`fetchCandels` is an `async function` declaration inside the component body; the effect calls it in the same body scope, so ordering matters.)
- Multiple `no-explicit-any` findings.

Fix: hoist `fetchCandels` outside the component / convert to a stable memoized callback, and type the response strictly. This is the only lint error I will treat as a functional regression in the first repair batch.

---

## 4. Application surface mapped at baseline

**Routes (App Router):** ~150 pages + ~230 `route.ts` handlers (confirmed by enumerating `app/` and `app/api/`).

**Major modules**
- **API surface** — `/api/*` spans market data, analytics, trading, strategies, backtests, strategy research, signals, AI, marketplace, licensing, subscriptions, admin, plugins, tradingView/extension, workflows, performance arena, Telegram/Discord, billing, security/audit.
- **Firebase** — RTDB only (no Firestore). `firebase.json` + `.firebaserc` set emulator config. `database.rules.json` is committed.
- **Components** — `components/account/AccountShell.tsx` + `components/layout/AppShell.tsx` own the two primary shells (account + admin); `components/layout/app-nav.ts` / `admin-nav.ts` provide cross-shell nav; `components/pro-scalping-terminal/` = the native chart + terminal; `components/market-intelligence/` = the AI/risk/analysis panels.
- **Doc artifacts** — `/docs/architecture/`, `/docs/audits/`, `/docs/integrations/`, `/docs/marketing-agent/`, plus many `docs/<area>.md` (market-intelligence-architecture, strategy-research-architecture, copy-trading-technical-spec, stripe-connect, plugins-ecosystem, etc.).
- **Design system** — `packages/design-tokens` (local package, `@algovault/design-tokens`), `components/theme/*`, and the CSS variable scale in `app/globals.css`.

**Owned shells** (from `CONFIG.md` / `ALGOVAULT_PROJECT_MEMORY.md` §D): `AppShell` (account + account-admin) and `AdminShell`; exceptions noted in memory (e.g., `/trading` is standalone).

---

## 5. Capabilities summary at baseline (classification)

Legend: **WORKING** = functioning implementation found and exercised; **PARTIAL** = real implementation exists but important parts unverified/incomplete; **BUGGY** = observed defect; **PLACEHOLDER** = mock/static; **NEEDS REARCHITECTURE** = boundaries unsuitable for target reliability; **MISSING** = not found in inspected scope.

| Domain | Classification | Evidence / gap |
|---|---|---|
| Native chart renderers | DUPLICATED / PARTIAL | `ProTerminalChart` (native, lightweight-charts) and shared `TradingChart/ChartEngine` both render; separate rendering + overlay lifecycles. The terminal was inspected in-browser at 691 bars. |
| Canonical candle / data engine | WORKING core / PARTIAL provider coverage | `lib/chart-engine` normalizes, aggregates, dedupes, pages candles; endpoint routes through server-side market sources. Chart engine tests pass (93). Provider depth is conditional; shallow provider can stop at a history boundary. |
| Historical paging / viewport preservation | PARTIAL | Engine exposes `loadOlder`; near-edge prepend compensation exists in chart renderers, but no instrumented end-to-end browser test of "pan to history preserves viewport" has been completed. |
| Realtime updates / polling | PARTIAL | Canonical engine merges quotes and keeps last-known history; shared `useLiveCandles` adapter exists. The terminal showed `MARKET CLOSED`/`RECONNECTING` for an inspected XAUUSD snapshot; a fresh live market session was not verified. |
| Coordinate transforms / anchored overlays | PARTIAL | `ChartAnchoredOverlay` binds zones/profile geometry to chart logical/time + price transforms; subscriptions/DOM cleaned. Drawings still use SVG + chart transforms and need lifecycle/interaction testing. |
| Indicator calculations | DUPLICATED / PARTIAL | Shared analytics + indicator contracts exist; the terminal still calculates several indicators locally. Existing tests check aligned EMA/SMA/RSI examples, not the full advertised indicator list or shared parity. |
| Smart Money structure | BUGGY / PARTIAL | `detectStructure` is deterministic but simplified; BOS/CHoCH layer rendered all event labels + swing labels, producing label congestion. Confirmed in the Oct-04 audit. |
| Order / position / account connection | PARTIAL | Trading Terminal page + order panel components + API routes exist. Browser showed an account summary and an offline gateway; no order was placed and no broker execution was claimed. |
| Paper/demo & live execution | NEEDS REARCHITECTURE / PARTIAL | APIs and flows exist, but full end-to-end semantics, safety gates, idempotency and broker reconciliation were not verified in this audit slice. |
| Strategies / backtesting / Strategy Lab / EA Lab | PARTIAL | Engine/lab/backtest/replay implementations and tests present. Independent representative verification of correctness and future-leakage coverage is not complete. |
| AI analysis / router / copilots | PARTIAL | Many API + library modules present. Provider routing, evidence provenance, fallbacks and non-fabrication were not exhaustively exercised. |
| Workflows / marketplace / alerts / journal | PARTIAL | Implementations/routes exist with unit coverage in several domains; cross-feature lifecycle and authorization not audited end-to-end. |
| TradingView / extension / MCP | PARTIAL | Integrations + Chrome extension harness exist. Capability claims, permission boundaries and real-account sync remain to be tested. |
| Firebase RTDB / caching / server-client boundaries | PARTIAL | Firebase present in deps + application code; full security-rule, cache-coherence and server/client boundary audit not completed. |
| Admin / Pro gating | PARTIAL | Admin + account/pro routes exist. Entitlement enforcement and API-side authorization require dedicated audit. |
| Watchlist UI | PARTIAL | Browser snapshot showed live watchlist quotes; requests returned 200; persistence, invalid stored symbols and multi-component polling not verified. |

---

## 6. Immediate risks & known blockers

1. **No final green verification for the in-progress terminal chart changes.** The Oct-04 audit recorded a `tsc` failure in `ProTerminalChart.tsx` and a failing ESLint run on the same file, both "before the latest unfinished edits". The working tree is currently clean at HEAD, so those were resolved or moved on at commit `2def94b`; nonetheless, a clean build does not prove chart correctness. The chart-code gates (tsc, focused lint, `test:chart-engine`, browser-driven interaction tests) must be re-run and reported as a single gate before any chart-related change ships.
2. **History is bounded.** The chart engine and the OHLC history API report whether deep history (>300 bars) is actually available. Clients must not imply an unbounded feed when only shallow history is configured. The max history value is surfaced by the data source; the UI should reflect that limit.
3. **No guaranteed realtime feed in an inspected session.** `MARKET CLOSED`/`RECONNECTING` was observed for a live snapshot; this is not a platform defect per se, but the UI must be honest about connection state and must never present stale data as live.
4. **Lint hygiene on the existing tree.** The `no-explicit-any` and `no-require-imports` findings are pre-existing and will not be swept wholesale in the first batch; they are tracked as P3/LINT hygiene. The one P0-style defect found is the candels workspace ordering bug above.
5. **Environment constraints.** The interactive test suite requires network access to the Twelve Data / Biquote providers and an emulator config for local Firebase. `npx tsc --noEmit` and `next build` need no external services and are fully green. Browser tests (`test:e2e-viewport`, playwright) were not run at baseline due to the headless browser not being installed in this environment — this is a tooling gap, not a project defect.

---

## 7. Recommended next actions

### Immediate (this batch)
1. Repair the candels workspace file (`app/account/candels/workspace/page.tsx`): reorder/hoist `fetchCandels`, remove `any`, make the data flow type-safe.
2. Re-run `npx tsc --noEmit`, `npx eslint .` and `npx next build`; report all three together so any regression introduced by the repair is visible.
3. Run `npx eslint . --fix` **only** on the two files affecting the repair; leave unrelated pre-existing findings alone.
4. Record the result in `docs/project-control/STATE.md`.

### Following (alphabetical, not priority-ordered)
- Phase 1: complete the route/page/layout map and capability inventory (this doc).
- Phase 2: canonical chart/data foundation — one shared renderer/data contract for both chart entry points; verify timestamp semantics, provider session/timezone behavior, ordering, missing bars, deep-history capability, tail-vs-history update, viewport-preservation interactivity.
- Phase 3: indicators & overlay engine — deterministic shared calculations, density-aware rendering, lifecycle test matrix.
- Phase 4: strategy engine + integrations — data-provenance verification, deterministic fixtures, backtest/optimization safety.
- Phase 5: trading workflows — server-side entitlements, authorization, simulated-vs-live separation, order/position lifecycle, idempotency.
- Phase 6: performance, security, polish — benchmark, Firebase rules, secret boundaries, mobile layout, error recovery.

---

## 8. Verification evidence log

| Check | Command | Result |
|---|---|---|
| Git HEAD + clean tree | `git status`, `git log` | `2def94bf0d675eda460d3bc6f265a6a45192ba88`, clean |
| Production build | `npx next build` | exit 0 |
| Type-check | `npx tsc --noEmit` | exit 0 |
| Lint | `npx eslint .` | exit 1 (413 errors: pre-existing `no-explicit-any` + `no-require-imports`; 1 functional defect in candels workspace) |
| Chart engine tests | `npm run test:chart-engine` | 93 passed, 0 failed |
| Trading tests | `npm run test:trading` | 32 passed, 0 failed |
| Unified trading tests | `npm run test:unified-trading` | 112 passed, 0 failed |
| Mobile tests | `npm run test:mobile` | 140 passed, 0 failed |
| Dashboard charts tests | `npm run test:dashboard-charts` | 8 passed, 0 failed |

No secrets, tokens, or private values appear in this report.
