/**
 * Pro Terminal indicator parameters — the schema behind the layer picker's
 * per-indicator settings.
 *
 * One declaration drives three surfaces so they can never drift apart:
 *
 *   • LayerPicker      — generates the inputs from the same specs (no bespoke
 *                        per-indicator form code, no fake controls)
 *   • ProTerminalChart — reads the resolved numbers as the indicator lengths /
 *                        multipliers / levels it feeds the core engines
 *   • IndicatorRenderer— reads the resolved colour / width when it creates and
 *                        updates the series
 *
 * Rules:
 *   • Every spec carries an explicit default, and the default is what the chart
 *     already rendered before settings existed (so an untouched workspace looks
 *     identical).
 *   • Only *identity* properties are configurable: the colour that tells one
 *     line from another, its width, and its numeric inputs. Semantic colours
 *     (bullish green / bearish red / support / resistance) are fixed and
 *     single-meaning per the design system, so layers whose colour encodes
 *     meaning expose no colour parameter at all.
 *   • Stored values are always coerced + clamped onto the spec, so a corrupt
 *     localStorage entry can never put the chart into an unrenderable state.
 *
 * Leaf module on purpose: no chart library, no market data, no math — safe for
 * the renderer to import (see tests/indicator-renderer-guard.test.ts).
 */

import type { ChartLayerId } from "./chart-layers";

// ── spec model ─────────────────────────────────────────────────────────────

export type IndicatorParamKind = "number" | "color" | "width";

export interface IndicatorParamSpec {
    key: string;
    /** Short label shown next to the input. */
    label: string;
    kind: IndicatorParamKind;
    default: number | string;
    /** Numeric kinds only. */
    min?: number;
    max?: number;
    step?: number;
    /** Unit suffix rendered after the input (e.g. "bars"). */
    unit?: string;
}

/** One layer's parameter set: spec key → value. */
export type IndicatorParams = Record<string, number | string>;

/** Per-layer overrides. A layer absent from the map uses the schema defaults. */
export type IndicatorSettings = Partial<Record<ChartLayerId, IndicatorParams>>;

// spec builders — keep the table below readable
const period = (def: number): IndicatorParamSpec => ({
    key: "period", label: "Length", kind: "number", default: def, min: 1, max: 500, step: 1, unit: "bars",
});
const num = (
    key: string, label: string, def: number, min: number, max: number, step = 1, unit?: string,
): IndicatorParamSpec => ({ key, label, kind: "number", default: def, min, max, step, unit });
const color = (key: string, label: string, def: string): IndicatorParamSpec => ({
    key, label, kind: "color", default: def,
});
const width = (def: number): IndicatorParamSpec => ({
    key: "lineWidth", label: "Width", kind: "width", default: def, min: 1, max: 3, step: 1,
});
const mult = (label = "Multiplier", def = 2): IndicatorParamSpec => num("mult", label, def, 0.5, 10, 0.1, "×");
const upper = (def: number): IndicatorParamSpec => num("upper", "Upper", def, 50, 100, 1);
const lower = (def: number): IndicatorParamSpec => num("lower", "Lower", def, 0, 50, 1);

/**
 * The indicator-parameter vocabulary.
 *
 * A layer with no entry here exposes no settings (its appearance is either
 * semantic or has no user-facing inputs) — the picker renders no gear for it.
 */
export const INDICATOR_PARAMS: Partial<Record<ChartLayerId, IndicatorParamSpec[]>> = {
    // ── price overlays ─────────────────────────────────────────────────────
    vwap: [color("color", "Colour", "#f59e0b"), width(1)],
    ema9: [period(9), color("color", "Colour", "#38bdf8"), width(1)],
    ema20: [period(20), color("color", "Colour", "#a78bfa"), width(1)],
    ema50: [period(50), color("color", "Colour", "#fb7185"), width(1)],
    ema200: [period(200), color("color", "Colour", "#f59e0b"), width(1)],
    sma20: [period(20), color("color", "Colour", "#94a3b8"), width(1)],
    sma50: [period(50), color("color", "Colour", "#22d3ee"), width(1)],
    sma200: [period(200), color("color", "Colour", "#60a5fa"), width(1)],
    wma: [period(20), color("color", "Colour", "#f472b6"), width(1)],
    bollingerBands: [period(20), num("mult", "Std dev", 2, 0.5, 10, 0.1, "×"), color("color", "Colour", "#60a5fa"), width(1)],
    keltnerChannels: [period(20), mult(), color("color", "Colour", "#f97316"), width(1)],
    donchianChannels: [period(20), color("color", "Colour", "#22d3ee"), width(1)],
    supertrend: [period(10), mult(), color("color", "Colour", "#f472b6"), width(2)],
    // The Ichimoku cloud's span colours encode bullish/bearish bias (semantic,
    // fixed); only the three lengths are user inputs.
    ichimokuCloud: [
        num("tenkan", "Tenkan", 9, 1, 200, 1, "bars"),
        num("kijun", "Kijun", 26, 1, 200, 1, "bars"),
        num("senkouB", "Senkou B", 52, 1, 400, 1, "bars"),
    ],

    // ── oscillator / volatility panes ──────────────────────────────────────
    rsiPane: [period(14), upper(70), lower(30), color("color", "RSI", "#c084fc"), width(1)],
    macdPane: [
        num("fast", "Fast", 12, 1, 100, 1, "bars"),
        num("slow", "Slow", 26, 2, 200, 1, "bars"),
        num("signal", "Signal", 9, 1, 100, 1, "bars"),
        color("color", "MACD", "#38bdf8"),
        color("signalColor", "Signal line", "#f59e0b"),
        width(1),
    ],
    stochasticPane: [
        num("kPeriod", "%K length", 14, 1, 200, 1, "bars"),
        num("kSmooth", "%K smooth", 3, 1, 50, 1, "bars"),
        num("dSmooth", "%D smooth", 3, 1, 50, 1, "bars"),
        upper(80),
        lower(20),
        color("kColor", "%K", "#38bdf8"),
        color("dColor", "%D", "#f59e0b"),
        width(1),
    ],
    atrPane: [period(14), color("color", "ATR", "#a78bfa"), width(1)],
    adxPane: [period(14), color("color", "ADX", "#38bdf8"), width(1)],
    // The Awesome Oscillator histogram is signed (green above zero, red below)
    // → semantic; only the two lengths are inputs.
    awesomeOscillator: [
        num("fast", "Fast", 5, 1, 100, 1, "bars"),
        num("slow", "Slow", 34, 2, 200, 1, "bars"),
    ],
    obvPane: [color("color", "OBV", "#a78bfa"), width(1)],
};

// ── spec lookup ────────────────────────────────────────────────────────────

export function indicatorParamSpecs(id: ChartLayerId): IndicatorParamSpec[] {
    return INDICATOR_PARAMS[id] ?? [];
}

/** True when the layer has user-facing settings (the picker shows a gear). */
export function hasIndicatorParams(id: ChartLayerId): boolean {
    return indicatorParamSpecs(id).length > 0;
}

function specOf(id: ChartLayerId, key: string): IndicatorParamSpec | undefined {
    return indicatorParamSpecs(id).find((s) => s.key === key);
}

// ── resolution (defaults + stored overrides, always valid) ─────────────────

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

/** Coerce one stored value onto its spec; invalid input falls back to default. */
function coerce(spec: IndicatorParamSpec, value: unknown): number | string {
    if (spec.kind === "color") {
        return typeof value === "string" && HEX_COLOR.test(value) ? value : (spec.default as string);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) return spec.default;
    const min = spec.min ?? -Infinity;
    const max = spec.max ?? Infinity;
    const step = spec.step && spec.step > 0 ? spec.step : 1;
    const clamped = Math.min(max, Math.max(min, value));
    // Snap onto the step grid, then drop float noise (2.3000000000000003).
    return Number((Math.round(clamped / step) * step).toFixed(4));
}

function resolveFromStored(id: ChartLayerId, stored?: IndicatorParams | null): IndicatorParams {
    const out: IndicatorParams = {};
    for (const spec of indicatorParamSpecs(id)) out[spec.key] = coerce(spec, stored?.[spec.key]);
    return out;
}

/** The layer's effective parameters: schema defaults + persisted overrides. */
export function resolveIndicatorParams(
    id: ChartLayerId,
    settings?: IndicatorSettings | null,
): IndicatorParams {
    return resolveFromStored(id, settings?.[id]);
}

/** Defaults for a layer, straight from the schema. */
export function defaultIndicatorParams(id: ChartLayerId): IndicatorParams {
    return resolveFromStored(id);
}

/** True when the user changed any value away from the schema default. */
export function isIndicatorCustomised(
    id: ChartLayerId,
    settings?: IndicatorSettings | null,
): boolean {
    const stored = settings?.[id];
    if (!stored) return false;
    return indicatorParamSpecs(id).some((spec) => coerce(spec, stored[spec.key]) !== spec.default);
}

/** Keep only the values that differ from the defaults (minimal storage). */
function overridesOf(id: ChartLayerId, params: IndicatorParams): IndicatorParams {
    const overrides: IndicatorParams = {};
    for (const spec of indicatorParamSpecs(id)) {
        if (params[spec.key] !== spec.default) overrides[spec.key] = params[spec.key];
    }
    return overrides;
}

/**
 * Set one parameter. A value that returns to the schema default is *dropped*
 * (so "reset" and "equals default" are the same state, and storage stays small).
 */
export function withIndicatorParam(
    settings: IndicatorSettings,
    id: ChartLayerId,
    key: string,
    value: number | string,
): IndicatorSettings {
    const spec = specOf(id, key);
    if (!spec) return settings;
    const next: IndicatorParams = { ...resolveFromStored(id, settings[id]), [key]: coerce(spec, value) };
    const overrides = overridesOf(id, next);
    const out: IndicatorSettings = { ...settings };
    if (Object.keys(overrides).length === 0) delete out[id];
    else out[id] = overrides;
    return out;
}

/** Forget every override for one layer → the schema defaults apply again. */
export function withoutIndicatorParams(
    settings: IndicatorSettings,
    id: ChartLayerId,
): IndicatorSettings {
    const out: IndicatorSettings = { ...settings };
    delete out[id];
    return out;
}

/**
 * Validate arbitrary (possibly corrupt) persisted input. Unknown layers and
 * unknown keys are dropped; every surviving value is clamped onto its spec.
 */
export function mergeIndicatorSettings(input: unknown): IndicatorSettings {
    if (!input || typeof input !== "object") return {};
    const out: IndicatorSettings = {};
    for (const [rawId, rawParams] of Object.entries(input as Record<string, unknown>)) {
        const id = rawId as ChartLayerId;
        if (!hasIndicatorParams(id)) continue;
        if (!rawParams || typeof rawParams !== "object") continue;
        const overrides = overridesOf(id, resolveFromStored(id, rawParams as IndicatorParams));
        if (Object.keys(overrides).length > 0) out[id] = overrides;
    }
    return out;
}

// ── read helpers for the chart / renderer ──────────────────────────────────

/** Read a resolved numeric parameter (already defaulted + clamped). */
export function paramNumber(
    params: IndicatorParams | undefined,
    key: string,
    fallback: number,
): number {
    const v = params?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Read a resolved colour parameter. */
export function paramColor(
    params: IndicatorParams | undefined,
    key: string,
    fallback: string,
): string {
    const v = params?.[key];
    return typeof v === "string" && HEX_COLOR.test(v) ? v : fallback;
}

/** Read a resolved line width, clamped to the renderable 1–3 range. */
export function paramWidth(
    params: IndicatorParams | undefined,
    key: string,
    fallback: 1 | 2 | 3,
): 1 | 2 | 3 {
    const v = params?.[key];
    if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
    return v <= 1 ? 1 : v <= 2 ? 2 : 3;
}

/**
 * A layer's display label with an edited length substituted in, so a chip can
 * never advertise a period the chart is not drawing ("EMA 50" → "EMA 55").
 * Labels without a trailing number (e.g. "WMA") are returned unchanged.
 */
export function indicatorLabel(
    id: ChartLayerId,
    label: string,
    settings?: IndicatorSettings | null,
): string {
    const spec = specOf(id, "period");
    if (!spec || typeof spec.default !== "number") return label;
    const value = paramNumber(resolveIndicatorParams(id, settings), "period", spec.default);
    if (value === spec.default) return label;
    return label.replace(/\d+\s*$/, String(value));
}

// ── colour helper ──────────────────────────────────────────────────────────

/**
 * Re-render a hex or rgba colour at a given opacity (percent). Used for the
 * lower-alpha companion lines a single colour parameter drives (band edges,
 * cloud spans) — the parameter stays one colour, the derivation stays visible.
 */
export function withAlpha(color: string, percent: number): string {
    const alpha = Math.min(100, Math.max(0, percent)) / 100;
    const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color.trim());
    if (hex) {
        const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(color.trim());
    if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha})`;
    return color;
}
