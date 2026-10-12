import { useRef, useEffect, useState } from "react";

/**
 * useScrollProgressRail — spine scroll-driven progress (0→1) hook.
 *
 * Tracks the vertical scroll of the whole document (the spine: sticky nav +
 * scrollable content rail). Emits a DOM event the rails listen to, and a
 * small imperative API lets the host page start/stop/reset so a fresh rail
 * session begins at 0 on re-mount.
 *
 * Reduced motion: the host page hides the rail when the user prefers reduced
 * motion, so the rail never shows a bogus progress indicator.
 */
export function useScrollProgressRail() {
  const rafRef = useRef<number | null>(null);
  const lastTopRef = useRef<number>(0);

  const notify = () => {
    // Throttle to ~60fps via rAF so the rail advances only when the viewport
    // has actually changed.
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      notify();
    });
    const top = window.pageYOffset;
    const delta = top - lastTopRef.current;
    if (delta !== 0) {
      lastTopRef.current = top;
      window.dispatchEvent(new CustomEvent("algovault:scroll-delta", { detail: { delta } }));
    }
  };

  useEffect(() => {
    const onScroll = () => notify();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return {
    start: () => {
      lastTopRef.current = window.pageYOffset;
      window.dispatchEvent(new CustomEvent("algovault:scroll-start"));
      return {
        stop: () => {
          window.dispatchEvent(new CustomEvent("algovault:scroll-stop"));
          lastTopRef.current = window.pageYOffset;
        },
        reset: () => {
          lastTopRef.current = 0;
          window.dispatchEvent(new CustomEvent("algovault:scroll-reset"));
        },
      };
    },
  };
}
