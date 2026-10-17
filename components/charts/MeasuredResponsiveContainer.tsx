"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import {
    nextChartSize,
    resolveChartSize,
    type ChartSize,
    type ChartSizeProps,
} from "./responsive-measure";

export type MeasuredResponsiveContainerProps = ChartSizeProps & {
    id?: string;
    className?: string;
    style?: React.CSSProperties;
    /** Defaults to 0 — 'auto' breaks flexbox sizing (recharts issue #172). */
    minWidth?: number | string;
    children: React.ReactNode;
};

/**
 * MeasuredResponsiveContainer — a drop-in replacement for recharts'
 * ResponsiveContainer for percentage-sized charts.
 *
 * Why: recharts' size detector starts at a `-1 × -1` sentinel, so any chart
 * with percentage width AND height renders before it has been measured and
 * trips recharts' own guard ("The width(-1) and height(-1) of chart should be
 * greater than 0"). This container measures its own box with a ResizeObserver
 * and only mounts the recharts container once a strictly positive size exists,
 * handing it that exact measured size (never a fabricated one).
 *
 * Behaviour is identical to the library's own deferral (its context provider
 * refuses non-positive sizes too) and it keeps recharts fully in charge of
 * drawing: hidden panels, collapsed tabs, dialogs and initial mounts all
 * recover automatically the moment the ResizeObserver reports a measurable box.
 */
export function MeasuredResponsiveContainer({
    width,
    height,
    aspect,
    maxHeight,
    minWidth = 0,
    id,
    className,
    style,
    children,
}: MeasuredResponsiveContainerProps) {
    const containerRef = React.useRef<HTMLDivElement | null>(null);

    // No measured box yet: a size is only known without measurement when the
    // caller fixed BOTH dimensions numerically.
    const [size, setSize] = React.useState<ChartSize | null>(() =>
        resolveChartSize(undefined, { width, height, aspect, maxHeight })
    );

    React.useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        // The effect only re-runs when the size-affecting props change, so the
        // closure always holds the current dimensions.
        const sizeProps: ChartSizeProps = { width, height, aspect, maxHeight };
        const measure = (box: { width: number; height: number }) => {
            setSize((previous) => nextChartSize(previous, box, sizeProps));
        };

        measure(element.getBoundingClientRect());

        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            measure({ width: entry.contentRect.width, height: entry.contentRect.height });
        });
        observer.observe(element);
        return () => observer.disconnect();
        // Re-measure whenever the size-affecting props change.
    }, [width, height, aspect, maxHeight]);

    return (
        <div
            id={id}
            ref={containerRef}
            className={cn("recharts-responsive-container", className)}
            style={{ width, height, minWidth, maxHeight, ...style }}
        >
            {size ? (
                <ResponsiveContainer width={size.width} height={size.height}>
                    {children}
                </ResponsiveContainer>
            ) : null}
        </div>
    );
}
