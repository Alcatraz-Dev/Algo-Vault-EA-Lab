# Market Intelligence UI — Phase 5.5

## Integration Points
- Trading Studio / React Flow preserved, updated with Strategy Builder adapter
- Chart workspace synchronized via cross-highlighting adapter
- ReplayEngine drives replay UI
- AI panel uses Phase 5 adapters (market-analyst, copilot, backtest-analyst, generator)
- Strategy validation requires user confirmation before graph mutation
- All overlays use real Smart Money events from Phase 2 engine

## Key Design Decisions
- No duplicate market-data system; existing engine reused
- No duplicate backtest engine; existing library/strategy-lab/replay used
- No duplicate AI infrastructure; lib/ai/ budget/provider reused
- Trading Studio is the visual center; adapter connects rather than replaces

## Responsive
Desktop: dense terminal. Tablet: collapsible panels. Mobile: stacked sections.

## Safety
- Strategy proposals must pass validation
- AI never silently modifies graph
- No direct trade execution
- No fabricated statistics
- All limitations visible
