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

## 3. Global scoreboard (measured after latest pass)

| Signal | Routes (253 files) | Components (281 files) | Total | Target |
|---|---:|---:|---:|---|
| Raw colour family | 1547 | 1571 | **3118** | 0 on live, in-scope surfaces |
| Radius `2xl`/`3xl` | 0 | 3* | **3** | 0 on app surfaces |
| Micro text `[9-11px]` | 0 | 0 | **0** | 0 |
| `backdrop-blur` | 85 | 48 | **133** | overlays/drawers only |
| `shadow-2xl` | 17 | 4 | **21** | 0 on cards |
| Gradient | 39 | 28 | **67** | 0 decorative |

*Component `rounded-2xl` count includes 2 DOM-selector strings in `components/guides/TourGuide.tsx`
(lines 33, 137–138) which are not rendered classNames; the single real className (line 423) was
converted to `rounded-lg`.

Route files: **163 clean**, **90 carrying drift**. Component files: **177 clean**, **104 carrying drift**
(of which a large share are dead code — see §9).

---

## 4. Route inventory (App Router, 253 pages)

URLs are the resolved paths; `[param]` marks dynamic segments.

### 4.1 Summary by area

| Area | Routes | Raw colour | Radius 2xl/3xl | Micro text | Blur | shadow-2xl | Gradient |
|---|---:|---:|---:|---:|---:|---:|---:|
| `(root)` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `account` | 390 | 372 | 0 | 0 | 14 | 2 | 2 |
| `account-health` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `admin` | 230 | 200 | 0 | 0 | 13 | 8 | 9 |
| `advanced-analysis` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `affiliates` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `agent` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `ai-copilot` | 10 | 10 | 0 | 0 | 0 | 0 | 0 |
| `ai-historical` | 17 | 17 | 0 | 0 | 0 | 0 | 0 |
| `ai-trading-teams` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `alert` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `alert-center` | 45 | 45 | 0 | 0 | 0 | 0 | 0 |
| `alerts` | 142 | 140 | 0 | 0 | 1 | 1 | 0 |
| `backtests` | 121 | 103 | 0 | 0 | 13 | 0 | 5 |
| `broker-compare` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `compare` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `copy-trading` | 101 | 97 | 0 | 0 | 1 | 1 | 2 |
| `correlation` | 22 | 22 | 0 | 0 | 0 | 0 | 0 |
| `cross-asset` | 8 | 8 | 0 | 0 | 0 | 0 | 0 |
| `dashboard` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `dev-widget-preview` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `developer` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `docs` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `donate` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `economic-calendar` | 20 | 19 | 0 | 0 | 1 | 0 | 0 |
| `equity-curve` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `execution-analytics` | 14 | 14 | 0 | 0 | 0 | 0 | 0 |
| `goals` | 66 | 61 | 0 | 0 | 1 | 1 | 3 |
| `insights` | 19 | 19 | 0 | 0 | 0 | 0 | 0 |
| `journal` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `live` | 2 | 0 | 0 | 0 | 1 | 0 | 1 |
| `live-performance` | 16 | 3 | 0 | 0 | 9 | 0 | 4 |
| `login` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `market-intelligence` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `marketplace` | 7 | 0 | 0 | 0 | 0 | 0 | 7 |
| `mobile` | 16 | 8 | 0 | 0 | 8 | 0 | 0 |
| `monte-carlo` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `news` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `performance-arena` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `portfolio` | 25 | 25 | 0 | 0 | 0 | 0 | 0 |
| `position` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `pricing` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `privacy` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `refunds` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `register` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `report-generator` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `research` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `risk` | 31 | 31 | 0 | 0 | 0 | 0 | 0 |
| `scalping-terminal` | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| `scanner` | 25 | 25 | 0 | 0 | 0 | 0 | 0 |
| `setup` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `signal-transparency` | 18 | 18 | 0 | 0 | 0 | 0 | 0 |
| `signals` | 16 | 0 | 0 | 0 | 15 | 0 | 1 |
| `social` | 2 | 0 | 0 | 0 | 1 | 1 | 0 |
| `spreads` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `statement` | 32 | 32 | 0 | 0 | 0 | 0 | 0 |
| `store` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `strategy` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `strategy-compare` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `strategy-lab` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `strategy-research` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `tags` | 16 | 16 | 0 | 0 | 0 | 0 | 0 |
| `terminal` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `terms` | 4 | 4 | 0 | 0 | 0 | 0 | 0 |
| `tools` | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| `trade-journal` | 11 | 11 | 0 | 0 | 0 | 0 | 0 |
| `trade-management` | 186 | 178 | 0 | 0 | 4 | 3 | 1 |
| `trade-replay` | 71 | 68 | 0 | 0 | 2 | 0 | 1 |
| `trading` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `trust-methodology` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `verified-performance` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `walk-forward` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `workflows` | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| **Total** | 1688 | 1547 | 0 | 0 | 85 | 17 | 39 |


### 4.2 Routes still carrying drift (action list)

### Routes still carrying drift (action list)

| Route | Source file | Status | Raw | 2xl/3xl | micro | blur | sh2xl | grad |
|---|---|---|---:|---:|---:|---:|---:|---:|
| `/trade-management` | `app/trade-management/page.tsx` | 🔧 in progress | 178 | 0 | 0 | 4 | 3 | 1 |
| `/backtests` | `app/backtests/page.tsx` | 🔧 in progress | 103 | 0 | 0 | 13 | 0 | 5 |
| `/copy-trading` | `app/copy-trading/page.tsx` | 🔧 in progress | 97 | 0 | 0 | 1 | 1 | 2 |
| `/account/tools` | `app/account/tools/page.tsx` | 🔧 in progress | 83 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/agents/create` | `app/admin/intelligence/agents/create/page.tsx` | 🔧 in progress | 68 | 0 | 0 | 0 | 0 | 7 |
| `/trade-replay` | `app/trade-replay/page.tsx` | 🔧 in progress | 68 | 0 | 0 | 2 | 0 | 1 |
| `/alerts/history` | `app/alerts/history/page.tsx` | 🔧 in progress | 66 | 0 | 0 | 0 | 0 | 0 |
| `/goals` | `app/goals/page.tsx` | 🔧 in progress | 61 | 0 | 0 | 1 | 1 | 3 |
| `/alerts/tools` | `app/alerts/tools/page.tsx` | 🔧 in progress | 47 | 0 | 0 | 0 | 0 | 0 |
| `/alert-center` | `app/alert-center/page.tsx` | 🔧 in progress | 45 | 0 | 0 | 0 | 0 | 0 |
| `/account/setfiles` | `app/account/setfiles/page.tsx` | 🔧 in progress | 35 | 0 | 0 | 0 | 0 | 0 |
| `/statement` | `app/statement/page.tsx` | 🔧 in progress | 32 | 0 | 0 | 0 | 0 | 0 |
| `/risk` | `app/risk/page.tsx` | 🔧 in progress | 31 | 0 | 0 | 0 | 0 | 0 |
| `/account/trading-access` | `app/account/trading-access/page.tsx` | 🔧 in progress | 30 | 0 | 0 | 0 | 0 | 0 |
| `/alerts` | `app/alerts/page.tsx` | 🔧 in progress | 27 | 0 | 0 | 1 | 1 | 0 |
| `/account/subscribe` | `app/account/subscribe/page.tsx` | 🔧 in progress | 27 | 0 | 0 | 0 | 0 | 1 |
| `/account/plugins/[id]` | `app/account/plugins/[id]/page.tsx` | 🔧 in progress | 27 | 0 | 0 | 0 | 0 | 0 |
| `/admin/plugins/ai-studio` | `app/admin/plugins/ai-studio/page.tsx` | 🔧 in progress | 27 | 0 | 0 | 0 | 0 | 0 |
| `/account/market-intelligence` | `app/account/market-intelligence/page.tsx` | 🔧 in progress | 15 | 0 | 0 | 10 | 0 | 0 |
| `/portfolio` | `app/portfolio/page.tsx` | 🔧 in progress | 25 | 0 | 0 | 0 | 0 | 0 |
| `/scanner` | `app/scanner/page.tsx` | 🔧 in progress | 25 | 0 | 0 | 0 | 0 | 0 |
| `/account/affiliate` | `app/account/affiliate/page.tsx` | 🔧 in progress | 23 | 0 | 0 | 0 | 0 | 0 |
| `/account/copy-trading` | `app/account/copy-trading/page.tsx` | 🔧 in progress | 22 | 0 | 0 | 0 | 0 | 0 |
| `/correlation` | `app/correlation/page.tsx` | 🔧 in progress | 22 | 0 | 0 | 0 | 0 | 0 |
| `/admin/plugins/[id]` | `app/admin/plugins/[id]/page.tsx` | 🔧 in progress | 21 | 0 | 0 | 0 | 0 | 0 |
| `/economic-calendar` | `app/economic-calendar/page.tsx` | 🔧 in progress | 19 | 0 | 0 | 1 | 0 | 0 |
| `/insights` | `app/insights/page.tsx` | 🔧 in progress | 19 | 0 | 0 | 0 | 0 | 0 |
| `/signal-transparency` | `app/signal-transparency/page.tsx` | ⬜ pending | 18 | 0 | 0 | 0 | 0 | 0 |
| `/account/live` | `app/account/live/page.tsx` | 🔧 in progress | 16 | 0 | 0 | 1 | 0 | 0 |
| `/account/pro-trading-extension` | `app/account/pro-trading-extension/page.tsx` | 🔧 in progress | 16 | 0 | 0 | 0 | 0 | 1 |
| `/account/workflows` | `app/account/workflows/page.tsx` | 🔧 in progress | 17 | 0 | 0 | 0 | 0 | 0 |
| `/ai-historical` | `app/ai-historical/page.tsx` | ⬜ pending | 17 | 0 | 0 | 0 | 0 | 0 |
| `/account/plugins` | `app/account/plugins/page.tsx` | 🔧 in progress | 16 | 0 | 0 | 0 | 0 | 0 |
| `/live-performance` | `app/live-performance/page.tsx` | 🔧 in progress | 3 | 0 | 0 | 9 | 0 | 4 |
| `/tags` | `app/tags/page.tsx` | 🔧 in progress | 16 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/account-health` | `app/admin/intelligence/account-health/page.tsx` | 🔧 in progress | 15 | 0 | 0 | 0 | 0 | 0 |
| `/account/trading` | `app/account/trading/page.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `/admin/plugins` | `app/admin/plugins/page.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `/execution-analytics` | `app/execution-analytics/page.tsx` | 🔧 in progress | 14 | 0 | 0 | 0 | 0 | 0 |
| `/signals/stats` | `app/signals/stats/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 11 | 0 | 1 |
| `/trade-journal` | `app/trade-journal/page.tsx` | 🔧 in progress | 11 | 0 | 0 | 0 | 0 | 0 |
| `/ai-copilot` | `app/ai-copilot/page.tsx` | 🔧 in progress | 10 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/agents` | `app/admin/intelligence/agents/page.tsx` | 🔧 in progress | 9 | 0 | 0 | 0 | 0 | 0 |
| `/account/bots/[botId]` | `app/account/bots/[botId]/page.tsx` | 🔧 in progress | 8 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/executions` | `app/admin/intelligence/executions/page.tsx` | 🔧 in progress | 8 | 0 | 0 | 0 | 0 | 0 |
| `/cross-asset` | `app/cross-asset/page.tsx` | 🔧 in progress | 8 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/sandbox` | `app/admin/intelligence/sandbox/page.tsx` | 🔧 in progress | 7 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/workflows` | `app/admin/intelligence/workflows/page.tsx` | 🔧 in progress | 7 | 0 | 0 | 0 | 0 | 0 |
| `/account/agents` | `app/account/agents/page.tsx` | 🔧 in progress | 6 | 0 | 0 | 0 | 0 | 0 |
| `/admin/plugins/create` | `app/admin/plugins/create/page.tsx` | 🔧 in progress | 6 | 0 | 0 | 0 | 0 | 0 |
| `/admin/telegram` | `app/admin/telegram/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 3 | 3 | 0 |
| `/admin/intelligence` | `app/admin/intelligence/page.tsx` | 🔧 in progress | 5 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/plugins` | `app/admin/intelligence/plugins/page.tsx` | 🔧 in progress | 5 | 0 | 0 | 0 | 0 | 0 |
| `/account/performance-arena/leaderboard` | `app/account/performance-arena/leaderboard/page.tsx` | 🔧 in progress | 4 | 0 | 0 | 0 | 0 | 0 |
| `/account/settings` | `app/account/settings/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 2 | 2 | 0 |
| `/admin/intelligence/agents/[agentId]` | `app/admin/intelligence/agents/[agentId]/page.tsx` | 🔧 in progress | 4 | 0 | 0 | 0 | 0 | 0 |
| `/admin/intelligence/extensions` | `app/admin/intelligence/extensions/page.tsx` | 🔧 in progress | 4 | 0 | 0 | 0 | 0 | 0 |
| `/admin/signals` | `app/admin/signals/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 2 | 1 | 1 |
| `/mobile/account` | `app/mobile/account/page.tsx` | 🔧 in progress | 2 | 0 | 0 | 2 | 0 | 0 |
| `/mobile/bots` | `app/mobile/bots/page.tsx` | 🔧 in progress | 2 | 0 | 0 | 2 | 0 | 0 |
| `/mobile/signals` | `app/mobile/signals/page.tsx` | 🔧 in progress | 2 | 0 | 0 | 2 | 0 | 0 |
| `/signals/history` | `app/signals/history/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 4 | 0 | 0 |
| `/terms` | `app/terms/page.tsx` | ⬜ pending | 4 | 0 | 0 | 0 | 0 | 0 |
| `/account/performance-arena/attempts/verify` | `app/account/performance-arena/attempts/verify/page.tsx` | ⬜ pending | 3 | 0 | 0 | 0 | 0 | 0 |
| `/account/performance-arena/profile` | `app/account/performance-arena/profile/page.tsx` | 🔧 in progress | 3 | 0 | 0 | 0 | 0 | 0 |
| `/admin/bots` | `app/admin/bots/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 2 | 0 | 1 |
| `/account/performance-arena/attempts/[attemptId]` | `app/account/performance-arena/attempts/[attemptId]/page.tsx` | 🔧 in progress | 2 | 0 | 0 | 0 | 0 | 0 |
| `/account/performance-arena/challenges/[definitionId]` | `app/account/performance-arena/challenges/[definitionId]/page.tsx` | ⬜ pending | 2 | 0 | 0 | 0 | 0 | 0 |
| `/account/performance-arena` | `app/account/performance-arena/page.tsx` | ⬜ pending | 2 | 0 | 0 | 0 | 0 | 0 |
| `/admin/affiliates` | `app/admin/affiliates/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 1 | 0 |
| `/admin/backtests` | `app/admin/backtests/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 1 | 0 |
| `/admin/growth/approvals` | `app/admin/growth/approvals/page.tsx` | ⬜ pending | 0 | 0 | 0 | 2 | 0 | 0 |
| `/admin/setfiles` | `app/admin/setfiles/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 1 | 0 |
| `/live` | `app/live/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 0 | 1 |
| `/marketplace/[slug]` | `app/marketplace/[slug]/page.tsx` | ⬜ pending | 0 | 0 | 0 | 0 | 0 | 2 |
| `/marketplace/extensions/[slug]` | `app/marketplace/extensions/[slug]/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 2 |
| `/marketplace/plugins/[slug]` | `app/marketplace/plugins/[slug]/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 2 |
| `/mobile/market-context` | `app/mobile/market-context/page.tsx` | 🔧 in progress | 2 | 0 | 0 | 0 | 0 | 0 |
| `/mobile/markets` | `app/mobile/markets/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 2 | 0 | 0 |
| `/social` | `app/social/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 1 | 0 |
| `/account-health` | `app/account-health/page.tsx` | 🔧 in progress | 1 | 0 | 0 | 0 | 0 | 0 |
| `/account/bots` | `app/account/bots/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 0 | 0 |
| `/account/scalping-terminal` | `app/account/scalping-terminal/page.tsx` | 🔧 in progress | 1 | 0 | 0 | 0 | 0 | 0 |
| `/admin/licenses` | `app/admin/licenses/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 0 | 0 |
| `/admin/workflows` | `app/admin/workflows/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 1 | 0 |
| `/marketplace` | `app/marketplace/page.tsx` | ⬜ pending | 0 | 0 | 0 | 0 | 0 | 1 |
| `/scalping-terminal` | `app/scalping-terminal/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 1 | 0 | 0 |
| `/tools` | `app/tools/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 1 |
| `/workflows/[workflowId]` | `app/workflows/[workflowId]/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 1 |
| `/workflows` | `app/workflows/page.tsx` | 🔧 in progress | 0 | 0 | 0 | 0 | 0 | 1 |

### 4.3 Verified drift-free routes

(163)

`/account/account-health`, `/account/ai-execution`, `/account/ai-trading-teams`, `/account/analysis`, `/account/candels/[candelId]`, `/account/candels/activity`, `/account/candels/approvals`, `/account/candels/automations`, `/account/candels/builder`, `/account/candels/jobs`, `/account/candels/memory`, `/account/candels`, `/account/candels/proposals`, `/account/candels/tool-calls`, `/account/candels/workspace`, `/account/dashboard`, `/account/licenses`, `/account/lite-scalping-terminal`, `/account/livemap`, `/account`, `/account/purchases`, `/account/scalping-terminal-lite`, `/account/terminal`, `/account/tradingview`, `/admin/ai-agents`, `/admin/ai-trading-teams`, `/admin/ai/monitor`, `/admin/analysis`, `/admin/bots/[id]/edit`, `/admin/bots/new`, `/admin/business-events`, `/admin/business-operations/financial`, `/admin/business-operations/licenses`, `/admin/business-operations/orders`, `/admin/business-operations`, `/admin/business-operations/payments`, `/admin/copy-trading`, `/admin/developers`, `/admin/erpnext`, `/admin/extensions`, `/admin/growth/campaigns/[id]`, `/admin/growth/campaigns`, `/admin/growth/channels`, `/admin/growth/command-center`, `/admin/growth/content`, `/admin/growth/experiments`, `/admin/growth/loop`, `/admin/growth/marketing-agent`, `/admin/growth/opportunities`, `/admin/growth`, `/admin/growth/reports`, `/admin/growth/studio`, `/admin/growth/workflows`, `/admin/intelligence-cloud`, `/admin/intelligence/ai-health`, `/admin/intelligence/ai-usage`, `/admin/intelligence/studio`, `/admin/live`, `/admin/livemap`, `/admin/monetization/ad-networks`, `/admin/monetization/ads`, `/admin/monetization/affiliate`, `/admin/monetization`, `/admin/monetization/placements`, `/admin/monetization/revenue`, `/admin/monetization/settings`, `/admin/orders`, `/admin`, `/admin/performance-arena`, `/admin/reviews`, `/admin/scalping`, `/admin/settings`, `/admin/strategy-research`, `/admin/trading-accounts`, `/admin/trading-licenses`, `/admin/trading-providers`, `/admin/tradingview`, `/admin/users/[uid]`, `/admin/users`, `/admin/whitelabel`, `/advanced-analysis`, `/affiliates`, `/agent`, `/ai-trading-teams/[teamId]`, `/ai-trading-teams`, `/alert/[alertId]`, `/broker-compare`, `/compare`, `/dashboard`, `/dev-widget-preview`, `/developer/dashboard`, `/developer/intelligence-cloud`, `/developer/subscription`, `/docs/[slug]`, `/docs`, `/donate`, `/donate/success`, `/equity-curve`, `/journal/[entryId]`, `/login`, `/market-intelligence/advanced`, `/market-intelligence/analysis`, `/market-intelligence/backtest`, `/market-intelligence/evidence`, `/market-intelligence/investigation`, `/market-intelligence/knowledge`, `/market-intelligence/oos`, `/market-intelligence`, `/market-intelligence/patterns`, `/market-intelligence/research`, `/market-intelligence/scalping`, `/market-intelligence/smart-money`, `/market-intelligence/strategy-lab`, `/market-intelligence/terminal`, `/marketplace/extensions`, `/marketplace/plugins`, `/marketplace/strategy-certification`, `/mobile/home`, `/mobile/intelligence`, `/mobile`, `/monte-carlo`, `/news`, `/`, `/performance-arena/attempts/[attemptId]`, `/performance-arena/challenges/[definitionId]`, `/performance-arena/leaderboard`, `/performance-arena`, `/performance-arena/profile`, `/portfolio/intelligence`, `/position/[positionId]`, `/pricing`, `/privacy`, `/refunds`, `/register`, `/report-generator`, `/research/[researchId]`, `/setup/[setupId]`, `/signals/[id]`, `/signals`, `/signals/pro/[id]`, `/signals/pro`, `/spreads`, `/store/[accountId]`, `/strategy-compare`, `/strategy-lab`, `/strategy-research/[missionId]/[candidateId]`, `/strategy-research`, `/strategy/[strategyId]`, `/terminal/[symbol]`, `/tools/broker-fees`, `/tools/calculators`, `/tools/correlation`, `/tools/currency-strength`, `/tools/drawdown-calculator`, `/tools/fibonacci`, `/tools/overlap`, `/tools/pip-reference`, `/tools/risk-of-ruin`, `/tools/sessions`, `/trading`, `/trust-methodology`, `/verified-performance`, `/walk-forward`

---

## 5. Layouts & shells

All route-group layouts are clean. Shell components are clean except permitted overlay blur.

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

(`components/ui/*`) drift detail:**

| File | Status | Raw | 2xl/3xl | micro | blur | sh2xl | grad |
|---|---|---:|---:|---:|---:|---:|---:|
| `components/ui/avatar.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/badge.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/button.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/card.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/chart-container.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/data-table.tsx` | ✅ clean | 0 | 0 | 0 | 0 | 0 | 0 |
| `components/ui/dialog.tsx` | ▫ allowed overlay blur | 0 | 0 | 0 | 1 | 0 | 0 |
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

1. **Raw colour families (3118).** The dominant remaining item. Highest-density live files:
   `app/trade-management/page.tsx` (178), `components/strategy-lab/StrategyLabClient.tsx` (173),
   `app/admin/intelligence/studio/studio-client.tsx` (153), `app/backtests/page.tsx` (103),
   `app/copy-trading/page.tsx` (97), `app/trade-replay/page.tsx` (68),
   `app/admin/intelligence/agents/create/page.tsx` (68), `app/alerts/history/page.tsx` (66).
   Map to `positive/negative/warning/info/destructive/primary` + `--chart-*` for categorical series.
2. **Radius `2xl`/`3xl` (3).** DOM-selector strings in `components/guides/TourGuide.tsx` (not rendered).
   Real app surfaces are clear.
3. **Micro text (0).** Completed — `features/telegram-signals/components/SignalCard.tsx` migrated to `text-micro`.
4. **`shadow-2xl` on cards (21).** Remove; shadow only for floating overlays.
5. **`backdrop-blur` outside overlays (133).** Keep only scrims / sticky shell headers / drawers.
6. **Decorative gradients (67).** Remove gradient orbs/text/borders.
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
| 2026-10-10 | AUDIT-002 | Completed live micro-text + radius sweep: `features/telegram-signals/components/SignalCard.tsx` migrated to semantic tokens + `text-micro` + `font-numeric`; `ConflictBanner.tsx`, `AnalyticsView.tsx`, `RealtimeFeed.tsx` migrated to tokens + `rounded-lg`; `components/guides/TourGuide.tsx` tooltip card → `rounded-lg` + semantic tokens. Typecheck 0, lint 0 on edited files. |
