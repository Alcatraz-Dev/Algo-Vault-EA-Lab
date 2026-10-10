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

## BR-000b — Repair candels workspace ordering defect (2026-10-10)

**What:** Fixed the functional bug found by ESLint in `app/account/candels/workspace/page.tsx`: `fetchCandels()` was declared as an async function inside the component body and called in `useEffect` before its declaration (TDZ error) plus `react-hooks/immutability` churn. Hoisted the fetch function to module scope, typed the response strictly (removed `any`), and made the effect stable.

**Files changed:**
- `app/account/candels/workspace/page.tsx` — hoisted `fetchCandels`, typed response, removed `any`.

**Root cause:** Component-body function declaration referenced earlier in the same scope; an effect in the same body reads it before its declaration is initialized.

**Verified:**
- `npx tsc --noEmit`: exit 0.
- `npx eslint app/account/candels/workspace/page.tsx`: no `no-explicit-any` on that file.
- `npx next build`: exit 0.

**Remaining limitation:**
- Wider lint rerun pending: the `.eslintcache`-style pattern may still surface other pre-existing findings outside this file; tracked as P3/LINT, not part of this batch.

---

## UI-001 — Phase 2: design-system foundation (tokens + broken shared components) (2026-10-10)

**What:** Completed and rebalanced the semantic token layer and repaired the highest-impact shared components so every status badge / banner / form message is semantic and legible in **both** themes. Also fixed the fill/text pairings that a token change would otherwise regress. No trading, payment, auth, DB, or API code touched.

**Files changed:**
- `app/globals.css` — added the missing tokens (`--success`, `--success-foreground`, `--success-muted`, `--positive-muted`, `--negative-muted`, `--destructive-muted`, `--warning-muted`, `--info-muted`), registered them in `@theme inline`; rebalanced semantic colors for AA on dark **and** light; fixed `--info` from grey to blue; set `--primary-foreground` to dark ink; added shared motion easings (`--ease-standard`, `--ease-emphasized`).
- `components/ui/status-badge.tsx` — canonical tint tones; removed the stray hard-coded `text-yellow-300`; `active` no longer relies on the ambiguous `text-accent`.
- `components/layout/NotificationsMenu.tsx` — unread count: solid `bg-negative` label now `text-background`; `text-[10px]` → `text-micro`.
- `components/agent/AgentIDE.tsx`, `app/account/ai-execution/page.tsx` — solid `bg-positive` labels `text-white` → `text-background`.
- `app/signals/pro/page.tsx` — solid `bg-warning` CTA `text-warning-foreground` → `text-background`.
- `app/donate/success/page.tsx` — solid `bg-warning` CTA `text-foreground` → `text-background`.
- `app/tools/correlation/page.tsx` — `bg-positive/80` / `bg-negative/80` heat cells `text-foreground` → `text-background`.

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
- Prior working-tree changes verified as part of this phase: `components/layout/AppShell.tsx` (collapsible groups, Pro chips, footer, drawer), `components/candel/candel-nav.ts` (single source), `components/account/account-nav.ts`, `components/layout/app-nav.ts` (duplicate `/scanner` entry already gone).

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

## SEC-001 — Repair the application-layer security suite (B-009/B-010) (2026-10-10)

**What:** The security-negative suite and its `firebase-admin-stub.ts` seam carried ~22 TypeScript errors (promise-returning guards compared without `await`, `unknown`-typed fake-DB traversal, a recursive `ReturnType<>` self-reference, `unknown` app handle) and — more seriously — the suite could neither pass nor fail honestly: three assertions failed at runtime while the process still exited 0. The first real run exposed four defects beyond the types:

- **Token format mismatch:** `signToken()` embedded raw JSON in the middle JWT segment while the stub decodes that segment with `atob()`, so every `requireAdmin` / `requireAdminOrProductOwner` check resolved to `null` (denied) regardless of role. The producer now base64-encodes the payload (the convention already used by `fakes.ts#createCustomToken`), so the authorized branches are actually exercised.
- **False green:** the suite's local `checkAsync` kept its own `passed` flag, but `runSecurityNegativeTests` returned the *harness's* flag, which only the seven placeholder `s.check(true, …)` calls touched. All assertions now route through `createSuite().check`, so the tally and the exit status are authoritative.
- **Ownership seed collision:** `bots/bot-1` was seeded twice (last write wins), so "non-owner denied" passed for the wrong reason. Now `bots/owned-bot` (ownerUid `owner`) and `bots/other-bot` (someone else) are distinct seeds, asserted in both directions plus admin-role and missing-header cases.
- **Unreached branch:** the `custom_bot` entitlement case now clears `trading_access/U1` first, so it reaches the custom-bot path instead of short-circuiting on the still-active trading license seeded one line earlier.
- **Coverage added:** known-token accept path, `getGatewayTokenForUser` live index + stale-index cleanup (`remove()` added to the fake ref), unverifiable token, missing Authorization header, admin role bypassing product ownership.

**Files changed:**
- `tests/security/firebase-admin-stub.ts` — explicit `FakeRef`/`FakeApp` interfaces, `remove()`, `getApps()` returning an `App[]` (lib/firebase-admin.ts reads `.length`/`[0]`), `initializeApp`/`cert` documented as argument-ignoring seams.
- `tests/security/route-auth-negative.test.ts` — awaited guards, typed `bearer()` request helper (no `any`), distinct product seeds, harness-routed assertions.
- `scripts/jiti-tsrun.mjs` — the stub alias keys on `tests/security/` instead of two hard-coded filenames, so a new security suite cannot silently fall through to the real SDK.
- `package.json` — added `test:security`, the command `FIREBASE_RULES_AUDIT.md` §7 already cited.

**Verified:**
- `npm run test:security`: 25 checks, exit 0 — all four previously failing cases now pass.
- Negative control: the same suite with one assertion inverted → exit 1 with the FAIL line (proves exit status tracks assertion results; the same copy exited 0 before this change).
- `npx tsc --noEmit`: exit 0 repo-wide — no `tests/security/` exceptions, which supersedes the "zero errors outside pre-existing `tests/security/`" caveats in UI-001/UI-003/UI-005.
- `npx eslint tests/security/*.ts scripts/jiti-tsrun.mjs`: 0 errors, 0 warnings.

**Remaining limitation:**
- Sections 4-7 stay explicit "covered by the integrated suites" placeholders (`s.check(true, …)`): they assert nothing themselves, they point at the trading/webhook suites. Real route-level assertions need a route-handler seam the app does not expose.
- The suite drives the guards directly rather than through `route.ts` handlers; the 150+ route inventory in `AUTHORIZATION_MATRIX.md` remains a static audit.
- Firebase rules are still statically audited only; emulator/deploy evidence is unchanged (§7 BLOCKED).
- `tests/security/probe2.mjs` remains as an untracked scratch probe superseded by the suite (its `adminAuth.verifyIdToken = …` reassignment cannot work on an ESM binding). Left in place rather than deleted unilaterally.
