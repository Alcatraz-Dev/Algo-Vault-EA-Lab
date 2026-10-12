/**
 * Number formatting shared by the home-page charts.
 *
 * Everything that renders here is a recorded figure from `getHomeData`
 * (DESIGN.md §17) — these helpers only decide how it reads, never invent a
 * value. `font-numeric`/tabular figures are applied by the components.
 */

export function formatUsd(value: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(value);
}

export function formatSignedUsd(value: number): string {
    const sign = value >= 0 ? "+" : "-";
    return `${sign}${formatUsd(Math.abs(value))}`;
}

/** `$12.4k` / `-$1.2k` — for axis ticks where a full figure will not fit. */
export function formatCompactUsd(value: number): string {
    const sign = value < 0 ? "-" : "";
    const abs = Math.abs(value);
    if (abs >= 1000) return `${sign}$${Math.round(abs / 100) / 10}k`;
    return `${sign}${formatUsd(abs)}`;
}

export function formatPct(value: number, digits = 1): string {
    if (!Number.isFinite(value)) return "—";
    return `${value.toFixed(digits)}%`;
}
