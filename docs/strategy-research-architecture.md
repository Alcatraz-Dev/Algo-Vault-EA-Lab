# Autonomous Strategy Research Engine — Architecture

## Rule

CONNECT existing engines. Nothing below is rebuilt; `lib/strategy-research/` only orchestrates. The engine is a **research and validation system, not a money-management system** — live broker execution stays disabled (`executionEnabled: false` is validated server-side on every mission spec; nothing in the pipeline touches the execution gateway).

## Existing systems (reused, verified)

| Capability | Location | Entry point used |
|---|---|---|
| Market data (biquote + local export, honest coverage) | `lib/strategy-lab/market-data.ts` | `loadDataBundle(symbol, period, hierarchy)` |
| Deterministic backtest engine | `lib/strategy-lab/backtest.ts` | `backtestStrategy(...)`, `defaultBacktestConfig()` |
| Strategy model + draft scaffold | `lib/strategy-lab/types.ts` | `Strategy`, `StrategyDraft`, `BacktestConfig`, `ValidationOutcome` |
| AI → structured draft (untrusted AI, deterministic mapping) | `lib/strategy-lab/interpret.ts` | `sanitizeDraft()`, `strategyFromDraft()` |
| OOS + Walk-Forward validation | `lib/strategy-lab/validation.ts` | `validateStrategy(...)` |
| Robustness scoring | `lib/strategy-lab/robustness.ts` | `computeRobustness(...)` |
| Monte Carlo (deterministic seeded resampling) | `lib/market-intelligence/research/monte-carlo/runner.ts` | `runMonteCarlo(trades, config)` |
| Forward testing (signal-only) | `lib/strategy-lab/forward.ts` | `createForwardTest(...)` |
| Setup Memory (Phase 10) | `lib/market-intelligence/memory/` | `SetupMemoryRecord` (mode `RESEARCH`, `TRIGGERED`/`INVALIDATED`) |
| Knowledge Graph (Phase 13) | `lib/market-intelligence/knowledge/` | `buildEdge()`, `validateGraph()`, extended relation types |
| AI router (multi-provider gateway) | `lib/ai/client.ts` | `ai.generateStructured<T>()`, `ai.generateText()` |
| Auth | `lib/admin-auth.ts` | `authenticate(request)`, `requireAdmin(request)` |
| Pro entitlement | `lib/strategy-lab/license.ts` | `checkAccess(uid)` (server-side, never trusted from client) |
| RTDB access | `lib/firebase-admin.ts` | `adminDatabase` (RTDB only — no Firestore) |
| Strategy Lab persistence (incubation target) | `lib/strategy-lab/storage.ts` | `saveStrategy`, `saveBacktest`, `saveForwardTest` |
| App shell / nav | `components/layout/AppShell.tsx`, `app-nav.ts`, `admin-nav.ts` | `APP_NAV`, `ADMIN_NAV` |
| AI Terminal (Agent IDE) | `lib/agent/tools/registry.ts` | read-only `research.status` tool (`memory_read`, `mutating: false`) |
| Workflow Logic | `lib/workflows/node-registry.ts`, `executors.ts` | `research.start_mission`, `research.status`, `research.survivors` (category `simulation`, permission `analysis`) |

Not touched: backtest engine internals, market-data pipeline, risk engine, execution gateway, billing, auth.

## New domain `lib/strategy-research/`

| Module | Responsibility |
|---|---|
| `types.ts` | Mission spec, budget, fail states, lifecycle, warnings, robustness report, events, scores |
| `validation.ts` | Strict mission-spec validation (whitelists only), rejects `executionEnabled: true`, `clampBudget` |
| `mission.ts` | Create/persist mission, fingerprint duplicate-active guard, pause/resume/cancel, stage machine |
| `storage.ts` | RTDB access, lease transaction (idempotent work units), event log, client sanitizer |
| `hypothesis.ts` | Deterministic local hypotheses + AI-assisted generation (honest `aiUsed`/`source` reporting) |
| `compiler.ts` | Hypothesis → Strategy Lab draft (deterministic). Unsupported group/operator/value/timeframe/risk rejected; no arbitrary code |
| `fingerprint.ts` | Structural fingerprint/dedup (cosmetic text excluded); near-identical candidates linked, not duplicated |
| `runner.ts` | Stage adapters: backtest → OOS/WF → Monte Carlo → execution variation → distribution (reuses existing engines) |
| `robustness.ts` | 7-dimension robustness report + 12 deterministic warning types, evidence always present |
| `scoring.ts` | Transparent, explainable score; `detectOverfitting`; fail-closed `decideLifecycle` (survivor threshold 55) |
| `knowledge.ts` | KG edges (`MISSION_GENERATED`, `HYPOTHESIS_DERIVED_FROM`, `STRATEGY_TESTED_ON`, `STRATEGY_FAILED_OOS`, `STRATEGY_FAILED_WALK_FORWARD`, `STRATEGY_SUPPORTED_BY`, `STRATEGY_SIMILAR_TO`, …), lineage chain |
| `memory.ts` | Setup Memory records for survivors **and** rejections (rejected strategies are never deleted) |
| `incubation.ts` | Survivors → Strategy Lab `saveStrategy`; optional `signal_only` forward test |
| `orchestrator.ts` | One work unit per `advance` (RTDB lease), budget enforcement (`BUDGET_EXHAUSTED`), fail-closed mission failure, structured events |
| `queries.ts` | `listSurvivors` shared by API + terminal panels |
| `client-api.ts` | Typed fetch helper used by all UI |

Tests: `__tests__/run-research-tests.ts` — **143/143 passing** (`npm run test:research`).

## New RTDB paths (owner/admin rules added to `database.rules.json`)

- `strategyResearch/{uid}/missions/{missionId}` — mission + stage state (`.indexOn: createdAt, status`)
- `strategyResearch/{uid}/candidates/{missionId}/{candidateId}`
- `strategyResearch/{uid}/events/{missionId}/{eventId}` — audit/lineage log with event codes
- `strategyResearch/{uid}/hypotheses/{missionId}/{hypothesisId}`
- `strategyResearch/{uid}/compiled/{missionId}/{hypothesisId}`
- `strategyResearch/{uid}/knowledge/{missionId}` — KG edges
- `strategyResearch/{uid}/memory/{missionId}/{recordId}` — Setup Memory (mode RESEARCH)
- Survivor records are also mirrored into existing `monitoring/setups/{uid}` via Setup Memory

## API routes (Bearer idToken + server-side Pro checks)

- `GET/POST /api/strategy-research/missions` — list (Pro-gated) / create (Pro-gated, fingerprint duplicate guard, budget clamp)
- `GET/PATCH/DELETE /api/strategy-research/missions/[id]` — detail + events + edges / pause-resume-cancel / delete (non-running only)
- `POST /api/strategy-research/missions/[id]/advance` — one durable work unit (`maxDuration=300`, `{runAll, maxUnits≤60}`, lease-protected, owner-only)
- `GET /api/strategy-research/missions/[id]/candidates` — paginated summaries
- `GET /api/strategy-research/missions/[id]/candidates/[candidateId]` — full detail + lineage + KG edges (`?trades=1` for trade list)
- `POST /api/strategy-research/missions/[id]/candidates/[candidateId]/explain` — AI explanation over the deterministic evidence block (`maxDuration=60`, `503 AI_UNAVAILABLE` on failure; never invents metrics)
- `GET /api/strategy-research/survivors` — symbol-scoped survivors (shared query)
- `GET /api/strategy-research/diagnostics` — admin only (`requireAdmin`)

## UI routes

- `/strategy-research` — Mission Builder, Command Center (stage pills, budget counters, pause/resume/cancel/run), Candidate Explorer (paginated), Research Logs, Pro-locked preview for free users
- `/strategy-research/[missionId]/[candidateId]` — metrics, OOS/WF table, Monte Carlo, trades, lineage timeline, robustness dimensions, score factors, warnings, KG edges, AI explanation
- `/admin/strategy-research` — AdminShell diagnostics (queue, fail states, `executionEnabled: false` literal)

## Integrations (additive, never replacing)

- **AI Terminal**: contextual Strategy Research actions (navigation-only) + quick actions; read-only `research.status` tool
- **Scalping Terminal**: read-only `ResearchEvidencePanel` ("Research Similar Strategies") mounted in the scalping page — queries survivors, never modifies signal generation
- **Workflow Logic**: three optional research nodes (not required by the core pipeline)
- **Navigation**: Strategy group → Strategy Research (`app-nav.ts`); Admin → Intelligence → Strategy Research (`admin-nav.ts`)

## Pipeline (orchestrator stages)

`data → hypotheses → compile → backtest → validate(OOS+WF) → monte-carlo → execution-variation → rank/score → incubate → memory + KG → done`

- One work unit per `advance`; claimed via **RTDB transaction lease** → no duplicate jobs; cancellation/budget checked between units.
- Fail-closed states: `DATA_UNAVAILABLE`, `INSUFFICIENT_DATA`, `VALIDATION_FAILED`, `AI_UNAVAILABLE`, `BACKTEST_FAILED`, `BUDGET_EXHAUSTED` — results are never fabricated, AI never writes numeric results.
- Budget: max candidates / backtests / AI calls / duration / concurrency → graceful `BUDGET_EXHAUSTED`.

## Security model

- All routes: `authenticate()` Bearer idToken; Pro entitlement re-checked server-side (`checkAccess`); admin diagnostics behind `requireAdmin`.
- Mission specs validated against strict whitelists; `executionEnabled: true` rejected at validation.
- AI output is an untrusted proposal — compiled only through the deterministic compiler; unsupported constructs rejected; no arbitrary code execution; no secrets in prompts; no client-side API keys.
- RTDB rules: `strategyResearch/$userId` owner-or-admin read/write (fail-closed root).

## Known pre-existing build issues (NOT introduced by this feature)

`npm run build` currently fails on files owned by other workstreams: 17 errors in untracked `marketing-agent` routes (re-exported `runtime`/`dynamic`, missing `playwright`, `use server` export) + 1 committed bug in `components/market-intelligence/workspace-context.ts` (`../../../lib/...` import resolves outside the repo root; fails at clean HEAD too — verified via worktree build). Zero build errors reference `strategy-research` files.
