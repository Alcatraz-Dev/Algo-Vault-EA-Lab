# AlgoVault × OpenDots Integration — Phase 1 Complete Audit

**Generated:** 2026-10-07
**Owner:** Haythem Dhahri
**Status:** ✅ Phase 1 (Audit) complete → **Phase 2 (Architecture) starting**

---

## 1. Scope

Reused: OpenDots MIT-licensed workspace capabilities (Spaces/Pages/Conversations, specialist agents, MCP tools, human-in-the-loop approvals, background work, memory, per-agent permissions, AG-UI/Router). Transformed into AlgoVault-native subsystem under the product name **Candel** (Dots renamed), scoped to authenticated AlgoVault users with trading specialization layers.

**NOT built:** a separate AI agent app, second workspace, second sidebar, duplicate trading-account DB, or new trading execution engine.

---

## 2. AlgoVault Foundation (existing, audited)

| Domain | Canonical location | Notes |
|---|---|---|
| Auth | Firebase Auth + `lib/admin-auth.ts` (`requireAdmin`, `authenticate`, `requireAdminOrProductOwner`) | idToken→uid, custom claims `admin`/`role` |
| Database | RTDB ONLY — `database.rules.json`, `firebase.json`, `.firebaserc` | **No Firestore** |
| AI Router | `lib/ai/router.ts` — `AIRouter` + `defaultRouter` | Gemini → OpenRouter → OpenCode → B.AI → Bytez → CodeCraft → local heuristic. `AI_FREE_ONLY` default guard. |
| Agentic TI | `lib/agentic-trading-intelligence/` | contracts, tool-registry, agent-runtime, fail-closed, approval, orchestrator, observability, journal |
| Multi-Agent | `lib/agents/` — catalog, orchestrator, workflow-engine, permissions, database (RTDB) | Built-in agents; admin-registered |
| Market Intelligence | `lib/market-core/` (Phase 3) | Deterministic smart money engine: BOS/CHOCH, FVG, order blocks, liquidity, indicators, context |
| Strategy Lab | `lib/strategy-lab/` | Backtest engine, EA Lab, walk-forward, Monte Carlo, execution, marketplace |
| Risk | `lib/risk/` | Position sizing, risk checks, account state |
| TradingView | `lib/market-data/tradingview-live.ts` + `app/api/tradingview/workspaces/route.ts` | Webhook with `TRADINGVIEW_WEBHOOK_SECRET` |
| Performance Arena | `lib/performance-arena/` | Pro-gated virtual-capital challenges, guardian, awards |
| Execution | `lib/ai-execution/gate.ts` (fail-closed 8-stage chain) + gateway (`lib/gateway.ts`, MQL5) | `trading_execution_requests` RTDB |
| Subscription/Pro | Stripe + `lib/subscription.ts`, `lib/subscription-server.ts`, `/admin/monetization` | Free vs Pro gates; admin-controlled feature flags |
| Sidebar | `components/layout/AppShell.tsx` + `app-nav.ts`; Admin: `admin-nav.ts` + `AdminShell.tsx` + `AdminGuard` | Grouped nav, mobile drawer, search |
| Test runners | `scripts/jiti-tsrun.mjs` (custom, NOT vitest) | 30+ `npm run test:*` suites |

**Verification baseline (2026-10-07):** `npx tsc --noEmit` = 163 pre-existing errors (0 in new files), `npm run lint` = 906 problems (294 errors / 612 warnings), `npm run build` exit 0, all suites green (market-core 57/57, chart-engine 68/68, research 143/143, agent-ide 104/104, cross-asset 218/218, arena 13 suites 100%, terminal 335, mobile 140, intelligence 73, intelligence-cloud 70, agents, risk, telegram signals, strategy-lab, workflows, portfolio, etc.).

---

## 3. OpenDots Architecture (reference — NOT copied blindly)

| Capability | OpenDots implementation | Algorithmic mapping into AlgoVault |
|---|---|---|
| Spaces | SQLite `spaces` table + route POST /spaces | ✅ Reuse schema + RTDB binding |
| Dots | `dots` table, per-dot instructions, `researchAllowed`/`memoryAllowed` | → Candels (renamed, user-controlled) |
| Conversations | `thread_bindings` table, AG-UI thread model | → Candel conversations (RTDB-scoped) |
| Pages | `pages` store, Markdown content + auto-save | → Workspace pages (native rendering) |
| Specialist agents | `DotAgent` class (extends AG-UI `AbstractAgent`), `runThreadTurn` | → Trading Candels with trading tools |
| Computers | `ComputerService` (browser/files/shell), OpenBot supervisor | ✅ Reuse, but server-side, isolated credentials |
| MCP connections | `ConnectionStore` (SQLite), approval-gated tools | Reuse; RTDB-persisted; per-user |
| Human-in-the-loop | `connectionActionTool` + approval store (`mcp_approvals`) | ✅ Reuse; AlgoVault-native approval cards |
| Background work | `Store`/`Runner` (SQLite tasks), `setInterval` tick 1s, lease | → AlgoVault-cron-aware background jobs |
| Memory | `memories` table | → Trading memory + user preferences |
| AG-UI / CopilotKit | `@ag-ui/client`, `@copilotkit/runtime/v2`, `CopilotRuntime` | ✅ Reuse the protocol; AlgoVault UI layer replaces demo UI |
| Identity | Single-owner (`workspace.ownerId`) | ⚠️ Replace with per-user RTDB scoping |

---

## 4. Internal Implementation Map

| OpenDots capability | Current AlgoVault implementation | Where it belongs | Reuse / Adapt / Reimplement | Data ownership | Authorization model |
|---|---|---|---|---|---|
| Spaces | (none) | `lib/candel/workspace/` | Adapt — create `spaces` namespace | `candelSpaces/{userId}` | `candelSpaceRules` server-side |
| Dots → Candels | (none) | `lib/candel/templates/` | New — template + instance model | `candelTemplates/{templateId}`, `candel/{candelId}` | Owner-only RTDB rules |
| Conversations | (none in AlgoVault) | `lib/candel/conversation/` | New — server authoritatively | `candelConversations/{userId}/{candelId}` | Owner-only |
| Pages | `lib/market-intelligence/workspace.ts` (context only) | `lib/candel/workspace/` | Adapt — add create/edit/list + revision | `candelWorkspace/{userId}` | Owner-only |
| Specialist Dot (agent) | `lib/agents/*` (existing multi-agent) | `lib/candel/dot/` | Adapt — Candel instance wraps existing `DotAgent` | N/A (no separate DB) | `candel` ownership + tool allowlist |
| Computers (browser/files/terminal) | (none) | `lib/candel/computer/` | Reuse OpenDots `ComputerService` + OpenBot gateway | Server-side only, isolated | Server-side, no client exposure of host credentials |
| MCP connections | `lib/connections/` (conceptual) | `lib/candel/connections/` | Reuse OpenDots `ConnectionStore` | Server-side, per-user | Owner-only; `requiresApproval` gate |
| Tool permissions | `lib/agents/permissions.ts` | `lib/candel/permissions/` | New — granular Candel-level permissions | N/A | `candelPermissionRules` |
| Human-in-the-loop | `lib/agentic-trading-intelligence/agent-approval.ts` | `lib/candel/approval/` | Reuse + render AlgoVault approval cards | Server-only | Fail-closed; no execution without explicit approval |
| Background work | Vercel cron + `lib/workflows/*` | `lib/candel/jobs/` | Adapt — scheduled Candel tasks | Server-only | Scope to user + account + plan |
| Memory | `lib/agentic-trading-intelligence` memory | `lib/candel/memory/` | Reuse + trading preferences | `candelMemory/{userId}` | Owner + deletion |
| AG-UI protocol | `@ag-ui/client`, `@copilotkit/runtime/v2` | `lib/candel/ag-ui/` | Reuse protocol, replace demo UI with AlgoVault renderers | N/A | Server-side scoping |
| Router | `lib/ai/router.ts` | `lib/candel/router/` | Adapt — Candel-callee → shared `defaultRouter` | N/A | N/A (router is generic) |
| Trading context | `lib/trading/unified/*` (unified trading adapter) | `lib/candel/trading/` | Reuse — provider adapters, service, store | N/A | Candel↔account binding via `candelAccountBindings` |
| Market Intelligence | `lib/market-core/`, `lib/market-intelligence/*` | `lib/candel/tools/market/` | Reuse as tools (context, structure, liquidity, FVG, OB) | N/A | Candel-bounded |
| Strategy/Backtest | `lib/strategy-lab/*` | `lib/candel/tools/strategy/` | Reuse read tools | N/A | Candel-bounded |
| Risk engine | `lib/risk/*` | `lib/candel/tools/risk/` | Reuse | N/A | Candel-bounded, fail-closed |
| TradingView MCP | `app/api/tradingview/*` | `lib/candel/tools/tradingview/` | Reuse — expose only permitted tools | Server-only | `tradingviewPermissionRules` |
| Execution | `lib/ai-execution/gate.ts` | `lib/candel/execution/` | Reuse gate; add explicit approval | `candelExecutionRequests/{userId}` | Fail-closed; named account only |
| Admin builder | `app/admin/intelligence/*` (existing agent builder) | New `app/admin/candel/*` | Reuse layout/admin-auth pattern | RTDB `candelTemplates` | `requireAdmin` |
| Observability | `lib/agentic-trading-intelligence/agent-observability.ts` | `lib/agentic-trading-intelligence/agent-observability.ts` (Candel extension) | Extend | `candelAudit/{userId}` | Admin-only read |
| UI visual | `components/layout/*` | New `components/candel/*` | AlgoVault design system (dark/light, compact, 1px borders, #2563eb, Satoshi/Inter) | N/A | N/A |

---

## 5. RTDB Schema (new namespaces)

All under existing Firebase RTDB (`algovault-4c64-default-rtdb`). Rules added to `database.rules.json`:

```
candelTemplates/{candelId}            # admin/owner writable
candel/{candelId}                     # owner writable; read = owner or admin
candelConversations/{userId}/{candelId}  # owner read/write; admin both
candelWorkspace/{userId}              # owner read/write; server-only writes
candelMemory/{userId}                 # owner read/write; server-only writes
candelPermissions/{userId}/{candelId} # owner read/write; admin both
candelAccountBindings/{userId}/{candelId}  # owner read/write; admin both
candelToolBindings/{userId}/{candelId}     # owner read/write; admin both
candelActivity/{userId}/{candelId}    # owner write; admin read
candelAutomation/{userId}/{candelId}  # owner read/write; admin both
candelAudit/{userId}                  # admin-only write; read = owner+admin
candelAccountContext/{userId}/{candelId} # server-scoped (no client .write)
candelSubscriptionEntitlements        # cached subscription flags (admin-maintained)
```

---

## 6. Authorization Model

- **Server-side only.** No client-supplied `userId`, `candelId`, `accountId`, role, or permission flags trusted.
- **Fail-closed:** if any permission/account/entitlement is missing, Candel returns "unavailable: missing permission/context", never silent downgrade.
- **Rule template:** every object = owner OR admin; trading data = owner OR admin OR explicit `candelAccountBindings` grant.
- **Execution:** named account from binding only (body `accountId` ignored), approval_required before any write to `trading_execution_requests`.

---

## 7. Candel Types (product terminology)

| Type | Specialization | Core tools |
|---|---|---|
| Market Candel | Market analysis, multi-timeframe, SMC | `market.*` (context, structure, FVG, OB, liquidity) |
| Hunter Candel | Symbol/watchlist scan, setup ranking | market scan, watchlist, alerts |
| Quant Candel | Backtest/OOS/WF/MC | backtest, walk-forward, monte-carlo, parameter analysis |
| Sentinel Candel | Account risk, exposure, challenge rules | risk, positions, challenge, execution prep + warnings |
| Journal Candel | Trade analysis, performance, mistake patterns | journal, trade history, strategy link, reports |
| Executor Candel | Order proposal, approved execution workflow | `prepare_order` → approval → `submit_live_order` |
| TradingView Candel | TradingView MCP (permitted tools) | tradingview indicators/strategies, prepare actions |
| EA Candel | MT5/MT4 assistance, optimization, testing | EA analysis, optimization, debugging (reuse existing EA infra) |

**General-purpose Candels remain general:** research, writer, developer, marketing, web-research, custom — same OpenDots capabilities (browser, files, terminal, MCP, memory, background).

---

## 8. What Was Reused / Adapted / New

**Reused (OpenDots internals, MIT-compliant attribution added):**
- `src/server/store.ts` (SQLite task/memories store) → replaced by RTDB
- `src/server/workspace.ts`, `pages.ts`, `dot-agent.ts`, `runner.ts`, `platform.ts`, `platform-config.ts`
- `src/server/computer-service.ts` + OpenBot gateway
- `src/server/connection-store.ts`, `connection-tools.ts`, `connection-routes.ts`, `computer-routes.ts`, `workspace-routes.ts`
- `src/shared/computer-types.ts`, `connection-types.ts` (types)
- `src/server/parallel.ts` (web research)
- `src/browser/security.ts`
- `src/server/headless.ts`, `runtime-scope.ts`, `learning.ts`, `pages`, `workspace-routes`
- `lib/agentic-trading-intelligence/*` (already existing AlgoVault IL)

**Adapted:**
- OpenDots SQLite-based `Store`/`WorkspaceStore` → AlgoVault RTDB (wrap with `deepClean` for `.set`/`.update`)
- OpenDots single-owner `ownerId` → per-user `userId` scoping everywhere
- OpenDots in-memory `ComputerService` → server-side with isolated secret handling
- OpenDots `mcp_approvals` + `mcp_actions` → RTDB `candelApprovals` + `candelToolActions`
- OpenDots `connectionActionTool` → AlgoVault approval card UI
- OpenDots `Runner` (1s interval) → cron + `candelAutomation` schedules

**Newly implemented (AlgoVault-native):**
- `lib/candel/` SDK: types, permissions, authorization, RTDB store
- `lib/candel/workspace/`, `dot/`, `connections/`, `memory/`, `jobs/`, `tools/`, `execution/`, `approval/`, `authorization/`, `observability/`
- `app/api/candel/*` routes (REST + AG-UI over HTTP)
- `components/candel/*` UI + native sidebar entries
- `app/admin/candel/*` admin builder
- RTDB rules for all new namespaces
- Admin UI + user-approved Candel creation

---

## 9. What Was Tested / Verified (status)

| Check | Result |
|---|---|
| `npx tsc --noEmit` (new files only) | ✅ 0 errors |
| `npm run build` | ✅ exit 0 (pre-existing 163 errors in other workstreams) |
| `npm run lint` (on touched files) | ✅ 0 errors / 0 new warnings |
| `npm run test:*` (repo) | ⏳ pending — run after Phase 2+ |
| Browser/UAT | ⏳ not automated (server snapshot-only) |
| Mobile/PWA | ⏳ after shell integration |

---

## 10. Dependencies Requiring External Configuration

| Item | Env var / note |
|---|---|
| OpenBot computer gateway (browser/files/terminal) | `COMPUTER_SUPERVISOR_URL`, `COMPUTER_SUPERVISOR_TOKEN`, `COMPUTER_TOKEN` |
| AI providers | Already configured: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, etc. |
| TradingView webhook | `TRADINGVIEW_WEBHOOK_SECRET` (already configured) |
| Subscription | Stripe already configured; Pro flags already computed |
| Notifications | Existing `lib/notifications.ts` + `lib/email.ts` reused |

---

## 11. Considered Dead Ends / Avoidances

- ❌ Do NOT create a second trading-account DB inside Candels → Candel binds to existing `trading_accounts/{uid}`, `trading_positions`, `trading_orders`.
- ❌ Do NOT copy OpenDots UI visual identity → rebuild with AlgoVault design system.
- ❌ Do NOT reintroduce Firestore → RTDB only.
- ❌ Do NOT expose host credentials to clients → server-side, isolated.
- ✅ Do NOT rewrite OpenDots internals destructively → isolate in `lib/candel/` adapters.

---

## 12. Next: Phase 2 — Architecture

1. Add RTDB rules for new `candel*` namespaces
2. Implement `lib/candel/` core SDK (types, authorization, RTDB store, permission engine)
3. Implement Candel workspace bindings (RTDB), dot/agent adapter, connections, memory, jobs
4. Implement `lib/candel/tools/` (market, strategy, risk, tradingview, execution)
5. Implement admin builder + user Candel creation
6. Implement UI (Candel sidebar entries, approval cards, generative trading UI)
7. Tests + security audit + production verification

**Full details:** source-tree implementation plan in `docs/opendots-to-algovault-opencode-map.md` (to be expanded as Phases progress).

---

## 13. Phase 1.5 — Candel product layer (delivered)

**Updated:** 2026-10-10

The OpenDots capabilities that were listed as *to implement* in §12 are now in the
product, inside `lib/candel/*`, `app/api/candel/*`, `app/account/candels/*` and
`components/candel/*`. No second workspace, sidebar, agent runtime or trading
engine was created.

| OpenDots capability | AlgoVault Candel implementation | Verification |
|---|---|---|
| Dots → Candels | `lib/candel/roles.ts` (curated, closed role catalog) + `lib/candel/templates/defaults.ts` (10 seeded templates) + instance rows in RTDB; every entry point creates through `lib/candel/workspace/create.ts` so validation cannot fork | role/catalog + single-creation-path checks in `tests/lib/candel/run-candel-customization-checks.ts` |
| Per-dot instructions / tool allowlist | `lib/candel/config.ts` — `sanitizeCandelCustomization` + `resolveCandelConfig`: an instance may only **narrow** the template's tools/capabilities | tool-ceiling checks (widen attempts dropped) |
| Conversations | `app/api/candel/candel/conversation/message/route.ts` — real per-turn endpoint, owner-proven, memory injected as context | chat-endpoint checks |
| Memory | `candelMemory/{userId}/{candelId}` + panel; memory is read back into the system prompt, not write-only | memory-context checks in the harness suite |
| Human-in-the-loop approvals | `lib/candel/approvals.ts` + `…/approval/decide/route.ts` — the agent emits a fenced `approval` directive, the server admits it fail-closed and the user decides; approvals render as cards in the chat and in the Approvals inbox | 30 approval checks: parsing, admission, single-decision, expiry |
| Per-agent permissions | `candelPermissions/{userId}/{candelId}`; execution defaults OFF and any enabled execution keeps its approval requirement ON | `sanitizeCandelPermissions` checks |
| Account binding | `candelAccountBindings/{userId}/{candelId}`; a live action must name a bound account that carries the `execute` context | approval admission checks |
| Permanent delete | `purgeCandelInstance` removes every per-Candel namespace, owner-only | purge-coverage checks |
| AG-UI style generative UI | `components/candel/*` — studio with chat, memory, activity, approvals, permissions, automations and accounts; role avatars/chips, risk-posture badge | rendered on the dev server; tsc + eslint clean |

**Fail-closed invariants now enforced in code:**

1. A read-only Candel cannot raise an approval request at all.
2. A live action without a bound, execution-enabled, named account is refused — and the refusal is shown to the user.
3. An approval can be decided exactly once, never after expiry.
4. The client can never supply its own risk level or permission string; both are hardcoded server-side.
5. The raw `approval` directive is stripped from the stored message; only prose plus an explicit queued/rejected line reaches the transcript.

**Verification (2026-10-10):**

| Check | Result |
|---|---|
| `npx tsc --noEmit` (whole repo) | ✅ 0 errors |
| `eslint` on the Candel surface | ✅ 0 errors (warnings only, all pre-existing) |
| Candel harness suite (`tests/lib/candel/run-candel-verification.ts`) | ✅ 22/22 PASS |
| Customization + approval checks (`…/run-candel-customization-checks.ts`) | ✅ 79/79 PASS |
| Pages `/account/candels`, `/builder`, `/memory`, `/activity`, `/automations`, `/approvals`, `/account/candels/[id]` | ✅ HTTP 200 on the dev server |
| `POST /api/candel/candel`, `POST /api/candel/candel/builder`, `POST …/approval/decide` | ✅ 401 JSON for an unauthenticated caller (auth enforced, module compiles) |
| `tests/lib/candel/workspace-database.test.ts` | ⚠️ Not runnable: vitest cannot resolve the `@/` alias and it needs live Firebase credentials. Excluded from the checks above; it has never been part of this repo's jiti test pipeline. |
