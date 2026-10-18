# AlgoVault Trading Intelligence — Chrome Web Store submission

Package: `algovault-trading-intelligence-v3.0.0.zip` (this folder)
Version: 3.0.0 · Manifest V3 · built with `npm run build:prod`

Reproducible build prerequisite (gitignored, must exist at build time):
`chrome-extension/.env.production` with `VITE_ALGOVAULT_URL` pointing at
the production backend plus the Firebase web-client keys (same keys as the
dev `.env`; Firebase web API keys are public client identifiers by design).
Without it, Vite falls back to `.env` and bakes `http://localhost:3000`
into the bundle — `prod-manifest.mjs` does not check this; verify with
`grep -rlo "localhost:3000" dist/` (must print nothing).

## Listing copy

**Name:** AlgoVault Trading Intelligence

**Short description (≤132 chars):**
AI chart copilot for TradingView: live analysis, signals, price alerts and trade journaling.

**Detailed description:**

AlgoVault Trading Intelligence is the browser companion for AlgoVault traders
who work on TradingView charts.

What it does:

- AI Copilot side panel that follows your active TradingView chart, with
  per-symbol conversation threads, trading personas (Analyst, SMC, Scalper,
  Risk) and on-chart AI drawings of key levels.
- Chart research notes: quick snapshots and deeper dives grounded in your
  live chart context.
- AI Daily Signals: 3 free signals per day with entry, stop-loss and targets
  (quota enforced server-side).
- Price alerts created from the chart overlay, delivered through the same
  notification channels as the AlgoVault web dashboard.
- Market intelligence views: trend verdict, multi-timeframe alignment,
  risk analysis and signal lists for the active symbol.
- Demo (paper) trading ticket for practice, plus order management for
  traders who connected an MT5 demo account through the AlgoVault gateway.
  All real execution goes through AlgoVault's server-side Unified Trading
  API — the extension never places trades on its own and never handles
  broker credentials.

An AlgoVault account is required to sign in. Analysis features work with any
account; execution features require a connected trading account.

## Category / language

- Category: Productivity (Finance-adjacent; no personal loan/financial-advice claims)
- Language: English
- Single purpose: AI-assisted analysis of the user's active TradingView chart.

## Permission justifications (must match the store form)

| Permission | Used for |
|---|---|
| storage | Persist auth session, settings, copilot threads, alerts cache and market-data cache locally. `storage.sync` holds only a random install id for the daily-signal quota. |
| activeTab | Read the active TradingView tab's chart context (symbol/timeframe) when the user invokes the extension. |
| tabs | Find the open TradingView tab to sync chart context and relay chart commands/drawings to content scripts. No browsing history is read or stored. |
| scripting | (REMOVED from prod build — unused.) |
| contextMenus | "Analyze with AlgoVault / Send to Strategy Lab / Calculate Risk" entries on TradingView pages. |
| notifications | Price-alert and copilot-action confirmations. |
| alarms | Periodic API health badge refresh; Pro-entitlement cache refresh. |
| sidePanel | Dockable AI Copilot panel beside TradingView. |
| Host: `https://algo-vault-ea-lab.vercel.app/*` | The production AlgoVault backend (auth, analysis, signals, alerts, execution). |
| Host: `https://*.tradingview.com/*` | Content scripts that read chart context and render the overlay/drawings. |

Remote code: none. All scripts are bundled in the package. CSP:
`script-src 'self'; object-src 'self'`.

## Privacy

- Privacy policy (public, stable): `https://algo-vault-ea-lab.vercel.app/privacy`
  (includes a "Browser Extension Data" section describing chart-context
  collection, local storage, and the install id).
- Data-use disclosure for the store form:
  - Collected: authentication token, email (account), TradingView chart
    context (symbol/timeframe/price), copilot messages, alert definitions.
  - Use: account authentication, chart analysis, signals, alerts, quota
    enforcement. No sale of data, no third-party advertising.
  - The extension does not collect browsing history, and does not handle
    broker passwords or trading API secrets.

## Reviewer notes

- Sign-in requires an AlgoVault account (email + password, Firebase Auth).
  Provide a demo reviewer account at submission time, or reviewers can
  create one on the production site.
- Without signing in, the extension shows only the login screen — this is
  by design.
- No live trading occurs during review unless the reviewer connects their
  own MT5 demo gateway; execution is DEMO-gated server-side.

## Screenshots (1280×800, required)

Capture from the real packaged build in this folder:

1. Popup Home with live chart context (symbol/price/verdict).
2. Popup Intel/analysis view.
3. Side-panel Copilot conversation on a TradingView chart.
4. Overlay + AI drawings on a TradingView chart.
5. Alerts view.

Status: PARTIAL — 3 genuine shots captured from the packaged release build
with `node scripts/capture-screenshots.mjs` (see `release/screenshots/`):

- `01-popup-login.png` (400×600) — real popup, login view, dark theme.
- `02-options.png` (800×600) — real options page.
- `03-tradingview-overlay.png` (1280×800) — live TradingView XAUUSD chart
  with the AlgoVault overlay booted.

Still missing: signed-in surfaces (Copilot conversation, signals, alerts).
Capturing those needs an interactive Chrome session with a real account —
do not submit placeholder art for them.

## Release checklist

- [x] `npm run typecheck` clean
- [x] Unified-execution contract tests: 29/29 pass (no legacy `/api/trading/orders` calls)
- [x] `npm run build:prod` succeeds; prod manifest normalized (no localhost,
      no dead domain, no unused `scripting` permission)
- [x] dist verified: no `localhost:3000`, no sourcemaps, no `.env` files,
      all manifest entry points resolve
- [x] Packaged extension loads in headless Chrome (exit 0, no manifest errors)
- [x] ZIP contains only dist files (58 files, ~450 KB)
- [x] 3 genuine screenshots captured from the packaged build
      (`release/screenshots/`); signed-in surfaces still need an
      interactive session with a real account
- [ ] Promo tiles (440×280 small, 920×680 large, 1400×560 marquee) rendered
      from brand assets
- [ ] Developer registration + $5 fee completed (account owner action)
- [ ] Privacy-policy URL deployed and reachable at the public URL above
      (requires deploying the current web app)
- [ ] Reviewer demo account prepared
- [ ] Submit ZIP via Chrome Web Store Developer Dashboard (account owner action)

## Remaining blockers (all need the account owner)

1. Interactive screenshot session + promo tiles.
2. Web deployment of the current tree so `/privacy` reflects the new
   extension section.
3. Store submission itself (credentials, fee, review).
