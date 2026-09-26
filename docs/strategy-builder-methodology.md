# Strategy Builder Methodology — Phase 4

## Architecture
Strategy Definition (visual graph) → Compiler (adapter) → Existing Backtest Engine → Replay → Analytics.
No duplicate execution engine. Trading Studio / React Flow preserved.

## Strategy Nodes
Categories extend existing Workflow Automation node registry patterns:
- market (symbol, timeframe, price, volume)
- indicator (EMA, SMA, RSI, MACD, ATR, etc.)
- smart_money (BOS, CHoCH, MSS, sweep, FVG, OB, session)
- session (Asia, London, NY, overlap)
- mtf (M1, M3, M5, M15, M30, H1, H4)
- logic (AND, OR, NOT)
- entry (long, short)
- exit (close, TP, SL, trailing)
- risk (fixed_quantity, fixed_notional, risk_percent)

## Validation
Uses graph meta, topo sort, cycle detection (reuses lib/workflows/validate concepts).
Checks: duplicate ids, missing entry/exit, disconnected nodes, unsupported indicators, Smart Money node config.

## Backtest Integration
`BacktestContext` (Phase 3 adapter) receives only candles/events <= T.
`SmartMoneyEngine` runs in replay mode per step.
No future data leakage.

## Replay
`ReplayEngine.seek()` slices candles before computing events/indicators.
Replay UI can use this directly.

## Trade-Correlation
Trade metadata links to real Smart Money events (structure, liquidity, FVG, session).
No invented triggers.

## Execution Model
`next_bar_open` (Phase 3). Signal at bar[i] close → entry at bar[i+1] open.

## Limitations
- Strategy optimization (Phase 5) not implemented.
- AI strategy generation (Phase 5) not implemented.
- Strategy export/deploy adapter is prepared but not fully implemented.
- Visual React Flow nodes are referenced; full node-editor UI requires Trading Studio integration beyond adapter.
