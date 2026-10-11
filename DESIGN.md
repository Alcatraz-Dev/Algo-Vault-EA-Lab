# Design authority — AlgoVault Design System ( DESIGN.md )
## Role in this task
- AUTHORITY: `DESIGN.md` is unchanged by this workstream; it is the visual authority.
- This document decides **visual/component shape only** (OPEN question of *which* reference components to adopt). It is written and re-added by `next dev`; committing it with our work keeps the tree clean.

## Decisions recorded for this task
1. Motion layer: adopt **Motion (prev Framer Motion)** for the shared interaction system.
   - MIT license, drop-in, shadcn/Base UI compatible. `npm install motion`.
   - Replacement rationale: `motion` is the canonical shadcn/ui animation partner and licenses like the existing `lucide-react` + `@base-ui/react`. The app already uses Base UI dialogs where available.
   - Reference audit:
     - `framer-motion` / Motion (MIT, @motiondivision/motion) — previously named in the task scope.
     - `magicui` (MIT, copy-paste) — no npm package; requires a registry CLI; slower up-front gain than a drop-in animation library → **not installed in this task**, revisit in a later task when a concrete page needs a marquee/beam.
     - `tremor` (Apache-2.0) — charts/dashboards; already shipping `lightweight-charts` + `recharts` through the semantic token system → no new chart vendor needed for the shared interaction system.
     - `dashboardcn` (MIT, copy-paste shadcn registry) — no npm install; CLI copy-paste model → not adopted in this task.
     - `OpenDots` (AG-UI/CopilotKit) — agent-workspace architecture; a **backend contract decision** (the Candel `/conversation/message` socket/AG-UI stream surface), not a UI component decision.
     - `React Bits` (MUI-licensed animated reactions) — covered by **Motion**; no separate library.
2. Shared interaction system: **CSSTransition-like + Base UI data attributes** + shared `motion` CSS tokens; no third-party state machine. State machine lives in `components/interaction/` (see TASKS.md §3).
3. Sidebar expand/collapse: `AppShell` already has persisted `localStorage: algovault.nav.collapsed`; the shared system makes the **panel transition** the new piece (collapsed → scaled-down panel set).
4. No new dependency for dialogs/menus/tabs/tooltip — they are already Base UI + Radix. Motion adds **enter/exit transitions only**.
5. Accessibility contract: all motion respects `prefers-reduced-motion` (already global in `app/globals.css`) and the `motion-reduce` helper.

## Discharge states (no new tokens)
- `data-state="loading|empty|error|stale|offline"` on the shared `CardStack`/panel; the existing `LoadingState`, `EmptyState`, `ErrorState` are used verbatim. No `*-muted`/`*-foreground` tokens exist for this task — the shared system uses the existing `bg-muted`, `text-muted-foreground`, `border-border` tokens.
