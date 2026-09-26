"use client";

/**
 * Motion primitives shared by the self-service and admin account-health views.
 *
 * ── Reduced motion is respected, not assumed away ─────────────────────────────
 * `prefers-reduced-motion` is checked before anything animates. A count-up that
 * runs for a second is a usability problem for anyone who set that preference,
 * and a vestibular trigger is not a cosmetic issue.
 *
 * `useSyncExternalStore` is used rather than an effect + `useState`: a media
 * query is an external store, and this subscribes to it without a cascading
 * render or a flash of the wrong value on hydration. It is also SSR-safe via
 * the server snapshot, which matters because these pages are server-rendered
 * first.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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
    return useSyncExternalStore(subscribeToReducedMotion, readReducedMotion, readReducedMotionOnServer);
}

/**
 * Animate an integer from its previous value to `target`.
 *
 * Eases out rather than counting linearly, so a score settles into place
 * instead of ticking to a stop. Re-runs whenever the target changes, which is
 * what makes a refresh animate from the old score to the new one rather than
 * snapping. Returns the target immediately when motion is reduced.
 */
export function useCountUp(target: number, durationMs = 1000): number {
    const reduced = useReducedMotion();
    const [value, setValue] = useState(0);
    const frame = useRef<number | null>(null);
    // Held in a ref so the animation can start from whatever is on screen right
    // now, without re-running the effect on every frame it produces.
    const from = useRef(0);

    useEffect(() => {
        if (reduced) return;

        from.current = value;
        let start: number | null = null;

        const step = (now: number) => {
            if (start === null) start = now;
            const t = Math.min(1, (now - start) / durationMs);
            const eased = 1 - (1 - t) ** 3; // easeOutCubic
            setValue(from.current + (target - from.current) * eased);
            frame.current = t < 1 ? requestAnimationFrame(step) : null;
        };

        frame.current = requestAnimationFrame(step);
        return () => {
            if (frame.current !== null) cancelAnimationFrame(frame.current);
        };
        // `value` is intentionally excluded: including it would restart the
        // animation on every frame it produces. `from.current` carries it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target, durationMs, reduced]);

    return reduced ? target : Math.round(value);
}
