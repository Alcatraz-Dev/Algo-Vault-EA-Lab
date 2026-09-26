# AlgoVault Market Intelligence — Architecture (Phase 1)

## Layers

Market Data Engine (lib/market-intelligence/engine)
  → Normalized candles (reuses lib/market-data/normalizer)
  → Validation (timestamp order, OHLC consistency)

Technical Analysis Engine (lib/market-intelligence/indicators/adapter)
  → RSI, EMA, MACD, ATR, Bollinger, Supertrend (reuses lib/analytics/indicators)
  → Configurable parameters, no hardcoded values

Smart Money Engine (lib/market-intelligence/smart-money/engine)
  → Structure, Liquidity, FVG, OB proxies (reuses lib/analytics/market-structure, liquidity)
  → Only returns when data supports detection
  → Terminology explicitly accurate (not institutional guarantees)

Backtesting Engine (lib/market-intelligence/backtesting/engine)
  → Deterministic rules only
  → Replay hides future candles
  → No fake metrics — limitations exposed when data missing

Strategy Engine (lib/market-intelligence/strategies/adapter)
  → Adapter to Trading Studio / Strategy Lab (does not replace)
  → Node types: Market, Indicator, Structure, Liquidity, FVG, OB, Session, MTF, Condition, Entry, Exit, Risk

## Phase 3 — Backtesting + Replay (Completed)

Backtesting Adapter (lib/market-intelligence/backtesting/adapter.ts)
  → BacktestContext only include candles/events <= T
  → DataQualityReport from validateDataset
  → Smart Money events serialized and consumed deterministically

Replay Engine (lib/market-intelligence/backtesting/replay.ts)
  → Incremental seek/step/reset
  → SmartMoneyEngine in replay mode per step
  → Future candles never exposed

Execution Model (docs/backtesting-methodology.md)
  → next_bar_open default; signal at bar[i] close → entry at bar[i+1] open
  → Same-bar close documented; not active by default

Look-ahead Protection (tests/lib/market-intelligence/backtesting.lookahead.test.ts)
  → Regression test: altering future candles does not change past replay

## Phase 4 — Strategy Lab + Trading Studio Integration (Completed)

Strategy Definition (lib/market-intelligence/strategies/types.ts)
  → Visual node graph (reusing Workflow Automation / React Flow patterns from lib/workflows/)
  → Node categories: market, indicator, smart_money, session, mtf, logic, entry, exit, risk

Validator (lib/market-intelligence/strategies/validator.ts)
  → Reuses graph meta / cycle detection patterns from lib/workflows/validate
  → Checks missing entry/exit, disconnected nodes, unsupported indicators, Smart Money config

Compiler / Adapter (lib/market-intelligence/strategies/adapter.ts)
  → Compiles StrategyDefinition into executable conditions for backtest adapter
  → SmartMoneyEngine consumed in replay mode per step

Backtest / Replay (existing Phase 3)
  → ReplayEngine.seek/step/reset
  → Trade-correlation links trades to real Smart Money events

Persistence / Security
  → Existing Trading Studio / Strategy Lab preserved
  → Firebase RTDB unchanged
  → Strategy versioning prevents historical mutation via definition.version

No duplicate execution engine. No AI optimization (Phase 5). No fake statistics.

## Phase 5 — AI Intelligence (Phase 5 Infrastructure Complete)

AI Layer (lib/market-intelligence/ai/)
  → Context Builder (deterministic, mode-aware)
  → Guardrails (no fabricated probability; evidence-only; no direct execution)
  → Market Analyst (structured responses with limitations)
  → Strategy Copilot (proposes; requires user confirmation)
  → Strategy Generator (produces StrategyDefinition; requires validation)
  → Backtest Analyst (real metrics only)
  → Prompt Builder (system/user/data separation)

Key principles:
- AI sits ON TOP of deterministic engines.
- Every response includes mode, timestamp, limitations, evidence.
- No invented confidence / probability / profitability.
- No direct trade execution.
- Existing AI budget / usage tracking reused.
- No second AI infrastructure.

AI Intelligence Layer (Phase 5)
  → Receives structured context from above engines
  → Must not invent numbers
  → Separates Observed / Calculated / Historical / AI Interpretation

## Data Flow

Market Data → Normalized Candles → Indicators → Structure → Liquidity → FVG / OB → Strategy Conditions → Backtest → Statistics → AI Interpretation

## Phase 2 — Smart Money Detection (Completed)

Smart Money Engine (lib/market-intelligence/smart-money/engine.ts)
  → Swing detection: reuses `lib/analytics/market-structure` `getSwingPoints` (lookback=3, documented)
  → Structure: `detectStructure` (BOS/CHOCH/MSS), `getOverallStructureBias`
  → Liquidity: `detectLiquidity` (equal high/low tolerance=0.001, previous day/week, swing, sweep confirmation)
  → FVG: deterministic 3-candle definition (bullish/bearish gap), state tracking, CE midpoint
  → Order Blocks: last bearish/bullish candle before displacement, status lifecycle
  → Sessions: UTC explicit (`lib/analytics/sessions`)
  → MTF: `getMultiTimeframeBias` adapter (requires per-timeframe candle input)
  → Mode distinction: `historical` / `replay` / `live`; replay/live never peek ahead

Methods documented in `docs/smart-money-methodology.md`.

## Constraints Honored

- No fake market statistics
- No hardcoded AI confidence scores
- Real calculations only; limitations exposed
- Existing Trading Studio, React Flow, Firebase RTDB, auth unchanged
- No second auth; no Ollama; no Firestore replacement

## Phase 6.3 — Robustness & Monte Carlo (Completed)

Robustness (lib/market-intelligence/research/robustness/)
  → Execution stress: spread/slippage/commission multipliers
  → Parameter perturbation: deterministic around selected config
  → Period/session segmentation: actual backtests

Monte Carlo (lib/market-intelligence/research/monte-carlo/)
  → Source: actual BacktestResult.trades only
  → Deterministic seed (LCG)
  → Shuffle + bootstrap methods
  → Equity/drawdown/loss-streak distributions

Safety
  → No optimization loop
  → No ranking score
  → No AI selection
  → Existing Backtest Engine reused
  → Trading Studio preserved

## Phase 6.4 — Research Evaluation (Completed)

Evaluation (lib/market-intelligence/research/evaluation/)
  → comparison.ts (deterministic metric comparison)
  → stability.ts (factual stability summary, no score)
  → selection.ts (explicit user selection, no ranking)

No automatic optimization. No score. No best-strategy claim.
Trading Studio source of truth preserved.


## Phase 7.1 — Backtest Terminal UI (Completed)

Backtest Terminal (app/market-intelligence/backtest/page.tsx)
  → Professional terminal layout with header, performance cards, equity/drawdown chart reference, trade journal, Smart Money panel, replay adapter, limitations panel

Components (components/market-intelligence/backtest/)
  → BacktestHeaderAdapter, PerformanceOverview, ChartAdapter, SmartMoneyPanel, LimitationsPanel, TradeJournalAdapter, ReplayAdapter

Integration
  → Existing Phase 3 Backtest Engine source of truth
  → Existing ReplayEngine preserved
  → Existing Smart Money Engine preserved
  → Existing phase adapters (chart-overlay, replay-ui, trading-studio-integration) reused
  → Trading Studio / Strategy Lab / React Flow untouched

No new execution engine. No fake statistics. No fabricated results.

## Phase 7.3 — Unified Workspace & Cross-Page Integration (Completed)

Workspace adapter: components/market-intelligence/workspace-context.ts
  → Validates context fields (symbol/timeframe/dataset/strategy/backtest/research/trade/event/replay)
  → Serializes to URL-safe encoded JSON (encodeContext / decodeContext)
  → Safe fallback for invalid/missing input
  → No secrets, no large datasets, no arbitrary deserialization
  → Reuses existing workspace load/save (lib/market-intelligence/workspace.ts)

Cross-page actions (no duplicate navigation state):
  → Backtest page → Open in Advanced Analysis / Continue Research / Trading Studio
  → Advanced Analysis page → Backtest Current Setup / Continue Research / Trading Studio

Integration preserved:
  → Smart Money / Backtest / Replay / MTF / Indicators / Sessions / Strategy / AI / Trading Studio / React Flow / Firebase untouched
  → Replay preserves future-candle/event/trade hidden rules (ReplayEngine unchanged)
  → No second chart/workspace/replay/research/strategy/backtest engine created

Limitations:
  → Only fields that existing architecture provides are preserved; arbitrary user data not stored
  → Trade/event IDs preserved when provided by existing Backtest/SmartMoney engines; no synthetic IDs created
  → Timestamp/replay position preserved but bounded by dataset validity
  → Invalid URL parameters fall back to empty state (not fabricated)

Tests: tests/lib/market-intelligence/workspace/workspace-context.test.ts
  → Serialization, parsing, validation, invalid fallback, secret exclusion

## Phase 7.5 — End-to-End Validation & Hardening (Completed)

Status: PASS WITH DOCUMENTED LIMITATIONS
No new engines. No feature creep.
Validated flows: Analysis → Backtest → Research → Trading Studio → Analysis
Replay safety verified: future candles/events/trades/indicators excluded from AI context
Workspace continuity verified with save/load + URL encode/decode + fallback
Security verified: malicious payloads rejected; no secrets in URLs; no direct provider calls
Backtest execution semantics unchanged (next_bar_open preserved)
AI evidence integrity: facts / interpretations / limitations separated; no fake confidence / predictions
Tests added: replay-leakage, security-context, workspace-continuity
Existing Phase 1–7.4 systems preserved

## Phase 8 — Command Center (Completed)

Unified entry: app/market-intelligence/page.tsx
Components: components/market-intelligence/command-center/ (EvidencePanel, QuickActionsAdapter)
No new engines. Reuses Workspace / SmartMoney / Backtest / Replay / AI / Strategy / Trading Studio / Chart / Workspace adapters.
Cross-page links preserved. Replay safe. AI advisory only. Security preserved. Limitations exposed.
