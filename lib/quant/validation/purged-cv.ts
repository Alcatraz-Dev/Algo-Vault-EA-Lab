/**
 * Purged cross-validation, embargo and Combinatorial Purged CV.
 *
 * Financial labels are not i.i.d.: a label computed from bars [t, t+span]
 * overlaps every other label whose window touches it. Plain K-fold therefore
 * leaks future information into the training set. Two mechanisms remove the
 * leak (López de Prado, 2018):
 *
 *   • PURGE   — drop training observations whose label interval overlaps the
 *               test interval.
 *   • EMBARGO — additionally drop training observations immediately AFTER the
 *               test interval, because serial correlation lets them carry the
 *               test period's information backwards.
 *
 * CPCV partitions the sample into N groups and uses every combination of k
 * test groups, producing many train/test splits from one dataset instead of a
 * single walk-forward path.
 *
 * These functions are index arithmetic only — they never touch prices, so they
 * can be unit-tested exactly and reused by any engine.
 */

export interface PurgedFold {
    /** Training observation indices (purged + embargoed), ascending. */
    train: number[];
    /** Test observation indices, ascending. */
    test: number[];
}

export interface PurgeOptions {
    /**
     * How many observations a label spans, starting at its own index.
     * 1 = point labels with no overlap. 5 = a label at t sees t..t+4.
     */
    labelSpan: number;
    /** Embargo length in observations after each test block (default 0). */
    embargoSamples?: number;
    /** Alternative to embargoSamples: fraction of the sample to embargo. */
    embargoPct?: number;
}

export type SplitResult =
    | { available: true; folds: PurgedFold[]; purgeCount: number; embargoCount: number }
    | { available: false; reason: string };

/**
 * Purged K-fold: K contiguous test blocks covering the sample once.
 * The fold count must divide the sample into blocks of at least one
 * observation; overlapping remainder observations join the last block.
 */
export function purgedKFold(nSamples: number, k: number, options: PurgeOptions): SplitResult {
    const validation = validate(nSamples, k, options);
    if (!validation.ok) return { available: false, reason: validation.reason };

    const bounds = blockBounds(nSamples, k);
    const folds: PurgedFold[] = [];
    let purgeCount = 0;
    let embargoCount = 0;

    for (const [testStart, testEnd] of bounds) {
        const test: number[] = [];
        for (let i = testStart; i < testEnd; i++) test.push(i);

        const { train, purged, embargoed } = buildTrain(nSamples, testStart, testEnd, options);
        purgeCount += purged;
        embargoCount += embargoed;
        folds.push({ train, test });
    }

    return { available: true, folds, purgeCount, embargoCount };
}

/**
 * Combinatorial Purged CV: choose `kTestGroups` of `nGroups` contiguous groups
 * as the test set. `C(nGroups, kTestGroups)` splits are generated in
 * lexicographic order, so the same parameters always yield the same folds.
 */
export function combinatorialPurgedCV(
    nSamples: number,
    nGroups: number,
    kTestGroups: number,
    options: PurgeOptions,
    maxFolds = 10_000,
): SplitResult {
    if (!Number.isInteger(nGroups) || nGroups < 2) {
        return { available: false, reason: "nGroups must be an integer ≥ 2." };
    }
    if (!Number.isInteger(kTestGroups) || kTestGroups < 1 || kTestGroups >= nGroups) {
        return { available: false, reason: "kTestGroups must be an integer in [1, nGroups)." };
    }
    const total = binomial(nGroups, kTestGroups);
    if (total > maxFolds) {
        return { available: false, reason: `CPCV would generate ${total} folds (cap ${maxFolds}).` };
    }
    const validation = validate(nSamples, nGroups, options);
    if (!validation.ok) return { available: false, reason: validation.reason };

    const bounds = blockBounds(nSamples, nGroups);
    const folds: PurgedFold[] = [];
    let purgeCount = 0;
    let embargoCount = 0;

    for (const mask of combinations(nGroups, kTestGroups)) {
        const test: number[] = [];
        for (let g = 0; g < nGroups; g++) {
            if ((mask & (1 << g)) === 0) continue;
            const [from, to] = bounds[g];
            for (let i = from; i < to; i++) test.push(i);
        }
        // The test set may be NON-contiguous (several groups). Purging and
        // embargoing must be computed against the WHOLE test set: building per
        // contiguous block let an index that belongs to another test group slip
        // into training, which is exactly the leakage CPCV exists to remove.
        const testSet = new Set(test);
        const built = buildTrainAgainstTestSet(nSamples, testSet, collapseBlocks(test), options);
        purgeCount += built.purged;
        embargoCount += built.embargoed;
        folds.push({ train: built.train, test });
    }

    return { available: true, folds, purgeCount, embargoCount };
}

// ─────────────────────────────────────────────────────────────────────────────

function validate(nSamples: number, k: number, options: PurgeOptions): { ok: true } | { ok: false; reason: string } {
    if (!Number.isInteger(nSamples) || nSamples < 2) {
        return { ok: false, reason: "nSamples must be an integer ≥ 2." };
    }
    if (!Number.isInteger(k) || k < 2 || k > nSamples) {
        return { ok: false, reason: "The fold/group count must be an integer in [2, nSamples]." };
    }
    if (!Number.isInteger(options.labelSpan) || options.labelSpan < 1) {
        return { ok: false, reason: "labelSpan must be an integer ≥ 1." };
    }
    if (options.embargoSamples !== undefined && (!Number.isInteger(options.embargoSamples) || options.embargoSamples < 0)) {
        return { ok: false, reason: "embargoSamples must be a non-negative integer." };
    }
    if (options.embargoPct !== undefined && (!(options.embargoPct >= 0) || options.embargoPct > 1)) {
        return { ok: false, reason: "embargoPct must be in [0, 1]." };
    }
    return { ok: true };
}

/**
 * Build the training set for one contiguous test block.
 *
 * Purge rule: a training label at i spans [i, i + labelSpan - 1]. It is purged
 * when that span intersects [testStart, testEnd - 1] — including labels that
 * START BEFORE the test block and reach into it, which the naive
 * `i < testStart` filter misses.
 *
 * Embargo rule: training labels starting in [testEnd, testEnd + embargo) are
 * removed.
 */
function buildTrain(
    nSamples: number,
    testStart: number,
    testEnd: number,
    options: PurgeOptions,
): { train: number[]; purged: number; embargoed: number } {
    const span = options.labelSpan;
    const embargo = resolveEmbargo(nSamples, options);
    const train: number[] = [];
    let purged = 0;
    let embargoed = 0;

    for (let i = 0; i < nSamples; i++) {
        if (i >= testStart && i < testEnd) continue; // test observation
        const labelEnd = i + span - 1;
        const overlapsTest = labelEnd >= testStart && i <= testEnd - 1;
        if (overlapsTest) {
            purged++;
            continue;
        }
        const inEmbargo = embargo > 0 && i >= testEnd && i < testEnd + embargo;
        if (inEmbargo) {
            embargoed++;
            continue;
        }
        train.push(i);
    }

    return { train, purged, embargoed };
}

/**
 * Training set for an arbitrary (possibly non-contiguous) test set.
 *
 * PURGE: drop any index whose label window [i, i+span-1] contains a test
 * observation. A prefix sum of test membership makes this O(1) per index.
 * EMBARGO: drop the `embargo` observations after every contiguous test block.
 */
function buildTrainAgainstTestSet(
    nSamples: number,
    testSet: ReadonlySet<number>,
    testRanges: Array<[number, number]>,
    options: PurgeOptions,
): { train: number[]; purged: number; embargoed: number } {
    const span = options.labelSpan;
    const embargo = resolveEmbargo(nSamples, options);

    const inTestPrefix = new Array<number>(nSamples + 1).fill(0);
    for (let i = 0; i < nSamples; i++) {
        inTestPrefix[i + 1] = inTestPrefix[i] + (testSet.has(i) ? 1 : 0);
    }
    const embargoedSet = new Set<number>();
    if (embargo > 0) {
        for (const [, to] of testRanges) {
            for (let i = to; i < Math.min(nSamples, to + embargo); i++) {
                if (!testSet.has(i)) embargoedSet.add(i);
            }
        }
    }

    const train: number[] = [];
    let purged = 0;
    let embargoed = 0;
    for (let i = 0; i < nSamples; i++) {
        if (testSet.has(i)) continue;
        const labelEnd = Math.min(nSamples - 1, i + span - 1);
        if (inTestPrefix[labelEnd + 1] - inTestPrefix[i] > 0) {
            purged++;
            continue;
        }
        if (embargoedSet.has(i)) {
            embargoed++;
            continue;
        }
        train.push(i);
    }
    return { train, purged, embargoed };
}

function resolveEmbargo(nSamples: number, options: PurgeOptions): number {
    if (options.embargoSamples !== undefined) return options.embargoSamples;
    if (options.embargoPct !== undefined) return Math.floor(nSamples * options.embargoPct);
    return 0;
}

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

/** Merge ascending indices into contiguous [from, to) ranges. */
function collapseBlocks(indices: readonly number[]): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const i of indices) {
        const last = out[out.length - 1];
        if (last && i === last[1]) {
            last[1] = i + 1;
        } else {
            out.push([i, i + 1]);
        }
    }
    return out;
}

function* combinations(n: number, k: number): Generator<number> {
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
    const kk = Math.min(k, n - k);
    for (let i = 1; i <= kk; i++) {
        result = (result * (n - kk + i)) / i;
    }
    return Math.round(result);
}
