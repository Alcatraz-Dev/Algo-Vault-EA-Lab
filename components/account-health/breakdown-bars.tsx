"use client";

/**
 * Score-breakdown bars.
 *
 * ── What the bars mean ────────────────────────────────────────────────────────
 * Each row is a *penalty* except `pnl` and `signalQuality`, which are credits.
 * Showing them all as "filled = good" bars was actively misleading — a full
 * Drawdown bar meant a 30-point deduction, not a good result. Each row is now
 * labelled with what it costs or earns, and the credit rows are drawn in the
 * opposite direction with a distinct treatment.
 *
 * ── Animation ─────────────────────────────────────────────────────────────────
 * Bars grow from zero on mount, staggered so the chart reads top-to-bottom
 * rather than appearing all at once. Refreshing re-runs the sweep. Respects
 * `prefers-reduced-motion`.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./motion";
import type { AccountHealthReport } from "@/lib/account-health/types";

interface Row {
    key: keyof AccountHealthReport["breakdown"];
    label: string;
    max: number;
    /** True when a full bar is a bad outcome. */
    penalty: boolean;
    fill: string;
}

const ROWS: Row[] = [
    { key: "drawdown", label: "Drawdown", max: 30, penalty: true, fill: "bg-rose-500" },
    { key: "margin", label: "Margin usage", max: 20, penalty: true, fill: "bg-amber-500" },
    { key: "exposure", label: "Exposure", max: 25, penalty: true, fill: "bg-blue-500" },
    { key: "pnl", label: "Open P/L", max: 10, penalty: false, fill: "bg-emerald-500" },
    { key: "signalQuality", label: "Signal quality", max: 15, penalty: false, fill: "bg-violet-500" },
];

export function BreakdownBars({
    breakdown,
    hasData = true,
    className,
}: {
    breakdown: AccountHealthReport["breakdown"];
    hasData?: boolean;
    className?: string;
}) {
    const reduced = useReducedMotion();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        // Next frame, so the browser has a zero-width start to animate from.
        // The callback is asynchronous, so this does not cascade a render.
        // Under reduced motion the transition is "none" in the style below, so
        // the same path simply lands on the final width immediately.
        const id = requestAnimationFrame(() => setMounted(true));
        return () => cancelAnimationFrame(id);
    }, []);

    return (
        <div className={cn("space-y-2.5", className)}>
            {ROWS.map((row, i) => {
                const value = hasData ? (breakdown[row.key] || 0) : 0;
                const pct = Math.min(100, (value / row.max) * 100);
                return (
                    <div key={row.key}>
                        <div className="flex items-baseline justify-between text-[10px]">
                            <span className="text-muted-foreground">
                                {row.label}
                                <span className="ml-1 text-[9px] opacity-60">
                                    {row.penalty ? "−" : "+"}
                                </span>
                            </span>
                            <span className="font-mono tabular-nums text-muted-foreground">
                                {value}<span className="opacity-50">/{row.max}</span>
                            </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/20">
                            <div
                                className={cn(
                                    "h-full rounded-full",
                                    row.fill,
                                    // Credits read as a gain only when earned.
                                    !row.penalty && value === 0 && "opacity-30",
                                )}
                                style={{
                                    width: mounted ? `${pct}%` : "0%",
                                    transition: reduced
                                        ? "none"
                                        : `width 700ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 70}ms`,
                                }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
