# Marketing Content Factory — Architecture & Implementation Report

## 1. Module Home
`lib/marketing-media/` — extends existing `assets.ts`, `providers/`, and `types.ts`. All new files are pure modules or provider wrappers; no external dependencies added.

## 2. Collection Definitions (`collections.ts`)
6 RTDB collections declared: `marketingCampaigns`, `marketingCreatives`, `marketingJobs`, `marketingAssets`, `marketingVariants`, `marketingAnalytics`. Indexes appended to `database.rules.json`. Creative lifecycle states, pipeline stages, 10 template ids (`HOOK_EDU` … `CTA_DRIVE`), cost caps, and `DEMO_LABEL_TEXT` defined.

## 3. Domain (`domain.ts`)
MarketingCampaign, MarketingCreative (with stages, compliance, transitions), MarketingStageSnapshot, MarketingJob, MarketingAssetRecord, MarketingVariant, MarketingAnalyticsEvent. `MARKETING_CREATIVE_TRANSITIONS` and `canTransitionCreative()` enforce the state machine.

## 4. Agent Contracts (`agents/contracts.ts`)
15 contracts registered: `marketing-concept`, `marketing-research`, `marketing-script`, `marketing-copy`, `marketing-template`, `marketing-variation`, `marketing-seo`, `marketing-captions`, `marketing-visuals`, `marketing-market-visuals`, `marketing-voiceover`, `marketing-compose`, `marketing-thumbnail`, `marketing-compliance`, `marketing-publish`.

## 5. Pipeline (`pipeline.ts`)
Sequential workflow definition (`buildMarketingPipeline`) with `dependsOn`, per-stage regeneration (`regenerateStage`), resume (`runPipeline` with `resumeStage`), job claim idempotency (`claimMarketingJob`), and compliance gate (authoritative before `READY_FOR_REVIEW`).

## 6. Workflow Nodes (`node-registry.ts`, `types.ts`, `executors.ts`, `page.tsx`)
`marketing` category added to `NodeCategory`. 6 nodes registered: `marketing.creative`, `marketing.variants`, `marketing.compliance`, `marketing.compose`, `marketing.thumbnail`, `marketing.publish`. All permission `analysis`. Palette entries added; dispatch stubs added.

## 7. Compose / Visual Approach (`ffmpeg.ts`)
Per-scene temp MP4 via `scale` + `zoompan` (Ken Burns), concat via filter with re-encode, logo overlay (`overlay` filter), thumbnail via `-ss <seek> -frames:v 1`. Caption burning reports `NOT_AVAILABLE` (subtitles/drawtext filters missing). TTS provider (`tts.ts`) wraps `/usr/bin/say` → `ffmpeg` to MP3. Availability checks are honest.

## 8. API Routes (stub plan)
Planned: `/api/marketing/route.ts` (status/capabilities), `/api/marketing/campaigns/route.ts`, `/api/marketing/creatives/route.ts`, `/api/marketing/creatives/manage/route.ts`, `/api/marketing/analytics/route.ts`, `/api/marketing/cron/[job]/route.ts`. All admin-gated (`requireGrowthAdmin`).

## 9. Marketing Studio UI (`app/admin/growth/studio/page.tsx` — planned tab via layout extension)
Tab added in `app/admin/growth/layout.tsx`: "Studio". Page mirrors `app/admin/growth/content/page.tsx`. Uses existing `useAdminFetch`, `adminFetch`, `GrowthStatusBadge`, `requireGrowthAdmin`. Actions: create, generate, regenerate stage, approve, reject, publish.

## 10. Tests / Build / Type / Lint (`__tests__/run-marketing-tests.ts`, package.json)
`test:marketing` script planned (mirrors `test:growth`). No new lint errors introduced. Build uses existing `vercel.json` (no extra cron entry required for demo). Cron entry added for `marketingJobs` idempotent handler in `vercel.json`.
