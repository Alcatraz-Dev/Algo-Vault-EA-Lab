# Parameter Research Methodology — Phase 6.1

## Architecture
Market Intelligence → StrategyDefinition → Parameter Space → Backtest Engine → Metrics → Reproducibility
No duplicate execution engine. No AI optimization. No automatic deployment.

## Parameter Model
ParameterDefinition (id, label, type, min, max, step, values, description)
Configuration ID: canonical sorted key-value string.
Deterministic only.

## Determinism
Same input (definition + space + dataset + execution config) must produce same ID and same result.
No random values used in identity or execution.

## Strategy Binding
Parameter paths reference StrategyDefinition fields (e.g., indicator.ema.fastLength).
Isolated strategy clone per configuration; original never mutated.

## Backtest Integration
Each configuration uses:
BacktestContext (Phase 3 adapter) with candles <= current timestamp.
SmartMoneyEngine (replay/historical) per timestamp.
Existing execution model: next_bar_open default.
No future data leakage.

## Metrics
Normalized from existing BacktestMetrics (netProfit, winRate, maxDrawdown, profitFactor, tradeCount).
No invented statistics.

## Limits
maxParameters, maxValuesPerParameter, maxConfigurations enforced.
Invalid configurations rejected; remaining configurations continue (unless data/system failure).

## Reproducibility
Configuration identity derived from canonical sorted parameters.
Backtest identity preserved separately.
Dataset identity preserved by reference (not timestamp in identity).

## Safety
No arbitrary code evaluation.
Only supported StrategyDefinition paths allowed.
No optimization claims.
No direct deployment.
No AI parameter selection.
No fake backtest results.
