# Marketing Agent — Architecture

The Marketing Agent is an autonomous marketing employee layered on top of the
existing AlgoVault Growth / Marketing Factory. A user writes one natural-language
instruction; the agent plans, captures the real product UI, produces a creative
through Hypit, QA-gates it, schedules it, publishes it through official platform
APIs, verifies publication, and feeds performance back into future creative
generation.

This document is the system of record for how the pieces fit together.
Companion docs: [hypit-setup.md](./hypit-setup.md),
[browser-capture.md](./browser-capture.md), [publishing.md](./publishing.md),
[operations.md](./operations.md), [extending.md](./extending.md).

---

## 1. Reuse rules (non-negotiable)

The agent **extends** AlgoVault; it never duplicates it:

| Concern | Reused system (never rebuilt) |
| --- | --- |
| Database | Firebase RTDB only (`database.rules.json`); no Firestore |
| Campaigns / creatives / assets / variants / analytics | pre-existing `marketing*` RTDB entities |
| Cron / scheduling execution | existing growth cron (`/api/growth/cron/[job]`, `lib/growth/jobs`, `vercel.json` crons) |
| AI orchestration | existing AI router (`lib/ai/router.ts`) — the agent's "sub-agents" are logical roles, not separate models |
| Workflow engine | existing Workflow Logic workspace (`lib/workflows/node-registry.ts`, `executors.ts`) |
| Auth / permissions | existing `requireGrowthAdmin`, Pro/Admin gating, `useAdminFetch` / `adminFetch` |
| Media pipeline | existing Marketing Factory (`lib/marketing-media/*` — ffmpeg, TTS, captions) |
| Compliance / disclaimers | existing growth compliance + `MARKETING_DEMO_LABEL` |
| Admin UI | existing Growth navigation (`app/admin/growth/layout.tsx`) |

## 2. Logical agent architecture (§3)

```
MarketingAgent                 lib/marketing-agent/agent.ts (orchestrator)
├── IntentParser               intent.ts            — deterministic-first NL parse (+ optional AI pass)
├── CampaignPlanner            planner.ts           — plan + resumable task graph
├── ProductKnowledgeAgent      product-knowledge.ts — routes, approved facts, CTA destinations
├── Claims / Compliance        claims.ts, qa.ts     — §50 classification, §51 blocked claims
├── BrowserDemoAgent           browser/{plan,sanitize,providers,engine}.ts
├── CreativeDirector           production/director.ts  — REAL PRODUCT → EXPLAIN → BENEFIT → PROOF → CTA
├── ScriptAgent / Storyboard   production/script.ts    — duration-fitted script + shot list
├── AssetAgent                 production/composition.ts — composition document
├── HypitProductionAgent       hypit/{provider,svml}.ts  — SVML + Hypit CLI adapter
├── Variants / Recipes         production/{variants,recipe}.ts — lineage + reuse
├── QualityAgent               qa.ts               — 8 gates → READY_FOR_APPROVAL
├── DistributionAgent          utm.ts, production/copy.ts, scheduling.ts
├── PublishingAgent            publishing/{state-machine,providers,engine}.ts
├── AnalyticsAgent             analytics.ts, metrics-collector.ts
└── LearningAgent              analytics.ts (observations with sample size + confidence)
```

`server.ts` is the server-side facade; `storage.ts` is the only RTDB I/O layer;
`permissions.ts` is the tool allowlist; `settings.ts` owns admin settings.
Everything expensive runs from `cron.ts` / job ticks — never inside a request.

## 3. Task graph (§4)

`MARKETING_AGENT_TASKS` (`collections.ts`) is the canonical 27-task pipeline:

```
understand_request → identify_product → identify_audience → identify_platforms
→ determine_duration → verify_product_facts → build_capture_plan
→ build_creative_brief → write_script → write_shot_list → capture_product
→ generate_assets → compose_video → add_audio → add_captions → add_motion
→ apply_branding → apply_disclaimer → render_platforms → run_qa
→ generate_publishing_assets → request_approval → schedule → publish
→ verify_publication → collect_performance → generate_learning
```

* The graph is **resumable**: `planner.ts` exposes `selectTasks`,
  `topologicalOrder`, `readyTasks`, `resumeCursor`. A job that fails at
  `generate_assets` restarts from that cursor — completed tasks are not re-run.
* The live UI shows each task's pending / running / done / failed state
  (§43 progress timeline) straight off the job record.
* Downstream tasks depend on the command: `ANALYZE` / `REFRESH` append
  `collect_performance` + `generate_learning`.

## 4. Intent parsing (§2, §72)

`intent.ts` parses without spending AI budget: command, product, platforms,
languages, duration, tone, objective, audience, browser-demo need, voiceover
constraint, variant count, schedule/publish intent, references to previous
creatives ("last week's AI Signals video"), and user-requested claims (which
must pass §51). Pattern order matters — first match wins — with generic CREATE
after specific commands (REMIX, TRANSLATE, ANALYZE, VARIANT …) but before
secondary actions (SCHEDULE, PUBLISH). `parseIntentWithAi` is used only when
`needsAiClarification` is true, and always falls back to the deterministic
result (the deterministic parse is a valid answer).

## 5. Creative production pipeline (§11–§23)

1. `production/director.ts` — decides what to show for the product/audience.
2. `production/script.ts` — script + shot list built **only** from approved
   claims (`claims.ts`), fitted to the target duration.
3. `browser/plan.ts` — executable, reproducible `BrowserCapturePlan`
   (target page, steps, required state, elements to highlight, sensitive
   regions, fallback). See browser-capture.md.
4. `production/composition.ts` — the persisted, editable
   `CompositionDocument` (timeline, captions, audio+ducking, motion layer,
   branding, disclaimer, demo label). `recompose()` produces 9:16 / 1:1 / 4:5 /
   16:9 variants by re-laying-out, not cropping.
5. `hypit/svml.ts` — renders the document as SVML
   (`<?svml using="@hypit/markup@1"?>`) plus a Run Source (`@hypit/run-markup@1`),
   handed to the Hypit CLI by `hypit/provider.ts`. The JSON document — not the
   MP4 — is the system of record, so any version can be re-rendered.
6. `qa.ts` — technical, visual, brand, claim, platform, audio, caption, and
   privacy gates. Only a passing creative reaches `READY_FOR_APPROVAL`.
7. `production/copy.ts` + `utm.ts` — per-platform title/caption/description/
   hashtags/first-comment and per-variant UTM parameters.
8. `production/variants.ts` — exactly `count` variants (hard cap
   `MARKETING_AGENT_DEFAULTS.maxVariants = 10`), each with unbroken lineage
   (`deriveVersionLineage`: parent → variant → variant).
9. `production/recipe.ts` — every completed creative yields a reusable recipe
   ("run this recipe again with the new feature"), with `rebindRecipe`.

## 6. Modes and approval (§39, §40)

* Modes: `MANUAL` (agent prepares, user publishes), `ASSISTED` (user approves,
  system schedules/publishes), `AUTONOMOUS` (bounded by admin rules).
  `modes.ts` gates scheduling/publishing per mode.
* Approval policies (`MARKETING_APPROVAL_POLICIES`): `ALWAYS_REQUIRED`,
  `REQUIRED_FOR_TRADING_CLAIMS`, `REQUIRED_FOR_NEW_CAMPAIGN`,
  `AUTO_APPROVE_TEMPLATE`, `AUTO_APPROVE_ALL`.
* Autonomous mode still obeys compliance, approved claims, platform
  permissions, budget limits and campaign boundaries — never "publish
  anything the model invents".

## 7. Tool permissions & prompt injection (§47–§49)

`MARKETING_AGENT_TOOLS` defines the 15 allowlisted tools
(`marketing.searchProduct` … `marketing.generateInsights`). Each is gated by
`MARKETING_AGENT_TOOL_MODES`, validated, authorized, audited, and time-boxed
(`toolTimeoutMs = 60s`) in `permissions.ts`. The agent can never execute shell
commands from a prompt or read secrets. Captured/ingested page text is treated
as untrusted data: `permissions.ts` includes `containsInjectionAttempt`, and
`browser/sanitize.ts` strips forbidden content before anything reaches a
creative.

## 8. Product data & claims safety (§50–§52)

`product-knowledge.ts` classifies statements
(`VERIFIED / UNVERIFIED / SENSITIVE / PRIVATE / MARKETING_SAFE`); only
`MARKETING_SAFE` content auto-enters a creative. `claims.ts` blocks
"guaranteed profit", "risk-free", "100% win rate", etc. unless a verified
policy explicitly allows the wording; factual language is substituted.
External URLs are rejected — CTA destinations only resolve to real app routes
(`resolveCtaDestination` returns `null` for anything else).

## 9. Cost control (§46)

`cost.ts` estimates the workload **before** generation:
`units = videos × variants × languages × platforms`, with hard caps
(`maxProductionUnits = 48`, `maxVariants = 10`, `maxDailyJobs = 40`,
`maxConcurrentJobs = 3`, `maxRetries = 4`) and a daily budget check
(`checkDailyBudget`) fed by stored usage. A blocked request fails closed with
an explanation instead of silently truncating.

## 10. RTDB schema (§61)

All admin-readable/writable, indexed (see `database.rules.json`):

| Collection | Purpose |
| --- | --- |
| `marketingAgentJobs` | runs of the agent (task cursor, state, errors) |
| `marketingPlans` | campaign plans produced from intent |
| `marketingBrowserCaptures` | capture records (state, fingerprint → STALE detection) |
| `marketingCreativeVersions` | version graph with parent/root lineage |
| `marketingCreativeRecipes` | reusable recipes + use counts |
| `marketingPublishingJobs` | publishing state machine records |
| `marketingSchedules` | schedules (next run, recurrence, window, run count) |
| `marketingSocialAccounts` | connection state, permissions, token health |
| `marketingPerformance` | collected platform metrics per external id |
| `marketingLearning` | observations with metric, sample size, confidence |
| `marketingClaims` | claim decisions (audit) |
| `marketingAgentSettings` | admin settings / feature flags / tool toggles |

Pre-existing entities (`marketingCampaigns`, `marketingCreatives`,
`marketingJobs`, `marketingAssets`, `marketingVariants`, `marketingAnalytics`)
are **reused, not duplicated**.

## 11. Surfaces

* **UI**: `app/admin/growth/marketing-agent/page.tsx` (Creative Studio +
  live progress + queue + publishing + settings), reachable from the existing
  Growth navigation.
* **API** (all under `requireGrowthAdmin`, server-side only):
  `app/api/admin/marketing-agent/{route,run,jobs,jobs/[id],publishing,
  schedules,social,settings}` plus `app/api/growth/cron/marketing-agent`.
* **Workflow nodes** (7, registered in `lib/workflows/node-registry.ts` +
  `executors.ts`): `marketing.agent.prompt`, `marketing.agent.capture_plan`,
  `marketing.agent.produce`, `marketing.agent.qa`, `marketing.agent.schedule`,
  `marketing.agent.publish`, `marketing.agent.analyze`.
* **Cron**: job name `marketing-agent` handled in `lib/growth/jobs/index.ts`
  (bucketed `jobKey`), scheduled `*/5 * * * *` in `vercel.json`. The tick
  advances due schedules, executes publishing jobs, verifies, collects
  metrics, and refreshes social account health.

## 12. Testing (§81)

```bash
npm run test:marketing-agent   # 259 assertions, no external services
npm run test:marketing         # Marketing Factory regression
npm run test:growth            # Growth engine regression
npm run test:workflows         # workflow engine regression
npx tsc --noEmit | grep marketing-agent   # must print nothing
```

The publishing engine is tested against an in-memory store and a mock
connector (§82) — no real network, no real publishing. Real publishing
requires explicitly configured credentials **and** the publishing feature flag.
