"use client";

import { useEffect, useRef, useState } from "react";

/**
 * CountUp — animates a number from its previous value to the next one.
 *
 * Used by the dashboard "command center" widgets so a refreshed score, price or
 * percentage eases to its new value instead of jumping. Falls back to an
 * instant write when the user prefers reduced motion, when either value is not
 * finite, or when the duration is zero.
 */
export default function CountUp({
    value,
    decimals = 0,
    prefix = "",
    suffix = "",
    durationMs = 700,
    format,
    className,
}: {
    value: number;
    decimals?: number;
    prefix?: string;
    suffix?: string;
    durationMs?: number;
    /** Custom formatter for the in-flight value; defaults to grouping + decimals. */
    format?: (value: number) => string;
    className?: string;
}) {
    const safeTarget = Number.isFinite(value) ? value : 0;
    const [display, setDisplay] = useState(safeTarget);
    /** Last value actually rendered — an interrupted animation resumes from here. */
    const currentRef = useRef(safeTarget);
    const frameRef = useRef<number | null>(null);

    useEffect(() => {
        const from = currentRef.current;
        const to = safeTarget;

        const finish = () => {
            currentRef.current = to;
            setDisplay(to);
            frameRef.current = null;
        };

        if (from === to || durationMs <= 0) {
            finish();
            return;
        }

        const reduced =
            typeof window !== "undefined" &&
            typeof window.matchMedia === "function" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduced) {
            finish();
            return;
        }

        const startedAt = performance.now();
        const step = (now: number) => {
            const t = Math.min(1, (now - startedAt) / durationMs);
            // ease-out cubic: fast start, soft landing
            const eased = 1 - Math.pow(1 - t, 3);
            const next = from + (to - from) * eased;
            currentRef.current = next;
            setDisplay(next);
            if (t < 1) {
                frameRef.current = requestAnimationFrame(step);
            } else {
                currentRef.current = to;
                setDisplay(to);
                frameRef.current = null;
            }
        };

        frameRef.current = requestAnimationFrame(step);
        return () => {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, [safeTarget, durationMs]);

    const text = format
        ? format(display)
        : display.toLocaleString("en-US", {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
          });

    return (
        <span className={className}>
            {prefix}
            {text}
            {suffix}
        </span>
    );
}
