/**
 * RESPONSIVE CHART CONTAINER SUITE.
 *
 * Root-cause guard for the runtime warning:
 *   "The width(-1) and height(-1) of chart should be greater than 0"
 * emitted by recharts' ResponsiveContainer when a percentage-sized chart is
 * rendered before its container has been measured.
 *
 * 1. Control: raw recharts warns for percentage-sized containers (proves this
 *    harness detects the warning) and stays silent for fixed numeric sizes.
 * 2. resolveChartSize rejects every unusable measurement (unmeasured, 0×0
 *    hidden panel, -1 sentinel, NaN, negative) so the chart can be deferred.
 * 3. resolveChartSize resolves the exact pixel size from a measurable box.
 * 4. nextChartSize drives the full lifecycle: defer → recover on measurement →
 *    update on resize → defer again when the container stops being measurable.
 * 5. MeasuredResponsiveContainer renders no chart (and no warning) until a
 *    valid size exists, and renders immediately when both dimensions are fixed.
 */

import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { ResponsiveContainer } from "recharts";
import { MeasuredResponsiveContainer } from "@/components/charts/MeasuredResponsiveContainer";
import { nextChartSize, resolveChartSize, type ChartSize } from "@/components/charts/responsive-measure";

const s = createSuite("chart-responsive-container");

const MARKER = <div data-marker="chart-child" />;

/** Renders markup while capturing every console.warn the render produces. */
function captureWarnings(render: () => string): { html: string; warnings: string[] } {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]): void => {
        warnings.push(args.map(String).join(" "));
    };
    let html = "";
    try {
        html = render();
    } finally {
        console.warn = original;
    }
    return { html, warnings };
}

function hasSizeWarning(warnings: string[]): boolean {
    return warnings.some((w) => w.includes("of chart should be greater than 0"));
}

function runSuite(): boolean {
    s.section("1. Control: the warning is recharts' pre-measurement guard");
    const controlPercent = captureWarnings(() =>
        renderToString(<ResponsiveContainer width="100%" height="100%">{MARKER}</ResponsiveContainer>)
    );
    s.check(hasSizeWarning(controlPercent.warnings), "raw recharts with 100%/100% warns before measurement (control)");
    const controlNumeric = captureWarnings(() =>
        renderToString(<ResponsiveContainer width={400} height={200}>{MARKER}</ResponsiveContainer>)
    );
    s.check(!hasSizeWarning(controlNumeric.warnings), "raw recharts with two numeric dimensions does not warn");

    s.section("2. Unusable measurements yield no size (chart deferred)");
    const percent = { width: "100%", height: "100%" } as const;
    s.check(resolveChartSize(undefined, percent) === null, "container not measured yet -> no size");
    s.check(resolveChartSize(null, percent) === null, "null measurement -> no size");
    s.check(resolveChartSize({ width: 0, height: 0 }, percent) === null, "hidden/collapsed 0×0 container -> no size");
    s.check(resolveChartSize({ width: -1, height: -1 }, percent) === null, "recharts -1 sentinel -> no size");
    s.check(resolveChartSize({ width: Number.NaN, height: 400 }, percent) === null, "NaN width -> no size");
    s.check(resolveChartSize({ width: 800, height: 0 }, percent) === null, "one unusable dimension -> no size");
    s.check(resolveChartSize({ width: 800, height: -20 }, percent) === null, "negative height -> no size");

    s.section("3. A measurable container resolves to the chart's pixel size");
    const resolved = resolveChartSize({ width: 800.4, height: 400 }, percent);
    s.check(resolved?.width === 800 && resolved?.height === 400, "percent/percent resolves and rounds the measured box");
    const defaults = resolveChartSize({ width: 1024, height: 512 }, {});
    s.check(defaults?.width === 1024 && defaults?.height === 512, "omitted props default to the measured box (100%/100%)");
    const mixed = resolveChartSize({ width: 640, height: 0 }, { width: "100%", height: 300 });
    s.check(mixed?.width === 640 && mixed?.height === 300, "a fixed numeric height works even before the height is measurable");
    const fixedBoth = resolveChartSize(undefined, { width: 480, height: 240 });
    s.check(fixedBoth?.width === 480 && fixedBoth?.height === 240, "two fixed numeric dimensions need no measurement at all");
    const aspect = resolveChartSize({ width: 800, height: 400 }, { width: "100%", height: "100%", aspect: 2 });
    s.check(aspect?.width === 800 && aspect?.height === 400, "aspect ratio keeps deriving the height from the measured width");

    s.section("4. Lifecycle: defer, recover, resize, hide again");
    let current: ChartSize | null = resolveChartSize(undefined, percent);
    s.check(current === null, "initial render has no size -> chart deferred");
    current = nextChartSize(current, { width: -1, height: -1 }, percent);
    s.check(current === null, "sentinel measurement keeps the chart deferred");
    current = nextChartSize(current, { width: 0, height: 0 }, percent);
    s.check(current === null, "a hidden 0×0 container keeps the chart deferred");
    current = nextChartSize(current, { width: 1200, height: 600 }, percent);
    s.check(current?.width === 1200 && current?.height === 600, "recovers as soon as the container becomes measurable");
    const unchanged = nextChartSize(current, { width: 1200.2, height: 600 }, percent);
    s.check(unchanged === current, "an unchanged measurement reuses the reference (no chart re-render)");
    const resized = nextChartSize(current, { width: 640, height: 320 }, percent);
    s.check(resized?.width === 640 && resized?.height === 320, "a resize produces the new size");
    const hidden = nextChartSize(resized, { width: 0, height: 0 }, percent);
    s.check(hidden === null, "hiding the container defers the chart again instead of keeping a stale size");
    const reshown = nextChartSize(hidden, { width: 900, height: 450 }, percent);
    s.check(reshown?.width === 900 && reshown?.height === 450, "reopening a hidden panel renders the chart again");

    s.section("5. Component: no warning, deferred until measurable, immediate when fixed");
    const deferred = captureWarnings(() =>
        renderToString(
            <div style={{ width: 800, height: 400 }}>
                <MeasuredResponsiveContainer width="100%" height="100%">{MARKER}</MeasuredResponsiveContainer>
            </div>
        )
    );
    s.check(!hasSizeWarning(deferred.warnings), "percentage container emits no recharts size warning");
    s.check(!deferred.html.includes("chart-child"), "the chart is not rendered before a valid size exists");
    s.check(deferred.html.includes("recharts-responsive-container"), "the measuring wrapper still renders so layout is preserved");

    const fixed = captureWarnings(() =>
        renderToString(<MeasuredResponsiveContainer width={480} height={240}>{MARKER}</MeasuredResponsiveContainer>)
    );
    s.check(!hasSizeWarning(fixed.warnings), "fixed numeric container emits no warning");
    s.check(fixed.html.includes("chart-child"), "the chart renders immediately when both dimensions are known");

    return s.finish();
}

void (async (): Promise<void> => {
    const ok = runSuite();
    process.exit(ok ? 0 : 1);
})();
