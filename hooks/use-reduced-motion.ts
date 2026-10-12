"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void): () => void {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
    }
    const query = window.matchMedia(QUERY);
    query.addEventListener("change", callback);
    return () => query.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false;
    }
    return window.matchMedia(QUERY).matches;
}

/** SSR/first paint assume motion is allowed, matching the server markup. */
function getServerSnapshot(): boolean {
    return false;
}

/**
 * usePrefersReducedMotion — reads the OS motion preference.
 *
 * Charts animate on mount by default (Recharts `isAnimationActive`). The landing
 * page owes a static frame under `prefers-reduced-motion` (DESIGN.md §21.4), so
 * every home chart reads this hook and passes it down to its series instead of
 * animating unconditionally. Implemented with `useSyncExternalStore` so the
 * server snapshot and the first client paint agree.
 */
export function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
