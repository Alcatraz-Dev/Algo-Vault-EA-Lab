/**
 * Pure sizing logic behind <MeasuredResponsiveContainer>.
 *
 * Recharts' own ResponsiveContainer seeds its size detector with a `-1 × -1`
 * sentinel and warns ("The width(-1) and height(-1) of chart should be greater
 * than 0") whenever BOTH dimensions are percentage based, because it renders
 * the chart before the container has been measured. These helpers decide from
 * a measured container box and the caller's width/height props the exact pixel
 * size to hand to the chart — or `null` when no valid size exists yet, so the
 * chart is simply not rendered until the container is measurable.
 *
 * The dimension math mirrors recharts' `calculateChartDimensions` so the chart
 * receives exactly the size it would have computed itself once measured.
 */

/** A resolved, rounded, strictly positive chart size in CSS pixels. */
export type ChartSize = { width: number; height: number };

/** A measured container box. `undefined`/`null` = not measured yet. */
export type ContainerBox = { width: number; height: number } | null | undefined;

/** The size-affecting subset of the recharts ResponsiveContainer props. */
export type ChartSizeProps = {
    width?: number | string;
    height?: number | string;
    aspect?: number;
    maxHeight?: number;
};

function isPercent(value: number | string | undefined): boolean {
    return typeof value === "string" && value.trim().endsWith("%");
}

/**
 * Recharts defaults: with no usable height/width, both dimensions are "100%"
 * (percentage of the measured container).
 */
function normalizedDims(props: ChartSizeProps): { width?: number | string; height?: number | string } {
    let { width, height } = props;
    if (width === undefined && height === undefined) {
        width = "100%";
        height = "100%";
    } else if (width === undefined) {
        if (!(props.aspect && props.aspect > 0)) width = "100%";
    } else if (height === undefined) {
        if (!(props.aspect && props.aspect > 0)) height = "100%";
    }
    return { width, height };
}

/** A dimension is usable only when it is a finite, strictly positive number. */
function isUsableDimension(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Resolves the chart size for one measurement.
 *
 * Returns `null` — "do not render the chart yet" — when the container has not
 * been measured (`undefined`), or the measurement is unusable (0 × 0 from a
 * hidden panel, negative, NaN). Callers defer rendering until a size exists.
 */
export function resolveChartSize(
    container: ContainerBox,
    props: ChartSizeProps
): ChartSize | null {
    const { width, height } = normalizedDims(props);

    let calculatedWidth = isPercent(width) || width === undefined
        ? container?.width
        : Number(width);
    let calculatedHeight = isPercent(height) || height === undefined
        ? container?.height
        : Number(height);

    const aspect = props.aspect;
    if (aspect && aspect > 0) {
        if (calculatedWidth) {
            calculatedHeight = calculatedWidth / aspect;
        } else if (calculatedHeight) {
            calculatedWidth = calculatedHeight * aspect;
        }
        if (props.maxHeight && calculatedHeight != null && calculatedHeight > props.maxHeight) {
            calculatedHeight = props.maxHeight;
        }
    }

    if (!isUsableDimension(calculatedWidth) || !isUsableDimension(calculatedHeight)) {
        return null;
    }
    return { width: Math.round(calculatedWidth), height: Math.round(calculatedHeight) };
}

/**
 * State transition for the measured size.
 *
 * - an invalid measurement (hidden/unmeasurable container) always returns
 *   `null`, so the chart unmounts instead of rendering at a stale/invalid size;
 * - an unchanged measurement returns the previous reference so React can skip
 *   re-rendering the chart.
 */
export function nextChartSize(
    previous: ChartSize | null,
    container: ContainerBox,
    props: ChartSizeProps
): ChartSize | null {
    const next = resolveChartSize(container, props);
    if (next === null) return null;
    if (previous && previous.width === next.width && previous.height === next.height) {
        return previous;
    }
    return next;
}
