# Marketing Agent — Extending

How to add a new platform, a new template, and a new creative provider —
without duplicating existing systems.

---

## 1. Adding a new social platform (§63–§65)

1. **Research the official API first** (§64): confirm video publishing,
   scheduling, thumbnails, analytics actually exist. Document what does
   *not* exist — it will be reported `NOT_SUPPORTED`, never scraped.
2. **Declare capabilities** in `publishing/capabilities.ts`: add the platform
   surface(s) to the matrix with `canPublishVideo`, `canScheduleNatively`,
   `canUploadThumbnail`, `canAddDescription`, `canAddHashtags`,
   `canRetrieveMetrics`, `captionLimit`, `apiSurface`. If the platform
   surface is a new marketing platform, add it to `MARKETING_PLATFORMS`
   (+ aspect-ratio mapping in `collections.ts`) and to the intent parser's
   `PLATFORM_ALIASES`.
3. **Implement the adapter** in `publishing/providers.ts`: a class
   implementing `SocialPublisher` (`health`, `validatePermissions`,
   `uploadMedia`, `createPost`, `schedulePost`, `getPost`, `getMetrics`,
   `refreshCredentials`). Classify every failure (`state`, `errorKind`,
   `retryable`) honestly; AUTH only after your own refresh attempt failed.
   Register it in `registerSocialPublishers()`.
4. **Credentials**: add server-side env vars to `.env.example` (marked
   optional / `NOT_CONFIGURED` when unset). Never expose tokens client-side.
5. **Tests**: extend the mock-based suite (`test:marketing-agent`) —
   success, permanent, transient, auth, rate-limit, unsupported paths. No
   real publishing in tests.
6. **Docs**: update [publishing.md](./publishing.md).

## 2. Adding a new template (§68)

Templates are **data-driven**; no engine change is required.

1. Add the template descriptor (id, objective, audience, beat structure,
   default duration/style, required assets) alongside the existing template
   definitions used by `production/director.ts` / the creative factory.
2. Give it a stable id (`HOOK_EDU`-style naming) and a hook/CTA bank in the
   template data so `production/script.ts` can fit it to any duration.
3. Ensure its claims pass `claims.ts` (approved wording only) and that its
   disclaimer/demo-label requirements are declared — QA will block anything
   else.
4. Templates compose with everything downstream automatically: capture plan,
   variants (`buildVariantSpecs`), recipes (`extractRecipe`), platform copy,
   UTM, scheduling, publishing.
5. Add a test asserting: template id present, generated hook/CTA non-empty,
   variant count matches, claim validation passes (mirror the existing
   template assertions in `test:marketing-agent`).

## 3. Adding a new creative provider (§12, §11 of the brief)

The creative engine sits behind `MarketingCreativeProvider`
(`provider.ts`): project creation, asset ingestion, composition generation,
captions, motion, timeline, rendering, preview/export, variants,
localization, re-render, status, cancel, diagnostics.

1. **Implement the contract** in a new module (see `hypit/provider.ts` and
   `creative-providers.ts` for the local ffmpeg fallback pattern). The
   `CompositionDocument` JSON is the source of truth — your provider reads
   it and renders; it never becomes the only place the composition exists.
2. **Provider id + constants** go in `provider-constants.ts` (alongside
   `HYPIIIT_PROVIDER_ID` / `FFMPEG_PROVIDER_ID`). If the provider has a
   binary version, add a pinned `EXPECTED_*_VERSION` and a compatibility
   check mirroring `isVersionCompatible` (§85 — no unpinned `latest`).
3. **Register + select** in `creative-providers.ts` with a deterministic
   selection order and honest statuses
   (`READY | NOT_CONFIGURED | DISABLED | ERROR`).
4. **Feature-flag it** (`MARKETING_HYPIT_ENABLED`-style) so it can be rolled
   back without touching Growth, Marketing Factory or workflows (§90).
5. **Fail closed**: if the provider is missing, jobs park in `NOT_CONFIGURED`
   — never claim "video generated" without a validated output (§91).
6. **Tests**: contract tests (render document → artifacts exist and pass QA),
   disabled-flag behavior, and version-gate failure.

## 4. Checklist for every extension

- [ ] Reuses existing AI router, campaigns, cron, auth, analytics — no
      second system.
- [ ] Fails closed with `NOT_CONFIGURED` / `NOT_SUPPORTED` when unavailable.
- [ ] Every status reflects real persisted state (§91).
- [ ] Credentials server-side only; nothing secret in logs or RTDB.
- [ ] Admin settings/feature flag added; rollback documented.
- [ ] Tests in `test:marketing-agent`; typecheck clean
      (`npx tsc --noEmit | grep marketing-agent`).
- [ ] Docs updated.
