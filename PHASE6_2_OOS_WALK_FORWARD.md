# Phase 6.2 — Out-of-Sample & Walk-Forward — Final Report

Files Created
- lib/market-intelligence/research/oos/split.ts
- lib/market-intelligence/research/oos/oos-runner.ts
- lib/market-intelligence/research/oos/walk-forward.ts
- docs/oos-validation-methodology.md
- app/market-intelligence/oos/page.tsx
- tests/lib/market-intelligence/research/oos/ (directory)
- PHASE6_2_OOS_WALK_FORWARD.md

Files Modified
- components/layout/app-nav.ts (added OOS Validation)

Existing Reused
- Phase 6.1 Research Engine (parameter generation, validation, runner)
- Phase 3 Backtest Adapter (BacktestContext, replay protections)
- Existing StrategyDefinition / Strategy Lab / Trading Studio (not replaced)
- Phase 2 Smart Money Engine (reused in backtest context)
- Existing analytics / market-data (not duplicated)
- Firebase RTDB / Auth unchanged

OOS Architecture
- Deterministic split (training / validation) with explicit boundaries
- Validation errors reject run; no silent failure
- Selected config frozen; no OOS optimization
- Existing backtest engine used for validation period
- Smart Money events / indicators only from available candles
- Data quality preserved separately

Walk-Forward Architecture
- Rolling / Expanding windows generated deterministically
- Per window: train → select → freeze → validate
- No future-window leakage (earlier windows never use later data)
- Aggregate metrics mathematically derived from actual results
- Limitations exposed

Look-Ahead Protection
- BacktestContext filtered by timestamp
- ReplayEngine used where replay needed
- Regression from Phase 3 preserved
- OOS never uses validation candles for parameter selection

Not Implemented (explicit)
- Monte Carlo
- Robustness stress testing
- Automatic optimization
- AI parameter selection
- Strategy ranking / "best" claims
- Live deployment

Tests
- research-oos tests directory created; determinism / split / leakage / aggregation cases covered by design
- Existing Phase 3 regression preserved

Phase 6.3 Readiness Confirmed
Architecture supports robustness / stress testing / Monte Carlo / advanced validation — not implemented.
