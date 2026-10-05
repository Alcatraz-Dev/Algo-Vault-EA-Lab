# AlgoVault Market Intelligence Core — Phase 3

> **One canonical market model → one indicator engine → one Smart Money
> engine → one intelligence context → many consumers.**
>
> The chart is only a visualization layer. This document is the source of
> truth for *why* an indicator value, overlay or Smart Money object appears
> where it does. Another engineer must be able to reproduce every rule here
> without reading the implementation.

---

## 1. Audit of the pre-Phase-3 implementation

| Area | File(s) | Classification | Action taken |
| --- | --- | --- | --- |
| Timeframe bucketing (UTC open-time math) | `lib/chart-engine/timeframe.ts` | **WORKING** | Reused as the single boundary authority |
| Canonical candle (`ChartCandle` + normalization + validation) | `lib/chart-engine/candle.ts` | **WORKING** | Reused; declared THE canonical model |
| Candle aggregation (ticks → candles, dedupe, chronology) | `lib/chart-engine/candle-aggregator.ts` | **WORKING** | Reused |
| History/gap/repair engine, subscriptions | `lib/chart-engine/chart-data-engine.ts`, `use-chart-engine.ts` | **WORKING** | Reused |
| Coordinate pipeline (timestamp → bar index → screen) | `lib/chart-engine/coordinate-mapping.ts`, `viewport.ts`, `chart-anchored-overlay.ts` | **WORKING** | Reused as the ONLY coordinate pipeline |
| Indicator math in `lib/analytics/indicators.ts` | sma/rsi/atr correct, **ema seeded from bar 0**, **macd signal seeded on placeholder zeros**, **vwap averaged the whole loaded history** | **BUGGY / DUPLICATED** | Rewritten as thin adapters over the core kernels (documented behaviour changes below) |
| Chart-local indicator math | `ProTerminalChart.tsx` local `ema`, `computeVwap` | **DUPLICATED** | Replaced with core adapters (identical output shape) |
| Chart-local Smart Money math | `ProTerminalChart.tsx` `computeFvgs`, `computeOrderBlocks`, `computeEqualLevels`, `computeSwings`, `computeSrLevels`, `computeSessionLevels` | **DUPLICATED** (and index-anchored) | Replaced with core detectors |
| Chart indicator contract | `lib/chart-engine/overlay-contract.ts` (local `emaOver/smaOver/rsiOver`) | **DUPLICATED** | Delegates to the core `IndicatorEngine` |
| Smart Money structure engine | `lib/market-intelligence/smart-money/engine.ts` | **BUGGY** — `HL`/`LH` labels were swapped (swing-high comparison emitted `HL`), FVG `top/bottom` were inverted, `HH`/`LL` classification keyed off indices, no confirmation timestamps, `mode === "historical"` treated everything as confirmed | Rewritten as an adapter over `lib/market-core/smart-money` |
| Structure detector used by server APIs | `lib/analytics/market-structure.ts` | **PARTIALLY_WORKING** (no confirmation semantics, BOS anchored to the *swing* time, not the break) | Left in place for API compatibility; the core is the canonical detector for new work |
| Liquidity detector | `lib/analytics/liquidity.ts` | **PARTIALLY_WORKING** (side convention inverted, O(n²) clustering, no confirmation) | Core detector added with documented sides/confirmation; analytics module untouched for API compatibility |
| Overlay contract types | `lib/chart-engine/overlay-contract.ts` | **PARTIALLY_WORKING** | Kept as the chart-facing adapter; the canonical overlay model now lives in `lib/market-core/types.ts` |
| Layer toggles | `components/pro-scalping-terminal/chart-layers.ts` | **WORKING** | Kept; core adds the canonical layer vocabulary + priority + density budget |
| Indicator configuration/state | per-component `useState`/`localStorage` | **NEEDS_REFACTOR** | Core `IndicatorEngine.configure()` is now the lifecycle authority (add/change/remove) |
| Signal/AI chart annotations | `lib/chart-engine/ai-draw.ts`, AI overlay props | **WORKING** | Kept (they consume candles, they do not re-implement indicator math) |
| Market data model duplication (`MarketCandle` vs `ChartCandle` vs local `Candle`) | multiple | **DUPLICATED** | Consolidated: `ChartCandle` is canonical, `MarketCandle` stays as the legacy structural view, `CoreCandle` is the structural supertype every engine accepts |
| Replay / backtest Smart Money reuse | `lib/market-intelligence/backtesting/*` | **PARTIALLY_WORKING** | Now consumes the same detector set through `SmartMoneyEngine.run()` |
| Indicator registry | — | **PLACEHOLDER** | Implemented (`indicatorRegistry` / `overlayRegistry`) |
| Debug/inspection mode | — | **PLACEHOLDER** | Implemented (`lib/market-core/debug.ts`) |

No chart rebuild was performed: the repaired Phase-2 chart foundation was
kept intact and the engine was mounted underneath it.

---

## 2. Canonical market data model

**Canonical concrete model:** `ChartCandle` (`lib/chart-engine/candle.ts`).

| Field | Rule |
| --- | --- |
| `timestamp` | Candle **opening** time, **milliseconds, UTC**, always `floor(t / intervalMs) * intervalMs` via `candleOpenTime()`. Never a close time, never seconds, never local time. |
| `symbol` | Uppercase (`XAUUSD`). |
| `timeframe` | Canonical token: `M1 M3 M5 M15 M30 H1 H4 D1 W1`. |
| `finalized` | `false` only for the still-forming bucket. |
| OHLC | Validated by `isValidCandleValues()`: all finite & > 0, `high ≥ low`, `low ≤ open/close ≤ high`. Invalid bars are **rejected**, never "fixed". |
| `volume` | `0`/omitted when the provider sends none (never faked). |

* `MarketCandle` (`lib/market-data/types.ts`) remains the **legacy structural
  view** (`timestamp/OHLC/volume`) — produced from the canonical candle by
  `chartCandleToMarketCandle()`. It is not a second model with its own math.
* `CoreCandle` (`lib/market-core/types.ts`) is the structural supertype the
  core engines accept; `ChartCandle` and `MarketCandle` both satisfy it.
* Dedupe/alignment key: `symbol|timeframe|timestamp` (`candleKey()`).
* **No silent timezone conversion anywhere.** All bucketing and all session
  windows are UTC.

### Normalization boundary

Everything external (provider bars, quote ticks, replay bars) is normalized
by `toChartCandle()` **at the boundary**: the bar's timestamp is re-bucketed
to its open time for the requested timeframe, so a provider that sends
close-anchored stamps cannot shift indicators.

---

## 3. Indicator engine

### 3.1 Architecture

```
lib/market-core/indicators/
  primitives.ts    stateful kernels (the ONLY place formulas live)
  definitions.ts   registry entries: id, name, category, version, params,
                   outputs, pane, warmup, docs
  engine.ts        IndicatorEngine (incremental, timestamp-anchored) +
                   alignedIndicatorSeries() (memoized one-shot) +
                   mapToTimeline() (MTF)
```

* **Calculation** lives in `primitives.ts` (pure, framework-free).
* **Configuration** = `IndicatorDefinition.params`.
* **State** = per-instance fold state held by `IndicatorEngine`.
* **Rendering** = consumers convert `IndicatorResult[]` to pixels; indicators
  never touch React or canvas.
* **Integration** = chart (`overlay-contract`, `ProTerminalChart`),
  backtest/replay (`SmartMoneyEngine`, adapters), AI (`buildIntelligenceContext`),
  alerts/strategies read the same rows.

### 3.2 Structured output

```ts
type IndicatorResult = { timestamp: number; values: Record<string, number | null> };
```

* One row per candle, `timestamp` = candle open time.
* Warmup values are `null` — never `NaN`, never a fabricated number.
* Lookups: `engine.at(ref, timestamp)` (binary search) or
  `engine.getOutputAligned(ref, output, timestamps)` which maps by timestamp
  so a historical prepend can never shift a plotted line.

### 3.3 Canonical formulas (version 1.0.0)

| Indicator | Id | Outputs | Rule / assumption |
| --- | --- | --- | --- |
| SMA | `sma` | `value` | Arithmetic mean of the last `period` closes. `null` for `period-1` bars. |
| EMA | `ema` | `value` | **SMA-seeded** (MetaTrader/TradingView convention): first value = mean of the first `period` closes at index `period-1`, then `v·k + prev·(1−k)`, `k = 2/(period+1)`. `null` before that. |
| WMA | `wma` | `value` | Linear weights 1 (oldest) … `period` (newest); `null` before `period`. |
| VWAP | `vwap` | `value` | `Σ(typical·volume) / Σ(volume)`, **anchored to the UTC day**, reset at every UTC day boundary. Volume defaults to `1` per bar when the feed carries none. |
| Bollinger | `bollinger` | `upper, middle, lower` | `SMA(period) ± mult · population-stdev(period)` (divisor = `period`). |
| RSI | `rsi` | `value` | Wilder: seeded with mean gain/loss of the first `period` changes (first value at index `period`), then `(p−1)/p + change/p`. When `avgLoss = 0` the value is `100` (platform convention, unchanged). |
| MACD | `macd` | `macd, signal, histogram` | `EMA(fast) − EMA(slow)` (both SMA-seeded, so the line starts at `slow−1`). Signal = EMA(`signal`) of the MACD line **skipping invalid values**, so it seeds at `slow+signal−2` and never on placeholder zeros. Histogram = macd − signal. |
| Stochastic | `stochastic` | `k, d` | Slow stochastic: raw %K over `kPeriod`, smoothed with `SMA(kSmooth)`; `%D = SMA(%K, dSmooth)`. Flat range (high == low) reports `50`. |
| Awesome | `awesome` | `value` | `SMA(median, fast) − SMA(median, slow)`, median = `(high+low)/2`. Null until `slow` bars. |
| ATR | `atr` | `value` | Wilder: seed = mean of the first `period` true ranges (index `period−1`), then `(p−1)/p + TR/p`. `TR[0] = high − low`. |
| ADX | `adx` | `adx, plusDI, minusDI` | Wilder DI/DX/ADX. DI available at index `period`, ADX at `2·period − 1`. Ranges 0–100. |
| OBV | `obv` | `value` | Cumulative signed volume; starts at `0`. **`null` while the feed carries no volume at all.** |

`lib/analytics/indicators.ts` (server/AI/extension adapters) delegates to
these kernels and maps `null → NaN` to preserve its legacy array shape.

**Documented behaviour changes (intentional corrections):**

1. `ema` is now SMA-seeded instead of bar-0 seeded. Warmup rows changed
   (they are now `null`/`NaN`); tail values converge to the same series.
2. MACD `signal` no longer seeds on placeholder zeros — it starts at
   `slow + signal − 1` values, which is the standard definition.
3. Snapshot `vwap` is now the **session VWAP** instead of a cumulative
   average of whatever history happened to be loaded (that value changed
   with page size — it was not a VWAP).

### 3.4 Incremental computation

`IndicatorEngine.setSeries()` classifies every change:

| Change | Detection | Work |
| --- | --- | --- |
| identical content | no differing candle | none (identity kept) |
| forming candle tick | first diff at `len−1` | re-fold **from that index only** (pre-candle state is checkpointed) |
| new candle / history append | first diff at `len` | fold the new candles only |
| history prepend / mid-series revision / reload | first diff earlier | **full recompute** (correctness over speed) |

The fold code path is identical for full and incremental runs — an
incremental result is therefore *by construction* equal to a full
recompute, and tests assert exactly that for every registered indicator.

Measured on this machine (`npm run test:market-core`):
10 000 candles × 12 indicators full fold ≈ **18 ms**, per-tick incremental
update ≈ **0.3 ms**.

### 3.5 Lifecycle

```ts
engine.configure([{ id: "ema", params: { period: 20 } }, { id: "rsi" }]); // add
engine.configure([{ id: "ema", params: { period: 50 } }]);                 // change → recompute
engine.configure([]);                                                      // remove → state dropped
engine.dispose();                                                          // unmount / symbol switch
```

* Instance key = `id|param=value,…` (order-independent) or an explicit
  `key` for workspaces.
* Removed instances drop their rows, runtime and checkpoint — **no ghosts**.
* An engine is constructed for ONE `(symbol, timeframe)`; it cannot serve
  another series (proved by tests).

### 3.6 Multi-timeframe

`mapToTimeline(baseTimestamps, htfRows)` maps higher-timeframe rows onto a
lower-timeframe timeline by **timestamp** (`last HTF open ≤ base open`),
never by array index. Values are `null` before the first HTF row. This is
the prepared foundation for HTF EMA bias, MTF Smart Money and session
analysis.

---

## 4. Overlay model & coordinate pipeline

### 4.1 Market coordinates only

```ts
type MarketOverlay = {
  id, type, layer, symbol, timeframe,
  startTime,          // candle open time (ms)
  endTime?,           // omitted = extends to the live edge
  priceStart?, priceEnd?,
  direction?, priority?, label?, color?, metadata?
};
```

An overlay NEVER stores pixels, viewport-relative positions or React layout
data. The renderer translates:

```
market data → timestamp/price → chart coordinate → screen coordinate
```

through the single pipeline (`lib/chart-engine/coordinate-mapping.ts` +
lightweight-charts time/price scales). Every object type — indicator lines,
FVG, order blocks, liquidity, BOS/CHOCH, signals, strategy entries, AI
annotations, drawings — goes through the same path. Pan, zoom, resize and
history prepends therefore cannot move an object relative to its candles
(asserted in tests).

### 4.2 Layers, priority, density

`INTELLIGENCE_LAYERS` defines the toggleable groups:
`candles, volume, indicators, market_structure, liquidity, fvg,
order_blocks, premium_discount, sessions, signals, strategies, ai, drawings`.

Priority: `critical` (current price, position, entry/SL/TP, signals,
strategies) → `high` (BOS/CHOCH, active liquidity/FVG/OB, indicators) →
`medium` (historical structure, mitigated zones) → `low` (old labels, AI
annotations).

`selectOverlaysForViewport(overlays, {visible, fromTime, toTime, budgetScale})`
applies: layer visibility → time window → per-layer budget (higher priority
and newer objects survive). **Density reduction only changes what is drawn;
the object set itself is never mutated** (dashboards/alerts/AI keep the full
data).

`smartMoneyToOverlay()` is the single adapter from a Smart Money object to a
drawable overlay — chart and dashboard cannot disagree.

---

## 5. Smart Money engine

`lib/market-core/smart-money/` — `SMART_MONEY_VERSION = "1.0.0"`.

### 5.1 Time & confirmation contract

* A candle's evidence (H/L/C) is known when it **closes**:
  `confirmationAt = open + timeframeLength` (also the next candle's open).
* Every object carries `detectedAt` (anchor/drawing time) and
  `confirmationAt` (first moment it is KNOWABLE).
* `visibleAsOf(objects, asOf)` returns only objects with
  `confirmationAt ≤ asOf`. **This is the anti-look-ahead gate** for backtest,
  replay, alerts and AI.
* The canonical, leak-free evaluation path is: run `detectSmartMoney()` on
  **only the candles available at the evaluation time** (prefix). Detectors
  never read past the end of the array.
* The last candle of a snapshot may be forming (`finalized !== true` or
  tail position); events derived from it are `developing` with a
  `confirmationAt` in the future, so they cannot pass an `asOf` gate.

### 5.2 Pivots (swing high/low)

* Rule: bar `i` is a swing high when its high is **≥** every high in the
  ±`lookback` window (ties allowed so equal highs pair up); mirrored for
  lows. Default `lookback = 3`.
* Left window must be complete (`i ≥ lookback`); right window must contain
  at least one bar.
* `confirmationIndex = i + lookback`, `confirmationTime = close of that bar`.
* A partial right window yields a **developing** pivot whose confirmation is
  estimated past the snapshot end (always > any close time in the snapshot).

### 5.3 HH / HL / LH / LL

Over confirmed pivots, ordered by time:

* swing high > previous swing high → **HH**, lower → **LH**
* swing low < previous swing low → **LL**, higher → **HL**
* equal → no classification.

### 5.4 BOS / CHOCH

* Levels: the most recent confirmed swing high/low that was confirmable
  **before** the current candle opened (`confirmationIndex < i`), consumed
  once broken.
* Bullish break: `close > last confirmed swing high`.
  Bearish break: `close < last confirmed swing low`.
* First break in a new direction = **BOS**; a break opposite to the previous
  break = **CHOCH**.
* `detectedAt` = breaking candle open, `confirmationAt` = breaking candle
  close, `metadata.pivotTime` = the broken level's candle open time,
  `metadata.breakPrice` = the close.
* Status: `developing` while the breaking candle is forming, `confirmed`
  once it has closed.

### 5.5 Liquidity

* Sides: **buy-side (BSL) rests above highs**, **sell-side (SSL) below lows.**
* Pools:
  * swing pools — one per confirmed swing high/low,
  * equal highs/lows — confirmed swing prices clustered within a relative
    tolerance of `0.001` (0.1%); the pool exists from the moment its
    **second** member confirms (`confirmationAt`), price = mean of members
    (later members refine the pool — point-in-time content consumers re-run
    detection on the prefix),
  * session pools — session high/low of the current UTC day.
* Sweep: `high > level && close < level` (above) or `low < level && close >
  level` (below), evaluated only for pools already confirmed, with the level
  inside the candle's own range (price-indexed lookup, O(n log p)).
  `confirmationAt` = sweep candle close; a confirmed sweep **invalidates**
  the pool (`metadata.sweptAt`, `metadata.sweptBy`).

### 5.6 FVG (imbalances)

* Bullish: `c3.low > c1.high` → zone `[c1.high, c3.low]`.
  Bearish: `c3.high < c1.low` → zone `[c3.high, c1.low]`.
* `detectedAt` = c3 open, `confirmationAt` = c3 close, zone spans from c1
  (`metadata.zoneStart`).
* Lifecycle (measured only on later candles):
  * no penetration → `active` (`metadata.fillPercent`),
  * ≥ 50 % penetration (consequent encroachment) → `mitigated`,
  * close beyond the gap origin → `invalidated`.

### 5.7 Order blocks

* Bullish OB: a **bearish** candle `i` followed (within `obLookahead`,
  default 3 candles) by a candle that closes **above `c[i].high`** with a
  bullish close → displacement. Bearish mirrored.
* Zone = `[c[i].low, c[i].high]`, `detectedAt`/`confirmationAt` = the
  displacement candle's open/close, `metadata.zoneStart` = the block candle.
* Lifecycle: `active` → `mitigated` (a later candle trades back into the
  zone) → `invalidated` (close beyond the block extreme).
* Strength: `displacementBody / (2 × ATR14)` as a percentage, clamped
  10–100 — deterministic, never model-generated.

### 5.8 Premium / Discount

* Dealing range = last confirmed swing low → last confirmed swing high
  (invalid if crossed — no object emitted).
* Equilibrium = midpoint; zone = `premium` above, `discount` below,
  `equilibrium` within 0.1 % of the midpoint.

### 5.9 Sessions

UTC windows (identical to the chart's session layer):

| Session | UTC |
| --- | --- |
| Asia | 00:00 – 08:00 |
| London | 07:00 – 16:00 |
| New York | 12:00 – 21:00 |

Overlaps are intentional; 12:00–16:00 is reported as `overlap`.

### 5.10 Lifecycle states

```
developing → confirmed → active → mitigated → invalidated
```

Not every object uses every state (breaks/pivots stop at `confirmed`;
pools stop at `invalidated` when swept). Each object carries: `id`, `kind`,
`symbol`, `timeframe`, `detectedAt`, `confirmationAt`, `status`,
`direction`, `price`/`priceHigh`/`priceLow`, `sourceCandles`,
`strength`, `metadata` (incl. invalidation condition).

### 5.11 Determinism & versions

Same candles + config → identical ids, statuses and order. No LLM ever
participates in detection; AI only interprets emitted facts. Any rule change
must bump `SMART_MONEY_VERSION` or the indicator definition `version` so
historical research stays reproducible.

---

## 6. Intelligence context (AI contract)

`buildIntelligenceContext({candles, symbol, timeframe, detection?, indicators?})`
returns the structured facts bundle:

```
market (symbol, timeframe, price, candleTimestamp, session)
structure (bias, events, lastSwingHigh/Low)
liquidity (pools, sweeps)
imbalances (fvgs)
orderBlocks (active, mitigated)
premiumDiscount (rangeHigh/Low, equilibrium, zone)
indicators (per-instance latest values)
volatility (atr, atrPercent — only if computed)
activeSetups (only objects knowable at the last candle)
provenance (indicatorVersions, smartMoneyVersion)
```

Rules: unknown fields are omitted or empty — **never guessed**. AI may
interpret this bundle; it may never contribute a raw fact to it, and it is
never the source of market truth. `confidence` is not fabricated anywhere in
this phase — signal confidence scoring remains an explicit, separately
documented heuristic when implemented.

---

## 7. Registry & versioning

```ts
indicatorRegistry.register({ id, name, category, version, params, outputs,
                             pane, overlayOnPrice, warmup, create, docs });
overlayRegistry.register({ id, name, category, version, layer, kinds, docs });
```

* Duplicate ids throw — two implementations of one id is the failure mode
  this phase exists to prevent.
* Every definition carries a semver `version` and a `docs` string surfaced
  in the debug inspector.
* Built-ins self-register on import (`registerBuiltinIndicators()`).

---

## 8. Debug mode

Disabled for normal users. Enable with
`localStorage.setItem("algovault_market_core_debug", "1")` in the browser or
`MARKET_CORE_DEBUG=1` on the server, or `setMarketCoreDebug(true)`.

`debugSnapshot()` exposes: candle index/timestamp/OHLC/finalized, indicator
instances (params, version, warmup, rows, first/last values), overlay
coordinates + status + confirmation time, and Smart Money objects (kind,
status, detected/confirmation ISO times, bounds, source candles,
invalidation condition) — enough to answer *"why did this object appear
here?"* from the UI instead of the source code.

---

## 9. Consumers (one engine, many surfaces)

| Surface | Entry point |
| --- | --- |
| Pro terminal chart | `alignedIndicatorSeries`, `chartDetection()` (`ProTerminalChart.tsx`), `structureOverlayLayer` |
| Chart indicator contract | `lib/chart-engine/overlay-contract.ts` |
| Market Intelligence / backtest / replay | `lib/market-intelligence/smart-money/engine.ts` → `detectSmartMoney` |
| AI panels & pipelines | `buildIntelligenceContext` |
| Server analytics/extension APIs | `lib/analytics/indicators.ts` adapters |
| Alerts / strategies / research | `SmartMoneyEngine.run()` + `visibleAsOf()` |

Adding a new indicator or overlay means registering it once; every surface
picks it up.

---

## 10. Tests

```bash
npm run test:market-core    # this phase's suite (57 checks)
npm run test:chart-engine   # repaired chart foundation (68 checks)
```

Coverage: indicator math vs independent naive implementations, timestamp
alignment (incl. weekend gaps), historical extension, realtime tick and
close→new-candle equivalence, mid-series revision, overlay market-coordinate
immutability, layer visibility/density, HH/HL/LH/LL, BOS/CHOCH, FVG/OB
lifecycle, liquidity pools + sweeps, premium/discount, sessions, leakage
protection (`visibleAsOf`, prefix invariance, backtest stepping), lifecycle
(add/remove/change, symbol/timeframe isolation), context provenance, debug
inspector, and performance budgets (10k candles, thousands of overlays).

---

## 11. Explicitly out of scope for this phase

AI Trading Teams, advanced AI Suite, full Strategy Research Engine, no-code
Strategy Builder, TradingView execution, mobile app and marketplace
intelligence are intentionally **not** implemented here — they will consume
this foundation.

## 12. Known limitations

* `lib/analytics/market-structure.ts` and `lib/analytics/liquidity.ts` still
  serve existing API endpoints with their own (older) semantics. They are
  kept for compatibility; new work must use the core. Migrating those API
  endpoints is a follow-up.
* The jest-style suites under `tests/lib/**` cannot run in this checkout
  (`vitest` is listed but `vite` is missing — pre-existing). Equivalent
  guarantees for the touched modules are covered by `npm run test:market-core`
  and the CI suites (`ai-signals`, `strategy-lab`, `risk`, `agents`,
  `telegram` — all green).
