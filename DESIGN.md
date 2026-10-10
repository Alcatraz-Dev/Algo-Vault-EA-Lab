# AlgoVault — Design System

**Visual world: "Institutional Command."**
Mode: **Operate.** The visitor is working — reading markets, placing orders, building
strategies, buying products. Scanability, consistency and precision outrank expression.
AlgoVault must feel like a serious professional trading platform a trader trusts with
capital: information-dense, calm, and exact. Brand lives in precise details, not decoration.

This document is the **design authority** for the application. When code and this document
disagree, one of them is a bug — fix the code or amend this file with a recorded decision.
It is intentionally actionable: tokens, class names and file locations are named so any
engineer or agent can apply it without guessing.

---

## 1. Principles

1. **Precision over decoration.** Every visual decision must improve precision, hierarchy,
   readability or interaction. If a decoration has no job, remove it.
2. **Dark-first.** Dark is the primary experience. Light theme is fully supported and uses
   the identical architecture and semantics (only token values change).
3. **Information-dense, never cluttered.** Prefer typographic hierarchy, spacing, surface
   tone and alignment over borders, boxes and color to separate things.
4. **One accent, used sparingly.** Vault gold is the only brand accent. It marks primary
   actions, active/selected state, the brand mark and the flagship feature. Everything else
   earns its place through hierarchy.
5. **Trading numbers are terminal numbers.** Mono, tabular, right-aligned, explicitly signed.
6. **Honest data.** Never fabricate prices, balances, P&L, fills, or success states. A stale
   or unavailable source is labeled as such.

---

## 2. Color

Tokens are CSS custom properties in `app/globals.css`. `:root` is the **dark** palette
(the default); `.light` overrides values. They are exposed to Tailwind through
`@theme inline` as `--color-*`, so utilities are `bg-background`, `text-positive`,
`border-border`, `bg-primary/10`, etc. Use **semantic tokens** — not raw Tailwind color
families (`emerald-500`, `rose-600`, `amber-400`, …) and not raw hex.

### 2.1 Graphite neutral scale (dark, cool gray-blue cast — never purple)

| Token | Value | Use |
|---|---|---|
| `--background` | `#0b0c0e` (`oklch(0.155 0.005 255)`) | page canvas, app background |
| `--card` | `#111315` | panels, tables, cards — one step above the page |
| `--popover` | `#15171a` | menus, popovers, dialogs above content |
| `--muted` | `#1c1e21` | wells, table header rows, hover fill, skeleton base |
| `--border` | `#2b2e32` | hairline structure, table grid, dividers |
| `--input` | `#35383c` | form control borders |
| `--foreground` | `#f4f5f6` | primary text |
| `--muted-foreground` | `#9a9fa6` | secondary text, labels, metadata |
| `--ring` | `#daba6b` | focus ring (gold) |

Structure comes from **surface tone + hairline borders**, never from shadow, glow or blur.

### 2.2 Vault gold — the restrained primary accent

| Token | Dark | Light | Use |
|---|---|---|---|
| `--primary` | `#daba6b` | `#daba6b` | primary actions, active/selected state, brand mark, focus ring, chart brand line |
| `--primary-foreground` | `#1d1406` | `#1d1406` | ink on solid gold fills (9.7:1, AAA) |
| `--primary-text` | `#daba6b` | `#865812` | gold used **as text/link** (light theme swaps to the deeper AA value) |

Contrast: gold on `--background` = 10.4:1 (AAA); on `--card` = 9.9:1. In light theme
`html.light .text-primary` resolves to `--primary-text` (`#865812`, 5.9:1). Solid gold fills
keep `--primary` in both themes with near-black ink.

**Gold is never profit, buy, up, or success.** Selected segments, active nav rows, primary
CTAs, the brand mark and the flagship signal surface are the only places gold belongs.

### 2.3 Fixed semantic trading colors

The mapping is fixed and identical in every page and every theme. Never reassign it.

| Meaning | Token | Dark | Light | Notes |
|---|---|---|---|---|
| positive / profit / buy / long | `--positive` | `#30d697` (emerald) | `#00794c` | up moves, wins, buy, long bias |
| negative / loss / sell / short | `--negative` | `#ff645f` (red) | `#bb0916` | down moves, losses, sell, short bias |
| warning / risk | `--warning` | `#f2af48` (amber) | `#9a5500` | caution, nearing limit, margin |
| information | `--info` | `#3faff3` (sky) | `#0065b4` | neutral information, links to detail |
| destructive action | `--destructive` | `#ff6369` | `#c1121f` | destructive buttons/confirmations only |
| active / selected UI | `--primary` | gold | gold | selected segment, active row |

Each semantic has a `-foreground` twin (`--positive-foreground`, …) that is the legible
text color for the matching low-opacity tint (`bg-positive/10 text-positive-foreground`).
For **solid** semantic fills carrying text, use `text-background` (adaptive ink). For tinted
status chips use `bg-*-muted` (`--positive-muted`, `--negative-muted`, `--warning-muted`,
`--info-muted`, `--destructive-muted`) plus the `-foreground` text color.

All semantic values pass **WCAG AA** as text on `--background`, `--card` and `--muted` in
both themes (verified numerically; see §17).

**Color is never the only signal.** Directional meaning is always paired with a sign
(`+`/`−`), an arrow, or a text label — buy/sell, long/short, up/down, live/stale.

### 2.4 Chart palette

`--chart-1..5` provide distinguishable series hues for data visualization where multiple
series must be told apart. Charts follow the semantic rules for anything directional
(equity up = positive, drawdown = negative); `--chart-*` is only for categorical series and
is never used to encode profit/loss direction.

| Token | Dark | Light | Hue |
|---|---|---|---|
| `--chart-1` | `#7aa2ff` | `#2f6fd8` | blue |
| `--chart-2` | `#3fd0c0` | `#0c7a6a` | teal |
| `--chart-3` | `#b79dff` | `#6d4bd0` | violet |
| `--chart-4` | `#f08fbf` | `#c2478a` | pink |
| `--chart-5` | `#e0a83c` | `#9a6a12` | amber |

The palette deliberately excludes Vault gold (so the brand accent stays distinctive) and
every value clears **3:1** graphical contrast on `--background`, `--card` and `--muted` in
its theme.

---

## 3. Typography

Fonts are already installed: **Geist** (`--font-sans`) for interface text and **Geist Mono**
(`--font-mono`) for trading numbers. Do not introduce another font family.

### 3.1 Type scale (Tailwind utility, spacing-relative)

| Role | Classes |
|---|---|
| Page title | `text-2xl font-semibold tracking-tight` |
| Section title | `text-base font-semibold` (dense sections: `text-sm font-semibold`) |
| Card title | `text-sm font-medium` |
| Body base | `text-sm` |
| Dense body / table cell | `text-xs` |
| Metadata / labels | `text-xs text-muted-foreground` |
| Helper / footnote | `text-xs text-muted-foreground` |
| All-caps group label | `text-micro font-medium uppercase tracking-wider text-muted-foreground` |

`text-micro` is the **11px floor** utility. The arbitrary micro sizes `text-[9px]`,
`text-[10px]` and `text-[11px]` are **banned**, and are swept out of every page touched by
a redesign pass. Never replace unreadable micro text with equally unreadable text.

### 3.2 Trading numerals — mandatory

All prices, balances, P&L, order sizes, ticks, spreads, quantities, rates and other
trading-critical numbers use **Geist Mono with tabular figures**. The canonical utility is:

```html
<span class="font-numeric">1234.56</span>   <!-- font-family: Mono; font-variant-numeric: tabular-nums -->
```

`font-mono` alone is **not** sufficient (it does not guarantee tabular figures or the numeric
font stack) — use `font-numeric` for numbers. Keep `font-mono` for genuine code/log text only.

Formatting conventions:

- **Sign is explicit** for deltas and P&L: `+1.24%`, `−382.50`, `+$1,204.00`. Use the
  correct minus glyph (`−`) or a leading `-`; never rely on color alone.
- **Right-align** numeric table columns and metric values (`className="text-right"` +
  `font-numeric`). Header alignment matches the cell alignment.
- **Consistent precision:** respect the instrument's tick size / a fixed number of decimals;
  do not mix `1.2` and `1.20000` for the same series.
- **Thousands separators** for currency and account sizes.
- **Currency** is labeled (symbol or a `CCY` column header), never an unlabeled bare number.
- **Percentages** carry `%` and the correct sign.
- **Missing data renders as `—`**, never as a fabricated `0.00`.

`DataTable` columns set `align: "right"` for numeric columns; the table cell/head get
`text-right`. Follow it.

---

## 4. Radii

One system only. No mixing.

| Surface | Radius |
|---|---|
| Cards / panels / dialogs / popovers | `rounded-lg` (8px) |
| Inputs / buttons / selects / tabs | `rounded-md` (6px) |
| Segmented control | `rounded-md` |
| Badges / pills / status dots | `rounded-full` |

Helpers: `rounded-card` = `rounded-lg`; `rounded-button` = `rounded-md`;
`rounded-pill` = `rounded-full`.

**Banned:** `rounded-2xl` / `rounded-3xl` on app surfaces, and `rounded-none` on surfaces
the user touches (tabs use `rounded-md`).

---

## 5. Elevation & surfaces

- Page = `bg-background`; panels/cards = `bg-card`; menus/popovers/dialogs = `bg-popover`.
- Default card carries a **hairline** `border border-border`; no shadow.
- Hover = slightly stronger surface (`bg-muted`) or a border shift — not a lift + shadow.
- Shadow is reserved for elements that genuinely float **above** content: dropdown menus,
  popovers, dialogs, and the mobile drawer (`shadow-md` / `shadow-lg`).
- `backdrop-blur` is a **selective** layer for surfaces that float above content:
  - **Allowed:** sticky topbar when content scrolls behind it, command palette, dropdowns,
    popovers, floating nav overlays, drawers, and modal surfaces (use `bg-popover`
    translucency + a moderate blur; the `globals.css` `.glass-scrim` utility).
  - **Prohibited:** main chart plotting areas, dense trading tables, order-entry fields,
    financial values, high-density analytical panels, and critical execution controls.
    These stay crisp, opaque and solid.
- **Banned:** glow shadows (`shadow-amber-500/20`, `0 0 40px …`), neon borders, gradient
  borders, glass cards, gradient orbs.

---

## 6. Spacing & density

- Base spacing unit is Tailwind's 4px scale. Card padding `p-4` (dense `p-3`), page padding
  `px-4 py-6 sm:px-6 lg:px-8` via the shell.
- Prefer a small number of consistent gaps (`gap-2` / `gap-3` / `gap-4`) over ad-hoc values.
- Tables are dense by default (`DataTable compact` → `py-2` rows). Dashboards are dense.
- Marketing surfaces may breathe more, but never use oversized hero type inside the product.

---

## 7. Iconography

- Icons come from `lucide-react` (or `@phosphor-icons/react`); size 14–16 in dense UI,
  16–20 in headers. Icons inherit `currentColor` and are `aria-hidden` when decorative.
- Do **not** wrap every metric in a colored square. A single muted icon per metric card is
  the maximum.
- Icon color carries meaning only via the semantic tokens (positive/negative/warning/info).

---

## 8. Shells

Single source of truth for chrome. Do not fork a second shell.

- **Public shell** — `SiteNavbar`/`site-header` + `SiteFooter`: marketing navigation only
  (Product, Markets, Marketplace, Pricing, Account). Generous spacing, marketing-scale type.
- **Application shell** — `components/layout/AppShell.tsx`: persistent grouped sidebar +
  topbar (page title, global `⌘K` command palette, notifications, theme toggle, account
  menu). Grouped nav data lives in `components/layout/app-nav.ts` (`APP_NAV`).
- **Account shell** and **Admin shell** render **through** `AppShell` (`role="account"` /
  `role="admin"`), reusing the identical visual system. `AppSidebarLayout` wraps bare route
  families.
- **Terminal shell** — Trading Terminal / Market Intelligence Terminal pages may render
  full-height **without the app sidebar** (`hideSidebar`/`fullscreen`) to maximize chart
  visibility, but they **must keep the same topbar styling** and semantic tokens. The
  terminal stacks chart → watchlist → order panel on small screens.

---

## 9. Navigation architecture

- Sidebar groups, ordered by the trading workflow: **Overview · Markets · Trading ·
  Intelligence · Market Intelligence · Strategy · Automation · Marketplace · Account.**
- Groups are collapsible; the active group is always expanded; collapsed state persists
  (`localStorage: algovault.nav.collapsed`).
- Active item = restrained gold: `bg-primary/10`, gold icon, a 2px gold rail, `aria-current="page"`.
- Pro/plan badges render as real chips (`Pro`, `Lite`) — never dead metadata.
- Every sidebar entry must resolve to a real route. Do not invent routes or leave entries
  pointing at 404s.
- Global command palette (`⌘K` / `Ctrl-K`) is the canonical keyboard navigation surface;
  it only performs navigation the sidebar already offers.
- Mobile: sidebar collapses to a drawer under `lg`, with scroll lock and a transition.

---

## 10. Product surfaces

One design language, adapted to the task — never forced into identical layouts. Every
surface shares the tokens, components and states above; the difference is **what it
optimizes for**.

| Surface | Route family | Optimizes for | Must not do |
|---|---|---|---|
| **Dashboard** | `app/dashboard`, `app/account` | Account overview, market context, activity, risk/exposure, automation status, next actions | Invent account data or show fake performance; excessive metric cards |
| **Markets** | `app/scanner`, `app/compare`, watchlists | Scanability and comparison: consistent price format, directional change, readable watchlists, visible freshness, search/filter | Rainbow row colors; color-only direction |
| **Terminal** | `app/account/terminal`, `scalping-terminal`, `components/terminal`, `components/pro-scalping-terminal` | Chart visibility, watchlist, order entry, positions/open orders, connection status | Blur/glass over chart or order entry; moving the chart; changing execution/risk logic |
| **Intelligence** | `app/market-intelligence`, `app/signals`, `app/insights` | Clear conclusions, supporting evidence, confidence/limits, freshness, next steps; facts vs interpretation | Present AI suggestions as confirmed execution or guaranteed outcomes; a per-feature color palette |
| **Strategy** | `app/backtests`, `strategy-compare`, `components/strategy-lab` | Configuration hierarchy, readable parameters, validation, progress, performance tables, assumptions | Blend backtest results with live performance; hide assumptions |
| **Marketplace** | `app/marketplace`, `app/store` | Discovery, pricing, details, transparent performance, compatibility, licensing/purchase state | Turn marketplace pages into terminal layouts |
| **Account / Admin** | `app/account/**`, `app/admin/**` | Consistent nav/forms/tables/status; preserve authorization rules | Expose admin actions/data to unauthorized users; ornament over legibility |

Rules that hold across all of them:

- Gold marks brand and selection only — never profit, buy, direction or success.
- Directional meaning is always emerald/red **and** carries a sign/arrow/label.
- Dense surfaces (terminal, tables, order entry) stay **solid** — no blur, no glass.
- Never change trading, payment, auth or data logic to satisfy a layout.

---

## 11. Canonical components

Reuse these; extend them rather than duplicating. Located in `components/ui/`.

| Component | File | Contract |
|---|---|---|
| Button | `button.tsx` | variants `default/outline/secondary/ghost/destructive/link`; sizes; gold for `default` |
| Card | `card.tsx` | `default` (hairline) / `elevated` (floating only) / `danger` |
| Badge | `badge.tsx` | `default/secondary/destructive/outline/ghost/link/success/warning` |
| StatusBadge | `status-badge.tsx` | semantic tones: `live/active/positive/negative/warning/info/neutral/stale/offline/error/pending/connected/profitable` |
| PageHeader | `page-header.tsx` | eyebrow → `text-2xl` title → subtitle + action cluster |
| SectionHeader | `section-header.tsx` | section title + optional meta + action |
| MetricCard | `metric-card.tsx` | label, mono value, delta (+tone), footnote; **no gradient, no glow** |
| DataTable | `data-table.tsx` | sortable/paginated over `table.tsx`; loading/empty states wired |
| Table | `table.tsx` | base table primitives |
| Toolbar | `toolbar.tsx` | filter/search/action row |
| ChartContainer | `chart-container.tsx` | toolbar slot + body + truthful `dataState` (live/stale/offline/unavailable) |
| EmptyState | `empty-state.tsx` | explain + next step |
| ErrorState | `error-state.tsx` | explain + recovery action; no stack traces |
| LoadingState | `loading-state.tsx` | skeleton-aware |
| Tabs | `tabs.tsx` | segmented control (`rounded-md`); active = gold |
| Input/Select/FormField/FormSection | `input.tsx`, `select.tsx`, `form-field.tsx`, `form-section.tsx` | labels, help text, error text |
| Dialog/DropdownMenu/Tooltip | `dialog.tsx`, `dropdown-menu.tsx`, `tooltip.tsx` | overlays; the only place blur/shadow is allowed |

`PageHeader` and `SectionHeader` are the **only** page/section title components. Do not
re-invent headings per page.

---

## 12. Data display rules

- Numeric columns **right-aligned**, headers aligned to match, values `font-numeric`.
- Status columns use `StatusBadge`, never free-text color.
- Directional values carry sign + color, both.
- Loading uses skeletons (`LoadingState`), not bare spinners over empty space.
- Empty uses `EmptyState` (what's missing + next action); error uses `ErrorState`
  (what failed + retry).
- Keep a stable row height; do not let long text break the grid.
- Tables scroll horizontally on small screens (`overflow-x-auto`); never trap content.

---

## 13. States — every meaningful surface

| State | Requirement |
|---|---|
| `loading` | Skeleton placeholders matching final layout. No layout shift, no bare cursor. |
| `empty` | Explain what is missing and the next step, with an action when possible. |
| `error` | Explain what failed in plain language + a recovery action (retry/back). No stack traces, no raw error objects. |
| `stale` | Label stale data honestly (`StatusBadge tone="stale"`); show last-updated where relevant. |
| `offline` | Show a disconnected/offline indicator; disable actions that require the network. |
| `success` | Confirm real, completed operations only. Never a fabricated success. |

`ChartContainer` and `StatusBadge` encode live/stale/offline; use them instead of inventing a
new indicator. Realtime surfaces must never pretend to be live when the feed is disconnected.

---

## 14. Interaction, motion & focus

- Transitions are subtle and fast: **150–200ms**, `ease` / `--ease-standard`.
- Motion signals meaning (loading, success, error, enter) — never decorative.
- Every interactive element has a visible **focus ring**: `outline: 2px solid var(--ring)`
  (global `:focus-visible`) or `focus-visible:ring-2 focus-visible:ring-ring/50`.
- Full keyboard access: nav, command palette (`⌘K`, ↑/↓, Enter, Esc), dialogs (focus trap,
  Esc to close), tabs, tables.
- Respect `prefers-reduced-motion`: all animation is disabled/near-instant.
- Touch targets ≥ 44px where the pointer is coarse.

---

## 15. Accessibility

- Semantic HTML first (`header`/`nav`/`main`/`section`/`table`/`button`/`a`), ARIA only to
  fill gaps (`aria-current`, `aria-expanded`, `aria-label`, `aria-hidden` on decoration).
- Text contrast meets **WCAG AA** in both themes (semantic tokens are verified; do not
  hand-roll colors).
- **Never** rely on color alone: pair with sign, icon, or label.
- Focus is always visible and never trapped outside overlays.
- All inputs have labels; all buttons have an accessible name.

---

## 16. Responsive behavior

- Content has **no fixed pixel widths**; use the shell's max-width + padding.
- Sidebar: full at `lg+`, drawer below.
- Tables: horizontal scroll + progressive column hiding (`hideBelow`) on small screens.
- Terminal: stacks chart → watchlist → order panel.
- Dialogs: centered modal at `sm+`; full-width bottom sheet on mobile.
- Test dark **and** light at mobile, tablet and desktop widths.

---

## 17. Trading semantics (non-negotiable)

- **Buy / long / profit / positive → emerald** (`positive`). **Sell / short / loss /
  negative → red** (`negative`). **Risk / warning → amber.** **Information → sky.**
- **Destructive actions → destructive red** (buttons/confirmations).
- **Selected / active UI → restrained gold.**
- **Gold never represents profit or a buy signal.**
- Signs and consistent formatting are mandatory for monetary values.
- **No fabricated data of any kind.** A stale or unavailable source is labeled honestly.
- The redesign is **visual and component-architectural only.** It must not change: Firebase
  RTDB integration, authentication/authorization, Stripe/payment flows, trading/execution
  providers, order submission and execution logic, risk controls/validation gates/safeguards,
  chart data calculations and indicator logic, API contracts, or routing behavior.

---

## 18. Prohibited patterns (banned)

- Decorative gradients, gradient orbs, gradient text, gradient borders.
- **Emojis** used as icons, navigation symbols, status indicators, or decoration. Use the
  icon library (`lucide-react` / `@phosphor-icons/react`).
- Glow shadows and neon borders (`0 0 40px color`, `shadow-amber-500/20`, …).
- Glassmorphism on cards/panels (`backdrop-blur` outside overlays/drawers).
- Icon-in-a-colored-square for every metric; per-widget rainbow color coding.
- A page being "the amber page" or "the violet page" — per-feature accent colors.
- Oversized marketing-style hero headings inside the product.
- `text-[9px]` / `text-[10px]` / `text-[11px]` arbitrary micro text.
- Random radius on one screen (`rounded-none` next to `rounded-3xl`).
- Fake success indicators, fake prices, fake P&L, fake balances, fake market activity.
- Raw Tailwind color families (`emerald-500`, `rose-600`, `amber-400`, `violet-500`, …) in
  place of semantic tokens.
- `font-mono` on numbers instead of `font-numeric`; left-aligned numeric columns.

---

## 19. Implementation notes

- **Tokens:** `app/globals.css` — `:root` (dark), `.light`, `@theme inline` mapping to
  `--color-*`. Motion/easing tokens: `--ease-standard`, `--ease-emphasized`.
- **Utilities:** `.font-numeric`, `.num-right`, `.page-container`, `text-micro`,
  `text-body-sm`, `text-meta`, `rounded-card`, `rounded-button`, `rounded-pill`,
  `bg-surface-muted`, `text-text-secondary`, `bg-accent-muted`, focus ring global fallback.
- **Theme:** class-based; dark is the default (`<html class="dark">`), light adds `.light`.
  Initialized by `THEME_INIT_SCRIPT` (`components/theme/theme-init.tsx`) before paint.
  System `theme-color` / PWA `theme_color` = graphite `#0b0c0e`.
- **Shell/nav:** `components/layout/AppShell.tsx`, `app-nav.ts`, `AppSidebarLayout.tsx`,
  `CommandPalette.tsx`, `NotificationsMenu.tsx`.
- **Charts:** `lightweight-charts` (native terminal) and `recharts`; both are themed through
  semantic tokens, never hardcoded hex.

---

## 20. Applying the system (checklist)

Before a surface is considered done:

- [ ] Uses semantic tokens only — no raw color families, no raw hex.
- [ ] Numeric values are `font-numeric`, right-aligned, signed where directional.
- [ ] Radius follows the one system (`rounded-lg` cards, `rounded-md` controls).
- [ ] No banned decoration (gradient/glow/glass/gradient text).
- [ ] Loading, empty, error, and (for trading) stale/offline states are handled honestly.
- [ ] Works in dark **and** light, mobile **and** desktop.
- [ ] Keyboard reachable, visible focus, accessible names, color not the sole signal.
- [ ] No change to trading, payment, auth, or data logic.
- [ ] Micro type swept (`text-[9–11px]` gone).
- [ ] Diff reviewed: no unintended changes, no fabricated data.
