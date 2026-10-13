/**
 * Candels motion animation configuration.
 *
 * Shared @motion/react variants/eases for page, panel, and overlay entrances.
 * Easing is the only intentional divergence from the global design-token pause:
 * `--ease-standard` and `--ease-emphasized` are applied through the CSS
 * animation/timing utilities documented in DESIGN.md §14, so transitions stay
 * 150–200ms and respect `prefers-reduced-motion`.
 *
 * Nothing here renders UI on its own — it is the single source of truth for
 * enter/exit/layout variants so every Candel surface animates with one set of
 * timings and physics.
 */

import { motion, type Easing, type Variants } from "motion/react";

/**
 * Shared easing constants. Values mirror the CSS tokens `--ease-standard`
 * (`cubic-bezier(0.2, 0, 0, 1)`) and `--ease-emphasized`
 * (`cubic-bezier(0.32, 0.72, 0, 1)`) from `app/globals.css` as cubic-bezier
 * arrays, because motion v14's `Easing` type does not accept `var(...)` strings.
 */
const EASES: { standard: Easing; emphasized: Easing } = {
  /** 150–200ms, ease-based, matches DESIGN.md §14 */
  standard: [0.2, 0, 0, 1],
  /** 150–200ms, slightly more emphasis for overlays and panel stacks */
  emphasized: [0.32, 0.72, 0, 1],
};

/**
 * Interstitial page transition (library → studio, tabs, dialogs, panels).
 *
 * Entrance: slide-up + fade at `emphasized` (matches the global `page-enter`
 * keyframe for parity, but driven by Motion so exit is a controlled reversed
 * animation rather than a hard unmount).
 *
 * The `reduceMotion` guard is applied in the consuming variants via the
 * `data-reduced-motion` attribute, not in CSS, so the exit animation is a
 * fast reverse of the enter instead of a long fade that a reduced-motion user
 * is left waiting for.
 */
export const page: Variants = {
  hidden: {
    opacity: 0,
    y: 12,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.32,
      ease: EASES.emphasized,
      children: {
        opacity: 0,
        y: 6,
        transition: { duration: 0.24, ease: EASES.standard, staggerChildren: 0.04 },
      },
    },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: {
      duration: 0.24,
      ease: EASES.standard,
      staggerChildren: 0,
    },
  },
};

/**
 * Panel stack transition (sidebar-group entry, tab panel, expandable panel).
 *
 * Subtle: translate-y + fade, `standard` easing, share the same 150–200ms.
 */
export const panel: Variants = {
  hidden: {
    opacity: 0,
    y: 4,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.2,
      ease: EASES.standard,
      children: {
        opacity: 0,
        y: 3,
        transition: {
          duration: 0.18,
          ease: EASES.standard,
          staggerChildren: 0.025,
        },
      },
    },
  },
  exit: {
    opacity: 0,
    y: 2,
    transition: {
      duration: 0.15,
      ease: EASES.standard,
      staggerChildren: 0,
    },
  },
};

/**
 * Overlay / dialog transition.
 *
 * Full-screen scrim fades; content uses the `panel` variant so a modal that
 * needs a quick back-and-forth (open → back → close) doesn't hard-unmount.
 */
export const overlay: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.18,
      ease: EASES.standard,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.15,
      ease: EASES.standard,
    },
  },
};

/**
 * Collapse/expand of a collapsible list row without entering the panel stack.
 */
export const row: Variants = {
  collapsed: {
    opacity: 0,
    height: 0,
    overflow: "hidden",
  },
  expanded: {
    opacity: 1,
    height: "auto",
    transition: {
      duration: 0.2,
      ease: EASES.standard,
    },
  },
};

/**
 * Expandable intelligence panel (approve/permissions/automations/workspace).
 *
 * A row/card opens a panel. The user has complained the existing panels are
 * "missed" — this variant is the canonical motion for them.
 */
export const expandablePanel: Variants = {
  collapsed: {
    opacity: 0,
    height: 0,
    y: 4,
    overflow: "hidden",
  },
  expanded: {
    opacity: 1,
    height: "auto",
    y: 0,
    transition: {
      duration: 0.2,
      ease: EASES.standard,
    },
  },
};

/**
 * Hover / focus / press feedback state machine for interactive elements.
 *
 * Returns a single `data-` attribute string consumed by a `data-[slot=button]`
 * class that maps to the focus ring + hover surface in `app/globals.css` and
 * the UI primitives, so a hover changes only the surface token and a press
 * changes the active-surface token — both visible in both themes.
 *
 * The caller owns the trigger: this module only computes the attribute because
 * `motion` variants are keyed to props; the CSS that reads the attribute is
 * in `app/globals.css`.
 */
export function stateFor(
  hovered: boolean,
  focused: boolean,
  pressed: boolean,
  disabled: boolean
): string {
  if (disabled) return "data-state=disabled";
  if (pressed) return "data-state=pressed";
  if (focused) return "data-state=focused";
  if (hovered) return "data-state=hovered";
  return "data-state=idle";
}
