# Order Flow & Market Microstructure Intelligence

Native order-flow layer for AlgoVault. Extends the existing canonical
market-data pipeline (`lib/market-data` → `lib/chart-engine`) — no parallel
feed, no external charting library, no Firestore.

## Architecture

```
Provider (Biquote OHLCV today; richer providers pluggable)
    ↓
Existing Market Data Normalizer (lib/market-data/normalizer)
    ↓
Canonical Candles (lib/chart-engine)
    ├── Native Chart (ProTerminalChart, TradingChart)
    ├── Technical Indicators (lib/analytics)
    ├── Smart Money Intelligence (lib/market-intelligence/smart-money)
    ├── Order Flow Intelligence (lib/order-flow)      ← NEW
    ├── Market Intelligence Engine (facts/interpretations/limitations)
    ├── AI Signal Engine (lib/ai-signals)
    ├── Backtest / Replay (lib/market-intelligence/backtesting)
    └── Scalping Terminal (components/pro-scalping-terminal)
```

Module map:

| File | Responsibility |
| --- | --- |
| `lib/order-flow/types.ts` | Canonical types, data-quality + capability model, feature availability derivation |
| `lib/order-flow/settings.ts` | User settings (validated/clamped) + `NEXT_PUBLIC_ORDER_FLOW_*` feature flags |
| `lib/order-flow/validation.ts` | Fail-closed input validators (trades, L2, options, candles) |
| `lib/order-flow/normalizer.ts` | Provider-neutral `OrderFlowDataProvider` interface + canonical candle provider |
| `lib/order-flow/capabilities.ts` | Capability → feature availability resolution |
| `lib/order-flow/tick-classifier.ts` | Tick-rule / quote-test trade classification (PARTIAL quality) |
| `lib/order-flow/volume-profile.ts` | POC/VAH/VAL/HVN/LVN, session/daily/visible/fixed/developing profiles |
| `lib/order-flow/delta.ts` | Buy/sell/delta/delta %, cumulative delta, acceleration, divergences |
| `lib/order-flow/footprint.ts` | Bid×Ask cells per bar, stacked + diagonal imbalances |
| `lib/order-flow/imbalance.ts` | Shared imbalance ratio helpers |
| `lib/order-flow/absorption.ts` | Evidence-based absorption detection (candle-grade) |
| `lib/order-flow/exhaustion.ts` | Evidence-based exhaustion detection (candle-grade) |
| `lib/order-flow/large-trades.ts` | Absolute / percentile / rolling-multiple large-trade detection |
| `lib/order-flow/liquidity.ts` | L2 events (walls, added/removed, stacking/pulling, sweeps) + heatmap state |
| `lib/order-flow/gex/` | Isolated Net Gamma Exposure module (Black–Scholes gamma, flip, walls) |
| `lib/order-flow/options-internal.ts` | Pure options symbology (OCC + Deribit) + payload → `OptionQuote` normalization |
| `lib/order-flow/options-provider.ts` | Real per-symbol options sources (Deribit crypto, CBOE delayed) + fetch/failure handling |
| `lib/order-flow/options-types.ts` | GEX provider types, `GEX_SUPPORTED_SYMBOLS`, options-capable provider adapter |
| `app/api/order-flow/options/route.ts` | Authenticated chain endpoint with 90 s per-symbol cache |
| `hooks/use-options-chain.ts` | Client polling hook (silent no-op for symbols without a source) |
| `lib/order-flow/context-builder.ts` | Replay-safe `OrderFlowContext` + confluence + FACT/INTERPRETATION/LIMITATION |
| `lib/order-flow/replay.ts` | `orderFlowAtBoundary` / `ReplayOrderFlow` streaming replay adapters |
| `lib/order-flow/intelligence-adapter.ts` | Bridge into the Intelligence Layer + AI signal scoring |
| `hooks/use-order-flow.ts` | Live computation over the chart candle feed (memoized) |
| `hooks/use-order-flow-settings.ts` | Settings persistence (localStorage cache + RTDB sync) |
| `components/pro-scalping-terminal/OrderFlowPanel.tsx` | Terminal dock panel |
| `app/api/order-flow/settings/route.ts` | GET/PUT settings → Firebase Realtime DB |

## Data capability model

The platform distinguishes what the feed can actually supply:

| Capability | Current feed (Biquote canonical) |
| --- | --- |
| OHLC candles + volume | ✅ available |
| Individual trades / tape | ❌ |
| Bid/ask trade classification | ❌ |
| Level 2 / order book | ❌ |
| Historical Level 2 | ❌ |
| Options chain / OI / IV | ❌ |

Feature availability is derived in `deriveFeatureAvailability`:

| Feature | Quality on current feed | Why |
| --- | --- | --- |
| Volume Profile (POC/VAH/VAL/HVN/LVN) | ESTIMATED | candle-volume distribution model |
| Absorption / Exhaustion | ESTIMATED | behavioural evidence from volume + price |
| Delta / Cumulative Delta (est.) | ESTIMATED | candle-direction volume pressure (`candle-body-direction-volume` proxy) — NOT bid/ask delta |
| Footprint / Imbalances | UNAVAILABLE | needs classified trades |
| Large Trades | UNAVAILABLE | needs the trade tape |
| Liquidity events / Heatmap | UNAVAILABLE | needs L2 snapshots |
| GEX (covered symbols) | HIGH | real chain: Deribit (BTCUSD/ETHUSD, multiplier 1) + CBOE delayed (~15 min) for SPX500/NAS100/US30 + ETFs/equities |
| GEX (forex/metals) | UNAVAILABLE | no listed options source wired — never faked |

Quality states: `HIGH` (exact data class), `PARTIAL` (real but incomplete),
`ESTIMATED` (different data class, documented model), `UNAVAILABLE`, `STALE`,
`INSUFFICIENT_HISTORY`. A provider implementing `OrderFlowDataProvider` with
real trades/L2/options upgrades the same engines to `HIGH` with no other code
changes — availability is always derived, never asserted.

## Calculation methodology

**Volume Profile.** Each candle's volume is distributed proportionally across
the price bins its high–low range overlaps. POC is the highest-volume bin; the
value area expands from the POC taking the larger neighbour until the
configured percentage (default 70%) of total volume is enclosed — VAH/VAL are
the outer edges of that area. HVN/LVN are the top/bottom bins by volume.
Deterministic: identical candles + settings ⇒ identical output.

**Delta.** Buy = Σ size of buy-classified trades, sell = Σ sell-classified,
delta = buy − sell, delta % = delta / total. Buckets align to the candle
timeframe. Cumulative delta is the running total. Acceleration is the
bucket-over-bucket change of delta. Divergences compare price movement against
bucket delta and cumulative delta (`PRICE_UP_DELTA_DOWN`,
`PRICE_DOWN_DELTA_UP`, `PRICE_UP_CUM_DELTA_DOWN`, `PRICE_DOWN_CUM_DELTA_UP`).
Candle volume is NEVER split into fake buy/sell.

**Estimated delta (candle proxy).** When no classified trades exist, the
delta/cum-delta chart layers render the documented proxy model
(`lib/order-flow/delta-proxy.ts`, method `candle-body-direction-volume`): each
bar's **whole** volume is signed by its body direction (close vs open; doji
bars contribute zero). It measures directional volume pressure — is volume
arriving on bars the market closes up or down — and is always labelled
ESTIMATED (chart chip, panel note, capability reason). It is never merged
with, upgraded to, or presented as bid/ask delta; a provider supplying
classified trades switches the context to the true engine (`delta.ts`) and the
proxy is suppressed. Divergences reuse the same four canonical types but stay
quality-ESTIMATED with the proxy method stamped on every event. AI treatment:
confluence may use it as directional evidence; signal scoring weights it at
half (≤3 of the ≤6 delta points).

**Footprint.** Trades group into bars by timeframe bucket and into price cells
by density setting. Cell delta = ask − bid volume. Stacked imbalance =
≥ N consecutive dominant cells (`imbalanceThreshold` ratio). Diagonal
imbalance = the same dominant side across consecutive bars at rising (buy) or
falling (sell) cell positions.

**Absorption.** Requires: volume expansion vs the rolling average (> threshold
mapped from sensitivity), capped body relative to bar range (progress limited
by volume spent), and at least two independent evidence classes. Full-body
expansion bars are explicitly rejected (they are continuation, not absorption).

**Exhaustion.** Requires: extension ≥ threshold ATRs (body push or extreme
excursion), plus ≥ 2 further classes among volume expansion, delta
deterioration (real trade data only), failed breakout of the prior extreme,
and a weak close position. Exhaustion events are observations, never
automatic reversal signals — the confluence layer records them as conflicts.

**Large trades.** A trade fires when it meets any threshold: absolute size,
strictly above the P-th percentile of the recent window, or ≥ multiple ×
rolling average. The event records which rule fired and its threshold.

**GEX (real chains).** `lib/order-flow/options-provider.ts` fetches the live
chain per symbol: Deribit book summaries for BTCUSD/ETHUSD (mark IV in
percent → fraction, OI in coins, 08:00 UTC expiries parsed from the instrument
name, contract multiplier 1) and CBOE delayed quotes for US listed underlyings
(OCC symbols parsed for expiry/strike/type, decimal IV, provider gamma reused,
spot from the quote endpoint with a prev-day-close fallback). Quotes pass the
fail-closed validator; rejected rows are counted, never repaired. Forex/metals
have no wired source and stay explicitly UNAVAILABLE. The route caches per
symbol for 90 s (negative caching included) so the shared upstream budget is
protected; the client polls at 120 s and the hook passes the chain into the
capability model, where a real chain flips the GEX feature to HIGH with zero
engine changes. Levels render as chart price lines (call walls, put walls,
dotted gamma flip) and a panel block; AI scoring sees the same context.

**Liquidity (real L2 only).** Levels are tracked across snapshots: ADD/REMOVE
on ratio jumps, STACKING/PULLING on consecutive streaks, walls on persistent
oversized levels, sweeps/replenishment on best-bid/ask disappearance and
restoration. Every event carries side, sizes, persistence and distance from
market.

**GEX.** Provider gamma when supplied, else Black–Scholes gamma from
strike/expiry/IV/spot. Dollar gamma per 1% move = gamma × OI × 100 × spot² ×
0.01. Call GEX positive, put GEX negative, net = call − put. Gamma flip is the
strike where the cumulative net ladder crosses zero. Walls are the top strikes
by exposure per side.

## Replay / backtest — future-leakage prevention

- `buildOrderFlowContext` defensively filters every input (`candles`, `trades`,
  L2 snapshots) to `timestamp ≤ asOf`, regardless of what the caller passes.
- `orderFlowAtBoundary(history, i)` computes the state at candle i from the
  prefix 0..i only; `ReplayOrderFlow` streams the same discipline.
- Tests assert the context at boundary i is bit-identical whether the input
  array contains future elements or is pre-truncated (see
  `tests/order-flow/order-flow-replay.test.ts`).
- The same property holds for trades: future prints never influence past
  delta/cumulative delta.

## AI integration

`buildOrderFlowContext` produces the structured evidence the AI signal engine
consumes — normalized facts with traceable source ids, interpretations clearly
separated from facts, and limitations quoted verbatim from the capability
model. `scoreOrderFlowForSignal` maps the context onto the existing
`orderFlow` confidence axis (0–15) direction-relative; with no usable data the
score is 0 and the detail states unavailability — the confidence weight stays
user-controlled, so unavailability never silently deflates signals.

`orderFlowToIntelligence` merges the evidence into the Intelligence Layer
(`lib/market-intelligence/ai/intelligence-layer.ts`) under the new
`order_flow` evidence source, alongside — never replacing — Smart Money and
technical evidence. The AI cannot invent order-flow values: unavailable
capabilities are marked in the context itself, and the prompt-side limitation
lists forbid fabrication.

## Feature flags

| Flag | Default | Effect when false |
| --- | --- | --- |
| `orderFlow.enabled` | on | every hook/panel/engine no-ops; UI identical to pre-feature |
| `orderFlow.volumeProfile` | on | profile layers + profile in context off |
| `orderFlow.delta` | on | delta/footprint engines off |
| `orderFlow.footprint` | on | footprint rendering off |
| `orderFlow.heatmap` | on | heatmap state off |
| `orderFlow.liquidity` | on | L2 event engine off |
| `orderFlow.gex` | on | GEX module off |

Override at deploy time with `NEXT_PUBLIC_ORDER_FLOW_ENABLED=0` (and the
per-feature variants). The canonical feed cannot supply delta/footprint/
heatmap/GEX anyway, so those render as disabled-with-reason in the layer
picker regardless of flags.

## Settings

User-configurable (Account → Settings → Integrations → Order Flow
Intelligence): value area %, profile bins, imbalance threshold, absorption /
exhaustion sensitivity, large-trade thresholds, liquidity wall size, heatmap
intensity + depth, delta mode, footprint density, GEX display options.
Persisted to `users/{uid}/orderFlowSettings` (Firebase Realtime Database) with
a localStorage cache for instant first paint; every load is sanitized/clamped.

## Testing

```
JITI_TSCONFIG_PATHS=1 npx jiti tests/order-flow/order-flow.test.ts        # engines (57 checks)
JITI_TSCONFIG_PATHS=1 npx jiti tests/order-flow/options-provider.test.ts  # options/GEX wiring (9 checks)
JITI_TSCONFIG_PATHS=1 npx jiti tests/order-flow/order-flow-replay.test.ts # replay/leakage/integration (10 checks)
```

Coverage includes: POC/VAH/VAL math, HVN/LVN, session windows, determinism,
developing profile streaming; delta math, cumulative roll, acceleration,
all four divergence types; tick-rule classification; footprint aggregation
and stacked/diagonal imbalances; absorption/exhaustion evidence gates
(including rejection of ordinary high-volume bars); large-trade rules;
L2 walls/added/removed/sweep/replenishment; heatmap bounding; GEX math and
unavailable states; fail-closed validation; capability detection (including
demotion of declared-but-unimplemented provider capabilities); AI context
facts/limitations; replay boundary identity; future-trade exclusion.

## Known limitations

- Delta, footprint, imbalances, large trades, L2 liquidity, heatmap and GEX
  are **structurally unavailable** on the current canonical feed and render as
  explicit unavailable states. Connecting a provider implementing
  `OrderFlowDataProvider.getTrades / getL2Snapshots / getOptionChain` activates
  them (engines + UI states are already wired).
- Volume Profile / absorption / exhaustion are ESTIMATED (candle-grade) by
  design and are labelled as such everywhere they render.
- Aggregation from higher timeframes cannot reconstruct lower-timeframe
  microstructure; order-flow features always state the timeframe they
  computed at and never claim sub-candle resolution.
