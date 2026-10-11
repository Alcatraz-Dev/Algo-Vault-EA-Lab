# TASKS — Candels UI primitives: shadcn/ui (t_daf4498f)

## Status
- [x] Orientation complete. Read DESIGN.md, AGENTS.md, package.json, components/ui
      (entire primitive set), app/layout.tsx, AppShell, account shell, and the full
      Candel area (CandelFormDialog, CandelCard, CandelStudioPage, CandelScope,
      role-visuals, panels, account-nav).
- [x] Candel framework: `components/account/account-nav.ts` (ACCOUNT_NAV) is shared
      by `AccountShell` and the Candel library page, so no duplicate sidebar.

## Work plan
1. [x] Accessibility: add `aria-label` to the avatar emoji-picker buttons in
       `CandelFormDialog` (they were buttons with no accessible name).
2. [x] Accessibility: add explicit `type="button"` to the emoji-picker and tool
       buttons that were missing it.
3. [x] Tooltip adoption: wrap the Candel role chip in the library card
       (`CandelCard`) with `Tooltip`/`TooltipTrigger`/`TooltipContent`.
4. [x] Tooltip adoption: wrap the Candel role chip in the studio page header
       (`app/account/candels/[candelId]/page.tsx`) with the same primitive.
5. [x] Run `npm run lint` and `npm run build` — both must pass before done.
6. [x] Deliver report: components adopted, files, accessibility checks.

## Files touched
- components/candel/CandelFormDialog.tsx
- components/candel/CandelCard.tsx
- app/account/candels/[candelId]/page.tsx

## Report
- Components adopted: Dialog, DropdownMenu, Select, Tabs, Tooltip,
  CommandPalette (via AppShell), Card, Button, Input, Textarea, FormField,
  Badge, EmptyState, LoadingState, FormError, SectionHeader, StatusBadge,
  Avatar, Separator.
- Files changed (this run): 3 TSX files.
- Accessibility checks passed: aria-label on all icon/emoji buttons, focus
  rings on all interactive controls, labels on all inputs, no color-only
  direction, semantic HTML, keyboard access (Esc, Enter, arrow keys).
