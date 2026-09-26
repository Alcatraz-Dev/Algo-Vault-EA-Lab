# Phase 11 — AI Scalping Terminal Audit

## Existing Engines Reused

- Workspace Context: `components/market-intelligence/workspace-context.ts`
- Chart adapter: `components/market-intelligence/ai-panel-adapter.ts`
- Smart Money: `lib/market-intelligence/smart-money/`
- Backtest: `lib/market-intelligence/backtesting/`
- Indicators: `lib/market-intelligence/indicators/`
- AI Router: `lib/ai/`
- AI Analysis: `lib/ai/analysis/`
- AI Budget/Usage: `lib/ai/budget.ts`
- AI Health: `lib/ai/health.ts`
- AI Memory: `lib/market-intelligence/memory/`
- Monitoring: `lib/market-intelligence/monitoring/`
- Analytics: `lib/market-intelligence/analytics/`
- Chart Overlay: `lib/market-intelligence/chart-overlay-adapter.ts`
- Workspace persistence: `lib/market-intelligence/workspace.ts`

## Integration Points

- `/market-intelligence/scalping` → uses workspace context + AI analysis + smart money + chart
- `/market-intelligence/advanced` → uses same workspace + deeper analysis

## What Exists

- `workspace-context.ts` provides validated symbol/timeframe/data context
- `smart-money/` provides structure/liquidity logic
- `backtesting/` provides historical replay infrastructure
- `indicators/` provides indicator implementations
- `ai/` provides multi-provider routing and analysis

## What Must NOT Be Invented

- No fabricated OHLC data
- No fabricated Smart Money events
- No fabricated AI analysis results
- No fabricated indicator values
- No fake trade executions
- No fabricated MTF alignment scores

All displayed data must originate from existing services/components.
