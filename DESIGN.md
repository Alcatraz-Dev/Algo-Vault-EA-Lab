# AlgoVault — Design System

> **Status: authoritative.** This document is the single design authority for AlgoVault.
> It supersedes the earlier "Institutional Command" `DESIGN.md` (deleted in `8304f46`) and
> every ad-hoc comment in the codebase that references `DESIGN.md §…`. Where a scattered
> code comment disagrees with this file, this file wins and the comment should be fixed.
>
> Scope: **visual language, tokens, components, motion, layout and the workflow for
> bringing in third-party UI.** It does not redefine product behaviour — for what the
> product *is* and *must keep doing*, [`PRODUCT.md`](./PRODUCT.md) and
> [`AGENTS.md`](./AGENTS.md) are authoritative and are not replaced by this file.
>
> Read order for any UI task: `AGENTS.md` → `PRODUCT.md` → this file → the code it
> touches. Never redesign from a screenshot or a chat summary; inspect the real component.

---

## 0. How to use this document

1. **Reuse before you build.** Reuse an existing component → adapt an installed library
   primitive → use a shadcn primitive → use a composed ReUI pattern → apply an Aceternity
   *effect* (marketing surfaces only) → only then hand-roll. See §13.
2. **This is a product, not a landing deck.** Command surfaces (terminals, tables, charts,
   order entry, admin) are dense, calm and solid. Decoration is rationed and never competes
   with data.
3. **Both themes are first-class.** Dark is the default (`.light` overrides `:root`). Every
   change must be checked in **dark and light**.
4. **Nothing here is a licence to break behaviour.** Firebase, auth, Stripe, trading logic,
   routes, chart engines and existing theming must keep working. See `PRODUCT.md`.
5. **Keep the docs few.** This file + `PRODUCT.md` + `AGENTS.md` are the documentation of
   record. Do not add a fourth overlapping design doc; extend this one.

---

## 1. Philosophy & identity

**AlgoVault is instrument-grade trading software.** The interface should read like
professional equipment: precise, legible, quiet, and fast. It is a research and execution
workspace for people whose money depends on reading it correctly — not a marketing site and
not a fintech toy.

### 1.1 Design principles

1. **Data outranks decoration.** Tone, depth, borders and motion exist to organise
   information. When a visual flourish and a number compete for attention, the number wins.
2. **Structure from surface + hairline, not shadow.** Hierarchy is built with three surface
   tones (`background` → `card` → `popover`) separated by 1px borders. Shadows are shallow
   and only for genuinely floating things (menus, modals, drawers). No glass cards, no glow
   boxes, no gradient panels on data surfaces.
3. **One meaning per colour.** Profit/loss, buy/sell, live/stale, brand/action, error — each
   has exactly one colour and that colour never changes meaning per page. Semantic colour is
   never decorative. (See §2.4 for the two legacy collisions to avoid.)
4. **Density with air.** Information-dense but never cramped: consistent 4px-step spacing,
   a real type scale, and generous line-height on prose.
5. **Motion confirms, it does not perform.** Entrances are short and once; state changes are
   fast and local. Nothing loops in the user's peripheral vision on a work surface.
6. **Honest state.** Loading / stale / offline / unavailable are visible states, never
   faked as live. The UI is part of the product's no-fabrication contract.
7. **Restraint is the brand.** The orange ("Vault gold") earns attention precisely because
   it is rare. If a screen is orange, it should be because something is actionable or active.

### 1.2 Voice & tone (interface copy)

- Direct, factual, second person where natural. "Run backtest", not "Let's get started!".
- Never claim success that did not happen (`PRODUCT.md` rule 3). Buttons name the action;
  toasts/states name the verified outcome.
- Numbers are shown in the numeric face with tabular figures (`font-numeric`), units and
  currency explicit, and `Unavailable`/`Stale` rather than a blank or a fake value.
- Sentence case for most labels. Uppercase micro-labels only for eyebrows/group labels.

---

## 2. Token system

All tokens live in **`app/globals.css`** (Tailwind v4, CSS-first — there is **no**
`tailwind.config.*`). `:root` holds the dark theme; `.light` overrides it; `@theme inline`
exposes them to Tailwind utility names; a FlyonUI bridge maps FlyonUI's semantic variables
onto ours.

> **Rule:** never hard-code a hex, never use a raw Tailwind colour family
> (`bg-blue-500`, `text-emerald-400`, …), and never add a new colour to a component. Add a
> token here and reference it. *(Legacy debt: ~155 raw colour-family usages remain — see §15.)*

### 2.1 Surfaces & text

| Token | Tailwind | Dark | Light | Use |
|---|---|---|---|---|
| `--background` | `bg-background` | `#0b0c0e` | `#f9fafb` | Page canvas |
| `--card` | `bg-card` | `#111315` | `#ffffff` | Panels, tables, cards (one step above page) |
| `--popover` | `bg-popover` | `#15171a` | `#ffffff` | Menus, modals, floating surfaces |
| `--secondary` / `--muted` / `--accent` | `bg-muted` | `#1c1e21` | `#eff0f2` | Recessed wells, hover rows, toolbars |
| `--foreground` | `text-foreground` | `#f4f5f6` | `#1c2024` | Primary text |
| `--muted-foreground` | `text-muted-foreground` | `#9a9fa6` | `#5f646a` | Secondary text, labels, units |
| `--border-color` | `border-border` | `#2b2e32` | `#dbdee2` | **Border colour** |
| `--input` | `border-input` | `#35383c` | `#c4c8cd` | Input outlines |
| `--ring` | `ring-ring` | `#de661c` | `#de661c` | Focus ring |

> **Trap:** FlyonUI claims `--border` as a **length** (1px border width). The border
> **colour** token is therefore `--border-color`, exposed as `border-border`. There is no
> `border-border-color` class. Do not "fix" this by redefining `--border`.

### 2.2 Brand — "Vault gold"

| Token | Dark | Light | Notes |
|---|---|---|---|
| `--primary` | `#de661c` | `#de661c` | Exact brand accent. Solid fills, borders, active states, brand mark, selected UI. |
| `--primary-foreground` | `#1d1406` | `#1d1406` | Near-black ink on a solid gold fill (9.7:1, AAA). |
| `--primary-text` | `#de661c` | `#de661c` | Text/links token — see the light-theme override below. |

Laws for gold:

- **Gold is never profit, buy, or "success".** Those are semantic (§2.4).
- **Solid gold carries `text-primary-foreground` ink**, never white — white on `#de661c`
  fails contrast.
- **Tinted gold = `bg-primary/10` + `text-primary` + `border-primary/30..40`** (the "active/
  PRO" chip idiom), or the helper classes `bg-accent-muted` / `border-accent-muted`.
- **Light theme text:** `#de661c` fails as text on light surfaces (~1.5:1), so
  `html.light .text-primary` (defined unlayered in `globals.css`) resolves to the deeper
  gold for readability. Solid fills/borders still use the exact `--primary`. Do not remove
  that override; when a new gold-*text* use appears in light theme, verify contrast.

### 2.3 Radii — one ladder

`--radius: 0.5rem`. Everything is derived from it; do not introduce `rounded-2xl/3xl` on app
surfaces.

| Class | Computed | Use |
|---|---|---|
| `rounded-sm` | 6px | Small chips, dense controls |
| `rounded-md` | 8px | Inputs, buttons, medium controls |
| `rounded-lg` | 10px | **Cards, panels, tables, chart frames (canonical container radius)** |
| `rounded-xl` | 12px | Large overlays / hero surfaces |
| `rounded-button` | 6px | Named helper for control radius |
| `rounded-card` / `rounded-card-lg` | 8px / 10px | Named helpers for container radius |
| `rounded-full` / `rounded-pill` | 9999px | Badges/status pills, avatars, icon chips |

FlyonUI's bridge sets `--radius-selector`/`--radius-field` = 6px and `--radius-box` = 8px so
its components agree with the ladder.

> **ReUI conflict — resolved here.** ReUI's installed `base-lyra` components ship **0px**
> radii (`components/reui/frame.tsx` pins `--frame-radius:0px`;
> `components/reui/badge.tsx` defaults `radius: "rounded-none"`). **AlgoVault does not adopt
> a 0px app radius.** When you install any ReUI component, immediately re-point its radius
> rung to this ladder (frame → `rounded-lg`/10px; badges → the pill badge in
> `components/ui/badge.tsx`). A 0px/sharp treatment is allowed only as a deliberate,
> localised aesthetic decision, never as the default. See §13.3.

### 2.4 Semantic & categorical colour

**Directional / status (fixed, never swapped):**

| Token | Dark | Light | Meaning |
|---|---|---|---|
| `--positive` / `--success` | `#30d697` | `#00794c` | Profit, buy, long, live, success |
| `--negative` | `#ff645f` | `#bb0916` | Loss, sell, short, error |
| `--warning` | `#de661c` | `#de661c` | Caution / pending / stale |
| `--info` | `#3faff3` | `#0065b4` | Informational |
| `--destructive` | `#ff6369` | `#c1121f` | Destructive action |

Each has a `-foreground` token (legible text on a low-opacity tint of the same hue) and a
`-muted` token (`color-mix(in oklch, <hue> 14%, transparent)`) for tinted backgrounds and
badges. **Pattern:** `bg-positive-muted text-positive border-positive/30`. For a solid
semantic fill, use `text-background` as the adaptive ink (not white).

**Categorical chart series** (`--chart-1..5`) exist **for data visualisation only** and
deliberately exclude Vault gold. Do not use them for UI chrome; do not use semantic tokens
for arbitrary series.

**Two known legacy collisions — treat as bugs, do not spread:**

- `--warning` equals `--primary` (`#de661c`). A "warning" badge and a brand badge are the
  same orange. Prefer `StatusBadge tone="stale"/"pending"` for genuine caution and reserve
  gold for brand/active. Fixing the hue is a future token task, not a per-page patch.
- `--destructive` (`#ff6369`) and `--negative` (`#ff645f`) are two near-identical reds. Use
  `--negative` for loss/error in trading context and `--destructive` only for the destructive
  *action* variant. Do not sprinkle both.

### 2.5 Motion tokens

`--ease-standard: cubic-bezier(0.2, 0, 0, 1)` and
`--ease-emphasized: cubic-bezier(0.32, 0.72, 0, 1)`. See §8 for the full motion contract.

### 2.6 Token hygiene checklist

- Add a token in `:root` **and** (async) `.light` if it must theme, then map it in
  `@theme inline` so a Tailwind utility exists.
- Prefer `color-mix(in oklch, …)` for tints/translucency over new literal colours.
- Verify new text/border tokens pass contrast in both themes (§11).

---

## 3. Typography

**Families** (loaded via `next/font/google` in `app/layout.tsx`):

- `--font-geist-sans` → **Geist Sans**. Mapped to `--font-sans` and `--font-heading`.
- `--font-geist-mono` → **Geist Mono**. Mapped to `--font-numeric`.

> There is no display face. Emphasis comes from weight, size and tracking, not a second
> typeface. (`packages/design-tokens` still lists Inter/JetBrains/Cal — that package is
> **stale and unused**; ignore it, §15.)

**Numeric rule (hard).** Every number that a user compares — prices, P&L, %, R multiples,
timestamps, balances, counts, table cells — renders with **`font-numeric`**
(`font-family: var(--font-numeric)` + `font-variant-numeric: tabular-nums`). This is used
1377× and is the strongest convention in the codebase. `font-mono` (32 remain) is legacy —
replace with `font-numeric` when touching those lines.

**Type scale** (dense product scale; nothing below 11px):

| Role | Classes | Notes |
|---|---|---|
| Page title (`h1`) | `text-xl sm:text-2xl font-semibold tracking-tight` in `AppShell`; `PageHeader` uses `text-2xl font-semibold tracking-tight` | one `h1` per page |
| Section title (`h2`) | `SectionHeader`: `text-sm font-semibold tracking-tight` | inside panels |
| Marketing hero (`h1`) | `text-4xl sm:text-6xl lg:text-7xl font-semibold leading-[1.04] tracking-[-0.04em]` | landing only |
| Body | `text-sm` (14px) default; prose `leading-6/7` | |
| Secondary | `text-xs` (12px) `text-muted-foreground` | labels, units, meta |
| Micro floor | `.text-micro` (11px) and `.text-meta` (12px), `.text-body-sm` (13px) | the floor; never `text-[10px]`/`[9px]` |
| Numeric emphasis | `font-numeric text-lg/xl font-semibold tracking-tight` | metric values |

**Rules**

- **11px is the floor.** `text-[9px]`/`text-[10px]`/`text-[11px]` are banned (45 legacy
  usages remain — replace with `text-micro`/`text-xs` when touched).
- Use `text-balance` on short headings and `text-pretty`/explicit breaks on prose; the
  landing hero intentionally uses `[text-wrap:wrap]` with a manual break so the headline
  lands as designed (see `HomeHero.tsx` comment).
- Uppercase micro-labels only for eyebrows/group/chip labels, with
  `tracking-wider`/`tracking-[0.16em]`. Never uppercase a sentence.
- Do not fake hierarchy with colour alone — pair size/weight with tone.

---

## 4. Layout & spacing

- **Spacing step = 4px** (Tailwind default). Use `gap-*` for groups (§7), not `space-y-*`.
  Common rhythm: `gap-1.5` (tight control cluster), `gap-2`/`gap-3` (component internals),
  `gap-4`/`gap-6` (card content / section grid), `py-14 md:py-20` (marketing bands).
- **Page container:** `.page-container` = `max-width:1200px; margin-inline:auto;
  padding-inline:32px` (16px under 640px). Use it for marketing and full-width bands.
- **Product pages** use the shell's own padding: `AppShell` main is
  `max-w-7xl px-4 py-6 sm:px-6 lg:px-8` (or full-width, padded, for `fullscreen`/terminal).
- **Grids of panels:** use the hairline-grid idiom — a wrapper with `gap-px bg-border` and
  children with `bg-card` — for flush, one-hairline tables of cards. Otherwise `gap-4/gap-6`.
- **Density:** controls default to 36px tall (`h-9`); `sm`/`xs` for dense toolbars. Touch
  targets are ≥44px on coarse pointers via `.touch-target`.
- **Z-index discipline:** sticky chrome `z-40`, mobile drawer `z-50`, menus/popovers `z-50`,
  command palette on top. Do not invent new z-layers; extend the existing scale.
- **Alignment:** numeric columns right-aligned (`.num-right`); labels left. Tables keep a
  fixed header and tabular figures.

---

## 5. Page architecture

### 5.1 Route families (285 page/layout files under `app/`)

| Family | Examples | Shell | Notes |
|---|---|---|---|
| Marketing / public | `/`, `/pricing`, `/marketplace`, `/compare`, `/affiliates`, `/history-methodology` pages, legal | `SiteHeader` + `SiteFooter` | Landing composition only; effects allowed here (§13.4) |
| Auth | `/login`, `/register` | standalone centered | no app chrome |
| Account / app | `/dashboard`, `/portfolio`, `/account/*`, `/goals`, `/trade-journal`, `/signals`, `/alerts`, `/tools`, `/backtests`, `/statement`, `/economic-calendar`, `/news`, `/copy-trading`, `/cross-asset`, `/compare` | `AccountShell` or `AppSidebarLayout` | dense product surfaces |
| Admin | `/admin/**` | `AdminShell` (behind `AdminGuard`) | internal ops |
| Developer | `/developer/**` | `AppShell` + `DEVELOPER_NAV` | internal |
| Mobile | `/mobile/**` | own layout | slimmed shell |
| Fullscreen / terminal | `/terminal/[symbol]`, `/account/terminal`, scalping terminals | `AppShell` `fullscreen`/`hideSidebar` | chart owns vertical space |

**Rule:** a page never renders its own top-level chrome. It renders inside a shell
(§6) and starts its content with a `PageHeader` (§7.1). Marketing pages are the only
exception, and they compose from `components/home/site-header` + `components/footer`.

### 5.2 Standard page composition

```
Shell (topbar + sidebar + <main>)
└─ PageHeader            title / subtitle / eyebrow / actions / back
   ├─ MetricCard row     3–4 KPIs, font-numeric values, optional delta
   ├─ Toolbar            filters, search, view toggles
   ├─ Content            Card / DataTable / ChartContainer / EmptyState / ErrorState / LoadingState
   └─ SectionHeader(s)   group titles inside the page
```

- **Every page has exactly one `h1`** (rendered by `AppShell`'s topbar or `PageHeader`).
  Do not add a second.
- **Four canonical states** are mandatory: `LoadingState`, `EmptyState`, `ErrorState`, and
  honest data states (`live`/`stale`/`offline`/`unavailable`) via `ChartContainer` /
  `StatusBadge`. See `PRODUCT.md`.
- **Do not invent a parallel page** for an existing feature; extend the existing route.

---

## 6. Navigation & shells

The canonical shells (do not fork them):

| Component | Path | Purpose |
|---|---|---|
| `AppShell` | `components/layout/AppShell.tsx` | Base authenticated shell: sticky blurred topbar (title/eyebrow/subtitle, actions, command palette, notifications, theme toggle, account menu), grouped collapsible sidebar with search, mobile drawer, `animate-page-enter` main. |
| `AccountShell` | `components/account/AccountShell.tsx` | Wraps `AppShell` with `ACCOUNT_NAV`, back-navigation and a live status chip. |
| `AdminShell` | `components/admin/AdminShell.tsx` | Wraps `AppShell` with `ADMIN_NAV`, admin topbar controls. |
| `AppSidebarLayout` | `components/layout/AppSidebarLayout.tsx` | Thin wrapper: `AppShell` + `APP_NAV`, for route families that were previously bare. |
| `SiteHeader` / `SiteFooter` | `components/home/site-header.tsx`, `components/footer/SiteFooter.tsx` | Marketing chrome only. |

**Navigation data is data, not markup:** `APP_NAV`, `ADMIN_NAV`, `DEVELOPER_NAV`
(`components/layout/app-nav.ts`), and `ACCOUNT_NAV`
(`components/account/account-nav.ts`). Adding a route means adding an entry there — not
hand-writing a sidebar.

Shell rules:

- Exactly **one** `AppShell` per page tree. Do not nest shells.
- Sidebar groups are product domains ordered by the trading workflow (`PRODUCT.md`), not
  alphabetically. A page belongs to exactly one group; the most specific entry owns the
  active state (see `isActive`).
- Topbar controls share one language: rounded hairlines, muted icons brightening on hover,
  visible focus ring, 40px touch target on phones / 36px desktop.
- `⌘K` / `Ctrl+K` opens `CommandPalette`; keep nav entries and palette groups in sync.

---

## 7. Component library

**Primitive home: `components/ui/*`.** These are the canonical building blocks; a page
should reach for them before anything else. Icons: `lucide-react` in product surfaces,
`@phosphor-icons/react` in the newer marketing components — do not mix both in one
component tree.

### 7.1 Layout & structure

- **`PageHeader`** — page title block (`eyebrow → h1 → subtitle`, action cluster, optional
  `backHref`). The one `h1` owner for non-fullscreen product pages.
- **`SectionHeader`** — in-panel group title row (`h2` + description + meta + action).
- **`Card`** (`components/ui/card.tsx`) — FlyonUI `.card` surface with AlgoVault
  `bg-card` + `border-border`; variants `default` / `elevated` (adds `shadow-md`) / `danger`;
  sizes `sm`/`default`/`lg`; sub-parts `CardHeader/Title/Description/Action/Content/Footer`.
  **Cards are solid. No `backdrop-blur` on cards.**
- **`ChartContainer`** — canonical chart frame: toolbar slot, body, and a truthful
  data-state footer (live/stale/offline). Wrap **every** chart in it.
- **States:** `EmptyState`, `ErrorState`, `LoadingState` — use them; never leave a blank
  region or fake content.

### 7.2 Data & input

- **`DataTable`** (`components/ui/data-table.tsx`) — sortable/filterable dense tables; use
  `font-numeric` + `num-right` for numeric columns.
- **`MetricCard`** — KPI display; value in `font-numeric` by default; delta tones
  `up/down/neutral/warning`.
- **`Button`** (`components/ui/button.tsx`) — FlyonUI `.btn` + variants
  `default/outline/secondary/ghost/destructive/link`; sizes `xs…lg` + `icon*`. Dense 36px
  default, focus ring, disabled states built in.
- **`Badge`** (`components/ui/badge.tsx`) — dense `badge-sm` pill; variants
  `default/secondary/destructive/outline/ghost/link/success/warning`.
- **`StatusBadge`** (`components/ui/status-badge.tsx`) — **the** status primitive. Tones:
  `live/active/positive/negative/warning/info/neutral/stale/offline/error/pending/
  connected/expired/profitable`. `dot` + `pulse` for live indicators. Use this instead of
  ad-hoc coloured spans.
- **`Input`**, **`ToggleChip`**, **`Toolbar`**, **`Separator`**, **`Dialog`**, **`Tabs`**,
  **`Tooltip`** — `components/ui/*`, built on Base UI / Radix as installed.

### 7.3 Composition rule

One **container family per screen**: pick `Card` **or** `Frame` as the primary container and
stay with it. Never nest `Card` inside `Frame` or vice-versa. Compose upward — a `MetricCard`
inside a `Card` is fine; a `Card` that re-implements `PageHeader` is not.

### 7.4 ReUI components (`components/reui/*`)

ReUI is a **shadcn-compatible registry of sourced components**, installed with the CLI
(§13.3). Currently installed: `frame`, `badge`, `icon-tile`.

- Treat them as **library-owned**: do not retime or restyle their internals; adapt via props
  and tokens.
- After install, normalise their radius to the AlgoVault ladder (§2.3) and ensure the tokens
  they read exist (`--success/--info/--warning` and their `-foreground`s, `--focus`,
  `--invert` — see §13.3).
- For **status/state**, prefer the project `StatusBadge`; ReUI's tinted `*-light` badge
  variants are for one-off cases only.
- ReUI state convention: tinted background + same-hue text + `-light` variant; use `gap-*`
  for spacing; `transition-colors` for hover.

> **Orphaned code warning.** `components/home/*` contains a large, **unused** alternate
> landing implementation (`HomeHero`, `HomeSectionHeader`, `PricingTeaser`, `HowItWorks`,
> `CapabilityGrid`, `TrustBand`, `FaqSection`, `ShowcaseSection`, `SocialProofBar`,
> `HeroConsole`, `SignalRiskSection`, `LiveMonitoringSection`, and all of
> `components/home/charts/*`). Only `HomePage`, `TickerStrip`, `EcosystemSection`,
> `BrandLogos`, `Reveal`, `CountUp`, `HeroConsoleChart` are reachable from `app/`. These
> orphaned files reference **undefined** `.home-*` classes and ReUI components. **Do not
> extend them.** Consolidate or delete them in a dedicated task; until then, ignore them as
> a design source.

---

## 8. Motion system

**Engine:** `motion` v14 (`import { motion } from "motion/react"`). It is the single
animation library; it matches the Aceternity source and already backs both `Reveal`
components. Do not add another animation dependency.

### 8.1 Principles

1. **CSS first.** If a transition is a hover/focus/state change, a CSS transition
   (`transition-colors`, `transition-transform`) is correct. Reach for `motion/react` only
   for orchestration, layout, or enter/exit of many elements.
2. **One entrance per view.** A page or band may have at most one reveal choreography. Do
   not narrate.
3. **Cheap properties only.** Animate `transform`, `opacity`, and (sparingly) colour.
   Never animate `width/height/top/left/filter` on hot paths.
4. **Fast and short.** UI feedback 150–250ms; entrances ≤700ms; total stagger ≤500ms over
   ≤6 items at ≤50ms each. Hover uses 150ms.
5. **Reduced motion is honoured, always.** Global guard in `globals.css`
   (`@media (prefers-reduced-motion: reduce)` collapses durations) plus a
   `[data-motion-reveal]` settled state for Motion inline styles. When you add a client
   motion boundary, wrap it once with `MotionConfig reducedMotion="user"`.
6. **Colour via `transition-colors`.** No `transition-all`.

### 8.2 Canonical easings & durations

| Purpose | Value |
|---|---|
| Standard UI | `--ease-standard` `cubic-bezier(0.2,0,0,1)`, ~150–200ms |
| Emphasized (drawers, sheets) | `--ease-emphasized` `cubic-bezier(0.32,0.72,0,1)`, ~200–240ms |
| Reveal (entrance) | `cubic-bezier(0.22,1,0.36,1)`, 700ms, 16px lift |
| ReUI hover/reveal | `transition-colors`; reveals `duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]` |

### 8.3 Existing motion utilities (in `globals.css`)

- `.animate-page-enter` (240ms) and `.animate-enter-stagger` (280ms + `--enter-index`×36ms,
  capped) — the app's page/card entrance.
- `.animate-core-ping`, `.animate-pulse-ring(-negative)`, `.animate-slide-up`.
- Home `av-*` system: `av-beam`, `av-aurora-a/b`, `av-panel`, `av-edge` (marketing light
  system); `ticker-track`, `flow-track/flow-dot`, ecosystem `flow-line`/`eco-*`; AI Trading
  Teams `av-ring-*`, `av-edge-flow`, etc.
- `<Reveal />` (both variants) — scroll-into-view fade + 16px lift. **Two implementations
  exist** (`components/home/Reveal.tsx` uses `whileInView`; `components/layout/Reveal.tsx`
  uses `animate` on mount and accepts `initial`). Prefer the `layout` one in product pages;
  unifying them is a planned cleanup (§15).

### 8.4 Aceternity effects (verified source — marketing only)

These are faithful specs from the Aceternity registry source, pulled for reference. **Use
them on marketing surfaces only, never on dense product/command surfaces**, and always cap
ambient loops (≤3 per view) and honour reduced motion.

- **Spotlight New** (`spotlight-new`): container fade-in 1.5s; two mirrored `motion.div`s
  animate `x: [0, ±xOffset, 0]`, `duration 7s`, `repeat: Infinity`, `reverse`, `easeInOut`;
  three `rotate ±45deg` radial-gradient layers. Props: `gradientFirst/Second/Third`,
  `translateY:-350`, `width:560`, `height:1380`, `smallWidth:240`, `xOffset:100`.
- **Background Beams** (`background-beams`): SVG `viewBox="0 0 696 316"`, ~50 `<path>`s, each
  animated by a `motion.linearGradient` moving `x1/x2/y1/y2`, `duration: random*10+10`s,
  `repeat: Infinity`, random `delay`; static radial `mask` fades the edges.
- **Card Spotlight**: pointer-tracked radial highlight on a card (`onMouseMove` → CSS vars).
- **Glowing Effect**: RAF-throttled pointer angle, `animate(currentAngle, newAngle,
  { duration: movementDuration, ease:[0.16,1,0.3,1] })`, conic-gradient exposed via
  `--start`/`--active` and a mask.
- **Text Generate Effect**: `useAnimate` with `stagger 0.2s`, per-word `opacity 1` +
  `filter blur(10px)→0`, `duration 0.5`.
- **Tabs**: `motion` `layoutId="clickedbutton"` for the moving pill (spring, bounce 0.3,
  duration 0.6); stacked `FadeInDiv` with `scale/opacity = 1 - idx*0.1` for `idx < 3` and
  hover translate.
- **Infinite Moving Cards**: clone children, CSS `--animation-direction` /
  `--animation-duration` (20/40/80s), `animate-scroll`, pause on hover, `mask-image` edges.
- **Aurora / Timeline**: slow rotating/linear-gradient backdrop; timeline with progressive
  scroll reveal.

**Adaptation rule:** do **not** paste Aceternity components wholesale. Port the *motion
mechanic* into a ReUI/token-styled surface, swap literal colours for tokens, cap the loops,
and add the reduced-motion guard. If an effect cannot be made accessible and cheap, do not
ship it.

---

## 9. SVG, icons & imagery

- **Icon sets:** `lucide-react` (product), `@phosphor-icons/react` (newer marketing). Match
  the set already used in the file you edit. Do not introduce a third icon library.
- **Icon sizing:** let `Button`/`Badge` size `[&_svg]:size-*`; otherwise pass explicit
  `size={n}` (13–18px typical). Do not rely on font-size to scale SVGs.
- **Decorative SVG/art:** always `aria-hidden` and `pointer-events-none`, positioned
  absolutely behind content, and frozen under reduced motion. Pure atmosphere must never
  intercept pointer events (see `HomeAurora`).
- **Charts:** `lightweight-charts` v5 for financial candles/price (13 files) and `recharts`
  v3 for analytical charts (24 files). Both must stay **solid**, performant, and unblurred.
  Wrap in `ChartContainer`; use `--chart-*` for series and semantic tokens for
  directional values. React Flow (`@xyflow/react`) canvases keep their inverted background
  overrides in `globals.css` — do not remove them.
- **Images:** use `next/image`; meaningful images get real `alt`, decorative get
  `alt=""`/`aria-hidden`. Logo/brand assets live under `public/logos` and `public/icons`;
  the brand mark is `components/ui/site-logo`.
- **Gradients/clip-text:** banned as decoration on product surfaces; permitted only in the
  curated marketing light system (`av-*`) and never over live data.

---

## 10. Responsive

- **Mobile-first, breakpoints** `sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536`.
- **Sidebar** is `lg:` and up; below `lg` it becomes a focus-locked, scroll-locked drawer
  with an overlay. Verify with keyboard and with the drawer open.
- **Titles** wrap to their own row under controls on small screens (the shell does this for
  you); long page names must not collapse to an ellipsis.
- **Fullscreen/terminal** views trade the title band for chart height and use compact
  padding (`px-3 py-3 sm:px-4`).
- **Touch:** coarse pointers get ≥44px targets (`.touch-target`); form controls and table
  row actions stay tappable. Never hide a primary action behind hover-only on touch.
- **Tables/grids** reflow: numeric columns keep tabular figures; horizontal scroll is the
  last resort and must be contained (never scroll the page).
- **i18n safety:** allow ~30% text growth — no fixed-width labels, no single-line truncation
  that destroys meaning, avoid absolute positioning that assumes copy length.
- Verify at ~375, 768, 1024 and 1440px in **both themes**.

---

## 11. Accessibility (WCAG 2.2 AA baseline)

- **Contrast:** body/secondary text ≥4.5:1 against its surface; UI/graphics/borders ≥3:1.
  The palette is tuned for this in both themes — do not layer translucent text on
  translucent surfaces to "soften" it. Check new tints.
- **Focus:** visible focus **always**. Use `:focus-visible`; the global
  `outline: 2px solid var(--ring); outline-offset: 2px` is the baseline; interactive
  components also carry `focus-visible:ring-2 focus-visible:ring-ring/*`.
- **Keyboard:** every action is reachable and operable; the drawer traps/returns focus;
  menus and dialogs manage focus; `Esc` closes overlays.
- **Names & roles:** icon-only controls need `aria-label`/`title`; use real `button`/`a`
  (Base UI `render` keeps semantics); decorative icons are `aria-hidden`.
- **Live regions:** status changes that matter (signal, connection, order result) announce.
- **Motion & zoom:** honour `prefers-reduced-motion` (§8); do not disable pinch-zoom
  (`maximumScale:5, userScalable:true` is intentional); support 200% text zoom without loss
  of content or function.
- **Do not encode meaning in colour alone** — pair with an icon, label, or shape.

---

## 12. Performance

- **Server-first.** `app/**` pages are RSC by default; add `"use client"` only at the
  interactive leaf. Do not make a page client just to animate one element.
- **Charts/flow are the hot paths.** No blur/glass/gradient over them; virtualise or limit
  series; memoize derived data; keep `lightweight-charts`/`recharts` work off the render
  path. Do not animate chart internals.
- **Ambient FX budget:** ≤3 looping animations per view, all `transform`/`opacity`, all
  paused or removed under reduced motion, all `will-change` only while running.
- **Fonts** are subset via `next/font`; no extra webfont requests. Avoid layout shift.
- **No client bundle bloat:** one icon set per tree, tree-shakeable imports
  (`import { X } from "lucide-react"`), no heavy libs for a micro-interaction.
- **CSS:** keep to the token system; prefer utilities over bespoke classes; no
  `transition-all`. Verify production CSS ordering with `next build` when touching globals.

---

## 13. Reference integration workflow

Priority order (from §0): **reuse → adapt installed lib → shadcn primitive → ReUI composed →
Aceternity effect → custom.** Stop at the earliest rung that solves the problem.

### 13.1 shadcn/ui

- Config: `components.json` — `style: "base-lyra"`, `tailwind.css: app/globals.css`,
  `cssVariables: true`, `iconLibrary: "phosphor"`, aliases `@/components`, `@/lib/utils`,
  `@/components/ui`, `@/lib`, `@/hooks`.
- Utilities: `cn` comes from **either** `cn` (packages) or `@/lib/utils` — `lib/utils.ts`
  re-exports the package, so both are equivalent. Match the file you're editing.
- Add primitives with the shadcn CLI; they land in `components/ui/` and immediately use the
  tokens above. Prefer existing primitives over new ones.

### 13.2 ReUI (registry)

- ReUI is a **registry**, not an npm package. **Do not** install `reui` from npm (the
  `reui@0.5.0` dependency is bogus and unused — see §15).
- Registry: `@reui` → `https://reui.io/r/{style}/{name}.json` (configured in
  `components.json`). Install with `npx shadcn@latest add @reui/<name> --yes`.
- Free tier covers the 27 components and `c-*` examples; Pro blocks / Motion Icons need a
  license token. Consult the ReUI MCP (`get_agent_skill`, `get_component`, `get_examples`)
  before writing props — read the **real** API, never guess.
- Keep ReUI's look: use its components as shipped (don't retime/restyle internals); state via
  tinted `-light` variants; `gap-*` spacing; nothing below `text-xs`; one entrance per view.

### 13.3 Install → normalise (mandatory post-install step)

After adding any ReUI (or third-party) component:

1. **Radius:** re-point its rung to the AlgoVault ladder (§2.3). `frame`'s
   `[--frame-radius:0px]` and `badge`'s `radius: "rounded-none"` are ReUI/lyra defaults, not
   AlgoVault choices.
2. **Tokens:** ensure every token the component reads exists in `globals.css`. ReUI expects
   `--success/--info/--warning/--destructive` + `-foreground`s (present), plus **`--focus`,
   `--focus-foreground`, `--invert`, `--invert-foreground`** (added in this revision).
3. **Semantics:** map status/state to `StatusBadge` where the component is just a coloured
   chip; keep the ReUI component for structure.
4. **Theme:** verify both dark and light; ReUI styles are token-driven, so this should follow.

### 13.4 Aceternity (effects)

- Registry: `https://ui.aceternity.com/registry/<name>.json` (some entries require auth).
- Port the mechanic, not the markup (§8.4). Marketing surfaces only. Tokenise colours, cap
  loops, add reduced-motion.

---

## 14. Review checklist

Before any UI change is considered done:

**Correctness & truth**
- [ ] No fabricated data; states are honest (`live/stale/offline/unavailable`); no fake success.
- [ ] Existing functionality untouched: Firebase, auth, Stripe, trading logic, routes, charts.
- [ ] Exactly one `h1`; page renders inside its shell; `PageHeader` present where standard.
- [ ] Loading / empty / error states exist.

**Tokens & visual**
- [ ] Zero raw hex / raw Tailwind colour families added; every colour is a token.
- [ ] Radius from the ladder; no `rounded-2xl/3xl` on app surfaces; cards solid (no blur).
- [ ] `font-numeric` on all comparable numbers; no type below 11px; no `font-mono` added.
- [ ] Gold used intentionally (action/active/brand only); semantics (profit/loss/status) use
      their fixed tokens.
- [ ] Hierarchy from surface + hairline, not shadow/glow.

**Motion**
- [ ] CSS for hover/state; `motion/react` only where warranted; one entrance per view.
- [ ] `transform`/`opacity` only; ≤3 ambient loops; reduced-motion honoured.
- [ ] No `transition-all`.

**Responsive & a11y**
- [ ] Verified at 375/768/1024/1440 in **dark and light**.
- [ ] Keyboard operable; visible focus; icon-only controls labelled; drawer focus-locked.
- [ ] Contrast AA for text (4.5:1) and graphics (3:1); meaning not colour-only.

**Performance**
- [ ] Charts/flow remain solid and unblurred; client boundary only where needed.
- [ ] No new heavy dependency for a micro-interaction; icons from one set.

**Process**
- [ ] `npm run lint` and `npx tsc --noEmit` pass.
- [ ] Reuse preferred over new code; no duplicate page/feature introduced.
- [ ] Any required fix to the design system is recorded here (not left in a code comment).

---

## 15. Known debt & verification

Documented honestly so the next agent does not mistake debt for intent. None of these are
licences to break behaviour.

**Dead / orphaned (do not extend):**
- `components/home/*` orphaned landing variant + `components/home/charts/*` (see §7.4).
  References **undefined** `.home-eyebrow/.home-title/.home-title-lg/.home-title-em/
  .home-lede/.home-section/.home-hero*/.home-card-title` classes and ReUI components, none
  of which are reachable from `app/`. `HomeScrollAnimations.tsx` is a stub.
- `packages/design-tokens/src/index.ts` — stale green/amber palette (Inter/JetBrains/Cal,
  `#22c55e`). Unused by the web app. Reconcile or remove in a dedicated task.
- `reui@0.5.0` in `package.json` — unused; ReUI is a registry, not an npm package.

**Drift (fix opportunistically when touching the file):**
- ~155 raw Tailwind colour-family usages; 45 banned micro-text sizes (`text-[9/10/11px]`);
  32 `font-mono`; ~70 `backdrop-blur` usages (cards must be solid); 5 `rounded-2xl/3xl`.
- Two `Reveal` implementations (`components/home`, `components/layout`) — unify on the
  layout variant.
- `--warning === --primary`; `--destructive ≈ --negative` (§2.4).

**Security (not a design matter, but flagged):**
- `opencode.json` contains a committed ReUI PAT. Treat as compromised; move to an env var
  and rotate. Never reproduce the token in docs, commits, or logs.

**Verification commands**

```bash
npm run lint            # eslint (eslint-config-next)
npx tsc --noEmit        # typecheck (no npm script; tsconfig excludes chrome-extension,
                        # packages/shared and e2e)
```

Tests are `jiti` scripts run per-domain (`npm run test:*`); there is no Vitest/Jest UI
suite. There is no automated visual/design test — design review is manual against §14.

---

## 16. Instructions for future agents

1. **Read `AGENTS.md`, `PRODUCT.md`, then this file** before touching UI. Inspect the real
   component/layout; never redesign from memory or a summary.
2. **Reuse first (§0).** Extend an existing primitive/route. Do not create a second page,
   shell, table, badge, or motion system.
3. **Change the system here, not in comments.** If a rule must change, update this file in
   the same change and delete obsolete rules.
4. **Tokens are the contract.** No raw colours, no new radii, no sub-11px text, no
   `transition-all`, no glass on data.
5. **Both themes, responsive, keyboard, reduced-motion** — non-negotiable on every change.
6. **Protect behaviour.** `PRODUCT.md` "What must keep working" is a hard constraint.
7. **Verify before claiming.** Run lint + typecheck; state actual results. Never claim an
   effect, fix, or improvement you did not build and observe.
8. **Keep it focused.** Do not redesign every page in one pass; make the smallest coherent
   improvement and record it here.
