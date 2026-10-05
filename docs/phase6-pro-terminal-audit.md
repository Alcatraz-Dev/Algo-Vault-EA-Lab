# Phase 6 — Pro Terminal & Native Chart Audit

**Scope:** source-level audit of the existing Pro terminal chart/workspace, chart toolbar, drawing utilities, chart layers, coordinate bridge, and the Phase 5/October platform audit. This is not a claim that every market flow was exercised in a live browser. No second chart or terminal system is warranted.

Classification: `WORKING`, `PARTIALLY_WORKING`, `BUGGY`, `PLACEHOLDER`, `DUPLICATED`, `UNSTABLE`, `NEEDS_REFACTOR`, `NEEDS_REARCHITECTURE`.

## Findings before the Phase 6 code change

| Area | Classification | Evidence and limitation |
| --- | --- | --- |
| Pro Scalping Terminal / shared terminal chart | `WORKING` / `PARTIALLY_WORKING` | Strongest implementation is `/account/scalping-terminal` composed around `ProTerminalChartWorkspace` and the single `ProTerminalChart`. Native lightweight-charts candles, chart types, toolbar, data layers, live quote/status, progressive-history hooks, and trading overlays are present. A full live-market session and all route interactions were not re-exercised for this phase. |
| Scalping Terminal vs Live Trading Terminal | `PARTIALLY_WORKING` | These are different host workflows over the shared chart/workspace, not a reason to add a new chart. The Phase 5 audit documents gaps in the live trading page and unverified host wiring; those findings remain open unless separately retested. |
| Trading Studio | `WORKING` as a separate product / `PARTIALLY_WORKING` integration | Trading Studio is the separate workflow/strategy builder. Reuse it through adapters; do not turn it into another terminal or chart. |
| Native chart renderers | `DUPLICATED` / `NEEDS_REFACTOR` | The platform audit identifies `ProTerminalChart` and shared `TradingChart/ChartEngine` as separate lightweight-charts renderers with different overlay lifecycles. Within the Pro chart, drawings use SVG, zones/profiles use `ChartAnchoredOverlay`, and indicator/SMC/trade layers use series/markers. This phase retains the stronger existing Pro workspace rather than migrating renderers without parity/performance evidence. |
| Viewport and base coordinate transforms | `PARTIALLY_WORKING` | Pan/zoom, price/time scales, and history-preserving chart updates use lightweight-charts transforms. Drawings store time/price anchors and project with `timeToCoordinate`/`priceToCoordinate`; FVG/OB/profile use the anchored bridge. There is no single shared object/viewport adapter for every renderer/layer, and no exhaustive pan/zoom/resize anchor test was found. |
| Drawing tool coverage | `PARTIALLY_WORKING` | Toolbar exposes cursor, trendline, horizontal/vertical, Fibonacci retracement, rectangle, text, and ruler. Each stores market time/price anchors. Ray rendering exists. Extended lines, range types, custom markers/callouts/brush, multi-select, and a complete tool-framework contract are absent. `triangle` exists in the chart union/hint but is not a complete rendered toolbar tool (`PLACEHOLDER`/remove from advertised set before exposure). |
| Drawing selection/editing | `BUGGY` | Selection, hit testing, delete, text edit and recolor exist. Selected-object dragging had incorrect price/time delta bases (anchor price/time was compared to pointer market coordinates), no live translated preview, and no robust captured pointer lifecycle. Endpoint handles are visual only; lock/hide/duplicate/context actions are absent. The pointer translation defect is the narrow fix selected after this audit. |
| Drawing persistence | `PARTIALLY_WORKING` | `ProTerminalChartWorkspace` persists drawings in localStorage by scope and symbol, allowing reuse across timeframes. It has no versioned object schema, explicit visibility/lock/metadata, account isolation, or storage/error UI. No server persistence is implied. |
| Undo/redo and object lifecycle | `PARTIALLY_WORKING` / `NEEDS_REFACTOR` | Delete, clear and a last-created-object undo are present. The undo operation is not a command history and does not undo move/style/delete; redo is absent. |
| Indicators and panes | `PARTIALLY_WORKING` | Layer catalog is honest about provider-dependent unavailable classes; canonical indicator/Smart Money engines feed chart projections. Several indicator panes are dynamically created. User pane resizing/layout persistence and a full overlay-vs-pane indicator contract are not established. |
| Smart Money / strategy / trade objects | `PARTIALLY_WORKING` | Smart Money detectors and trade inputs exist and are anchored through native series/markers or chart price/time transforms. They do not share one lifecycle/selection/visibility object model with user drawings. Existing market-core test suites cover pure calculations, not every rendered lifecycle. |
| Crosshair / scales / historical loading | `PARTIALLY_WORKING` | Native crosshair and scales, hover OHLC, pan/zoom and a near-left-edge history request path are present. Exact candle/time/price readout, timezone/session configuration, real interaction-level historical prepend verification and all supported timeframe coverage require more work. Workspace currently offers M1/M5/M15/M30/H1 despite a wider backend timeframe mapping. |
| Context menu, shortcuts, templates, search | `PARTIALLY_WORKING` / `MISSING` | Delete and Ctrl/Cmd+Z plus Escape-to-cursor exist. No redo, general shortcut registry, drawing/chart context menu, chart templates, or in-chart instrument search were found in the audited workspace. |
| Object density / performance | `PARTIALLY_WORKING` | Anchored DOM overlays cull off-pane zones and diff DOM writes; native series handle dense candle/indicator data. No representative thousands-of-objects benchmark or chart performance HUD was found. Do not migrate to Canvas/WebGL without profiling. |
| Automated and visual tests | `PARTIALLY_WORKING` | Pure drawing hit-test/magnet/lifecycle helpers and chart-engine tests exist. No browser interaction or screenshot regression suite for the Pro chart states was found in the inspected scope. |

## Phase 6 first repair selected

Correct selected-drawing movement using the delta between the pointer's start/end **market coordinates**, render the in-progress translation from the original anchors, capture pointer interaction, and test that translation preserves each drawing's relative anchor geometry. Keep all stored coordinates as timestamps/prices; pixels remain render/hit-test coordinates only.

## Verification addendum

On `/account/trading`, a browser smoke check created a rectangle from chart pointer coordinates, confirmed distinct time/price anchors and a non-zero SVG rectangle, then dragged a selected rectangle and confirmed its persisted anchors changed while preserving its dimensions. The chart persisted the objects in the existing symbol-scoped local storage; the temporary test drawings were removed after the check. This is a focused interaction check, not a full regression suite.

The new translation tests pass. The current broader verification state is not clean in the shared checkout: the chart-upgrades suite reports 35 passing and one pre-existing AI-draw evidence assertion mismatch; ESLint flags an unrelated `aiPlan` dependency expression already present in the chart file; TypeScript stops on syntax errors in the separately modified `lib/intelligence/market-analyst.ts`. `git diff --check` passes. These shared-worktree failures were left untouched rather than changing unrelated work.

## Explicitly out of scope for this repair

This repair does not claim completion of Phase 6. Endpoint resizing, lock/hide/duplicate, command-based undo/redo, template/workspace schemas, timeframe filters, unified overlays, pane resize persistence, context-driven AI/replay/setup actions, order dragging, performance benchmarks, and visual/browser regression coverage remain follow-up work. Existing uncommitted changes in the shared checkout were preserved.

---

Audit note: this document now includes a narrow browser smoke-test observation, but the original classification table remains a source-level audit rather than an exhaustive route or market-flow test.
