/**
 * Probability of Backtest Overfitting (PBO) via Combinatorially Symmetric
 * Cross-Validation (CSCV) — Bailey, Borwein, López de Prado & Zhu (2014).
 *
 * The question PBO answers: when we pick the best configuration on in-sample
 * data, how often does it land in the *bottom half* out of sample? A robust
 * optimisation process yields a low PBO; a process that mines noise yields a
 * PBO near 0.5 even when the best in-sample Sharpe looks excellent.
 *
 * Input is a performance matrix: `returnsByConfig[n][t]` — the per-observation
 * return of configuration n at observation t. Every configuration must cover
 * the same observations. The matrix is split into S contiguous blocks; for
 * every way of choosing S/2 blocks as in-sample, the complement is
 * out-of-sample. The best in-sample configuration's out-of-sample rank is
 * recorded and converted to a logit; PBO is the share of combinations whose
 * logit is ≤ 0 (i.e. below the out-of-sample median).
 *
 * Determinism: blocks, enumeration order and tie-breaking (lowest config
 * index) are fixed, so identical input yields identical output.
 */

import { logit, sharpeRatio } from "./stats";

export interface PboInput {
    /** returnsByConfig[configuration][observation] — equal-length series. */
    returnsByConfig: readonly (readonly number[])[];
    /** Even number of contiguous blocks (default: largest even ≤ 10, min 2). */
    blocks?: number;
    /** Hard cap on evaluated combinations (default 20 000). */
    maxCombinations?: number;
}

export type PboResult =
    | {
          available: true;
          /** Share of combinations where the IS winner underperformed OOS, in [0, 1]. */
          pbo: number;
          blocks: number;
          configurations: number;
          observations: number;
          combinationsEvaluated: number;
          combinationsTotal: number;
          /** Combinations skipped because no configuration had a defined IS Sharpe. */
          skippedCombinations: number;
          /** Median logit across evaluated combinations (negative ⇒ overfit-leaning). */
          medianLogit: number;
          interpretation: string;
          /** Sample assumptions a reader must know to use this number. */
          assumptions: string[];
      }
    | { available: false; reason: string };

export function cscvPbo(input: PboInput): PboResult {
    const configs = input.returnsByConfig as readonly (readonly number[])[] | null | undefined;
    if (!configs || configs.length < 2) {
        return { available: false, reason: "PBO requires at least two configurations." };
    }
    const observations = configs[0]?.length ?? 0;
    if (observations < 4) {
        return { available: false, reason: "PBO requires at least four observations per configuration." };
    }
    if (configs.some((series: readonly number[]) => series.length !== observations)) {
        return { available: false, reason: "All configurations must cover the same number of observations." };
    }
    if (configs.some((series: readonly number[]) => series.some((r: number) => !Number.isFinite(r)))) {
        return { available: false, reason: "Performance matrix contains non-finite values." };
    }

    const maxBlocks = Math.min(16, observations);
    const defaultBlocks = Math.min(10, maxBlocks % 2 === 0 ? maxBlocks : maxBlocks - 1);
    const blocks = normalizeBlocks(input.blocks, defaultBlocks);
    if (blocks === null) {
        return { available: false, reason: "The block count must be an even number between 2 and 16." };
    }

    const half = blocks / 2;
    const totalCombinations = binomial(blocks, half);
    const cap = input.maxCombinations ?? 20_000;
    if (totalCombinations > cap) {
        return {
            available: false,
            reason: `CSCV would evaluate ${totalCombinations} combinations (cap ${cap}); reduce the block count.`,
        };
    }

    const bounds = blockBounds(observations, blocks);
    const configIndices = configs.map((_, i) => i);
    let overfit = 0;
    let evaluated = 0;
    let skipped = 0;
    const logits: number[] = [];

    for (const mask of combinations(blocks, half)) {
        const inSample: number[] = [];
        const outOfSample: number[] = [];
        for (let b = 0; b < blocks; b++) {
            const [from, to] = bounds[b];
            const target = (mask & (1 << b)) !== 0 ? inSample : outOfSample;
            for (let t = from; t < to; t++) target.push(t);
        }

        const isSharpes = configIndices.map((n) => pick(configs[n], inSample)).map((s) => sharpeRatio(s));
        if (isSharpes.every((s) => s === null)) {
            skipped++;
            continue;
        }

        // Best in-sample configuration; undefined Sharpes rank last, ties go to
        // the lowest index so the result never depends on sort stability.
        let best = 0;
        let bestSharpe = isSharpes[0] === null ? Number.NEGATIVE_INFINITY : (isSharpes[0] as number);
        for (let n = 1; n < isSharpes.length; n++) {
            const s = isSharpes[n];
            const value = s === null ? Number.NEGATIVE_INFINITY : s;
            if (value > bestSharpe) {
                best = n;
                bestSharpe = value;
            }
        }

        const oosSharpes = configIndices.map((n) => pick(configs[n], outOfSample)).map((s) => sharpeRatio(s));
        const bestOos = oosSharpes[best];
        const bestValue = bestOos === null ? Number.NEGATIVE_INFINITY : bestOos;
        let rank = 1;
        for (let n = 0; n < oosSharpes.length; n++) {
            if (n === best) continue;
            const raw = oosSharpes[n];
            const value = raw === null ? Number.NEGATIVE_INFINITY : raw;
            if (value < bestValue) rank++;
        }

        const relativeRank = rank / (configs.length + 1);
        const lambda = logit(relativeRank);
        logits.push(lambda);
        if (lambda <= 0) overfit++;
        evaluated++;
    }

    if (evaluated === 0) {
        return { available: false, reason: "Every CSCV combination had an undefined in-sample Sharpe (zero dispersion)." };
    }

    const pbo = overfit / evaluated;
    logits.sort((a, b) => a - b);
    const medianLogit = logits[Math.floor(logits.length / 2)];

    return {
        available: true,
        pbo: Math.round(pbo * 1e6) / 1e6,
        blocks,
        configurations: configs.length,
        observations,
        combinationsEvaluated: evaluated,
        combinationsTotal: totalCombinations,
        skippedCombinations: skipped,
        medianLogit: Number.isFinite(medianLogit) ? Math.round(medianLogit * 1e4) / 1e4 : medianLogit,
        interpretation: interpretPbo(pbo),
        assumptions: [
            `Performance is measured on ${blocks} contiguous blocks; block-level returns are coarser than per-trade returns and widen the uncertainty.`,
            "Every configuration must cover the same observations; the matrix is the caller's, so a biased or survivorship-filtered set of configurations still yields a confident-looking PBO.",
            "CSCV assumes the observation blocks are exchangeable enough for reordering; strong regime trends weaken that.",
            "PBO describes the selection process, not the profitability of the chosen configuration.",
        ],
    };
}

function interpretPbo(pbo: number): string {
    if (pbo <= 0.1) return "Low overfitting risk for this selection process.";
    if (pbo <= 0.3) return "Moderate overfitting risk — the selected configuration is only sometimes the out-of-sample leader.";
    if (pbo <= 0.5) return "High overfitting risk — selection is close to chance out of sample.";
    return "Selection is worse than chance out of sample; treat the optimisation result as noise.";
}

function normalizeBlocks(requested: number | undefined, fallback: number): number | null {
    if (requested === undefined) {
        return fallback >= 2 ? fallback : null;
    }
    if (!Number.isInteger(requested) || requested < 2 || requested > 16 || requested % 2 !== 0) {
        return null;
    }
    return requested;
}

/** Contiguous block boundaries; any remainder is distributed to later blocks. */
function blockBounds(n: number, blocks: number): Array<[number, number]> {
    const base = Math.floor(n / blocks);
    const remainder = n % blocks;
    const out: Array<[number, number]> = [];
    let cursor = 0;
    for (let b = 0; b < blocks; b++) {
        const size = base + (b >= blocks - remainder ? 1 : 0);
        out.push([cursor, cursor + size]);
        cursor += size;
    }
    return out;
}

function pick(series: readonly number[], indices: readonly number[]): number[] {
    const out = new Array<number>(indices.length);
    for (let i = 0; i < indices.length; i++) out[i] = series[indices[i]];
    return out;
}

function* combinations(n: number, k: number): Generator<number> {
    // Lexicographic enumeration of n-bit masks with exactly k bits set.
    let mask = (1 << k) - 1;
    const limit = 1 << n;
    while (mask < limit) {
        yield mask;
        const c = mask & -mask;
        const r = mask + c;
        mask = (((r ^ mask) >> 2) / c) | r;
    }
}

function binomial(n: number, k: number): number {
    if (k < 0 || k > n) return 0;
    let result = 1;
    for (let i = 1; i <= Math.min(k, n - k); i++) {
        result = (result * (n - Math.min(k, n - k) + i)) / i;
    }
    return Math.round(result);
}
