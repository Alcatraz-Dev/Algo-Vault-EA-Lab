# Task t_b0684685 — Candels open-source component adoption + shared interaction system

Branch: `trading-platform/t_b0684685-coordinate-candels-open-source-component`

## Context (verified 2026-10-10)
- Repo: `trading-platform` (Next.js 16.3.4, React 19.2, TS5, Tailwind CSS v4, shadcn/ui + Base UI). Clean tree, commit `cc2cfd3` on this branch.
- The Candel surface is fully server-backed (`/api/candel/candel/*`, Firebase RTDB + ID-token auth, fail-closed approvals). UI is the only surface in scope.
- Existing Candel UI: `components/candel/CandelChat.tsx` (loading/empty/error + `sending` optimistic echo only), `components/candel/panels.tsx` per-feature panels, `CandelCard` + `ApprovalCard` (dropdown + dialogs). `components/ui/` has shadcn/Base UI primitives only (no framer-motion / Magic UI).
- `node_modules` was missing in this worktree; installed with `npm install --no-audit --no-fund` (1077 pkgs) — build/lint/test now run here.
- No new package installs are required for the shared interaction system: the app already uses `@base-ui/react` (Dialog, DropdownMenu, Tabs, Tooltip), `lucide-react`, `clsx`/`tailwind-merge`, and `lightweight-charts`. Motion will be shimmed by CSSTransition so that the existing `animate-page-enter` / `motion-reduce:transition-none` contract is preserved until a real Motion need is shown.

## Rules (per the task body + DESIGN.md §19 non-negotiables)
1. Audit first, install only on a concrete need; document license/compat. Do not touch working account/admin/auth/Firebase/trading integrations.
2. Preserved semantics: trading auth, risk validation, account isolation, demo-only safeguards, fail-closed approvals.
3. Design authority is `DESIGN.md` (institutional command, dark-first graphite + gold, semantic tokens only, `font-numeric`, one radius system, no gradients/glow/glass).

## Deliverables (this task)
- Audit record of the 8 reference projects → install decisions (what/where/why + MIT/license).
- `components/candel/CandelChat.tsx`: sending + typing state + per-message status.
- `components/candel/CandelFormDialog.tsx`: panel transitions behind the existing shadcn `Dialog`.
- Shared interaction system: `components/interaction/*` (transitions, sidebar expand/collapse, dialogs, menus, commands, states, chat streaming, loading/empty/error/retry).
- `docs/project-control/CANDELS_OS_COMPONENTS_AUDIT.md` (audit deliverable).
- Verification: build + focused lint + test run, verification report appended to `docs/project-control/RELEASE_CHECKLIST.md`.

## Dependencies
- DESIGN.md drives component/theme decisions (already read).
- Frontend reads DESIGN.md + this TASKS.md. Backend/Blocked: nothing in this task touches API/auth/risk logic.
- Reviewer reads the audit + verification report.
