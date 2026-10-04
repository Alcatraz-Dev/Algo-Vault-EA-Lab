# AlgoVault Intelligence Fabric

The Unified AI Intelligence Layer ("Intelligence Fabric") is the shared AI
substrate for every AlgoVault trading surface. It is **additive**: it composes
the existing AI gateway, Market Intelligence engine, AI Signals, Strategy
Research, Performance Arena, Risk Engine, Workflows and Pro Scalping Terminal —
it never replaces or duplicates them.

```
MARKET FACTS (deterministic snapshots only)
      │  buildMarketIntelligenceContext (schema mic-1)
      ▼
DETERMINISTIC INTELLIGENCE (structure / HTF / liquidity / FVG / OB)
      │  deterministicLean()
      ▼
AI REASONING (UnifiedLLMRouter → free providers first, premium optional)
      │
      ▼
JEV VALIDATION (structured yes/no questions → BUY/SELL/HOLD + confidence)
      │
      ▼
DECISION ORCHESTRATOR (state machine, versioned)
      │
      ▼
RISK ENGINE  ← ALWAYS AUTHORITATIVE (fail ⇒ BLOCKED, AI opinions recorded only)
      │
      ▼
SIGNALS · TERMINAL · WORKFLOWS · RESEARCH · CHALLENGE · EXECUTION
```

## Modules (`lib/intelligence/`)

| Module | Responsibility |
| --- | --- |
| `flags.ts` | Per-component feature flags (every one an independent rollback switch) |
| `versions.ts` | Canonical version constants + `AI_TASKS` taxonomy + decision states |
| `types.ts` | Shared fabric types (AIRequest/AIResponse, MarketIntelligenceContext, JevResult, IntelligenceDecision) |
| `safety.ts` | Financial-language guard: banned-phrase detection + sanitizer |
| `provider-registry.ts` | Provider metadata (capabilities, cost class, region/privacy, kill switches). Env-var **names** only — never key values |
| `health.ts` | Circuit breaker (closed → open → half_open), EWMA latency, exponential cooldown |
| `router.ts` | `UnifiedLLMRouter`: task profiles, health/cost/priority scoring, honest `AI_UNAVAILABLE` |
| `market-context.ts` | Compact market-facts compression + fail-closed freshness gate |
| `jev.ts` | Jev structured validation (dedicated endpoint or schema-validated LLM profile) |
| `orchestrator.ts` | Decision state machine; **Risk Engine always wins** |
| `signal-bridge.ts` | AISignal enrichment (`intelligence` field on new signals) |
| `store.ts` | RTDB audit (`ai/decisions`, `ai/requests`) — compact, no prompts/CoT |
| `research-bridge.ts` | Interpretation-only AI assessment over deterministic research metrics |
| `challenge-bridge.ts` | Advisory AI challenge review over Performance Arena telemetry |
| `providers/openai-compatible.ts` | Groq / Cerebras / Mistral adapters (live `/models` catalogs) |
| `providers/anthropic.ts` | Optional Claude adapter (paid, gated) |

## Provider registry

Referenced ecosystem: `mnfst/awesome-free-llm-apis`. The registry stores
**provider-level** metadata (capabilities, free tier, rate limits, commercial
use, region restrictions, privacy policy) and never hardcodes model lists —
each adapter reports its live catalog at runtime. `verified: true` means "an
adapter is wired", **not** "endpoint live-tested in this deployment" (see
limitations). Claude (`paid`, `verified: false`) is routed only when policy
allows: admin tier, `allowPaidFallback`, or Pro deep-research tasks.

Routing factors (task profile → score): health (circuit state, reliability,
EWMA latency), free-first policy (+25 free, paid hard-gated unless allowed),
registry priority, capability fit (vision/coding/reasoning/longContext).
`AI_MAX_PROVIDER_ATTEMPTS` caps fallback attempts (default 4).

## Jev

Jev is a decision/validation layer — not the risk engine, not execution.
Nine fixed questions are pre-answered deterministically from market facts;
the model only adjudicates ambiguous ones and the final decision, under a
strict JSON schema. Free-form text never reaches the decision path. Without a
dedicated endpoint (`JEV_API_URL`/`JEV_API_KEY`) or a serving LLM, Jev reports
`UNAVAILABLE` honestly. `AI_JEV_POLICY=strict|degraded` governs pipeline
behavior when Jev is absent; degraded mode caps confidence at 60 and never
presents READY as fully validated.

## Risk Engine authority

The orchestrator treats the injected risk closure as authoritative: any
`approved: false` short-circuits the decision to `BLOCKED` /
`validationStatus: RISK_BLOCKED`, with Jev/LLM opinions preserved for audit
only. Server routes build the risk closure from `evaluateOrder()` server-side —
a client can never submit a risk verdict. The orchestrator itself is pure and
imports neither Firebase nor the risk engine.

## Integrations

- **AI Signals** (`lib/ai-signals/engine.ts`): new signals attach an optional
  `intelligence` block (decision state, Jev summary, factors) via
  `enrichSignalWithIntelligence` — fail-open, flag-gated.
- **Workflows** (`lib/workflows/node-registry.ts`, `executors.ts`): six
  `intelligence.*` nodes (analyze_market, classify_regime, evaluate_setup,
  jev_validate, explain_signal, detect_anomaly) that fail honestly with
  `AI_UNAVAILABLE` payloads when no provider serves.
- **API**: `/api/ai/providers`, `/api/ai/health`, `/api/ai/analyze`,
  `/api/ai/decision`, `/api/ai/validate`, `/api/ai/challenge-review` (via the
  arena route), `/api/scalping/intelligence` (Pro-gated),
  `/api/admin/ai/intelligence/decisions`.
- **Strategy Research**: `POST
  /api/strategy-research/missions/[id]/candidates/[candidateId]/ai-assess`
  builds the compact deterministic snapshot from storage (never client input)
  and returns an interpretation-only assessment. It can never alter scores or
  lifecycle decisions.
- **Performance Arena**: `GET/POST
  /api/performance-arena/attempts/[attemptId]/ai-review` composes the Arena's
  own deterministic state (`getAttemptState` → metrics, Guardian insights,
  requirements, RULE_* events) into an advisory narrative. Rules, accounting
  and settlement are untouched; the credit-charged Guardian AI pass is
  unchanged.
- **Pro Scalping Terminal**: `IntelligencePanel` (decision chip, confidence,
  JEV badge, Why? factors, risk PASS/FAIL) polling `/api/scalping/intelligence`.
- **Admin**: `/admin/ai/monitor` — provider health table + decision audit log.

## Pro gating

`DEEP_STRATEGY_RESEARCH`, `LONG_CONTEXT_RESEARCH` and `HYPOTHESIS_GENERATION`
tasks require Pro (`isProUser`). `/api/scalping/intelligence` and the Pro
terminal intelligence panel are Pro-gated. Free users keep fast tasks
(classification, explanation, validation) through free providers.

## Feature flags / rollback

`UNIFIED_AI_INTELLIGENCE` (master) → `JEV_DECISION_ENGINE`, `FREE_LLM_ROUTER`,
`MULTI_MODEL_ROUTING`, `AI_CHALLENGE_REVIEW`, `AI_STRATEGY_RESEARCH`,
`AI_PRO_SCALPING_INTELLIGENCE`, `AI_INTELLIGENCE_AUDIT`. Per-provider kill
switches: `AI_PROVIDER_<ID>_DISABLED=1`. With every flag off — or every key
absent — deterministic functionality is unchanged and AI stages report honest
`AI_UNAVAILABLE`.

## Tests

`npm run test:intelligence` — 73 offline checks: flags, safety language,
registry integrity (no key values), market-context gates, circuit-breaker
state machine, router fallback + honest failure + paid gating, Jev parsing +
deterministic answers, orchestrator (INVALID / AI_UNAVAILABLE / READY /
**risk-wins BLOCKED**), research + challenge bridges.

## Known limitations

- Groq, Cerebras, Mistral and Claude adapters are wired but **not live-tested**
  (no credentials in this deployment); they follow the exact request/response
  shape of the verified legacy providers and are marked `verified: false`
  until exercised.
- No real Jev service is known; the dedicated-endpoint path is exercised only
  by the offline stub in tests.
- Health tracking and rate-limit budgets are in-memory per server process;
  they do not survive cold starts (by design — facts are recomputed cheaply).
- Audit persistence is best-effort and swallows storage errors.
