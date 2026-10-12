import type { ReactNode } from "react";
import { motion } from "motion/react";

/**
 * Reveal — scroll-driven entrance driven by motion/react `whileInView`.
 *
 * Fades + lifts children into view once they enter the viewport (16px lift,
 * 0.7s, cubic-bezier(0.22, 1, 0.36, 1)), same behaviour as the landing page
 * `components/home/Reveal.tsx` but moved into the layout layer so product
 * pages can use it without touching the marketing shell. Reduced motion is
 * honoured by the host page via the `prefers-reduced-motion` media query in
 * globals.css (the `.reveal` element is settled instantly), so server and
 * client markup stay identical.
 */
export default function Reveal({
  children,
  delay = 0,
  className = "",
  initial = true,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  /** Run the entrance on mount as well as on viewport entry. Defaults true. */
  initial?: boolean;
}) {
  return (
    <motion.div
      className={className}
      initial={initial ? { opacity: 0, y: 16 } : undefined}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] as const, delay: delay / 1000 }}
      viewport={{ once: true, amount: 0.12 }}
    >
      {children}
    </motion.div>
  );
}
