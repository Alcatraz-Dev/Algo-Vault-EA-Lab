# Out-of-Sample & Walk-Forward Methodology — Phase 6.2

## OOS
Training period → parameter selection (Phase 6.1) → freeze config → validation period only → existing Backtest Engine → metrics.
No parameter selection on OOS data.
Split deterministic, explicit, documented.
Data quality preserved separately.

## Walk-Forward
Rolling / Expanding windows generated deterministically.
Per window: training → selection → freeze → validation → metrics.
No future window data in earlier windows.
Aggregation only from actual results.

## Leak Protection
BacktestContext filtered by timestamp.
SmartMoneyEngine replay/historical only on available candles.
No future candle access.

## Limitations
Not implemented: Monte Carlo, robustness stress testing, automatic optimization, AI selection.
