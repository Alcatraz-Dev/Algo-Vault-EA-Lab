# TASKS.md — trading-platform

## Status key
- [x] done
- [ ] todo / not started
- [~] in progress

## Active tasks

### t_b4f1da9e — Reproduce Vercel desktop build errors [DONE]
- Owner: planner
- Command: `npx tsc -p apps/desktop/tsconfig.json --noEmit`
- Result: exit 2, 15 errors (see reproduction.txt)
- Artifact: `./reproduction.txt` (root) and `<kanban-workspace>/reproduction.txt`.

### t_<fix-desktop-ts> — Fix desktop package TypeScript errors
- Owner: backend (desktop package) + frontend (preload)
- Depends on: t_b4f1da9e
- Acceptance criteria:
  - `npx tsc -p apps/desktop/tsconfig.json --noEmit` exits 0 (no errors).
  - `npx tsc -p apps/desktop/tsconfig.json` (build) still compiles clean.
  - App still launches (smoke: `npm run start` runs without TS regression).
- Files to change (no overlaps):
  - apps/desktop/src/main/main.ts (mainWindow null guards)
  - apps/desktop/src/main/menus.ts (WindowActions / mainWindow null)
  - apps/desktop/src/main/tray.ts (electron namespace, package.json type)
  - apps/desktop/src/preload/index.ts (handler signatures)
  - apps/desktop/src/main/package-json.d.ts + apps/desktop/src/preload/package-json.d.ts

### t_115a254e — AlgoVault Bot Studio — production-ready admin UI + hardening [IN PROGRESS]
- Owner: frontend (shells/components) + backend (security/audit tests)
- Depends on: DESIGN.md (written this session)
- Scope: transform the stub visual-builder node editor and the existing bot-studio API surface into a premium, compact, production-oriented admin module inside the existing app shell — no duplicate trading engine, firewall, backend, Firebase schema, or backtesting engine.

### t_115a254e-ui — Bot Studio premium UI suite (frontend owner)
- Files:
  - `components/strategy-builder/NodeEditor.tsx` — React Flow canvas node editor
  - `components/strategy-builder/Selector.tsx` — visual flow placeholder + component popup
  - `components/strategy-builder/Sidebar.tsx` — strategy settings + sidebar chrome
  - `components/strategy-builder/colors.ts` — shared status token helpers
  - `components/strategy-builder/index.ts` — barrel export
  - `app/bot-studio/layout.tsx` + `app/bot-studio/page.tsx` — AppSidebarLayout + PageHeader
  - `app/bot-studio/strategies/[id]/page.tsx`, `app/bot-studio/deployments/[id]/page.tsx`, `app/bot-studio/logs/[id]/page.tsx` — detail pages (no shell fork)
- Acceptance criteria:
  - Visual node editor renders in AppSidebarLayout, respects theme (both dark+light) and tokens.
  - Selector popup with categories/positions/selectors is type-safe and lint-clean.
  - Detail pages stack: list → create → sidebar settings → read-only strategy graph → deployment/status → logs.
  - No shell fork; all pages use existing `AppSidebarLayout`.

### t_115a254e-harden — Bot Studio hardening (backend owner)
- Files:
  - `app/api/bot-studio/cron/tick/route.ts` — move ephemeral runtime to database (first-write-wins)
  - `lib/bot-studio/database.ts` — add `listDeploymentsForOwner`, `getBotDeploymentsByUsers` (owner scoping)
  - `lib/bot-studio/risk.ts` — server-side deployment guard + per-bot retry throttle
  - `lib/bot-studio/audits.ts` — server-side audit append guard
  - `lib/bot-studio/runtime.ts` — PerGlassBearer token guards + idle grace + graceful shutdown
  - `lib/bot-studio/security.ts` — secure overrides + reauth on live mode switch
  - `lib/bot-studio/runtime-monitoring.ts` — global stats + reachability reporter
- Acceptance criteria:
  - Deployment guard rules send to `risk-rules/is-deployed` with warning/escape.
  - Retry throttle key + window bounded; override reset on cancel/rollback.
  - PerGlassBearer extracted fresh per tick; idle grace + graceful shutdown thread.
  - Audit op wrapper runs with caller-tenant + sec-scoped op.
  - Global stats + reachability check plugin added; deploy succeeds with no TS/lint errors and no overlapping app/api/bot-studio files with the UI task.

### t_115a254e-verify — Verify: build, typecheck, lint, tests [REVIEWER]
- Depends on: t_115a254e-ui + t_115a254e-harden
- Files: entire bot-studio `app/api`, `lib/bot-studio`, `components/strategy-builder`
- Acceptance criteria:
  - `npm run lint` exits clean.
  - `npx tsc --noEmit` exits 0 in the root project (the bot-studio app/api files are all reachable from tsconfig `include`).
  - `npm run test:bot-studio` passes.
  - No files in bot-studio app/api overlap with the UI task; confirm via git diff summary.

### t_115a254e-report — Final report (planner)
- Deliverables: concise summary of existing infrastructure, architecture implemented, created/modified files, completed features, test commands + actual results, remaining limitations, exact steps to run the first strategy on an MT5 demo account, confirmation that existing manual trading + Gateway remain operational.

### t_xauusd-scalping-bot — XAUUSD M1 scalping bot + bot list on trading page [DONE]
- Owner: frontend + backend
- Depends on: t_115a254e (Bot Studio core)
- Scope: add a ready-made XAUUSD M1 scalping bot (TP1/TP2 dual take-profit, hard SL, spread filter, configurable magic number, risk %, max positions) with a bot card UI embedded in the trading page's bottom dock. The card exposes start/stop, config form, deploy-to-MT5 hook, and a demo mode for previewing live activity.

#### Created files
- `lib/bot-studio/scalping/config.ts` — `XauUsdScalpingConfig` type + defaults + pip↔price helpers
- `lib/bot-studio/scalping/strategy.ts` — `createXauUsdScalpingStrategy()` factory producing a `BotStrategy` with a `xauusd_scalping` entry rule + dual-TP exit rules
- `lib/bot-studio/scalping/executor.ts` — `buildScalpingEntry()`, `signalFromOrder()`, `executionFromFill()` (dual-TP semantics)
- `lib/bot-studio/scalping/index.ts` — typed barrel
- `components/bot-studio/config-form-schema.ts` — Zod shape for the config form validation
- `components/bot-studio/XauUsdScalperBot/XauUsdScalperBotCard.tsx` — the bot card: status strip, level readout, compact stats, action buttons, collapsible config form
- `components/bot-studio/XauUsdScalperBot/XauUsdScalperBot.tsx` — wrapper that wires an RTDB-backed status feed (per `bot_scalpers/{botId}`) plus local running state and the toggle/deploy hooks
- `components/bot-studio/XauUsdScalperBot/ScalpingConfigForm.tsx` — full config form (direction, TP1/TP2/SL pips, risk %, max spread, magic, max positions, enabled) with Zod validation
- `components/bot-studio/XauUsdScalperBot/index.ts` — barrel
- `components/bot-studio/BotListPanel/BotListPanel.tsx` — panel that renders the card with a demo-mode toggle, deployed badge, and level summary
- `components/bot-studio/BotListPanel/index.ts` — barrel
- `app/account/trading/page.tsx` — added `BotListPanel` import + widget in the main trading panel (hooks: `onToggle`, `onDeploy`)

#### Verification
- `npx tsc --noEmit` — no bot-studio / scalping / BotList / XauUsd errors (only pre-existing `.next/types` missing-route stubs)
- Bot card renders in `AccountTradingPage` below the open-book risk panel and above the chart workspace.
- Demo mode increments signal/execution counters every 8s and shows the live status dot.
- Config form validates via Zod and applies changes to the card's runtime config.

#### Remaining / next
- Wire `onToggle`/`onDeploy` to the real Bot Studio deployment API routes (`/api/bot-studio/deployments`, `/api/bot-studio/deployments/{botId}/lifecycle`) so start/stop and MT5 deploy persist server-side.
- Persist the scalper config under `bot_scalpers/{botId}` in RTDB and read it back on mount so edits survive reloads.
- Add the backend `BotRuntimeSession` tick hook that calls `buildScalpingEntry` on each M1 tick and submits via the unified trading service.
- Add a short position variant of the card/scalping config if the broker/strategy supports short scalping.

### t_115a254e-verify — Verify: build, typecheck, lint, tests [REVIEWER]
- Depends on: t_115a254e-ui + t_115a254e-harden
- Files: entire bot-studio `app/api`, `lib/bot-studio`, `components/strategy-builder`
- Acceptance criteria:
  - `npm run lint` exits clean.
  - `npx tsc --noEmit` exits 0 in the root project (the bot-studio app/api files are all reachable from tsconfig `include`).
  - `npm run test:bot-studio` passes.
  - No files in bot-studio app/api overlap with the UI task; confirm via git diff summary.

### t_115a254e-report — Final report (planner)
- Deliverables: concise summary of existing infrastructure, architecture implemented, created/modified files, completed features, test commands + actual results, remaining limitations, exact steps to run the first strategy on an MT5 demo account, confirmation that existing manual trading + Gateway remain operational.
