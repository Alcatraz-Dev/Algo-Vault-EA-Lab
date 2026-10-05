# Phase 5 — Existing UI Audit

Performed before writing any Phase 5 code. Classification key:

`WORKING` · `PARTIALLY_WORKING` · `DUPLICATED` · `BUGGY` · `PLACEHOLDER` · `NEEDS_MERGE` · `NEEDS_REDESIGN`

---

## 1. Terminals & chart surfaces

| Surface | Location | Verdict | Notes |
| --- | --- | --- | --- |
| Pro Scalping Terminal | `/account/scalping-terminal` → `components/pro-scalping-terminal/ProScalpingTerminal.tsx` | **WORKING** | Strongest existing terminal. Watchlist, chart, overlays, MTF, liquidity, radar, live signals, order flow, journal, replay, calendar. Polling is centralised through `useThrottledAuthedFetch`. **Missing:** positions, orders, account/risk, event feed, chat, workspace presets. |
| Live Trading Terminal | `/account/trading/page.tsx` | **BUGGY** | Chart + order ticket + positions/orders/execution log all real. **Bug:** `ProTerminalChartWorkspace` gets `initialSymbol={selectedSymbol}` but never `onSymbolChange` — changing the symbol in the chart leaves the order ticket quoting XAUUSD. `selectedSymbol` is also never updated from any other control. |
| Lite Scalping Terminal | `/scalping-terminal` | **WORKING** | Free-tier radar/signals/engine feed. Correctly gated. |
| Market Intelligence Terminal | `/market-intelligence/terminal/page.tsx` | **PARTIALLY_WORKING** | Bare `ProTerminalChartWorkspace` — no intelligence, no account, no context. Duplicates nothing but delivers nothing beyond a chart. |
| `/trading` | `app/trading/page.tsx` | **NEEDS_MERGE** | Client-side redirect to `/account/trading`. Keep as a redirect only. |
| Standalone `app/*/chart` pages | scanner, analysis, signals, … | **NEEDS_MERGE** | Each embeds its own chart surface with its own symbol state. |

**Chart engine — no duplication found.** `components/pro-scalping-terminal/ProTerminalChart.tsx` (3,788 lines) is the single chart implementation, wrapped by `ProTerminalChartWorkspace.tsx` (toolbar, drawings, per-symbol layer persistence). `lib/chart-engine/` and `components/charts/*` are non-overlapping (chart-engine = data/coordinates/indicator math; `components/charts` = small presentational charts). **Do not create a new chart.**

---

## 2. Data & engine layer (what already exists and must not be rebuilt)

| Capability | Location | Verdict |
| --- | --- | --- |
| Market data / OHLC / quotes | `lib/market-data/*`, `/api/analytics/ohlc`, `/api/analytics/watchlist` | WORKING |
| Indicator math | `lib/chart-engine/indicators.ts`, `lib/analytics/*` | WORKING |
| Smart Money engine | `lib/market-core/smart-money/*` (structure, liquidity, zones, premium/discount, sessions) | WORKING |
| Analysis pipeline (structure/MTF/regime/evidence) | `lib/ai/analysis/intelligence.ts` → `/api/analysis/intelligence` → `AdvancedAnalysisResult` | WORKING — this payload already contains `bosEvents`, `chochEvents`, `liquiditySweeps`, `fairValueGaps`, `orderBlocks`, `multiTimeframe.timeframes[]`, `regime`, `evidence[]`. It is the natural source for the Intelligence panel **and** the event feed. |
| Strategy engine | `lib/strategy-engine/*` (engine, backtest, replay, paper, risk, account, decisions, trace, alerts, orders) | WORKING — `evaluateRisk`, `riskSnapshot`, `evaluateAccountHalt` are pure and client-usable. |
| Setup Memory | `lib/market-intelligence/memory/`, `components/market-intelligence/memory/SetupMemoryPanel.tsx`, `monitoring/setups/{uid}` | WORKING |
| Signal engine | `/api/scalping/signals`, `/api/signals`, `lib/ai-signals/*` | WORKING |
| Risk engine | `lib/strategy-engine/risk.ts` + `/api/analytics/risk` | WORKING (engine) / **NEEDS_MERGE** (no terminal surface) |

---

## 3. Panels, widgets & shared components

| Component | Location | Verdict |
| --- | --- | --- |
| Chart toolbar | `components/trading/ChartToolbar.tsx` (721 lines) | WORKING — grouped controls, no giant toolbar. |
| Watchlist (data-driven) | `components/trading/Watchlist.tsx` | WORKING — real quotes, no fabricated fields. No groups/favourites yet. |
| Watchlist (terminal rail) | `ProTerminalPanels.WatchlistPanel` | WORKING — quotes + add/remove. |
| Positions / Orders / Execution log | `components/trading/{OpenPositions,PendingOrders,ExecutionLog,OrderPanel,AccountHeader,ConnectionStatus}` | WORKING — only mounted on `/account/trading`. |
| MTF / Liquidity / Regime / Sessions / Radar / Signals / Calendar panels | `components/pro-scalping-terminal/ProTerminalPanels.tsx` | WORKING — memoised, honest empty states. |
| Intelligence (AI decision fabric) | `components/pro-scalping-terminal/IntelligencePanel.tsx` | WORKING — Pro-gated, additive, fails open. |
| Replay | `components/pro-scalping-terminal/ProTerminalReplay.tsx` | WORKING |
| **Monitoring widgets** | `components/market-intelligence/monitoring/{LiveEventFeed,ActiveSetups,Watchlist,MonitoringStatus}.tsx` | **PLACEHOLDER** — 11–25 lines each, `events: any[]`, no engine wiring, no navigation. |
| Dashboard widget system | `components/dashboard/widgets.tsx` (3,202 lines) + `app/dashboard/page.tsx` + `/api/dashboard` | **PARTIALLY_WORKING** — already modular (catalog, picker, add/remove/resize/reorder, per-dashboard persistence, market-scoped widgets, Pro flags). **Missing:** named layout presets (Trader / Scalper / Smart Money / Investor / Researcher / AI Trader). |
| Design system | `components/ui/*`, `AppShell`, `globals.css` (Satoshi/Inter, 1px borders, dark/light) | WORKING — reuse. |
| App navigation | `components/layout/app-nav.ts` | WORKING — but has **three** "Terminal" entries (`/account/trading`, `/market-intelligence/terminal`, `/market-intelligence/scalping`) plus `/scalping-terminal` and `/account/scalping-terminal`. **DUPLICATED** naming. |

---

## 4. Intelligence, chat & AI

| Surface | Location | Verdict |
| --- | --- | --- |
| AI Copilot page | `/ai-copilot` + `/api/ai-copilot` | **NEEDS_REDESIGN** — keyword-routed (`q.includes("regime")`, `q.includes("why")`), multi-symbol shotgun, no terminal context (doesn't know symbol/TF/positions/setup), no facts-vs-interpretation split, no structured chat history. It is a Q&A page, not a trading chat. |
| Trading Chat | — | **PLACEHOLDER / missing.** Nothing in `app/` or `components/` is a context-aware trading chat for the terminal. |
| Chrome-extension copilot | `chrome-extension/src/services/copilot-engine.ts` | WORKING — but scoped to TradingView, threads/personas/memory live in extension storage. Reference for UX, not reusable in-app. |
| Market Intelligence adapters | `components/market-intelligence/*` (ai-panel-adapter, command-center, backtest adapters) | WORKING — adapters over existing engines, no second engine. |
| AI terminal / command bar | `types/pro.ts` `CommandId` set, `chrome-extension` command bar | PARTIALLY_WORKING — commands exist for the extension only. |

---

## 5. Cross-cutting

| Concern | Location | Verdict |
| --- | --- | --- |
| Workspace continuity | `components/market-intelligence/workspace-context.ts` + `lib/market-intelligence/workspace.ts` | **PARTIALLY_WORKING** — symbol/timeframe/dataset continuity across pages via localStorage, but it only carries `symbol` + `timeframe` today (`loadWorkspaceContext` reads two fields). No panel/indicator/chat state. |
| Pro gating | `lib/subscription.ts` (`onSubscriptionChange`), `/api/pro-terminal/access` (`plan === pro|enterprise`), `types/pro.ts` flags | **NEEDS_MERGE** — at least three entitlement checks with different criteria. Terminal must read one and fail **closed**. |
| Alerts | `/alerts`, `/alert-center`, `lib/strategy-engine/alerts.ts` | WORKING |
| Freshness / truthful states | used inconsistently (some panels show `lastUpdated`, most don't) | **NEEDS_MERGE** — no shared freshness component. |
| Error isolation | no shared boundary; a thrown panel kills the page | **NEEDS_MERGE** |
| Tests | `tests/*`, `lib/*/__tests__`, `npm run test:*` runners via `jiti` | WORKING convention — no terminal tests exist. |

---

## 6. Decisions taken from this audit

1. **Do not write a chart.** Compose `ProTerminalChartWorkspace` (it already owns toolbar, drawings, layers, per-symbol persistence, fullscreen).
2. **Do not write a second intelligence engine.** The Intelligence panel and the event feed are both projections of `AdvancedAnalysisResult` from `/api/analysis/intelligence`.
3. **Do not write a second risk engine.** The Risk HUD calls `lib/strategy-engine/risk.ts`.
4. **Do not write another watchlist feed.** Reuse `/api/analytics/watchlist` through the existing hooks; add grouping/favourites as pure client state.
5. **Do not replace `/ai-copilot`.** Build the terminal chat as a separate, context-bound surface and leave the general copilot page alone.
6. **Fix the `/account/trading` symbol-sync bug** rather than rebuilding that page.
7. **One terminal page** at `/account/terminal` that *merges* what is currently split across `/account/trading` (positions/orders/account) and `/account/scalping-terminal` (chart/intelligence/watchlist/replay), plus the missing chat, event feed, risk HUD and workspaces. The existing pages keep working; they link into the unified workspace.
8. **Replace the placeholder monitoring widgets** rather than maintaining two event feeds.
9. **Reuse `workspace-context.ts` semantics** but extend it with a validated terminal-state schema stored client-side only — no backend write for transient UI state.
