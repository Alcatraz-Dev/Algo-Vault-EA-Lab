"use client";

import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";

/**
 * Shared ApexCharts wrapper for AlgoVault.
 *
 * - SSR-safe: apexcharts touches `window` at import time, so react-apexcharts
 *   loads only on the client (Next `dynamic` with `ssr: false`).
 * - Token-driven: every color resolves from the raw AlgoVault tokens
 *   (`--primary`, `--positive`, `--muted-foreground`, …) defined in
 *   `app/globals.css` for both `:root` (dark) and `.light` — so both
 *   themes apply with no chart-level branching.
 *   Never pass raw hex or Tailwind families here (DESIGN.md §2).
 * - Reduced motion is honoured by disabling chart animations when the
 *   media query matches.
 * - Directional semantics follow DESIGN.md §17: up/profit → positive,
 *   down/loss → negative, brand/selection → primary. Gold never encodes
 *   profit or direction.
 */
const ReactApexChart = dynamic(() => import("react-apexcharts"), {
    ssr: false,
    loading: () => <div className="skeleton h-52 w-full" aria-hidden />,
});

/** Base options every AlgoVault Apex chart spreads first, then overrides. */
export function apexBaseOptions(): ApexOptions {
    const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return {
        chart: {
            background: "transparent",
            foreColor: "var(--muted-foreground)",
            fontFamily: "inherit",
            toolbar: { show: false },
            zoom: { enabled: false },
            animations: { enabled: !reduceMotion },
        },
        grid: {
            borderColor: "var(--border-color)",
            strokeDashArray: 3,
        },
        dataLabels: { enabled: false },
        stroke: { width: 2 },
        xaxis: {
            axisBorder: { show: false },
            axisTicks: { show: false },
            labels: {
                style: {
                    colors: "var(--muted-foreground)",
                    fontSize: "12px",
                },
            },
        },
        yaxis: {
            labels: {
                style: {
                    colors: "var(--muted-foreground)",
                    fontSize: "12px",
                },
            },
        },
    };
}

type ApexChartProps = {
    /** Top-level chart type. Mixed charts (e.g. column + line) use the base
        type here ("line") with per-series `type` fields. */
    type: "area" | "bar" | "line" | "candlestick" | "donut" | "radialBar";
    series: ApexOptions["series"];
    options: ApexOptions;
    height?: number | string;
    /** Accessible name for the chart region. */
    label: string;
};

export default function ApexChart({ type, series, options, height = 208, label }: ApexChartProps) {
    return (
        <div role="img" aria-label={label}>
            <ReactApexChart type={type} series={series} options={options} height={height} />
        </div>
    );
}
