# Phase 3 — Real Backtesting + Historical Replay — Final Report

## Files Created
- lib/market-intelligence/backtesting/adapter.ts (BacktestContext, DataQualityReport, buildBacktestContext)
- lib/market-intelligence/backtesting/validation.ts (lookahead checks)
- lib/market-intelligence/backtesting/replay.ts (ReplayEngine incremental, seek/step/reset)
- docs/backtesting-methodology.md (execution model, replay, metrics, limitations)
- tests/lib/market-intelligence/backtesting.lookahead.test.ts (regression)
- PHASE3_MARKET_INTELLIGENCE.md (this file)

## Files Modified
- lib/market-intelligence/backtesting/engine.ts (execution model documented, adapter reference)
- docs/market-intelligence-architecture.md (Phase 3 section)
- lib/market-intelligence/types.ts (BacktestConfig / BacktestResult already existed; no change needed)

## Existing Engines Reused
- lib/strategy-lab/backtest.ts (existing deterministic execution engine — adapter can call into it)
- lib/analytics/market-structure / liquidity / sessions / multi-timeframe (Smart Money input to backtest context)
- lib/market-data/types (MarketCandle)
- Phase 2 SmartMoneyEngine (replay mode per step)

## Execution Model
- Default: `next_bar_open`
- Signal evaluated at candle close → entry at next candle open
- OHLC-only limitation documented for SL/TP inside same candle

## Replay
- `ReplayEngine.seek(index)` slices `candles.slice(0, index+1)` before computing Smart Money
- `step()` advances by one candle
- `reset()` returns to start
- No future candles ever visible

## Smart Money Integration
- `BacktestContext.smartMoneyEvents` only includes events with `timestamp <= T`
- Strategy rules can reference structure, liquidity, FVG, OB, session from real engine output
- Metadata links trades to real Smart Money triggers

## Look-Ahead Protection
- `buildBacktestContext` filters candles and events by timestamp
- Regression test proves altering future array elements does not change past replay result
- Data validation reports gaps / duplicates / invalid OHLC before execution

## Metrics / Analytics
- Actual metrics come from `Trade[]` produced by execution (reuses strategy-lab metrics when integrated)
- Equity curve recorded per candle from account state
- Drawdown calculated from equity curve
- Session / hour / day grouping supported by context

## Honesty / Limitations
- If historical dataset missing / insufficient → `status = "insufficient"` in DataQualityReport
- Spread: fixed if historical unavailable; clearly stated in report
- Commission / slippage documented and applied consistently
- Intrabar SL/TP ordering: limitation explicitly exposed

## Phase 4 Readiness
- `BacktestContext` interface provides all needed inputs for Strategy Lab visual builder
- `SmartMoneyEvent[]` serialized; can feed strategy conditions (AND/OR/NOT)
- Replay engine can drive visual replay UI
- Data quality report provides transparency for users
- Existing `lib/strategy-lab/` execution preserved; adapter connects rather than replaces

## Not Implemented (by design)
- Phase 4 Strategy Lab visual builder (ready for integration)
- Phase 5 AI layer
- Phase 6 Scalping Terminal
- Full PDF export (can be added after engine is verified)
