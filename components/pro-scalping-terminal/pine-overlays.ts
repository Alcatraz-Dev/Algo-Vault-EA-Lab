/**
 * Pine study overlays — contract between the Pine runtime and the terminal
 * chart (leaf module).
 *
 * PineWorkspace executes the user's script with `executePine` against the
 * same real candles the chart displays and projects the runtime output into
 * this shape. The chart renders these overlays as-is; it never re-computes
 * the script, so what is drawn is exactly what the runtime produced from the
 * real market data. Colors are normalised here (Pine named colors → hex) so
 * the chart component stays a pure renderer.
 */

import type { PineExecutionResult } from "@/lib/pine-runtime";

/** One plotted line from the script, values aligned 1:1 with the candle array. */
export type PineStudyLine = {
    id: string;
    title: string;
    values: Array<number | null>;
    color: string;
    lineWidth: number;
};

/** One hline from the script, drawn as a horizontal price line. */
export type PineStudyLevel = {
    id: string;
    title: string;
    value: number;
    color: string;
};

/** One plotshape hit from the script, drawn as a chart marker. */
export type PineStudyShape = {
    id: string;
    title: string;
    /** Bar index the marker sits on (into the same candle array). */
    index: number;
    /** True → arrowUp below the bar; false → arrowDown above the bar. */
    bullish: boolean;
    color: string;
    text?: string;
};

export type PineStudyOverlay = {
    lines: PineStudyLine[];
    levels: PineStudyLevel[];
    shapes: PineStudyShape[];
    /** Whether the script declared `overlay=true`. Non-overlay scripts render in a stacked pane. */
    overlay: boolean;
    /** Runtime errors — surfaced by the workspace, not drawn on the chart. */
    errors: string[];
};

/** Pine's named color constants (lowercased) mapped onto chart-safe hexes. */
const PINE_NAMED_COLORS: Record<string, string> = {
    aqua: "#22d3ee",
    black: "#0f172a",
    blue: "#3b82f6",
    fuchsia: "#e879f9",
    gold: "#f59e0b",
    gray: "#6b7280",
    green: "#22c55e",
    grey: "#6b7280",
    lime: "#84cc16",
    maroon: "#be123c",
    navy: "#1e40af",
    olive: "#a3a635",
    orange: "#f97316",
    purple: "#a855f7",
    red: "#ef4444",
    silver: "#cbd5e1",
    teal: "#14b8a6",
    white: "#f8fafc",
    yellow: "#eab308",
};

/** Deterministic fallback palette for plots that do not declare a color. */
export const PINE_LINE_PALETTE = [
    "#22d3ee",
    "#f59e0b",
    "#a78bfa",
    "#34d399",
    "#f472b6",
    "#60a5fa",
    "#eab308",
    "#fb7185",
] as const;

export function pineLineFallbackColor(index: number): string {
    return PINE_LINE_PALETTE[index % PINE_LINE_PALETTE.length];
}

/** Map a Pine color (named constant or #hex string) onto a hex the chart can draw. */
export function pineColorToHex(color: string | undefined | null, fallback: string): string {
    if (!color) return fallback;
    const trimmed = color.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return trimmed;
    const named = PINE_NAMED_COLORS[trimmed.toLowerCase()];
    return named ?? fallback;
}

/**
 * Project a Pine runtime result into the chart overlay shape.
 *
 * `barCount` is the candle count the overlay will be drawn against; plotshape
 * hits beyond it cannot be placed and are dropped rather than mis-aligned.
 */
export function buildPineStudyOverlay(result: PineExecutionResult, barCount: number): PineStudyOverlay {
    const lines: PineStudyLine[] = result.plots
        .filter((p) => p.values.some((v) => v !== null && Number.isFinite(v)))
        .slice(0, 12)
        .map((p, i) => ({
            id: p.id,
            title: p.title,
            values: p.values.map((v) => (v !== null && Number.isFinite(v) ? (v as number) : null)),
            color: pineColorToHex(p.color, pineLineFallbackColor(i)),
            lineWidth: Math.min(Math.max(p.lineWidth ?? 1, 1), 4),
        }));

    const levels: PineStudyLevel[] = result.hlines
        .filter((h) => Number.isFinite(h.value))
        .slice(0, 8)
        .map((h) => ({
            id: h.id,
            title: h.title,
            value: h.value,
            color: pineColorToHex(h.color, "#94a3b8"),
        }));

    const shapes: PineStudyShape[] = [];
    for (const s of result.plotshapes) {
        // Pine draws shapes below the bar for bullish hits, above for bearish.
        const bullish = /up|bull/i.test(s.style) || s.location === "belowbar";
        for (let i = 0; i < s.values.length && i < barCount; i++) {
            if (!s.values[i]) continue;
            shapes.push({
                id: `${s.id}_${i}`,
                title: s.title,
                index: i,
                bullish,
                color: pineColorToHex(s.color, bullish ? "#34d399" : "#fb7185"),
                ...(s.text ? { text: s.text } : {}),
            });
        }
    }

    return {
        lines,
        levels,
        shapes: shapes.slice(0, 200),
        overlay: result.overlay,
        errors: result.errors,
    };
}
