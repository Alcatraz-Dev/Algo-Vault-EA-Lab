# Backtest Terminal — Phase 7.1 Methodology

## Source of Truth
All metrics, trades, equity, drawdown come from existing Backtest Engine / Adapter (Phase 3).
No new execution logic.

## UI Integration
Components created:
- BacktestHeaderAdapter
- PerformanceOverview
- ChartAdapter (layer toggles referencing overlay adapter)
- SmartMoneyPanel (references real SmartMoneyEngine)
- TradeJournalAdapter (formats actual BacktestTrade)
- ReplayAdapter (references ReplayEngine)
- LimitationsPanel (exposes real limitations)
- Redesigned backtest page using these adapters.

## Chart / Cross-Highlighting
Uses existing `chart-overlay-adapter.ts` and `trading-studio-integration.ts`.
No duplicate chart engine.

## Integrity
Same strategy + same data = same metrics (deterministic).
No future candles during replay.
Data Quality visible.
Limitations not hidden.
Trading Studio / Strategy Lab preserved.
