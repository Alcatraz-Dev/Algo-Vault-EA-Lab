# AlgoVault — Recovery Log

One entry per significant change block, with dates, what changed, what was verified, and any remaining limitation. Update this file after every significant change.

---

## BR-000 — Baseline documentation & state baseline (2026-10-10)

**What:** Created `docs/project-control/` and authored the baseline + state + architecture + feature inventory + bug register + roadmap + decisions + resources + testing strategy + release checklist + master context. Recorded the verified baseline: clean tree at HEAD `2def94bf0d675eda460d3bc6f265a6a45192ba88`; build green; type-check green; lint failing (pre-existing `no-explicit-any`/413 + 1 functional defect); representative test batch green (93/32/112/140/8).

**Verified:**
- `git status`: clean at HEAD.
- `npx next build`: exit 0.
- `npx tsc --noEmit`: exit 0.
- `npx eslint .`: exit 1 (413 errors, pre-existing anywhere/any-require + 1 functional defect in candels workspace).
- Test batch: 93 / 32 / 112 / 140 / 8 passed.

**Remaining limitation:**
- Wider lint rerun pending: the `.eslintcache`-style pattern may still surface other pre-existing findings outside this file; tracked as P3/LINT, not part of this batch.

---

## BR-000c — Verify candels workspace repair; run full gate (2026-10-10)

**What:** Re-applied the workspace fix (hoisted `fetchCandels`, strict typing, stable async effect); then re-ran the full gate and recorded the result.

**Files changed:**
- `app/account/candels/workspace/page.tsx` — hoisted fetch function, strict `CandelInstanceResponse`, async-effect invocation.

**Verified:**
- `npx tsc --noEmit`: exit 0
- `npx eslint app/account/candels/workspace/page.tsx`: exit 0 (0 errors; 1 pre-existing unused-vars warning on exported `createCandel`)
- `npx next build`: exit 0

**Remaining limitation:**
- No end-to-end browser test of history-prepend viewport preservation.
- No fresh-live-market-session test.
- No admin/pro authorization audit.
- No full Firebase security-rule / cache-coherence audit.
- Headless browser for playwright not installed here.
- Repaired file still has the pre-existing unused-vars warning on `createCandel` (intentional export); tracked as P3/LINT.

---

## UI-001 — Phase 2: design-system foundation (tokens + broken shared components) (2026-10-10)

**What:** Completed and rebalanced the semantic token layer and repaired the highest-impact shared components so every status badge / banner / form message is semantic and legible in **both** themes. Also fixed the fill/text pairings that a token change would otherwise regress. No trading, payment, auth, DB, or API code touched.

**Files changed:**
- `app/globals.css` — added the missing tokens (`--success`, `--success-foreground`, `--success-muted`, `--positive-muted`, `--negative-muted`, `--destructive-muted`, `--warning-muted`, `--info-muted`), registered them in `@theme inline`; rebalanced semantic colors for AA on dark **and** light; fixed `--info` from grey to blue; set `--primary-foreground` to dark ink; added shared motion easings (`--ease-standard`, `--ease-emphasized`).
- `components/ui/status-badge.tsx` — canonical tint tones; removed the stray hard-coded `text-yellow-300`; `active` no longer relies on the ambiguous `text-accent`.
- `components/layout/NotificationsMenu.tsx` — unread count: solid `bg-negative` label now `text-background`; `text-[10px]` → `text-micro`.

**Token values (both themes verified numerically):**

| Token | Dark | Light |
| --- | --- | --- |
| `--primary-foreground` | `#1a1204` | `#1a1204` |
| `--positive` / `--success` | `#3fb950` | `#166534` |
| `--negative` / `--destructive` | `#f85149` | `#991b1b` |
| `--warning` | `#ff922b` | `#9a3412` |
| `--info` | `#58a6ff` | `#1d4ed8` |
| `--muted-foreground` | `#a3a3a3` (unchanged) | `#6b6b6b` (was `#727272`) |

**Why `-foreground` is now a text color, not a solid-pair color:** across the codebase `text-{positive,negative,destructive,warning,info,success}-foreground` is used *only* on low-opacity tints or as standalone text (≈35 sites) — never stacked on a solid `bg-*`. So the `-foreground` tokens are the legible on-tint text color. The three solid semantic fills (`bg-positive`, `bg-negative`, `bg-warning`) that carry text now use `text-background` (dark ink on dark theme's bright fills, light ink on light theme's deep fills).

**Verified (DOM + computed styles, live dev server):**
- All 16 semantic badge/tint combinations pass WCAG AA (≥4.5:1) on the real OKLCH-composited tint in **both** themes: dark 5.71–18.21, light 4.72–11.46 (worst: light `success-muted` = 4.98, light `info-muted` = 4.75).
- Solid fills with `text-background`: primary 5.58; dark positive 7.43 / negative 5.63 / warning 8.45; light positive 6.77 / negative 6.15 / warning 6.94.
- New utilities resolve in the served CSS (`bg-success-muted`, `text-info-foreground`, `bg-warning-muted`, `bg-info-muted`, …) and the new custom properties are emitted.
- Homepage console: 0 warnings/errors.
- `npx eslint` on changed files: only a pre-existing `react-hooks/purity` error at `app/signals/pro/page.tsx:387` (`Date.now()` during render), unrelated to this change.
- `npx next build`: see the build log for this session.

**Remaining limitation:**
- `text-primary` (the vivid `#ff4d00`) on the **light** background remains ≈3.2:1 — below AA for normal text (links / active nav). Fixing it requires either a deeper light-theme brand orange or a dedicated `--primary-text` token plus a site sweep; deferred to Phase 6 with the other raw-color sweeps. (The contrasting `--primary-foreground` fix covers *solid* primary fills.)
- `tsc` reports 2 pre-existing errors in `tests/security/route-auth-negative.test.ts` (spread of `unknown` in the fake DB stub) — introduced by the concurrent Candel commit `6ad4f03`, outside this workstream.
- Light theme deepens semantic colors, so badges/links read slightly more muted there than before (intentional, for AA).
- Visual pixel confirmation is not possible for this agent (no image input); verification is DOM/computed-style + Lighthouse, not a human screenshot review.

---

## UI-002 — Phase 3: global application shell (2026-10-10)

**What:** Completed the shell redesign already in the working tree and closed its remaining gaps: collapsible nav groups with persisted state, real Pro/badge chips, fixed signed-out footer (no fake identity), animated mobile drawer with body scroll-lock, single `data-guide="page-header"` anchor (removed it from `PageHeader`, which duplicated the shell topbar anchor on every admin page), single-source Candel nav, dead-import cleanup in `AccountShell`.

**Files changed (this session):**
- `components/ui/page-header.tsx` — removed `data-guide="page-header"` (shells own the anchor per constitution).
- `components/account/AccountShell.tsx` — removed ~40 dead imports + dead `siteName`/`handleSignOut` code left over from delegating to `AppShell`.

**Verified:**
- `npx eslint` on shell + touched files: 0 errors (only pre-existing unused-var warnings elsewhere).
- `npx tsc --noEmit`: no errors in any touched file; all remaining errors confined to `tests/security/` (concurrent Candel workstream, pre-existing).
- `npx next build`: fails only on the same pre-existing `tests/security/` type errors; no build error from UI files.
- Audit findings closed: collapsible sidebar, Pro badges, signed-out footer, drawer transition, duplicate scanner entry. Remaining page-body `data-guide` attributes (~60 marketing/standalone pages) intentionally left for a later bounded sweep.

**Remaining limitation:**
- `text-primary` on light background still ~3.2:1 (deferred, as in UI-001).
- No pixel-screenshot verification (no image tooling); responsive behavior verified by source review only.
- Did not touch trading/payment/auth/API logic.

---

## UI-003 — Phase 4 (slice): Pro Terminal semantic-token pass (2026-10-10)

**What:** Brought the four terminal account/trading surfaces onto the semantic design system without touching any trading logic: raw `emerald/rose/amber/sky` classes → `positive/negative/warning/info` tokens, banned `text-[9/10/11px]` → `text-micro`/`text-xs`, `font-mono` numerics → `font-numeric`. LIVE stays attention-red (`negative`), PAPER becomes `info`, warnings use `warning-muted`.

**Files changed:**
- `components/terminal/AccountPanel.tsx` — mode badge, tabs, error banner onto tokens/micro type.
- `components/trading/OpenPositions.tsx` — P/L, BUY/SELL, table numerics, dialog labels.
- `components/trading/PendingOrders.tsx` — status badges, side colors, cell numerics.
- `components/trading/AccountHeader.tsx` — status dot, stat numerics/labels.

**Verified:**
- `rg` on touched files: zero remaining `emerald/rose/sky/amber`, `text-[9/10/11px]`, or `font-mono`.
- `npx eslint` on touched files: 0 errors.
- `node scripts/jiti-tsrun.mjs lib/terminal/__tests__/run-terminal-tests.ts`: 335 passed, 0 failed.
- `node scripts/jiti-tsrun.mjs lib/trading/__tests__/run-trading-tests.ts`: 32 checks, exit 0.
- No execution, pricing, or account-state logic touched; DEMO/LIVE presentation unchanged in meaning.

**Remaining limitation:**
- Chart engine, drawing tools, and wider terminal layout untouched (per rule: no chart rewrite for visual reasons).
- Marketplace/Candel/Account/Admin sweeps remain as tracked follow-ups; marketplace `rounded-2xl` drift (≈50 sites) intentionally not swept in this phase to avoid conflicts and unreviewable diffs.

---

## UI-004 — Phase 5a: Marketplace premium discovery pass (2026-10-10)

**What:** Rebuilt the marketplace visual layer around the design system with no logic, pricing, Stripe, or licensing changes: all three hubs (tools, plugins, extensions) share one calm card system — `rounded-lg` surfaces, semantic `positive/info/warning` tokens, `text-micro`/`text-xs` type floor, `font-numeric` prices/stats, single faint `primary/10` brand wash instead of per-hub emerald/violet/cyan glow blobs, no `backdrop-blur`/`shadow-2xl`/`drop-shadow` on cards. Orange is spent in exactly two intentional places: card-title hover + the solid **Buy Now** CTA (`bg-primary`/`text-background`) on the detail page. Ratings, win-rate/profit-factor/drawdown stay vendor-provided with "—" fallbacks (nothing invented); the detail page keeps its "results provided by the developer" disclaimer.

**Files changed:**
- `app/marketplace/page.tsx`, `app/marketplace/[slug]/page.tsx`, `app/marketplace/plugins/page.tsx`, `app/marketplace/extensions/page.tsx`.

**Verified:**
- `rg` over all four files: zero banned patterns (raw colors, `text-[9/10/11px]`, `font-mono`, `rounded-2xl/3xl`, blur/shadow/decorative-gradient drift).
- `npx eslint`: 2 `no-explicit-any` errors, both proven pre-existing via `git stash` control run (untouched lines).
- `npx tsc --noEmit`: no errors in touched files.

---

## UI-005 — Phase 5b: Account surfaces, Candel honesty, auth trust (2026-10-10)

**What:** `app/account/purchases/page.tsx` + `app/account/licenses/page.tsx` onto semantic status tokens (`positive` active, `negative` expired/revoked/error, `warning` expiring) with `rounded-lg` + type floor; `components/candel/panels.tsx` proposal confidence relabeled "model confidence" with a tooltip stating it is self-reported, not a measured success rate; `app/login/page.tsx` + `app/register/page.tsx` success/referral notices moved from low-contrast `emerald-200/400` to AA `positive` tokens. No entitlement, checkout, or Candel logic touched.

**Verified:**
- `rg`: purchases/licenses zero drift; `panels.tsx` was already drift-clean.
- `npx tsc --noEmit`: zero errors outside pre-existing `tests/security/`.
- `npx eslint`: only the pre-existing `any` errors.
- Terminal (335) + trading (32) suites remain green from UI-003; touched files since are display-only with no runners.
- Final sweep (same session): fixed a missed `blue-400` payment-verifying banner in purchases (`info` tokens), aligned all purchases/licenses buttons to `rounded-md` and tiles/panels to `rounded-lg`. Final `rg` over all 16 touched UI files: zero banned patterns (excluding the allowed drawer-scrim blur/dropdown shadows in `AppShell` and the referral-code input's intentional `font-mono`); `tsc` zero outside `tests/security/`; `eslint` only the 4 pre-existing `any` errors.

---

## SEC-001 — Application-layer security suite (B-009/B-010) (2026-10-10)

**What:** The security-negative suite and its `firebase-admin-stub.ts` seam pass cleanly, and the security-gate suite (`script:test:security`) was added to `package.json` so `npm test` picks it up. The suite is the permanent application-layer stand-in for a Firebase emulator: no real credentials, no network, fully controlled database. The `fakes.ts` legacy file was superseded by the stub-based seam.

**Files changed:**
- `tests/security/route-auth-negative.test.ts` — a 7-section negative suite: `verifyGatewayToken` (unknown/empty/null tokens → null), `getGatewayTokenForUser` (live index + stale index cleaned up via `_rtDbStore`), `hasActiveTradingLicense` (expired/false, active, custom_bot), `isAdminUid` (unknown false, admin true), `requireAdmin` (customer denied, admin authorized, garbage denied, missing header denied), `requireAdminOrProductOwner` (non-owner denied, owner authorized, admin role authorized, missing header denied), cross-user blocked, protected RTDB-path bank asserted, Stripe idempotency placeholder.
- `tests/security/firebase-admin-stub.ts` — the in-memory Auth + RTDB seam the `script:test:security` runner aliases for `firebase-admin`, `firebase-admin/app`, `firebase-admin/auth`, `firebase-admin/database`. This is the permanent stand-in for the real SDK: `getApps()` returns an `App[]` (mirroring the real SDK's `.length`/`[0]`), `initializeApp()`/`cert()` are argument-ignoring seams, the fake `AdminDatabase` implements `ref().get()/set()/update()/remove()/child()`.
- `scripts/jiti-tsrun.mjs` — the security suite's `jiti` runner aliases the `firebase-admin` family to the stub, so the app-layer guards read from `rtDbStore` instead of the real SDK.
- `package.json` — added `test:security` = `node scripts/jiti-tsrun.mjs tests/security/route-auth-negative.test.ts`.

**Verified:**
- `npm run test:security`: 25 checks, exit 0 — all four previously failing cases now pass.
- Negative control: the same suite with one assertion inverted → exit 1 with the FAIL line (proves exit status tracks assertion results).
- `npx tsc --noEmit`: exit 0 repo-wide — no `tests/security/` exceptions.
- `npx eslint tests/security/*.ts scripts/jiti-tsrun.mjs`: 0 errors, 0 warnings.

**Remaining limitation:**
- Sections 4-7 stay explicit "covered by the integrated suites" placeholders (`s.check(true, …)`): they assert nothing themselves, they point at the trading/webhook suites. Real route-level assertions need a route-handler seam the app does not expose.
- The suite drives the guards directly rather than through `route.ts` handlers; the 150+ route inventory in `AUTHORIZATION_MATRIX.md` remains a static audit.
- Firebase rules are still statically audited only; emulator/deploy evidence is unchanged (§7 BLOCKED).
- No headless browser for end-to-end route-level integration, no admin/pro authorization walkthrough, no `npm run test:e2e-*`.

---

## UI-006 — Phase 6 (slice): light-theme primary *text* contrast (AA) (2026-10-10)

**What:** Closed the deferred light-theme contrast failure from UI-001 — `text-primary` (`#ff4d00`) reached only ~3.3:1 on light surfaces. Split the brand colour into two roles: `--primary` stays the exact `#ff4d00` for solid fills, borders and rings (identity preserved), while a new `--primary-text` token supplies the text/link colour. In the light theme `text-primary` now resolves to `#c2410c` (a deeper, brand-faithful orange); in the dark theme it is unchanged (`#ff4d00`).

**Approach (bounded, no 129-file sweep):** rather than renaming ~360 `text-primary` call sites across 129 files (large, conflict-prone diff while a concurrent session is committing), the fix is a single unlayered rule — `html.light .text-primary { color: var(--primary-text); }` — which wins over the layered Tailwind utility and fixes every base `.text-primary` usage at once.

**Files changed:**
- `app/globals.css` — `--primary-text` in `:root` (`#ff4d00`) and `.light` (`#c2410c`); registered `--color-primary-text` in `@theme inline`; added the `html.light .text-primary` override with rationale.

**Verified (DOM/computed styles, live dev server):**
- Dark: `.text-primary` computes `rgb(255, 77, 0)` (unchanged); `--primary-text` = `#ff4d00`.
- Light: `.text-primary` computes `rgb(194, 65, 12)` (`#c2410c`); `--primary-text` = `#c2410c`.
- `#c2410c` contrast: **5.18** on white, **4.92** on `#f9f9f9`, **4.58** on `#f1f1f1`, **4.56** on the 10%-primary tint — all AA (was 3.33).
- Homepage: 63 live `.text-primary` elements now corrected in light theme; console 0 warnings/errors.
- `npx next build`: see the build log for this session (CSS-only change; no TS touched).

**Remaining limitation:**
- The override covers the base `.text-primary` class only. State/opacity variants (`hover:text-primary`, `group-hover:text-primary`, `text-primary/70`) and other `text-primary-*` tokens are intentionally untouched; a future bounded sweep can convert those to `text-primary-text` directly if needed.
- No pixel-screenshot review (no image tooling); verified via computed styles.
- The wider Phase 6 consistency sweeps (`text-[9/10px]` ≈1,400, raw colour families ≈5,900, `rounded-2xl` ≈796, `font-mono` ≈1,234) remain deferred as bounded follow-ups — too large to land safely alongside the concurrent session. `glass`/`glow`/`gemini-*` helpers are NOT fully dead (glass 2, glow 7, gemini 11 TSX usages), so removal is unsafe without per-usage review.

**Workspace note:** commit `078933c` (another OpenCode session, `git add -A`) swept the whole tree, including this workstream's Phase 2/3 edits *and* an untracked QA route `app/ui-preview-shell/page.tsx`. That route has been deleted in the working tree (pending commit) and should not be restored.

---

## UI-007 — Phase 6 (slice): ProGate radii + HeroSection verification (2026-10-10)

**What:** Continued the bounded Phase 6 consistency work without touching business logic. Fixed the banned radii in the Pro subscription gate and verified the in-progress HeroSection premium pass (uncommitted work preserved, not overwritten).

**Files changed:**
- `components/subscription/ProGate.tsx` — `rounded-2xl` → `rounded-lg` on all three gate panels (loading, signed-out, upgrade); `rounded-xl` → `rounded-md` on both CTA links. No logic, copy, or entitlement change.
- `components/home/HeroSection.tsx` — **not edited by this session**; the working-tree diff (tri-colour gradient removal, semantic tokens, `text-micro`, `font-numeric`, `rounded-lg`, honest `PREVIEW DEMO` labels) was reviewed and verified as correct direction, left intact.

**Verified:**
- `npx tsc --noEmit`: exit 0.
- `npx eslint components/subscription/ProGate.tsx components/home/HeroSection.tsx`: exit 0.
- `npx next build`: exit 0 (all routes prerender).
- `npm run test:terminal`: 335 passed. `test:trading`: 32 passed. `test:chart-engine`: 93 passed. `test:unified-trading`: 112 passed. `test:security`: 25 passed.

**Remaining limitation:**
- No pixel-screenshot review (no image tooling in this environment).
- Wider Phase 6 sweeps (micro type, raw colours, radii, font-mono, blur) remain deferred as bounded follow-ups — too large to land safely alongside concurrent sessions.
- `lib/subscription-server.ts` fail-open default (`hasSubscription: true` when no record) noted as a business-logic risk; intentionally untouched per redesign safety rules — needs product/security decision before any change.

---

## UI-008 — Phase 6 (slice): live marketing surfaces premium pass + dead-code finding (2026-10-10)

**What:** Continued the bounded, viewer-facing "premium SaaS" polish on the highest-traffic public surfaces, restricted to components that are actually rendered. **Finding:** 19 of the 24 `components/home/*.tsx` files (incl. `HeroSection.tsx`, `StrategyIntelligenceSection.tsx`, `MarketplaceSection.tsx`, `BacktestingSection.tsx`, `LiveMonitoringSection.tsx`, `TelegramPipelineSection.tsx`, …) are **not imported anywhere** — dead code. The live homepage is `HomePage.tsx` (inline hero + `SiteHeader`/`SiteFooter` + `TickerStrip`/`HeroConsoleChart`/`ReplaySection`/`GatewaySection`/`EcosystemSection`/`EvidenceAnalytics`/`Reveal`/`CountUp`). Sweeping dead files would be misleading churn, so `HeroSection.tsx` (edited earlier in this workstream, then seen by the concurrent session in `UI-007`) was **reverted to HEAD** to keep the diff honest and on live surfaces. `app/dashboard/page.tsx` was already drift-free.

**Files changed (all live, presentational only — no logic/copy/data-flow changes):**
- `components/home/ReplaySection.tsx` — removed the violet ambient `blur-[130px]` glow, `rounded-3xl`/`rounded-2xl`/`shadow-2xl`/`backdrop-blur-2xl`; recoloured the interactive replay console onto semantic tokens (positive/negative candles & Buy/Sell, warning close-position, primary play/CTA, info win-rate); `text-[10px]`→`text-micro`; `font-mono`→`font-numeric`; `animate-pulse`/`animate-bounce` gained `motion-reduce:animate-none`; removed 2 unused imports.
- `components/home/GatewaySection.tsx` — removed `rounded-3xl`/`shadow-2xl`/`backdrop-blur-xl`; the 4-step pipeline boxes now use semantic tints (primary/info/positive/warning) instead of raw violet/sky/emerald/amber; `text-[10px]`/`text-[11px]`→`text-micro`; `font-mono`→`font-numeric`; fixed a pre-existing `react/jsx-no-comment-textnodes` error; removed 3 unused imports.
- `app/pricing/page.tsx` — `rounded-2xl`→`rounded-lg` (tiers, tool cards, comparison table); the highlighted tier's `bg-gradient-to-b … shadow-2xl` and the Pro tool card's `bg-gradient-to-br` replaced with solid `bg-card shadow-md` / `bg-primary/5`; `text-[10px]`/`text-[11px]`→`text-micro`.
- `components/home/HomePage.tsx`, `EvidenceAnalytics.tsx`, `HeroConsoleChart.tsx`, `TickerStrip.tsx`, `EcosystemSection.tsx` — `font-mono`→`font-numeric`; removed one decorative gradient underline in `EcosystemSection`.
- `components/home/site-header.tsx` — online indicators `bg-emerald-400`→`bg-positive` (+ `motion-reduce:animate-none`).

**Verified (DOM/computed, live dev server + gate):**
- Homepage: **0** elements with raw colour / gradient / `rounded-2xl|3xl` / `backdrop-blur` / `shadow-2xl` / `text-[9–10px]`; **0** gradient-clipped text; 37 `positive` / 9 `warning` / 1 `info` semantic usages; **0 non-TradingView console errors** (the ~78 errors are pre-existing external TradingView scanner CORS in `[market-data]`).
- Pricing: 0 raw drift; highlighted tier renders solid `#181818` card, radius 10px, subtle `shadow-md`, no gradient; 0 non-TradingView console errors.
- `npx next build`: **exit 0**, no errors outside `tests/`.
- `npx eslint` on every changed file: **0 errors** except 2 pre-existing `no-explicit-any` in `site-header.tsx` on untouched lines. Also cleared a pre-existing `react/no-unescaped-entities` in `app/pricing/page.tsx` (the file was touched, so left cleaner than found) — **no new lint errors**.

**Remaining limitation:**
- No pixel-screenshot review (no image tooling in this environment); verified via computed styles.
- The 19 dead `components/home/*.tsx` files still carry heavy raw-colour/gradient drift; they are candidates for **deletion or wiring**, not sweeping — needs a product decision.
- Wider app-wide sweeps remain deferred (see `UI-006`).

**Workspace note:** The concurrent OpenCode session committed this workstream's `app/globals.css` (`--primary-text`) + audit edit + the `app/ui-preview-shell` deletion (`UI-006`), and authored `UI-007`. This entry is numbered `UI-008` to avoid collision. `components/subscription/ProGate.tsx` (in the working tree) is the concurrent session's change, not this workstream's.
