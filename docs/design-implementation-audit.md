# AlgoVault — Design Implementation Audit & Route Inventory

Role: **tracking mechanism** for the page-by-page / component-by-component redesign. It is not the
deliverable — the redesign itself is. This file exists so no discovered surface is silently skipped.

- **Design authority:** `DESIGN.md` ("Institutional Command"). Where code and `DESIGN.md` disagree,
  one of them is a bug.
- **Narrative log:** `docs/project-control/UI_UX_REDESIGN_AUDIT.md` (Phases 1–6, entries `UI-00x`).
  That file records *what changed and why*; **this file records the inventory and the status of every
  surface**. They are complementary — do not duplicate narrative here or inventories there.
- **Constitution:** `ALGOVAULT_AGENT_CONSTITUTION.md` §37/§46/§54 (quality gates, UI states, tokens).

> Why this file exists: the repo had a design authority and a phase log, but **no route/component
> inventory with per-surface status**. This is that inventory. If a comparable inventory appears,
> merge into one — never keep two.

_Generated from the repository on 2026-10-10. Re-run the commands in §2 to refresh._

---

## 1. Scope and source of truth

Discovered by inspection of the Next.js App Router (`app/`), route groups, layouts, shared UI
(`components/ui/`), feature components (`components/*`, `features/*`), and conditionally rendered UI.

**Confirmed non-goals (must not change — `DESIGN.md` §16):** Firebase RTDB integration, auth/authorization,
Stripe/payment flows, trading/execution providers, order submission and execution logic, risk controls,
chart data calculations/indicators, API contracts, routing behaviour. The redesign is **visual and
component-architectural only**.

## 2. Status legend & measurement methodology

Status is derived from **measured** drift signals, not opinion. Each signal is a banned pattern from
`DESIGN.md` §3/§4/§5/§17:

| Signal | grep pattern |
|---|---|
| Raw colour family | `\b(bg|text|border|from|via|to|ring|fill|stroke)-(emerald|rose|amber|sky|violet|orange|red|green|blue|purple|pink|indigo|teal|cyan|lime|yellow)-[0-9]{2,3}\b` |
| Radius `2xl`/`3xl` | `rounded-(2xl|3xl)` |
| Micro text | `text-\[(9|10|11)px\]` |
| Blur | `backdrop-blur` |
| Heavy shadow | `shadow-2xl` |
| Gradient | `bg-gradient|bg-linear|gradient-text` |

| Status | Meaning |
|---|---|
| ✅ clean | zero drift signals measured in the file |
| 🔧 in progress | file is modified in the worktree (a pass has started) but still carries drift |
| ⬜ pending | file is untouched and still carries drift |
| ⛔ dead | component is not referenced anywhere (no live surface to redesign) |
| ▫ allowed | signal present but explicitly permitted by `DESIGN.md` (overlay/drawer blur) |

Run the audit:

```bash
npx tsc --noEmit                 # must exit 0
rg -o 'rounded-(2xl|3xl)' -g '*.tsx' app components features | wc -l
rg -o 'text-\[(9|10|11)px\]' -g '*.tsx' app components features | wc -l
```

## 3. Global scoreboard (measured)

| Signal | Routes (253 files) | Components (285 files) | Total | Target |
|---|---:|---:|---:|---|
| Raw colour family | 3180 | 1907 | **5087** | 0 on live, in-scope surfaces |
| Radius `2xl`/`3xl` | 0 | 47 | **47** | 0 |
| Micro text `[9-11px]` | 0 | 6 | **6** | 0 |
| `backdrop-blur` | 124 | 79 | **203** | overlays/drawers only |
| `shadow-2xl` | 20 | 16 | **36** | 0 on cards |
| Gradient | 82 | 44 | **126** | 0 decorative |

Route files: **118 clean**, **135 carrying drift**. Component files: **144 clean**, **141 carrying drift**
(of which a large share are dead code — see §9).

---

## 4. Route inventory (App Router, 253 pages)

URLs are the resolved paths; `[param]` marks dynamic segments.

### 4.1 Summary by area

| Area | Routes | Raw colour | Radius 2xl/3xl | Micro text | Blur | shadow-2xl | Gradient |
|---|---:|---:|---:|---:|---:|---:|---:|
| `(root)` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `account` | 48 | 426 | 0 | 0 | 22 | 2 | 4 |
| `account-health` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `admin` | 79 | 853 | 0 | 0 | 13 | 9 | 11 |
| `advanced-analysis` | 1 | 4 | 0 | 0 | 5 | 0 | 1 |
| `affiliates` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `agent` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `ai-copilot` | 1 | 30 | 0 | 0 | 0 | 0 | 0 |
| `ai-historical` | 1 | 17 | 0 | 0 | 0 | 0 | 0 |
| `ai-trading-teams` | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `alert` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `alert-center` | 1 | 45 | 0 | 0 | 0 | 0 | 0 |
| `alerts` | 3 | 140 | 0 | 0 | 1 | 1 | 0 |
| `backtests` | 1 | 103 | 0 | 0 | 13 | 0 | 9 |
| `broker-compare` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `compare` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `copy-trading` | 1 | 97 | 0 | 0 | 1 | 1 | 6 |
| `correlation` | 1 | 22 | 0 | 0 | 0 | 0 | 0 |
| `cross-asset` | 1 | 8 | 0 | 0 | 0 | 0 | 0 |
| `dashboard` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `dev-widget-preview` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `developer` | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| `docs` | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `donate` | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `economic-calendar` | 1 | 19 | 0 | 0 | 1 | 0 | 0 |
| `equity-curve` | 1 | 19 | 0 | 0 | 0 | 0 | 0 |
| `execution-analytics` | 1 | 14 | 0 | 0 | 0 | 0 | 0 |
| `goals` | 1 | 61 | 0 | 0 | 1 | 1 | 8 |
| `insights` | 1 | 19 | 0 | 0 | 0 | 0 | 0 |
| `journal` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `live` | 1 | 5 | 0 | 0 | 1 | 0 | 1 |
| `live-performance` | 1 | 66 | 0 | 0 | 9 | 0 | 8 |
| `login` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `market-intelligence` | 14 | 14 | 0 | 0 | 0 | 0 | 0 |
| `marketplace` | 7 | 0 | 0 | 0 | 6 | 2 | 7 |
| `mobile` | 8 | 103 | 0 | 0 | 8 | 0 | 0 |
| `monte-carlo` | 1 | 16 | 0 | 0 | 0 | 0 | 0 |
| `news` | 1 | 14 | 0 | 0 | 0 | 0 | 0 |
| `performance-arena` | 5 | 13 | 0 | 0 | 0 | 0 | 0 |
| `portfolio` | 2 | 25 | 0 | 0 | 0 | 0 | 0 |
| `position` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `pricing` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `privacy` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `refunds` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `register` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `report-generator` | 1 | 9 | 0 | 0 | 0 | 0 | 0 |
| `research` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `risk` | 1 | 31 | 0 | 0 | 0 | 0 | 0 |
| `scalping-terminal` | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| `scanner` | 1 | 25 | 0 | 0 | 0 | 0 | 0 |
| `setup` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `signal-transparency` | 1 | 18 | 0 | 0 | 0 | 0 | 0 |
| `signals` | 6 | 549 | 0 | 0 | 35 | 0 | 16 |
| `social` | 1 | 0 | 0 | 0 | 1 | 1 | 0 |
| `spreads` | 1 | 29 | 0 | 0 | 0 | 0 | 0 |
| `statement` | 1 | 32 | 0 | 0 | 0 | 0 | 0 |
| `store` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `strategy` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `strategy-compare` | 1 | 9 | 0 | 0 | 0 | 0 | 0 |
| `strategy-lab` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `strategy-research` | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| `tags` | 1 | 16 | 0 | 0 | 0 | 0 | 0 |
| `terminal` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `terms` | 1 | 4 | 0 | 0 | 0 | 0 | 0 |
| `tools` | 11 | 0 | 0 | 0 | 0 | 0 | 1 |
| `trade-journal` | 1 | 11 | 0 | 0 | 0 | 0 | 0 |
| `trade-management` | 1 | 178 | 0 | 0 | 4 | 3 | 2 |
| `trade-replay` | 1 | 68 | 0 | 0 | 2 | 0 | 2 |
| `trading` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `trust-methodology` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `verified-performance` | 1 | 29 | 0 | 0 | 0 | 0 | 0 |
| `walk-forward` | 1 | 9 | 0 | 0 | 0 | 0 | 0 |
| `workflows` | 2 | 29 | 0 | 0 | 0 | 0 | 6 |
| **Total** | 253 | 3180 | 0 | 0 | 124 | 20 | 82 |


### 4.2 Routes still carrying drift (action list)

| Route | Source file | Status | Raw | 2xl/3xl | micro | blur | sh2xl | grad |
|---|---|---|---:|---:|---:|---:|---:|---:|
| `/trade-management` | `app/trade-management/page.tsx` | 🔧 in progress | 178 | 0 | 0 | 4 | 3 | 2 |
| `/admin/telegram` | `app/admin/telegram/page.tsx` | 🔧 in progress | 175 | 0 | 0 | 3 | 3 | 0 |
| `/signals/[id]` | `app/signals/[id]/page.tsx` | 🔧 in progress | 143 | 0 | 0 | 7 | 0 | 7 |
| `/signals/pro/[id]` | `app/signals/pro/[id]/page.tsx` | 🔧 in progress | 141 | 0 | 0 | 5 | 0 | 6 |
| `/backtests` | `app/backtests/page.tsx` | 🔧 in progress | 103 | 0 | 0 | 13 | 0 | 9 |
| `/copy-trading` | `app/copy-trading/page.tsx` | 🔧 in progress | 97 | 0 | 0 | 1 | 1 | 6 |
| `/signals/history` | `app/signals/history/page.tsx` | 🔧 in progress | 95 | 0 | 0 | 6 | 0 | 0 |
| `/signals` | `app/signals/page.tsx` | 🔧 in progress | 85 | 0 | 0 | 6 | 0 | 2 |
| `/account/tools` | `app/account/tools/page.tsx` | 🔧 in progress | 83 | 0 | 0 | 0 | 0 | 0 |
| `/live-performance` | `app/live-performance/page.tsx` | 🔧 in progress | 66 | 0 | 0 | 9 | 0 | 8 |
| `/admin/intelligence/agents/create` | `app/admin/intelligence/agents/create/page.tsx` | 🔧 in progress | 68 | 0 | 0 | 0 | 0 | 9 |
| `/signals/stats` | `app/signals/stats/page.tsx` | 🔧 in progress | 65 | 0 | 0 | 11 | 0 | 1 |
| `/trade-replay` | `app/trade-replay/page.tsx` | 🔧 in progress | 68 | 0 | 0 | 2 | 0 | 2 |
| `/goals` | `app/goals/page.tsx` | 🔧 in progress | 61 | 0 | 0 | 1 | 1 | 8 |
| `/account/settings` | `app/account/settings/page.tsx` | 🔧 in progress | 54 | 0 | 0 | 10 | 2 | 0 |
| `/alerts/history` | `app/alerts/history/page.tsx` | 🔧 in progress | 66 | 0 | 0 | 0 | 0 | 0 |
| `/admin/signals` | `app/admin/signals/page.tsx` | 🔧 in progress | 43 | 0 | 0 | 2 | 1 | 1 |
| `/alerts/tools` | `app/alerts/tools/page.tsx` | 🔧 in progress | 47 | 0 | 0 | 0 | 0 | 0 |
| `/alert-center` | `app/alert-center/page.tsx` | 🔧 in progress | 45 | 0 | 0 | 0 | 0 | 0 |
| `/account/setfiles` | `app/account/setfiles/page.tsx` | 🔧 in progress | 35 | 0 | 0 | 0 | 0 | 0 |
| `/admin/copy-trading` | `app/admin/copy-trading/page.tsx` | 🔧 in progress | 34 | 0 | 0 | 0 | 0 | 0 |
| `/admin/setfiles` | `app/admin/setfiles/page.tsx` | 🔧 in progress | 31 | 0 | 0 | 1 | 1 | 0 |
| `/statement` | `app/statement/page.tsx` | 🔧 in progress | 32 | 0 | 0 | 0 | 0 | 0 |
| `/risk` | `app/risk/page.tsx` | 🔧 in progress | 31 | 0 | 0 | 0 | 0 | 0 |
| `/account/trading-access` | `app/account/trading-access/page.tsx` | 🔧 in progress | 30 | 0 | 0 | 0 | 0 | 0 |
| `/admin/developers` | `app/admin/developers/page.tsx` | 🔧 in progress | 30 | 0 | 0 | 0 | 0 | 0 |
| `/ai-copilot` | `app/ai-copilot/page.tsx` | 🔧 in progress | 30 | 0 | 0 | 0 | 0 | 0 |
| `/account/subscribe` | `app/account/subscribe/page.tsx` | 🔧 in progress | 27 | 0 | 0 | 0 | 0 | 2 |
| `/admin/affiliates` | `app/admin/affiliates/page.tsx` | 🔧 in progress | 27 | 0 | 0 | 1 | 1 | 0 |
| `/alerts` | `app/alerts/page.tsx` | 🔧 in progress | 27 | 0 | 0 | 1 | 1 | 0 |
| `/spreads` | `app/spreads/page.tsx` | 🔧 in progress | 29 | 0 | 0 | 0 | 0 | 0 |
| `/verified-performance` | `app/verified-performance/page.tsx` | 🔧 in progress | 29 | 0 | 0 | 0 | 0 | 0 |
| `/admin/backtests` | `app/admin/backtests/page.tsx` | 🔧 in progress | 26 | 0 | 0 | 1 | 1 | 0 |
| `/account/plugins/[id]` | `app/account/plugins/[id]/page.tsx` | 🔧 in progress | 27 | 0 | 0 | 0 | 0 | 0 |
| `/admin/plugins/ai-studio` | `app/admin/plugins/ai-studio/page.tsx` | 🔧 in progress | 27 | 0 | 0 | 0 | 0 | 0 |
| `/admin/licenses` | `app/admin/licenses/page.tsx` | 🔧 in progress | 24 | 0 | 0 | 1 | 1 | 0 |
| `/mobile/account` | `app/mobile/account/page.tsx` | 🔧 in progress | 24 | 0 | 0 | 2 | 0 | 0 |
| `/account/market-intelligence` | `app/account/market-intelligence/page.tsx` | 🔧 in progress | 15 | 0 | 0 | 10 | 0 | 0 |
| `/admin/workflows` | `app/admin/workflows/page.tsx` | 🔧 in progress | 24 | 0 | 0 | 0 | 1 | 0 |
| `/portfolio` | `app/portfolio/page.tsx` | 🔧 in progress | 25 | 0 | 0 | 0 | 0 | 0 |
| `/scanner` | `app/scanner/page.tsx` | 🔧 in progress | 25 | 0 | 0 | 0 | 0 | 0 |
| `/mobile/market-context` | `app/mobile/market-context/page.tsx` | 🔧 in progress | 24 | 0 | 0 | 0 | 0 | 0 |
| `/account/affiliate` | `app/account/affiliate/page.tsx` | 🔧 in progress | 23 | 0 | 0 | 0 | 0 | 0 |
| `/mobile/bots` | `app/mobile/bots/page.tsx` | 🔧 in progress | 21 | 0 | 0 | 2 | 0 | 0 |
| `/account/copy-trading` | `app/account/copy-trading/page.tsx` | 🔧 in progress | 22 | 0 | 0 | 0 | 0 | 0 |
| `/correlation` | `app/correlation/page.tsx` | 🔧 in progress | 22 | 0 | 0 | 0 | 0 | 0 |
| `/admin/plugins/[id]` | `app/admin/plugins/[id]/page.tsx` | 🔧 in progress | 21 | 0 | 0 | 0 | 0 | 0 |
| `/workflows/[workflowId]` | `app/workflows/[workflowId]/page.tsx` | 🔧 in progress | 18 | 0 | 0 | 0 | 0 | 3 |
| `/admin/reviews` | `app/admin/reviews/page.tsx` | 🔧 in progress | 20 | 0 | 0 | 0 | 0 | 0 |
| `/admin/trading-accounts` | `app/admin/trading-accounts/page.tsx` | 🔧 in progress | 20 | 0 | 0 | 0 | 0 | 0 |
| `/admin/trading-licenses` | `app/admin/trading-licenses/page.tsx` | 🔧 in progress | 20 | 0 | 0 | 0 | 0 | 0 |
| `/economic-calendar` | `app/economic-calendar/page.tsx` | 🔧 in progress | 19 | 0 | 0 | 1 | 0 | 0 |
| `/signals/pro` | `app/signals/pro/page.tsx` | 🔧 in progress | 20 | 0 | 0 | 0 | 0 | 0 |
| `/admin/trading-providers` | `app/admin/trading-providers/page.tsx` | 🔧 in progress | 19 | 0 | 0 | 0 | 0 | 0 |
| `/equity-curve` | `app/equity-curve/page.tsx` | 🔧 in progress | 19 | 0 | 0 | 0 | 0 | 0 |
| `/insights` | `app/insights/page.tsx` | 🔧 in progress | 19 | 0 | 0 | 0 | 0 | 0 |
| `/mobile/markets` | `app/mobile/markets/page.tsx` | 🔧 in progress | 17 | 0 | 0 | 2 | 0 | 0 |
| `/mobile/signals` | `app/mobile/signals/page.tsx` | 🔧 in progress | 17 | 0 | 0 | 2 | 0 | 0 |
| `/account/pro-trading-extension` | `app/account/pro-trading-extension/page.tsx` | 🔧 in progress | 16 | 0 | 0 | 0 | 0 | 2 |
| `/signal-transparency` | `app/signal-transparency/page.tsx` | ⬜ pending | 18 | 0 | 0 | 0 | 0 | 0 |
| `/account/live` | `app/account/live/page.tsx` | 🔧 in progress | 16 | 0 | 0 | 1 | 0 | 0 |
| `/account/workflows` | `app/account/workflows/page.tsx` | 🔧 in progress | 17 | 0 | 0 | 0 | 0 | 0 |
| `/admin/whitelabel` | `app/admin/whitelabel/page.tsx` | ⬜ pending | 17 | 0 | 0 | 0 | 0 | 0 |
| `/ai-historical` | `app/ai-historical/page.tsx` | ⬜ pending | 17 | 0 | 0 | 0 | 0 | 0 |
| `/account/plugins` | `app/account/plugins/page.tsx` | 🔧 in progress | 16 | 0 | 0 | 0 | 0 | 0 |
| `/monte-carlo` | `app/monte-carlo/page.tsx` | 🔧 in progress | 16 | 0 | 0 | 0 | 0 | 0 |
| `/tags` | `app/tags/page.tsx` | 🔧 in progress | 16 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/account-health` | `app/admin/intelligence/account-health/page.tsx` | 🔧 in progress | 15 | 0 | 0 | 0 | 0 | 0 |
| `/account/trading` | `app/account/trading/page.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `/admin/growth/marketing-agent` | `app/admin/growth/marketing-agent/page.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `/admin/plugins` | `app/admin/plugins/page.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `/execution-analytics` | `app/execution-analytics/page.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `/news` | `app/news/page.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `/workflows` | `app/workflows/page.tsx` | 🔧 in progress | 11 | 0 | 0 | 0 | 0 | 3 |
| `/admin/strategy-research` | `app/admin/strategy-research/page.tsx` | ⬜ pending | 13 | 0 | 0 | 0 | 0 | 0 |
| `/admin/business-operations` | `app/admin/business-operations/page.tsx` | ⬜ pending | 12 | 0 | 0 | 0 | 0 | 0 |
| `/admin/growth/command-center` | `app/admin/growth/command-center/page.tsx` | ⬜ pending | 12 | 0 | 0 | 0 | 0 | 0 |
| `/admin/live` | `app/admin/live/page.tsx` | 🔧 in progress | 12 | 0 | 0 | 0 | 0 | 0 |
| `/trade-journal` | `app/trade-journal/page.tsx` | 🔧 in progress | 11 | 0 | 0 | 0 | 0 | 0 |
| `/admin/ai/monitor` | `app/admin/ai/monitor/page.tsx` | 🔧 in progress | 10 | 0 | 0 | 0 | 0 | 0 |
| `/admin/bots/[id]/edit` | `app/admin/bots/[id]/edit/page.tsx` | 🔧 in progress | 10 | 0 | 0 | 0 | 0 | 0 |
| `/admin/extensions` | `app/admin/extensions/page.tsx` | 🔧 in progress | 10 | 0 | 0 | 0 | 0 | 0 |
| `/advanced-analysis` | `app/advanced-analysis/page.tsx` | 🔧 in progress | 4 | 0 | 0 | 5 | 0 | 1 |
| `/admin/business-operations/financial` | `app/admin/business-operations/financial/page.tsx` | ⬜ pending | 9 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/agents` | `app/admin/intelligence/agents/page.tsx` | 🔧 in progress | 9 | 0 | 0 | 0 | 0 | 0 |
| `/market-intelligence/scalping` | `app/market-intelligence/scalping/page.tsx` | ⬜ pending | 9 | 0 | 0 | 0 | 0 | 0 |
| `/report-generator` | `app/report-generator/page.tsx` | ⬜ pending | 9 | 0 | 0 | 0 | 0 | 0 |
| `/strategy-compare` | `app/strategy-compare/page.tsx` | 🔧 in progress | 9 | 0 | 0 | 0 | 0 | 0 |
| `/walk-forward` | `app/walk-forward/page.tsx` | 🔧 in progress | 9 | 0 | 0 | 0 | 0 | 0 |
| `/account/bots/[botId]` | `app/account/bots/[botId]/page.tsx` | 🔧 in progress | 8 | 0 | 0 | 0 | 0 | 0 |
| `/admin/bots` | `app/admin/bots/page.tsx` | 🔧 in progress | 5 | 0 | 0 | 2 | 0 | 1 |
| `/admin/intelligence/executions` | `app/admin/intelligence/executions/page.tsx` | 🔧 in progress | 8 | 0 | 0 | 0 | 0 | 0 |
| `/cross-asset` | `app/cross-asset/page.tsx` | 🔧 in progress | 8 | 0 | 0 | 0 | 0 | 0 |
| `/admin/bots/new` | `app/admin/bots/new/page.tsx` | 🔧 in progress | 7 | 0 | 0 | 0 | 0 | 0 |
| `/admin/erpnext` | `app/admin/erpnext/page.tsx` | ⬜ pending | 7 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/sandbox` | `app/admin/intelligence/sandbox/page.tsx` | 🔧 in progress | 7 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/workflows` | `app/admin/intelligence/workflows/page.tsx` | 🔧 in progress | 7 | 0 | 0 | 0 | 0 | 0 |
| `/live` | `app/live/page.tsx` | 🔧 in progress | 5 | 0 | 0 | 1 | 0 | 1 |
| `/account/agents` | `app/account/agents/page.tsx` | 🔧 in progress | 6 | 0 | 0 | 0 | 0 | 0 |
| `/admin/plugins/create` | `app/admin/plugins/create/page.tsx` | 🔧 in progress | 6 | 0 | 0 | 0 | 0 | 0 |
| `/admin/users/[uid]` | `app/admin/users/[uid]/page.tsx` | 🔧 in progress | 6 | 0 | 0 | 0 | 0 | 0 |
| `/marketplace/extensions/[slug]` | `app/marketplace/extensions/[slug]/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 3 | 1 | 2 |
| `/marketplace/plugins/[slug]` | `app/marketplace/plugins/[slug]/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 3 | 1 | 2 |
| `/admin/intelligence-cloud` | `app/admin/intelligence-cloud/page.tsx` | ⬜ pending | 5 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence` | `app/admin/intelligence/page.tsx` | 🔧 in progress | 5 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/plugins` | `app/admin/intelligence/plugins/page.tsx` | 🔧 in progress | 5 | 0 | 0 | 0 | 0 | 0 |
| `/account/performance-arena/leaderboard` | `app/account/performance-arena/leaderboard/page.tsx` | 🔧 in progress | 4 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/agents/[agentId]` | `app/admin/intelligence/agents/[agentId]/page.tsx` | 🔧 in progress | 4 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/extensions` | `app/admin/intelligence/extensions/page.tsx` | 🔧 in progress | 4 | 0 | 0 | 0 | 0 | 0 |
| `/admin/settings` | `app/admin/settings/page.tsx` | 🔧 in progress | 4 | 0 | 0 | 0 | 0 | 0 |
| `/market-intelligence/advanced` | `app/market-intelligence/advanced/page.tsx` | ⬜ pending | 4 | 0 | 0 | 0 | 0 | 0 |
| `/performance-arena/leaderboard` | `app/performance-arena/leaderboard/page.tsx` | 🔧 in progress | 4 | 0 | 0 | 0 | 0 | 0 |
| `/terms` | `app/terms/page.tsx` | ⬜ pending | 4 | 0 | 0 | 0 | 0 | 0 |
| `/account/performance-arena/attempts/verify` | `app/account/performance-arena/attempts/verify/page.tsx` | ⬜ pending | 3 | 0 | 0 | 0 | 0 | 0 |
| `/account/performance-arena/profile` | `app/account/performance-arena/profile/page.tsx` | 🔧 in progress | 3 | 0 | 0 | 0 | 0 | 0 |
| `/admin/business-events` | `app/admin/business-events/page.tsx` | ⬜ pending | 3 | 0 | 0 | 0 | 0 | 0 |
| `/admin/growth/studio` | `app/admin/growth/studio/page.tsx` | 🔧 in progress | 3 | 0 | 0 | 0 | 0 | 0 |
| `/performance-arena/profile` | `app/performance-arena/profile/page.tsx` | 🔧 in progress | 3 | 0 | 0 | 0 | 0 | 0 |
| `/account/performance-arena/attempts/[attemptId]` | `app/account/performance-arena/attempts/[attemptId]/page.tsx` | 🔧 in progress | 2 | 0 | 0 | 0 | 0 | 0 |
| `/account/performance-arena/challenges/[definitionId]` | `app/account/performance-arena/challenges/[definitionId]/page.tsx` | ⬜ pending | 2 | 0 | 0 | 0 | 0 | 0 |
| `/account/performance-arena` | `app/account/performance-arena/page.tsx` | ⬜ pending | 2 | 0 | 0 | 0 | 0 | 0 |
| `/admin/growth/approvals` | `app/admin/growth/approvals/page.tsx` | ⬜ pending | 0 | 0 | 0 | 2 | 0 | 0 |
| `/marketplace/[slug]` | `app/marketplace/[slug]/page.tsx` | ⬜ pending | 0 | 0 | 0 | 0 | 0 | 2 |
| `/performance-arena/attempts/[attemptId]` | `app/performance-arena/attempts/[attemptId]/page.tsx` | 🔧 in progress | 2 | 0 | 0 | 0 | 0 | 0 |
| `/performance-arena/challenges/[definitionId]` | `app/performance-arena/challenges/[definitionId]/page.tsx` | ⬜ pending | 2 | 0 | 0 | 0 | 0 | 0 |
| `/performance-arena` | `app/performance-arena/page.tsx` | ⬜ pending | 2 | 0 | 0 | 0 | 0 | 0 |
| `/social` | `app/social/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 1 | 0 |
| `/account-health` | `app/account-health/page.tsx` | 🔧 in progress | 1 | 0 | 0 | 0 | 0 | 0 |
| `/account/bots` | `app/account/bots/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 0 | 0 |
| `/account/scalping-terminal` | `app/account/scalping-terminal/page.tsx` | 🔧 in progress | 1 | 0 | 0 | 0 | 0 | 0 |
| `/admin/growth` | `app/admin/growth/page.tsx` | ⬜ pending | 1 | 0 | 0 | 0 | 0 | 0 |
| `/market-intelligence/investigation` | `app/market-intelligence/investigation/page.tsx` | ⬜ pending | 1 | 0 | 0 | 0 | 0 | 0 |
| `/marketplace` | `app/marketplace/page.tsx` | ⬜ pending | 0 | 0 | 0 | 0 | 0 | 1 |
| `/scalping-terminal` | `app/scalping-terminal/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 0 | 0 |
| `/tools` | `app/tools/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 1 |

### 4.3 Verified drift-free routes

(118)

`/account/account-health`, `/account/ai-execution`, `/account/ai-trading-teams`, `/account/analysis`, `/account/candels/[candelId]`, `/account/candels/activity`, `/account/candels/approvals`, `/account/candels/automations`, `/account/candels/builder`, `/account/candels/jobs`, `/account/candels/memory`, `/account/candels`, `/account/candels/proposals`, `/account/candels/tool-calls`, `/account/candels/workspace`, `/account/dashboard`, `/account/licenses`, `/account/lite-scalping-terminal`, `/account/livemap`, `/account`, `/account/purchases`, `/account/scalping-terminal-lite`, `/account/terminal`, `/account/tradingview`, `/admin/ai-agents`, `/admin/ai-trading-teams`, `/admin/analysis`, `/admin/business-operations/licenses`, `/admin/business-operations/orders`, `/admin/business-operations/payments`, `/admin/growth/campaigns/[id]`, `/admin/growth/campaigns`, `/admin/growth/channels`, `/admin/growth/content`, `/admin/growth/experiments`, `/admin/growth/loop`, `/admin/growth/opportunities`, `/admin/growth/reports`, `/admin/growth/workflows`, `/admin/intelligence/ai-health`, `/admin/intelligence/ai-usage`, `/admin/intelligence/studio`, `/admin/livemap`, `/admin/monetization/ad-networks`, `/admin/monetization/ads`, `/admin/monetization/affiliate`, `/admin/monetization`, `/admin/monetization/placements`, `/admin/monetization/revenue`, `/admin/monetization/settings`, `/admin/orders`, `/admin`, `/admin/performance-arena`, `/admin/scalping`, `/admin/tradingview`, `/admin/users`, `/affiliates`, `/agent`, `/ai-trading-teams/[teamId]`, `/ai-trading-teams`, `/alert/[alertId]`, `/broker-compare`, `/compare`, `/dashboard`, `/dev-widget-preview`, `/developer/dashboard`, `/developer/intelligence-cloud`, `/developer/subscription`, `/docs/[slug]`, `/docs`, `/donate`, `/donate/success`, `/journal/[entryId]`, `/login`, `/market-intelligence/analysis`, `/market-intelligence/backtest`, `/market-intelligence/evidence`, `/market-intelligence/knowledge`, `/market-intelligence/oos`, `/market-intelligence`, `/market-intelligence/patterns`, `/market-intelligence/research`, `/market-intelligence/smart-money`, `/market-intelligence/strategy-lab`, `/market-intelligence/terminal`, `/marketplace/extensions`, `/marketplace/plugins`, `/marketplace/strategy-certification`, `/mobile/home`, `/mobile/intelligence`, `/mobile`, `/`, `/portfolio/intelligence`, `/position/[positionId]`, `/pricing`, `/privacy`, `/refunds`, `/register`, `/research/[researchId]`, `/setup/[setupId]`, `/store/[accountId]`, `/strategy-lab`, `/strategy-research/[missionId]/[candidateId]`, `/strategy-research`, `/strategy/[strategyId]`, `/terminal/[symbol]`, `/tools/broker-fees`, `/tools/calculators`, `/tools/correlation`, `/tools/currency-strength`, `/tools/drawdown-calculator`, `/tools/fibonacci`, `/tools/overlap`, `/tools/pip-reference`, `/tools/risk-of-ruin`, `/tools/sessions`, `/trading`, `/trust-methodology`

---

## 5. Layouts & shells

All route-group layouts are clean. Shell components are clean except one **allowed** overlay blur.

| Layout / shell file | Status | Raw | 2xl/3xl | micro | blur | sh2xl | grad |
|---|---|---:|---:|---:|---:|---:|---:|
| `app/account/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/admin/growth/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/admin/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/admin/monetization/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/agent/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/alerts/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/backtests/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/compare/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/copy-trading/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/cross-asset/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/dashboard/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/economic-calendar/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/goals/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/live/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/mobile/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/news/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/signals/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/statement/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `app/tools/layout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/layout/AppShell.tsx` | ⬜ pending | 0 | 0 | 0 | 1 | 0 | 0 |
| `components/layout/AppSidebarLayout.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/layout/CommandPalette.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/layout/NotificationsMenu.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/layout/app-nav.ts` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/layout/admin-nav.ts` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |


Note: `components/layout/AppShell.tsx` blur is the sticky shell header allowed by `DESIGN.md` §5.
`components/ui/dialog.tsx` blur is an overlay, also allowed.

---

## 6. Shared UI library (`components/ui/*`)

The canonical primitives are **drift-free** (26 files) and are the migration target for feature code.
Only `dialog.tsx` carries `backdrop-blur`, which is permitted for overlays.

| Component | Status | Raw | 2xl/3xl | micro | blur | sh2xl | grad |
|---|---|---:|---:|---:|---:|---:|---:|
| `components/strategy-lab/StrategyLabClient.tsx` | 🔧 in progress | 173 | 0 | 0 | 1 | 0 | 2 |
| `components/tradingview/PineWorkspace.tsx` | 🔧 in progress | 130 | 0 | 0 | 0 | 0 | 2 |
| `components/tradingview/CreateAlertDialog.tsx` | 🔧 in progress | 86 | 0 | 0 | 0 | 1 | 0 |
| `components/pro-scalping-terminal/ProTerminalChart.tsx` | 🔧 in progress | 71 | 0 | 0 | 11 | 0 | 0 |
| `components/tradingview/MarketReplay.tsx` | 🔧 in progress | 53 | 0 | 0 | 1 | 0 | 0 |
| `components/portfolio/PortfolioIntelligence.tsx` | 🔧 in progress | 46 | 0 | 0 | 0 | 0 | 0 |
| `components/tools/ProTools.tsx` | 🔧 in progress | 44 | 0 | 0 | 0 | 0 | 0 |
| `components/tools/VisualAnalysis.tsx` | 🔧 in progress | 43 | 0 | 0 | 0 | 0 | 0 |
| `components/candel/role-visuals.tsx` | 🔧 in progress | 42 | 0 | 0 | 0 | 0 | 0 |
| `features/telegram-signals/components/SignalCard.tsx` | ⬜ pending | 33 | 1 | 6 | 1 | 0 | 0 |
| `components/live/ScalpingTerminal.tsx` | 🔧 in progress | 29 | 0 | 0 | 1 | 0 | 7 |
| `components/tools/Journal.tsx` | 🔧 in progress | 35 | 0 | 0 | 0 | 0 | 0 |
| `components/terminal/IntelligenceRail.tsx` | 🔧 in progress | 33 | 0 | 0 | 0 | 0 | 0 |
| `components/pro-scalping-terminal/ProTerminalPanels.tsx` | 🔧 in progress | 32 | 0 | 0 | 0 | 0 | 0 |
| `components/account/TradingViewIntegrationCard.tsx` | 🔧 in progress | 30 | 0 | 0 | 1 | 0 | 0 |
| `components/analytics/AnalysisWorkspace.tsx` | 🔧 in progress | 31 | 0 | 0 | 0 | 0 | 0 |
| `components/mobile/CommandCenter.tsx` | 🔧 in progress | 30 | 0 | 0 | 0 | 0 | 0 |
| `components/trading/OrderPanel.tsx` | 🔧 in progress | 30 | 0 | 0 | 0 | 0 | 0 |
| `components/tradingview/PineAnalysisPanel.tsx` | 🔧 in progress | 29 | 0 | 0 | 0 | 0 | 0 |
| `components/analytics/MarketHeader.tsx` | ⬜ pending | 26 | 0 | 0 | 1 | 1 | 0 |
| `components/pro-scalping-terminal/IntelligencePanel.tsx` | 🔧 in progress | 27 | 0 | 0 | 0 | 0 | 0 |
| `components/terminal/TerminalTopBar.tsx` | 🔧 in progress | 26 | 0 | 0 | 0 | 0 | 0 |
| `components/tools/PerformanceReports.tsx` | 🔧 in progress | 26 | 0 | 0 | 0 | 0 | 0 |
| `components/tools/TradeTracker.tsx` | 🔧 in progress | 26 | 0 | 0 | 0 | 0 | 0 |
| `components/cross-asset/ExplorerPanels.tsx` | 🔧 in progress | 25 | 0 | 0 | 0 | 0 | 0 |
| `components/tools/AdvancedAnalysis.tsx` | 🔧 in progress | 25 | 0 | 0 | 0 | 0 | 0 |
| `components/strategy-research/CandidateDetailView.tsx` | 🔧 in progress | 16 | 0 | 0 | 6 | 0 | 0 |
| `components/analytics/MarketRegimePanel.tsx` | 🔧 in progress | 21 | 0 | 0 | 0 | 0 | 0 |
| `components/analytics/SessionPanel.tsx` | 🔧 in progress | 19 | 0 | 0 | 0 | 0 | 2 |
| `components/cross-asset/MarketGraphCanvas.tsx` | 🔧 in progress | 20 | 0 | 0 | 0 | 0 | 0 |
| `components/mobile/FreshnessBadge.tsx` | 🔧 in progress | 20 | 0 | 0 | 0 | 0 | 0 |
| `components/tools/OrderFlow.tsx` | 🔧 in progress | 19 | 0 | 0 | 0 | 0 | 0 |
| `features/telegram-signals/components/AnalyticsView.tsx` | ⬜ pending | 14 | 5 | 0 | 0 | 0 | 0 |
| `components/account-health/status-pill.tsx` | 🔧 in progress | 18 | 0 | 0 | 0 | 0 | 0 |
| `components/pro-scalping-terminal/CrossAssetPanel.tsx` | 🔧 in progress | 18 | 0 | 0 | 0 | 0 | 0 |
| `components/pro-scalping-terminal/OrderFlowPanel.tsx` | 🔧 in progress | 18 | 0 | 0 | 0 | 0 | 0 |
| `components/pro-scalping-terminal/ProTradingViewContextPanel.tsx` | 🔧 in progress | 18 | 0 | 0 | 0 | 0 | 0 |
| `components/terminal/EventFeed.tsx` | 🔧 in progress | 18 | 0 | 0 | 0 | 0 | 0 |
| `components/intelligence-os/IntelligenceOSPanel.tsx` | 🔧 in progress | 17 | 0 | 0 | 0 | 0 | 0 |
| `components/analytics/InstitutionalZonesPanel.tsx` | 🔧 in progress | 16 | 0 | 0 | 0 | 0 | 0 |
| `components/performance-arena/OrderTicket.tsx` | 🔧 in progress | 16 | 0 | 0 | 0 | 0 | 0 |
| `components/terminal/TradingProviderStatus.tsx` | 🔧 in progress | 16 | 0 | 0 | 0 | 0 | 0 |
| `components/portfolio/PortfolioTerminalPanel.tsx` | 🔧 in progress | 15 | 0 | 0 | 0 | 0 | 0 |
| `components/trading/ExecutionLog.tsx` | 🔧 in progress | 15 | 0 | 0 | 0 | 0 | 0 |
| `components/analytics/MarketScorePanel.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `components/analytics/VWAPPanel.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `components/pro-scalping-terminal/ProScalpingTerminal.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `components/pwa/PwaRegister.tsx` | ⬜ pending | 12 | 0 | 0 | 2 | 0 | 0 |
| `components/terminal/RiskHud.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `components/tools/BacktestTool.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `components/workflows/WorkflowGuideTour.tsx` | 🔧 in progress | 12 | 0 | 0 | 0 | 0 | 2 |
| `components/analytics/VolatilityPanel.tsx` | 🔧 in progress | 13 | 0 | 0 | 0 | 0 | 0 |
| `components/pro-scalping-terminal/CandelToolbar.tsx` | 🔧 in progress | 12 | 0 | 0 | 0 | 1 | 0 |
| `components/strategy-research/StrategyResearchClient.tsx` | 🔧 in progress | 8 | 0 | 0 | 5 | 0 | 0 |
| `components/intelligence-os/SystemHealthStrip.tsx` | 🔧 in progress | 12 | 0 | 0 | 0 | 0 | 0 |
| `components/terminal/WatchlistRail.tsx` | 🔧 in progress | 12 | 0 | 0 | 0 | 0 | 0 |
| `components/trading/ProviderConnectionCard.tsx` | 🔧 in progress | 11 | 0 | 0 | 0 | 0 | 0 |
| `components/analytics/VolumePanel.tsx` | 🔧 in progress | 10 | 0 | 0 | 0 | 0 | 0 |
| `components/home/HeroSection.tsx` | 🔧 in progress | 0 | 2 | 0 | 4 | 1 | 3 |
| `components/performance-arena/primitives.tsx` | 🔧 in progress | 10 | 0 | 0 | 0 | 0 | 0 |
| `components/pro-scalping-terminal/ProTerminalJournal.tsx` | 🔧 in progress | 10 | 0 | 0 | 0 | 0 | 0 |
| `components/trading/ConnectionStatus.tsx` | ⬜ pending | 10 | 0 | 0 | 0 | 0 | 0 |
| `components/trading/TradeHistory.tsx` | 🔧 in progress | 10 | 0 | 0 | 0 | 0 | 0 |
| `components/trading/TradingAccessCard.tsx` | 🔧 in progress | 10 | 0 | 0 | 0 | 0 | 0 |
| `components/admin/ProductVersionHistory.tsx` | 🔧 in progress | 9 | 0 | 0 | 0 | 0 | 0 |
| `components/analytics/MarketStructurePanel.tsx` | 🔧 in progress | 9 | 0 | 0 | 0 | 0 | 0 |
| `components/guides/TourGuide.tsx` | 🔧 in progress | 4 | 4 | 0 | 0 | 1 | 0 |
| `components/terminal/PanelErrorBoundary.tsx` | 🔧 in progress | 9 | 0 | 0 | 0 | 0 | 0 |
| `features/telegram-signals/components/ConflictBanner.tsx` | ⬜ pending | 7 | 1 | 0 | 1 | 0 | 0 |
| `components/account-health/report-view.tsx` | 🔧 in progress | 8 | 0 | 0 | 0 | 0 | 0 |
| `components/analytics/LiquidityMap.tsx` | 🔧 in progress | 8 | 0 | 0 | 0 | 0 | 0 |
| `components/growth/SponsoredCard.tsx` | 🔧 in progress | 6 | 0 | 0 | 0 | 0 | 2 |
| `components/home/FinalCTASection.tsx` | 🔧 in progress | 0 | 1 | 0 | 3 | 1 | 3 |
| `components/home/LiveMonitoringSection.tsx` | 🔧 in progress | 0 | 6 | 0 | 1 | 1 | 0 |
| `components/terminal/TerminalShell.tsx` | 🔧 in progress | 8 | 0 | 0 | 0 | 0 | 0 |
| `components/trading/ChartToolbar.tsx` | 🔧 in progress | 8 | 0 | 0 | 0 | 0 | 0 |
| `components/growth/AffiliateCard.tsx` | 🔧 in progress | 5 | 0 | 0 | 0 | 0 | 2 |
| `components/growth/NativeAdCard.tsx` | 🔧 in progress | 5 | 0 | 0 | 0 | 0 | 2 |
| `components/mobile/MobileShell.tsx` | 🔧 in progress | 6 | 0 | 0 | 1 | 0 | 0 |
| `components/tradingview/TradingChart.tsx` | 🔧 in progress | 3 | 0 | 0 | 4 | 0 | 0 |
| `features/telegram-signals/components/RealtimeFeed.tsx` | ⬜ pending | 1 | 2 | 0 | 2 | 0 | 2 |
| `components/account-health/score-ring.tsx` | 🔧 in progress | 6 | 0 | 0 | 0 | 0 | 0 |
| `components/home/AIOptimizationSection.tsx` | 🔧 in progress | 0 | 3 | 0 | 2 | 1 | 0 |
| `components/home/PineWorkspaceSection.tsx` | 🔧 in progress | 0 | 3 | 0 | 1 | 1 | 1 |
| `components/home/RiskEngineSection.tsx` | 🔧 in progress | 0 | 4 | 0 | 1 | 1 | 0 |
| `components/performance-arena/GuardianPanel.tsx` | 🔧 in progress | 6 | 0 | 0 | 0 | 0 | 0 |
| `components/pro-scalping-terminal/ProTerminalReplay.tsx` | 🔧 in progress | 6 | 0 | 0 | 0 | 0 | 0 |
| `components/account-health/breakdown-bars.tsx` | 🔧 in progress | 5 | 0 | 0 | 0 | 0 | 0 |
| `components/home/TelegramPipelineSection.tsx` | 🔧 in progress | 0 | 3 | 0 | 1 | 1 | 0 |
| `components/live/LiveActivityFeed.tsx` | 🔧 in progress | 5 | 0 | 0 | 0 | 0 | 0 |
| `components/live/LiveWorldMap.tsx` | 🔧 in progress | 2 | 0 | 0 | 3 | 0 | 0 |
| `components/pro-scalping-terminal/ProTerminalChartWorkspace.tsx` | 🔧 in progress | 4 | 0 | 0 | 1 | 0 | 0 |
| `components/terminal/TradingChat.tsx` | 🔧 in progress | 5 | 0 | 0 | 0 | 0 | 0 |
| `components/home/BacktestingSection.tsx` | 🔧 in progress | 0 | 2 | 0 | 1 | 1 | 0 |
| `components/home/CopilotSection.tsx` | 🔧 in progress | 0 | 2 | 0 | 1 | 1 | 0 |
| `components/home/CopyTradingSection.tsx` | 🔧 in progress | 0 | 2 | 0 | 1 | 1 | 0 |
| `components/home/StrategyIntelligenceSection.tsx` | 🔧 in progress | 0 | 2 | 0 | 1 | 1 | 0 |
| `components/live/GlobalActivity.tsx` | ⬜ pending | 2 | 0 | 0 | 0 | 0 | 2 |
| `components/live/MarketActivity.tsx` | ⬜ pending | 2 | 0 | 0 | 0 | 0 | 2 |
| `components/performance-arena/AttemptReport.tsx` | 🔧 in progress | 4 | 0 | 0 | 0 | 0 | 0 |
| `components/performance-arena/PerformancePanel.tsx` | 🔧 in progress | 4 | 0 | 0 | 0 | 0 | 0 |
| `components/products/ProductMediaUpload.tsx` | 🔧 in progress | 0 | 0 | 0 | 4 | 0 | 0 |
| `components/account-health/metrics.tsx` | 🔧 in progress | 3 | 0 | 0 | 0 | 0 | 0 |
| `components/home/MarketScannerSection.tsx` | 🔧 in progress | 0 | 1 | 0 | 1 | 1 | 0 |
| `components/live/LiveStatsRow.tsx` | 🔧 in progress | 2 | 0 | 0 | 1 | 0 | 0 |
| `components/performance-arena/CompatibilityPanel.tsx` | 🔧 in progress | 3 | 0 | 0 | 0 | 0 | 0 |
| `components/performance-arena/PositionsTable.tsx` | 🔧 in progress | 3 | 0 | 0 | 0 | 0 | 0 |
| `components/signals/SignalChart.tsx` | 🔧 in progress | 0 | 0 | 0 | 3 | 0 | 0 |
| `components/strategy-research/ResearchEvidencePanel.tsx` | 🔧 in progress | 3 | 0 | 0 | 0 | 0 | 0 |
| `components/trading/Watchlist.tsx` | 🔧 in progress | 3 | 0 | 0 | 0 | 0 | 0 |
| `components/tradingview/TradingChart/AlertManager.tsx` | 🔧 in progress | 3 | 0 | 0 | 0 | 0 | 0 |
| `components/tradingview/TradingChart/ChartToolbar.tsx` | 🔧 in progress | 3 | 0 | 0 | 0 | 0 | 0 |
| `components/ai-trading-teams/entry-card.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 2 |
| `components/charts/GoChartingChart.tsx` | 🔧 in progress | 2 | 0 | 0 | 0 | 0 | 0 |
| `components/home/LifecycleSection.tsx` | 🔧 in progress | 0 | 1 | 0 | 1 | 0 | 0 |
| `components/home/MarketplaceSection.tsx` | 🔧 in progress | 0 | 2 | 0 | 0 | 0 | 0 |
| `components/market-intelligence/analytics/PatternExplorer.tsx` | 🔧 in progress | 1 | 0 | 0 | 1 | 0 | 0 |
| `components/market-intelligence/knowledge/KnowledgePanel.tsx` | 🔧 in progress | 1 | 0 | 0 | 1 | 0 | 0 |
| `components/market-intelligence/memory/SetupMemoryPanel.tsx` | 🔧 in progress | 1 | 0 | 0 | 1 | 0 | 0 |
| `components/mobile/MobileErrorBoundary.tsx` | ⬜ pending | 2 | 0 | 0 | 0 | 0 | 0 |
| `components/navbar/SiteNavbar.tsx` | 🔧 in progress | 1 | 0 | 0 | 1 | 0 | 0 |
| `components/performance-arena/ChallengeCard.tsx` | 🔧 in progress | 2 | 0 | 0 | 0 | 0 | 0 |
| `components/pro-scalping-terminal/LayerPicker.tsx` | 🔧 in progress | 2 | 0 | 0 | 0 | 0 | 0 |
| `components/products/ProductBranding.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 2 |
| `components/signals/SignalAnalyticsDashboard.tsx` | 🔧 in progress | 2 | 0 | 0 | 0 | 0 | 0 |
| `components/tools/ToolUpgradeCTA.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 2 |
| `components/tradingview/TradingChart/ChartContextMenu.tsx` | ⬜ pending | 2 | 0 | 0 | 0 | 0 | 0 |
| `components/account/OrderFlowSettingsCard.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 0 | 0 |
| `components/admin/AdminShell.tsx` | ⬜ pending | 0 | 0 | 0 | 1 | 0 | 0 |
| `components/ai-trading-teams/agent-visual.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 1 |
| `components/ai-trading-teams/team-builder.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 1 |
| `components/ai-trading-teams/teams-workspace.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 1 |
| `components/dashboard/widgets.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 0 | 0 |
| `components/home/IntelligenceBar.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 0 | 0 |
| `components/layout/AppShell.tsx` | ⬜ pending | 0 | 0 | 0 | 1 | 0 | 0 |
| `components/market-intelligence/monitoring/MonitoringStatus.tsx` | 🔧 in progress | 1 | 0 | 0 | 0 | 0 | 0 |
| `components/performance-arena/ChallengeContextBar.tsx` | 🔧 in progress | 1 | 0 | 0 | 0 | 0 | 0 |
| `components/performance-arena/PartialCloseDialog.tsx` | 🔧 in progress | 1 | 0 | 0 | 0 | 0 | 0 |
| `components/product-analytics/ProValueGate.tsx` | ⬜ pending | 1 | 0 | 0 | 0 | 0 | 0 |
| `components/subscription/ProWidget.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 1 |
| `components/ui/dialog.tsx` | ⬜ pending | 0 | 0 | 0 | 1 | 0 | 0 |

**Shared UI library (`components/ui/*`) drift detail:**

| File | Status | Raw | 2xl/3xl | micro | blur | sh2xl | grad |
|---|---|---:|---:|---:|---:|---:|---:|
| `components/ui/avatar.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/badge.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/button.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/card.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/chart-container.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/data-table.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/dialog.tsx` | ⬜ pending | 0 | 0 | 0 | 1 | 0 | 0 |
| `components/ui/dropdown-menu.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/empty-state.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/error-state.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/form-field.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/form-section.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/input.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/loading-state.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/metric-card.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/page-header.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/section-header.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/select.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/separator.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/site-logo.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/status-badge.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/table.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/tabs.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/toggle-chip.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/toolbar.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/tooltip.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |


---

## 7. Remaining work (bounded follow-ups)

Ordered by impact, matching `DESIGN.md` §17 and the deferred list in `UI_UX_REDESIGN_AUDIT.md`:

1. **Raw colour families (5087).** The dominant remaining item. Highest-density live files:
   `app/trade-management/page.tsx` (178), `app/admin/telegram/page.tsx` (175),
   `components/strategy-lab/StrategyLabClient.tsx` (173), `app/signals/[id]/page.tsx` (143),
   `app/signals/pro/[id]/page.tsx` (141), `components/tradingview/PineWorkspace.tsx` (130).
   Map to `positive/negative/warning/info/destructive/primary` + `--chart-*` for categorical series.
2. **Radius `2xl`/`3xl` (47).** All in components — `components/home/*` (34, mostly dead code) and
   `components/guides/TourGuide.tsx` + `features/telegram-signals/*` (live). → `rounded-lg`.
3. **Micro text (6).** `features/telegram-signals/components/SignalCard.tsx` → `text-micro`.
4. **`shadow-2xl` on cards (36).** Remove; shadow only for floating overlays.
5. **`backdrop-blur` outside overlays (203).** Keep only scrims / sticky shell headers / drawers.
6. **Decorative gradients (126).** Remove gradient orbs/text/borders.
7. **Page-body `data-guide="page-header"` dedupe (~60 marketing pages).**
8. **`glass`/`glow`/`gemini-*` helper review** — not fully dead; per-usage review before removal.

## 8. Verification gates (definition of done per surface)

A surface is done only when: semantic tokens only; `font-numeric` right-aligned signed numbers; one
radius system; no banned decoration; loading/empty/error/(stale/offline) states honest; dark+light,
mobile+desktop; keyboard reachable with visible focus; **no change to trading/payment/auth/data logic**.

## 9. Dead-code appendix (not live surfaces)

These files are referenced nowhere and were built/left from earlier direction. They are **not** in-scope
for the live redesign; they exist only as cleanup candidates.

- `components/home/*` unreferenced (refs=0): `AIIntelligenceSection`, `AIOptimizationSection`,
  `BacktestingSection`, `CopilotSection`, `CopyTradingSection`, `ExecutionGatewaySection`,
  `FinalCTASection`, `GatewaySection`, `HeroSection`, `IntelligenceBar`, `LifecycleSection`,
  `LiveMonitoringSection`, `MarketReplaySection`, `MarketScannerSection`, `MarketplaceSection`,
  `PineWorkspaceSection`, `ReplaySection`, `RiskEngineSection`, `SignalRiskSection`,
  `StrategyIntelligenceSection`, `TelegramPipelineSection`.
- Live `components/home/*`: `HomePage`, `site-header`, `Reveal`, `CountUp`, `TickerStrip`,
  `HeroConsoleChart`, `EvidenceAnalytics`, `EcosystemSection`, `BrandLogos`.

## 10. Change log

| Date | Entry | Note |
|---|---|---|
| 2026-10-10 | AUDIT-001 | Initial inventory generated from repository: 253 routes, 285 components, 19 layouts. Baseline captured. |
