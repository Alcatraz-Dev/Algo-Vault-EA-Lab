# Marketing Agent — Operations

Environment variables, deployment, observability, admin controls, security
and troubleshooting. Env reference of record: `.env.example`
(section *MARKETING AGENT*).

---

## 1. Environment variables (§87)

Legend: **required** = subsystem fails closed (`NOT_CONFIGURED`) without it ·
**optional** = degrades gracefully · **dev** = safe local default ·
**prod** = must be set before enabling the flag. Secrets are server-side only.

| Variable | Class | Purpose |
| --- | --- | --- |
| `CRON_SECRET` | required · prod | auth for `/api/growth/cron/marketing-agent` and `/api/growth/cron/[job]`; without it the publish tick never runs |
| `NEXT_PUBLIC_APP_URL` | required · prod | capture base URL + default CTA host (never a secret) |
| `MARKETING_AGENT_WORKSPACE` | optional · dev (`/tmp/marketing-agent`) | server-side workspace for Hypit projects, captures, renders |
| `MARKETING_AGENT_ENABLED` | optional · prod | master feature flag (admin UI is authoritative at runtime) |
| `MARKETING_AGENT_BROWSER_CAPTURE_ENABLED` | optional | browser capture flag |
| `MARKETING_AGENT_PUBLISHING_ENABLED` | optional (default **false**) | publishing flag — off until credentials are verified |
| `MARKETING_HYPIT_ENABLED` | optional | Hypit production flag (rollback, §90) |
| `HYPIIIT_CLI_PATH` | optional | pinned Hypit executable (see hypit-setup.md) |
| `MARKETING_BROWSER_CAPTURE_ENABLED` | optional | capture runtime selector |
| `MARKETING_CAPTURE_BASE_URL` | optional | defaults to `NEXT_PUBLIC_APP_URL` |
| `META_PAGE_ID`, `INSTAGRAM_ACCESS_TOKEN`, `FACEBOOK_ACCESS_TOKEN` | optional | Meta/Instagram connectors |
| `YOUTUBE_OAUTH_ACCESS_TOKEN` / `YOUTUBE_ACCESS_TOKEN` | optional | YouTube upload (scope `youtube.upload`) |
| `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN` | optional | LinkedIn UGC |
| `X_BEARER_TOKEN`, `X_ACCESS_TOKEN` | optional | X API v2 |
| `TIKTOK_ACCESS_TOKEN` | optional | TikTok Content Posting |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `TTS_PROVIDER` | reused from Marketing Factory | render/TTS runtime |

Rules: unset secret ⇒ `NOT_CONFIGURED` shown in the UI (never silent
failure); secrets never appear in client code, logs, or RTDB (§88).

## 2. Deployment (§79, §83)

* **HTTP**: routes under `app/api/admin/marketing-agent/*`, guarded by
  `requireGrowthAdmin` + `useAdminFetch`/`adminFetch` from the admin UI.
* **Cron**: `vercel.json` → `*/5 * * * *` → `/api/growth/cron/marketing-agent`
  → existing growth job runner (`lib/growth/jobs`, job name
  `marketing-agent`, bucketed `jobKey` for concurrency safety).
* **Long-running work** (browser capture, Hypit render) must run where the
  binaries exist — a persistent worker or container host with
  `HYPIIIT_CLI_PATH`, `FFMPEG_PATH` and a writable workspace. Serverless
  requests never render video; if no worker exists, keep
  `MARKETING_HYPIT_ENABLED=false` and the system still plans, QA's, schedules
  and publishes honestly.
* **Rollback**: every subsystem is feature-flagged (§90); disabling Hypit or
  capture never affects Growth, Marketing Factory, or workflows.

## 3. Observability (§88)

Every job record carries: `jobId, campaignId, creativeId, userId, provider,
stage, status, startedAt, completedAt, duration, retryCount, errorCode`.
Audit entries (`storage.ts` `audit()`) cover capture, generation, approval,
schedule, publication, deletion, credential changes — with actor
(agent/user), platform, and external id. Never logged: tokens, passwords, API
keys, private customer data.

The admin UI (Growth → Marketing Agent) shows: active campaigns, production
jobs, scheduled/published/failed posts, connected accounts with health, and
creative performance — extending the existing command center, not a second
dashboard (§41).

## 4. Admin controls (§89)

`marketingAgentSettings` (admin-only read/write in `database.rules.json`):
agent enabled, autonomous mode, Hypit enabled, browser capture enabled,
publishing enabled, allowed platforms, approval policy
(`ALWAYS_REQUIRED … AUTO_APPROVE_ALL`), max variants / production units /
daily jobs / concurrency / retries, tool enablement per mode
(`tools[]`), claim policy, default disclaimers. Env vars seed defaults; the
settings record wins at runtime.

## 5. Security summary (§47)

* Admin-only API (`requireGrowthAdmin`); Pro/Admin permissions preserved.
* Tool allowlist + per-mode gating + validation + audit + 60s timeout.
* No arbitrary shell execution from prompts; no access to customer accounts,
  payment data, or unrelated admin pages.
* Browser capture restricted to the demo profile and route allowlist;
  captured text treated as untrusted (prompt-injection defenses).
* Credentials server-side only; RTDB rules restrict every marketing node to
  admin auth.

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Cron tick does nothing | missing/incorrect `CRON_SECRET` | set secret; call with `Authorization: Bearer` |
| Jobs stuck `NOT_CONFIGURED` | provider env missing | set the relevant env; check admin Settings panel |
| Publish stuck `RETRYING` | transient/rate-limit | wait for backoff window; inspect `lastError` |
| Publish `PUBLISH_VERIFICATION_REQUIRED` | unverified or duplicate outcome | verify in Social Accounts / platform, then retry or cancel |
| Auth failures (`FAILED`, reconnect required) | expired/revoked token | reconnect the account — retries are intentionally blocked |
| Renders `DISABLED` | `MARKETING_HYPIT_ENABLED=false` | re-enable only after `hypit doctor` passes |
| Budget rejections | daily limits | raise limits in settings or wait for UTC-day reset |

## 7. Verification commands

```bash
npm run test:marketing-agent   # 259 assertions — expect 0 failed
npm run test:marketing && npm run test:growth && npm run test:workflows
npx tsc --noEmit | grep marketing-agent   # expect no output
```
