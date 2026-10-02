/**
 * Order Flow settings + feature flags.
 *
 * Feature flags gate the whole feature (safe rollout): when
 * `orderFlow.enabled` is false every consumer must behave exactly as before
 * this feature existed. Per-feature flags gate individual capabilities.
 *
 * Settings are user-configurable calculation parameters. They live under
 * `users/{uid}/orderFlowSettings` in Firebase Realtime Database (client SDK,
 * same pattern as other user settings in this app) and are cached in
 * localStorage so charts render before the first auth/db round-trip.
 * No Firestore anywhere.
 */

// ── settings ────────────────────────────────────────────────────────────────

export interface OrderFlowSettings {
    /** Volume Profile value area percentage (default 70). */
    valueAreaPercent: number;
    /** Bin count target for volume profile. */
    profileBins: number;
    /** Price-level aggregation for footprint/profile bins (ticks per bin). */
    priceLevelAggregation: number;
    /** Imbalance ratio threshold (e.g. 3 = 3:1 dominance). */
    imbalanceThreshold: number;
    /** Consecutive levels that make an imbalance "stacked". */
    stackedImbalanceLevels: number;
    /** Absolute size for large-trade detection (provider units). */
    largeTradeAbsoluteThreshold: number;
    /** Percentile (0–1) of recent trade sizes for large trades. */
    largeTradePercentile: number;
    /** Rolling-average multiple for large-trade detection. */
    largeTradeRollingMultiple: number;
    /** Absorption sensitivity 0–1 (higher = more events, stricter evidence). */
    absorptionSensitivity: number;
    /** Exhaustion sensitivity 0–1. */
    exhaustionSensitivity: number;
    /** Resting size above which a level is a wall. */
    liquidityWallThreshold: number;
    /** Heatmap intensity 0–1 (renderer alpha scaling). */
    heatmapIntensity: number;
    /** How many historical L2 snapshots the heatmap keeps. */
    heatmapHistoryDepth: number;
    /** Footprint cell density per bar (target price levels per bar). */
    footprintDensity: number;
    /** Delta calculation mode where multiple valid modes exist. */
    deltaMode: "aggressor" | "tick-rule";
    /** GEX display options. */
    gexShowWalls: boolean;
    gexShowGammaFlip: boolean;
    gexExpirationsLimit: number;
    /** Chart-mode when footprint layer is on. */
    chartMode: "candles" | "footprint" | "hybrid";
}

export const DEFAULT_ORDER_FLOW_SETTINGS: OrderFlowSettings = {
    valueAreaPercent: 70,
    profileBins: 48,
    priceLevelAggregation: 1,
    imbalanceThreshold: 3,
    stackedImbalanceLevels: 3,
    largeTradeAbsoluteThreshold: 0,
    largeTradePercentile: 0.98,
    largeTradeRollingMultiple: 8,
    absorptionSensitivity: 0.5,
    exhaustionSensitivity: 0.5,
    liquidityWallThreshold: 0,
    heatmapIntensity: 0.5,
    heatmapHistoryDepth: 120,
    footprintDensity: 8,
    deltaMode: "aggressor",
    gexShowWalls: true,
    gexShowGammaFlip: true,
    gexExpirationsLimit: 3,
    chartMode: "candles",
};

/** Clamp helper with NaN/Infinity rejection. */
function clampNum(v: unknown, min: number, max: number, fallback: number): number {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function clampBool(v: unknown, fallback: boolean): boolean {
    return typeof v === "boolean" ? v : fallback;
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
    return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Sanitize any stored/partial settings object into a fully-valid
 * OrderFlowSettings. Malformed input never crashes consumers — it degrades to
 * defaults (fail-closed for values, fail-open for the object itself).
 */
export function sanitizeOrderFlowSettings(raw: unknown): OrderFlowSettings {
    const d = DEFAULT_ORDER_FLOW_SETTINGS;
    if (!raw || typeof raw !== "object") return { ...d };
    const r = raw as Record<string, unknown>;
    return {
        valueAreaPercent: clampNum(r.valueAreaPercent, 50, 95, d.valueAreaPercent),
        profileBins: Math.round(clampNum(r.profileBins, 8, 200, d.profileBins)),
        priceLevelAggregation: Math.max(1, Math.round(clampNum(r.priceLevelAggregation, 1, 1000, d.priceLevelAggregation))),
        imbalanceThreshold: clampNum(r.imbalanceThreshold, 1.2, 20, d.imbalanceThreshold),
        stackedImbalanceLevels: Math.round(clampNum(r.stackedImbalanceLevels, 2, 10, d.stackedImbalanceLevels)),
        largeTradeAbsoluteThreshold: Math.max(0, clampNum(r.largeTradeAbsoluteThreshold, 0, Number.MAX_SAFE_INTEGER, d.largeTradeAbsoluteThreshold)),
        largeTradePercentile: clampNum(r.largeTradePercentile, 0.5, 1, d.largeTradePercentile),
        largeTradeRollingMultiple: clampNum(r.largeTradeRollingMultiple, 2, 100, d.largeTradeRollingMultiple),
        absorptionSensitivity: clampNum(r.absorptionSensitivity, 0, 1, d.absorptionSensitivity),
        exhaustionSensitivity: clampNum(r.exhaustionSensitivity, 0, 1, d.exhaustionSensitivity),
        liquidityWallThreshold: Math.max(0, clampNum(r.liquidityWallThreshold, 0, Number.MAX_SAFE_INTEGER, d.liquidityWallThreshold)),
        heatmapIntensity: clampNum(r.heatmapIntensity, 0.05, 1, d.heatmapIntensity),
        heatmapHistoryDepth: Math.round(clampNum(r.heatmapHistoryDepth, 10, 1000, d.heatmapHistoryDepth)),
        footprintDensity: Math.round(clampNum(r.footprintDensity, 3, 40, d.footprintDensity)),
        deltaMode: pickEnum(r.deltaMode, ["aggressor", "tick-rule"] as const, d.deltaMode),
        gexShowWalls: clampBool(r.gexShowWalls, d.gexShowWalls),
        gexShowGammaFlip: clampBool(r.gexShowGammaFlip, d.gexShowGammaFlip),
        gexExpirationsLimit: Math.round(clampNum(r.gexExpirationsLimit, 1, 12, d.gexExpirationsLimit)),
        chartMode: pickEnum(r.chartMode, ["candles", "footprint", "hybrid"] as const, d.chartMode),
    };
}

/** Merge partial stored settings over defaults, sanitized. */
export function mergeOrderFlowSettings(partial: unknown): OrderFlowSettings {
    return sanitizeOrderFlowSettings({ ...DEFAULT_ORDER_FLOW_SETTINGS, ...(partial && typeof partial === "object" ? partial : {}) });
}

// ── feature flags ───────────────────────────────────────────────────────────

export interface OrderFlowFeatureFlags {
    "orderFlow.enabled": boolean;
    "orderFlow.volumeProfile": boolean;
    "orderFlow.delta": boolean;
    "orderFlow.footprint": boolean;
    "orderFlow.heatmap": boolean;
    "orderFlow.liquidity": boolean;
    "orderFlow.gex": boolean;
}

/**
 * Feature flags. Order of resolution:
 *   1. NEXT_PUBLIC_ORDER_FLOW_* env override (deploy-time rollout switch),
 *   2. default true (the feature ships on; disabling is the safe rollback).
 * `orderFlow.enabled=false` short-circuits everything downstream.
 */
function flagFromEnv(name: "ENABLED" | "VOLUME_PROFILE" | "DELTA" | "FOOTPRINT" | "HEATMAP" | "LIQUIDITY" | "GEX"): boolean | undefined {
    if (typeof process === "undefined") return undefined;
    const raw = process.env?.[`NEXT_PUBLIC_ORDER_FLOW_${name}`];
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
    return undefined;
}

export const ORDER_FLOW_FLAGS: OrderFlowFeatureFlags = {
    "orderFlow.enabled": flagFromEnv("ENABLED") ?? true,
    "orderFlow.volumeProfile": flagFromEnv("VOLUME_PROFILE") ?? true,
    "orderFlow.delta": flagFromEnv("DELTA") ?? true,
    "orderFlow.footprint": flagFromEnv("FOOTPRINT") ?? true,
    "orderFlow.heatmap": flagFromEnv("HEATMAP") ?? true,
    "orderFlow.liquidity": flagFromEnv("LIQUIDITY") ?? true,
    "orderFlow.gex": flagFromEnv("GEX") ?? true,
};

export function isOrderFlowEnabled(): boolean {
    return ORDER_FLOW_FLAGS["orderFlow.enabled"];
}

/**
 * Runtime gate helper: feature must be enabled AND the master flag on.
 * Consumers call this before rendering toggles/panels so a disabled rollout
 * leaves the UI byte-identical to pre-feature behavior.
 */
export function orderFlowGate(flag: keyof OrderFlowFeatureFlags): boolean {
    if (!ORDER_FLOW_FLAGS["orderFlow.enabled"]) return false;
    return ORDER_FLOW_FLAGS[flag];
}
