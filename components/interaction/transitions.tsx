"use client";

/**
 * Shared motion transitions for the AlgoVault interaction system.
 *
 * Provider: `motion` (MIT, shadcn/ui's canonical animation partner). Drop-in —
 * the app already renders Base UI / Radix over dialogs/menus/tabs/tooltip and
 * their `data-slot` elements carry the CSS skelton in `app/globals.css`.
 *
 * Design: enter/exit is driven by Motion's `AnimatePresence` + `motion`
 * anchors with `initial / animate / exit` triples. Timing stays on the shared
 * easing tokens (`--ease-standard` 150–200ms) and is disabled by
 * `prefers-reduced-motion` (global rule already in `app/globals.css`).
 *
 * No state machine lives here: these are the exit/enter primitives every
 * consumer (page, panel, dialog, sidebar drawer) shares.
 */

import { motion, type MotionProps, type HTMLMotionProps } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

/** Shared default easing curve (DESIGN.md §4 / `app/globals.css --ease-standard`). */
const easeStandard = [0.2, 0, 0, 1] as const;

/**
 * Verbose, DOM-safe wrapper: the `Motion.div / Motion.span` type shim in some
 * setups lacks `HTMLMotionProps`; `motion.div` always carries the full
 * `HTMLDivElement`-typed props, so we expose a typed alias our consumers can
 * rely on without the `Motion` namespace.
 */
export type MotionDivProps = HTMLMotionProps<"div">;
export type MotionSpanProps = HTMLMotionProps<"span">;

/**
 * Full-page entrance: fade-up, then remove. Referenced by `animate-page-enter`
 * in `app/globals.css`.
 */
export function PageEntrance({
  children,
  className,
  ...rest
}: MotionProps & { className?: string; children: ReactNode }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.24, ease: easeStandard }}
      className={className}
      style={
        reduced
          ? { opacity: 1, y: 0, transform: "none" }
          : undefined
      }
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/**
 * Modal: centered at sm+, bottom sheet on mobile (matches the `[data-slot=
 * "dialog-content"]` rules in `app/globals.css`).
 */
export function Modal({
  children,
  className,
  transition: trans,
  ...rest
}: MotionProps & {
  children: ReactNode;
  className?: string;
}) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 8, scale: 0.97, filter: "blur(8px)" }}
      transition={{
        opacity: { duration: 0.16, ease: "easeIn" },
        y: { duration: 0.2, ease: "easeOut" },
        scale: { duration: 0.2, ease: "easeOut" },
        filter: { duration: 0.16, ease: "easeIn" },
        ...trans,
      }}
      className={className}
      style={
        reduced
          ? { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }
          : undefined
      }
      {...rest}
    >
      <div className="w-full">{children}</div>
    </motion.div>
  );
}

/**
 * Mobile bottom sheet: slides up from the bottom and the same `Motion.div`
 * serves for exit.
 */
export function Sheet({
  children,
  className,
  transition: trans,
  ...rest
}: MotionProps & {
  children: ReactNode;
  className?: string;
}) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  return (
    <motion.div
      initial={{ opacity: 0, y: "100%", scale: 1 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: "100%", scale: 1 }}
      transition={{
        opacity: { duration: 0.16, ease: "easeIn" },
        y: { duration: 0.24, ease: "easeOut" },
        scale: { duration: 0.2, ease: "easeOut" },
        ...trans,
      }}
      className={className}
      style={
        reduced
          ? { opacity: 1, y: "100%", scale: 1 }
          : undefined
      }
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Panel collapse: `grid-template-rows: 1fr 0fr` / `0fr 1fr` (AppShell token). */
export function Panel({
  children,
  className,
  transition: trans,
  ...rest
}: MotionProps & {
  children: ReactNode;
  className?: string;
}) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  return (
    <motion.div
      initial={{ gridTemplateRows: "1fr", opacity: 0 }}
      animate={{ gridTemplateRows: "1fr", opacity: 1 }}
      exit={{ gridTemplateRows: "0fr", opacity: 0 }}
      transition={{
        opacity: { duration: 0.14, ease: easeStandard },
        gridTemplateRows: { duration: 0.2, ease: easeStandard },
        ...trans,
      }}
      className={className}
      style={
        !reduced
          ? undefined
          : { gridTemplateRows: "0fr", visibility: "hidden", opacity: 0 }
      }
      {...rest}
    >
      {children}
    </motion.div>
  );
}
