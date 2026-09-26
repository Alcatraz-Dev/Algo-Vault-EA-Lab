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
