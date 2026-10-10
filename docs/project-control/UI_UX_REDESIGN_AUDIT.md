# AlgoVault — Product-wide UI/UX Audit & Redesign Log

Owner: design/frontend workstream. Mode: **Operate** (per `DESIGN.md`).
Companion docs: `DESIGN.md` (visual world), `ALGOVAULT_AGENT_CONSTITUTION.md` §37/§46/§54 (quality gates, UI states, verified tokens), `docs/project-control/RECOVERY_LOG.md` (concurrent reliability work).

This is a working log, not a proposal. Each phase records what changed, what was verified, and what remains.

---

## Phase 1 — Audit (2026-10-10)

### 1. Current UI architecture

- **Framework:** Next.js 16.3.4 (App Router, Turbopack), React 19.2, TypeScript 5, Tailwind CSS v4 (`@import "tailwindcss"` + `@theme inline` in `app/globals.css`).
- **Primitives:** Base UI (`@base-ui/react`) + Radix + CVA + `cn` (from the `cn` package). Icons: `lucide-react` (+ `@phosphor-icons/react`). Charts: `lightweight-charts` v5 (custom engine) + `recharts`.
- **Fonts:** Geist Sans + Geist Mono via `next/font` (`app/layout.tsx`). Tabular numerics via `.font-numeric`.
- **Theming:** class-based (`light` class on `<html>`), initialized by `THEME_INIT_SCRIPT`. Tokens are CSS variables → `@theme inline` utilities.
- **Shells:** `AppShell` (canonical authenticated shell: sidebar + topbar) is reused by `AccountShell` and `AdminShell`, and wrapped by `AppSidebarLayout` for bare route families. `SiteNavbar`/`Footer` are marketing. `/trading` is a standalone terminal (no AppShell, per §54.6).
- **Nav catalogue:** `components/layout/app-nav.ts` (APP_NAV, ADMIN_NAV, DEVELOPER_NAV), `components/account/account-nav.ts`, plus a Candel-specific group in `AccountShell`.
- **Shared library:** `components/ui/*` — `button`, `card`, `badge`, `input`, `select`, `tabs`, `dialog`, `dropdown-menu`, `tooltip`, `table`/`data-table`, `empty-state`, `error-state`, `loading-state`, `metric-card`, `status-badge`, `page-header`, `section-header`, `toolbar`, `form-field`, `form-section`, `site-logo`.
- **Scale:** ~100 routes; ~74k lines of TSX. Design debt is large and spread out (see §2).

### 2. Biggest visual inconsistencies (evidence-based)

Measured with `rg` across `app components features tools` (`.tsx`):

| Drift | Count | Canonical target (`DESIGN.md` / §54) |
| --- | --- | --- |
| Raw colour families (`emerald/rose/amber/sky/violet/orange/red-###`) | **~5,900** | semantic tokens `positive/negative/warning/info/primary` |
| `text-[10px]` micro text | **1,228** | ban → `text-[11px]` min |
| `text-[11px]` (allowed but overused) | 864 | `text-xs` for dense text |
| `text-[9px]` | **193** | ban |
| `rounded-2xl` / `rounded-3xl` | 796 / 31 | cards `rounded-lg`, controls `rounded-md`; `2xl/3xl` banned |
| `font-mono` on UI (numeric should use `font-numeric`) | 1,234 | `font-numeric` for numbers only |
| `backdrop-blur-*` | 247 | only scrims / sticky shell headers |
| `shadow-2xl` on cards | 43 | banned on cards |

1. **Broken shared components (highest impact).**
   - `components/ui/status-badge.tsx` (rendered **81×** across **42 files**) references tokens that **do not exist** (`success-muted`, `destructive-muted`, `warning-muted`, `info-muted`, `success-foreground`, …) and carries a stray base `text-yellow-300`. Net effect: **every status badge renders as an unstyled yellow pill** with no semantic background/border. Semantic meaning is lost everywhere it is used.
   - ~25 further sites (`form-field`, `NoticeBanner`, admin growth/monetization/intelligence pages) use `*-muted` and `*-foreground` tokens that are undefined or used against a tinted surface, so they are invisible in **light** theme.
2. **Semantic colour contrast fails AA** (measured via OKLCH→sRGB→WCAG):
   - `--positive` #17890b: **4.15** on `#111111`, **3.91** on `#181818` (used as `text-positive` **134×**).
   - `--negative` #e7000b: **3.96 / 3.72** (used as `text-negative` **109×**).
   - `--info` is set to `#a3a3a3` (grey) — the *info* semantic is visually identical to muted text.
   - white on `--primary` #ff4d00 = **3.33** → the filled CTA label is below AA for normal text.
   - `--primary` on light `#f9f9f9` = **3.16** (light-theme nav active / links).
3. **Radii / elevation / glass drift:** banned `rounded-2xl/3xl`, glow shadows and `backdrop-blur` on surfaces are still common; `globals.css` still ships dead `glass`/`glow`/`gradient-text` utilities (0 TSX usages) plus the `gemini-*` gradient system.
4. **Duplicate page-header anchor:** `data-guide="page-header"` is set **twice inside `AppShell`** (the `<header>` and an inner `<div>`), and in ~60 page bodies — the guide system's anchor is ambiguous.

### 3. Current design-system state

- A real, documented system exists (`DESIGN.md` + §54) with the right *intent* (semantic tokens, one radius system, mono numerics, no glow).
- **Reality has drifted**: the token set is incomplete (`success*`, `*-muted` missing; `info` grey), micro type is pervasive, and raw Tailwind colour families outnumber token usage many times over. The system is sound on paper; it needs (a) completing the tokens, (b) fixing the two broken shared components, and (c) a bounded mechanical sweep.

### 4. Most important interaction problems

- **Sidebar:** 9 groups / ~60 items rendered fully expanded at all times; no collapsible sections; `pro: true` is set on ~30 items but **never rendered** (dead metadata — users cannot see which destinations are gated); two items labelled “Market Scanner” and “Charts” both link to `/scanner` (duplicate).
- **Signed-out shell footer:** shows a synthetic “Trader” identity and a **Sign out** button even when signed out (fake identity + no-op action).
- **Mobile drawer:** conditionally mounted with **no enter/exit transition**.
- **Motion:** a calm reduced-motion baseline already exists (good); no shared duration/easing tokens, so timing is ad-hoc per component.

### 5. Responsive & accessibility issues

- No device emulation is exposed by the available tooling and this agent cannot view pixels → responsive verification is limited to source review + DOM geometry checks (documented as a limitation in §17).
- Light theme has several effectively-invisible tokens (see §2.1/2.2) — a real contrast/legibility failure.
- The filled primary CTA fails AA (white on #ff4d00). Focus rings exist per-component but there is no global fallback.
- Touch targets: a `touch-target` helper exists; coverage is inconsistent.

### 6. Proposed design direction (Phase 2–5)

Keep the established identity (**orange `#ff4d00` primary**, dark-first graphite, Geist + Geist Mono tabular numerics, hairline borders, restrained motion) and make it *coherent* rather than *different*:

1. **Complete and rebalance the token layer** — define the missing tokens, fix `info`, lift `positive/negative/destructive` so semantic text passes AA on dark, keep light theme intentional (deep, AA-passing), add motion/elevation tokens.
2. **Fix the broken shared components** so every badge/error/success surface is semantic and legible in both themes.
3. **Redesign the global shell** — collapsible nav groups with persisted state, active-route rail, real Pro badges, fixed signed-out footer, animated mobile drawer, cleaned duplicate anchor and duplicate nav entry.
4. **Terminal** — bring the Pro Terminal components onto the semantic tokens + typography rules (`font-numeric`, no micro sizes) without touching chart/trading logic.
5. **Marketplace / Candel / Account / Admin** — targeted, contract-preserving improvements; larger sweeps tracked as follow-ups.

### 7. Implementation order

Phase 2 (tokens + shared components) → Phase 3 (shell) → Phase 4 (terminal) → Phase 5 (marketplace/Candel/account/admin) → Phase 6 (consistency + verification).

### 8. Risks to existing functionality

- `StatusBadge` is shared by 42 files: fixing it changes the look of all of them (toward correctness) — no API change.
- Token value changes are global by nature; every change here is a *contrast* improvement, verified numerically, and never removes a token.
- Concurrent Candel work exists as uncommitted changes (shell `AccountShell.tsx` is modified). This workstream will **not** touch Candel files or `AccountShell`'s nav beyond additive, non-conflicting edits.
- No trading/payment/auth/API code is touched.

---

## Phase 2 — Design-system foundation

Complete. Full report in `RECOVERY_LOG.md` (entry `UI-001`). Summary:
- Missing tokens added and all semantic colors rebalanced to pass **AA on both themes** (verified via DOM/computed styles against the real OKLCH tints).
- `--info` changed from grey to blue; `--primary-foreground` changed to dark ink (user-approved) so solid primary fills pass AA while keeping the exact `#ff4d00` orange.
- `StatusBadge` repaired (was rendering an unstyled yellow pill in 42 files); `FormError`/`FormSuccess` and the admin `*-muted` banners are now legible.
- Solid semantic fills that carry text now use `text-background`; no function/API changed.
- Decision recorded: non-primary `*-foreground` tokens are the legible on-tint text color (their only real usage), not solid-pair colors.

## Phase 3 — Global shell

Complete. Full report in `RECOVERY_LOG.md` (entry `UI-002`). Summary:
- Collapsible nav groups (persisted), real Pro/badge chips, fixed signed-out footer, animated mobile drawer + scroll-lock.
- Single `page-header` guide anchor (removed the `PageHeader` duplicate); single-source Candel nav; dead code removed.
- Duplicate `/scanner` nav entry already gone; page-body `data-guide` sweep deferred as a bounded follow-up.

## Phase 4 — Pro Terminal

First slice complete (`UI-003`): `AccountPanel`, `OpenPositions`, `PendingOrders`, `AccountHeader` moved to semantic tokens + `font-numeric` + allowed micro type (335 terminal + 32 trading tests green). Chart engine and wider layout untouched by rule.

## Phase 5 — Marketplace / Candel / Account / Admin

Complete for the premium-SaaS scope (`UI-004`, `UI-005`):
- **Marketplace** (list, detail, plugins, extensions): one calm card system, semantic tokens, type floor, `font-numeric` money/stats, single `primary/10` brand wash; orange spent only on title hover + solid Buy Now CTA. Vendor data shown as-is with "—" fallbacks; developer-results disclaimer kept.
- **Candel**: panels already drift-clean; proposal confidence relabeled "model confidence" + self-reported tooltip (no fake meters).
- **Account**: purchases/licenses onto semantic status tokens; **Auth**: login/register notices to AA positive tokens.
- Untouched by rule: Stripe/licensing/entitlement logic, Candel data flow, chart engine. Admin tables remain a tracked follow-up (operational, no fake data added).

## Phase 5 — Marketplace / Candel / Account / Admin

See `UI-004`.
