/**
 * AlgoVault — PBO for the Strategy Lab optimizer.
 *
 * The optimizer already runs a grid of genuinely different strategy
 * configurations over the same candles and ranks them by an in-sample
 * composite score. That score cannot tell whether the WINNER was skill or the
 * luckiest of N noise draws. This module feeds the same runs into CSCV/PBO:
 *
 *   • the observation is the run's own equity curve, sampled at the same
 *     block boundaries for every configuration;
 *   • blocks are contiguous in TIME and shared by every configuration, so no
 *     future data enters an earlier block's return;
 *   • configurations are deduplicated — a grid that repeats a configuration
 *     must not be counted as extra independent trials;
 *   • determinism: shared boundaries + stable config ordering + fixed tie
 *     breaking mean identical inputs produce identical PBO.
 *
 * The output is RESEARCH EVIDENCE. It never authorises trading: `researchOnly`
 * is always true and no field is a profitability claim.
 */

import { cscvPbo, type PboResult } from "@/lib/quant/validation/pbo";
import type { EquityPoint } from "./types";

export interface OptimizationPboSummary {
    available: boolean;
    reason?: string;
    researchOnly: true;
    /** Probability the in-sample winner lands below the OOS median. */
    pbo?: number;
    blocks?: number;
    /** Unique configurations that entered the matrix. */
    configurations?: number;
    /** Runs the optimizer sampled (may exceed `configurations` on a dup grid). */
    sampledRuns: number;
    observations?: number;
    combinationsEvaluated?: number;
    combinationsTotal?: number;
    medianLogit?: number;
    interpretation?: string;
    /** Stated, not implied: PBO is selection evidence, not a validation badge. */
    note: string;
}

export interface OptimizationRunEquity {
    /** Stable JSON key of the configuration, used for deduplication. */
    configKey: string;
    equity: readonly EquityPoint[];
}

/** One run reduced to its block returns — the optimizer keeps this, not the curve. */
export interface OptimizationRunSample {
    configKey: string;
    returns: readonly number[];
}

/** Ten contiguous blocks: C(10,5)=252 CSCV splits, cheap and stable. */
export const DEFAULT_PBO_BLOCKS = 10;

/** Shared, contiguous block boundaries for the optimisation window. */
export function optimizationBlockBoundaries(from: number, to: number, blocks: number): number[] | null {
    if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return null;
    if (!Number.isInteger(blocks) || blocks < 4 || blocks % 2 !== 0) return null;
    const span = (to - from) / blocks;
    const boundaries: number[] = [];
    for (let b = 1; b <= blocks; b++) boundaries.push(from + span * b);
    return boundaries;
}

/**
 * Reduce ONE equity curve to per-block returns against the shared boundaries.
 * Samples only points at or before each boundary, so a block never sees a
 * later balance. Returns null when coverage/values are unusable.
 */
export function blockReturnsFromEquity(
    equity: readonly EquityPoint[],
    boundaries: readonly number[],
    from: number,
): number[] | null {
    const points = [...equity].sort((a, b) => a.time - b.time);
    if (points.length < 2) return null;
    // A curve that stops before the window end would enter the matrix with a
    // stale balance for the remaining blocks — padding, not evidence.
    const lastBoundary = boundaries[boundaries.length - 1];
    if (points[points.length - 1].time < lastBoundary) return null;
    let startBalance = sampleAt(points, from)?.balance ?? points[0].balance;
    const series: number[] = [];
    for (const boundary of boundaries) {
        const endPoint = sampleAt(points, boundary);
        if (!endPoint) return null;
        const endBalance = endPoint.balance;
        if (!(startBalance > 0) || !(endBalance > 0)) return null;
        series.push(endBalance / startBalance - 1);
        startBalance = endBalance;
    }
    return series;
}

/**
 * Sample each run's equity curve at shared time boundaries and return a
 * per-configuration block-return matrix, or a reason it cannot be built.
 */
export function buildOptimizationBlockReturns(
    runs: readonly OptimizationRunEquity[],
    from: number,
    to: number,
    blocks: number = DEFAULT_PBO_BLOCKS,
): { available: true; returnsByConfig: number[][]; blocks: number; configurations: number } | { available: false; reason: string } {
    if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) {
        return { available: false, reason: "The optimisation window is empty or inverted." };
    }
    const boundaries = optimizationBlockBoundaries(from, to, blocks);
    if (!boundaries) {
        return { available: false, reason: "PBO needs an even block count of at least 4 over a non-empty window." };
    }

    // Deduplicate configurations: the same config sampled twice is one trial,
    // not two independent selections.
    const unique = new Map<string, readonly EquityPoint[]>();
    for (const run of runs) {
        if (!unique.has(run.configKey)) unique.set(run.configKey, run.equity);
    }
    const keys = [...unique.keys()].sort();
    if (keys.length < 2) {
        return {
            available: false,
            reason: "PBO requires at least two distinct configurations; the grid produced fewer.",
        };
    }

    const returnsByConfig: number[][] = [];
    for (const key of keys) {
        const series = blockReturnsFromEquity(unique.get(key)!, boundaries, from);
        if (!series) {
            return {
                available: false,
                reason: "An equity curve is missing coverage of the optimisation window.",
            };
        }
        returnsByConfig.push(series);
    }

    return { available: true, returnsByConfig, blocks, configurations: keys.length };
}

/** Last equity point at or before `time` (no interpolation, no future peek). */
function sampleAt(points: readonly EquityPoint[], time: number): EquityPoint | null {
    let found: EquityPoint | null = null;
    for (const point of points) {
        if (point.time > time) break;
        found = point;
    }
    return found;
}

export function pboFromOptimizationRuns(input: {
    runs: readonly OptimizationRunEquity[];
    from: number;
    to: number;
    blocks?: number;
    sampledRuns: number;
}): OptimizationPboSummary {
    const built = buildOptimizationBlockReturns(input.runs, input.from, input.to, input.blocks);
    if (!built.available) {
        return {
            available: false,
            reason: built.reason,
            researchOnly: true,
            sampledRuns: input.sampledRuns,
            note: pboNote(),
        };
    }
    return pboFromOptimizationSamples({
        samples: built.returnsByConfig.map((returns, i) => ({ configKey: String(i), returns })),
        blocks: built.blocks,
        sampledRuns: input.sampledRuns,
    });
}

/**
 * PBO from already-reduced runs (the optimizer's streaming path, which never
 * retains every equity curve). Deduplicates by config key, so a repeated grid
 * point is not counted as an extra trial.
 */
export function pboFromOptimizationSamples(input: {
    samples: readonly OptimizationRunSample[];
    blocks?: number;
    sampledRuns: number;
}): OptimizationPboSummary {
    const blocks = input.blocks ?? DEFAULT_PBO_BLOCKS;
    const unique = new Map<string, readonly number[]>();
    for (const sample of input.samples) {
        if (!unique.has(sample.configKey)) unique.set(sample.configKey, sample.returns);
    }
    const keys = [...unique.keys()].sort();
    if (keys.length < 2) {
        return {
            available: false,
            reason: "PBO requires at least two distinct configurations; the grid produced fewer.",
            researchOnly: true,
            sampledRuns: input.sampledRuns,
            note: pboNote(),
        };
    }
    const returnsByConfig = keys.map((key) => [...unique.get(key)!]);
    if (returnsByConfig.some((series) => series.length !== blocks)) {
        return {
            available: false,
            reason: "A run does not cover every optimisation block.",
            researchOnly: true,
            sampledRuns: input.sampledRuns,
            note: pboNote(),
        };
    }

    const result: PboResult = cscvPbo({ returnsByConfig, blocks });

    if (!result.available) {
        return {
            available: false,
            reason: result.reason,
            researchOnly: true,
            sampledRuns: input.sampledRuns,
            configurations: keys.length,
            blocks,
            note: pboNote(),
        };
    }

    return {
        available: true,
        researchOnly: true,
        pbo: result.pbo,
        blocks: result.blocks,
        configurations: result.configurations,
        sampledRuns: input.sampledRuns,
        observations: result.observations,
        combinationsEvaluated: result.combinationsEvaluated,
        combinationsTotal: result.combinationsTotal,
        medianLogit: result.medianLogit,
        interpretation: result.interpretation,
        note: pboNote(),
    };
}

function pboNote(): string {
    return "PBO describes the optimizer's selection process on this dataset. It is research evidence, not a validation certificate, and it never authorises live trading.";
}
