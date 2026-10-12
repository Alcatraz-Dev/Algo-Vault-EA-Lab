# TASKS.md — AlgoVault UI Redesign (reui.io components)

Plan for task `t_6585d80b` ("redesign all project UI with reui.io/components").
Visual authority: `DESIGN.md` (AlgoVault design system, dark-first, gold accent).
Stack: Next.js 16 / React 19 / TypeScript / Tailwind v4 / Firebase / Lucide.

Stack + commands (`AGENTS.md` already carries these):
- `cd <project-root> && npx tsc --noEmit` — typecheck
- `npm run lint` (eslint) — lint
- `npm run build` — production build
- `npm run dev` — dev server

No change is allowed to trading, payment, auth, data, API-contract or routing
logic (DESIGN.md §17). The redesign is visual + component-architectural only.

---

## 1. designer — Lock the design contract

- Owner: `designer`
- Files: `DESIGN.md`, `DESIGN.md` decision notes, `components/reui/*`
- Acceptance criteria:
  - `DESIGN.md` remains the authority; its AlgoVault tokens (§2) are kept, not
    duplicated or re-pointed.
  - One recorded mapping decision: `reui/frame`, `reui/badge`, `reui/icon-tile`
    (plus the FlyonUI-wrapped `components/ui/*` primitives) are the canonical
    primitive set; no new decorative primitives are added.
  - Naming/scoping decision recorded: product pages consume the shared shell
    (`AppShell` + `AppSidebarLayout`) and the AlgoVault tokens; the landing page
    (`components/home/**`) keeps the scoped §21 exception only.
- Decision log (embedded, no route change):
  - Semantic-colour mapping is fixed (§2.3): up/buy/positive = emerald
    (`--positive`), down/sell/negative = red (`--negative`), risk = gold
    (`--warning`), neutral info = sky (`--info`), selected/active UI = gold
    (`--primary`). Never reused as decoration.
  - Numeric rule: `font-numeric` + right-aligned + explicit sign; `font-mono`
    only for code/log text.
  - Radius one system: cards `rounded-lg`, controls `rounded-md`, pills
    `rounded-full`.
- Status: ready

---

## 2. frontend — Apply the AlgoVault + reui primitives across product pages

- Owner: `frontend`
- Files:
  - `components/ui/*` (FlyonUI wrappers), `components/layout/*` (AppShell,
    AppSidebarLayout, app-nav, CommandPalette, NotificationsMenu)
  - `components/reui/*` (frame, badge, icon-tile)
  - `app/globals.css` (tokens, theme bridge, `:root`/`.light`, `@theme inline`)
  - `app/**/*.tsx` (product pages), `components/home/**` (landing page)
- Acceptance criteria:
  - All product surfaces consume semantic tokens only (`bg-card`, `text-positive`,
    `border-border`, `ring-ring`) — no raw Tailwind families (`emerald-500`, …)
    or raw hex in product surfaces.
  - Trading numerals use `font-numeric`, right-aligned, signed; `font-mono` only
    for code/log text (DESIGN.md §3).
  - Radii follow the one system (§4); hairline `border-border` on cards; hover =
    stronger surface, no lift+shadow.
  - `reui/frame`, `reui/badge`, `reui/icon-tile` used as intended; flyonui
    component classes reach pages only through the `components/ui` wrappers.
  - Shell + navigation intact; command palette, theme toggle, notifications,
    sidebar groups all present.
  - Dark + light both render; mobile reflows (sidebar → drawer under `lg`,
    panels stack, tables scroll internally); no page-level horizontal overflow.
  - Loading/empty/error/stale/offline states use `LoadingState`/`EmptyState`/
    `ErrorState`/`StatusBadge` — never fabricated values.
- Status: ready

---

## 3. backend — Keep trading/auth/payment logic untouched; add freshness signals

- Owner: `backend`
- Files:
  - `lib/**/*.ts` (data-access, trading, auth, payment, analytics)
  - `app/api/**/*.ts` (route handlers) if any
  - UI surfaces that consume data feeds
- Acceptance criteria:
  - Zero change to: Firebase RTDB integration, authentication/authorization,
    Stripe/payment flows, order submission/execution, risk controls,
    chart/indicator calculations, API contracts, routing.
  - Freshness handling uses existing `StatusBadge` tokens: live / stale / offline /
    unavailable; data that is stale or unavailable is labeled honestly, never
    presented as live (DESIGN.md §13, §17).
  - Network-dependent actions are disabled/muted when the app is offline.
  - No fabricated prices, balances, P&L, fills, or success states.
- Status: done
## 3b. backend — freshness signals done

- Owner: `backend`
- Files:
  - New: `lib/market-data/freshness.ts`
  - Annotated: `app/api/signals/quotes/route.ts`, `app/api/market/quotes/route.ts`
  - Tests: `lib/market-data/__tests__/freshness.test.ts`, route test
- Acceptance criteria:
  - `lib/market-data/freshness.ts` classifies data verdicts (`fresh|stale|unavailable`) + transport (`online|offline`) into the four `StatusBadge` tokens, offline transport wins, unavailable never promoted to live.
  - Market-quotes routes report per-symbol `freshness` + top-level `online`, so network-dependent actions can be disabled when the live feed is down.
  - No trading/payment/auth/data/risk/chart logic changed; no fabricated numbers.
- Status: done

---

## 4. reviewer — Verify the redesign end to end

- Owner: `reviewer`
- Files: entire project root
- Acceptance criteria:
  - `npx tsc --noEmit` exits 0.
  - `npm run lint` exits 0.
  - `npm run build` exits 0.
  - Dark AND light themes render at 390 / 768 / 1440 with no horizontal
    overflow and no console errors introduced by the redesign.
  - Diff contains **only** visual/component/architecture changes — no trading,
    payment, auth, data, API-contract or routing logic changed (DESIGN.md §17).
  - `font-numeric` is used for all trading numbers; no arbitrary micro text
    (`text-[9px]`/`text-[10px]`/`text-[11px]`); one gold accent.
- Status: ready
