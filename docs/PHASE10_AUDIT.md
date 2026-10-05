# Phase 10 — Growth Intelligence Audit

Audit of existing growth, marketing, analytics, and conversion infrastructure,
performed before building anything new. The goal was to find what already
works, what is quietly broken, and what is missing — so Phase 10 reuses rather
than duplicates.

**Method:** read the actual source of every system named in the brief, run the
existing test suites, and verify route existence against the `app/` tree rather
than trusting documentation.

---

## Classification summary

| System | Location | Status |
|---|---|---|
| Ad placements & frequency caps | `lib/growth/placement.ts`, `eligibility.ts` | **WORKING** — real impression/click counting, server-authoritative caps |
| Affiliate programs | `lib/growth/tracking.ts` | **WORKING** — idempotent clicks, commission → revenue path |
| Revenue recording | `lib/growth/tracking.ts` | **WORKING** — `estimated` flag separates settled from config-derived |
| Compliance & claims blocking | `lib/growth/compliance.ts`, `lib/marketing-agent/claims.ts` | **WORKING** — blocked-phrase list with factual rewrite suggestions |
| Content state machine | `lib/growth/content-states.ts` | **WORKING** — transitions, `canPublish` gating |
| Marketing media pipeline | `lib/marketing-media/` | **WORKING** — ffmpeg, TTS, image providers, video render |
| Marketing agent | `lib/marketing-agent/` | **WORKING** — 259 tests, retry, approvals, publishing |
| Product knowledge base | `lib/marketing-agent/product-knowledge.ts` | **WORKING** — routes + approved claims as source of truth |
| Workflow automation engine | `lib/workflows/` | **WORKING** — do not build another one |
| SEO / robots / sitemap / llms.txt | `app/robots.ts`, `app/sitemap.ts`, `public/llms.txt` | **WORKING** |
| Admin growth area | `app/admin/growth/*` | **PARTIALLY WORKING** — campaign/channel/reporting solid, no product-funnel view |
| Experiment framework | `lib/growth/experiments/` | **NEEDS REFACTOR** — see below |
| Business events | `lib/business-events/` | **OBSOLETE for this purpose** — billing/licensing domain, not product events |
| Growth metrics helpers | `lib/growth/metrics.ts` | **WORKING** — returns `null` on sparse data, correctly refuses to fabricate |
| Pro entitlement check | `lib/subscription-server.ts` | **BUGGY (pre-existing)** — see below |

---

## Blockers found

### 1. No product event system existed

`grep` for `trackEvent` across `lib/`, `app/` and `components/` found exactly one
hit — a marketing-media asset tracker. There was no canonical product event
model at all. `lib/business-events/` looks similar but is a **billing and
licensing** event bus (`customer.created`, `payment.succeeded`,
`license.activated`) and is not a substitute.

Everything downstream of an event model — activation, funnel, retention,
attribution — was therefore unmeasurable. This was the true starting point.

### 2. Pro entitlement defaults to active for every user

`lib/subscription-server.ts`:

```ts
if (!sub) {
    // Default active Pro entitlement for authenticated account users
    return { hasSubscription: true, plan: "pro", status: "active" };
}
// ...
return { hasSubscription: true, plan: "pro", status: "active" };  // catch-all
```

Both the missing-subscription branch and the fallthrough return **Pro**. Any
user without a `users/{uid}/subscription` record is treated as a paying Pro
subscriber, and the catch-all does the same on any read error.

Consequences:
- Free/Pro conversion cannot be measured honestly, because there is no
  reliable Free cohort.
- The contextual Pro gate built in Phase 10 has nothing to gate against.

Note that `lib/growth/subscription.ts` (`isPremiumUser`) is *correct* — it fails
closed and requires `status === "active"`. The two helpers disagree with each
other, which is itself a bug.

**This is a real revenue and data-integrity issue and is deliberately left
un-fixed in this phase.** Changing it flips every user to Free, which would
break access for anyone relying on the current behaviour. It needs a product
decision — confirm intended entitlements, backfill subscription records, then
fix the default — not a silent patch inside a growth ticket.

### 3. Experiment framework was a stub

`lib/growth/experiments/index.ts` was 30 lines: a factory that returns a
`DRAFT` experiment. There was no assignment, no persistence of which user saw
which variant, and no statistical analysis. The old admin route computed a
"winner" from raw impression/conversion counts with a 5% uplift threshold and no
significance test at all.

Replaced by `lib/product-analytics/experiments.ts` with a real two-proportion
z-test, deterministic assignment, and a surface allowlist that blocks
experiments on checkout, auth, trading, risk controls, and legal copy.

### 4. Two upgrade routes pointed at 404s

While building the Pro value catalogue I claimed `/smart-money` and `/analysis`.
Neither exists. The real routes are `/market-intelligence/smart-money` and
`/market-intelligence/analysis`. A third stale route (`/smart-money` in the
re-engagement copy) was found by the same validator.

This is exactly the failure mode the brief warns about — marketing that
describes a product the user cannot reach. It is now impossible to ship:
`lib/product-analytics/__tests__/check-routes.ts` asserts every route referenced
by the Pro value catalogue, the plan comparison, and the re-engagement copy
resolves to a real `page.tsx`, and fails the build if one does not.

---

## What was reused, not rebuilt

- **Compliance engine** — Phase 10's Pro value copy and re-engagement messages
  run through the existing blocked-phrase list rather than a new filter.
- **Route validator** — extended the existing marketing-agent product knowledge
  approach instead of adding a second source of truth for routes.
- **Realtime Database layer** — `lib/growth/database.ts` (`writeEventIdempotent`,
  `deepClean`, `incrementCounter`) is the only write path, so deduplication and
  `undefined`→`null` cleaning behave consistently with the rest of the app.
- **Admin auth** — `requireGrowthAdmin` gates the Command Center exactly as it
  gates existing growth routes.
- **UI primitives** — `PageHeader`, `MetricCard`, `EmptyState`, `ErrorState`,
  `Select`, `RefreshButton`, `useAdminFetch` are used as-is.

No Firestore. No second workflow engine. No second automation engine.

---

## Deliberately not built in this phase

The brief lists 53 areas. Several depend on systems that do not yet exist
honestly — building them now would mean inventing data:

- **Stripe revenue metrics / MRR** — requires reading real Stripe state. Not
  implemented, because the placeholder would be a fabricated number, which the
  brief forbids. The Command Center deliberately has no MRR tile today.
- **Programmatic SEO and landing-page generation** — the Marketing Factory
  already drafts these; without the fact validator wired to real pricing and
  capability data, generating pages at scale multiplies the stale-route problem
  found in blocker #4.
- **Share cards and video demo pipeline** — depend on the media pipeline that
  already exists and would need a real browser capture flow.

Each is a real piece of work, not a checkbox. The infrastructure built here —
events, activation, funnel, retention, experiments, upgrade intent — is what
they need in order to be honest when they are built.
