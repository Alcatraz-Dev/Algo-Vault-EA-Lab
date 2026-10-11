/**
 * Reduced-motion guard.
 *
 * Exposes the live `prefers-reduced-motion` state to the Candel tree so
 * consuming components can skip/cancel entrance animations and keep a panel
 * (or an overlay) from being left stuck in a hidden state under a reduced-motion
 * user. Server render stays un-flattened; the media query is resolved on the
 * client and in React effects — never in the render path.
 */

import { useSyncExternalStore } from "react";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Live reduced-motion state for the Candel area (re-exported for convenience).
 *
 * Server snapshot assumes motion is allowed, matching how Next.js SSR renders
 * and how the global CSS `prefers-reduced-motion` media query zeroes
 * animation/transition duration and restores `scroll-behavior: auto`.
 */
export function useReducedMotionGuard(): boolean {
  return useReducedMotion();
}
