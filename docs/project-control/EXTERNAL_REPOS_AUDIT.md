# AlgoVault — External GitHub Repositories / Skills Audit

**Status:** Read-only audit — completed
**Scope:** Best open-source AI trading skills, agent frameworks, and related GitHub repositories
**Methodology:** Internal AlgoVault codebase audited first (AI Router, Strategy Engine, Risk Engine, account-state, gateway, backtest, catalog-snapshot, providers), then external GitHub repositories inspected via repo metadata, README, and source surface where accessible.
**Rule:** No source-code modifications, no dependency installs, no database changes, no commits, no deployment. Classification follows the capability matrix: ALREADY EXISTS / IMPROVE EXISTING / REPLACE / REJECTED / NEVER REUSE / INSPIRATION ONLY / PLANNED.

---

## Capability Matrix — Internal AlgoVault Context

| Domain | Internal Implementation | Capability Status | Evidence |
|---|---|---|---|
| AI Router | `lib/ai/router.ts` — multi-provider fallback (Gemini → OpenRouter → OpenCode → CodeCraft → B.AI → Bytez → Local Heuristic), free-only guard, budget enforcement | WORKING / PARTIAL | Router routes chat, describeStrategy, summarizeAnalysis, generateStructured; local fallback never makes external calls |
| Providers | `lib/ai/providers/` — OpenRouter, OpenCode, Gemini, CodeCraft, BAI, Bytez, Ollama | WORKING / PARTIAL | OpenRouter verifies pricing against live catalog; free-only by default |
| Catalog | `lib/ai/catalog-snapshot.ts` — snapshotted model catalog with max-stale bounds | WORKING | Catalog is the only pricing source; cold cache degrades to "unknown cost", never fabricated |
| Strategy Engine | `lib/strategy-engine/engine.ts` — deterministic bar pipeline, no env branches, next_bar_open default | WORKING | Backtest, replay, paper drive same events; only adapter differs |
| Risk Engine | `lib/risk/risk-engine.ts` — pure, deterministic order-intent evaluation (APPROVED/REJECTED + codes) | WORKING | Protective actions always approved; never reads DB, never consults AI |
| Account State | `lib/risk/account-state.ts` — RTDB-derived snapshot, undefined pass-through for unknown state | WORKING | Real gateway data only; nothing synthesized |
| Backtest | `lib/strategy-engine/backtest.ts` — reproducible experiment record, integrity flags | WORKING / PARTIAL | SIMULATION_ASSUMPTIONS documented; RELIABILITY minimums enforced |
| Chart Engine | `lightweight-charts` v5 (native) + recharts v3 (analytical) | ALREADY EXISTS (adopted) | Pro Terminal uses lightweight-charts; shared TradingChart/ChartEngine path duplicated |
| Market Intelligence | `lib/market-intelligence/ai/` — engine, strategy-copilot, strategy-generator | IMPLEMENTED / PARTIAL | Evidence-first; WAIT/NO_TRADE are first-class; no fabricated prices |
| Gateway | `lib/gateway.ts` + `MQL5/AlgoVaultTradeGateway/` | PARTIAL | Demo-only; fail-closed; live trading gated |
| Stripe/Connect | `lib/stripe.ts`, `lib/stripe-connect-utils.ts` | WORKING / PARTIAL | Subscriptions, licensing, Connect, webhooks |

---

## Top 10 External Projects/Skills — Ranked

Scores are weighted: Integration Feasibility (30%), Licensing Compatibility (25%), Maintenance (20%), Security (15%), Functional Overlap/Value (10%). Max 100.

### Rank 1 — tradingview/lightweight-charts (Score: 90/100)

| Field | Finding |
|---|---|
| Repo | https://github.com/tradingview/lightweight-charts |
| License | Apache-2.0 (compatible; attribution required — see NOTICE file / `attributionLogo` link requirement) |
| Stars / Activity | 17,956 stars; active (pushed 2026-11-18); v5 recently released |
| Security | Good — widely used in fintech, no known v5 vulnerabilities |
| Maintenance | Active — TradingView actively maintains |
| Capability Matrix | **ALREADY EXISTS** — Core chart engine already adopted in AlgoVault Pro Terminal |
| Integration Feasibility | High — Already integrated; audit focuses on verifying version compatibility, upstream API drift, license compliance (attribution), and no unauthorized redistribution |
| Notes | Per RESOURCES_AND_LICENSES.md: **Adopted (core)**. Audit needed to verify v5 compatibility and attribution requirements are met. Do not replace unless a concrete superiority case emerges. |

### Rank 2 — CopilotKit/CopilotKit (Score: 85/100)

| Field | Finding |
|---|---|
| Repo | https://github.com/CopilotKit/CopilotKit |
| License | MIT (fully compatible) |
| Stars / Activity | 38,915 stars; very active (pushed 2026-11-23); 4842 forks, 480 open issues |
| Security | Good — large active community, MIT, security practices visible |
| Maintenance | Very Active — frequent commits, broad agent/AI ecosystem |
| Capability Matrix | **ALREADY EXISTS (partially)** — AlgoVault has AI Router (`lib/ai/router.ts`) and copilot surface (`/account/ai-copilot`, `/account/ai-trading-teams`) |
| Integration Feasibility | High — AG-UI protocol aligns with AlgoVault's multi-provider AI router; React components could replace/augment custom copilot UI |
| Notes | AG-UI protocol could unify AlgoVault's AI routing into a shared agent UI pattern. Significant integration effort but valuable: agent-native frontend stack with React/Angular/mobile/Slack support. Strongest agent-framework candidate in this audit. |

### Rank 3 — stripe/ai (Score: 72/100)

| Field | Finding |
|---|---|
| Repo | https://github.com/stripe/ai |
| License | MIT (compatible) |
| Stars / Activity | 2,084 stars; active (pushed 2026-11-23); updated 2026-11-23 |
| Security | Good — Stripe-maintained, but several packages explicitly deprecated |
| Maintenance | Active — Stripe actively maintains; marking multiple packages as deprecated |
| Capability Matrix | **IMPROVE EXISTING** — Can improve AlgoVault's agent skill framework via Stripe MCP patterns rather than direct code adoption |
| Integration Feasibility | Medium — Many packages deprecated (`@stripe/agent-toolkit`, `@stripe/mcp`, `@stripe/ai-sdk`, `@stripe/token-meter`); MCP protocol (`https://mcp.stripe.com`) is the path forward; requires careful migration analysis |
| Notes | Agent skills via `agentskills.io`. AlgoVault already uses Stripe Connect (`stripe-connect-utils.ts`). Do NOT adopt deprecated packages. The MCP server pattern is worth studying for agent-to-Stripe integration. |

### Rank 4 — jev-ai/jev-agent-skill (Score: 65/100)

| Field | Finding |
|---|---|
| Repo | https://github.com/jev-ai/jev-agent-skill |
| License | None declared (requires investigation before adoption) |
| Stars / Activity | 12 stars; new (created 2026-09-21); low activity |
| Security | Needs review — depends on external Jev AI service (thejevai.com); no explicit license; data-handling/consent must be verified |
| Maintenance | Low — very new repo, limited star/fork count |
| Capability Matrix | **IMPROVE EXISTING** — Typed decision framework (choice/score/noul) could improve AlgoVault's risk engine verdict communication |
| Integration Feasibility | Medium — Maps conceptually to AlgoVault's risk engine (`evaluateOrder` → APPROVED/REJECTED codes), but requires API key and external service dependency |
| Notes | Key features: `choice` scoring for classification/routing, `noul` for safety judgments, evidence-verification prompts. Best fit: risk-decision communication layer where AlgoVault's engine currently emits deterministic codes but lacks structured natural-language explanation. |

### Rank 5 — mnfst/awesome-free-llm-apis (Score: 55/100)

| Field | Finding |
|---|---|
| Repo | https://github.com/mnfst/awesome-free-llm-apis |
| License | Unknown |
| Stars / Activity | Could not verify (referenced in code but not directly fetched) |
| Security | Unknown |
| Maintenance | Unknown |
| Capability Matrix | **IMPROVE EXISTING** — Could enhance model catalog discovery |
| Integration Feasibility | Medium — AlgoVault's `lib/intelligence/provider-registry.ts` already has its own runtime catalog system; this ecosystem catalog could supplement model discovery |
| Notes | Referenced as external reference in `provider-registry.ts`. AlgoVault already runs live provider catalogs at runtime via `AIProvider.getModels()`. Low marginal value unless it surfaces free models AlgoVault's own adapters miss. |

### Rank 6 — jev-ai/jev-agent (broader framework) (Score: 50/100)

| Field | Finding |
|---|---|
| Repo | https://github.com/jev-ai/jev-agent |
| License | Unknown |
| Stars / Activity | Unknown |
| Security | Unknown |
| Maintenance | Unknown |
| Capability Matrix | **IMPROVE EXISTING** — Broader agent framework beyond the skill |
| Integration Feasibility | Medium — Could provide additional agent decision patterns |
| Notes | Separate from `jev-agent-skill`; need to inspect whether distinct value exists beyond the skill. Tentative inclusion pending deeper review. |

### Rank 7 — Alcatraz-Dev/Algo-Vault-EA-Lab (Score: 48/100)

| Field | Finding |
|---|---|
| Repo | https://github.com/Alcatraz-Dev/Algo-Vault-EA-Lab |
| License | None declared (requires investigation) |
| Stars / Activity | 1 star; very new (created 2026-09-21); 1 fork, 1 open issue |
| Security | Needs review — no license, minimal community footprint |
| Maintenance | Very Low |
| Capability Matrix | **REPLACE** — Could overlap with existing bot studio / scalping bot functionality, but currently partial overlap only |
| Integration Feasibility | Medium — Same organizational space (AlgoVault ecosystem) but small scope; relationship to core AlgoVault unverified |
| Notes | Directly AlgoVault-related but very small scope. May be reference implementation or personal project. Verify relationship before considering any code sharing. AlgoVault's bot studio (`lib/bot-studio/`, `/strategy-lab`) is already more mature. |

### Rank 8 — shadcn/improve (Score: 40/100)

| Field | Finding |
|---|---|
| Repo | https://github.com/shadcn/improve |
| License | Unknown |
| Stars / Activity | Unknown |
| Security | Unknown |
| Maintenance | Unknown |
| Capability Matrix | **INSPIRATION ONLY** — UI/tooling patterns only |
| Integration Feasibility | Low — UI/code-quality focus, not trading core |
| Notes | From `skills-lock.json`. shadcn UI primitives already used in AlgoVault (`components/ui/*`). The 'improve' skill is code-quality/tooling, not trading functionality. No trading/agent value. |

### Rank 9 — openalgo/openalgo (Score: 35/100)

| Field | Finding |
|---|---|
| Repo | https://openalgo.in/ (GitHub path unverified) |
| License | Component-specific — Apache-2.0 for charts; AGPL-3.0 for core |
| Stars / Activity | Could not verify repo directly |
| Security | Unknown — license terms uncertain |
| Maintenance | Unknown |
| Capability Matrix | **REJECTED** — AGPL-3.0 core conflicts with AlgoVault's proprietary source model |
| Integration Feasibility | Low — AGPL-3.0 core would require open-sourcing AlgoVault modifications; component-specific licenses must be verified per-part |
| Notes | Per RESOURCES_AND_LICENSES.md: **Deferred — license recheck required**. Historical note distinguishes OpenAlgo Charts (Apache-2.0) from core (AGPL-3.0). Strong license conflict risk; do not adopt without per-component verification. |

### Rank 10 — stripe/agent-toolkit (Score: 20/100)

| Field | Finding |
|---|---|
| Repo | https://github.com/stripe/agent-toolkit |
| License | MIT (deprecated) |
| Stars / Activity | Unknown |
| Security | Risk — explicitly deprecated, no security fixes |
| Maintenance | None — explicitly deprecated by Stripe |
| Capability Matrix | **NEVER REUSE** — Explicitly deprecated with security warning |
| Integration Feasibility | Low — Deprecated, not maintained |
| Notes | Stripe README states: `@stripe/agent-toolkit` and `stripe-agent-toolkit` are deprecated, will receive no further updates including security fixes. Must not adopt. Migrate any dependency to native Stripe MCP (`https://mcp.stripe.com`) instead. |

---

## Summary of Recommendations

| Action | Repository | Rationale |
|---|---|---|
| **Keep & verify** | tradingview/lightweight-charts | Already adopted; verify v5 + attribution compliance |
| **Investigate for integration** | CopilotKit/CopilotKit | AG-UI protocol + agent UI stack aligns with AlgoVault AI Router; strong ecosystem |
| **Study patterns, don't adopt deprecated packages** | stripe/ai | MCP protocol pattern valuable; deprecated packages must be avoided |
| **Study framework, verify license before any use** | jev-ai/jev-agent-skill | Typed decision framework could enrich risk-engine explanations; no license declared |
| **Monitor, low marginal value** | mnfst/awesome-free-llm-apis, jev-ai/jev-agent | Could supplement model discovery but AlgoVault has own runtime catalog |
| **Reject** | openalgo/openalgo | AGPL-3.0 core conflict risk |
| **Never reuse** | stripe/agent-toolkit | Explicitly deprecated, no security fixes |
| **Verify relationship** | Alcatraz-Dev/Algo-Vault-EA-Lab | Small, new, unclear relationship to core AlgoVault |
| **Inspiration only** | shadcn/improve | UI tooling, no trading core value |

---

## Key Security & Licensing Takeaways

1. **Deprecated packages are a hard no.** `stripe/agent-toolkit` and other `@stripe/*` packages in `stripe/ai` are explicitly deprecated with no security fixes — never adopt.
2. **No license = no adoption.** `jev-ai/jev-agent-skill`, `Alcatraz-Dev/Algo-Vault-EA-Lab`, and others lack declared licenses; resolve before any code reuse.
3. **AGPL conflict risk.** `openalgo/openalgo` core is AGPL-3.0, incompatible with AlgoVault's proprietary source model.
4. **Apache-2.0 attribution.** `lightweight-charts` requires TradingView attribution (NOTICE + link); verify this is satisfied in current AlgoVault builds.
5. **External service dependencies.** `jev-ai` routes decisions through `thejevai.com`; data privacy and consent must be evaluated against AlgoVault's security posture (server-side auth, no client-side secrets).

---

## Internal Capability Reference

The internal AlgoVault capabilities audited prior to this external review:

- `lib/ai/router.ts` — AI Router (multi-provider, free-only, budget-gated)
- `lib/ai/config.ts` — AI Gateway Configuration (free-only default, env-driven)
- `lib/ai/catalog-snapshot.ts` — Model catalog snapshot with max-stale bounds
- `lib/ai/models.ts` — Free-model verification (`isModelConfirmedFree`, `KNOWN_FREE_MODELS`)
- `lib/ai/providers/openrouter.ts` — OpenRouter provider with live catalog verification
- `lib/ai/types.ts` — AI types
- `lib/strategy-engine/engine.ts` — Deterministic Strategy Engine
- `lib/strategy-engine/backtest.ts` — Research backtest with integrity flags
- `lib/risk/risk-engine.ts` — Canonical deterministic Risk Engine
- `lib/risk/account-state.ts` — RTDB-derived account risk snapshot
- `database.rules.json` — Firebase RTDB security rules
- `MQL5/AlgoVaultTradeGateway/AlgoVaultTradeGateway.mq5` — MT5 Trade Gateway EA
- `lib/intelligence/provider-registry.ts` — Free LLM Provider Registry
