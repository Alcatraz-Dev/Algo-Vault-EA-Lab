"use client";

import { type ReactNode } from "react";
import { motion } from "motion/react";

/**
 * Fades and lifts its children into view once they enter the viewport.
 *
 * Previously this was a hand-rolled IntersectionObserver writing the
 * `.reveal` / `.is-visible` classes by hand. It now uses Motion's `whileInView`,
 * which is the same effect (opacity 0 → 1 with a 16px lift, 0.7s on
 * cubic-bezier(0.22, 1, 0.36, 1)) but driven by the library, so it composes with
 * other Motion features and cleans itself up on unmount.
 *
 * Reduced motion is honoured by the `[data-motion-reveal]` rule in globals.css
 * instead of reading a media query during render, so server and client markup
 * stay identical and there is no hydration mismatch.
 */
const EASE = [0.22, 1, 0.36, 1] as const;

export default function Reveal({
    children,
    delay = 0,
    className = "",
}: {
    children: ReactNode;
    delay?: number;
    className?: string;
}) {
    return (
        <motion.div
            data-motion-reveal=""
            className={className}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.12 }}
            transition={{ duration: 0.7, ease: EASE, delay: delay / 1000 }}
        >
            {children}
        </motion.div>
    );
}
