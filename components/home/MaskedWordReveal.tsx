"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface MaskedWordRevealProps {
    text: string;
    accentWord?: string;
    className?: string;
    accentClassName?: string;
    delay?: number;
    scrambleAccent?: boolean;
}

const EASE_CHARS = "01<>/\\|=+*#$%&";

export default function MaskedWordReveal({
    text,
    accentWord,
    className = "",
    accentClassName = "text-primary font-bold",
    delay = 100,
    scrambleAccent = true,
}: MaskedWordRevealProps) {
    // Initialize to false on both server and client so initial markup matches.
    // Reduced-motion preference is applied in an effect after hydration.
    const [isInView, setIsInView] = useState(false);
    const [scrambledAccent, setScrambledAccent] = useState(accentWord || "");
    const containerRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            setIsInView(true);
        }
        const el = containerRef.current;
        if (!el) return;

        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (prefersReducedMotion) return;

        const io = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setIsInView(true);
                    io.disconnect();
                }
            },
            { threshold: 0.15 }
        );

        io.observe(el);
        return () => io.disconnect();
    }, []);

    // Scramble effect matching Algory's scramble(span, ms) engine decode
    useEffect(() => {
        if (!isInView || !accentWord || !scrambleAccent) return;

        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (prefersReducedMotion) return;

        const final = accentWord;
        const n = final.length;
        let t0: number | null = null;
        const ms = 750;
        let raf = 0;

        const timeout = setTimeout(() => {
            const frame = (ts: number) => {
                if (t0 === null) t0 = ts;
                const p = Math.min(1, (ts - t0) / ms);
                const settled = Math.floor(p * n);
                let s = "";
                for (let i = 0; i < n; i++) {
                    const c = final[i];
                    s += (i < settled || c === " " || c === ".")
                        ? c
                        : EASE_CHARS[(Math.random() * EASE_CHARS.length) | 0];
                }
                setScrambledAccent(s);
                if (p < 1) {
                    raf = requestAnimationFrame(frame);
                } else {
                    setScrambledAccent(final);
                }
            };
            raf = requestAnimationFrame(frame);
        }, delay + 350);

        return () => {
            clearTimeout(timeout);
            cancelAnimationFrame(raf);
        };
    }, [isInView, accentWord, delay, scrambleAccent]);

    const words = text.split(" ");

    return (
        <span ref={containerRef} className={cn("inline-block", className)}>
            {words.map((word, i) => (
                <span
                    key={`${word}-${i}`}
                    className="inline-block overflow-hidden align-top leading-tight mr-[0.28em] last:mr-0"
                >
                    <span
                        className={cn(
                            "inline-block will-change-transform transition-transform duration-600 ease-[cubic-bezier(0.16,1,0.3,1)]",
                            isInView ? "translate-y-0 opacity-100" : "translate-y-[115%] opacity-0"
                        )}
                        style={{
                            transitionDelay: `${delay + i * 50}ms`,
                        }}
                    >
                        {word}
                    </span>
                </span>
            ))}
            {accentWord && (
                <span className="inline-block overflow-hidden align-top leading-tight">
                    <span
                        className={cn(
                            "inline-block will-change-transform transition-transform duration-600 ease-[cubic-bezier(0.16,1,0.3,1)]",
                            accentClassName,
                            isInView ? "translate-y-0 opacity-100" : "translate-y-[115%] opacity-0"
                        )}
                        style={{
                            transitionDelay: `${delay + words.length * 50}ms`,
                        }}
                    >
                        {scrambledAccent}
                    </span>
                </span>
            )}
        </span>
    );
}
