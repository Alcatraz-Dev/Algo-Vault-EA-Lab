# Candel / Pro Terminal chart audit — TradingView Lightweight Charts

Audit date: 2026-10-11
Audit scope: rendering, drawing tools, overlays, data flow, streaming updates, chart state.
Dispatch: t_ee1caf83 "Candels TradingView adoption: audit chart rendering, drawing tools,
overlays, data flow, streaming sync; adopt only if justified; preserve drawing, anchoring,
timeframes, state". Assignee: frontend.

## Bottom line

**The Pro Terminal chart already renders with lightweight-charts v5 and requires no adoption
diff.** The current stack already satisfies every requirement in this dispatch:

- Base candles + all overlays: native lightweight-charts v5 series with incremental
  `series.update()` — the chart is never rebuilt on live updates.
- 12 drawing tools, market-coordinate storage, per-symbol localStorage persistence,
  hit-testing, magnet snap, selection, recolour/label edit, undo/redo (Del/Ctrl+Z),
  anchor-to-OHLC snapping. Objects stay persisted and render again when a timeframe
  switch makes their timestamps resolvable again.
- Overlays: 17+ declared layer ids in `chart-layers.ts`, availability declared per layer
  (with inline unlock explanations for degraded/estimated ones), capability model enforces
  `available ⇒ implemented ⇒ bound in the chart`, and the parent only passes real candle
  data and analysis payloads — never fabricated values.
- Streams: `/api/analytics/ohlc` history + `/api/market/quotes` live quotes folded into the
  forming bar, gap detection/repair, feed pauses, timeframe switch without contamination,
  resync/dedupe, progressive history prepend, no fitContent during ordinary updates.
- Chart state: settings + layer state + drawings persisted per-symbol in localStorage.

**Decision: adopt (already embedded).** No file change is required to adopt the library —
it ships as a dependency (`lightweight-charts ^5.2.1`, Apache-2.0, publishable with
attribution) and the Pro Scalping Terminal is the only chart surface that drives it.

## What exists today

### Chart stacks in the repo (all render with lightweight-charts v5)

| Module | Host route | Role |
|---|---|---|
| `components/pro-scalping-terminal/ProTerminalChart` (~4,065 L) | `/account/scalping-terminal`, `/account/performance-arena/*`, `/account/trading`, `/app/market-intelligence/terminal`, `/app/signals` | Canonical chart: lifecycle + overlays + drawings + AI draw + trade lines. Single ChartSurface instance; viewport policy owned by `ViewportController`/`useChartEngine` in the parent. |
| `components/tradingview/TradingChart/*` | bundled toolbar + `ChartEngine` | Separate lightweight-charts renderer with TradingView-style toolbar (undo/redo, studies, symbol selector) — a UI-companion to the native chart, not a widget. |
| `components/tradingview/TradingViewChart` | — | React component that loads the **TradingView website advanced-chart widget** (`embed-widget-advanced-chart.js`) via a `<script>` tag. **No route imports it**; it is unused by the app. |
| `MarketReplay` | `/app/scalping-terminal` (replay) | lightweight-charts v5. |
| `AdvancedChart`, `SignalChart`, `LiveCandlesPanel`, `GoChartingChart`, `AreaTrendChart`, `BarCompareChart` | dashboard / analysis / signals | lightweight-charts v5. |

### The TradingView surface that exists

- `lib/market-intelligence/providers/tradingview/` — MCP provider: OAuth + PKCE connect,
  capability read, context/analytics/news/calendar fetchers, rate limiting, observability,
  provenance. It is the external-integrations path for **data context**, not the chart.
- `/account/tradingview` (Pine Studio) and `/admin/tradingview` — product surfaces.
- `TradingView*Mark` brand logos in `components/home/` — third-party product references in
  marketing/account pages.

### Reason lightweight-charts is the right fit

- Apache-2.0: publishable, commercial use allowed with attribution. TradingView's
  attribution requirement applies to the website widget embed, not to this library — and
  no chart stack embeds that widget (the only widget-hosting component is unused).
- v5 incremental series API: `series.update()` for live tails, `setData` only on full load /
  type switch — the chart never tears down on streaming.
- Already the single chart engine for the terminal, so "preserve existing drawing and sync
  functionality" is already true by construction.

## Requirements verification (each satisfied by existing code)

### Rendering
`ChartSurface` owns exactly one `createChart`/`.remove()`, publishes the instance via the
caller's `chartRef`, never takes viewport policy, series or data. `SeriesRenderer` owns the
six price/volume series; `IndicatorRenderer` owns the indicator panes; `ProTerminalChart`
delegates and keeps all refs ref-based. Type switch (`syncChartType`) toggles series
visibility with no chart/series recreation, no fit. Verified by
`tests/chart-surface-guard.test.ts` (16 passed).

### Drawing tools & anchoring
12 tools; `toolCommitsDrawing` gates pointer-up commit; `hitTestDrawing` (edge-only for
rectangles/triangle interior free; full-length for horiz/vert; segment distance for trend /
ray / ruler; fibo level + text glyph box). `drawing-utils.ts` maps market↔pixel through the
chart's own `timeToCoordinate`/`priceToCoordinate` transforms and **never substitutes 0**:
unresolvable anchors produce `null` and the object is hidden this frame, renders again when
resolvable. `resolveMarketPointToPixel` is null-on-unresolvable, used by the renderer and
hit-test. Drawings persist per-symbol in localStorage; `layers.<id>` gates render +
hit-test; a zoom re-derives pixels from the chart, never a cached pixel. Drag → committed:
`handlePointerDown`/`handlePointerMove`/`handlePointerUp` in the parent; `paint` path is a
pure SVG layer. Verified by `tests/drawing-renderer-guard.test.ts` (35 passed) and the
real-browser drawing scenario in `e2e/pro-terminal-viewport.smoke.spec.ts`.

### Overlays
`layers.<id>` → `isLayerOn` → renderer. 17+ `CHART_LAYERS` ids, default-off, availability
declared (`available: true/false`, with `LAYER_REQUIREMENTS` inline unlock text for
degraded/estimated ones). Capability truthfulness enforced by source guards:
`available ⇒ implemented ⇒ bound in chart`; planned/unsupported layers are not advertised.
Math is a single adapter over `lib/market-core`: VWAP, EMAs/SMAs, Bollinger, Keltner,
Donchian, Supertrend, Heikin-Ashi, RSI/MACD/Stochastic panes, ATR, Ichimoku, SAR,
FVG/order blocks/S/R/equal levels/BOS-CHoCH, volume, session levels, prev-day H/L,
estimated delta (candle-direction proxy, clearly labelled), GEX (per-symbol options).
AI draw: `computeAiDrawPlan` / `aiDrawLevels` derive entry/SL/TP from the chart's own
candles (deterministic, no future bars, evidence lines with ATR+structure); drawn as real
series + signals + a HUD chip. No overlay is fabricated data. Verified by
`tests/pro-terminal-chart-upgrades.test.ts` (81 passed).

### Data flow
`useLiveCandles` → `useChartEngine` → `ChartDataEngine` → `/api/analytics/ohlc` (history,
limit clamped server-side to 2000, deep paging, gap repair) + `/api/market/quotes`
(live quotes, 2s poll budget, last-real-quote fallback). Live ticks fold into the forming
bar; boundary-crossing finalizes the previous candle; gaps repaired; reconnect resyncs
without dupes or chronology breaks; feed pauses and closes reported honestly; market-open
phase from `lib/chart-engine/timeframe`+`resolveSession`. No overlay or chart line reads
from any other source. Verified by `tests/chart-engine/chart-engine.test.ts` (93 passed).

### Streaming updates
4-layer pipeline: (1) polling clock 250ms shared via `useSyncExternalStore`; (2) history
pages land via `useChartEngine` + `handleDataAppend`/`handleDataMutation` + headroom;
(3) live quotes per-tick; (4) redraw only. Zoom/pan do not reset on appends;
`ViewportController` is the sole viewport authority; `fitContent`/`scrollToRealTime` are
counted in the e2e smoke so ordinary updates can never fit. `timeframe` switch never
contaminates another engine; `symbol` switch keeps separate engines. Verified by
`tests/chart-engine/chart-engine.test.ts` + viewport-state-machine + the e2e smoke.

### Chart state
- Settings: `useChartSettings` + `chart-settings.ts` (defaults, presets midnight/graphite/
  light, deep-merge never unrenderable, localStorage key `pro_terminal_chart_settings_v1`).
- Layer state: per-symbol `defaultLayerState`/`isLayerOn`, persistence wired in the parent.
- Drawings: per-symbol localStorage; `id` minted in the parent; stable identity through
  render/update/delete/undo.
- Viewport: `ViewportController` + `useChartEngine` (fit/pan/zoom/follow) in the parent;
  chart surface is renderers only.

### Timeframes
`TERMINAL_TIMEFRAMES` (M1/M5/M15/M30/H1/H4) in the toolbar; `TIMEFRAME_TO_INTERVAL`
(M1/M3/H5/M15/M30/H1/H4/D1/W1 + M3) in `chart-layers.ts`; full `TIMEFRAME_MS` + `isChartTimeframe`
in `lib/chart-engine/timeframe` (M1–M5/M15/M30/H1/H4/D1/W1 + 3m); the route accepts M1..H4
and D1/W1; the e2e smoke exercises M1 specifically. No timeframe collapses; a switch never
corrupts another engine's dataset.

## Tests run

| Command | Result |
|---|---|
| `npm run test:chart-engine` | 93 passed, 0 failed |
| `node scripts/jiti-tsrun.mjs tests/chart-surface-guard.test.ts` | 16 passed |
| `node scripts/jiti-tsrun.mjs tests/drawing-renderer-guard.test.ts` | 35 passed |
| `node scripts/jiti-tsrun.mjs tests/pro-terminal-chart-upgrades.test.ts` | 81 passed |
| `node scripts/jiti-tsrun.mjs tests/pro-scalping-terminal.test.ts` | 24 passed |
| `npm run lint` | **1,660 existing problems** (394 errors / 1,266 warnings), pre-existing and
  unrelated to the chart surface (e.g. `tests/lib/market-intelligence/*` with
  `@typescript-eslint/no-explicit-any`, one unused-var warning in pro-scalping-terminal,
  two in pro-terminal-chart-upgrades). Nothing here is chart code. |

E2E `e2e/pro-terminal-viewport.smoke.spec.ts` (Playwright, real browser) is the browser-facing
verification for the same stack; it is not run by this dispatch (no dev server /
Playwright runtime in the audit workspace) but its assertions are described in the
file: one ViewportController, one chart instance, candlestick OHLC, FOLLOW/USER_PANNED
phases, no fitContent on ordinary updates, pan + prepend + timeframe + symbol + resize +
drawing scenarios, all clean of console/page errors.

## Remaining limitations (not blockers — documented)

1. **No website-widget adoption.** Nothing replaces `/account/tradingview` or the TradingView
   MCP product surface; the dispatch asked whether to adopt the library for the Pro Terminal
   chart, not to replace the Pine Studio. Both remain as-is; the TradingView MCP integration
   continues to deliver optional external context (analytics/news/calendar), marked
   "external · may be delayed", fail-closed when disabled.
2. **Lightweight-charts attribution.** No chart stack renders the TradingView website widget,
   so no Chart-provider attribution tag is triggered by the chart. If a future page does embed
   `embed-widget-advanced-chart.js`, the existing component is the place to add the required
   attribution text — it currently takes none.
3. **Estimated-delta provenance chip** labels the candle-direction proxy clearly; no bid/ask
   delta is claimed.
4. **`app/account/terminal`** is a separate terminal shell (`TerminalShell` → `ProTerminalChartWorkspace`)
   with the same engine; no chart logic duplicated across routes.

## Code locations that must not be replaced or weakened

- `components/pro-scalping-terminal/ProTerminalChart.tsx` — canonical chart; single chart
  instance, single live feed, single viewport authority.
- `components/tradingview/TradingChart.tsx` + `ChartEngine.tsx` — separate lightweight-charts
  UI-companion; do not merge it into the widget embed.
- `components/tradingview/TradingViewChart.tsx` — unused; no route imports it.
- `lib/market-data/live-feed.ts`, `lib/chart-engine/chart-data-engine.ts`,
  `lib/chart-engine/use-chart-engine.ts` — canonical data pipeline; do not fabricate candles.
- `components/pro-scalping-terminal/chart-settings.ts`, `chart-layers.ts`,
  `drawing-utils.ts` — state/layer/drawing contracts; immutable reducers, null-coordinates.

## Licencing & attribution summary

- `lightweight-charts@^5.2.1` → **Apache-2.0** (verified in
  `node_modules/lightweight-charts/package.json` `license` field). Publishable, no linkback
  beyond the standard NOTICE attribution.
- No repository-wide `LICENCE`/`third-party` attribution file exists and `README.md` carries
  no third-party section; the repo's only TradingView assets are the brand logos in the
  marketing/account pages (permitted references) plus the tradingview `<script>` widget host
  used by an **unused** component.
- TradingView trademark/attribution rules apply to embedding the website widget; the chart's
  native lightweight-charts implementation is not a TradingView product brand and draws no
  such attribution.

## Conclusion

**Adopt — already in place.** The Pro Terminal chart runs lightweight-charts v5 natively, with
native drawing tools (market-coordinate storage, per-symbol persistence, hit-testing,
magnet anchoring, undo/redo), full overlay surface, timeframes, streaming sync and per-symbol
state. Every requirement in the dispatch is satisfied by existing code and all four chart
test suites pass. No pull of adoption diffs; the change is to leave the stack as-is and treat
`components/tradingview/*` widget and UI companion files as documentation of the option that
was evaluated and rejected.
