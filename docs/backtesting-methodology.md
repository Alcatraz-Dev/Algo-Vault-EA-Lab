# Backtesting Methodology — Phase 3

## Execution Model
- Signal evaluated at bar[i] close.
- Execution allowed at bar[i+1] open (`next_bar_open`).
- Same-bar close mode is documented but not currently active.

## Smart Money in Backtesting
Every `BacktestContext` receives:
- `candles`: only candles with `timestamp <= T`
- `smartMoneyEvents`: only events with `timestamp <= T`
This guarantees no look-ahead.

## Replay
`ReplayEngine.seek(index)` slices `candles.slice(0, index+1)` before computing Smart Money. No future data visible.

## Data Validation
`validateDataset()` checks:
- sorted timestamps
- duplicates
- invalid OHLC
- approximate gap detection
- status (`complete` / `incomplete` / `insufficient`)

## Order Simulation
Uses `next_bar_open`: entry at open of next candle after signal.
SL and TP evaluated on each candle's OHLC according to declared model.
If SL and TP both trigger inside same candle, the limitation is documented: OHLC-only data cannot establish intrabar ordering.

## Metrics Source
Every metric comes from the actual `Trade[]` array produced by the engine. No simulated statistics.

## Limitations (always exposed)
- OHLC data: tick-level execution unavailable.
- Spread: historical spread unavailable unless dataset provides it; fixed spread used otherwise.
- Smart Money events require sufficient candles; insufficient data returns empty results.
- Replay hides future candles by slicing the array before passing to engine.
