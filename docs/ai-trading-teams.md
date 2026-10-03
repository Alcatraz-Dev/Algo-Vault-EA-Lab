# AlgoVault AI Trading Teams — Developer Guide

A multi-agent **orchestration and product layer** on top of the existing AlgoVault
intelligence engines. Teams of specialized agents consume deterministic market
data (Smart Money Engine, Market Intelligence, Setup Memory, Strategy Research,
risk state), return **structured evidence**, and a Chief Analyst synthesizes the
final result. It is deliberately **not** a chatbot collection: no agent may claim
a market fact it did not receive in its dossier, and free text is never the
internal protocol.

- User feature: `/ai-trading-teams` and the customer-area mirror `/account/ai-trading-teams` (same workspace component, account sidebar)
- Admin: `/admin/ai-agents` (agent factory), `/admin/ai-trading-teams` (monitoring + templates)
- Domain code: `lib/ai-trading-teams/*`
- API: `app/api/ai-trading-teams/*`, `app/api/admin/ai-agents/*`, `app/api/admin/ai-trading-teams/*`
- UI: `components/ai-trading-teams/*`
- Tests: `npm run test:ai-teams`

---

## 1. Architecture

```
User request (NL or guided builder)
  → API (auth → Pro entitlement → feature flag → rate limit → schema validation)
    → Team config (validateTeamConfig — LLM output is never trusted blindly)
      → Context builder (buildDossier): market data + existing engines, point-in-time safe
        → Orchestrator (selectRelevantAgents → planWaves → parallel/sequential execution)
          → Agent executor (timeout, retry, JSON schema validation per agent)
            → Structured outputs (evidence kinds, confidence, invalidations, risks)
              → Consensus + conflict detection + behavior gate (risk/quant required)
                → Chief Analyst synthesis (market context, bull/bear, risks, invalidation, setup state)
                  → RTDB (runs, metrics, memory) + notifications + analytics events → UI (live progress)
```

### Key modules (`lib/ai-trading-teams/`)

| Module | Responsibility |
| --- | --- |
| `types.ts` | All domain types: `TeamConfig`, `TeamAgentDefinition`, `AgentRunOutput`, `TeamRun`, evidence kinds, `ALLOWED_AGENT_TOOLS`. |
| `flags.ts` | Feature flags (§5). |
| `validation.ts` | **Pure, Firebase-free** validators: team config, agent definition, agent output (+ FACT-reference check), run mode (`validateRunMode`), ownership (`assertTeamOwnership`/`filterOwned`), point-in-time guard (`enforcePointInTime`), intent extraction, `sanitizeMemoryUpdates`. |
| `agent-library.ts` | 12 built-in agents (`BUILTIN_TEAM_AGENTS`), incl. `chief-analyst` (`CHIEF_AGENT_ID`), `DEFAULT_TEAM_AGENT_IDS`. |
| `templates.ts` | 7 built-in team templates. |
| `context.ts` | `buildDossier` (reuses `fetchCandles`, Smart Money, analytics engines), `sliceDossierForAgent` (per-agent context minimization), `summarizeDossierForChief`, injectable `DossierDeps` for tests. |
| `prompts.ts` | System/user prompt assembly. |
| `agent-executor.ts` | Single-agent execution: timeout, retry, JSON parse/validate, `AIFn` abstraction. |
| `orchestrator.ts` | `selectRelevantAgents`, `planWaves`, `analyzeConsensus`, `evaluateBehaviorGate`, `runTeamAnalysis` (the run loop). |
| `agents.ts` | Agent resolution: admin (`aiAgents`) → user custom (`userAIAgents/{uid}`) → built-in; `listAgentLibrary`. |
| `database.ts` | RTDB access layer + `AI_TEAMS_PATHS`. |
| `memory.ts` | Structured team memory fold (`updateMemoryAfterRun`, `summarizeMemory`). |
| `monitoring.ts` | `buildMonitoringSnapshot` for admin dashboards. |
| `execution.ts` | Production wiring: `executeTeamRun` (dossier deps, notifications, metrics, analytics). |
| `versioning.ts` | `nextVersion` (semver patch). |
| `ai.ts` | `createTeamAIFn` — adapts `lib/ai/router.ts` `defaultRouter.chat` to the executor with `context: { source: "agent", sourceId: "ai-trading-team/<agentId>", userId }`. |
| `index.ts` | Barrel export. |

### Reused platform systems (do not duplicate)

- **AI routing**: `lib/ai/router.ts` — all agents go through the existing
  provider abstraction with its fallback chain. If every provider fails the run
  fails **structurally** (no fabricated analysis). Local heuristic fallback is
  flagged in output as low-trust narration.
- **Market data**: `fetchCandles` from `lib/market-data/normalizer.ts`,
  `SUPPORTED_SYMBOLS`, timeframe union `M1…D1`.
- **Deterministic intelligence**: `SmartMoneyEngine`, `lib/analytics/*`
  (market-structure, liquidity, regime, volatility, sessions, multi-timeframe,
  market-score, indicators) — consumed via the dossier, never re-implemented.
- **Setup Memory**: `monitoring/setups/{uid}` lifecycle for setup states.
- **Strategy Research**: `lib/strategy-research/storage.listMissions`.
- **Risk**: `lib/risk/account-state.ts` `loadAccountRiskSnapshot` (emergency
  stop, daily loss, drawdown) feeds the Risk Manager.
- **Auth / entitlement**: Bearer ID token auth, `isProUser(uid)` from
  `lib/ai-signals/access`, `requireAdmin(request)` from `lib/admin-auth` —
  **all enforced server-side**.
- **Notifications**: existing `notifications/{uid}` — no second system.
- **Analytics**: existing analytics events via `aiTeamEvents` funnel — no new
  platform.

---

## 2. Schemas

### Team config (validated by `validateTeamConfig`)

```jsonc
{
  "market": "XAUUSD",
  "style": "scalping | intraday | swing | position | research",
  "entryTimeframe": "M5",
  "confirmationTimeframe": "M15",
  "contextTimeframe": "H1",
  "riskProfile": "conservative | balanced | aggressive",
  "behavior": "consensus | evidence-weighted | risk-first | research-first | custom",
  "behaviorRules": { "requireRiskValidation": true, "requireQuantValidation": false, "minConsensusConfidence": 0.6 },
  "intents": ["scalping", "smart-money", "setup-validation", "risk"]   // relevance hints
}
```

NL creation (`POST /api/ai-trading-teams/parse`) runs the LLM step **then**
`validateTeamConfig`; invalid fields are rejected with structured errors. The
deterministic `extractIntentsFromRequest` (token matching, no substring
false-positives) is used for relevance filtering without an LLM call.

### Agent definition (validated by `validateAgentDefinition`)

`id, name, description, category, icon, visualType, capabilities, tools
(allow-listed from ALLOWED_AGENT_TOOLS), systemInstructions, outputSchema,
requiredInputs, optionalInputs, limitations, activationTags, dependsOn,
version, enabled, temperature, timeoutMs, maxRetries, maxOutputTokens,
isChief?, builtin?`

### Structured agent output (validated by `validateAgentOutput`)

```jsonc
{
  "agentId": "smart-money",
  "status": "completed",
  "summary": "…",
  "observations": [{ "id": "…", "kind": "FACT|INTERPRETATION|HYPOTHESIS|RISK|INVALIDATION|UNKNOWN", "text": "…", "ref": "dossier.source.id" }],
  "evidence": ["…ids actually read…"],
  "interpretation": "…", "stance": "bullish|bearish|neutral|mixed|unclear",
  "confidence": 0.0, "invalidations": [], "risks": [],
  "dataTimestamp": "ISO", "toolsUsed": [], "limitations": []
}
```

FACT-kind observations must reference a real dossier source — `validateAgentOutput`
demotes unreferenced FACTs to UNKNOWN. The Chief synthesis (`validateSynthesis`)
produces: market context, evidence, bullish/bearish cases, risks, invalidation,
setup state (`WAITING|WATCHING|VALIDATING|CONFIRMED|INVALIDATED|CANCELLED`),
research next step, data freshness, and a research disclaimer. `CONFIRMED`
requires actual evidence; behavior gates can block a "final" synthesis
(partial status instead).

---

## 3. Orchestrator

`runTeamAnalysis(params)` (pure of I/O — AI calls and progress are injected):

1. Fail-safe: dossier `quality === "unavailable"` → **failed run**, no agents execute.
2. `selectRelevantAgents`: union of config intents + extracted intents matched
   against each agent's `activationTags`. Zero matches → full team
   (conservative default). ≥1 match → only relevant agents; the rest are
   skipped **with an explicit reason** (never silently dropped).
   `risk-first`/`research-first` behaviors force the Risk/Quant agents back in.
3. `planWaves`: topological buckets of parallel-safe agents; cyclic or
   unsatisfiable dependencies are skipped with a reason; the Chief always runs
   last.
4. Per-wave parallel execution with per-agent timeout/retry
   (`ORCHESTRATOR_LIMITS`: max agents/AI calls/total wall time budget).
   Cancellation via `isCancelled()` (RTDB control flag) burns no further calls.
5. `analyzeConsensus`: deterministic stance grouping, conflict detection
   (stances, risks, invalidations, **missing evidence from skipped agents**) —
   no arbitrary numeric "AI score".
6. `evaluateBehaviorGate`: risk/quant validation requirements can block final
   synthesis.
7. Chief synthesis from: all evidence + consensus + memory summary + dossier
   meta (freshness). Cancelled runs get a distinct CANCELLED synthesis branch.

Live UI: `onProgress` patches stream run status, waves, per-agent outputs and
timeline entries; the client subscribes with `run-subscription.ts`.

---

## 4. Tool permissions & custom-agent security

- `ALLOWED_AGENT_TOOLS` in `types.ts` is the **only** tool vocabulary; agent
  definitions (built-in, admin, custom) are rejected otherwise.
- Custom agents (`userAIAgents/{uid}`) execute with the same executor,
  allow-list, output validation, timeouts and ownership checks as built-ins.
  User instructions can never widen: auth, entitlement, data access, tools.
- The prompt layer only ever exposes the agent's **sliced dossier**
  (`sliceDossierForAgent`) — not the whole platform dataset (cost control §26).

## 5. Feature flags (env, `lib/ai-trading-teams/flags.ts`)

| Flag | Default | Effect when `false/0/off/no` |
| --- | --- | --- |
| `AI_TRADING_TEAMS_ENABLED` | on | Entire feature disabled (API 404-style deny, UI hides surfaces). |
| `AI_CUSTOM_AGENTS_ENABLED` | on | Pro users cannot create custom agents. |
| `AI_ADMIN_AGENT_FACTORY_ENABLED` | on | Admin agent factory routes disabled. |

`featureFlagSnapshot()` is returned in API responses so the UI hides disabled
surfaces; the server remains the authority.

## 6. Database (Firebase RTDB only — no Firestore)

```
aiTradingTeams/{uid}/{teamId}          user teams
aiTradingTeamTemplates/admin/{id}      admin-published templates
userAIAgents/{uid}/{agentId}           user custom agents
aiAgents/{agentId}                     admin-managed agent definitions
aiAgentVersions/{agentId}/{version}    immutable version snapshots (rollbacks)
aiTeamRuns/{uid}/{runId}               runs (server-written only)
aiTeamRunIndex/{runId}                 admin monitoring index
aiTeamMemory/{uid}/{teamId}            structured team memory
aiAgentMetrics/{agentId}               aggregated agent metrics
aiTeamRunControl/{uid}/{runId}         cancellation flags
aiTeamEvents/{eventId}                 product analytics events
```

- `database.rules.json` restricts user paths to `auth.uid === $uid`; admin paths
  require the admin claim; runs/index are server-written.
- Every mutation goes through the API (auth → ownership → entitlement →
  schema). `filterOwned` gives defense in depth on reads.

## 7. Security summary

- Server-side Pro gating (`isProUser`) and admin gating (`requireAdmin`).
- `agentId`, `teamId`, run ownership and mode (`validateRunMode`) validated on
  every request.
- No secrets in prompts/responses; agent tool access is allow-listed.
- Rate limiting + run budgets (max agents, max AI calls, wall-clock budget) in
  `_helpers.ts` / `ORCHESTRATOR_LIMITS`.
- Historical modes (`replay`/`backtest`/`research`) require `asOf`;
  `enforcePointInTime` + dossier builder guarantee **no post-cutoff candles**
  reach any agent (spec §34, covered by tests).

## 8. Testing

```bash
npm run test:ai-teams
```

Offline suite (jiti runner, no network/Firebase): schema validation, ownership
& entitlement helpers, flag gating, orchestration (waves, parallelism,
consensus, gates), timeouts/retries/cancellation, provider-failure fail-safes,
FACT grounding, point-in-time/future-leakage isolation, custom-agent security,
versioning, memory validation. **134 tests.**

TypeScript: `npx tsc --noEmit` — zero errors in feature files (the repo has a
pre-existing baseline of errors in unrelated modules; do not "fix" them as part
of this feature). ESLint clean on all feature paths.

## 9. Admin usage

- `/admin/ai-agents` — 12-section Agent Builder (identity, behavior,
  capabilities, tools, inputs, outputs, activation, memory, security, visual
  identity, testing, versioning), sandbox test playground (input → tools →
  evidence → output → latency → tokens → validation), version publish/rollback.
- `/admin/ai-trading-teams` — monitoring snapshot (runs, latency, agent usage,
  error rates, budget/cost proxies) + template management.
- Both reuse `AdminShell`/`ADMIN_NAV` — no separate admin app.

## 10. Rollback

1. Set `AI_TRADING_TEAMS_ENABLED=false` (env) — feature off, no code change.
2. The feature writes only to its own RTDB paths — no existing market
   intelligence, strategy or backtest data is modified.
3. Existing features (AI Terminal, Scalping Terminal, Strategy Lab, EA Lab,
   workflows, dashboards, billing, admin nav) are untouched except additive
   nav entries and entry cards, which disappear with the flag.
