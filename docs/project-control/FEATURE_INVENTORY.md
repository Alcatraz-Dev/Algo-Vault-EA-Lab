# AlgoVault — Feature Inventory

> One row per feature/module. Status classification:
> **WORKING** — functioning implementation found and exercised;
> **IMPLEMENTED** — real implementation exists but unverified;
> **PARTIAL** — real implementation, important parts unverified/incomplete;
> **BROKEN** — observed defect;
> **MOCKED** — mocked/simulated;
> **PLANNED** — not implemented;
> **BLOCKED** — blocked by external dependency;
> **DEPRECATED** — present but not used.

| # | Feature | Product area | Entry point | Dependencies | Data sources | Current status | Known issues | Security | Tests | Next action |
|---|---|---|---|---|---|---|---|---|---|---|
| F-01 | Market data history | Market data | `/api/analytics/ohlc`, `/api/market/quotes` | Twelve, TradingView, RealMarket, Biquote | OHLC endpoints | WORKING core / PARTIAL provider coverage | Core engine normalizes/aggregate/dedupe/page OK; provider depth conditional; history bound; no instrumented browser pan-to-history test yet | RTDB read paths server-only; no secret exposure | 93 chart-engine tests pass | Complete end-to-end browser paging test; communicate history limit to UI |
| F-02 | Native chart renderer | Pro Terminal | `components/pro-scalping-terminal/ProTerminalChart.tsx` | lightweight-charts, `useLiveCandles` | same as F-01 | WORKING / PARTIAL | Drawings use SVG + chart transforms; label congestion on default structure layer; chart-type wiring partially unverified | RTDB read-only; no execution claims from chart | 93 chart-engine tests; pro-scalping-terminal 24 tests | Fix BOS/CHoCH label congestion; add interaction tests |
| F-03 | Shared chart engine & renderers | Chart | `lib/chart-engine/`, `components/charts` | — | — | WORKING core / PARTIAL duplicated | `ProTerminalChart` and `TradingChart` have separate overlay lifecycles; density-aware rendering not final | — | chart-engine tests pass | Decide one shared renderer contract; remove redundant paths |
| F-04 | Realtime updates / clock | Pro Terminal | `useLiveCandles`, shared clock | market data | live feed sync | PARTIAL | `MARKET CLOSED` / `RECONNECTING` observed; fresh session not verified; no fabricated candles | — | — | Validate live session; keep honest connection state |
| F-05 | Tag system | Trading | `/tags` | RTDB | — | IMPLEMENTED (needs audit) | — | — | — | Audit read/write and permissions |
| F-06 | Structural pattern detection | Market intelligence | `lib/market-intelligence/` | market data | — | IMPLEMENTED / PARTIAL | Simplified deterministic detector; BOS/CHoCH label congestion | — | engine tests | Fix congestion; add methodological validation |
| F-07 | BOS/CHoCH structure layer | Chart | chart layer setting | market data | — | IMPLEMENTED / BROKEN | Renders swing labels + BOS/CHoCH, causing dense label congestion | — | — | Separate event types; density-aware rendering + regression test |
| F-08 | Order blocks / FVGs / liquidity | Chart + market intel | chart layers | market data | — | IMPLEMENTED / PARTIAL | — | — | — | Validate lifecycles; shared-parity tests |
| F-09 | Indicators (EMA/SMA/RSI/...), overlays | Chart + aI | chart layers, local + shared | market data | — | IMPLEMENTED / PARTIAL | Terminal computes several locally; shared-parity test coverage incomplete | — | aligned EMA/SMA/RSI only | Consolidate to shared deterministic functions + parity tests |
| F-10 | Market-structure detection | Chart / intel | `lib/market-core` | market data | — | IMPLEMENTED / PARTIAL | Simplified pivot rule + post-hoc CHoCH flips | — | core tests | Validate methodology; separate swing/BOS/CHoCH |
| F-11 | Drawing tools | Pro Terminal | `components/pro-scalping-terminal/*` | lightweight-charts | — | IMPLEMENTED / PARTIAL | Coordinate mapping needs full lifecycle/interaction test; object persistence | RTDB read-only | — | Full lifecycle test matrix |
| F-12 | Chart settings / theme | Pro Terminal | toolbar | tokens | — | IMPLEMENTED / PARTIAL | — | — | — | — |
| F-13 | Pro Terminal watchlist | Pro Terminal | toolbar | RTDB / market data | — | PARTIAL | Persistence, invalid symbols, multi-component polling unverified | — | — | Audit watchlist |
| F-14 | Trading positions | Trading | `/trading` page, orders API | unified trading service | MT5 gateway | IMPLEMENTED / PARTIAL | No order placed, no broker execution claimed in audit; simulated-vs-live not separated in UI | Server-side authorization required | — | Dedicated execution audit |
| F-15 | Orders / order lifecycle | Trading | `/api/trading/orders`, gateway | unified trading | MT5 EA | IMPLEMENTED / PARTIAL | Execution semantics, safety gates, idempotency, reconciliation not fully verified | Fail-closed required | — | Execution safety audit |
| F-16 | Positions / pending orders | Trading | `/api/trading/positions`, `/api/trading/pending-orders` | unified trading | MT5 EA | IMPLEMENTED / PARTIAL | late-snapshot outcome is `EXECUTED_PENDING_SYNC` (never FAILED) | — | — | — |
| F-17 | Account connection (demo) | Trading | trading-access route | unified trading | MT5 gateway | PARTIAL | — | — | — | Verify connection flow + demo labeling |
| F-18 | Live / paper / demo separation | Trading | flags + UI | unified trading | MT5 EA | PLAN | Demo is the only supported mode; live requires gated capability | Fail-closed | — | Implement gating + separate simulated/live paths |
| F-19 | MT5/EAC gateway EA | Trading | `MQL5/AlgoVaultTradeGateway/AlgoVaultTradeGateway.mq5` | gateway + RTDB | — | IMPLEMENTED / PARTIAL | v1.3.0 historical; end-to-end semantics not verified | heartbeat + snapshot + command polling | tests | End-to-end verification |
| F-20 | Strategy Lab (EA lab, backtest, walk-forward, MC, replay) | Strategy | `/strategy-lab` | engines | — | WORKING / PARTIAL | Independent representative verification of results + future-leakage needed | — | `test:ea`, `test:strategy-engine`, `test:research` | Verify correctness, OOS, parameter safety |
| F-21 | Backtesting engine | Strategy | `/backtests` | strategy lab | — | IMPLEMENTED / PARTIAL | Look-ahead/data-model drift across strategy/backtest/replay not fully eliminated | — | — | Data provenance audit |
| F-22 | Strategy research (OOS/WF, robustness) | Strategy | `/strategy-research` | engines / KG | — | IMPLEMENTED / PARTIAL | — | — | `test:research` (143 checks) | Extend robustness + OOS validation |
| F-23 | Performance arena | Trading | `/account/performance-arena` | Arena engine + Stripe | — | IMPLEMENTED / PARTIAL | Paid challenges/testing blocked on live Stripe + webhook test | — | — | — |
| F-24 | Risk engine | Trading | `lib/risk/` | equity/positions | — | WORKING | Correctness + side-awareness tested | Fail-closed | `lib/risk/tests` | — |
| F-25 | Signals (scanner, AI, monitor, lifecycle) | Signals | `/signals` | market data + AI | Biquote, Xoomar sentiment | IMPLEMENTED / PARTIAL | — | — | `test:ai-signals` | — |
| F-26 | Telegram signal ingestion + delivery | Signals | `features/telegram-signals/` | MTProto, RTDB | — | IMPLEMENTED / PARTIAL | — | Webhook gated with secret + dev opt-in | tests | — |
| F-27 | AI Router (multi-provider) | AI | `lib/ai/router.ts` | providers | Gemini/OpenRouter/OpenCode/B.AI/Bytez | WORKING | AI_FREE_ONLY default; deterministic-first rule | Secret boundary | tests | Quota + budget logs |
| F-28 | Market intelligence (AI layers) | AI | `/market-intelligence` | AI router | data + analytics | IMPLEMENTED / PARTIAL | Evidence provenance, fallbacks, non-fabrication not exhaustively verified | — | — | Independent verification |
| F-29 | Candel intelligence context / evidence | Candel | `lib/candel/intelligence/*` | AI + workspace | workspace data | IMPLEMENTED / PARTIAL | WAIT / NO_TRADE handling needs validation | — | tests | Validate evidence-first semantics |
| F-30 | Candel workspace / templates / memory / automations | Candel | `lib/candel/workspace/`, `app/api/candel/*` | RTDB | — | IMPLEMENTED / PARTIAL | UI ordering bug found at lint (fetchCandels before declaration) | Server-side auth; RTDB rules in place | tests | Fix ordering; update workspace UI design |
| F-31 | Candel conversations + messages | Candel | `app/api/candel/candel/conversation/route.ts`, RTDB | workspace | — | IMPLEMENTED / PARTIAL | — | — | tests | — |
| F-32 | Candel marketplace / licenses / downloads | Candel | marketplace | subscriptions | RTDB | IMPLEMENTED / PARTIAL | Admin/product gating needs verification | — | — | — |
| F-33 | Market-intelligence panels (chart confluence, backtest, KG) | AI | `components/market-intelligence/*` | market intelligence | analytics | IMPLEMENTED / PARTIAL | — | — | — | — |
| F-34 | AI Copilot / AI Trading Teams | AI | `/account/ai-copilot`, `/account/ai-trading-teams` | AI router | — | IMPLEMENTED / PARTIAL | — | — | — | — |
| F-35 | Spotify (voice streaming)? — not a real product surface | — | `app/spotify`? | — | — | MISSING / spare | — | — | — | — |
| F-36 | GTA V? — not a product | — | `app/gta-v`? | — | — | MISSING / spare | — | — | — | — |
| F-37 | Workflow automation | Workflows | `/account/workflows` | engines | — | IMPLEMENTED / PARTIAL | admin gating + cross-feature lifecycle not audited | — | `test:workflows` | — |
| F-38 | Marketplace (products, reviews, pricing, licensing) | Marketplace | `/marketplace` | Stripe + RTDB | — | WORKING / PARTIAL | Review content is public-by-design; licensing/entitlement verification needed | Admin/product gating | tests | — |
| F-39 | Product downloads | Products | `/api/products/download` | licenses | — | IMPLEMENTED / PARTIAL | — | — | — | — |
| F-40 | Affiliate system | Affiliates | `/affiliates`, `/api/affiliate/*` | Stripe + RTDB | — | IMPLEMENTED / PARTIAL | — | — | — | — |
| F-41 | Subscriptions & checkout | Subscriptions | `/account/subscribe`, checkout | Stripe | — | WORKING / PARTIAL | Webhook idempotency + entitlement sync need verification | — | — | — |
| F-42 | Licenses | Licenses | `/account/licenses` | Stripe + RTDB | — | WORKING / PARTIAL | — | — | — | — |
| F-43 | Admin (users, products, orders, subs, licenses, affiliates, payments, trading, health, audit) | Admin | `/admin/*` | RTDB + Stripe | — | IMPLEMENTED / PARTIAL | Entitlement enforcement + permission matrix not fully audited | Server-side only | — | Admin audit |
| F-44 | System health / audit | Admin | `/admin/*` | RTDB | — | IMPLEMENTED / PARTIAL | — | — | — | — |
| F-45 | Developer platform API/SDK | Developer | `/developer/*` | — | — | PLANNED | No working API yet; SDK roadmap documented | — | — | Document boundaries; do not fabricate endpoints |
| F-46 | Account / settings / profile | Account | `/account/*` | RTDB | — | WORKING | — | — | — | — |
| F-47 | Login / register / recovery | Auth | `/login`, `/register`, `/forgot-password` | Firebase Auth | — | WORKING | — | Server-side session; RTDB rules | — | — |
| F-48 | PWA / install / offline-ish | PWA | `components/pwa` | — | — | IMPLEMENTED / PARTIAL | — | — | — | — |
| F-49 | Chrome extension | Extension | `chrome-extension/` | site bridge + RTDB | — | IMPLEMENTED / PARTIAL | Capability claims + permission boundaries not verified | — | — | — |
| F-50 | TradingView integration + MCP | TradingView | `/api/tradingview/*` | tradingview-mcp | — | IMPLEMENTED / PARTIAL | OAuth/token encryption + real-account sync not verified | — | — | — |
| F-51 | Notifications (email/SMS/telegram/discord) | Alerts | `lib/notifications*`, `/api/notifications/*` | Resend/SendGrid/Telegram/Discord | — | IMPLEMENTED / PARTIAL | — | — | — | — |
| F-52 | Analytics / usage metering | Analytics | `/api/analytics/*`, `lib/product-analytics` | RTDB | — | IMPLEMENTED / PARTIAL | — | — | — | — |
| F-53 | Reporting (report-generator, equity curve, backtest reports) | Reporting | `/report-generator`, `/equity-curve` | strategy lab | — | IMPLEMENTED / PARTIAL | — | — | — | — |
| F-54 | AI execution / execution layers | AI | `/account/ai-execution` | unified trading | — | IMPLEMENTED / PARTIAL | — | — | — | — |
| F-55 | Copy trading | Copy trading | `/copy-trading` | unified trading | RTDB | IMPLEMENTED / PARTIAL | Execution tickets must be real from gateway | — | — | — |
| F-56 | Telegram channels / content marketing | Marketing | `/news`, channels, marketing factory | integrations | — | IMPLEMENTED / PARTIAL | — | — | — | — |
| F-57 | Economic calendar / sessions / tools (calculators, etc.) | Tools | `/economic-calendar`, `/tools/*` | integrations | — | WORKING | — | — | — | — |
| F-58 | SQL? — not used | — | none | — | — | MISSING (RTDB only) | — | — | — | — |
| F-59 | WebSocket market data | Market data | `lib/market-data/twelvedata/websocket-client` | websockets | — | IMPLEMENTED / PARTIAL | Connection lifecycle not exhaustively verified | — | — | — |
| F-60 | Payment errors / refunds | Subscriptions | `/refunds`, `/api/billing` | Stripe | — | IMPLEMENTED / PARTIAL | — | — | — | — |

> Note: `app/` currently has ~150 pages but the route inventory in memory references 230 routes; the gap is accounted for by `app/api` (~230) vs pages. Inventory reflects what is actually on disk.
