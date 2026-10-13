# UI Skills — curated pack (ui-skills.com)

Source catalog: <https://www.ui-skills.com/> (349 skills). We vendor a curated
subset — the full catalog would bloat every agent prompt. To use anything
outside this pack on demand: `npx ui-skills get <slug>` (e.g.
`npx ui-skills get beautiful-shadows`).

## Router (start here)

| Skill | When to use |
|---|---|
| `ui-skills-root` | Before any UI work: pick the smallest useful skill set (max 3). Run `npx ui-skills start` / `list --category <topic>` / `get <slug>`. |

## Vendored skills (`.agents/skills/`, symlinked to `.claude/skills/`)

| Skill | Upstream | Use when |
|---|---|---|
| `baseline-ui` | ibelick/baseline-ui | Fast cleanup pass: spacing, hierarchy, typography, small layout issues ("deslop"). |
| `better-ui` | jakubkrehel/better-ui | Visual polish: radius, optical alignment, shadows, icon states, micro-motion. |
| `better-typography` | jakubkrehel/better-typography | Type scale, spacing, font features, wrapping, truncation, punctuation. |
| `better-colors` | jakubkrehel/better-colors | Color systems: palettes, semantic tokens, format conversion, contrast checks. |
| `better-layout` | jakubkrehel/better-layout | Grouping, alignment, reading order, responsive structure, i18n-safe layouts. |
| `better-accessibility` | jakubkrehel/better-accessibility | Keyboard/focus, ARIA, names, forms, announcements, motion + zoom (WCAG 2.2). |
| `better-interface` | jakubkrehel/better-interface | Holistic review combining all `better-*` angles in one pass. |
| `frontend-design` | anthropics/frontend-design | New surfaces: distinctive art direction that avoids templated defaults. |
| `improve-ui` | ibelick/improve-ui | Audit a surface vs DESIGN.md, emit self-contained plans (read-only on source). |
| `improve-animations` | emilkowalski/improve-animations | Motion audit → prioritized roadmap (read-only; another agent executes). |
| `animate` | emilkowalski/animate | Build a new animation: purpose → tool → props → curve/duration → interrupt → exit. |
| `web-design-guidelines` | vercel-labs/web-design-guidelines | Compliance review vs Vercel web interface guidelines (design + a11y + UX). |
| `accessibility` | addyosmani/accessibility | WCAG 2.2 audit: screen readers, keyboard nav, contrast, compliance. |

## Rules (project conventions)

1. **DESIGN.md wins.** Skills advise; [DESIGN.md](../DESIGN.md) (AlgoVault design system —
   tokens, typography, components, motion; supersedes the old "Institutional Command" doc)
   is the authority. If a skill suggests something that conflicts with DESIGN.md, follow
   DESIGN.md.
2. **Max 3 skills per task** (per `ui-skills-root` routing). Prefer 1.
3. **Audits are read-only.** `improve-ui` / `improve-animations` produce plans;
   a separate step implements them.
4. **Refresh:** re-run `npx ui-skills get <owner/slug> > .agents/skills/<name>/SKILL.md`
   to update a skill. Keep directory name == `name:` frontmatter.

## CLI cheat sheet

```bash
npx ui-skills start                  # routing skill
npx ui-skills categories             # topic list
npx ui-skills list --category motion # skills in a topic
npx ui-skills get baseline-ui        # full skill markdown
npx skills list                      # verify installed project skills
```
