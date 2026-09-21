# AlgoVault Cinematic Marketing Video — Storyboard

Production status: local Playwright + FFmpeg workflow used because the Higgsfield MCP plugin is present on disk but is not configured in Kilo and the MCP endpoint returns `401 Unauthorized`. No Higgsfield generation is claimed.

## Non-fabrication rules

- All product imagery is captured from the existing AlgoVault application.
- Market imagery uses the existing XAUUSD provider-feed UI and real `/api/analytics/ohlc` data.
- Marketplace imagery uses the existing live marketplace card and its reported metadata.
- Backtesting and analytics scenes show the existing empty/zero state and do not present invented results.
- Live-trading scenes show the existing gateway and connection states; no live P&L or profitability is implied.
- All performance language is descriptive of workflow, not a promise of future results.

## Main film — 16:9, 60 seconds

| Time | Scene | Real source | Visual direction | On-screen copy | Validation |
|---|---|---|---|---|---|
| 0–5s | The Market | `assets/01-market-hero.png` | Darkness resolves into the real AlgoVault terminal and XAUUSD H1 provider chart; slow push-in, fine grid, restrained blue/gold accents. | THE MARKET NEVER STOPS. / Neither should your intelligence. | Existing home terminal and real provider-feed label. |
| 5–9s | AlgoVault intro | `assets/01-market-hero.png`, `assets/11-final-cta.png` | Camera passes through the terminal into a clean dark product frame; logo mark and wordmark reveal. | MEET ALGO VAULT / Your Trading Intelligence Platform | Existing brand, navigation, and product positioning. |
| 9–16s | AI market intelligence | `assets/03-ai-intelligence.png`, `assets/02-market-intelligence.png` | Deterministic engine cards resolve into the AI interpretation layer; subtle data-flow lines connect market data to analysis. | TURN MARKET DATA INTO INTELLIGENCE. / AI-POWERED MARKET ANALYSIS | Existing deterministic/AI layer UI; no invented signal values. |
| 16–24s | Strategies & bots marketplace | `assets/10-marketplace.png` | Real Gold Scalper marketplace card enters with parallax; metadata is revealed without changing the reported values. | DISCOVER TRADING STRATEGIES / COMPARE. TEST. DEPLOY. | Existing marketplace listing, platform/symbol/timeframe/pricing metadata. |
| 24–31s | Backtesting & proof | `assets/05-backtesting.png`, `assets/04-lifecycle.png` | Historical-chart language and a timeline motif lead into the real backtest console. The empty state remains visible. | TEST BEFORE YOU TRUST. / BACKTEST. ANALYZE. REFINE. | Existing backtest console and lifecycle; no fabricated equity curve or metrics. |
| 31–36s | Performance analytics | `assets/14-backtests-route.png`, `assets/05-backtesting.png` | Zero/empty analytics state is framed as a rigorous measurement surface; chart grid and risk labels animate around it. | SEE THE DATA BEHIND THE STRATEGY. | Existing analytics labels and risk disclaimer. |
| 36–41s | Strategy-to-chart workflow | `assets/04-lifecycle.png`, `assets/08-market-replay.png` | Lifecycle nodes move from discovery to validation to replay; no unsupported direct TradingView claim is made. | FROM STRATEGY TO CHART. / BUILT FOR THE WAY TRADERS WORK. | Existing Strategy Lab, Pine workspace, and Market Replay implementation. Local TradingView route was not renderable during capture. |
| 41–47s | Live trading | `assets/07-gateway.png`, `assets/09-live-monitoring.png` | Gateway path lights node by node: web → REST → MT5 EA → broker. Connection state is shown as reported, not assumed. | FROM TESTING TO EXECUTION. | Existing MT5 Gateway and live monitoring UI; no profitability claim. |
| 47–52s | Connected ecosystem | `assets/06-signal-risk.png`, `assets/03-ai-intelligence.png`, `assets/07-gateway.png` | Fast, elegant cuts connect signal risk, AI interpretation, marketplace, and gateway layers. | ONE ECOSYSTEM. / ONE WORKFLOW. | Existing signal lifecycle, AI stack, marketplace, and gateway features. |
| 52–60s | Final brand reveal | `assets/logo-mark.png`, dark gradient | Product layers collapse into a clean dark field; logo mark, four verbs, and final line resolve with a subtle glow. | ALGO VAULT / DISCOVER. TEST. ANALYZE. EXECUTE. / Trading Intelligence, Built for Traders. | Existing brand mark and approved positioning language. |

## Vertical film — 9:16, 40 seconds

| Time | Scene | Source | Copy |
|---|---|---|---|
| 0–4s | Market chart push-in | `01-market-hero.png` | THE MARKET NEVER STOPS. |
| 4–8s | Brand reveal | `01-market-hero.png`, logo mark | MEET ALGO VAULT |
| 8–15s | AI intelligence | `03-ai-intelligence.png` | TURN MARKET DATA INTO INTELLIGENCE. |
| 15–22s | Marketplace | `10-marketplace.png` | DISCOVER. COMPARE. TEST. DEPLOY. |
| 22–29s | Backtesting | `05-backtesting.png` | TEST BEFORE YOU TRUST. |
| 29–34s | Analytics + gateway | `14-backtests-route.png`, `07-gateway.png` | SEE THE DATA. MOVE WITH GUARDRAILS. |
| 34–40s | Final reveal | logo mark | ALGO VAULT / Trading Intelligence, Built for Traders. |

## Teaser — 16:9 and 9:16, 14 seconds

| Time | Scene | Source | Copy |
|---|---|---|---|
| 0–3s | Market | `01-market-hero.png` | THE MARKET NEVER STOPS. |
| 3–6s | Brand | logo mark + terminal | MEET ALGO VAULT |
| 6–10s | AI + marketplace | `03-ai-intelligence.png`, `10-marketplace.png` | INTELLIGENCE → STRATEGY |
| 10–12s | Backtest + gateway | `05-backtesting.png`, `07-gateway.png` | TEST. EXECUTE. |
| 12–14s | Final | logo mark | ALGO VAULT / Trading Intelligence, Built for Traders. |

## Audio direction

- Original local synthesis only: low atmospheric drone, controlled digital pulse, restrained risers, and soft impact transients at the brand, AI, marketplace, backtest, gateway, and final-logo moments.
- Main voiceover uses the local macOS Daniel voice as a calm English male fallback. Higgsfield voice generation was unavailable.
- Voiceover: “The market never stops. Neither should your intelligence. Discover strategies. Analyze the data. Backtest your ideas. Turn insights into action. From AI-powered market intelligence to automated trading strategies and real-time analytics. One ecosystem. One workflow. AlgoVault. Trading intelligence, built for traders.”

## Validation notes

- Strongest real trader-facing surfaces identified: AI Signals, Strategy Lab, Marketplace, Backtests, Live Performance, Trading Terminal, Copy Trading, Pine Workspace, Market Replay, MT5 Gateway, and Telegram/Discord integrations.
- Authenticated routes were inspected, but several returned the existing local development compile/runtime errors. The film therefore uses stable public product surfaces and real captured UI states rather than pretending unavailable data is live.
- No existing application files were modified.
