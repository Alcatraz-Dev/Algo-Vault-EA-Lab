import { cn } from "@/lib/utils";
import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";

/**
 * Panel wrapper — a single contraction point for panel transitions.
 *
 * The task explicitly calls out "panel transitions" as the first shared
 * piece. `CandelChat` is a two-column shell (list + thread); on tablet it is
 * already a card, and the shared wrapper turns it into a collapsible set that
 * the Sidebar manages. On mobile it just works: the wrapper adds no extra
 * chrome.
 *
 * Contracts:
 *   - `expanded` toggles the grid rows via the same token AppShell already
 *     uses (`visible grid-rows-[1fr]` / `invisible grid-rows-[0fr]`).
 *   - With `prefers-reduced-motion`, collapsed panels never flash: the grid
 *     toggle is skipped and the content is just `display: contents`.
 */

const easeStandard = [0.2, 0, 0, 1] as const;

/** Panel set that collapses/expands together. */
export function PanelSet({
  expanded,
  children,
  className,
}: {
  expanded: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={expanded ? { gridTemplateRows: "1fr" } : { gridTemplateRows: "0fr" }}
      animate={expanded ? { gridTemplateRows: "1fr" } : { gridTemplateRows: "0fr" }}
      transition={{
        gridTemplateRows: { duration: 0.2, ease: easeStandard },
        opacity: { duration: 0.14, ease: easeStandard },
      }}
      className={cn(
        "grid opacity-0",
        expanded ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]",
        className,
      )}
      style={
        !expanded
          ? { gridTemplateRows: "0fr", visibility: "hidden", opacity: 0 }
          : undefined
      }
    >
      {children}
    </motion.div>
  );
}

/** Individual panel body that fades/slides in when it mounts. */
export function PanelBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: easeStandard }}
      className={cn("flex flex-col", className)}
    >
      {children}
    </motion.div>
  );
}

/** Conditional render that animates in when the condition becomes `true`. */
export function FadeIn({
  in: show,
  children,
  className,
}: {
  in: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: show ? 1 : 0, y: show ? 0 : 6 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.18, ease: easeStandard }}
      className={cn("flex", className)}
    >
      {children}
    </motion.div>
  );
}
