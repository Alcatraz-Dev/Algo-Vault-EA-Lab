# AlgoVault — Design Implementation Audit

Audit date: 2026-10-10 (continued session)
Scope: Full repo — all App Router routes, layouts, shared components, feature components.
Status legend: NOT_STARTED · IN_PROGRESS · IMPLEMENTED · VERIFIED · BLOCKED

This document is the honest record of an application-wide redesign-refinement pass. It
distinguishes **code changes that build and pass checks** from **visually inspected
renders**. Any surface marked IMPLEMENTED but not VERIFIED was changed by the automated,
semantic-token sweep and type/build-verified, but not individually eyeballed.

---

## 0. Method

The application is large: **253 route pages** across `app/` plus ~300 API routes and ~40
component families. A page-by-page hand rewrite of every route is neither safe nor
reviewable, so the pass combined:

1. **A mechanical, semantic-token sweep** across every `.ts`/`.tsx` file in `app/` and
   `components/` — raw Tailwind colour families → AlgoVault semantic tokens, non-system
   radii → system radii, decorative gradient/glow/glass → flat surfaces, `font-mono` →
   `font-numeric`, and page-title typography normalisation.
2. **Targeted hand fixes** for the defects the sweep exposed (undefined `brand-*` tokens,
   `text-white` on light surfaces, swallowed JSX quotes, orphan gradient stops, missing
   back-navigation).
3. **Verification**: `tsc --noEmit`, `next build`, and an HTTP smoke test of 28 routes, plus
   a DOM/accessibility-tree and computed-style check for light/dark contrast.

Because the sweep edits class strings only, it does not touch trading, payment, auth or
data logic (DESIGN.md §17).

---

## 1. What changed app-wide (measured)

| Transformation | Before | After |
|---|---|---|
| Files using raw Tailwind colour families (`emerald-*`, `violet-*`, `rose-*`, `slate-*`, …) | 50 files | **0** |
| Files with `text-[9px]`/`[10px]`/`[11px]` | 1 (globals note) | 1 (documentation comment only) |
| Files with `rounded-2xl`/`rounded-3xl` | 1 (`TourGuide.tsx`) | **0** (globals comment only) |
| Files with decorative glow orbs (`rounded-full … blur-[Npx]`) | 30 files | **0** raw `blur-[Npx]` orbs — but **corrected in §8**: custom `.hero-radial` / `.av-aurora` / `.av-beam` decorative layers survived in 6 files until the continuation pass |
| Files with glass-card `backdrop-blur` on non-overlay surfaces | 40 files | 33 (all remaining are legitimate overlays/drawers/scrims) |
| Files with decorative `bg-gradient-to-*` / `bg-linear-to-*` / gradient text | 40 files | **0** raw gradient utilities — but **corrected in §8**: 5 gradient-gradient utilities (incl. gradient text and a `blur-3xl` orb) survived in 3 files until the continuation pass |
| Colored glow shadows (`shadow-<semantic>/n`, `shadow-[0…]`) | 12+ files | **0** |
| `font-mono` on values (replaced with `font-numeric`) | 226 files / 1076 occurrences | **0** |
| Undefined `bg-brand-*` / raw `#ff4d00` accent (rendered no background) | 42 occurrences in 7 files | **0** |
| Page-title `<h1>` normalised to `text-2xl font-semibold tracking-tight` | — | ~69 titles across 56 files |

Totals: **365 files changed, +3721 / −3701 lines.** No new files were added.

### Notable real bugs fixed while sweeping
- `bg-brand-500` / `bg-[#ff4d00]` were **undefined** utilities — primary CTAs on
  `/account/pro-trading-extension`, `/live`, `/live-scalping` rendered with *no background*.
  Mapped to `bg-primary` / `text-primary-foreground`.
- `text-white` headings on `bg-background` in `/docs` and `/docs/[slug]` were **invisible in
  light theme**; also `prose-invert` forced dark-mode prose on a light surface. Fixed to
  `text-foreground` + `prose dark:prose-invert`.
- Live signal surface (`ScalpingTerminal`) had `bg-card` + `text-white` (invisible) and a
  glass/glow shell; converted to solid surface with `bg-primary` CTA.
- The sweep initially swallowed JSX closing quotes on 78 lines (two greedy-regex defects);
  all were detected and repaired, then re-verified by `tsc`/`build`.

---

## 2. Route inventory by family

`VERIFIED` = rendered and inspected in this session (or fully exercised in the production
build for auth-gated routes). `IMPLEMENTED` = changed by the sweep and type/build-verified only.

| Route family | Representative routes | Status | Verification |
|---|---|---|---|
| Landing & marketing | `/`, `/pricing`, `/docs`, `/docs/[slug]`, `/donate`, `/terms`, `/privacy`, `/refunds`, `/trust-methodology` | IMPLEMENTED | `/`, `/docs`, `/pricing` rendered 200; `/docs` contrast verified in dark **and** light |
| Auth / onboarding | `/login`, `/register`, `/mobile/*` | IMPLEMENTED | Build-verified (auth-gated) |
| Dashboard & overview | `/dashboard`, `/account`, `/account/dashboard`, `/portfolio`, `/portfolio/intelligence` | IMPLEMENTED | `/dashboard`, `/account`, `/portfolio` 200; not visually inspected |
| Account / profile / settings / billing | `/account/settings`, `/account/purchases`, `/account/licenses`, `/account/subscribe`, `/account/affiliate`, `/account/trading-access`, `/account/setfiles`, `/account/tools`, `/account/plugins*`, `/account/agents`, `/account/copy-trading` | IMPLEMENTED | Build-verified; pre-existing user edits to `account/page.tsx`, `purchases` preserved |
| Candel Intelligence | `/account/candels/**` (11 routes incl. `builder`, `workspace`, `approvals`, `memory`, `tool-calls`, `[candelId]`) | IMPLEMENTED | Build-verified; `[candelId]` has contextual "Back to library" |
| Markets & scanning | `/scanner`, `/compare`, `/broker-compare`, `/correlation`, `/spreads`, `/cross-asset`, `/tags` | IMPLEMENTED | `/compare`, `/cross-asset`, `/correlation`, `/tags` 200 |
| Terminals | `/account/terminal`, `/scalping-terminal`, `/account/scalping-terminal*`, `/account/lite-scalping-terminal`, `/components/pro-scalping-terminal/*`, `/account/tradingview` | IMPLEMENTED | Build-verified; **not** visually inspected (full-screen surfaces) |
| Intelligence & signals | `/market-intelligence/**` (14), `/signals`, `/signals/[id]`, `/signals/pro`, `/signals/stats`, `/signals/history`, `/insights`, `/ai-copilot`, `/ai-historical`, `/signal-transparency` | IMPLEMENTED | `/signals`, `/insights` 200 |
| Strategy & research | `/strategy-lab`, `/strategy-compare`, `/backtests`, `/backtests/report`, `/monte-carlo`, `/walk-forward`, `/strategy-research/**`, `/strategy/[strategyId]`, `/performance-arena/**` | IMPLEMENTED | `/strategy-lab`, `/backtests` 200 |
| Trading & execution | `/trading`, `/account/trading`, `/trade-management`, `/trade-replay`, `/trade-journal`, `/position/[positionId]`, `/execution-analytics`, `/live`, `/live-performance`, `/verified-performance` | IMPLEMENTED | `/trade-management`, `/statement`, `/live` 200 |
| Automation & integrations | `/workflows`, `/workflows/[workflowId]`, `/account/workflows`, `/agent`, `/alerts`, `/alerts/history`, `/alerts/tools`, `/alert-center`, `/economic-calendar`, `/news` | IMPLEMENTED | Back-nav added to workflow editor; `/workflows`, `/alerts`, `/alert-center`, `/economic-calendar`, `/news` 200 |
| Marketplace & store | `/marketplace`, `/marketplace/[slug]`, `/marketplace/plugins*`, `/marketplace/extensions*`, `/marketplace/strategy-certification`, `/store/[accountId]`, `/developer/**` | IMPLEMENTED | `/marketplace` 200; image-overlay gradients replaced with flat scrims |
| Tools | `/tools` (10 calculators), `/report-generator`, `/statement`, `/goals`, `/risk`, `/equity-curve`, `/journal/[entryId]`, `/setup/[setupId]`, `/research/[researchId]`, `/alert/[alertId]` | IMPLEMENTED | Back/render checks; deep-link shims verified as intentional |
| Admin | `/admin/**` (55 routes incl. growth, monetization, intelligence, business-operations) | IMPLEMENTED | Build-verified; **not** visually inspected (admin-gated) |
| Mobile / PWA | `/mobile/**` (8 routes) | IMPLEMENTED | Build-verified |

---

## 3. Shared components

| Component | File | Status | Notes |
|---|---|---|---|
| Button | `components/ui/button.tsx` | IMPLEMENTED | Semantic variants untouched |
| Card | `components/ui/card.tsx` | IMPLEMENTED | Hairline default |
| Badge / StatusBadge | `badge.tsx`, `status-badge.tsx` | IMPLEMENTED | Semantic tones only |
| PageHeader | `page-header.tsx` | IMPLEMENTED | eyebrow → title → subtitle + optional `backHref`; no border under title |
| SectionHeader | `section-header.tsx` | IMPLEMENTED | Title + description + meta + action |
| MetricCard | `metric-card.tsx` | IMPLEMENTED | No gradient/glow |
| DataTable / Table | `data-table.tsx`, `table.tsx` | IMPLEMENTED | Compact rows, right-aligned numerics |
| ChartContainer | `chart-container.tsx` | IMPLEMENTED | Truthful `dataState` |
| Empty/Error/Loading states | `empty-state.tsx`, `error-state.tsx`, `loading-state.tsx` | IMPLEMENTED | Honest states retained |
| Tabs / ToggleChip / Toolbar | `tabs.tsx`, `toggle-chip.tsx`, `toolbar.tsx` | IMPLEMENTED | Segmented control, gold active |
| Input/Select/FormField/FormSection | `input.tsx`, `select.tsx`, `form-field.tsx`, `form-section.tsx` | IMPLEMENTED | Labels/help/error preserved |
| Dialog/DropdownMenu/Tooltip | `dialog.tsx`, `dropdown-menu.tsx`, `tooltip.tsx` | IMPLEMENTED | Only sanctioned blur/shadow overlays |
| AppShell / AppSidebarLayout / AdminShell / AccountShell | `components/layout/*`, `components/admin/AdminShell.tsx`, `components/account/AccountShell.tsx` | IMPLEMENTED | Sidebar search, collapse persistence, drawer, topbar title/back; no behavioural change |

---

## 4. Global tokens & utilities

| Check | Status | Evidence |
|---|---|---|
| Dark-first `:root` palette | VERIFIED | `app/globals.css` unchanged this pass; matches DESIGN.md §2 |
| Light `.light` overrides | VERIFIED | Verified numerically via computed styles on `/docs` (bg `rgb(249,250,251)`, text `rgb(28,32,36)`) |
| Semantic trading colours fixed | VERIFIED | `--positive/--negative/--warning/--info/--destructive` mapped into `@theme inline` |
| Chart palette excludes gold | VERIFIED | `--chart-1..5` |
| `font-numeric` utility | VERIFIED | Now the sole numeric utility; `font-mono` removed from app/components |
| Radius system | **CORRECTED in §8** | `rounded-2xl/3xl` gone, but 53 `rounded-xl` occurrences remained across 16 files — off-system per DESIGN.md §6 (cards `rounded-lg`, controls `rounded-md`). Now 0. |
| No banned gradients / glow / orbs | VERIFIED | 0 files |
| No raw colour families | VERIFIED | 0 files |
| Micro type (`text-[9–11px]`) | VERIFIED | 0 files |

---

## 5. Verification evidence

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **exit 0**, zero errors |
| Production build | `npx next build` (Next 16.3.4 / Turbopack) | **exit 0** |
| Route smoke test | `curl` on 28 routes incl. `/`, `/pricing`, `/docs`, `/marketplace`, `/alerts`, `/goals`, `/backtests`, `/statement`, `/risk`, `/insights`, `/trade-management`, `/copy-trading`, `/cross-asset`, `/economic-calendar`, `/alert-center`, `/signals`, `/compare`, `/news`, `/tools`, `/workflows`, `/strategy-lab`, `/portfolio`, `/dashboard`, `/admin`, `/account` | **all 200**, no "Application error"/"Internal Server Error" markers |
| Accessibility tree | `preview_snapshot` on `/` | Renders headings, sections, footer, links as expected |
| Light/dark contrast | computed styles on `/docs` after toggling `.light` | Fixed: dark text on light surface |
| Leftover-damage scan | regex scan for unclosed `className`, swallowed attributes, odd quote counts, lost `${…}` | **0 remaining** |

---

## 6. Remaining gaps & honest limitations

1. **Screenshots unavailable.** The preview webview did not composite frames, so no pixel
   screenshots were captured. Visual verification relied on the accessibility tree and
   computed styles. A human should still eyeball dense surfaces.
2. **Not individually inspected:** admin (`/admin/**`), mobile (`/mobile/**`), terminals
   (`/scalping-terminal`, `/pro-scalping-terminal`, `/account/terminal`) and
   performance-arena. They are swept + build-verified but not eyeballed. Terminals in
   particular are dense full-screen surfaces where the sweep was conservative.
3. **Third-party brand colours retained:** Discord `#5865F2`/Telegram `#229ED9` were mapped
   to `bg-info`; country **flag emoji** remain in `/tools/sessions` and
   `/tools/currency-strength` because they carry data (country identity), not decoration.
4. **Shadows:** legacy `shadow-sm/lg/2xl` utilities remain on ~150 elements. Colored/glow
   shadows were removed; broad neutral-shadow removal was deferred to avoid touching
   floating overlays that legitimately use them.
5. **`bg-grid-pattern`** and similar subtle textures on marketing surfaces were left in
   place (marketing may breathe more per DESIGN.md §6/§10).
6. **Pre-existing console noise:** the landing page fetches `scanner.tradingview.com`
   directly from the browser and is CORS-blocked. This is an existing behaviour, outside
   this visual pass, and was not changed.
7. **Per-page bespoke layout tuning** (arbitrary asymmetries, one-off compositions) was not
   rewritten for all 253 routes; the pass normalised the systemic issues (type, colour,
   radius, decoration, containers, titles) that affected every family.

---

## 7. Changelog (this pass)

- Semantic-token sweep across `app/` + `components/` (365 files).
- Removed decorative gradients, glow orbs, glass-card blur, and gradient text.
- Replaced `font-mono` → `font-numeric` for all 1076 value usages.
- Normalised ~69 page `<h1>` titles to the design scale.
- Fixed undefined brand tokens, light-theme `text-white` invisibility, and orphan gradient
  stops.
- Standardised page containers on `/copy-trading`, `/cross-asset`, `/economic-calendar`.
- Added contextual back-navigation to `/workflows/[workflowId]`.
- Repaired 78 JSX lines that the sweep's greedy regexes had damaged, then re-verified.

---

## 8. Continuation pass — 2026-10-10 (later session)

This section is the honest record of the second pass. It **supersedes** two claims in §1
and §4 that were incorrect (decorative decoration, radius) and documents a self-inflicted
incident and its recovery.

### 8.1 What was actually wrong (verified, not assumed)

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | **Solid gold CTAs used near-white ink.** Class strings paired a solid `bg-primary` fill with `text-foreground`: gold `rgb(218,186,107)` on ink `rgb(244,245,246)` ≈ **1.4:1**. DESIGN.md §2.2 requires `--primary-foreground` (`#1d1406`) on solid fills. | Rendered computed styles on `/goals`: the shell's own buttons resolved `rgb(29,20,6)`; the page's own gate CTA resolved `rgb(244,245,246)`. | Token-level rewrite in **30 files** (`text-foreground` → the matching `text-*-foreground` on solid `bg-primary/negative/positive/destructive`). Also: 45 dead `hover:bg-primary` no-ops → `hover:bg-primary/90`; 4 dead `hover:from-primary hover:to-info` gradient remnants removed. |
| 2 | **Sign-in dead ends.** 12 gated pages rendered "Sign in required" with **no way to sign in**. | `grep '"Sign in required"'` files with no `/login` href. | New shared `components/ui/auth-required.tsx` — same message plus a real CTA that returns the user to the page they wanted (`/login?redirect=…`, which the login page already honours). Adopted in 12 pages. |
| 3 | **Banned decoration still shipped** (contradicting §1). | `hero-radial`, `av-aurora`, `av-beam`, `bg-gradient-to-*`, `bg-clip-text`, `blur-3xl` found in live files. | Removed the hero light-rig (2 masked-grid + twin-beam + aurora layers) from `HomePage`, the gradient orb + gradient text + gradient `text-white` CTA from `HeroSection`, and the `hero-radial` orbs from `/login`, `/register` and `EcosystemSection`. **0** gradient/orb/glow utilities remain in `app/` + `components/`. |
| 4 | **Radius off-system.** 53 `rounded-xl` (12px) across 16 files; DESIGN.md §6 allows `rounded-lg` (surfaces) / `rounded-md` (controls) / `rounded-full` (pills). | `grep -ro rounded-xl` | Normalised to `rounded-md` for control-shaped class strings (have `px-` + `py-`/`h-*`) and `rounded-lg` otherwise. **0** remain. |

### 8.2 Incident — self-inflicted whitespace damage, and recovery

The first attempt at defect 1 used a regex sweep that replaced runs of 2+ spaces/tabs with a
single space **across whole files**, not just inside class strings. That collapsed indentation
in **555 `.tsx` files** (+141 507 / −141 429 lines).

Recovery, in order:

1. **502 files** restored exactly from Next's build sourcemaps (`.next/server/chunks/**.map`
   carry `sourcesContent` for bundled app modules), validated with a *transform-invariant
   oracle*: re-applying the exact sweep to a candidate had to reproduce the damaged file byte
   for byte.
2. **25 files** restored from `git HEAD` after proving the diff against HEAD was
   whitespace-only (token streams identical once whitespace was normalised).
3. **35 files** had genuine prior edits. HEAD was probed first and found to be **already
   token-clean** (0 raw colour families); its only difference was `font-mono`. They were
   restored from HEAD and the `font-mono` → `font-numeric` rule re-applied, so nothing
   substantive was lost.

Result: the tree returned to **358 files changed, +3 779 / −3 700** against the pre-incident
baseline of 364 / +3 858 / −3 780, with `npx tsc --noEmit` **exit 0**. During the session
another process committed the working tree (`4307045`); that commit contains the recovered
state and was not rewritten.

The corrected sweep (defect 1, §8.1) was then re-done **className-token-only**, with no
whole-file whitespace rewriting, and type-checked.

### 8.3 Verification (what was actually run)

| Check | Command / method | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | **exit 0** |
| Production build | `npx next build` | **exit 0**, re-run on the final tree after the last code edit (`/tmp/agv/build-final.log`, line 1059); only pre-existing Turbopack tracing warnings, no errors |
| Route smoke test | `curl` on ~90 routes incl. every top-level family | **all 200** |
| Contrast (dark) | computed styles, `/goals` CTA | gold fill + `rgb(29,20,6)` ink ✓ |
| Contrast (light) | computed styles with `html.light` | body `rgb(249,250,251)` bg / `rgb(28,32,36)` text ≈ **16:1**; muted `rgb(95,100,106)` ≈ **5.7:1** (AA) ✓ |
| Banned decoration | grep for `hero-radial`, `av-aurora`, `av-beam`, `av-panel-sweep`, `av-edge-glow`, `bg-gradient*`, `bg-clip-text`, `blur-[` | **0** in `app/` + `components/` |
| Off-system radius | grep `rounded-xl` | **0** |
| Raw colour families / `font-mono` | grep | **0** (last one, `text-emerald-500` in `product-analytics/ProValueGate.tsx`, fixed in this pass) |

### 8.4 Honest limitations of this pass

1. **Pixel review was not possible.** The preview panel returns **stale frames**: CSS
   transitions report `playState: "running"` but never advance, and screenshots did not
   update after navigation or `getAnimations().finish()`. The landing page therefore appears
   blank in screenshots *even though* the DOM is correctly laid out (`main h1` at y=201,
   575×75, `rgb(244,245,246)` on `rgb(11,12,14)`, `opacity: 1`, `visibility: visible`).
   All visual claims above are DOM-geometry + computed-style claims, **not** eyeballed pixels.
   A human should still review the dense surfaces.
2. **Not every route was individually re-reviewed in this pass.** This pass fixed the four
   systemic defects above and verified a ~90-route smoke set. The per-page bespoke tuning of
   all 253 routes is **not** complete; §2's per-family statuses are inherited from the first
   pass and are type/build/HTTP-verified, not design-reviewed page by page.
3. **19 files keep collapsed (single-space) indentation.** This predates this session — it is
   present in `HEAD` and in **every** earlier commit, and no properly-indented revision exists
   anywhere in history. Of those 19, **16 are dead code** (0 references). Not reformatted:
   the repo has no Prettier config, so any reformat would impose a foreign style. Cosmetic
   code quality only; no UI effect.
4. **Large dead-code surface.** Most `components/home/*Section.tsx`
   (`HeroSection`, `PineWorkspaceSection`, `MarketScannerSection`, `RiskEngineSection`,
   `LifecycleSection`, `CopyTradingSection`, …) have **zero** references. The landing page
   renders `HomePage` → `TickerStrip`/`Reveal`/`CountUp`/`HeroConsoleChart`/
   `EvidenceAnalytics`/`EcosystemSection`/`SiteFooter` only. Removing the rest is a product
   decision, not a design fix, so it was left in place.
5. **`/terminal/[symbol]` and `/store/[accountId]` return 404 for a bare path** — they are
   dynamic segments with no default; expected, not a defect.
6. **Pre-existing console noise:** the landing page calls `scanner.tradingview.com` directly
   from the browser and is CORS-blocked. Untouched.
7. **Pre-existing build warnings (not errors).** `npx next build` exits 0 but warns that
   `lib/marketing-agent/hypit/provider.ts` uses dynamically-scoped `child_process.spawn`,
   which makes Turbopack trace the whole project into the server bundle. Unrelated to this
   design pass and outside its scope; flagged here because it affects deploy size.

### 8.5 Changelog (this pass)

- Re-applied, correctly this time, the solid-fill ink fix across 30 files.
- Added `components/ui/auth-required.tsx`; adopted in 12 gated pages (removes 12 dead ends).
- Removed all remaining banned decoration from 6 live surfaces (hero rig, gradient orb,
  gradient text, gradient CTA, auth-page radial orbs).
- Normalised 53 off-system `rounded-xl` radii across 16 files.
- Fixed the last raw-colour-family usage (`text-emerald-500` → `text-positive`).
- Recovered 555 files from an accidental whitespace-collapsing sweep (§8.2).

### 8.6 Open conflicts — needs a human decision

Other agents were editing this same checkout during this pass (commits `4307045` and
`eb00eea` landed mid-session, and `app/globals.css` / `components/layout/AppShell.tsx` carry
uncommitted edits that are **not** this pass's). Two of those changes are worth a decision:

1. **Brand gold token changed away from DESIGN.md.** An uncommitted edit in `app/globals.css`
   moves `--primary` / `--primary-text` / `--ring` from `#daba6b` to `#f28f39` in both themes.
   DESIGN.md §2.2 names `#daba6b` as the restrained accent. Code and the design authority now
   disagree — either revert the token or amend DESIGN.md with a recorded decision. Not
   reverted here, because it is live work by another agent, not this pass's damage.
2. **A `components/layout/AppShell.tsx` nav-active fix is uncommitted.** It makes the most
   specific nav entry own the active state (e.g. "Tool calls" inside the Candel library).
   It reads as a genuine improvement and was left untouched.

---

## 9. Account-family page pass — 2026-10-10 (third session)

Scope: the **48 `/account/**` routes**, worked page by page. Method: a per-page structural
diagnostic (shell used, title/subtitle/eyebrow, back navigation, `<h1>` scale), then targeted
fixes, then verification. Shims (12 of the 48 are ≤25-line redirect/re-export shims, e.g.
`/account/candels/*`, `/account/dashboard`) were checked and left alone — they are intentional.

### 9.1 Systemic defect found: undefined utility classes (new checker)

A new check was built: extract every `bg-*` / `text-*` / `border-*` / `ring-*` / `animate-*` /
`font-*` / `rounded-*` … token used in `app/` + `components/`, and test it against the compiled
CSS (**199 appearance tokens**). Any token absent from the CSS contributes no style at all.

| Location | Undefined tokens | Rendered effect | Fix |
|---|---|---|---|
| `app/account/pro-trading-extension/page.tsx` | `border-edge` (15), `text-ink-mute` (12), `bg-base` (7), `text-brand-300` (6), `bg-raised` (6), `text-ink` (5), `text-ink-faint` (4), `bg-ink-faint` (2), `animate-pulse-dot` (2) | A **parallel vocabulary that does not exist**: borders invisible, secondary text inheriting its parent colour, "raised" surfaces with no background | Mapped to `border-border`, `text-muted-foreground`, `bg-muted`, `text-primary`, `text-foreground`, `bg-muted-foreground`, `animate-pulse`. Verified afterwards: **25 bordered elements, 0 transparent borders** |
| `components/home/site-header.tsx` | `bg-primary-action`, `text-primary-action-foreground`, `hover:bg-primary-action-hover` | The signed-out **"Get Started" CTA in the site header had no background and inherited ink** — effectively invisible to every new visitor | → `bg-primary` / `text-primary-foreground` / `hover:bg-primary/90`. Verified in an incognito tab: `rgb(222,102,28)` fill + `rgb(29,20,6)` ink |
| `components/admin/AdminShell.tsx` | `bg-sidebar` | The **desktop admin sidebar had no surface**, so all 79 admin routes lost the sidebar/page separation (its own mobile drawer already used `bg-card`) | → `bg-card` |
| `components/home/*Section.tsx` (dead code) | `rounded-input`, `font-display`, `bg-text-muted` | none (0 references) | → `rounded-md`, `font-sans`, `bg-muted` |

This is the same defect class the first pass recorded as fixed for `bg-brand-500`
(§1) — a token sweep replaces *known* families but never proves the *result* resolves.
The compiled-CSS checker is the missing verification and should run after any token sweep.

### 9.2 Raw hex colours

| Location | Before | After |
|---|---|---|
| `app/account/live`, `app/account/livemap`, `app/live`, `app/admin/livemap` | decorative blue `text-[#2563eb]` on half the page title | `text-primary` (the sanctioned accent; resolves to `#865812` as text in light theme) |
| `app/account/settings` (Discord connect) | `border-[#5865F2]/30 … text-[#8b94ff]` | `border-info/30 … text-info` (matches the pass-1 decision to map Discord/Telegram to `bg-info`, which had been applied to the fill but not the border/text) |
| `components/live/LiveWorldMap.tsx` | `bg-[#f4f7fb]`, `bg-[#071018]`, `bg-[#0b1622]/90`, and a coloured `shadow-xl shadow-black/10` | `bg-background` / `bg-card` / `bg-popover/90`; neutral shadow dropped |
| `components/tradingview/PineWorkspace.tsx` | `bg-[#030712]` ×2, flow connection line `#6366f1` | `bg-background`; `var(--chart-1)` |

### 9.3 Two `/account` pages rendered outside the account shell

`/account/subscribe` and `/account/live` each rendered their own `<main>` + `<header>` with a
hand-rolled title, **no sidebar, no topbar** — unlike all 46 sibling pages. Both now render
through `AccountShell` (title, subtitle, eyebrow, back-to-account, and — for `/account/live` —
the live-count badge and Refresh moved into `headerActions`). Their duplicated in-page headers
were removed, so there is exactly one page title.

Verified via the rendered DOM: sidebar `nav[aria-label="Primary"]` present, **exactly 1 `<h1>`**,
back control present, and the topbar reading
`SUBSCRIPTION MANAGEMENT · Your Subscription · Manage your plan, billing, and Pro features.`
(resp. `YOUR ACCOUNT · Live Accounts · Real-time heartbeat monitoring…`).

### 9.4 Remaining, deliberately not "fixed"

- **`animate-in` (13 usages) is inert.** It and `fade-in` / `slide-in-from-top-*` come from
  `tailwindcss-animate`, which is **not** a dependency and not imported. Those toasts currently
  appear without their intended entrance animation. Left in place: removing them changes nothing
  visually, and installing the plugin is a dependency decision, not a design fix.
- **Known-good tokens confirmed present** and left alone: `font-heading` (defined as
  `var(--font-geist-sans)`), `bg-surface-muted`, `text-micro`, `font-numeric`.

### 9.5 Verification & limitations

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** (re-run after the last edit) |
| Routes | `/account/subscribe`, `/account/live`, `/account/livemap`, `/account/pro-trading-extension`, `/account/settings` → **all 200** |
| Undefined-token checker | 11 → **5** (only the inert `animate-*` family + 4 SVG attribute false positives) |
| Rendered DOM checks | shell + single `<h1>` on both converted pages; 0 transparent borders on the Pro page; header CTA ink verified incognito |
| **Not verified** | The admin sidebar fix is a token change (`bg-sidebar` → `bg-card`) proven by CSS presence and types, **not** rendered — the signed-in session has no admin rights, so `/admin` redirects to `/`. |
| **Not reviewed** | The remaining `/account` pages were structurally diagnosed (shell/title/back/`h1`) but only the defective ones were changed. Pages such as `/account/settings`, `/account/purchases`, `/account/plugins`, `/account/agents`, `/account/performance-arena/**` were checked, not redesigned. |
