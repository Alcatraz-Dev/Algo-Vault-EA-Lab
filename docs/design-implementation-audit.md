# AlgoVault — Design Implementation Audit

Audit date: 2026-10-10
Scope: Full repo — all App Router routes, layouts, shared components, feature components.
Status tracking: NOT_STARTED · IN_PROGRESS · IMPLEMENTED · VERIFIED · BLOCKED

---

## 1. Inventory — Routes & Route Families

| Route / Family | Layout / Shell | Components | Issues Found | Status | Verification |
|---|---|---|---|---|---|
| `app/page.tsx` (landing) | SiteNavbar + SiteFooter | Marketing hero, feature grid | Potential glitter/glow; check micro text | IN_PROGRESS | Code inspected |
| `app/login`, `register` | Site shell | Auth forms | Check semantic tokens, focus rings | IMPLEMENTED | Tokens correct |
| `app/dashboard` | AppShell | PageHeader, metric cards, charts | Numeric alignment; check for glow | IN_PROGRESS | Partial |
| `app/account/**` | AppShell (role=account) | Profile, settings, health | Consistency with shell | IN_PROGRESS | Partial |
| `app/admin/**` | AppShell (role=admin) | Admin tables, confirmations | Table density, badges | NOT_STARTED | — |
| `app/scanner`, `compare` | AppShell | Watchlists, comparison tables | Numeric right-align; status badges | IN_PROGRESS | Partial |
| `app/terminal` | AppShell (fullscreen option) | Chart, watchlist, order panel | No blur over chart; solid surfaces | IN_PROGRESS | Partial |
| `app/market-intelligence` | AppShell | Evidence/conclusion panels | Must not invent AI conclusions; honest freshness | IN_PROGRESS | Partial |
| `app/signals`, `insights` | AppShell | Signal lists, insight cards | Status badges; sign + color | IN_PROGRESS | Partial |
| `app/strategy`, `backtests`, `strategy-compare`, `strategy-lab` | AppShell | Strategy params, backtest results, validation | Validation states; progress; no blended results | NOT_STARTED | — |
| `app/trading`, `orders`, `positions`, `history`, `execution` | AppShell / terminal | Tables, forms, execution detail | Numeric formatting; directional sign; status | IN_PROGRESS | Partial |
| `app/automation`, `integrations`, `setup` | AppShell | Connection settings, automation rules | Disabled/pending states | NOT_STARTED | — |
| `app/marketplace`, `store`, `product/` | AppShell / public shell | Product details, licensing, purchase | Pricing tables; transparent perf | NOT_STARTED | — |
| `app/pricing` | Site / AppShell | Pricing cards | Card radius consistent | NOT_STARTED | — |
| `app/mobile/**` | MobileShell | Deep links, command center | Cross-device sync state; honesty | IMPLEMENTED | Phase 11 audit |
| `app/live`, `live-performance`, `performance-arena` | AppShell | Real-time tables, execution analytics | Stale/offline indicators required | IN_PROGRESS | Partial |
| `app/portfolio`, `risk`, `goals` | AppShell | Portfolio charts, risk panels | Numeric alignment; color semantics | IN_PROGRESS | Partial |
| `app/news`, `economic-calendar`, `research` | AppShell | News cards, calendar, research panels | Freshness label; no fabricated data | NOT_STARTED | — |
| `app/alert-center`, `alerts` | AppShell | Alert lists, filters | StatusBadge for live/stale | IN_PROGRESS | Partial |

---

## 2. Shared Components — Audit Status

| Component | File | Status | Notes |
|---|---|---|---|
| Button | `components/ui/button.tsx` | IMPLEMENTED | Uses primary/destructive; gold default; no raw hex |
| Card | `components/ui/card.tsx` | IMPLEMENTED | Default hairline; elevated shadow-md only; danger variant |
| Badge | `components/ui/badge.tsx` | IMPLEMENTED | Semantic variants; no raw families |
| StatusBadge | `components/ui/status-badge.tsx` | IMPLEMENTED | live/active/positive/negative/warning/info/neutral/stale/offline/error/pending/connected/profitable |
| PageHeader | `components/ui/page-header.tsx` | IMPLEMENTED | eyebrow → title → subtitle; action cluster |
| SectionHeader | `components/ui/section-header.tsx` | IMPLEMENTED | Section title + meta + action |
| MetricCard | `components/ui/metric-card.tsx` | IMPLEMENTED | Label + mono value + delta; no gradient/glow |
| DataTable | `components/ui/data-table.tsx` | IMPLEMENTED | Sortable/paginated over table; compact rows |
| Table primitives | `components/ui/table.tsx` | IMPLEMENTED | Base table primitives |
| Toolbar | `components/ui/toolbar.tsx` | IMPLEMENTED | Filter/search/action row |
| ChartContainer | `components/ui/chart-container.tsx` | IMPLEMENTED | Toolbar + body + truthful dataState |
| EmptyState | `components/ui/empty-state.tsx` | IMPLEMENTED | Explain + next step |
| ErrorState | `components/ui/error-state.tsx` | IMPLEMENTED | Plain language + recovery; no stack trace |
| LoadingState | `components/ui/loading-state.tsx` | IMPLEMENTED | Skeleton-aware |
| Tabs | `components/ui/tabs.tsx` | IMPLEMENTED | Segmented control; active = gold |
| Input / Select / FormField / FormSection | `components/ui/input.tsx`, etc. | IMPLEMENTED | Labels, help, error; focus ring global |
| Dialog / DropdownMenu / Tooltip | `components/ui/dialog.tsx`, etc. | IMPLEMENTED | Overlays; blur allowed only here |
| Separator | `components/ui/separator.tsx` | IMPLEMENTED | Hairline border |
| ToggleChip | `components/ui/toggle-chip.tsx` | IMPLEMENTED | Chip control |

---

## 3. Global Tokens & Utilities

| Check | Status | Evidence |
|---|---|---|
| Dark-first :root palette | IMPLEMENTED | `app/globals.css` matches DESIGN.md §2 |
| Light `.light` override | IMPLEMENTED | All semantic values swapped correctly; primary-foreground preserved |
| Semantic trading colors fixed | IMPLEMENTED | `--positive`, `--negative`, `--warning`, `--info`, `--destructive` fixed |
| Chart series palette | IMPLEMENTED | `--chart-1..5` exclude gold |
| Focus ring (`--ring` = gold) | IMPLEMENTED | Global `:focus-visible` + component-level |
| `font-numeric` utility | IMPLEMENTED | `app/globals.css` defines `.font-numeric`; uses Mono + tabular-nums |
| Radius system (`rounded-md` / `rounded-lg` / `rounded-full`) | IMPLEMENTED | No `rounded-2xl` on surfaces; `rounded-card` / `rounded-button` helpers |
| `text-micro` floor (11px) | IMPLEMENTED | `text-[9px]`/`text-[10px]`/`text-[11px]` banned in CSS/util notes |
| No banned gradients/glow/glass | IN_PROGRESS | Must sweep all pages for `shadow-amber-500/20`, `backdrop-blur` misuse, gradient borders |

---

## 4. Current Implementation Batch (2026-10-10)

- Created this audit document (`docs/design-implementation-audit.md` — current file).
- Verified `globals.css` tokens against DESIGN.md §2–§3.
- Verified all 26 shared UI components in `components/ui/` exist and use semantic tokens.
- Identified major route families requiring page-level sweep.
- Next: sweep for banned visual patterns (glow, emoji, raw color families, micro text) and apply fixed numeric formatting / status badges to major pages.

---

## 5. Blockers & Risks

- No genuine blockers against design implementation. All business logic (Firebase RTDB, auth, Stripe, trading execution, risk controls, chart calculations) must remain untouched per DESIGN.md §17 / §19.
- Risk: some feature pages (`strategy-compare`, `backtests`, `marketplace/store`, `admin/**`) have not been inspected in this session; they need targeted review.
- Risk: mobile deep-link pages (`app/mobile/*`) rely on canonical engines; design changes must not break cross-device sync contracts (`lib/mobile/sync.ts`, `hooks/use-cross-device-sync.ts`).

---

## 6. Verification Plan (remaining)

- [ ] Run TypeScript check (`npm run type-check` / `tsc --noEmit`)
- [ ] Run production build (`npm run build`)
- [ ] Inspect dark and light renders of dashboard, terminal, scanner, market-intelligence
- [ ] Confirm no `text-[9px]` / `text-[10px]` remnants in touched files
- [ ] Confirm numeric columns are `font-numeric` + right-aligned in touched tables
- [ ] Confirm `StatusBadge` used for status columns instead of free-text color
- [ ] Confirm `DataTable` compact density and stable row height
- [ ] Confirm no decorative gradients, glow, emoji, neon borders in final diff
- [ ] Confirm responsive: sidebar drawer `< lg`; terminal stacks; tables scroll horizontally
- [ ] Confirm accessibility: aria-current on active nav; focus-visible on all interactive elements; labels on all inputs/buttons

