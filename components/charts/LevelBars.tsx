"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type LevelBarItem = {
    id: string;
    /** Left-hand label (component name, price level, timeframe…). */
    label: ReactNode;
    /** Right-hand value shown at the end of the row (price, score, count…). */
    right?: ReactNode;
    /**
     * Magnitude driving the bar length. Compared against `max` — pass absolute
     * values for signed data and encode the sign in `colorVar` instead.
     */
    value: number;
    /** Data-viz colour for this bar (defaults to the first chart series token). */
    colorVar?: string;
    /** Optional second line under the label (state, last touch, sweep…). */
    hint?: ReactNode;
};

/**
 * LevelBars — animated horizontal bars for the dashboard widgets (liquidity
 * pools, score components, bias rows…).
 *
 * The bars grow from zero on first paint and ease to their new length on every
 * refresh, with a short per-row stagger so a panel reads as a wave rather than
 * a single block. Colours are chart-series variables: this is data
 * visualisation, not surface styling.
 */
export default function LevelBars({
    items,
    max,
    barClassName = "h-1.5",
    animate = true,
    staggerMs = 45,
}: {
    items: LevelBarItem[];
    /** Explicit upper bound; defaults to the largest item value. */
    max?: number;
    barClassName?: string;
    animate?: boolean;
    staggerMs?: number;
}) {
    const [mounted, setMounted] = useState(false);

    // Grow-in only when animation is on: the rAF callback keeps the setState
    // out of the effect body, and a non-animated list never starts at zero.
    useEffect(() => {
        if (!animate) return;
        const frame = requestAnimationFrame(() => setMounted(true));
        return () => cancelAnimationFrame(frame);
    }, [animate]);

    const bound =
        max ??
        items.reduce((peak, item) => (Number.isFinite(item.value) ? Math.max(peak, item.value) : peak), 0);

    return (
        <ul className="space-y-2.5">
            {items.map((item, index) => {
                const ratio = bound > 0 ? Math.min(1, Math.max(0, item.value) / bound) : 0;
                const waiting = animate && !mounted;
                const width = waiting ? 0 : Math.max(2, ratio * 100);
                return (
                    <li key={item.id} className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2 text-micro">
                            <span className="min-w-0 truncate font-medium text-foreground">{item.label}</span>
                            {item.right !== undefined ? (
                                <span className="font-numeric shrink-0 text-muted-foreground">{item.right}</span>
                            ) : null}
                        </div>
                        {item.hint !== undefined ? (
                            <p className="mt-0.5 truncate text-micro text-muted-foreground">{item.hint}</p>
                        ) : null}
                        <div className={cn("mt-1 w-full overflow-hidden rounded-full bg-muted", barClassName)}>
                            <div
                                className="h-full rounded-full transition-[width] duration-700 ease-out"
                                style={{
                                    width: `${width}%`,
                                    background: item.colorVar ?? "var(--chart-1)",
                                    transitionDelay: animate ? `${index * staggerMs}ms` : undefined,
                                }}
                            />
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
