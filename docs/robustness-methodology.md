# Robustness & Monte Carlo — Phase 6.3

## Robustness
Execution stress (spread/slippage/commission multipliers), parameter perturbation (around selected config), period/session segmentation.
Every test uses existing Backtest Engine with modified execution config or cloned strategy.
No hidden filtering.

## Monte Carlo
Uses only actual BacktestResult.trades.
Deterministic seed (LCG).
Shuffle and bootstrap methods.
Equity/drawdown/loss-streak calculated from resampled trade sequence.
Insufficient trades handled honestly.
Not predictive.

## Integrity
No optimization loop. No ranking score. No AI selection. No future candles.
