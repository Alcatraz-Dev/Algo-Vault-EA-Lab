# AlgoVault Platform Audit — 2026-10-04

## Status and scope

This is a **partial, evidence-backed architecture audit**, not a claim that every route and trading path has been exhaustively exercised. Repository-wide route enumeration and source inspection were used to map the major subsystems, with focused code/test/browser inspection around the native chart and trading terminal. The checkout already contained many unrelated local edits at the start; no broad cleanup, staging, or commit was performed.

The highest-priority finding is confirmed in the currently served `/account/trading` page: the Pro terminal chart displays 691 candles and a continuous viewport, but its default structure layer plots swing labels alongside BOS/CHoCH. The resulting labels pile up over price action and make a normal view hard to read. A user-provided screenshot independently shows this visual congestion. The current market-structure detector is also structurally simple: a fixed three-bar pivot rule, BOS based on sequentially higher swing highs/lower swing lows, and post-hoc direction flips for CHOCH. It needs methodology-focused validation before it is treated as a professional Smart Money engine.

## Working-tree safety boundary

The starting checkout was already modified on `main` across pages, chart code, chart layer configuration, watchlist, and tests. These edits were not reset or treated as a clean baseline. The latest status snapshot still includes those paths plus a new `components/trading/ChartToolbar.tsx`; review ownership before editing or committing any of them. No commit/push/deploy was performed.

## Capability map

Legend: **WORKING** means a functioning implementation was found in code and/or exercised; **PARTIAL** means a real implementation exists but important parts remain unverified or incomplete; **BUGGY** indicates an observed defect; **PLACEHOLDER** indicates mock/static behavior; **DUPLICATED** indicates competing implementations; **MISSING** means not found in the inspected scope; **NEEDS REARCHITECTURE** means boundaries or ownership are unsuitable for the target reliability.

| Domain | Classification | Evidence / gap |
|---|---|---|
| App routing and page/layout organization | PARTIAL | Next App Router pages span trading, market intelligence, strategy, performance arena, account/admin, extension/MCP integrations. A route inventory exists in-repo, but not every screen has been functionally audited. |
| Native chart renderers | DUPLICATED / PARTIAL | `ProTerminalChart` and shared `TradingChart/ChartEngine` both use lightweight-charts and shared `useLiveCandles`, but have separate rendering and overlay lifecycles. The terminal was inspected in-browser at 691 bars. |
| Canonical candle/timeframe/data engine | WORKING core / PARTIAL provider coverage | `lib/chart-engine` normalizes, aggregates, dedupes and pages candles; endpoint routes through server-side market sources. Standalone chart engine tests pass. Provider depth is conditional and the shallow provider can stop at a history boundary. |
| Historical paging / viewport preservation | PARTIAL | Engine exposes `loadOlder`; near-edge triggers and prepend compensation exist in chart renderers. Browser network showed OHLC range requests return 200; no instrumented pan-to-history end-to-end test was completed. |
| Realtime updates / polling | PARTIAL | Canonical engine merges quotes and retains last-known history; shared `useLiveCandles` adapter exists. The terminal showed `MARKET CLOSED`/`RECONNECTING` for the inspected XAUUSD snapshot, so a fresh live market session was not verified. |
| Coordinate transforms / anchored overlays | PARTIAL | `ChartAnchoredOverlay` binds zones and profile geometry to chart logical/time and price transforms and cleans subscriptions/DOM nodes. Drawings still use SVG + chart transforms and require lifecycle/interaction testing. |
| Indicator calculations | DUPLICATED / PARTIAL | Shared analytics and indicator contracts exist, while the terminal still calculates several indicators locally. Existing test suite checks aligned EMA/SMA/RSI examples, not the complete advertised indicator list or shared parity. |
| Smart Money structure | BUGGY / PARTIAL | Canonical `detectStructure` is deterministic but simplified. Its chart adapter returns swing highs/lows and BOS/CHOCH, while terminal's `BOS / CHoCH` layer rendered all event labels. Screenshot and live browser confirmed the resulting congestion. |
| Layer visibility and overlay lifecycle | PARTIAL | Layer catalog and explicit availability exist. Marker plugins and chart layers have multiple effect-owned refs; cleanup and duplicate behavior need systematic toggle/symbol/timeframe tests. |
| Orders, positions, account connections | PARTIAL | Trading Terminal page and order panel components/API routes exist. Browser showed an account summary and an offline gateway; no order was placed and no broker execution was claimed. |
| Paper/demo and live execution | NEEDS REARCHITECTURE / PARTIAL | APIs and execution flows exist in the repository, but full end-to-end semantics, safety gates, idempotency and broker reconciliation were not verified in this audit slice. |
| Strategies, backtesting, replay, Strategy Lab / EA Lab | PARTIAL | Engine/lab/backtest/replay implementations and tests are present. Results correctness and future-leakage coverage need independent representative verification. |
| AI analysis, router and copilots | PARTIAL | Many API and library modules are present. Provider routing, evidence provenance, fallbacks, and non-fabrication were not exhaustively exercised. |
| Workflows, marketplace, alerts, journal | PARTIAL | Implementations/routes exist, with unit test coverage in several domains. Cross-feature lifecycle and authorization were not audited end-to-end. |
| TradingView, extension, MCP | PARTIAL | Integrations and Chrome extension harness exist. Capability claims, permission boundaries and real account synchronization remain to be tested. |
| Firebase RTDB / caching / server-client boundaries | PARTIAL | Firebase appears in platform dependencies and application code; no full security-rule, cache-coherence, or server/client boundary audit was completed here. |
| Admin / Pro gating | PARTIAL | Admin and account/pro routes exist. Entitlement enforcement and API-side authorization require a dedicated audit. |
| Watchlist UI | PARTIAL | Browser snapshot showed live watchlist quotes; requests returned 200. Persistence, invalid stored symbols and multiple-component polling behavior remain unverified. |

## Chart foundation findings

1. **Data:** the native chart stack now has a canonical candle engine and server-side OHLC history path; visible datasets can exceed 300 bars. In the inspected browser session the chart reported 691 bars. The history API reports whether deep history is actually available; clients should not imply an unbounded feed when only shallow history is configured.
2. **Incremental update:** renderer paths distinguish forming-tail updates from provider rewrites and use `series.update()` for the tail. Reconciliation/initial load can still use full `setData`, as required for a rewrite or prepend.
3. **History navigation:** chart renderers request earlier pages near the left edge and shift the visible logical range by the true count of prepended candles. Test coverage includes pure prepend count/range helpers and engine history merge; browser validation confirmed OHLC traffic but not a controlled viewport-preservation gesture.
4. **Coordinates:** anchored DOM zones and profile bars are mapped via chart logical/time and price transforms. The screenshot confirms zones are visually on the price chart, but does not prove all overlay classes remain anchored during pan, zoom and symbol changes.
5. **Rendering defect observed:** default `bosChoch` is enabled and the adapter emits swing markers as well as breaks; the terminal renders all those labels as marker text, creating dense repeated `swing_high`/`swing_low`/BOS labels. This is a confirmed usability defect and a signal that layer semantics need separation and density-aware rendering.
6. **Chart-type handoff defect found during audit:** shared TradingChart accepts `onNearHistoryEdge` and provides chart-style control, but the Account Trading page's inserted toolbar/drawing/chart-type state was not fully wired to `ProTerminalChart` in the inspected diff. Do not assume the newly surfaced controls are functional until interaction-tested.
7. **Testing limitation:** `npx jiti tests/chart-engine/chart-engine.test.ts` passed 68/68 and `npx jiti tests/pro-scalping-terminal.test.ts` passed 24/24 before the interrupted in-progress repair; the subsequent full TypeScript run failed on edits in the terminal file, and targeted ESLint exposed existing plus current issues. There is therefore **no final green verification** for the in-progress terminal changes. The known compile errors and affected working tree must be resolved and retested before shipping.

## Phased plan and acceptance gates

### Phase 1 — Audit and diagnosis
- Complete a route/page/layout map, capability inventory, service/data-flow diagrams, API auth boundary map, and evidence-indexed gap matrix.
- For each major domain, run existing tests and inspect real user flows; label unverified behavior explicitly.
- Gate: auditable report with route coverage and owner/evidence for each critical capability.

### Phase 2 — Native chart/data foundation
- Keep the canonical `lib/chart-engine` data engine as the source of truth; define one shared renderer/data contract for both chart entry points.
- Verify timestamp semantics, provider session/timezone behavior, ordering, missing bars, deep-history capability, backpressure, and tail-vs-history update behavior.
- Add browser/integration tests for 1k+ bars, historical page prepend without viewport jump, follow-live behavior, chart resize, and symbol/timeframe switch.
- Gate: no fabricated data, correct OHLC and timestamps, stable viewport, and measurable performance on a representative large dataset.

### Phase 3 — Indicators and overlay engine
- Consolidate calculations in pure deterministic functions, with explicit warm-up/missing-data semantics and timestamp-aligned outputs.
- Split swing classifications, BOS/CHoCH, liquidity, zones, signals, drawings and AI annotations into independent layers with separate visibility controls.
- Add density-aware rendering (viewport culling/aggregation/label decluttering) and a lifecycle test matrix for on/off/parameter/symbol/timeframe transitions.
- Gate: every visible item ties to a candle/time/price source and no duplicate/stale series, markers or listeners remain after toggles.

### Phase 4 — Strategy engine and integrations
- Compare strategy, backtest and replay calculations on identical candles and eliminate look-ahead/data-model drift.
- Verify all results with deterministic fixtures, independent calculations and integration tests.
- Gate: fills, fees, slippage, risk, and live/paper state are traceable; unsupported broker/provider capabilities are clearly reported.

### Phase 5 — Trading workflows and product cohesion
- Verify account connection, order, position, pending-order, alert and journal flows; enforce server-side entitlements and authorization.
- Audit AI provenance/fallbacks and extension/MCP/TradingView permissions before broadening product claims.
- Gate: simulated and live paths are distinct, idempotent and safe; UI terminology and account/market/strategy state are consistent.

### Phase 6 — Performance, security and polish
- Benchmark CPU, memory, render time and network frequency at realistic chart sizes; profile before adding workers/WebGL.
- Audit Firebase rules, caching, secret boundaries, admin/Pro enforcement, mobile layout and error recovery.
- Gate: regression suite passes, browser critical flows work, and no unverified capability is presented as production-ready.

## Immediate next actions

1. Repair the current unfinished chart-type/terminal wiring and obtain clean `tsc`, focused ESLint, chart tests and diff checks.
2. Reduce the default structure layer to actual BOS/CHoCH break events or otherwise separate event types; add a regression test proving swing labels are not included in that control.
3. Exercise historical paging via a controlled browser gesture and assert viewport timestamps before/after the prepend.
4. Continue the repository audit by domains, starting with execution safety, API auth/Pro gating, backtest/replay data provenance, then AI and integration claims.

## Verification record

- `npx jiti tests/chart-engine/chart-engine.test.ts`: 68 passed, 0 failed (before the latest unfinished edits).
- `npx jiti tests/pro-scalping-terminal.test.ts`: 24 passed, 0 failed (before the latest unfinished edits).
- `npx tsc --noEmit --pretty false`: **failed after the latest unfinished edits** with two TypeScript errors in `ProTerminalChart.tsx` (a missing `visiblePriceSeriesRef` and unsafe crosshair data cast). It was not rerun after that point.
- Targeted ESLint: **failed** with multiple findings. Some findings are in pre-existing code (e.g., render-time ref reads, synchronous effect state updates, `any` usage); the active terminal diff also needs lint cleanup. No suppressions were added to hide them.
- `git diff --check`: passed after the last recorded check, before subsequent terminal file edits; rerun required.
- Browser page: `http://localhost:3000/account/trading` remained served by the pre-existing dev server. Chart showed 691 bars and OHLC/quote/watchlist responses were observed as HTTP 200. Screenshot exposed the congested structure overlay. The server process was left running.
