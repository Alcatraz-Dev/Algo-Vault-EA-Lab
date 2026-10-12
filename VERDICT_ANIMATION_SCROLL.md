# VERDICT — Review task t_90da8a58: Verify animation + scroll experience (reviewer)

REPO: /Users/haythem_dhahri/Desktop/projects/website/trading-platform
COMMIT: 93981552774e7b335ac9ab96cf15a88c9e63dee7 (frontend/scroll-animation)
DATE: 2026-10-12

## Acceptance criteria
- Ref scope covered: command-deck nav, scroll mechanics, genome/map canvas, live tape, landing page — checked against extracted DESIGN.md §21–23 reference.
- Design fidelity: AlgoVault tokens + recorded mirror; one gold accent for brand/selection only.
- Behavior: scroll + progress + reduced-motion correct; data states honest; dark+light + mobile reflow.
- Build hygiene: `npx tsc --noEmit` clean on touched paths, `npm run lint` adds no new errors, `npm run build` passes for changed areas.

## RESULTS

### 1. tsc --noEmit — FAIL (exit 1)
The reviewer's own run (not inherited): `npx tsc --noEmit` exits 1 with errors in the scroll/animations surface, including:

- `components/layout/live/LiveScrollFeed.tsx` — `Cannot find module '../../scroll/ScrollProgressContext'`: the component lives in `components/layout/live/`, so `../../scroll/...` resolves to `components/scroll/`, which does NOT exist. The file is at `components/layout/scroll/ScrollProgressContext.tsx`. Same broken path in `components/layout/live/NotificationFeed.tsx` and `components/layout/live/ScrollProgressFeed.tsx` (3 files).
- `components/layout/LiveActivityFeed.tsx` — imports `{ ScrollProgressRail } from "./ScrollProgressRail"` but that module only exports `useScrollProgressRail` (a single hook). No named export `ScrollProgressRail` exists.
- `components/layout/LiveActivityFeed.tsx` — `useAuth` is referenced but not imported/defined anywhere in the file.
- `app/api/market/quotes/route.ts` — 10 TypeScript errors (undefined vs DataFreshness/TransportState/numbers, optional chaining, `entry.dataTimestamp`).

These are NOT inherited-from-baseline lint debt; they are caused by this work stream and block the build.

### 2. npm run build — FAIL (exit 1)
`npm run build` fails with Turbopack:
- `error: Export buildEvolutionContext doesn't exist in target module` (lib/ai/strategy-lab/evolution.ts)
- `error: Export runEvolutionGeneration doesn't exist in target module` (lib/ai/strategy-lab/evolution.ts)
- Cascade: campaign.ts imports these, so all `/api/strategy-lab/campaigns/*` and `vault` routes fail to compile.

### 3. Broken scroll-driver mount — FAIL (functional)
`ScrollProgressProvider` is exported but is NEVER mounted anywhere (grep found no `<ScrollProgressProvider>` in app/ or components/). Consequently:
- No page producers the `progress`/`--scroll-progress` token the scroll contract mandates (DESIGN §21.2 "set on document.documentElement by one subscription").
- The three live scroll components import the context but have no provider ancestor, so `useScrollProgress()` throws "must be used within a ScrollProgressProvider" whenever they render.
- The `ScrollProgressRail` hook is defined but unused by any page (it is dead code; the context version is the one referenced).

### 4. Reduced-motion — PASS (meets DESIGN §21.5)
- Global `@media (prefers-reduced-motion: reduce)` guard: `animation-duration: 0.01ms !important`, `transition-duration: 0.01ms !important`, `scroll-behavior: auto !important`.
- `.reveal`/Motion entries: `[data-motion-reveal] { opacity: 1 !important; transform: none !important; }` beats inline motion values.
- static settled fallback for progress tracks when `progress` is undefined (LiveProgress renders a border/white placeholder, no bogus progress bar).
- No `animation`/`transition`/`transform` drift under reduced motion.

### 5. Design fidelity — PARTIAL / FAIL
- One gold accent used for brand/selection only (`--primary`, no per-feature rainbow) — PASS in new scroll/live files.
- Raw Tailwind color families in the new scroll/live files: NONE — semantic tokens only. HomeHero/HomePage use `backdrop-blur-sm` on a header element (over the content rail) — inside the §21 landing-page exception but the header sits above the scroll track, a partial spec tension worth a recorded decision; not a blocker.
- `rounded-lg` cards, `rounded-md` controls, no `rounded-2xl` on new surfaces — mostly PASS.
- No `text-[9px]/[10px]/[11px]` on new surfaces — PASS (one text-micro used).

### 6. Data honesty — PASS
- `describeFreshness` classifies live|stale|offline|unavailable with offline-transport wins and unavailable-never-promoted-to-live; no fabricated values.
- Stale/unavailable never rendered as live.

## BREAKING FINDINGS (must fix before merge)
1. Fix 3 import paths: `../../scroll/ScrollProgressContext` → `../../layout/scroll/ScrollProgressContext` (or `@/components/layout/scroll/ScrollProgressContext`).
2. Fix `components/layout/LiveActivityFeed.tsx` — drop the bad `ScrollProgressRail` named import (use `useScrollProgressRail`, or remove it entirely since it wraps nothing real), and import/define `useAuth`.
3. Wire `ScrollProgressProvider` to the live page(s) (app/live/page.tsx, account/terminal, admin/livemap) so the scroll driver is actually mounted; then the rail + live-tape + map canvas all get a valid `progress`.
4. `lib/ai/strategy-lab/evolution.ts` — reconcile the exports used by campaign.ts (`buildEvolutionContext`, `runEvolutionGeneration`, `EvolutionTotals`); the file currently exports `buildSeedPopulation`, `mutatePopulation`, `runEvolution`. Decide whether the distinct functions live in evolution.ts or campaign.ts/evolution-constants and align imports.

## RECOMMENDATION
Blocking. Before merge: fix 1–4 so the scroll/animations surface compiles and is mounted. Re-run `npx tsc --noEmit`, `npm run build`; then a real browser check at 390/768/1440 in dark+light (no browser backend available this run — flagged, not verified).
