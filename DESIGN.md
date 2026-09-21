# AlgoVault — Design System

Mode: **Operate** — the visitor is working: reading markets, placing orders, building strategies, buying products. Scanability, consistency, and precision outrank expression. Brand lives in precise details.

## Visual world: "Institutional Command"

AlgoVault must feel like a serious commercial trading terminal — the kind a professional trader trusts with capital. Dark-first, information-dense, restrained, no decoration without a job. It is a *platform*, not a marketing dashboard.

- **Dark by default.** Deep neutral graphite (cool gray-blue cast, never purple). Light theme exists but is secondary and uses the same architecture.
- **One accent, used sparingly.** Vault gold (`--primary`). Reserved for primary actions, active states, the brand mark, and the flagship signal feature. Everything else earns its place through hierarchy, not color.
- **No glow, no gradient orbs, no glass.** Cards sit on the surface with a hairline border; elevation is implied by tone, not shadow or blur. `backdrop-blur` is acceptable only for overlays/drawers that sit above content.
- **Trading numbers are terminal numbers.** All prices, P&L, ticks, sizes render in mono type with tabular figures, right-leaning hierarchy, and explicit sign color.

## Color

### Neutral scale (dark)
- `--background` deep graphite `oklch(0.155 0.005 255)`
- `--card` / `--popover` one step lighter
- `--muted` subtle fill for wells, table rows, hover
- Hairline `--border` at very low contrast — structure over frames

### Semantic colors (fixed mapping — never swapped per page)
| Meaning | Token | Role |
|---|---|---|
| positive / profit / buy / long | `positive` (emerald) | winning, up, active long bias |
| negative / loss / sell / short | `negative` (red) | losing, down, active short bias |
| warning / risk | `warning` (amber) | caution, limit nearing, margin |
| info | `info` (sky) | neutral information, links to detail |
| danger/destructive | destructive (red, darker fill) | destructive actions |
| active / selected | primary (gold) tint | selected segment, active row |

- Buy = emerald always; sell = red always; P&L signs follow the same direction everywhere.
- No decorative color gradients on metric cards; no per-widget rainbow color coding.

## Typography

- Sans: Geist (existing). Mono: Geist Mono (existing) — **mandatory for all trading numbers**.
- Scale (spacing-relative, not arbitrary px classes):
  - Page title: `text-2xl` `font-semibold` `tracking-tight`
  - Section title: `text-base` `font-semibold`
  - Card title: `text-sm` `font-medium`
  - Body: `text-sm` (base) / `text-xs` (dense)
  - Metadata / labels: `text-xs` `text-muted-foreground`
  - Helper text: `text-xs`
  - `text-[9px]`, `text-[10px]`, `text-[11px]` are banned in new work and swept out of existing pages.
- All-caps labels use `uppercase tracking-wide text-[11px]` at most, sparingly.
- Trading values: `font-mono` + tabular numerals; right-aligned in table cells.

## Radius

One system only:
- Cards: `rounded-lg` (8px)
- Inputs / buttons / selects: `rounded-md` (6px)
- Tabs segmented control: `rounded-md`
- Badges / pills: `rounded-full`
- Dialogs / popovers: `rounded-lg`
- Banned: `rounded-none` on surfaces the user touches, `rounded-3xl`/`rounded-2xl` on app surfaces.

## Elevation / structure

- Default surface distinction: `bg-background` page, `bg-card` panels, hairline `border-border`.
- Hover: slightly stronger surface (`bg-muted`) or border shift.
- Shadow: only for menus/popovers/dialogs and mobile drawers. No glow shadows (`shadow-amber-500/20` etc.) — banned.

## Navigation architecture

- **Public shell** (`SiteNavbar` + footer): marketing navigation only — Product, Markets, Marketplace, Pricing, Account links.
- **App shell** (`AppShell`): persistent sidebar organized into logical groups (Overview, Markets, Intelligence, Strategy, Trading, Automation, Marketplace, Account) + topbar with page title, global command/search, notifications, account menu, theme. Single source of truth; Account and Admin shells render through the same visual system.
- **Terminal pages** (Trading Terminal): may be full-height without the app sidebar, but keep the topbar consistent.

## Components (canonical)

- `PageHeader` (title + optional subtitle + actions)
- `SectionHeader` (section title + optional meta + action)
- `MetricCard` (label, mono value, delta, optional icon; no gradient)
- `StatusBadge` (semantic: live/stale/offline/disabled/pending/error)
- `EmptyState` / `ErrorState` / `LoadingState` (skeleton-aware)
- `DataTable` wrappers over `components/ui/table`
- `ChartContainer` (toolbar + canvas area + stale/unavailable states)
- `Toolbar` (filter/search row)

## States

Every meaningful surface carries: `loading` (skeletons, not bare cursors), `empty` (explain + next step), `error` (explain + recovery action), and (for trading) `stale`/`offline`. No raw stack traces in the UI. Honest statuses only.

## Interaction

Subtle, fast transitions (150–200ms), clear focus rings, keyboard access for all nav and dialogs, semantic HTML, aria labels. No decorative motion; motion signals meaning (loading, success, error).

## Responsive

Sidebar collapses to a drawer under `lg`. Tables scroll horizontally on small screens. The terminal stacks (chart → watchlist → order panel order). Dialogs use full-width sheets on mobile. No fixed pixel widths on content.

## Anti-patterns (banned)

- Per-feature rainbow accents (a page being "amber" or "violet" loses meaning)
- Gradient orbs / glows / blur on every card
- Icon-in-a-colored-square for every metric
- Oversized hero headings inside the product
- Fake success indicators
- `text-[9px]`/`text-[10px]` micro text
- Random radius (`rounded-none` vs `rounded-2xl` vs `rounded-3xl` mixed on one screen)
- Glow shadows and neon borders