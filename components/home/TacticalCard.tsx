"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TacticalCardProps {
    children: ReactNode;
    className?: string;
    /** Direction of 3D entrance: -1 (left), 1 (right), or 0 (vertical drop) */
    dir?: -1 | 1 | 0;
    /** Whether to enable mouse spotlight border */
    spotlight?: boolean;
    /** Whether to enable subtle 3D hover tilt */
    tilt?: boolean;
    delay?: number;
}

export default function TacticalCard({
    children,
    className = "",
    dir = 0,
    spotlight = true,
    tilt = false,
    delay = 0,
}: TacticalCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    // Initialize to false on both server and client so initial markup matches.
    // Reduced-motion preference is applied in an effect after hydration.
    const [inView, setInView] = useState(false);

    useEffect(() => {
        // Check reduced motion
        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (prefersReducedMotion) {
            setInView(true);
            return;
        }
        const el = cardRef.current;
        if (!el) return;

        // Viewport observation matching Algory's line threshold
        const io = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setInView(true);
                    } else if (entry.boundingClientRect.top > 0) {
                        // Re-arms when scrolled back up above the viewport
                        setInView(false);
                    }
                });
            },
            { rootMargin: "0px 0px -12% 0px", threshold: 0 }
        );

        io.observe(el);
        return () => io.disconnect();
    }, []);

    // Pointer-aware spotlight tracking matching Algory's CSS variable setup
    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!spotlight && !tilt) return;
        const el = cardRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (spotlight) {
            el.style.setProperty("--mx", `${x}px`);
            el.style.setProperty("--my", `${y}px`);
        }

        if (tilt) {
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const rotateX = ((y - centerY) / centerY) * -4;
            const rotateY = ((x - centerX) / centerX) * 4;
            el.style.setProperty("--tilt-rx", `${rotateX}deg`);
            el.style.setProperty("--tilt-ry", `${rotateY}deg`);
        }
    };

    const handlePointerLeave = () => {
        const el = cardRef.current;
        if (!el) return;
        if (tilt) {
            el.style.setProperty("--tilt-rx", "0deg");
            el.style.setProperty("--tilt-ry", "0deg");
        }
    };

    return (
        <div
            ref={cardRef}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            style={{
                transitionDelay: `${delay}ms`,
            }}
            className={cn(
                "tactical-card group relative transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
                inView ? "tactical-in" : "tactical-out",
                dir === -1 && "tactical-dir-left",
                dir === 1 && "tactical-dir-right",
                dir === 0 && "tactical-dir-center",
                spotlight && "tactical-spotlight",
                tilt && "tactical-tilt",
                className
            )}
        >
            {children}
        </div>
    );
}
