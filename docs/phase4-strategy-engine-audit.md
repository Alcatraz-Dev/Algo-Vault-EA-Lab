# Phase 4 — Strategy / Backtest / Replay / Paper Audit

Classification of every strategy-related subsystem **before** building the Unified Strategy
Execution Layer. Nothing listed as WORKING is being replaced; the canonical engine reuses it.

Legend: `WORKING` · `PARTIALLY_WORKING` · `BUGGY` · `PLACEHOLDER` · `DUPLICATED` ·
`INCONSISTENT` · `NEEDS_REFACTOR` · `NEEDS_REARCHITECTURE`

---

This is an implementation audit and integration-scope note, not a claim that every requested
product workflow is already shipped. The canonical engine APIs and standalone environment
harnesses are implemented; UI, feed, persistence, and legacy gateway connections are called out
as pending wherever they remain unconnected.

## 1. Strategy definitions & authoring

| Component | Path | Status | Notes |
|---|---|---|---|
| Canonical strategy schema (`Strategy`) | `lib/strategy-lab/types.ts` | **WORKING** (NEEDS_REFACTOR) | Richest existing model: rules, SL/TP, risk, filters, execution model, costs, `version: string`. Used by backtest, forward, optimizer, validation, EA generation, research. → **adopted as the canonical `StrategyDefinition`.** Versioning exists but is not tied to experiment records → extended in `lib/strategy-engine/versioning.ts`. |
| Strategy Lab rule semantics | `lib/strategy-lab/backtest.ts` (rule eval) | **WORKING** (NEEDS_REFACTOR) | Deterministic group/AND-OR rule evaluation against causal `CandleFeatures`. Monolithic inside the backtest loop → extracted to `lib/strategy-engine/decisions.ts` and reused by every environment. |
| Rule groups (trend/structure/fvg/…) | `lib/strategy-lab/types.ts` `RuleGroup` | **PARTIALLY_WORKING** | No generic indicator condition (e.g. `RSI > 50`) — added optional `indicator` rule group (additive, fingerprint-stable). |
| Node-graph strategy definition | `lib/market-intelligence/strategies/types.ts` | **DUPLICATED / NEEDS_REARCHITECTURE** | Second strategy schema (React-Flow nodes/edges). Authoring format only — cannot stay a parallel execution model. Kept as an authoring layer; execution requires compiling into the canonical model. |
| Graph validator | `lib/market-intelligence/strategies/validator.ts` | **WORKING** | Graph meta, duplicate ids, cycles — reuses workflow validation concepts. Keep for authoring. |
| Graph → executable compiler | `lib/market-intelligence/strategies/adapter.ts` | **PLACEHOLDER** | `evaluateCondition` only matches Smart Money event types; no indicator conditions, no risk, no sizing. |
| AI strategy draft → strategy | `lib/strategy-lab/interpret.ts`, `lib/ai/strategy-lab/*` | **WORKING (AUTHORING ONLY)** | Deterministic mapper of AI scaffold → canonical `Strategy` (AI never emits code). Reused as-is; runtime state/trades are not yet wired into AI consumers. |
| Pine scripts | `lib/pine-runtime/*` | **WORKING** | Parallel paradigm, shares `computeMetrics`. Not canonical for AlgoVault strategies; kept. |

## 2. Backtesting

| Component | Path | Status | Notes |
|---|---|---|---|
| Strategy Lab backtest engine | `lib/strategy-lab/backtest.ts` | **WORKING + BUGGY (BUGS FIXED IN CANONICAL PATH)** | Deterministic single pass, next-bar-open execution, cost model, diagnostics, CI parity tests. Bugs identified: weekday gate, trailing-stop activation/timing, and gap handling. The canonical engine fixes and tests these behaviors; legacy compatibility is covered by Strategy Lab parity tests. MAE/MFE is added in `lib/strategy-engine/analytics.ts`. |
| Metrics | `lib/strategy-lab/metrics.ts` | **WORKING** (NEEDS_REFACTOR) | Solid core (PF, expectancy, DD, consecutive, Sharpe-like on R). Missing MAE/MFE, payoff, Sortino/Calmar, session/regime/time-of-day segmentation, drawdown-period trade attribution. Extended in `lib/strategy-engine/analytics.ts`, not replaced. |
| Market Intelligence `runBacktest` | `lib/market-intelligence/backtesting/engine.ts` | **PLACEHOLDER (NOT INTEGRATED)** | Still returns zero trades / flat equity. The new canonical engine exists, but this legacy entry point has not yet been wired to it. |
| MI backtest context builder | `lib/market-intelligence/backtesting/adapter.ts` | **PARTIALLY_WORKING** | Correct no-look-ahead slicing, but rebuilds `SmartMoneyEngine` per timestamp (O(n²)) and is unused by any real run. |
| Dataset validation | `lib/market-intelligence/backtesting/adapter.ts` `validateDataset` | **WORKING** | Gaps/dupes/invalid OHLC report — reused. |
| Position sizing | inline in `backtest.ts`, `lib/performance-arena/execution.ts`, `lib/ai-signals/*` | **DUPLICATED / INCONSISTENT** | Three formulas; lot-step/min-lot/max-lot not enforced consistently (e.g. `0.004` lots → silently rounds to `0.00` and is skipped). → `lib/strategy-engine/simulation.ts` sizing with `SYMBOL_SPECS`. |
| Regime detection | `lib/analytics/market-regime.ts` | **WORKING** (INCONSISTENT) | Deterministic, documented. Backtest stride-samples it every 4 bars while forward recomputes per call → labels can diverge. Unified resolver in `decisions.ts`. |
| Session labels | `lib/strategy-lab/features.ts` `sessionOf` vs `lib/analytics/sessions.ts` | **DUPLICATED** | Two UTC session maps (asian/london/ny/overlap). Features version is the one strategies trade on; documented as canonical for strategy conditions. |

## 3. Execution / orders / account

| Component | Path | Status | Notes |
|---|---|---|---|
| Order lifecycle | `trading_order_requests` RTDB writes in `lib/strategy-lab/execution.ts` | **NEEDS_REARCHITECTURE** | Ad-hoc status string (`PENDING_GATEWAY_EXECUTION`), no canonical state machine (CREATED→SUBMITTED→…→FILLED/REJECTED). → `lib/strategy-engine/orders.ts`. |
| Order simulation (costs) | inline in `backtest.ts` | **WORKING** (NEEDS_REFACTOR) | Spread/slippage/commission charged per leg, but inline and untestable in isolation → extracted to `lib/strategy-engine/simulation.ts` and `adapters.ts`. |
| Demo/paper order sims | `chrome-extension/.../DemoTradingView.tsx`, `lib/performance-arena/execution.ts` | **DUPLICATED** | Two independent simulated-execution stacks with different cost rules. Not merged in this phase; the new Paper Adapter becomes the canonical paper path. |
| Account/portfolio state | inline `balance`/`peak`/`dailyPnl` in backtest loop | **NEEDS_REARCHITECTURE** | No canonical account model (equity/margin/exposure/drawdown/daily P&L). → `lib/strategy-engine/account.ts`. |
| Risk engine | `lib/risk/risk-engine.ts` + inline backtest limits | **PARTIALLY_WORKING** | `lib/risk` covers AI/agent risk; backtest has daily-loss/drawdown/max-positions inline only. → unified `lib/strategy-engine/risk.ts` used by all environments. |

## 4. Signals / forward / live / EA

| Component | Path | Status | Notes |
|---|---|---|---|
| Shared signal evaluator | `evaluateStrategySignal` (`backtest.ts`) | **WORKING (CALLERS PARTIALLY INTEGRATED)** | The legacy helper now delegates to `decisions.ts`; forward/deployment callers still require review/wiring to use the canonical engine end-to-end. |
| Deployment / forward test | `lib/strategy-lab/execution.ts`, `forward.ts` | **PARTIALLY_WORKING** | Persistence + notifications work; exit management and sizing differ from backtest; live path writes an order request only when gateway connected. |
| MQL5 / EA Lab | `lib/strategy-lab/ea/*` | **WORKING (SEPARATE GENERATED RUNTIME)** | Compile + parity tests in CI. Consumes the canonical `Strategy`, but generated MQL5 is a separate runtime whose full behavior is not executed through the TypeScript adapter. |
| Live abstraction | `trading_order_requests` + EA gateway | **PARTIALLY_WORKING** (NEEDS_REFACTOR) | Existing gateway path remains separate; this phase adds a fail-closed `LiveAdapter` abstraction but does not wire the legacy live gateway through it. |

## 5. Replay

| Component | Path | Status | Notes |
|---|---|---|---|
| `ReplayEngine` | `lib/market-intelligence/backtesting/replay.ts` | **WORKING / PARTIALLY_WORKING** | Progressive reveal, future candles never returned, SMC events only from available candles (tested). Missing: play/pause/speed, step-back state restore, manual orders, strategy execution. → wrapped by `lib/strategy-engine/replay.ts`, not replaced. |
| Replay UI adapters | `lib/market-intelligence/replay-ui-adapter.ts`, `components/market-intelligence/backtest/ReplayAdapter.ts` | **PLACEHOLDER (NOT ENGINE-WIRED)** | Existing UI adapters mirror index/progress only; the new `ReplaySession` has no user-facing integration in this phase. |
| Trade replay page | `app/trade-replay/page.tsx`, `components/tradingview/MarketReplay.tsx` | **WORKING (SEPARATE FLOW)** | Own candle-reveal UI, no strategy engine attached; remains separate until explicitly wired. |

## 6. Paper trading

| Component | Path | Status | Notes |
|---|---|---|---|
| Paper account | — | **PLACEHOLDER** | No isolated paper account model exists (no deposits/withdrawals/history/attribution). → `lib/strategy-engine/paper.ts`. |
| Real market data | `lib/market-data/live-feed.ts`, `live-stream.ts`, `tradingview-live.ts` | **WORKING (SOURCE AVAILABLE; NOT UI-WIRED)** | These existing feeds can provide quotes to `PaperAdapter`; this phase defines the adapter contract but does not connect a product UI/feed subscription to a paper session. |

## 7. Alerts / AI / research / chart

| Component | Path | Status | Notes |
|---|---|---|---|
| Alert engine | `lib/pine-runtime/alert-engine.ts` | **WORKING** (INCONSISTENT) | Pine-only; this phase adds `lib/strategy-engine/alerts.ts` to map canonical evaluations to alert payloads, but does not connect it to the notification delivery/UI pipeline. |
| AI strategy logic | `lib/ai/strategy-lab/*`, `lib/market-intelligence/ai/*` | **PARTIALLY_WORKING** | Generation/validation solid; no structured runtime state (decisions, positions, traces) exposed for AI inspection → `StrategyContext` + `DecisionTrace`. |
| OOS / walk-forward / Monte Carlo | `lib/strategy-research/runner.ts`, `lib/market-intelligence/research/{oos,monte-carlo}` | **WORKING** (DUPLICATED) | Two research stacks exist with real dataset separation and seeded RNG. Both kept; the canonical engine feeds both. No fake WFA/MC numbers found. |
| Chart overlays / markers | `lib/chart-engine/overlay-contract.ts` | **WORKING** (PLACEHOLDER for strategies) | Marker layer exists for structure events; this phase adds `lib/strategy-engine/chart-markers.ts` in time/price market coordinates, but native-chart rendering and stale-marker cleanup are not UI-wired. |
| Backtest UI | `app/market-intelligence/backtest/page.tsx` | **PLACEHOLDER** | Static shell ("Run a backtest to see trade history"). Strategy Lab client (`components/strategy-lab/StrategyLabClient.tsx`) is functional. |

---

## Canonical decisions taken

1. **`Strategy` (`lib/strategy-lab/types.ts`) is the canonical `StrategyDefinition`.** The node-graph
   format stays an authoring layer and must compile into it. No third schema.
2. **Rule evaluation, entry gating, stop/TP computation, sizing, cost application and exit
   detection move into `lib/strategy-engine/*` and are imported by `lib/strategy-lab/backtest.ts`**
   (one implementation, many environments).
3. **Bugs fixed during extraction** (documented, covered by tests): `daysOfWeek` gate now enforced
   in backtests (matches diagnostics + forward); trailing stop no longer dead (activation condition
   fixed) and no longer reads the same bar's close to test that bar's own low; gap-aware fills
   (a stop filled at the bar open when the market opened through the stop).
4. **Nothing fabricated**: metrics are computed only from executed trades; insufficient datasets are
   flagged `INSUFFICIENT_DATA`; OHLC-only fill assumptions are surfaced as `SIMULATION_ASSUMPTION`.
5. **Integration boundary**: this phase delivers the reusable engine APIs and tests, not every product
   connection. Legacy Market Intelligence backtest, chart rendering, alert delivery, real-feed-to-paper
   wiring, and replay/paper UI integration remain follow-up work; they must call this engine rather
   than implement parallel decisions.
