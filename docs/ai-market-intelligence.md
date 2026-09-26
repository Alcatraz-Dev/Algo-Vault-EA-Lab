# AI Market Intelligence Methodology — Phase 5

## Architecture
Market Intelligence → Structured Context → AI Layer → Structured Response → User Review
No direct mutation of Trading Studio without validation.

## Context Builder
`buildMarketIntelligenceContext` creates a deterministic context with:
- symbol, timeframe, timestamp
- mode (live/historical/replay/backtest)
- candles (summary only)
- indicators, smart money events, sessions, MTF
- strategy reference (optional)
- backtest summary (optional)
- data quality report
- limitations list

## AI Modes
Live: data represents current state (subject to actual market data availability)
Historical/Replay: only available candles used
Backtest: context from backtest result; no future data

## Evidence Requirement
Every claim must reference evidence IDs or structured events. No unsupported claims.

## No Fabricated Metrics
No confidence percentages unless backed by calibrated statistical model (not LLM estimation). No profitability predictions for unbacktested strategies.

## Limitations
Every response must include known limitations from data quality, execution model, missing timeframes, or OHLC-only constraints.

## Strategy Copilot
Produces `StrategyChangeProposal`, not direct mutation. User must confirm. Proposal passes validation before application.

## Strategy Generator
Produces `StrategyDefinition`. Must pass validator (`lib/market-intelligence/strategies/validator`) before application. No automatic deploy.

## Backtest Analyst
Uses actual `BacktestResult` metrics. Never invents statistics. Highlights actual events linked to trades.

## Safety / Budget / Privacy
Reuses existing `lib/ai/` budget, usage-events, provider router, and privacy rules. No secrets sent. Cost tracked. Rate limits respected.
