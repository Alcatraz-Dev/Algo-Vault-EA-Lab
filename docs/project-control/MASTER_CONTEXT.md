# AlgoVault — Master Context

Keep this document current. It supersedes all agent-instruction `.md` files **except** `ALGOVAULT_AGENT_CONSTITUTION.md` (product constitution, kept as canon). If this file and the constitution conflict, ask the user.

---

## What AlgoVault is

AlgoVault is a commercial trading-intelligence platform. It is a real product with real backend systems:

- **Firebase** Authentication + Realtime Database (RTDB only — no Firestore).
- **Next.js 16 (App Router)** — React 19, TypeScript 5, Tailwind CSS v4.
- **Trading gateway to MT5/MQL5** (EAs + `lib/trading/unified/`) — demo-first, fail-closed.
- **Market data**: Twelve Data (primary), TradingView, RealMarket, Biquote (realtime).
- **Strategy Lab** — backtest engine, EA Lab, walk-forward, Monte Carlo, replay.
- **AI Router** — multi-provider, free-only default, deterministic-first.
- **Signals** — scanner, AI monitor, lifecycle engine, Telegram ingestion.
- **Market intelligence** — structure, smart money, analytics, validation.
- **Payments / licensing**: Stripe subscriptions + Connect, license issuance/revocation, affiliates.
- **Marketplace** of products (indicators, EAs, etc.), copy trading, plugins ecosystem (runtime + cron), Telegram/Discord delivery, Chrome extension, admin, account, workflows.

### Target users
- Retail & pro traders (signals, terminal, positions, backtests).
- Strategy developers (Strategy Lab, EA generation, marketplace).
- Subscribers (Free / Pro tiers).
- Affiliates (commissions).
- Admins & developers (operate, review, manage).

---

## Core product principles

1. **Real data only.** Never fabricate prices, candles, signals, performance, balances, trades, backtest results, AI context, or execution outcomes. Show Loading / Unavailable / Stale / Not connected.
2. **Deterministic first, AI second.** AI explains; deterministic logic decides signal outcomes.
3. **No fake success.** Server-side truth; server-side authorization.
4. **One architecture:** one RTDB, one AI Router, one gateway, one signal engine, one risk engine, one licensing model.
5. **Trading semantics consistent** across every module, every model, every chart.
6. **Evidence-first intelligence** — facts vs interpretations; WAIT / NO_TRADE as first-class states.
7. **Security at the layer, never only the UI.**

---

## Major modules (canonical)

| Domain | Canonical location |
|---|---|
| AI Router | `lib/ai/router.ts` + `lib/ai/providers/*` |
| Market data | `lib/market-data/` |
| Strategy lab | `lib/strategy-lab/` |
| Strategy research | `lib/strategy-research/` |
| Signals | `lib/ai-signals/` + `app/api/signals/*` |
| Telegram | `features/telegram-signals/` |
| Risk | `lib/risk/` |
| Gateway / trading | `lib/gateway.ts` + `MQL5/` + `lib/trading/unified/` |
| License | `lib/plugins/licensing.ts` + `app/api/license/*` |
| Notifications | `lib/notifications.ts`, `lib/email.ts`, `lib/telegram-monitoring.ts` |
| Plugins | `lib/plugins/` |
| Copy trading | `lib/copy-trading.ts` |
| Auth/admin | `lib/admin-auth.ts`, `lib/api-key-auth.ts`, `lib/plugins/api-helpers.ts` |
| Storage | Firebase RTDB only |
| UI shell | `components/layout/*` |

---

## Current architecture (short version)

- Next.js App Router: ~150 pages + ~230 `route.ts` handlers.
- Root layout: fonts, structured data, theme-init script, PWA/extension/analytics hosts.
- Two primary shells (`AppShell`/`AppSidebarLayout`); exceptions documented in project memory.
- Theme: Tailwind v4 CSS variable scale in `app/globals.css` (dark + light); design tokens at `packages/design-tokens`.
- Database: Firebase RTDB (rules committed); `lib/candel/workspace/database.ts` is the canonical Candel store.
- Chart: native lightweight-charts renderer (`ProTerminalChart`) + shared `TradingChart/ChartEngine` via `useLiveCandles`.

---

## Development priorities (current)

1. Fix reliability + security + data integrity (P0).
2. Complete the docs + audit (this directory).
3. Chart / smart-money label congestion + viewport / history fixes (P1).
4. Shared design system + global shell (P2).
5. Pro terminal redesign + chart interaction reliability.
6. Progressive marketplace → Candel → account/onboarding/subs/checkout → admin redesign.
7. Remaining architecture + integration work + test coverage.
8. Release readiness.

---

## Technical constraints

- No Firestore; no dependency upgrades without reason.
- Secrets are server-side only; `NEXT_PUBLIC_*` is client-safe.
- Lint hygiene (`no-explicit-any`, `no-require-imports`) is pre-existing; not swept wholesale in the first batch.
- Demo execution is the only supported mode; any other value disables execution (fail-closed).
- E2E browser tests exist but the headless browser is not installed in this environment.

---

## Known limitations

- Deep history (>300 bars) is bounded at the data layer; the UI does not yet communicate the limit.
- A live market session was not verified end-to-end in the inspected environment.
- Admin/Pro gating, account entitlements, and API-side authorization: routes exist; a dedicated audit is pending.
- Firebase security-rule, cache-coherence, and server/client boundary audit is pending.
- Strategy research/backtesting correctness and future-leakage coverage: not independently verified.

---

## How this file is maintained

- This file is the single source of truth for agents; read it before writing code.
- It supersedes other agent-instruction docs **except** `ALGOVAULT_AGENT_CONSTITUTION.md`.
- When it diverges from implementation, implementation wins and this file is updated.
- Record every major change (with `RECOVERY_LOG.md`).
