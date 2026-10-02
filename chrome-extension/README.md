# AlgoVault Trading Intelligence — Extension v3

AI chart copilot for TradingView, inspired by TradingView Remix and TradingView
AI Analyst, built on AlgoVault's own market analytics + AI router.

## What's new in v3

### 1. AI Copilot side panel (`sidepanel/`)
Chrome **side panel** that docks next to TradingView and follows the active
chart live. Open via the popup's **Copilot** button (or any surface calling
`OPEN_SIDE_PANEL`).

- **Copilot tab** — chat with **per-symbol threads** (`XAUUSD|H1` keeps its own
  history), four **personas** (Analyst / SMC / Scalper / Risk) and a **model
  picker** wired to the server's free-model router. A compact rolling memory
  (bias / key levels / plan) is injected into every prompt so answers stay
  consistent across sessions.
- **Research tab** — cached AI research notes: **Snapshot** (~30 min cache) and
  **Deep dive** (~6 h cache) per symbol. Technicals are grounded strictly in
  the live chart context; wider narrative is clearly qualitative.
- **Alerts tab** — create/list/delete price alerts. Backed by the same
  `/api/alerts` endpoints as the web dashboard, so Discord/Telegram/in-app
  notifications work unchanged.
- **Setup tab** — default persona, model, auto-analyze toggle, data wipe.

### 2. Chart automation (`content/chart-commands.ts`)
Copilot-driven chart control, cascading strategies: `window.tvWidget` public
API → TradingView hotkeys/typing → URL navigation (preserving `interval`).
Commands: `set_symbol`, `set_timeframe`, `get_state`; results broadcast as
`CHART_COMMAND_RESULT`.

### 3. Smart Drawings (`content/chart-drawings.ts`)
Ask the copilot *"mark the key levels on my chart"* and the AI replies with a
``` ```drawings ``` JSON block that renders as an SVG overlay on the chart pane
(hlines, zones, labels, trendlines) in a semantic palette
(support/resistance/entry/stop/target). Purely visual — TradingView's own
drawing state is never mutated. Ask again with fresh levels to replace.

### 4. One-tap alerts from the overlay
The live TradingView overlay gained a 🔔 Alert button that creates an alert at
the current price in one click (`CREATE_QUICK_ALERT`).

### 5. Auto-analyze on chart switch
Optional (Setup tab): when the chart symbol changes, the service worker
pre-generates the quick research note so it's ready when you look.

### 6. Quick launcher on the chart (v3.1)
Closing the overlay no longer hides AlgoVault on the chart: a small draggable
⚡ orb stays in place (position remembered) so the extension reopens with ONE
click. It lives in its own content script (`content/quick-launcher.js`),
survives TradingView's SPA navigations, and re-clamps on window resize. The
overlay's ✕ minimizes to the launcher; the launcher click restores the panel.

### 7. Popup resume (v3.1)
The popup remembers the last view (Home / Intel / Copilot / sub-screens) and
reopens exactly where it was closed — no more landing on Home every time.

### 8. Reinstall-proof free daily signals (v3.1)
The 3 free daily signals are enforced SERVER-SIDE
(`/api/extension/daily-signals`, atomic Firebase-transaction reservation) and
keyed by a durable install id that the AlgoVault WEBSITE mints into its own
localStorage and mirrors into `chrome.storage.sync`. Deleting and reinstalling
the extension no longer resets the quota. Generated signals and picked symbols
are also stored server-side and restored in the popup. When the server is
unreachable, a tamper-resistant (HMAC-notarized) local fallback is used and
fails closed.

**Setup:** set `NEXT_PUBLIC_EXTENSION_ID` on the website deployment to the
extension's pack id (chrome://extensions → AlgoVault → ID) so the site can
announce the install id to the extension via `externally_connectable`.

## Chat protocol for drawings

When the user asks for markup, CopilotView appends drawing instructions to the
prompt. The model must answer with analysis + one fenced block:

````
```drawings
{"from":null,"to":null,"drawings":[
  {"kind":"hline","label":"Resistance","tone":"resistance","price":2650},
  {"kind":"hzone","label":"Demand","tone":"support","price":2600,"price2":2580},
  {"kind":"label","label":"Bias: Long","tone":"info","price":2620,"x":0.05}
]}
```
````

Only prices present in the chart context; ≤ 8 drawings.

## Architecture

```
TradingView tab                     Extension surfaces
┌─────────────────────┐   TRADINGVIEW_CONTEXT_UPDATE   ┌──────────────┐
│ content/tradingview │ ─────────────────────────────▶ │ service worker│──▶ market enrichment
│ content/overlay     │ ◀───────────────────────────── │  (background) │──▶ /api/ai/chat
│ content/chart-cmds  │   MARKET_CONTEXT_READY         └──────┬───────┘──▶ /api/alerts
│ content/chart-draw  │                                       │
└─────────────────────┘        RUN_CHART_COMMAND / SET_SMART_DRAWINGS
                                        ▲                    │
                        ┌───────────────┴────────────────────▼──┐
                        │ sidepanel/ (Copilot·Research·Alerts)  │
                        │ popup/  (Home·Intel·Copilot·Settings) │
                        └───────────────────────────────────────┘
```

- Copilot engine: `src/services/copilot-engine.ts` (threads, memory, personas)
- Research: `src/services/research-service.ts` (cached notes)
- Alerts client: `src/api/alerts.ts`
- Shared types: `src/types/copilot.ts`

All copilot data (threads, memory, research cache, prefs) lives in
`chrome.storage.local` — nothing is stored server-side.

## Build & test

```bash
cd chrome-extension
npm run build          # tsc + vite + content scripts + manifest
npm run typecheck      # tsc --noEmit
npx playwright test tests/tradingview-detection.spec.ts   # detection fixtures
npx playwright test tests/v3-features.spec.ts             # commands + drawings
npx playwright test tests/extension-smoke.spec.ts         # real-chart smoke (network)
```

Load `dist/` as an unpacked extension, open a TradingView chart, then click
**Copilot** in the popup (or the 🤖 button on the overlay) to open the side
panel.
