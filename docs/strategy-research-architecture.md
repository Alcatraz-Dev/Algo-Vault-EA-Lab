# Autonomous Strategy Research Engine — Internal Architecture Map

## Rule
CONNECT existing engines. Nothing below is rebuilt; the research domain only orchestrates.

## Existing systems (reused, verified)

| Capability | Location | Entry point used |
|---|---|---|
| Market data (biquote + local export, honest coverage) | `lib/strategy-lab/market-data.ts` | `loadDataBundle(symbol, period, hierarchy)` |
| Deterministic backtest engine | `lib/strategy-lab/backtest.ts` | `backtestStrategy(...)`, `defaultBacktestConfig()` |
| Strategy model + draft scaffold | `lib/strategy-lab/types.ts` | `Strategy`, `StrategyDraft`, `BacktestConfig`, `ValidationOutcome`, `RobustnessScore` |
| AI → structured draft (untrusted AI, deterministic mapping) | `lib/strategy-lab/interpret.ts` | `sanitizeDraft()`, `strategyFromDraft()` |
| OOS + Walk-Forward validation | `lib/strategy-lab/validation.ts` | `validateStrategy(...)` |
| Robustness scoring | `lib/strategy-lab/robustness.ts` | `computeRobustness(...)` |
| Monte Carlo (deterministic seeded resampling) | `lib/market-intelligence/research/monte-carlo/runner.ts` | `runMonteCarlo(trades, config)` |
| Parameter research limits | `lib/market-intelligence/research/limits.ts` | `RESEARCH_LIMITS` |
| Setup Memory (Phase 10) | `lib/market-intelligence/memory/` | `SetupMemoryRecord` (mode `RESEARCH`), `MEMORY_PATHS` |
| Knowledge Graph (Phase 13) | `lib/market-intelligence/knowledge/` | `buildEdge()`, `buildEdgeId()`, `resolveLineage()`, node types incl. `strategy_candidate`, `validation_candidate`, `backtest`, `oos`, `walk_forward`, `monte_carlo` |
| AI router (multi-provider gateway) | `lib/ai/client.ts` | `ai.generateStructured<T>()` |
| Auth | `lib/admin-auth.ts` | `authenticate(request)`, `requireAdmin(request)` |
| Pro entitlement | `lib/strategy-lab/license.ts` | `checkAccess(uid)` |
| RTDB access | `lib/firebase-admin.ts` | `adminDatabase` |
| Strategy Lab persistence (incubation target) | `lib/strategy-lab/storage.ts` | `saveStrategy(uid, strategy)` |
| App shell / nav | `components/layout/AppShell.tsx`, `components/layout/app-nav.ts`, `components/account/AccountShell.tsx` | `APP_NAV`, `ADMIN_NAV`, `ACCOUNT_NAV` |
| Scalping Terminal | `components/pro-scalping-terminal/ProScalpingTerminal.tsx` | add read-only survivors panel |
| AI Terminal (Agent IDE) | `lib/agent/tools/registry.ts` | add read-only `research.status` tool (`memory_read`) |

Not touched: workflows engine, execution/risk, billing, auth, market-data pipeline, backtest engine internals.

## New domain `lib/strategy-research/`
`types.ts` · `validation.ts` · `storage.ts` · `mission.ts` · `hypothesis.ts` · `compiler.ts` · `runner.ts` · `scoring.ts` · `orchestrator.ts` · `knowledge.ts` · `memory.ts` · `incubation.ts` · `index.ts` · `__tests__/`

## New RTDB paths (owner/admin only in rules)
- `strategyResearch/{uid}/missions/{missionId}` — mission + stage state machine
- `strategyResearch/{uid}/candidates/{missionId}/{candidateId}`
- `strategyResearch/{uid}/events/{missionId}/{eventId}` — audit/lineage log
- `strategyResearch/{uid}/knowledge/{missionId}/{edgeId}` — KG edges
- `strategyResearch/{uid}/memory/{missionId}/{recordId}` — Setup Memory records (mode RESEARCH)

## New API routes
- `POST/GET /api/strategy-research/missions` — create (Pro-gated, duplicate-active guard) / list
- `GET/PATCH/DELETE /api/strategy-research/missions/[id]` — inspect / pause-resume-cancel / delete
- `POST /api/strategy-research/missions/[id]/advance` — run one durable work unit (resumable)
- `POST /api/strategy-research/missions/[id]/incubate` — send surviving candidate to Strategy Lab
- `GET /api/strategy-research/survivors` — symbol-scoped survivors (Scalping Terminal)
- `GET /api/strategy-research/diagnostics` — admin only

## Pipeline (orchestrator stages)
data → hypotheses → compile → backtest → validate(OOS+WF) → monte-carlo → rank → (optional incubate) → done. One work unit per `advance` call; claimed via RTDB transaction so no duplicate jobs; cancellation checked between units. Live execution stays disabled (`mission.executionEnabled: false` is enforced server-side; nothing in the pipeline touches the execution gateway).
