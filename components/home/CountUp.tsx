"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from 0 to `value` with an eased ramp once it scrolls
 * into view. Falls back to the final value instantly under reduced motion.
 */
export default function CountUp({
    value,
    duration = 1100,
    format,
}: {
    value: number;
    duration?: number;
    format?: (n: number) => string;
}) {
    const ref = useRef<HTMLSpanElement>(null);
    const [display, setDisplay] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        let raf = 0;

        if (
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
            raf = requestAnimationFrame(() => setDisplay(value));
            return () => cancelAnimationFrame(raf);
        }

        const io = new IntersectionObserver(
            (entries) => {
                if (!entries[0].isIntersecting) return;
                io.disconnect();

                const start = performance.now();
                const step = (t: number) => {
                    const p = Math.min(1, (t - start) / duration);
                    const eased = 1 - Math.pow(1 - p, 3);
                    setDisplay(Math.round(eased * value));
                    if (p < 1) raf = requestAnimationFrame(step);
                };
                raf = requestAnimationFrame(step);
            },
            { threshold: 0.4 }
        );
        io.observe(el);
        return () => {
            io.disconnect();
            cancelAnimationFrame(raf);
        };
    }, [value, duration]);

    return <span ref={ref}>{format ? format(display) : display}</span>;
}