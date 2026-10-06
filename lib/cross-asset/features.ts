/**
 * AlgoVault — Point-in-time Cross-Asset Features for Research (Phase 16 §26).
 *
 * PURE. The Autonomous Research Engine needs deterministic features to test
 * hypotheses like "does XAUUSD momentum behave differently when USD strength
 * is elevated?" — this module produces exactly those features, using only
 * data ≤ `asOf` (§10). An LLM never writes a feature value.
 *
 * Every feature carries its definition, inputs, value (or null), timestamp and
 * limitations. A feature that cannot be computed returns `null` with a reason —
 * research must treat that as missing data, never as zero.
 *
 * Integration contract for the Research Engine:
 *   `buildResearchFeatures({ series, window, asOf, focusSymbol, pairSymbol })`
 *   is a pure function of historical data, safe to call inside a walk-forward
 *   loop because it truncates at every fold's `asOf`.
 */

import type { PriceSeries } from "@/lib/portfolio/correlation";
import { computeFactors, factorValue } from "./factors";
import { computeRelationship, truncateAt } from "./relationships";
import { toReturns } from "@/lib/portfolio/correlation";
import type { RelationshipWindow } from "./types";

export interface ResearchFeature {
    id: string;
    definition: string;
    value: number | null;
    unit: "ZSCORE" | "RETURNS" | "CORRELATION" | "RATIO";
    asOf: number;
    window: RelationshipWindow;
    inputs: string[];
    reason?: string;
    limitations: string[];
}

export interface BuildResearchFeaturesInput {
    series: Record<string, PriceSeries | null | undefined>;
    window: RelationshipWindow;
    /** Absolute cutoff — no bar after this timestamp is used (§10). */
    asOf: number;
    focusSymbol?: string;
    /** Counterparty for the focus pair correlation feature. */
    pairSymbol?: string;
}

function zScoreLast(series: PriceSeries, asOf: number, bars: number): { value: number | null; reason?: string } {
    const truncated = truncateAt(series, asOf);
    const { values } = toReturns(truncated, "log");
    const slice = values.slice(-bars);
    if (slice.length < 10) return { value: null, reason: `only ${slice.length} returns available (<10)` };
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / slice.length;
    if (variance === 0) return { value: null, reason: "zero variance — z-score undefined" };
    const z = mean / Math.sqrt(variance);
    return { value: Number.isFinite(z) ? Math.round(z * 100) / 100 : null };
}

/**
 * Deterministic feature set for one research question. Only data ≤ `asOf` is
 * read; running it twice with the same inputs yields identical values.
 */
export function buildResearchFeatures(input: BuildResearchFeaturesInput): ResearchFeature[] {
    const features: ResearchFeature[] = [];
    const limitations = [
        "Features are point-in-time measurements of past data — labels must never be derived from anything beyond `asOf` (§10).",
        "Null means 'not computable', never zero; research pipelines must skip null rows rather than impute them.",
    ];

    /* USD strength (derived factor, §14). */
    const { factors } = computeFactors({
        series: input.series,
        window: input.window,
        asOf: input.asOf,
        calculatedAt: input.asOf,
    });
    const usd = factors.find((f) => f.name === "USD_STRENGTH");
    features.push({
        id: "xasset.usd_strength",
        definition: usd?.definition ?? "Equal-weighted USD-leg FX return, z-scored.",
        value: usd && usd.status === "AVAILABLE" ? usd.value : null,
        unit: "ZSCORE",
        asOf: input.asOf,
        window: input.window,
        inputs: (usd?.inputs ?? []).filter((i) => i.used).map((i) => i.symbol),
        reason: usd && usd.status !== "AVAILABLE" ? usd.limitations[0] : undefined,
        limitations,
    });

    /* Equity momentum + crypto risk + dispersion from the same factor pass. */
    for (const [id, name] of [
        ["xasset.equity_momentum", "EQUITY_MOMENTUM"],
        ["xasset.crypto_risk", "CRYPTO_RISK"],
        ["xasset.volatility_dispersion", "VOLATILITY"],
    ] as const) {
        const f = factors.find((x) => x.name === name);
        features.push({
            id,
            definition: f?.definition ?? name,
            value: f && f.status === "AVAILABLE" ? f.value : null,
            unit: "ZSCORE",
            asOf: input.asOf,
            window: input.window,
            inputs: (f?.inputs ?? []).filter((i) => i.used).map((i) => i.symbol),
            reason: f && f.status !== "AVAILABLE" ? f.limitations[0] : undefined,
            limitations,
        });
    }

    /* Focus symbol return z-score. */
    if (input.focusSymbol) {
        const series = input.series[input.focusSymbol];
        if (series) {
            const z = zScoreLast(series, input.asOf, input.window.bars);
            features.push({
                id: `xasset.${input.focusSymbol.toLowerCase()}_return_z`,
                definition: `z-score of the last ${input.window.bars} log returns of ${input.focusSymbol}.`,
                value: z.value,
                unit: "ZSCORE",
                asOf: input.asOf,
                window: input.window,
                inputs: [input.focusSymbol],
                reason: z.reason,
                limitations,
            });
        }
    }

    /* Focus ↔ pair relationship coefficient. */
    if (input.focusSymbol && input.pairSymbol) {
        const a = input.series[input.focusSymbol];
        const b = input.series[input.pairSymbol];
        if (a && b) {
            const rel = computeRelationship({
                a,
                b,
                window: input.window,
                asOf: input.asOf,
                calculatedAt: input.asOf,
            });
            features.push({
                id: `xasset.rho.${input.focusSymbol.toLowerCase()}.${input.pairSymbol.toLowerCase()}`,
                definition: `Rolling ${rel.method} correlation of ${input.focusSymbol} ↔ ${input.pairSymbol} over ${input.window.bars} ${input.window.timeframe} bars ending at asOf.`,
                value: rel.coefficient,
                unit: "CORRELATION",
                asOf: input.asOf,
                window: input.window,
                inputs: [input.focusSymbol, input.pairSymbol],
                reason: rel.coefficient === null ? rel.dataQuality.reason : undefined,
                limitations: [...limitations, ...rel.limitations],
            });
        }
    }

    /* Mean |ρ| across all measured pairs — a regime-style aggregate. */
    const measurable = Object.entries(input.series).filter(([, s]) => Boolean(s)) as Array<[string, PriceSeries]>;
    const coeffs: number[] = [];
    for (let i = 0; i < measurable.length; i += 1) {
        for (let j = i + 1; j < measurable.length; j += 1) {
            const rel = computeRelationship({
                a: measurable[i][1],
                b: measurable[j][1],
                window: input.window,
                asOf: input.asOf,
                calculatedAt: input.asOf,
            });
            if (rel.coefficient !== null) coeffs.push(Math.abs(rel.coefficient));
        }
    }
    const meanAbs = coeffs.length > 0 ? coeffs.reduce((a, b) => a + b, 0) / coeffs.length : null;
    features.push({
        id: "xasset.mean_abs_correlation",
        definition: `Mean |ρ| across every measured pair in the universe (window ${input.window.bars} ${input.window.timeframe}).`,
        value: meanAbs === null ? null : Math.round(meanAbs * 10_000) / 10_000,
        unit: "CORRELATION",
        asOf: input.asOf,
        window: input.window,
        inputs: measurable.map(([s]) => s),
        reason: meanAbs === null ? "no pair produced a coefficient" : undefined,
        limitations,
    });

    return features;
}

/** Convenience: feature map keyed by id (research pipelines prefer maps). */
export function featureMap(features: ResearchFeature[]): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const f of features) out[f.id] = f.value;
    return out;
}

export { factorValue };
