import { useRef, useEffect } from "react";

/**
 * ScrollProgressRail — the spine scroll-driven progress bar.
 *
 * Tracks the vertical scroll of the whole document (the spine: sticky nav +
 * scrollable content rail). Writes a CSS custom property the rail's 2px top
 * hairline animates along, so every page that shares the rail advances the
 * same progress bar without page-specific logic.
 *
 * The host page drives it with a small imperative API:
 *   propagateScroll({ start, stop, reset }) — call start() before subscribing,
 *   stop() when the unmount/cleanup happens, reset() to 0 for a fresh rail.
 *
 * Reduced motion: the bar is visually hidden (width:0, opacity:0, aria-hidden:
 * true) so the rail never shows a bogus progress indicator.
 */
export function useScrollProgressRail() {
  const rafRef = useRef<number | null>(null);
  const lastTopRef = useRef<number>(0);

  const notify = () => {
    // Throttle to ~60fps using requestAnimationFrame so the rail only advances
    // when the viewport has actually changed.
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      notify();
    });
    const top = window.pageYOffset;
    const delta = top - lastTopRef.current;
    if (delta !== 0) {
      lastTopRef.current = top;
      // Emit a DOM event the rail (and shell) listens to.
      window.dispatchEvent(new CustomEvent("algovault:scroll-delta", { detail: { delta } }));
    }
  };

  useEffect(() => {
    const onScroll = () => {
      //Cap updates per frame.
      notify();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return {
    /**
     * Start driving the rail. Call before subscribing to the rail's data.
     * Returns a cleanup function that stops updates and resets the tracked
     * scroll offset so a subsequent start() begins from 0.
     */
    start: () => {
      lastTopRef.current = window.pageYOffset;
      window.dispatchEvent(new CustomEvent("algovault:scroll-start"));
      return {
        stop: () => {
          window.dispatchEvent(new CustomEvent("algovault:scroll-stop"));
          // Reset so a new rail session begins at 0.
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

/**
 * ScrollProgressBar — the 2px hairline that grows across the rail as the
 * document scrolls. Driven by the `scroll-progress` CSS variable set by the
 * scroll listener in the host page.
 *
 * Reduced-motion is honoured via the `prefers-reduced-motion` media query in
 * globals.css (the bar is hidden entirely when the user prefers reduced
 * motion). It is `aria-hidden` and non-focusable.
 */
export function ScrollProgressBar({ className }: { className?: string }) {
  return (
    <div
      className={`fixed left-0 top-0 z-[60] h-0.5 w-full origin-left rounded-full bg-primary ${className ?? ""}`}
      aria-hidden
    />
  );
}
