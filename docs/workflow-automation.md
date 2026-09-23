# Workflow Automation — Architecture

Canonical domain: `lib/workflows/`.

## Node Registry
- Category-based (`trigger`, `market_data`, `technical`, `ai`, `logic`, `risk`, `signal`, `execution`, `notification`, `integration`, `storage`, `http`, `transform`, `simulation`, `reports`)
- Contracts define `permission` (`analysis`/`signal`/`execution`/`none`), `timeoutMs`, `rateLimitPerMinute`, `noExecInTest`, `riskGuardRequired`
- Central registry: `node-registry.ts`

## Engine
- `engine.ts`: DAG scheduling with concurrency, retries, timeouts, cancellation (`AbortController`), idempotency (`saveNodeRecord` with `<runId>:<nodeId>`)
- Fetch-once market snapshots via `market.ts` + `MarketDataCache`
- Execution of nodes via `executors.ts` (reuses existing AI Router, notifications, gateway, risk engine)

## Persistence (RTDB only)
- `database.ts`: `workflowAutomation/{uid}/{id}` + versions, runs, node traces (`workflowAutomationRunNodes`), signals, requests, reports, variables
- Security rules in `database.rules.json` (owner/admin access, `userId` embedded for node traces)

## Scheduling
- `scheduler.ts` + `cron.ts`: bucketed due-queue (`scheduleQueue`) with tick endpoint (`/api/workflows/scheduler/tick`)
- Survives restarts because all state is in RTDB

## Pro Gating
- `limits.ts`: `getAdminSubscriptionStatus` server-side check
- Every API route enforces server-side (`resolveEntitlement`, `workflowDenied`)
- 403 with `{ error, hasPro: false, upgrade: true }`

## AI Builder
- `ai-builder.ts`: generates draft from prompt, validates against registry, NEVER activates automatically
- `generateWorkflowDraft` uses `defaultRouter.generateText` with constrained prompt

## Tests
- `lib/workflows/__tests__/run-workflow-tests.ts`: registry, validation, DAG, callbacks, TA, cron, rate limiter, paths
- Existing agent tests (`lib/agents/__tests__/`) pass
