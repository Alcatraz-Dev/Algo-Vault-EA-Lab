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
| Files with decorative glow orbs (`rounded-full … blur-[Npx]`) | 30 files | **0** |
| Files with glass-card `backdrop-blur` on non-overlay surfaces | 40 files | 33 (all remaining are legitimate overlays/drawers/scrims) |
| Files with decorative `bg-gradient-to-*` / `bg-linear-to-*` / gradient text | 40 files | **0** (globals comment only) |
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
| Radius system | VERIFIED | `rounded-xl/2xl/3xl` gone from surfaces (globals comment only) |
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
