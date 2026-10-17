<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---
# Authoritative Project Instructions — trading-platform

This file is the single authoritative agent-instruction file for this repository.
Do not create competing instruction files (`CLAUDE.md`, `GEMINI.md`, `COPILOT.md`,
or nested `AGENTS.md`). Deleted obsolete docs (see git history) must not be recreated.

## Rule 1 — Follow My Latest Explicit Instructions

Priority order:

1. My latest explicit instructions and corrections.
2. My explicitly approved requirements for the current task.
3. The actual current codebase and verified implementation constraints.
4. This authoritative project instruction file.
5. Other relevant, current documentation that I have not explicitly excluded.

Older instructions never override newer requirements. Do not continue implementing
an earlier decision after I have explicitly corrected it.

## Rule 2 — Respect Explicitly Excluded Files

Whenever I explicitly instruct you to ignore a file, document, specification, or
previous implementation, respect that for the specified task: do not read or use an
excluded file as a source of requirements, do not follow its instructions indirectly
through another outdated document that references it, and do not reconstruct excluded
instructions from stale reports, generated summaries, previous implementation notes,
or duplicate documentation. An excluded document stays excluded until I explicitly
authorize its use again. Task-scoped exclusions respect their stated scope.

## Rule 3 — Do Not Blindly Follow Old Design Specifications

For all design and UI/UX tasks: 1) inspect the current implementation; 2) understand
the actual product requirements; 3) follow my latest visual and functional
instructions; 4) reuse appropriate existing components and design tokens; 5) improve
instead of mechanically copying old designs; 6) verify the rendered UI when browser
or visual testing tools are available. Never preserve an undesirable design merely
because an old document describes it. Never create another page because an outdated
plan recommends it. Before creating a new page, inspect existing routes and reuse the
page or module that already serves the purpose. Avoid duplicating functionality under
different names.

## Rule 4 — Record Stable, Approved Decisions

When I explicitly approve a design principle, architectural decision, or development
convention for future tasks, record it in this file under "Stable decisions".
Examples: approved visual direction, shared layout/navigation rules, component reuse
requirements, animation principles, architectural constraints, duplicate-prevention
rules, current-implementation review requirements. When I change a decision, update
this file and remove the obsolete rule instead of accumulating conflicting history.
Do not claim a decision is permanently recorded unless this file was actually updated.

## Rule 5 — Keep the Instructions Focused

This file holds stable, broadly applicable project rules only. Task-specific
requirements stay in the current task instructions unless explicitly approved as
permanent conventions. Keep this file clear, concise, actionable, and easy to follow.

## Design authority

`DESIGN.md` (project root) is the authoritative design system: tokens, typography,
layout, components, motion, shells, reference-integration workflow and the review
checklist. For product behaviour, `PRODUCT.md` remains authoritative. Existing visual
design is replaceable; existing functionality is not — see `PRODUCT.md` "What must
keep working". Read order for any UI task: this file → `PRODUCT.md` → `DESIGN.md` →
the code touched. Point-in-time audits under `docs/` are historical evidence, never
requirements; never treat them as specs for new work.

## Stable decisions recorded (from Rule 4)

- **Motion engine:** `motion` v14 (`motion/react`) only. CSS transitions for hover/state;
  Motion for orchestration/entrances. One entrance per view; `transform`/`opacity` only;
  `prefers-reduced-motion` always honoured.
- **Radii:** one ladder anchored at `--radius: 0.625rem` (shadcn scale; controls `sm`,
  hero/overlays `2xl`, pills full; cards/panels/tables `rounded-xl` canonical).
  Normalise installed ReUI components to this ladder.
- **Brand accent:** "Ember" (`#f97316` dark / `#ea580c` light), rationed to
  action/active/brand/live only; never for profit/buy/success. Semantic colours are
  fixed and single-meaning.
- **Reference stack:** reuse → shadcn primitive → ReUI composed (`@reui` registry, not
  an npm package) → Aceternity effect (marketing/hero only) → custom.
- **AI providers:** one gateway (`lib/ai`); OpenRouter free models are discovered from
  the live public catalog (never a hard-coded list); Ollama is local, loopback-only,
  explicit-selection only, and never an automatic fallback; paid inference is never
  selected automatically.
- **Numbers** use `font-numeric` (tabular figures); 11px is the type floor; data
  surfaces stay solid (blur only on scrims); marketing surfaces may use the
  spotlight/aurora light system within the ambient budget.
