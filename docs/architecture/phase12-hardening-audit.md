# Phase 12 — Intelligence Hardening Audit

## Phase 11 Baseline Verified
- `app/market-intelligence/scalping/page.tsx` — truthful empty states, references workspace context
- `app/market-intelligence/advanced/page.tsx` — links to backtest, smart money, indicators
- `docs/architecture/phase11-audit.md` — audit complete
- `Phase11_AI_Scalping_Verification_Report.md` — PASS WITH LIMITATIONS

## Existing Engines Actually Reused (Verified by Import Trace)
- `lib/market-intelligence/smart-money/engine.ts` — deterministic from OHLC candles (detectStructure, detectLiquidity, getMultiTimeframeBias)
- `lib/ai/analysis/intelligence.ts` — `Sourced<T>` provenance; never invents; unavailable explicit
- `lib/market-intelligence/types.ts` — Timeframe, SmartMoneyEvent definitions
- `components/market-intelligence/workspace-context.ts` — validated symbol/timeframe context
- `lib/analytics/market-structure`, `lib/analytics/liquidity`, `lib/analytics/indicators`, `lib/analytics/sessions`, `lib/analytics/multi-timeframe` — used by smart-money/AI
- `lib/market-data/types.ts` — CandleBundle, MarketCandle
- Backtest/Replay infrastructure exists at `lib/market-intelligence/backtesting/`

## Data Flow (Actual Code Path)
Market Data → analytics (structure/liquidity/indicators) → smart-money engine / AI intelligence → workspace context → UI/AI

No second engine exists for any of these.

## Missing Behavioral Validation (Phase 12 Addresses)
- No deterministic MTF alignment wrapper with explicit states (aligned/mixed/conflicting/insufficient/unavailable)
- No data-quality representation tied to analysis eligibility
- No formal setup lifecycle object (idle/forming/confirmed/invalidated/insufficient)
- No AI evidence contract / boundary schema enforced at module level
- No historical-bridge reference module linking to backtest/replay
- No failure-isolation wrapper ensuring one subsystem failure doesn't break terminal
- Pages reference concepts but don't enforce category separation (Observed / Derived / Historical / AI Interpretation)
- No structured context pipeline container

## Performance / Security / Quality Risks
- No caching/debounce enforced for AI calls at module level
- No explicit data-quality gate before AI eligibility
- Client-side pages use basic state; no server-side structured context pipeline
- Existing security preserved (auth via Firebase, AI secrets server-side, no new endpoints exposing secrets)

## Limitations That Remain After Phase 12
- Live market-data feeds are still required for full context; when unavailable, state must remain unavailable (not fake)
- Smart Money signals remain dependent on candle confirmation rules (lookback documented; live mode excludes unconfirmed swings)
- Historical evidence requires existing backtest/replay session; no synthetic statistics created
- Full MTF depends on available timeframes from feed (M3 unavailable from some feeds; documented)
- AI explanation remains interpretive; not predictive; no execution authority granted
