# AlgoVault — Premium Design System

> **Status: authoritative.** This document is the single design authority for AlgoVault.
> It replaces the previous restraint-first design specification in full. Where older
> notes, comments, or audit logs describe a different visual language, this file wins.
>
> Scope: **visual language, tokens, typography, layout, components, motion, and the
> workflow for bringing in third-party UI.** It does not redefine product behaviour —
> for what the product *is* and *must keep doing*, [`PRODUCT.md`](./PRODUCT.md) and
> [`AGENTS.md`](./AGENTS.md) are authoritative and are not replaced by this file.
>
> Read order for any UI task: `AGENTS.md` → `PRODUCT.md` → this file → the code it
> touches. Never redesign from a screenshot or a chat summary; inspect the real component.

---

## 0. How to use this document

1. **Decide from purpose.** §7 maps each real product area to its layout and interaction
   model. Start there, not from a component catalogue.
2. **Reuse before you build.** Existing project component → installed library →
   shadcn primitive → ReUI composed → Aceternity effect (marketing only) → custom. §13.
3. **One product, two temperatures.** Marketing surfaces are expressive (light, depth,
   motion). Trading and data surfaces are precise, dense, and calm. Both share the same
   tokens, type, and radius — never two design systems stitched together.
4. **Both themes are first-class.** Dark is the default (`:root` holds dark, `.light`
   overrides). Every change is checked in **dark and light**.
5. **Behaviour is protected.** Firebase, auth, Stripe, trading logic, routes, chart
   engines, and theme switching must keep working. See `PRODUCT.md`.
6. **Keep the docs few.** This file + `PRODUCT.md` + `AGENTS.md` are the documentation
   of record. Do not add a fourth overlapping design doc; extend this one.

---

## 1. Design philosophy and visual identity

**AlgoVault is a premium trading command centre.** The interface should feel like
precision equipment presented with flagship-SaaS craft: deep dark surfaces, a warm
ember brand accent spent deliberately, crisp tabular data, and motion that guides
rather than decorates. A first-time visitor should read *sophisticated fintech*; a
daily trader should read *fast, legible, trustworthy*.

### 1.1 Principles

1. **Hierarchy before decoration.** Every surface answers: what is primary, what is
   meta, what is actionable. Tone steps, hairline borders, and one accent do the work.
2. **Depth with restraint.** Layered surfaces (`background → card → popover`), soft
   shadows on floating elements, and a single curated light system (spotlight/aurora)
   reserved for marketing and hero moments. Data surfaces stay solid and glare-free.
3. **One meaning per colour.** Profit/loss, buy/sell, live/stale, brand/action, error —
   each has exactly one colour, never swapped per page, never decorative. (§2.4)
4. **Density with air.** Trading views are information-dense but never cramped: 4px
   spacing steps, a real type scale, tabular numerals, generous prose line-height.
5. **Motion confirms.** Entrances orient once; state changes are fast and local. Nothing
   loops in peripheral vision on a working surface. Marketing may perform; terminals
   must not.
6. **Honest state.** Loading / stale / offline / unavailable are visible states, never
   faked as live. The UI upholds the product's no-fabrication contract (`PRODUCT.md`).
7. **Craft is the brand.** Ember earns attention because it is rare. If a screen glows,
   it is because something is actionable, live, or celebratory — never by default.

### 1.2 Voice & tone (interface copy)

- Direct, factual, second person where natural. "Run backtest", not "Let's get started!".
- Never claim success that did not happen (`PRODUCT.md`). Buttons name the action;
  toasts and states name the verified outcome.
- Numbers render in the numeric face with tabular figures, explicit units/currency, and
  `Unavailable` / `Stale` rather than blanks or invented values.
- Sentence case for labels. Uppercase micro-labels only for eyebrows and group labels.

### 1.3 What changed from the previous direction

The old baseline was uniformly flat and austere everywhere (no elevation, no light
effects, minimal motion on all surfaces). The new direction keeps that discipline
**where money is on the line** (terminals, tables, order entry) but introduces a
warmer, more dimensional premium layer: elevated cards with soft shadow, a spotlight/
aurora light system for marketing and hero sections, bento-grid storytelling, richer
empty/onboarding states, and a unified motion system with scroll-triggered reveals on
marketing pages. Same tokens and type underneath — different temperature on top.

---

## 2. Design tokens

All tokens live in **`app/globals.css`** (Tailwind v4, CSS-first — there is **no**
`tailwind.config.*`). `:root` holds the dark theme; `.light` overrides it; `@theme
inline` exposes them as Tailwind utilities; a FlyonUI bridge maps FlyonUI semantics
onto them. This matches the shadcn CSS-variable theming convention
(`:root` / theme override + `@theme inline`), except the override selector is
`.light` (dark-first) rather than shadcn's default `.dark`.

> **Rule:** never hard-code a hex, never use a raw Tailwind colour family
> (`bg-blue-500`, `text-emerald-400`, …), never add a colour to a component. Add a
> token here and reference it.

### 2.1 Surfaces & text

| Token | Tailwind | Dark | Light | Use |
|---|---|---|---|---|
| `--background` | `bg-background` | `#0a0b0d` | `#f7f8fa` | Page canvas |
| `--card` | `bg-card` | `#121417` | `#ffffff` | Panels, tables, cards (one step above page) |
| `--popover` | `bg-popover` | `#171a1f` | `#ffffff` | Menus, modals, floating surfaces |
| `--secondary` / `--muted` / `--accent` | `bg-muted` | `#1b1e24` | `#eceef1` | Recessed wells, hover rows, toolbars |
| `--foreground` | `text-foreground` | `#f5f6f7` | `#191d22` | Primary text |
| `--muted-foreground` | `text-muted-foreground` | `#9aa0a8` | `#5c626a` | Secondary text, labels, units |
| `--border-color` | `border-border` | `#262a31` | `#d9dde3` | **Border colour** |
| `--input` | `border-input` | `#33373e` | `#c2c7ce` | Input outlines |
| `--ring` | `ring-ring` | `#f97316` | `#c2410c` | Focus ring |

> **Trap:** FlyonUI claims `--border` as a **length** (border width). The border
> **colour** token is `--border-color`, exposed as `border-border`. Do not redefine
> `--border`.

### 2.2 Brand — "Ember"

| Token | Dark | Light | Notes |
|---|---|---|---|
| `--primary` | `#f97316` | `#ea580c` | Brand accent: solid fills, active states, brand mark, key CTAs |
| `--primary-foreground` | `#1c0e02` | `#fff7ed` | Ink on solid ember (dark: near-black, AAA; light: warm white) |
| `--primary-text` | `#fb923c` | `#c2410c` | Text/links — lightened for dark surfaces, deepened for light (AA) |

Laws for ember:

- **Ember is never profit, buy, or success.** Those are semantic (§2.4).
- **Solid ember carries `text-primary-foreground` ink**, never white on dark — white on
  `#f97316` fails contrast.
- **Tinted ember = `bg-primary/10` + `text-primary` + `border-primary/30..40`** (the
  "active / PRO" chip idiom).
- **Ember is rationed.** One primary CTA per view; nav active states; live/progress
  accents; marketing light tints. If a screen is orange, something is actionable,
  active, or live.
- Light-theme text uses the deeper `#c2410c` (≈4.6:1 on `#f7f8fa`). The existing
  `html.light .text-primary` override pattern in `globals.css` implements this — keep it.

### 2.3 Radii — one ladder

`--radius: 0.625rem` (shadcn default base). Everything derives from it via the shadcn
radius scale (`--radius-sm/md/lg/xl`); do not introduce ad-hoc radii.

| Class | Use |
|---|---|
| `rounded-sm` | Small chips, dense controls |
| `rounded-md` | Inputs, buttons, medium controls |
| `rounded-xl` | **Cards, panels, tables, chart frames (canonical container radius)** |
| `rounded-2xl` | Large overlays, hero surfaces, marketing bands |
| `rounded-full` | Badges/status pills, avatars, icon chips |

> **ReUI note.** ReUI components ship with their installed style's radius (this project
> uses `base-lyra`). After installing any ReUI component, normalise its radius rung to
> this ladder. A sharp/0px treatment is allowed only as a deliberate localised choice.

### 2.4 Semantic & categorical colour

**Directional / status (fixed, never swapped):**

| Token | Dark | Light | Meaning |
|---|---|---|---|
| `--positive` / `--success` | `#34d399` | `#047857` | Profit, buy, long, live, success |
| `--negative` | `#f87171` | `#b91c1c` | Loss, sell, short, error |
| `--warning` | `#fbbf24` | `#b45309` | Caution / pending / stale |
| `--info` | `#60a5fa` | `#1d4ed8` | Informational |
| `--destructive` | `#f87171` | `#b91c1c` | Destructive action |

Each has a `-foreground` token (legible text on a low-opacity tint) and a `-muted`
token (`color-mix(in oklch, <hue> 14%, transparent)`) for tinted backgrounds and
badges. **Pattern:** `bg-positive-muted text-positive border-positive/30`. For solid
semantic fills, use `text-background` as the adaptive ink (not white on dark).

**Categorical chart series** (`--chart-1..5`: blue `#7aa2ff`, teal `#3fd0c0`, violet
`#b79dff`, pink `#f08fbf`, ember) exist **for data visualisation only** and deliberately
exclude profit/loss hues for arbitrary series. Do not use them for UI chrome; do not
use semantic tokens for arbitrary series.

### 2.5 Shadows & elevation

| Token / use | Value | Notes |
|---|---|---|
| Card rest | `shadow-sm` + `border-border` | Default panel elevation |
| Card hover (interactive) | `shadow-md`, `translate-y-[-1px]` | Pointer affordance, 150ms |
| Floating (menus, popovers) | `shadow-lg` | Genuinely floating only |
| Modal / drawer | `shadow-xl` + scrim `bg-background/70 backdrop-blur-sm` | Scrims are the one place blur is allowed in-app |
| Marketing hero glow | spotlight/aurora layers (§8.4) | Never over live data |

No glow boxes or gradient panels on data surfaces. Hierarchy in-app comes from surface
steps + hairlines + elevation, in that order.

### 2.6 Z-index, breakpoints, motion tokens

- **Z-index:** sticky chrome `z-40`, mobile drawer `z-50`, menus/popovers `z-50`,
  command palette topmost. No new layers; extend the scale.
- **Breakpoints:** `sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536` (Tailwind default).
- **Motion tokens:** `--ease-standard: cubic-bezier(0.2,0,0,1)`,
  `--ease-emphasized: cubic-bezier(0.32,0.72,0,1)`,
  `--ease-reveal: cubic-bezier(0.22,1,0.36,1)`. Durations: feedback 150–250ms,
  entrances ≤700ms. Full system in §8.

### 2.7 Token hygiene checklist

- Add a token in `:root` **and** `.light` when it must theme, then map it in
  `@theme inline` so a Tailwind utility exists (shadcn "adding new tokens" pattern).
- Prefer `color-mix(in oklch, …)` tints over new literal colours.
- Verify new text/border tokens pass contrast in both themes (§11).

---

## 3. Typography

**Families** (loaded via `next/font/google` in `app/layout.tsx`; keep — no new fonts):

- `--font-geist-sans` → **Geist Sans**, mapped to `--font-sans` and `--font-heading`.
- `--font-geist-mono` → **Geist Mono**, mapped to `--font-numeric`.

Emphasis comes from weight, size, and tracking — not a display face.

**Numeric rule (hard).** Every comparable number — prices, P&L, %, R multiples,
timestamps, balances, counts, table cells — renders with **`font-numeric`**
(`font-variant-numeric: tabular-nums`). Replace legacy `font-mono` with `font-numeric`
when touching those lines.

**Type scale:**

| Role | Classes | Notes |
|---|---|---|
| Marketing hero (`h1`) | `text-4xl sm:text-6xl lg:text-7xl font-semibold leading-[1.04] tracking-[-0.04em]` + text-generate or reveal entrance | Landing only, one per page |
| Page title (`h1`) | `text-xl sm:text-2xl font-semibold tracking-tight` | One `h1` per page, owned by `PageHeader` or shell |
| Section title (`h2`) | `text-sm font-semibold tracking-tight` (`SectionHeader`) | Inside panels |
| Marketing section title | `text-3xl sm:text-4xl font-semibold tracking-tight text-balance` | With eyebrow above |
| Body | `text-sm` (14px), prose `leading-6/7` | Default |
| Secondary | `text-xs` (12px) `text-muted-foreground` | Labels, units, meta |
| Micro floor | 11px utility (`.text-micro`), 12px `.text-meta` | The floor — never below 11px in-app |
| Numeric emphasis | `font-numeric text-lg/xl font-semibold tracking-tight` | KPI values |

**Rules:**

- **11px is the floor in-app.** Replace `text-[9px]/[10px]` with the micro utility.
- Short headings get `text-balance`; prose gets `text-pretty`.
- Uppercase micro-labels only for eyebrows/group/chip labels with wide tracking. Never
  uppercase a sentence.
- Never encode hierarchy with colour alone — pair size/weight with tone.

---

## 4. Layout & spacing system

- **Spacing step = 4px.** `gap-*` for groups, never `space-y-*`. Rhythm: `gap-1.5`
  (tight clusters), `gap-2/3` (component internals), `gap-4/6` (card content / section
  grid), `py-14 md:py-20` (marketing bands).
- **Page container:** `max-width: 1200px; margin-inline: auto; padding-inline: 32px`
  (16px under 640px) for marketing and full-width bands.
- **Product pages** use shell padding: `max-w-7xl px-4 py-6 sm:px-6 lg:px-8`; fullscreen/
  terminal views use compact `px-3 py-3 sm:px-4` and trade the title band for chart height.
- **Panel grids:** default `gap-4/gap-6`; flush hairline grids use the `gap-px bg-border`
  wrapper idiom for tables of cards.
- **Dashboard layouts:** KPI row (3–4 `MetricCard`) → toolbar → content grid
  (`2fr 1fr` for main + rail, collapsing to one column under `lg`).
- **Density:** controls default 36px (`h-9`); `sm`/`xs` for dense toolbars. Touch targets
  ≥44px on coarse pointers.
- **Alignment:** numeric columns right-aligned with tabular figures; labels left. Tables
  keep fixed headers.
- **Empty space is intentional.** Marketing breathes (`py-14 md:py-20` bands, generous
  section gaps); terminals spend every pixel on data. Match the temperature of the
  surface (§7).

---

## 5. Page architecture & page headers

### 5.1 Route families (257 pages under `app/`)

| Family | Examples | Shell | Notes |
|---|---|---|---|
| Marketing / public | `/`, `/pricing`, `/marketplace`, `/compare`, `/affiliates`, `/docs`, legal | `SiteHeader` + `SiteFooter` | Expressive temperature; Aceternity effects allowed (§8.4) |
| Auth | `/login`, `/register` | Standalone centred | Calm, single-column, brand glow accent |
| Account / app | `/dashboard`, `/portfolio`, `/signals`, `/strategy-lab`, `/backtests`, `/tools/*`, `/statement`, `/news`, `/copy-trading`, `/cross-asset` | `AccountShell` or `AppSidebarLayout` | Dense product surfaces |
| Terminals | `/terminal/[symbol]`, `/account/terminal`, `/scalping-terminal`, `/trade-replay` | `AppShell` fullscreen / `hideSidebar` | Chart owns vertical space; chrome collapses |
| Intelligence | `/market-intelligence/**` (14 routes), `/ai-copilot`, `/insights`, `/signals/**` | `AppSidebarLayout` | Evidence-first layouts; timeline + evidence panels |
| Strategy | `/strategy-lab`, `/backtests`, `/walk-forward`, `/monte-carlo`, `/equity-curve`, `/strategy-research/**` | `AppSidebarLayout` | Lab pattern: config rail + results canvas |
| Admin | `/admin/**` (~72 routes) | `AdminShell` (behind `AdminGuard`) | Operational density; ReUI data-grid + filters |
| Developer | `/developer/**`, `/agent` | `AppShell` + `DEVELOPER_NAV` | Internal |
| Mobile | `/mobile/**` | Own layout | Slimmed shell, bottom-nav pattern |

**Rule:** a page never renders its own top-level chrome. It renders inside a shell
(§6) and opens with a `PageHeader`. Marketing pages compose from
`components/home/site-header` + `components/footer`.

### 5.2 Standard page composition

```
Shell (topbar + sidebar + <main>)
└─ PageHeader            eyebrow → h1 → description, action cluster, optional back
   ├─ MetricCard row     3–4 KPIs, font-numeric values, honest deltas
   ├─ Toolbar            filters, search, view toggles
   ├─ Content            Card / DataTable / ChartContainer / Empty / Error / Loading
   └─ SectionHeader(s)   group titles inside the page
```

- **Page titles are typographic, not boxed.** `PageHeader` renders clean type — no
  bordered container around the title block. Borders/backgrounds only where they serve
  grouping.
- **Header spacing:** back-to-title `gap-2`, title-to-description `gap-1`,
  header-to-actions responsive wrap (actions drop to their own row under `sm`),
  header-to-content `gap-6`.
- **Exactly one `h1`** per page. Four canonical states mandatory: `LoadingState`,
  `EmptyState`, `ErrorState`, honest data states (`live/stale/offline/unavailable`).
- **Do not invent a parallel page** for an existing feature; extend the existing route.

### 5.3 Purpose-built compositions

- **Trading workspace:** toolbar rail (symbol, timeframe, order entry) + chart canvas +
  bottom dock (positions/orders/history tabs). No marketing motion; 150ms feedback only.
- **Lab (strategy/backtest/optimization):** left config rail (stepper for multi-step
  flows) + results canvas (equity curve, metrics grid, run timeline).
- **Feed (signals/insights/news/social):** single-column stream of rich cards with
  status badges, evidence footers, and filter toolbar; infinite scroll where real.
- **Detail (strategy/product/signal/bot/position):** back link → header with status →
  KPI strip → tabbed sections (overview, evidence/performance, activity, settings).
- **Settings/forms:** grouped `FormSection`s with descriptions, validation, sticky
  save/cancel bar. Multi-step → ReUI `stepper`.
- **Auth:** centred card (max-w-sm), brand glow accent, social/divider patterns from
  shadcn; no app chrome.

---

## 6. Navigation & application shells

Canonical shells (do not fork them — restyle within them):

| Component | Path | Purpose |
|---|---|---|
| `AppShell` | `components/layout/AppShell.tsx` | Authenticated shell: sticky topbar (title, actions, palette, notifications, theme, account), grouped collapsible sidebar with search, mobile drawer, page entrance |
| `AccountShell` | `components/account/AccountShell.tsx` | `AppShell` + `ACCOUNT_NAV`, back-navigation, live status chip |
| `AdminShell` | `components/admin/AdminShell.tsx` | `AppShell` + `ADMIN_NAV`, admin controls |
| `AppSidebarLayout` | `components/layout/AppSidebarLayout.tsx` | `AppShell` + `APP_NAV` for bare route families |
| `SiteHeader` / `SiteFooter` | `components/home/site-header.tsx`, `components/footer/*` | Marketing chrome; resizable/floating behaviour per Aceternity resizable-navbar pattern |

**Navigation is data:** `APP_NAV`, `ADMIN_NAV`, `DEVELOPER_NAV`
(`components/layout/app-nav.ts`), `ACCOUNT_NAV` (`components/account/account-nav.ts`).
Adding a route means adding an entry — never hand-written sidebar markup.

Shell rules:

- Exactly **one** shell per page tree. Never nest shells.
- Sidebar groups follow the trading workflow (`PRODUCT.md` spine), most specific entry
  owns the active state. Active item: tinted ember surface + `text-primary` + icon tile.
- Topbar controls share one language: hairline borders, muted icons brightening on
  hover, visible focus ring, 40px touch target on phones / 36px desktop.
- `⌘K` / `Ctrl+K` opens `CommandPalette` (shadcn `command` primitive); nav entries and
  palette groups stay in sync.
- Mobile: sidebar becomes a focus-locked drawer with overlay + entrance under `lg`;
  terminals collapse chrome first, then rail into a bottom sheet.

---

## 7. Component library

**Primitive home: `components/ui/*`** (button, card, badge, input, select, tabs, dialog,
dropdown-menu, tooltip, table/data-table, metric-card, status-badge, page-header,
section-header, toolbar, empty/error/loading-state, chart-container, …). **Icons:**
`lucide-react` in product surfaces, `@phosphor-icons/react` in newer marketing — one
set per tree, explicit `size={13–18}`, decorative icons `aria-hidden`.

**Source decision order (§10):** existing project component → installed library →
shadcn primitive → ReUI composed → Aceternity effect (marketing only) → custom.

### 7.1 Component standards

| Category | Preferred source | Treatment & behaviour |
|---|---|---|
| Buttons | shadcn `button` (project `components/ui/button.tsx`) | Variants default/outline/secondary/ghost/destructive/link; 36px default; stateful loading pattern (Aceternity stateful-button) for async actions |
| Icon buttons | shadcn + `Tooltip` | Always `aria-label`; 36–40px target |
| Inputs, textarea, selects | shadcn `input/textarea/select`, ReUI `autocomplete`, `number-field` (scrub for quantities), `phone-input` | `form-field` wrapper with label + hint + error; validation inline |
| Search | shadcn `command` (palette), ReUI `cascader` for nested market/symbol pickers | Debounced; empty state with 1 action |
| Filters | ReUI `filters` (basic chip row over tables; advanced builder inline) | Single `FilterQuery` tree; saved views open in either variant |
| Tables → Data grids | **ReUI `data-grid`** (TanStack v9, `useTable` + `dataGridFeatures`) for admin/operational tables; project `DataTable` for simple read-only lists | Sticky header, `meta.skeleton` loading rows, `emptyMessage` with Retry, numeric `meta` right-alignment; never hand-rolled pagination |
| Tabs | shadcn `tabs` / Aceternity animated tabs (`layoutId` pill, spring bounce 0.3 / 0.6s) for marketing | Route-synced where deep-linkable |
| Dialogs / drawers | shadcn `dialog` (`AlertDialog` for destructive confirms), `sheet`/`drawer` for rails | Focus trap + return, `Esc` closes, scrim blur; Aceternity animated-modal choreography for celebratory moments only |
| Dropdowns / menus / popovers | shadcn `dropdown-menu` / `popover` / `hover-card` | Token-driven, `z-50`, keyboard navigable |
| Badges / status | ReUI `@reui/badge` (+ `-light` tinted variants) for counts/tiers; project `StatusBadge` for state | Tones live/active/positive/negative/warning/info/neutral/stale/offline/pending; dot + pulse for live |
| Cards / frames | One container family per screen: project `Card` (solid, `rounded-xl`) **or** ReUI `frame` — never nested | Interactive cards: card-spotlight hover (pointer-tracked radial) on marketing; static in-app |
| KPIs | `MetricCard` | `font-numeric` value, delta tones, sparkline optional (recharts) |
| Charts | `lightweight-charts` v5 (financial) + `recharts` v3 (analytical), always in `ChartContainer` with truthful state footer | Solid, unblurred, `--chart-*` series, semantic direction; never animate chart internals |
| Kanban / sortable | ReUI `kanban` (workflows, bot pipelines) / `sortable` (watchlists, dashboards) | `SPRING` drag; `KanbanOverlay` required |
| Timeline | ReUI `timeline` (signal lifecycle, audit trails) / Aceternity `timeline` (marketing storytelling with scroll beam) | Chronological, honest timestamps |
| Calendar | ReUI `event-calendar` (economic calendar, scheduling) | Explicit root height; month/week/day/agenda views |
| Stepper | ReUI `stepper` (onboarding, strategy wizards, checkout) | Validated steps, resumable |
| Command palette | shadcn `command` in `AppShell` | 57-destination scale proven; grouped, keyboard-first |
| Toasts | `sonner` | Action-named buttons, outcome-named confirmations |
| Progress / skeleton | shadcn `progress`/`skeleton`/`spinner`; Aceternity multi-step-loader for long runs (backtests) | Skeletons mirror real layout |
| Empty / error / loading | Project states + Aceternity empty-states blocks (onboarding/marketing) + ReUI `icon-stack`/`icon-tile` visuals | Empty always carries 1 action; error carries Retry |
| Breadcrumbs | shadcn `breadcrumb` | Detail pages; complements back button |
| Pagination | ReUI `DataGridPagination` (grids) / shadcn `pagination` (feeds) | Server-side: `manualPagination` + `recordCount` |

### 7.2 Existing components: retain / adapt / replace

- **Retain:** `PageHeader`, `SectionHeader`, `MetricCard`, `StatusBadge`, `ChartContainer`,
  state components, `CommandPalette`, shells and nav data files.
- **Adapt:** `DataTable` stays for simple lists; operational tables migrate to ReUI
  `data-grid` per page. `button/badge/dialog` align to shadcn variants already present.
- **Replace on touch:** raw `<table>` markup, hand-rolled pagination, ad-hoc coloured
  status spans, duplicate page-header implementations.

### 7.3 Composition rule

One **container family per screen**: `Card` **or** `Frame`, never nested. Compose
upward — `MetricCard` inside `Card` is fine; a `Card` re-implementing `PageHeader` is not.

---

## 8. Animation & motion system

**Engine:** `motion` v14 (`import { motion } from "motion/react"`) — the single animation
library. It matches the Aceternity source (built on Motion) and already backs the
`Reveal` components. No second animation dependency.

### 8.1 Principles

1. **CSS first.** Hover/focus/state → CSS (`transition-colors`, `transition-transform`).
   `motion/react` only for orchestration, layout animation, and reveals.
2. **One entrance per view** (a stagger counts as one). Marketing bands may each reveal
   on scroll; app pages reveal once.
3. **Cheap properties only:** `transform`, `opacity`, sparingly colour. Never
   `width/height/top/left/filter` on hot paths.
4. **Fast and short.** Feedback 150–250ms; entrances ≤700ms; stagger ≤500ms over ≤6
   items at ≤50ms each; hover 150ms.
5. **Reduced motion always honoured.** Global guard in `globals.css`
   (`prefers-reduced-motion: reduce` collapses durations) + `MotionConfig
   reducedMotion="user"` at the root + `motion-reduce:` variants. Reduced motion means a
   calm fade, never a freeze.
6. **Colour via `transition-colors`.** No `transition-all`.

### 8.2 Canonical values

| Purpose | Value |
|---|---|
| Standard UI | `--ease-standard` `cubic-bezier(0.2,0,0,1)`, 150–200ms |
| Emphasized (drawers, sheets) | `--ease-emphasized` `cubic-bezier(0.32,0.72,0,1)`, 200–240ms |
| Reveal (entrance) | `--ease-reveal` `cubic-bezier(0.22,1,0.36,1)`, 700ms, 16px lift |
| ReUI reveal/hover | `duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]`, `transition-colors` |
| Drag / reorder | `SPRING` `{ type: "spring", visualDuration: 0.25, bounce: 0 }` |
| Tabs pill | `layoutId` spring, bounce 0.3, duration 0.6 |

### 8.3 Existing motion utilities (`globals.css`)

- `.animate-page-enter` (240ms), `.animate-enter-stagger` (280ms + `--enter-index`×36ms,
  capped) — app page/card entrance.
- `ticker-track`, `flow-track/flow-dot`, ecosystem `flow-line`, AI-teams `av-ring-*` —
  the live-data motion vocabulary; keep, do not proliferate.
- `<Reveal />` — scroll-into-view fade + 16px lift for marketing; mount-entrance for app.

### 8.4 Aceternity effects — verified adaptations (marketing & hero only)

Researched from the live registry (props verified where noted). **Marketing surfaces
only, never on terminals/tables/order entry.** Cap ambient loops (≤3 per view),
tokenise colours to ember/neutrals, add reduced-motion guards. Port the *mechanic*
into token-styled surfaces — never paste components wholesale.

| Effect | Mechanic (verified) | AlgoVault use |
|---|---|---|
| Spotlight New | Container fade-in 1.5s; mirrored `motion.div`s animate `x: [0, ±xOffset, 0]`, `duration 7s`, `repeat: Infinity`, `reverse`; props `gradientFirst/Second/Third`, `translateY: -350`, `width: 560`, `height: 1380`, `xOffset: 100` | Hero + CTA bands; retint gradients to ember/neutral |
| Background Beams | ~50 SVG paths, each animated by moving `motion.linearGradient` (`duration: random*10+10s`, infinite, random delay); radial mask fades edges | Landing hero backdrop; static fallback under reduced motion |
| Aurora Background | Slow rotating conic/linear gradient wash | Auth + pricing headers |
| Text Generate Effect | `useAnimate` stagger 0.2s/word, `opacity` + `blur(10px)→0`, 0.5s; props `words`, `duration`, `filter` | Hero headlines, feature intros |
| Card Spotlight | Pointer-tracked radial highlight via CSS vars on `onMouseMove` | Pricing/marketplace cards |
| Glowing Effect | RAF-throttled pointer angle → conic-gradient `--start`/`--active` + mask | Featured plan / flagship product card (one per view) |
| Tracing Beam | Scroll-progress beam along an SVG path; length follows scroll velocity | `/docs`, methodology, transparency pages |
| Lamp Effect | Linear-style lamp glow section header | Feature-section dividers |
| Infinite Moving Cards | Cloned children, `--animation-duration` 20/40/80s, pause on hover, edge masks | Testimonials / social proof strip |
| Bento Grid | Skewed grid, title + description + header visual per cell | Homepage capability grid, `/tools` directory |
| Tabs (animated) | `layoutId` moving pill + stacked `FadeInDiv` (`scale/opacity = 1 − idx*0.1`) | Pricing toggles, terminal timeframe-adjacent marketing |
| Multi Step Loader | Staged loader for long operations | Backtest/optimization runs |
| Stateful Button | Loading → success choreography on click | Checkout, deploy, save actions |

**Adaptation rule:** tokenise colours, cap loops, guard reduced motion. If an effect
cannot be made accessible and cheap, do not ship it.

---

## 9. SVG, icons, images & visual assets

- **Icon sets:** `lucide-react` (product), `@phosphor-icons/react` (newer marketing).
  Match the file's existing set; never a third library in one tree. ReUI `icon-tile`
  wraps icons in list rows/feature cards/empty states; `icon-stack` builds empty-state
  visuals. Sizes 13–18px explicit; never font-size scaling.
- **Decorative SVG/art:** `aria-hidden`, `pointer-events-none`, absolute behind content,
  frozen under reduced motion. Atmosphere never intercepts clicks.
- **Charts:** `lightweight-charts` v5 (financial) + `recharts` v3 (analytical), both
  solid and unblurred in `ChartContainer`; `--chart-*` series, semantic direction.
  React Flow keeps its inverted-background overrides in `globals.css`.
- **Images:** `next/image`; meaningful `alt`, decorative `alt=""`. Brand mark is
  `components/ui/site-logo`; assets under `public/logos`, `public/icons`.
- **Gradients/masks/filters:** curated marketing light system only (`spotlight`,
  `aurora`, beam masks); never over live data. Preserve reference SVG geometry
  (beam paths, spotlight ellipses, mask fades) when porting — that geometry *is* the
  effect. Aspect ratios and cropping from the reference are kept; generic stock
  illustration never substitutes a distinctive asset.
- **Licenses:** free registry components (Aceternity free set, all 27 ReUI components,
  shadcn) are copy-paste per their licences. Aceternity **Pro blocks/templates** and
  ReUI **Pro blocks / Motion Icons** require paid access — never bypass access controls;
  keep attribution/license notices where required.

---

## 10. Responsive design

- **Mobile-first**, `sm/md/lg/xl/2xl`. Verify at ~375 / 768 / 1024 / 1440px in **both
  themes**.
- **Sidebar** `lg:` and up; below `lg` a focus-locked drawer with overlay. Terminals
  collapse chrome → rail → bottom sheet, preserving order entry and close actions.
- **Headers** wrap actions to their own row under `sm`; long names never ellipsis into
  meaninglessness.
- **Tables/grids:** ReUI grids scroll inside the panel (`min-w` + inner scroll area)
  instead of squeezing; feeds stack to cards on phones.
- **Dialogs/drawers** go full-width sheets on mobile; drawers resize, never clip primary
  actions.
- **Marketing** bands stack, parallax/beam layers simplify (static gradient fallback),
  type scales down via the hero clamp.
- **Touch:** ≥44px targets on coarse pointers; no hover-only primary actions.
- **i18n safety:** ~30% text growth — no fixed-width labels, no meaning-destroying
  truncation.

---

## 11. Accessibility (WCAG 2.2 AA baseline)

- **Contrast:** body/secondary text ≥4.5:1; UI graphics/borders ≥3:1. Never layer
  translucent text on translucent surfaces. Never `text-success`/`text-warning` as body
  text in light mode; never `-foreground` text on a solid same-state fill.
- **Focus:** visible always — global `outline: 2px solid var(--ring); outline-offset:
  2px` baseline plus `focus-visible:ring-2` on components.
- **Keyboard:** every action reachable/operable; drawer traps and returns focus; menus
  and dialogs manage focus; `Esc` closes overlays; kanban/sortable keep Alt+Arrow and
  handle operability.
- **Names & roles:** icon-only controls need `aria-label`; real `button`/`a` elements;
  decorative icons `aria-hidden`; `CascaderStatus`-style live regions for dynamic
  selection; status changes that matter (signal, connection, order result) announce.
- **Forms:** every input labelled; errors named inline with recovery guidance.
- **Motion & zoom:** `prefers-reduced-motion` (§8); pinch-zoom enabled; 200% text zoom
  without loss.
- **Meaning is never colour-only** — pair with icon, label, or shape (critical for P&L,
  status, risk).

---

## 12. Performance

- **Server-first.** `app/**` pages are RSC by default; `"use client"` only at the
  interactive leaf. Never make a page client just to animate one element.
- **One engine, one icon set per tree.** `motion` v14 only; lucide *or* phosphor per
  tree; tree-shakeable imports. No heavy lib for a micro-interaction.
- **Hot paths stay cheap.** No blur/glass/gradient over charts or ticking tables;
  virtualise or limit series; memoize derived data; never animate chart internals; never
  set state per frame (use MotionValues / CSS vars for pointer effects).
- **Ambient budget:** ≤3 looping animations per view, `transform`/`opacity` only,
  paused under reduced motion, `will-change` only while running.
- **Lazy-load** heavy visuals (globes, beams, marketing bands below the fold); fonts via
  `next/font` subsets; `next/image` throughout.
- **CSS:** token system only; utilities over bespoke classes; no `transition-all`;
  verify production ordering with `next build` when touching globals.

---

## 13. Reference component integration workflow

Mandatory — follow all 13 steps, in order:

1. Understand the page and interaction requirement (§7 archetype first).
2. Search the three reference libraries (Aceternity → ReUI → shadcn per §10 order).
3. Select the closest appropriate component.
4. Inspect its documentation **and source code** — structure, classes, tokens,
   breakpoints, animation config, assets, a11y, reduced motion, dependencies.
5. Analyse its styling, animation, assets, and interaction logic; note what gives it
   its identity (timing, easing, geometry) so it survives the port.
6. Check licensing and usage conditions (§9 — Pro/paid items need a licence).
7. Verify compatibility: Next 16, React 19, TS 5, Tailwind v4, Base UI/Radix
   primitives, `motion` v14, existing build tooling.
8. Search the project for existing equivalents (`components/ui`, `components/reui`,
   feature folders); trace imports before judging anything unused.
9. Reuse or adapt existing code where appropriate — stop at the earliest rung of §10
   that solves the problem.
10. Integrate with AlgoVault tokens: swap literal colours for tokens, normalise radius
    to the ladder, verify both themes.
11. Preserve the original behaviour (choreography, sequencing, pointer physics) where
    appropriate; record deliberate deviations honestly.
12. Test responsive behaviour and accessibility (§10, §11).
13. Verify the final result in the actual application against §14 — never claim exact
    reproduction without verifying the implementation.

Do not blindly install components. Do not recreate an existing component without
determining whether it can be adapted. Screenshots never substitute for implementation
analysis. Registry installs: `npx shadcn@latest add <name> --yes` for shadcn;
`npx shadcn@latest add @reui/<name> --yes` for ReUI (free tier; licence key only for
Pro/Motion Icons); `npx shadcn@latest add @aceternity/<name>` for Aceternity free
components. Before writing ReUI props, read the real API via the ReUI MCP
(`get_component` → `get_examples`); run `validate_usage` + `get_audit_checklist`
before finishing.

---

## 14. Design review checklist

Before any UI change is considered done:

**Correctness & truth**
- [ ] No fabricated data; honest `live/stale/offline/unavailable` states; no fake success.
- [ ] Existing functionality untouched: Firebase, auth, Stripe, trading logic, routes, charts.
- [ ] Exactly one `h1`; page inside its shell; `PageHeader` present where standard.
- [ ] Loading / empty (1 action) / error (Retry) states exist per data region.

**Tokens & visual**
- [ ] Zero raw hex / raw Tailwind colour families added; every colour a token.
- [ ] Radius from the ladder; cards solid in-app (blur only on scrims); marketing light
      system within budget.
- [ ] `font-numeric` on all comparable numbers; nothing below 11px in-app.
- [ ] Ember rationed (action/active/brand/live); semantics fixed single-meaning.
- [ ] One container family per screen; no Card-in-Frame.

**Motion**
- [ ] CSS for hover/state; `motion/react` only where warranted; one entrance per view.
- [ ] `transform`/`opacity` only; ≤3 ambient loops; reduced-motion honoured.
- [ ] No `transition-all`; reference choreography preserved or deviations recorded.

**Responsive & a11y**
- [ ] Verified 375/768/1024/1440 in **dark and light**.
- [ ] Keyboard operable; visible focus; icon-only controls labelled; drawer focus-locked.
- [ ] Contrast AA; meaning never colour-only; live regions where state matters.

**Performance**
- [ ] Charts/flow solid and unblurred; client boundary only where needed.
- [ ] No new heavy dependency; one icon set per tree; lazy-loaded heavy visuals.

**Process**
- [ ] Reuse preferred; no duplicate page/feature; reference-licence respected.
- [ ] Lint + typecheck pass; results stated, never claimed unverified.

---

## 15. Verification & known constraints

**Stack this spec is built against (verified 2026-10-13):** Next 16.3.4, React 19.2.8,
TypeScript 5, Tailwind v4 (CSS-first, no config file), `motion` ^14.1.0 (sole animation
lib — no framer-motion/gsap in deps), `lightweight-charts` v5 + `recharts` v3 +
`@xyflow/react` v12, `lucide-react` + `@phosphor-icons/react`, Base UI + Radix
primitives, `reui` registry dep, FlyonUI bridge, Geist Sans/Mono via `next/font`,
class-based theming (`:root` dark / `.light`), `components.json` style `base-lyra`.
Tests are `jiti` per-domain runners (`npm run test:*`); no Vitest UI suite; no
automated visual tests — design review is manual against §14.

**Constraints for implementers:**

- Pro/paid reference items (Aceternity Pro blocks/templates, ReUI Pro blocks/Motion
  Icons) require licences — free-tier only without one.
- `opencode.json` holds a committed ReUI PAT — treat as compromised, move to env, rotate.
- `node_modules` was absent at spec time: installs and builds must be re-verified by the
  implementing agent (`npm install`, `npm run lint`, `next build`).

---

## 16. Instructions for future agents

1. Read `AGENTS.md`, then `PRODUCT.md`, then this file before touching UI.
2. Understand the page's purpose and functionality (§7) before editing it.
3. Treat the current visual design as replaceable when a redesign is requested — but
   preserve working business logic and behaviour (`PRODUCT.md` "What must keep working").
4. Inspect reusable components (`components/ui`, `components/reui`, feature folders)
   before creating new ones; trace imports first.
5. Consult Aceternity / ReUI / shadcn per the §10 order and the mandatory §13 workflow.
6. Analyse reference **source code**, never screenshots alone; preserve distinctive
   animation and visual behaviour where practical; record deviations honestly.
7. Respect licences and asset conditions (§9); never bypass paid access.
8. Use shared tokens and foundations (§2–§4); no raw colours, no ad-hoc radii.
9. Avoid duplicate pages, components, shells, and docs; extend existing routes.
10. Support dark and light themes; implement responsive layouts per §10.
11. Verify accessibility (§11) and interactions, including keyboard and reduced motion.
12. Keep trading surfaces fast and calm; effects belong on marketing.
13. Run lint + typecheck + relevant `test:*` suites; state actual results.
14. Never claim an effect, fix, or reproduction you did not build and observe.
15. Change the system here, not in comments: update this file in the same change and
    delete obsolete rules.
16. Keep it focused: smallest coherent improvement per pass; record it here.
17. Report actual verification results without claiming unverified success.
