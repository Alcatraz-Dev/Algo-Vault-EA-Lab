# Marketing Agent — Publishing, Scheduling & Credentials

Everything in this doc obeys one rule (§91): **a job becomes `PUBLISHED` only
after the external platform confirmed publication and the returned media id
was verified.** Otherwise the state stays honest (`RETRYING`,
`PUBLISH_VERIFICATION_REQUIRED`, `FAILED`).

---

## 1. Connector layer (§27, §63)

One `SocialPublisher` interface (`publishing/types.ts`), implemented by
dedicated adapters in `publishing/providers.ts`:

| Adapter | Official API surface |
| --- | --- |
| `TikTokPublisher` | TikTok Content Posting API (direct post) |
| `InstagramPublisher` (via `MetaPublisher`) | Instagram Graph API — `/media` REELS/STORIES containers |
| `FacebookPublisher` (via `MetaPublisher`) | Meta Graph API — `/{page-id}/video_uploads` |
| `YouTubePublisher` | YouTube Data API v3 — `videos.insert` + `videos.update` |
| `LinkedInPublisher` | LinkedIn UGC API — `/assets` + `/ugcPosts` |
| `XPublisher` | X API v2 — media upload (v1.1) + `/2/tweets` |

Each adapter exposes: `health`, `validatePermissions`, `uploadMedia`,
`createPost`, `schedulePost`, `getPost`, `getMetrics`, `refreshCredentials`.
Unsupported operations return `NOT_SUPPORTED` — **never scraped** (§64).
`registerSocialPublishers()` registers all six at engine entry.

## 2. Capabilities (§64, §65)

`publishing/capabilities.ts` `capabilityMatrix()` describes all 9 platform
surfaces (TIKTOK, INSTAGRAM_REELS, INSTAGRAM_STORIES, INSTAGRAM_FEED,
YOUTUBE, YOUTUBE_SHORTS, FACEBOOK, LINKEDIN, X): `canPublishVideo`,
`canScheduleNatively`, `canUploadThumbnail`, `canAddDescription`,
`canAddHashtags`, `canRetrieveMetrics`, caption limits, and the `apiSurface`
name. The UI adapts to capabilities — e.g. TikTok has **no** native scheduling
(AlgoVault's scheduler triggers publish instead), Instagram Stories has no
caption field, X caps captions at 280.

## 3. State machine (§28)

```
DRAFT → READY → SCHEDULED → QUEUED → PUBLISHING → PUBLISHED
 failure states: FAILED · RETRYING · CANCELLED · EXPIRED
                 PUBLISH_VERIFICATION_REQUIRED · NOT_SUPPORTED
```

`publishing/state-machine.ts` is the **only** way a job changes state:
* `transition()` refuses `PUBLISHED` without platform confirmation +
  external id + timestamp.
* The engine advances through **legal paths only** (e.g. READY → QUEUED →
  PUBLISHING → PUBLISHED); an unreachable target aborts the operation and the
  result reports the actual persisted state.
* `queuePreconditions()` enforces §55 before queueing: publishing enabled,
  approval granted, account connected, QA passed, schedule due, media,
  destination, and UTM present.

## 4. Reliability (§29, §56, §57)

`publishing/engine.ts`:
* **Idempotency keys** — stable across retries
  (`mk_<creative>_<version>_<platform>`); a second identical request is
  blocked and parked in `PUBLISH_VERIFICATION_REQUIRED`.
* **Verify before retry** — if a prior attempt is uncertain (it had an
  external id), `getPost` runs *before* any resubmission, so a timeout can
  never duplicate a post.
* **Classification** — transient / permanent / auth / rate limit / validation.
  Only retryable classes retry, with exponential backoff + jitter
  (`backoffDelayMs`), bounded by `maxAttempts` (`maxRetries = 4`).
* **Auth fails closed** — connectors classify AUTH only after their own
  credential refresh failed; the engine honors `retryable: false` and
  `shouldRetry(AUTH)` returns no-retry. A dead token needs a reconnect, not a
  retry loop.
* **Manual retry / cancel / resume** — `retryPublishingJob` (resets backoff,
  never the idempotency key), `cancelPublishingJob`.
* Verification failure downgrades to `PUBLISH_VERIFICATION_REQUIRED` — never
  `PUBLISHED`.

## 5. Verification (§31)

After a successful `createPost`: call `getPost`, store the external id, URL,
publication timestamp and media identifier, record
`verification: { ok, method, checkedAt }`, audit `publish_verified` — only
then is the job `PUBLISHED`. If verification cannot confirm existence, the
job is `PUBLISH_VERIFICATION_REQUIRED` and appears in the admin queue for a
human.

## 6. Scheduling (§26)

No duplicate cron system: schedule **records** live in RTDB
(`marketingSchedules`), and the **existing growth cron** executes them.

* `scheduling.ts` resolves natural language → concrete instants:
  "next week" (next Monday), "every Monday and Thursday" (weekly recurrence),
  "every day at 09:30", "at 18:00", campaign windows, IANA timezones
  (DST-correct via `zonedToUtc` / `utcToWall`).
* Ambiguous instructions **fail closed** (`unresolved: true`) instead of
  guessing.
* `isScheduleDue` / `advanceSchedule` drive one-shot and recurring runs,
  pause/resume (`state`), windows, and expiry.
* Every 5 minutes `/api/growth/cron/marketing-agent` (guarded by
  `CRON_SECRET`) executes due schedules → publishing jobs → verification →
  metric collection → account health.

## 7. Credentials & account health (§30, §32)

* Tokens are **server-side only** (environment / secret manager) — never in
  client code, never in RTDB, never logged (§88).
* Connection states: `CONNECTED · EXPIRING · RECONNECT_REQUIRED ·
  DISCONNECTED · ERROR`, stored per account in `marketingSocialAccounts`
  (platform, account, permissions, token state, last successful publish, last
  error).
* The cron health check calls `publisher.health()` and records
  `healthyAccounts`; the Social Accounts panel offers reconnect.
* An unset credential reports `NOT_CONFIGURED` — publishing against it fails
  closed; it never fakes a publication.

## 8. UTM & attribution (§34)

`utm.ts` builds `utm_source / utm_medium / utm_campaign / utm_content /
utm_term` per creative variant (`buildUtm`, `applyUtm`, `readUtm`,
`hasRequiredUtm`). Destination URLs only resolve to real app routes with UTM
appended — no invented URLs (§35). Missing UTM blocks queueing.

## 9. Testing (§82)

The full publishing path is covered by `npm run test:marketing-agent` with a
`MemoryPublishingStore` and a `MockPublisher` — legal-transition walk,
PUBLISHED-without-confirmation refusal, duplicate idempotency block,
verify-before-retry, verification downgrade, permanent/transient/auth retry
policy, manual retry, cancel, disabled fail-closed. **No destructive real
publishing ever runs in tests**; production publishing requires configured
credentials + the publishing feature flag.
