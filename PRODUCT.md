# AlgoVault — Product Truth

> Captured from `ALGOVAULT_AGENT_CONSTITUTION.md` and the product redesign brief. This file records *what AlgoVault is* — not visual preferences.

## What it is

AlgoVault is a serious, commercial trading technology platform. It is a real product with real backend systems: Firebase Realtime Database, Firebase Auth, server APIs, a trading gateway to MT5/MQL5, signal lifecycle engine, Risk Engine, Strategy Lab (backtest / optimization / walk-forward / replay / EA generation), an AI Router, market data pipeline, Telegram integration, Stripe checkout/licensing, marketplace, copy trading, and a TradingView browser extension.

The engineering goal is fixed: **real functionality + correct trading logic + reliable data + coherent architecture + professional UX.**

## Users

- **Retail & pro traders** — consume AI signals, run the trading terminal, manage positions, backtest strategies, deploy EAs, license products.
- **Strategy developers** — build strategies in Strategy Lab, generate EAs, sell products in the Marketplace.
- **Subscribers** — Free / Pro tiers; Pro unlocks M1 signals, higher daily limits, advanced analytics.
- **Affiliates** — referral marketing with commissions.
- **Admins & developers** — operate the platform, review signals, manage users, products, licenses, copy-trading, whitelabel.

## The core workflow (the product spine)

```text
Market Data → Charts/Analytics → AI Intelligence → Strategy Lab → Backtesting →
Optimization/Robustness → Risk Engine → Signals/Orders → Gateway → MT5 →
Live Performance → Analytics/Improvement
```

## Product rules (non-negotiables)

1. **Real data only.** Never fabricate prices, candles, signals, performance, balances, trades, backtest/optimization results, AI context, or execution outcomes. If data is unavailable, show Loading / Unavailable / Stale / Not connected — never fake numbers.
2. **Deterministic first, AI second.** AI explains; it never invents trading data. Signal outcomes (TP/SL hits) are decided deterministically, not by AI.
3. **No fake success.** Never show Success / Executed / Connected / Backtested / Compiled / Live / Paid unless the underlying operation actually succeeded. Gateway acknowledgements are the only source of "filled"/"rejected".
4. **Trading semantics are consistent:** profit/loss, buy/sell, long/short, risk/warning/error each have one meaning and one visual meaning.
5. **Security at the layer, not the UI:** hiding a button is not authorization. Server/API checks are authoritative.
6. **One architecture:** one Firebase RTDB, one AI Router, one gateway, one signal engine, one risk engine, one licensing model.
7. **Truthful states everywhere:** LIVE / STALE / OFFLINE / UNKNOWN are surfaced honestly; a stale heartbeat is never presented as live.

## What must keep working (during any redesign)

Firebase RTDB + Auth, server auth/authorization, API routes, trading logic, MT5 Gateway, MQL5 integration, order lifecycle, Risk Engine, signal lifecycle, Strategy Lab, backtesting, optimization, replay, AI Router, market data, Telegram, Stripe, Marketplace, licensing, downloads, copy trading, notifications, Chrome Extension, admin permissions, account functionality.

## Navigation reality

The product spans: overview/dashboard, markets (scanner, analysis, economic calendar), trading (terminal, positions, orders, trade management, live), intelligence (AI signals, AI copilot, insights, AI history, reports), strategy (strategy lab, backtests, walk-forward, monte-carlo, replay, equity curve, verified performance), automation (bots, copy trading, gateway/trading access), marketplace (products, purchases, licenses), integrations (telegram, tradingview), account (settings, affiliates, tools), admin, and public marketing pages.

## Design goal

One professional product, not a collection of independently built screens. Information-dense but readable; precise; fast; trustworthy; consistent. The UI must support: speed, clarity, precision, confidence for trading; and clear workflow progress for Strategy Lab and the Marketplace.