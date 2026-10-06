/**
 * AlgoVault — Market Factors (Phase 16 §13, §14).
 *
 * PURE + DETERMINISTIC. Every factor is either OBSERVED (a direct measurement)
 * or DERIVED (a declared, weighted construction over real inputs). There are no
 * mysterious "AI factor scores": each factor exposes its definition, formula,
 * inputs, weights, timestamp, confidence and limitations, and it reports
 * INSUFFICIENT_DATA instead of guessing when the required inputs are missing.
 *
 * ANTI-LOOKAHEAD (§10): every input series is truncated at `asOf` before any
 * return is computed, so a factor at time t can only use data ≤ t.
 *
 * DERIVED factors print their derivation (§14):
 *
 *   USD_STRENGTH       z( mean over pairs of  s_i · r_i )   s = +1 if USD is
 *                        the base currency, −1 if USD is the quote currency
 *   EQUITY_MOMENTUM    z( mean of index log returns )
 *   CRYPTO_RISK        z( mean of crypto log returns )
 *   COMMODITY_STRENGTH z( mean of metals log returns )
 *   RISK_APPETITE      z( mean of equity + crypto log returns )
 *   VOLATILITY         cross-sectional dispersion of window returns
 *
 *   z(x) = mean(x) / std(x) over the window (unit-free, sign preserved).
 *   Inputs are equal-weighted (weight = 1 / declared inputs) unless printed
 *   otherwise. Inputs are intersected by timestamp — a missing pair removes
 *   that observation for everyone rather than shifting the sample.
 */

import { toReturns, type PriceSeries } from "@/lib/portfolio/correlation";
import type { Evidence, FactorInput, MarketFactor, RelationshipWindow } from "./types";
import { factorNodeId, instrumentNodeId } from "./ids";
import { truncateAt } from "./relationships";
import { FACTOR_ENGINE_VERSION } from "./versions";

/** Minimum inputs a factor needs before it reports a value (§13). */
export const MIN_FACTOR_INPUTS: Record<string, number> = {
    USD_STRENGTH: 3,
    EQUITY_MOMENTUM: 1,
    CRYPTO_RISK: 1,
    COMMODITY_STRENGTH: 1,
    RISK_APPETITE: 2,
    VOLATILITY: 3,
};

/** Declared input universe per factor (symbols the registry may know). */
export const FACTOR_UNIVERSE: Record<string, string[]> = {
    USD_STRENGTH: ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD"],
    EQUITY_MOMENTUM: ["SPX500", "US30", "NAS100"],
    CRYPTO_RISK: ["BTCUSD", "ETHUSD"],
    COMMODITY_STRENGTH: ["XAUUSD", "XAGUSD"],
    RISK_APPETITE: ["SPX500", "US30", "NAS100", "BTCUSD", "ETHUSD"],
    VOLATILITY: ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "SPX500", "US30", "NAS100", "BTCUSD", "ETHUSD"],
};

interface FactorDefinition {
    name: string;
    definition: string;
    formula: string;
    universe: string[];
    minInputs: number;
    /** Extra requirement evaluated after inputs are resolved. */
    requiresGroups?: string[][];
    /** Per-input sign applied to its returns before averaging. */
    signOf?: (symbol: string) => number;
    /** Use cross-sectional dispersion instead of the time-series mean. */
    dispersion?: boolean;
    unit: MarketFactor["unit"];
}

const DEFINITIONS: FactorDefinition[] = [
    {
        name: "USD_STRENGTH",
        definition: "Equal-weighted USD-leg return of the available USD-quoted FX pairs, normalised.",
        formula: "z( mean_i( s_i · logReturn(pair_i) ) ), s = +1 if USD is base else −1",
        universe: FACTOR_UNIVERSE.USD_STRENGTH,
        minInputs: MIN_FACTOR_INPUTS.USD_STRENGTH,
        signOf: (symbol) => (symbol.startsWith("USD") ? 1 : -1),
        unit: "ZSCORE",
    },
    {
        name: "EQUITY_MOMENTUM",
        definition: "Equal-weighted log return of the available equity indices over the window.",
        formula: "z( mean_i( logReturn(index_i) ) )",
        universe: FACTOR_UNIVERSE.EQUITY_MOMENTUM,
        minInputs: MIN_FACTOR_INPUTS.EQUITY_MOMENTUM,
        unit: "ZSCORE",
    },
    {
        name: "CRYPTO_RISK",
        definition: "Equal-weighted log return of the available crypto instruments over the window.",
        formula: "z( mean_i( logReturn(crypto_i) ) )",
        universe: FACTOR_UNIVERSE.CRYPTO_RISK,
        minInputs: MIN_FACTOR_INPUTS.CRYPTO_RISK,
        unit: "ZSCORE",
    },
    {
        name: "COMMODITY_STRENGTH",
        definition: "Equal-weighted log return of the available precious metals over the window.",
        formula: "z( mean_i( logReturn(metal_i) ) )",
        universe: FACTOR_UNIVERSE.COMMODITY_STRENGTH,
        minInputs: MIN_FACTOR_INPUTS.COMMODITY_STRENGTH,
        unit: "ZSCORE",
    },
    {
        name: "RISK_APPETITE",
        definition: "Equal-weighted log return across equity indices AND crypto together (both groups required).",
        formula: "z( mean( logReturn(equity ∪ crypto) ) )",
        universe: FACTOR_UNIVERSE.RISK_APPETITE,
        minInputs: MIN_FACTOR_INPUTS.RISK_APPETITE,
        requiresGroups: [
            ["SPX500", "US30", "NAS100"],
            ["BTCUSD", "ETHUSD"],
        ],
        unit: "ZSCORE",
    },
    {
        name: "VOLATILITY",
        definition: "Cross-sectional dispersion of window returns across the available market universe.",
        formula: "z( crossSectionalStd( logReturn_t(symbol) ) ) over t in window",
        universe: FACTOR_UNIVERSE.VOLATILITY,
        minInputs: MIN_FACTOR_INPUTS.VOLATILITY,
        dispersion: true,
        unit: "ZSCORE",
    },
];

/* ── small deterministic stats ────────────────────────────────────────────── */

function mean(values: number[]): number {
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function std(values: number[]): number {
    if (values.length < 2) return 0;
    const m = mean(values);
    return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length);
}

function zScore(values: number[]): number | null {
    if (values.length < 3) return null;
    const s = std(values);
    if (s === 0) return null;
    const v = mean(values) / s;
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

/** Minimum aligned returns one input must contribute to be usable. */
export const MIN_OBS_PER_INPUT = 10;

/* ── Input resolution ─────────────────────────────────────────────────────── */

export interface ComputeFactorsInput {
    series: Record<string, PriceSeries | null | undefined>;
    window: RelationshipWindow;
    /** Absolute cutoff — no bar after this timestamp may be used (§10). */
    asOf: number;
    calculatedAt: number;
}

interface ResolvedInput {
    symbol: string;
    /** timestamp → signed log return for the window. */
    returns: Map<number, number>;
}

function windowReturns(
    series: PriceSeries,
    asOf: number,
    bars: number,
    sign: number
): Map<number, number> {
    const truncated = truncateAt(series, asOf);
    const { timestamps, values } = toReturns(truncated, "log");
    const out = new Map<number, number>();
    const start = Math.max(0, values.length - bars);
    for (let i = start; i < values.length; i += 1) {
        out.set(timestamps[i], values[i] * sign);
    }
    return out;
}

/** Timestamps present in EVERY resolved input (strict intersection, §45). */
function intersectTimestamps(inputs: ResolvedInput[]): number[] {
    if (inputs.length === 0) return [];
    let common = new Set(inputs[0].returns.keys());
    for (let i = 1; i < inputs.length; i += 1) {
        const next = new Set(inputs[i].returns.keys());
        common = new Set(Array.from(common).filter((t) => next.has(t)));
    }
    return Array.from(common).sort((a, b) => a - b);
}

/* ── Factor computation ───────────────────────────────────────────────────── */

export function computeFactors(input: ComputeFactorsInput): {
    factors: MarketFactor[];
    limitations: string[];
} {
    const factors: MarketFactor[] = [];
    const globalLimitations: string[] = [
        "Factors are deterministic constructions over past returns — they are context, not signals (§13, §57).",
        `Engine ${FACTOR_ENGINE_VERSION}; every input truncated at ${new Date(input.asOf).toISOString()} (§10).`,
    ];

    for (const def of DEFINITIONS) {
        const declared: FactorInput[] = def.universe.map((symbol) => ({
            nodeId: instrumentNodeId(symbol),
            symbol,
            weight: Math.round((1 / def.universe.length) * 10_000) / 10_000,
            used: false,
        }));

        const resolved: ResolvedInput[] = [];
        for (const symbol of def.universe) {
            const series = input.series[symbol];
            if (!series || series.closes.length < 3) continue;
            const sign = def.signOf ? def.signOf(symbol) : 1;
            const returns = windowReturns(series, input.asOf, input.window.bars, sign);
            if (returns.size < MIN_OBS_PER_INPUT) continue;
            resolved.push({ symbol, returns });
            const entry = declared.find((d) => d.symbol === symbol);
            if (entry) entry.used = true;
        }

        const missing: string[] = [];
        const used = declared.filter((d) => d.used).map((d) => d.symbol);
        let groupSatisfied = true;
        if (def.requiresGroups) {
            for (const group of def.requiresGroups) {
                const hit = group.filter((s) => used.includes(s));
                if (hit.length === 0) {
                    groupSatisfied = false;
                    missing.push(`group[${group.join("/")}]`);
                }
            }
        }

        const evidence: Evidence[] = [];
        const limitations: string[] = [];
        let dataTimestamp = 0;
        for (const r of resolved) {
            for (const t of r.returns.keys()) if (t > dataTimestamp) dataTimestamp = t;
        }

        const satisfied = resolved.length >= def.minInputs && groupSatisfied;
        let value: number | null = null;
        let status: MarketFactor["status"] = "AVAILABLE";

        if (!satisfied) {
            status = "INSUFFICIENT_DATA";
            const absent = declared.filter((d) => !d.used).map((d) => d.symbol);
            limitations.push(
                resolved.length < def.minInputs
                    ? `${resolved.length}/${def.minInputs} required inputs available (missing: ${absent.join(", ") || "none"}).`
                    : `Required input group missing: ${missing.join(", ")}.`
            );
            evidence.push({
                id: `ev:factor-na:${def.name}`,
                kind: "OBSERVED",
                source: "factor:inputs",
                text: `${def.name} not computed — insufficient inputs (${resolved.length} of ${def.minInputs} minimum).`,
            });
        } else {
            const stamps = intersectTimestamps(resolved);
            if (stamps.length < 3) {
                status = "INSUFFICIENT_DATA";
                limitations.push(
                    `Only ${stamps.length} aligned timestamp(s) across inputs — a factor needs at least 3.`
                );
            } else {
                let seriesValues: number[];
                if (def.dispersion) {
                    seriesValues = stamps.map((t) => {
                        const cross = resolved.map((r) => r.returns.get(t) as number);
                        return std(cross);
                    });
                } else {
                    seriesValues = stamps.map((t) => mean(resolved.map((r) => r.returns.get(t) as number)));
                }
                value = zScore(seriesValues);
                if (value === null) {
                    status = "INSUFFICIENT_DATA";
                    limitations.push("Window variance is zero — a z-score is undefined and is not reported.");
                }
            }

            evidence.push({
                id: `ev:factor-inputs:${def.name}`,
                kind: "OBSERVED",
                source: "factor:inputs",
                text: `${def.name} inputs: ${used.join(", ")} (${used.length}/${declared.length} declared).`,
                dataTimestamp,
            });
            evidence.push({
                id: `ev:factor-calc:${def.name}`,
                kind: "CALCULATED",
                source: "factor:derive",
                text: `${def.name} = ${value === null ? "not computable" : value} using ${def.formula} over ${input.window.bars} ${input.window.timeframe} bars.`,
                value: value ?? undefined,
                dataTimestamp,
            });
            evidence.push({
                id: `ev:factor-config:${def.name}`,
                kind: "CONFIGURED",
                source: "factor:weights",
                text: `Weights are equal (1/${declared.length} per declared input); inputs missing from the universe are excluded, never imputed.`,
            });
        }

        const confidence = Math.round((used.length / declared.length) * 100) / 100;

        factors.push({
            id: factorNodeId(def.name),
            name: def.name,
            kind: "DERIVED",
            status,
            definition: def.definition,
            formula: def.formula,
            inputs: declared,
            value,
            unit: def.unit,
            window: { ...input.window },
            timestamp: input.calculatedAt,
            dataTimestamp,
            confidence,
            evidence,
            limitations: [...limitations, ...globalLimitations],
        });
    }

    return { factors, limitations: globalLimitations };
}

/** Factor lookup by name for consumers (regime, context, UI). */
export function factorValue(factors: MarketFactor[], name: string): number | null {
    const f = factors.find((x) => x.name === name);
    return f && f.status === "AVAILABLE" ? f.value : null;
}
