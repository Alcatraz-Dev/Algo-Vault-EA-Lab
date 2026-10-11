/**
 * Reduced-motion hook for the Candel area.
 *
 * Follows the account-health/motion.ts pattern: `prefers-reduced-motion` is
 * checked before anything animates, so a count-up or panel cross-fade that
 * runs for a second is a usability problem (and a vestibular trigger) for anyone
 * who set that preference.
 *
 * `useSyncExternalStore` subscribes to the media query instead of an effect +
 * `useState`: a media query is an external store, and this keeps the value
 * stable across renders without a flash of the wrong value on hydration. The
 * server snapshot assumes motion is allowed, so markup is not pre-flattened.
 */

import { useSyncExternalStore } from "react";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_QUERY).matches;
}

/** Server render: assume motion is allowed, so markup is not pre-flattened. */
function readReducedMotionOnServer(): boolean {
  return false;
}

/** Live `prefers-reduced-motion` state. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    readReducedMotion,
    readReducedMotionOnServer
  );
}
