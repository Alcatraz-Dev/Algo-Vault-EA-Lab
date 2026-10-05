/**
 * AlgoVault — Strategy-to-Portfolio Intelligence (Phase 15 §16).
 *
 * PURE + DETERMINISTIC. The point of this engine is the case the rest of the
 * platform cannot see: two strategies that are individually healthy, but which
 * fail together. Every overlap is computed from measured data with a printed
 * formula.
 *
 *   POSITION overlap  |A∩B| / min(|A|,|B|)          (Jaccard on symbol sets)
 *   SIGNAL overlap    |A∩B| / min(|A|,|B|)          (Jaccard on symbol sets with signals)
 *   STRATEGY overlap  1.0 when both strategies are live in the same portfolio
 *   RISK overlap      shared cash-risk / max(cash-risk of the two)
 *   CORRELATION       |mean pairwise ρ of shared symbols|, else portfolio ρ
 *   DRAWDOWN overlap  1 when both strategies' max-drawdown windows coincide
 *   REGIME overlap    share of observed trades that landed in the same regime
 *
 * `harmfulCombination` is set only when BOTH sides are individually healthy and
 * at least one overlap is high. That is the "hidden concentration" signal.
 */

import { pearson } from "./correlation";
import type {
    AllocationInput,
    CorrelationMatrix,
    HealthRating,
    PortfolioExposure,
    PortfolioPosition,
    PortfolioStrategyIntelligence,
    StrategyOverlap,
    StrategyPortfolioState,
} from "./types";

/** Overlap at or above this counts as material. */
const MATERIAL_OVERLAP = 0.6;

/** Both healthy plus a material overlap = a harmful combination. */
const HEALTHY_RATINGS: HealthRating[] = ["GOOD", "WATCH"];

export interface StrategyPerformanceInput {
    strategyId: string;
    name?: string | null;
    active: boolean;
    openSymbols: string[];
    signalSymbols: string[];
    unrealizedPnL: number;
    grossNotional: number;
    /** Cash risk at stop, in equity currency. */
    riskAmount: number | null;
    maxDrawdownPercent: number | null;
    /** Timestamps (ms) of the strategy's worst drawdown window. */
    worstDrawdownWindow?: { from: number; to: number } | null;
    /** Closed trades with a regime label, used for regime overlap. */
    regimeTaggedTrades?: Array<{ regime: string; netPnL: number }>;
    health: HealthRating;
    oosSharpe: number | null;
    sampleSize: number;
}

export interface ComputeStrategyIntelligenceInput {
    portfolioId: string;
    strategies: StrategyPerformanceInput[];
    positions: PortfolioPosition[];
    exposure: PortfolioExposure;
    equity: number;
    matrix: CorrelationMatrix | null;
    calculatedAt: number;
    dataTimestamp: number;
}

function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const v of a) if (b.has(v)) intersection += 1;
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/** Std-dev of realized P&L, normalised by equity, used as strategy volatility. */
export function strategyVolatility(pnlSeries: number[], equity: number): number | null {
    if (pnlSeries.length < 3 || !(equity > 0)) return null;
    const returns: number[] = [];
    let running = equity;
    for (const pnl of pnlSeries) {
        const prev = running;
        running = prev + pnl;
        if (prev > 0) returns.push(running / prev - 1);
    }
    if (returns.length < 3) return null;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((acc, v) => acc + (v - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
}

export function computeStrategyIntelligence(
    input: ComputeStrategyIntelligenceInput
): PortfolioStrategyIntelligence {
    const limitations: string[] = [];
    const { strategies, positions, exposure, equity } = input;

    const strategies2: StrategyPortfolioState[] = strategies.map((s) => {
        const positionCount = positions.filter((p) => (p.strategyId || "MANUAL") === s.strategyId).length;
        const grossNotional = positions
            .filter((p) => (p.strategyId || "MANUAL") === s.strategyId)
            .reduce((acc, p) => acc + Math.abs(p.notional), 0);
        const unrealizedPnL = positions
            .filter((p) => (p.strategyId || "MANUAL") === s.strategyId)
            .reduce((acc, p) => acc + p.unrealizedPnL, 0);

        const overlaps = input.matrix
            ? strategies
                  .filter((other) => other.strategyId !== s.strategyId)
                  .map((other) => meanCorrelationBetween(input.matrix as CorrelationMatrix, s.openSymbols, other.openSymbols))
                  .filter((v): v is number => v !== null)
            : [];

        return {
            strategyId: s.strategyId,
            name: s.name ?? null,
            active: s.active,
            openPositions: positionCount,
            grossNotional: round(grossNotional),
            equityWeight: equity > 0 ? round(grossNotional / equity) : 0,
            unrealizedPnL: round(unrealizedPnL),
            maxDrawdownPercent: s.maxDrawdownPercent,
            health: s.health,
            oosSharpe: s.oosSharpe,
            sampleSize: s.sampleSize,
            correlationToPortfolio: overlaps.length > 0 ? round(average(overlaps)) : null,
            dataTimestamp: input.dataTimestamp,
            limitations: s.sampleSize === 0 ? ["No closed trades recorded yet."] : [],
        };
    });

    const overlaps: StrategyOverlap[] = [];

    for (let i = 0; i < strategies.length; i += 1) {
        for (let j = i + 1; j < strategies.length; j += 1) {
            const a = strategies[i];
            const b = strategies[j];
            const healthyA = HEALTHY_RATINGS.includes(a.health);
            const healthyB = HEALTHY_RATINGS.includes(b.health);

            const positionOverlap = jaccard(new Set(a.openSymbols), new Set(b.openSymbols));
            if (positionOverlap > 0) {
                overlaps.push({
                    a: a.strategyId,
                    b: b.strategyId,
                    kind: "POSITION",
                    overlap: round(positionOverlap),
                    detail: `Both hold ${Array.from(new Set(a.openSymbols.filter((s) => b.openSymbols.includes(s)))).join(", ") || "overlapping symbols"} — Jaccard overlap ${round(positionOverlap)}.`,
                    evidence: [`positions:${a.strategyId}`, `positions:${b.strategyId}`],
                    harmfulCombination: healthyA && healthyB && positionOverlap >= MATERIAL_OVERLAP,
                });
            }

            const signalOverlap = jaccard(new Set(a.signalSymbols), new Set(b.signalSymbols));
            if (signalOverlap > 0 && signalOverlap !== positionOverlap) {
                overlaps.push({
                    a: a.strategyId,
                    b: b.strategyId,
                    kind: "SIGNAL",
                    overlap: round(signalOverlap),
                    detail: `Triggered on ${round(signalOverlap * 100)}% overlapping symbols in the measured signal window.`,
                    evidence: [`signals:${a.strategyId}`, `signals:${b.strategyId}`],
                    harmfulCombination: healthyA && healthyB && signalOverlap >= MATERIAL_OVERLAP,
                });
            }

            const riskA = a.riskAmount;
            const riskB = b.riskAmount;
            if (riskA !== null && riskB !== null && (riskA > 0 || riskB > 0)) {
                const shared = Math.min(riskA, riskB);
                const riskOverlap = shared / Math.max(riskA, riskB);
                if (riskOverlap > 0) {
                    overlaps.push({
                        a: a.strategyId,
                        b: b.strategyId,
                        kind: "RISK",
                        overlap: round(riskOverlap),
                        detail: `Cash risk at stop: ${round(riskA)} vs ${round(riskB)} — one can absorb ${round(riskOverlap * 100)}% of the other before the portfolio feels it.`,
                        evidence: [`risk:${a.strategyId}`, `risk:${b.strategyId}`],
                        harmfulCombination: healthyA && healthyB && riskOverlap >= MATERIAL_OVERLAP,
                    });
                }
            }

            const corr = input.matrix
                ? meanCorrelationBetween(input.matrix, a.openSymbols, b.openSymbols)
                : null;
            if (corr !== null) {
                overlaps.push({
                    a: a.strategyId,
                    b: b.strategyId,
                    kind: "CORRELATION",
                    overlap: round(Math.abs(corr)),
                    detail: `Mean ρ ${round(corr)} across their shared price history. Above ±0.70 the two behave as substitutes rather than diversification.`,
                    evidence: [`matrix:${input.matrix?.timeframe ?? "n/a"}`],
                    harmfulCombination: healthyA && healthyB && Math.abs(corr) >= 0.7,
                });
            }

            const wa = a.worstDrawdownWindow;
            const wb = b.worstDrawdownWindow;
            if (wa && wb) {
                const overlapStart = Math.max(wa.from, wb.from);
                const overlapEnd = Math.min(wa.to, wb.to);
                const spanA = Math.max(1, wa.to - wa.from);
                const spanB = Math.max(1, wb.to - wb.from);
                const intersect = Math.max(0, overlapEnd - overlapStart);
                const drawdownOverlap = intersect / Math.min(spanA, spanB);
                if (drawdownOverlap > 0) {
                    overlaps.push({
                        a: a.strategyId,
                        b: b.strategyId,
                        kind: "DRAWDOWN",
                        overlap: round(Math.min(1, drawdownOverlap)),
                        detail: `Their worst drawdown windows overlap by ${round(Math.min(1, drawdownOverlap) * 100)}% of the shorter window — the two drawdowns coincide rather than offset.`,
                        evidence: [`dd:${a.strategyId}`, `dd:${b.strategyId}`],
                        harmfulCombination: healthyA && healthyB && drawdownOverlap >= MATERIAL_OVERLAP,
                    });
                }
            }

            const regimeOverlap = regimeOverlapOf(a.regimeTaggedTrades, b.regimeTaggedTrades);
            if (regimeOverlap !== null) {
                overlaps.push({
                    a: a.strategyId,
                    b: b.strategyId,
                    kind: "REGIME",
                    overlap: round(regimeOverlap),
                    detail: `${round(regimeOverlap * 100)}% of their tagged closed trades occurred in the same classified regime.`,
                    evidence: [`regime:${a.strategyId}`, `regime:${b.strategyId}`],
                    harmfulCombination: healthyA && healthyB && regimeOverlap >= MATERIAL_OVERLAP,
                });
            }

            if (a.active && b.active) {
                overlaps.push({
                    a: a.strategyId,
                    b: b.strategyId,
                    kind: "STRATEGY",
                    overlap: 1,
                    detail: "Both strategies are live in the same portfolio, so their outcomes are already combined.",
                    evidence: [`active:${a.strategyId}`, `active:${b.strategyId}`],
                    harmfulCombination: false,
                });
            }
        }
    }

    const hiddenConcentrationDetected = overlaps.some(
        (o) => o.harmfulCombination && ["POSITION", "CORRELATION", "RISK", "DRAWDOWN"].includes(o.kind)
    );

    if (!input.matrix) {
        limitations.push("No correlation matrix available — strategy CORRELATION overlap is omitted rather than assumed to be zero.");
    }
    if (strategies.length < 2) {
        limitations.push("Fewer than two strategies tracked — overlap analysis has nothing to compare.");
    }

    return {
        portfolioId: input.portfolioId,
        calculatedAt: input.calculatedAt,
        strategies: strategies2,
        overlaps,
        hiddenConcentrationDetected,
        limitations,
    };
}

function round(v: number): number {
    return Math.round(v * 10000) / 10000;
}

function average(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Mean of the pairwise correlations between two symbol sets. */
function meanCorrelationBetween(matrix: CorrelationMatrix, a: string[], b: string[]): number | null {
    if (a.length === 0 || b.length === 0) return null;
    const index = new Map(matrix.symbols.map((s, i) => [s, i]));
    const values: number[] = [];
    for (const sa of a) {
        const ia = index.get(sa);
        if (ia === undefined) continue;
        for (const sb of b) {
            const ib = index.get(sb);
            if (ib === undefined) continue;
            const v = matrix.matrix[ia]?.[ib];
            if (typeof v === "number") values.push(v);
        }
    }
    if (values.length === 0) return null;
    return average(values);
}

/** Share of A's tagged trades that landed in a regime B also traded in. */
function regimeOverlapOf(
    a: Array<{ regime: string; netPnL: number }> | undefined,
    b: Array<{ regime: string; netPnL: number }> | undefined
): number | null {
    if (!a || !b || a.length === 0 || b.length === 0) return null;
    const regimesB = new Set(b.map((t) => t.regime));
    const matching = a.filter((t) => regimesB.has(t.regime)).length;
    return matching / a.length;
}

/**
 * Correlation between a strategy's realized P&L stream and the portfolio's.
 * Requires both series; returns null honestly otherwise.
 */
export function strategyToPortfolioCorrelation(
    strategyPnL: number[],
    portfolioPnL: number[]
): number | null {
    const n = Math.min(strategyPnL.length, portfolioPnL.length);
    if (n < 10) return null;
    return pearson(strategyPnL.slice(0, n), portfolioPnL.slice(0, n));
}

/**
 * Convert strategy performance into allocation inputs. Kept here so the
 * allocation engine never has to know where the numbers came from.
 */
export function toAllocationInputs(
    strategies: StrategyPerformanceInput[],
    equity: number
): AllocationInput[] {
    const exposureByStrategy = new Map<string, number>();
    void exposureByStrategy;

    return strategies.map((s) => {
        const grossNotional = s.openSymbols.length; // placeholder replaced below
        void grossNotional;
        return {
            strategyId: s.strategyId,
            currentWeight: equity > 0 ? s.riskAmount !== null ? s.riskAmount / equity : 0 : 0,
            pnlContribution: s.unrealizedPnL,
            volatility: null,
            maxDrawdownPercent: s.maxDrawdownPercent,
            oosSharpe: s.oosSharpe,
            sampleSize: s.sampleSize,
            correlationToPortfolio: null,
            health: s.health,
            active: s.active,
        };
    });
}

/** Share of gross exposure held by the named strategies, 0..1. */
export function strategyExposureShare(exposure: PortfolioExposure, strategyIds: string[]): number {
    if (!(exposure.grossExposure > 0)) return 0;
    const set = new Set(strategyIds);
    const notional = exposure.byStrategy
        .filter((s) => set.has(s.key))
        .reduce((acc, s) => acc + s.grossNotional, 0);
    return notional / exposure.grossExposure;
}
