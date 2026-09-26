# Phase 12 — Intelligence Hardening

## Phase 11 Baseline
- Pages at `/market-intelligence/scalping` and `/advanced` with truthful empty states
- Navigation updated; no redesign

## Phase 12 Changes
- Structured market context pipeline (`lib/market-intelligence/phase12/context-pipeline.ts`)
- Data quality representation (`data-quality.ts`)
- MTF confluence (`mtf-confluence.ts`) — explicit unavailable/mixed/conflicting/insufficient
- Setup lifecycle (`setup-lifecycle.ts`) — AI cannot confirm alone
- AI boundary (`ai-boundary.ts`) — evidence-only, no invention
- Historical bridge (`historical-bridge.ts`) — references existing backtest/replay
- Behavioral tests (`tests/market-intelligence/phase12/hardening.test.ts`)
- Page category separation (Observed / Derived / Historical / AI Interpretation)
- Audit (`phase12-hardening-audit.md`) and report (`Phase12_AI_Scalping_Hardening_Verification_Report.md`)

## Existing Engines Reused
- Smart Money (`lib/market-intelligence/smart-money/engine.ts`)
- AI analysis (`lib/ai/analysis/intelligence.ts`) — Sourced provenance
- Workspace, analytics, indicators, chart overlays, backtest/replay

## AI Boundary
- Receives structured evidence only
- Must not invent prices, structures, indicators, trades, confidence, historical stats
- Output clearly separated from deterministic data

## Security
- No new endpoints; existing auth/authorization preserved
- AI credentials remain server-side; budget/provenance controls respected
- No secret exposure in client payload

## Performance
- No new external cache/database
- Context assembly deterministic; no per-tick AI trigger enforced at module level
- Existing caching patterns respected

## Limitations
- Requires existing data sources; unavailable when missing (not substituted)
- Smart Money confirmation rules (lookback) unchanged
- Historical evidence depends on active session
