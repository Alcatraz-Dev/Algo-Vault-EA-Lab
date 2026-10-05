# Phase 8 — Pre-Implementation System Audit

**Scope:** source-level audit of AlgoVault's existing monitoring, alerting, notifications, scheduling, event infrastructure, setup memory, journal, AI/research layer, trading engines, risk, execution, paper/live, workflows, permissions, Pro gating, admin, security, multi-user isolation and tests — performed *before* Phase 8 implementation, as the phase brief mandates.

**Method:** four disjoint read-only audits (monitoring/alerts/events · setup-memory/journal/research · engines/risk/execution · workflows/permissions/admin/security) plus direct verification of every high-severity claim by the parent agent. No file was modified during the audit except one P0 fix (see §1).

**Classification:** `WORKING` · `PARTIALLY WORKING` · `BUGGY` · `DUPLICATED` · `PLACEHOLDER` · `OBSOLETE` · `NEEDS REFACTOR` · `MISSING`

**Headline:** the deterministic trading core is genuinely strong (`lib/market-core`, `lib/ai-execution/gate.ts`, `lib/workflows/engine.ts`, RTDB isolation). The Phase 8 *orchestration layer* is almost entirely absent, and the existing "automation" is mostly **not running** — three monitoring routes are unreachable and no trading monitor is scheduled.

---

## 0. Executive summary

| Question the phase brief asks | Answer |
| --- | --- |
| Can Phase 8 avoid building a second trading engine? | **Yes**, with three caveats: backtesting has 4 engines, risk has 2, and indicator/SMC math has 4 copies. |
| Is there a canonical event bus to build on? | **No.** Four incompatible event models exist; the most complete is domain-locked to commerce. |
| Does continuous monitoring exist today? | **No.** Zero trading/market monitors are scheduled; the 3 that exist have no cron and (one) no caller. |
| Are the safety gates Phase 8 assumes present? | **No.** There are 3 automated order paths and only 1 is guarded. No strategy lifecycle, no degradation detection, no paper→live gate. |
| Is the system fail-closed? | **Mostly not.** Canonical risk engine returns `false`/`true` on unknown state; workflow auth returned `isAdmin: true` for everyone. |
| Is idempotency implemented? | **Declared but not enforced** — `checkProcessed()` is a stub that always returns `false`. |
| Is multi-user isolation sound? | **Yes**, with one low-severity exception (`settings` world-readable). |

---

## 1. P0 fixed during this audit

`app/api/workflows/_helpers.ts:40` returned `isAdmin: isAdmin || true` — every authenticated user was an admin.

Blast radius (verified):

- **Pro gating never denied.** All 12 workflow route files call `authenticateWorkflow`; guards shaped `if (!isPro && !auth.isAdmin) return deny()` can never deny. `resolveEntitlement` (`lib/workflows/limits.ts:87`) computes `allowed = isAdmin || tier !== "free"` → always `true`, so **free-tier users received enterprise limits**.
- **Run-limit enforcement skipped.** `usage.atLimitFor.includes("active_workflows") && !auth.isAdmin` (`app/api/workflows/route.ts:57`) never applied.
- **The global kill switch was defeated.** `lib/workflows/engine.ts:122` — `if (settings.killSwitchEnabled && !isAdmin)`. With `isAdmin` always true, the kill switch could never halt workflow execution.

Fixed to `return { uid: decoded.uid, isAdmin };`. **This is the single highest-severity finding in the audit and it was live.**

Two adjacent fail-open branches remain and are **intentionally not changed** (they carry a deliberate "in dev mode" comment and need a product decision): a missing `users/{uid}` record sets `isAdmin = true` (`:32-35`), and a thrown lookup error sets `isAdmin = true` (`:36-38`). Under the project's fail-closed rule both should deny instead.

---

## 2. Inventory

### 2.1 Monitoring, alerts, notifications, events

| Subsystem | Canonical path | Status | Evidence |
| --- | --- | --- | --- |
| Business event bus (commerce) | `lib/business-events/` | PARTIALLY WORKING | `dispatcher.ts:21-40` persists + dispatches; 3 commerce call sites only |
| Idempotency guard | `lib/business-events/idempotency.ts:14-24` | **PLACEHOLDER** | `checkProcessed` always `return false`; unused `getEvent` import |
| Plugin event bus | `lib/plugins/runtime/event-bus.ts:34-50` | PARTIALLY WORKING | 14 types incl. `market.anomaly.detected`; only 3 emits (license/exec) |
| Terminal event feed | `lib/terminal/events.ts:188-201` | WORKING (in-memory) | deterministic id-dedup + sort + cap 200 |
| Manual price alerts | `app/api/alerts/route.ts:5` | PARTIALLY WORKING | 7 `AlertType` declared, **1** timeframe string, default `H1` |
| Alert evaluator | `app/api/alerts/check/route.ts:63-67` | **BUGGY + NOT RUNNING** | only `price_above`/`price_below` branch; 5 declared types can never fire; absent from `vercel.json` |
| Trade TP/SL monitor | `app/api/trade-management/monitor/route.ts:99-376` | **NOT RUNNING** | full logic sound; POST+cron-auth only; **zero callers repo-wide** |
| AI-signal monitor | `app/api/ai-signals/monitor/route.ts:12-27` | NOT RUNNING | cron-auth GET; absent from `vercel.json` |
| Pine alert engine | `lib/pine-runtime/alert-engine.ts:53-135` | PARTIALLY WORKING | real frequency model; state is in-memory `Map` (`:47`) |
| Notification stack A | `lib/notifications.ts:199-360` | **WORKING** | Discord + Telegram + email, per-user routing, delivery audit; ~15 call sites |
| Notification stack B | `lib/trade-management/notifications.ts:13-19` | **DUPLICATED** | 5 channels; `sendPush` is a stub (`:200-203`); used only by the never-run monitor |
| Spam protection | `lib/plugins/runtime/notification-hub.ts:61-95` | WORKING (plugin-scoped) | cooldown, quiet hours, daily cap, 30-min dedupe — the only reusable monitoring primitive in the repo |
| Freshness guard | `lib/ai-signals/freshness-guard.ts:10-47` | **WORKING** | `BLOCK_STALE`/`BLOCK_UNAVAILABLE`; wired at `lib/ai-signals/engine.ts:887` |
| Account health | `lib/account-health/` | WORKING (on-demand) | pure scoring; GET only, unscheduled |
| RTDB rules coverage | `database.rules.json` | PARTIALLY WORKING | `notifications`/`tradeManagement` covered; **`alerts`, `pineAlertHistory`, `businessEvents` absent** |

### 2.2 Setup memory, journal, AI, research, learning

| Subsystem | Canonical path | Status | Evidence |
| --- | --- | --- | --- |
| Setup Memory record | `lib/market-intelligence/memory/types.ts:2-26` | **WORKING** | persisted, 7 states, `stateHistory` w/ evidence |
| Setup Memory lifecycle | `lib/market-intelligence/memory/lifecycle.ts:5` | **PLACEHOLDER** | `transitionState` called **only from tests** |
| Setup evaluator | `lib/market-intelligence/monitoring/setup-evaluator.ts:5` | PARTIALLY WORKING | emits only `WAITING`/`PARTIALLY_MATCHED`/`TRIGGERED` |
| Setup lifecycle (dup ×2) | `monitoring/types.ts:9`; `phase12/setup-lifecycle.ts:4` | **DUPLICATED** | 6 states w/o CANCELLED; and 6 totally different states |
| Setup quality score | `lib/intelligence/signal-bridge.ts:88` | **PLACEHOLDER** | `setupQuality = params.confidence / 100` — signal confidence aliased |
| Setup similarity | `lib/strategy-research/fingerprint.ts:75-82` | PARTIALLY WORKING | exact-hash dedup only; **no sample size, no statistics** |
| Copilot "similarity" | `app/api/extension/copilot-memory/route.ts:87-101` | **BUGGY** | returns first 3 saved strategies w/ **hardcoded reasons + fabricated outcome** |
| Journal store A | `app/api/extension/journal-sync/route.ts:110` | WORKING | `tradeJournal/{uid}` |
| Journal store B | `app/api/analytics/journal-sync/route.ts:87-100` | **DUPLICATED** | `users/{uid}/notes`, different shape |
| Journal automation | `app/api/trade-management/monitor/route.ts:114,179` | **MISSING** | MT5 close path writes **no journal record** |
| AI trade review | — | **MISSING** | no post-close review path exists |
| Research pipeline | `lib/strategy-research/orchestrator.ts:~800-826` | **WORKING** | BT → OOS → MC → robustness → KG → memory |
| Research triggers | — | **MISSING** | 0 matches for all 6 Phase 8 trigger names |
| Market regime | `lib/analytics/market-regime.ts:26` | **DUPLICATED** | 7-state lowercase vs 8-state uppercase; lossy hand-written bridge w/ a no-op `.replace` at `ai-signals/engine.ts:256` |
| AI feedback loop | — | **MISSING** | no analysis-rating store |
| Command Center | `app/dashboard/page.tsx:107-122` | PARTIALLY WORKING | widget seed; no system-state aggregate |
| Trading daily/weekly report | `app/api/report-generator/route.ts:26-102` | **BUGGY** | reads `result`/`resultR` no writer ever emits → always "0 trades" |

### 2.3 Engines, risk, execution, paper/live

| Capability | Canonical module | Duplicates | Status |
| --- | --- | --- | --- |
| Indicator math | `lib/market-core/indicators/` | `lib/analytics/indicators.ts` = adapter ✓; `market-intelligence/indicators/adapter.ts` = adapter ✓; **`lib/workflows/ta.ts:28-220` independent, diverges** | DUPLICATED |
| ATR | `lib/market-core/indicators/primitives.ts` | **`lib/analytics/volatility.ts:8-19` simple average, not Wilder** | BUGGY |
| Smart Money | `lib/market-core/smart-money/` | adapter ✓; **`lib/analytics/market-structure.ts:3-33` independent fractal math** | DUPLICATED |
| Backtesting | `lib/strategy-lab/backtest.ts:198` | `strategy-engine/backtest.ts`, `pine-runtime/backtest.ts`, **`market-intelligence/backtesting/engine.ts:19` returns 0 trades always** | DUPLICATED |
| Replay | `lib/strategy-engine/replay.ts` | 2 more copies | NEEDS REFACTOR |
| Risk (order intent) | `lib/risk/risk-engine.ts:235` | **`lib/strategy-engine/risk.ts:36` different contract** | DUPLICATED |
| Order execution | `mt5_orders/` RTDB queue + EA | `lib/gateway.ts` is tokens/licenses only, no execution | PARTIALLY WORKING |
| Live gating | `lib/ai-execution/gate.ts:237` | **`lib/strategy-lab/execution.ts:125-147` bypasses it entirely** | PARTIALLY WORKING |
| `lib/live/` | — | `live-aggregator.ts:87,229` is a **marketing demo feed** | OBSOLETE (name collision) |
| Trade management | `lib/trade-management/service.ts:558` | deterministic BE/trailing, **not in `vercel.json`** | PLACEHOLDER (wiring) |
| Position object | `lib/strategy-engine/types.ts:213` (rich) | **`lib/market-data/types.ts:286` `MT5Position = {[key:string]: any}`** | DUPLICATED |

### 2.4 Workflows, permissions, admin, security, tests

| Subsystem | Canonical path | Status | Evidence |
| --- | --- | --- | --- |
| Workflow DAG engine | `lib/workflows/engine.ts` | **WORKING** | real retry+backoff, AbortController timeouts, per-node traces (`:401-436`) |
| Run idempotency | `lib/workflows/engine.ts:310` | **WORKING** | stable `${runId}:${nodeId}`; resume skips completed |
| Risk guard before signal/exec | `lib/workflows/engine.ts:352-376` | **WORKING** | fail-closed — no passing upstream risk node ⇒ node fails |
| Scheduler | `lib/workflows/scheduler.ts:102-115` | PARTIALLY WORKING | transactional claim + cron reschedule; **cron only, no event trigger** |
| Trading-event triggers | `lib/workflows/node-registry.ts:77,86,95` | **MISSING** | only `trigger.manual` / `trigger.schedule` / `trigger.webhook` |
| Permission classes | `lib/workflows/types.ts:14` | PARTIALLY WORKING | 3 coarse classes: `analysis\|signal\|execution` |
| Automation modes | — | **MISSING** | `automationMode\|AUTOMATED_LIVE` → 0 hits; 3 conflicting ladders instead |
| Granular per-strategy permissions | — | **MISSING** | all 8 `can*` flags → **0 matches repo-wide** |
| Pro gating (strategy-lab) | `lib/strategy-lab/license.ts:38` | **WORKING** | `checkAccess` from 8+ server routes |
| Admin ops | `app/admin/workflows/page.tsx:36-58` | PARTIALLY WORKING | aggregates exist but read **user-scoped** APIs; no cross-user admin API |
| Observability | — | **MISSING** | 0 hits for pino/winston/opentelemetry/traceparent; no metrics substrate |
| Health endpoint | `app/api/health/route.ts:11-16` | PLACEHOLDER | unauthenticated liveness only, no dependency checks |
| Secrets | `lib/gateway.ts:83-86` | **WORKING** | `crypto.randomBytes`; `NEXT_PUBLIC_*` only Firebase web key + chart license |
| `settings` RTDB tree | `database.rules.json` | **BUGGY** | `".read": true` — world-readable |

---

## 3. Safety-critical findings (most severe first)

1. **[FIXED] Workflow auth returned admin for everyone** — `app/api/workflows/_helpers.ts:40`. Defeated Pro gating, run limits, and the global kill switch.

2. **Strategy-Lab live deployment bypasses every gate.** `activateDeployment` (`lib/strategy-lab/execution.ts:43-88`) accepts `backtestMetrics` (`:48`) and **never inspects it**; `status: "active"` is hardcoded (`:60`). On the next signal, `execution.ts:125-147` writes `trading_order_requests` with `volume: strategy.risk.fixedLot || 0.01` (`:134`) — no risk engine, no kill switch, no daily-loss/drawdown/open-position cap, no duplicate check, no sizing. The only route guard is `termsAccepted` (`app/api/strategy-lab/deploy/route.ts:58-60`); `mode` is client-supplied (`:68`). **A never-backtested strategy can reach live order flow.**

3. **Copy-trading bypasses the canonical risk engine.** `lib/copy-trading.ts` has no `evaluateOrder`; its only guard is `maxOpenTrades` (`:326-340`), then writes `mt5_orders` / `trading_order_requests` directly (`:380-390`).

4. **No strategy lifecycle state machine.** `PAPER_READY|PAPER_ACTIVE|LIVE_READY|LIVE_ACTIVE|DEGRADED` → 0 matches in `lib/` or `app/`. `DeploymentStatus` (`strategy-lab/types.ts:745-749`) is set unconditionally to `"active"`.

5. **Canonical risk engine is fail-OPEN on unknown state.** `lib/risk/risk-engine.ts:226` `slotsReached` → `false` when value is `undefined`; `:211` `slValid` → `true` when `price <= 0` (**every market order skips SL geometry validation**); `:127-128` fabricates `pipSize 0.01 / contractSize 100` for unknown symbols. A missing account snapshot silently disables all account-level limits.

6. **`strategy-engine/risk.ts` guards vanish on missing input** — `data_freshness` (`:53`), `session_restriction` (`:132`), `spread_guard` (`:140`) each require optional fields, while the header claims "Safety guards are fail-closed" (`:9`).

7. **No trading or market monitoring runs on any schedule.** `vercel.json` has 9 crons: 2 signal auto-updates, `/api/plugins/runtime/tick`, 5 growth/marketing. The three monitors — `/api/alerts/check`, `/api/ai-signals/monitor`, `/api/trade-management/monitor` — are all cron-gated and **all absent**.

8. **Look-ahead protection is not enforced where alerts and trades fire.** `visibleAsOf` (`market-core/smart-money/engine.ts:172`) is the canonical gate but has no backtest or live consumer. `app/api/alerts/check/route.ts:57-59` reads the **still-forming 1h candle** with no `isClosed` check.

9. **Notification records written by the main stack are unreadable by the Alert Center.** `lib/notifications.ts:338` writes `level`; `trade-management/notifications.ts:66` writes `severity`; `app/alert-center/page.tsx:14,276` reads `severity` → every main-stack notification renders as default-info.

10. **Copilot memory fabricates market facts.** `app/api/extension/copilot-memory/route.ts:87-101` returns saved strategies with hardcoded reasoning ("Shares structural bias…") and a default outcome, and filters on statuses `FORMING`/`DISMISSED` that exist in no enum.

11. **No recovery.** `strategy-engine/engine.ts:174-184` holds candles, features, positions, orders and pending entries in private memory; `paper.ts` persists nothing. Restart loses state.

12. **Kill switch is un-scoped and partly volatile.** `ai-execution/database.ts:126` is correctly fail-closed; `strategy-engine/paper.ts:77` is a **process-local `private killSwitch = false`**, lost on restart. No ACCOUNT/STRATEGY/SYMBOL/WORKSPACE/ALL-AUTOMATION scoping exists.

---

## 4. Gaps vs the Phase 8 Definition of Done

| # | Requirement | Status | Reason |
| --- | --- | --- | --- |
| 3 | Canonical event architecture | **MISSING** | 4 divergent models; best is commerce-locked (`business-events/types.ts:3-11`) |
| 4 | Event freshness/versioning | PARTIAL | guard exists (`freshness-guard.ts`) but not in any alert/trade path |
| 5 | Market monitoring engine | **MISSING** | no `marketHealth`/`feedHealth`; no market cron |
| 6 | Intelligent alert engine | PARTIAL | Pine engine is real but in-memory + unscheduled; 5 of 7 alert types are dead |
| 7 | Alert priority engine | **MISSING** | 4 unrelated vocabularies; no `INFO/LOW/MEDIUM/HIGH/CRITICAL` |
| 8 | Alert deduplication | PARTIAL | exists only in `notification-hub.ts:61-95`, plugin-scoped |
| 9 | Setup Memory 2.0 | **MISSING** | lifecycle machine uncalled; no `VALIDATED/EXECUTED/MONITORED` states |
| 10 | Setup quality score | PARTIAL | field exists but aliases signal confidence; no components |
| 11 | Setup similarity | **MISSING** | exact-hash dedup only; copilot path fabricates |
| 12 | Strategy health monitor | PARTIAL | metrics computed (`strategy-engine/analytics.ts:80-165`) but never compared or surfaced |
| 13 | Degradation detection | **MISSING** | only winRate/returnPct diffs; no PF comparison, no `DEGRADED` |
| 14 | Strategy status transitions | **MISSING** | status hardcoded `"active"` |
| 15 | Risk Supervisor | PARTIALLY WORKING | per-order only; no NORMAL/CAUTION/RESTRICTED/HALTED |
| 16 | Kill switches (scoped) | PARTIALLY WORKING | 2 switches, no scopes, one process-local |
| 17 | Paper → Live safety gate | **MISSING** | only `termsAccepted` |
| 18 | Live execution guard | PARTIALLY WORKING | genuinely fail-closed on the AI path only |
| 19 | Position monitoring | PARTIALLY WORKING | rich type exists; live consumers get `any` |
| 20 | Journal automation | **MISSING** | close writes no journal |
| 21 | AI trade review | **MISSING** | no post-close path |
| 22 | Continuous learning loop | PARTIALLY WORKING | tail only (research→candidate→paper is real and safe) |
| 23 | Research triggers | **MISSING** | 0 matches |
| 24 | Command Center | PARTIALLY WORKING | widgets, no system-state object |
| 25 | Daily/weekly reports | PARTIALLY WORKING | route exists but reads unwritten fields; no cron |
| 26 | Notification routing | PARTIALLY WORKING | delivery works; storage schema conflicts; `push` is a stub |
| 27 | Audit trail | PARTIALLY WORKING | per-trade/per-notification logs exist; no automation audit |
| 28 | Recovery / idempotency | **MISSING** | `checkProcessed` stub; no rehydration |
| 29 | Admin observability | **MISSING** | no metrics substrate; fragmented read-only panels |
| 30 | Security hardening | PARTIALLY WORKING | P0 fixed; RTDB isolation otherwise sound; `settings` world-readable |
| 31 | Tests | PARTIALLY WORKING | live-safety suite is comprehensive but **orphaned**; 0 event-pipeline coverage |
| 32 | Multi-user isolation | **MET** | order writes namespaced by uid/account; RTDB deny-all root |
| 33 | RTDB only / no Firestore | **MET** | no Firestore usage found |
| 34 | No duplicate trading engines | **NEEDS REFACTOR** | 4 backtest engines, 2 risk engines, 4 indicator/SMC copies |

---

## 5. Test coverage vs the Phase 8 §47 matrix

| Required area | Covered by | Status |
| --- | --- | --- |
| Events ordering / timestamps / dedup | — | **NO COVERAGE** |
| Events idempotency | helper only, never executed | **NO COVERAGE** |
| Alerts conditions / MTF / SMC / priority / dedup | `lib/ai-signals/__tests__/monitor.test.ts` *(orphaned)* | PARTIAL |
| Setup memory transitions / invalidation / expiry | `lib/ai-execution/__tests__` *(orphaned)* | PARTIAL |
| Risk kill switch / daily loss / drawdown / exposure | `lib/risk/tests` (wired) + `ai-execution` *(orphaned)* | COVERED |
| Live safety: stale data, duplicate orders, missing SL, invalid size, spread | `lib/ai-execution/__tests__` *(orphaned)* | COVERED |
| Live safety: broker disconnect | — | **NO COVERAGE** |
| Learning: journal, feature extraction, research trigger | `lib/strategy-research/__tests__` (wired) | PARTIAL |
| End-to-end integration chain | — | **NO COVERAGE** |
| Workflow engine execution / retry / risk guard | `lib/workflows/__tests__` = 121 lines of static asserts | **NO COVERAGE** |

**All 18 `package.json` runners resolve to real files. Four suites are orphaned and never run in CI:** `lib/ai-execution/__tests__/run-ai-execution-tests.ts` (76 checks — the *entire* live-safety suite), `lib/ai-signals/__tests__/run-ai-signals-tests.ts`, `lib/agents/__tests__`, `lib/agent/__tests__`.

---

## 6. Recommended sequence (deviates from the brief's order, deliberately)

The brief's priority list starts at "consolidate the event model". This audit argues for three **pre-phase** repairs first, because each one is either a live vulnerability or a correctness defect that would be baked into new work:

**Pre-Phase 0 — repairs (small, high value)**

1. Route all 4 orphaned suites into `package.json` + CI. Zero new test code — existing live-safety coverage finally executes.
2. Reconcile the notification schema (`level` vs `severity`) and point `alert-center` at the real field. Live user-facing bug.
3. Delete the fabricated branches in `copilot-memory/route.ts:87-101` and its dead status filters. The AI is currently stating unverified market facts, which violates the phase's core rule.
4. Redirect `lib/analytics/volatility.ts` and `lib/analytics/market-structure.ts` to `lib/market-core`. Two small duplicate-math removals that also fix a real ATR bug.
5. Decide the two `_helpers.ts` fail-open branches (missing user record / lookup error) — fail-closed per project rule, or env-gated dev mode.

**Decision required before Phase 8 item 2 (canonical event bus)**

> **What is the single automated order path?** Today there are three — `ai-execution`, `strategy-lab`, `copy-trading` — and only `ai-execution` is guarded. The highest-leverage Phase 8 change is not a new event bus; it is refactoring `lib/ai-execution/gate.ts` to accept any `OrderIntent` and routing Strategy-Lab and copy-trading through it. That single change closes findings 2, 3 and 12 with the guard you already have, instead of building a fourth guard.

**Then, in brief order**

- **Extend** `lib/business-events/` in place (generalize the envelope + entity union) — do **not** add a second bus. Start by making `checkProcessed` real, since every downstream idempotency requirement depends on it.
- **Wire the three existing monitors** into `vercel.json` before building the "market monitoring engine". `trade-management/monitor/route.ts:99-376` is already sound; Phase 8's monitoring layer has no execution substrate until this exists.
- **Add `alerts`, `pineAlertHistory`, `businessEvents` to `database.rules.json`** before designing any client subscription path.
- **Extract `shouldDeliver`** from `lib/plugins/runtime/notification-hub.ts:61-95` as a domain-neutral guard and route all trading alerts through it. It is the only genuinely reusable monitoring primitive in the repo.
- **Wire `transitionState`** into the close path and add the missing states rather than creating a 5th lifecycle vocabulary; consolidate `phase12/setup-lifecycle.ts` and `monitoring/types.ts:9` into `memory/types.ts`.
- **Unify** the three automation-mode ladders and the two regime vocabularies before adding per-strategy permissions, or Phase 8 will create a 4th and 3rd respectively.
- **Keep** `incubation.ts:70`'s `"signal_only"` invariant and research's never-auto-promote behaviour — verified safe today, and the learning loop must preserve it.

---

## 7. Audit limitations

- No runtime/live-market verification. Every finding is source-level; where a claim depends on runtime behavior it is marked as such.
- The MT5 EA source is not in this repository, so gateway-side validation could not be assessed.
- `.kilo/worktrees/` contains three stale copies of the same files; they were excluded from findings but will collide with any refactor of `lib/strategy-lab/execution.ts`.
- `docs/phase5-terminal-audit.md:33` labels Setup Memory `WORKING`; this audit finds the record shape working but the **lifecycle machine uncalled**. Treat that earlier label as stale for the lifecycle specifically.
- `lib/analytics/zones/zone-scoring.ts` was not read beyond its signature; it is inferred to be a zone-proximity score, not an outcome probability.
- The working tree has 49 uncommitted files from other workstreams. `npx tsc --noEmit` reports 18 errors, all confined to the untracked `lib/intelligence/market-analyst.ts` (unterminated template literal). None are in files this phase touched.
