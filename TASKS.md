# TASKS — trading-platform/t_ee1caf83

Task: t_ee1caf83 — Candels TradingView adoption: audit chart rendering, drawing tools,
overlays, data flow, streaming sync; adopt only if justified; preserve drawing,
anchoring, timeframes, state.

## Status: DONE (audit + decision, no diff required)

- [x] Inspected the chart surface: `ProTerminalChart` (lightweight-charts v5), TradingView
      UI-companion `TradingChart`/`ChartEngine`, unused widget `TradingViewChart`, overlays,
      drawing tools, data pipeline, streaming, state persistence.
- [x] Ran all four chart test suites + `lint`: chart tests pass (93 + 16 + 35 + 81 + 24);
      lint results are 1,660 pre-existing problems unrelated to the chart.
- [x] Verified Apache-2.0 license of `lightweight-charts` (Apache-2.0, no widget attribution
      triggered by the chart stack).
- [x] Decision: **adopt — already embedded**. No adoption diff required. Report written to
      `AUDIT_LIGHTWEIGHT_CHARTS.md` (13,616 chars).
