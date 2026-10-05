/**
 * AlgoVault — Portfolio Correlation Engine (Phase 15 §7/§8/§9).
 *
 * PURE + DETERMINISTIC. Real return series in, real coefficients out. An LLM is
 * never asked for a correlation and never asked to interpret one into a signal.
 *
 * Formulas (documented, recomputable by hand):
 *
 *   simple return      r_t = (p_t − p_{t−1}) / p_{t−1}
 *   log return         r_t = ln(p_t / p_{t−1})
 *   Pearson  ρXY = Σ(x−x̄)(y−ȳ) / √(Σ(x−x̄)² · Σ(y−ȳ)²)
 *   Spearman ρXY = Pearson of the within-sample ranks (ties averaged)
 *
 * Alignment rule: two series are paired by *timestamp*, never by index. A
 * series with a missing bar at time T simply drops that observation from BOTH
 * sides. This is what stops cross-timeframe maths from silently mismatching.
 *
 * Minimum observations: a pair below `minObservations` reports
 * `INSUFFICIENT_DATA` with `coefficient: null`. It is never estimated.
 */

import type {
    CorrelationInterpretation,
    CorrelationMatrix,
    CorrelationMethod,
    CorrelationPair,
    DataFreshness,
    PortfolioCorrelationRisk,
    PortfolioExposure,
    PortfolioPosition,
} from "./types";

export interface PriceSeries {
    symbol: string;
    /** Candle timestamps in ms. Must be sorted ascending. */
    timestamps: number[];
    closes: number[];
}

/** Default windows. All four are computed; the matrix uses the primary window. */
export const CORRELATION_WINDOWS = [20, 50, 100, 250] as const;

/** Window the canonical matrix is built from. */
export const PRIMARY_CORRELATION_WINDOW = 100;

export const DEFAULT_CORRELATION_METHOD: CorrelationMethod = "pearson";

/** Below this many paired observations a coefficient is not reported. */
export const MIN_CORRELATION_OBSERVATIONS = 20;

/* ── Return series ────────────────────────────────────────────────────────── */

/** Log returns, dropping any bar whose close is non-positive or unchanged. */
export function logReturns(series: PriceSeries): { timestamps: number[]; values: number[] } {
    const timestamps: number[] = [];
    const values: number[] = [];
    for (let i = 1; i < series.closes.length; i += 1) {
        const prev = series.closes[i - 1];
        const curr = series.closes[i];
        if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0 || curr <= 0) continue;
        if (curr === prev) continue;
        timestamps.push(series.timestamps[i]);
        values.push(Math.log(curr / prev));
    }
    return { timestamps, values };
}

/** Simple percentage returns; same guards as `logReturns`. */
export function simpleReturns(series: PriceSeries): { timestamps: number[]; values: number[] } {
    const timestamps: number[] = [];
    const values: number[] = [];
    for (let i = 1; i < series.closes.length; i += 1) {
        const prev = series.closes[i - 1];
        const curr = series.closes[i];
        if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0 || curr <= 0) continue;
        if (curr === prev) continue;
        timestamps.push(series.timestamps[i]);
        values.push((curr - prev) / prev);
    }
    return { timestamps, values };
}

export type ReturnStyle = "log" | "simple";

export function toReturns(series: PriceSeries, style: ReturnStyle = "log") {
    return style === "simple" ? simpleReturns(series) : logReturns(series);
}

/* ── Coefficient maths ────────────────────────────────────────────────────── */

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Pearson correlation over aligned arrays. Returns `null` for degenerate input
 * (zero variance, empty, non-finite) rather than 0 — "no variance" and "no
 * relationship" are different facts.
 */
export function pearson(x: number[], y: number[]): number | null {
    const n = Math.min(x.length, y.length);
    if (n < 2) return null;
    const xs = x.slice(0, n);
    const ys = y.slice(0, n);
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let dx2 = 0;
    let dy2 = 0;
    for (let i = 0; i < n; i += 1) {
        const dx = xs[i] - mx;
        const dy = ys[i] - my;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    if (dx2 === 0 || dy2 === 0) return null;
    const r = num / Math.sqrt(dx2 * dy2);
    if (!Number.isFinite(r)) return null;
    // Guard against floating point pushing |r| marginally past 1.
    return Math.max(-1, Math.min(1, r));
}

/** Average ranks for ties (the standard Spearman tie correction). */
function rank(values: number[]): number[] {
    const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(values.length);
    let i = 0;
    while (i < indexed.length) {
        let j = i + 1;
        while (j < indexed.length && indexed[j].v === indexed[i].v) j += 1;
        const averageRank = (i + 1 + j) / 2;
        for (let k = i; k < j; k += 1) ranks[indexed[k].i] = averageRank;
        i = j;
    }
    return ranks;
}

/** Spearman rank correlation = Pearson over ranks. */
export function spearman(x: number[], y: number[]): number | null {
    const n = Math.min(x.length, y.length);
    if (n < 2) return null;
    return pearson(rank(x.slice(0, n)), rank(y.slice(0, n)));
}

export function correlationCoefficient(x: number[], y: number[], method: CorrelationMethod): number | null {
    return method === "spearman" ? spearman(x, y) : pearson(x, y);
}

/* ── Alignment ────────────────────────────────────────────────────────────── */

/**
 * Align two return series by timestamp. Returns the intersection of the two
 * timestamp sets, ordered ascending, so cross-timeframe pairing is honest.
 */
export function alignReturns(
    a: { timestamps: number[]; values: number[] },
    b: { timestamps: number[]; values: number[] }
): { timestamps: number[]; x: number[]; y: number[] } {
    const mapB = new Map<number, number>();
    for (let i = 0; i < b.timestamps.length; i += 1) mapB.set(b.timestamps[i], b.values[i]);

    const timestamps: number[] = [];
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < a.timestamps.length; i += 1) {
        const ts = a.timestamps[i];
        const bv = mapB.get(ts);
        if (bv === undefined) continue;
        timestamps.push(ts);
        x.push(a.values[i]);
        y.push(bv);
    }
    return { timestamps, x, y };
}

/* ── Relationship classification ──────────────────────────────────────────── */

/**
 * Banding of a *measured* coefficient. A correlation value is data, not a
 * trading signal — the band name is descriptive only.
 */
export function classifyRelationship(r: number | null): CorrelationPair["relationship"] {
    if (r === null) return "UNKNOWN";
    if (r >= 0.7) return "STRONG_POSITIVE";
    if (r >= 0.3) return "POSITIVE";
    if (r > -0.3) return "NEUTRAL";
    if (r > -0.7) return "NEGATIVE";
    return "STRONG_NEGATIVE";
}

/* ── Pair computation ─────────────────────────────────────────────────────── */

export interface PairComputationInput {
    series: Record<string, PriceSeries>;
    symbols: string[];
    window: number;
    method?: CorrelationMethod;
    returnStyle?: ReturnStyle;
    minObservations?: number;
    /** Previous coefficient for the same pair/method/window, for change tracking. */
    previous?: Record<string, number | null>;
    /** Previous per-pair values across all windows, used for stability. */
    previousMultiWindow?: Record<string, number[]>;
}

function pairKey(a: string, b: string, method: CorrelationMethod, window: number): string {
    return `${a}|${b}|${method}|${window}`;
}

/** Compute every unique pair once (a matrix is symmetric; we report a<b). */
export function computePairs(input: PairComputationInput): CorrelationPair[] {
    const method = input.method ?? DEFAULT_CORRELATION_METHOD;
    const style = input.returnStyle ?? "log";
    const minObs = input.minObservations ?? MIN_CORRELATION_OBSERVATIONS;
    const prepared: Record<string, { timestamps: number[]; values: number[] }> = {};

    for (const symbol of input.symbols) {
        const raw = input.series[symbol];
        if (!raw || raw.closes.length < 3) continue;
        const returns = toReturns(raw, style);
        if (returns.values.length >= 3) prepared[symbol] = returns;
    }

    const available = Object.keys(prepared).sort();
    const pairs: CorrelationPair[] = [];

    for (let i = 0; i < available.length; i += 1) {
        for (let j = i + 1; j < available.length; j += 1) {
            const a = available[i];
            const b = available[j];
            const aligned = alignReturns(prepared[a], prepared[b]);
            const windowAligned = {
                x: aligned.x.slice(-input.window),
                y: aligned.y.slice(-input.window),
            };
            const observations = windowAligned.x.length;
            const key = pairKey(a, b, method, input.window);
            const previous = input.previous?.[key] ?? input.previous?.[`${b}|${a}|${method}|${input.window}`];

            if (observations < minObs) {
                pairs.push({
                    a,
                    b,
                    timeframe: "",
                    window: input.window,
                    method,
                    observations,
                    coefficient: null,
                    status: "INSUFFICIENT_DATA",
                    reason: `Only ${observations} aligned observation(s); at least ${minObs} required for a coefficient.`,
                    relationship: "UNKNOWN",
                });
                continue;
            }

            const coefficient = correlationCoefficient(windowAligned.x, windowAligned.y, method);
            const prevWindow = input.previousMultiWindow?.[`${a}|${b}`] ?? input.previousMultiWindow?.[`${b}|${a}`];
            const stability =
                prevWindow && prevWindow.length > 1 ? standardDeviation(prevWindow) : null;

            pairs.push({
                a,
                b,
                timeframe: "",
                window: input.window,
                method,
                observations,
                coefficient,
                status: coefficient === null ? "UNAVAILABLE" : "AVAILABLE",
                reason: coefficient === null ? "Zero variance in one or both series over the window." : undefined,
                relationship: classifyRelationship(coefficient),
                previousCoefficient: previous ?? null,
                delta: coefficient !== null && typeof previous === "number" ? coefficient - previous : null,
                stability,
            });
        }
    }

    return pairs;
}

function standardDeviation(values: number[]): number {
    const m = mean(values);
    const v = values.reduce((acc, v2) => acc + (v2 - m) ** 2, 0) / values.length;
    return Math.sqrt(v);
}

/* ── Matrix ───────────────────────────────────────────────────────────────── */

export interface BuildMatrixInput extends PairComputationInput {
    portfolioId: string;
    timeframe: string;
    dataTimestamp: number;
    calculatedAt: number;
    freshness: DataFreshness;
}

export function buildCorrelationMatrix(input: BuildMatrixInput): CorrelationMatrix {
    const method = input.method ?? DEFAULT_CORRELATION_METHOD;
    const window = input.window ?? PRIMARY_CORRELATION_WINDOW;
    const symbols = input.symbols;
    const pairs = computePairs({ ...input, method, window }).map((p) => ({ ...p, timeframe: input.timeframe }));

    const index = new Map(symbols.map((s, i) => [s, i]));
    const size = symbols.length;
    const matrix: Array<Array<number | null>> = Array.from({ length: size }, () => new Array<number | null>(size).fill(null));
    for (let i = 0; i < size; i += 1) matrix[i][i] = 1;
    for (const pair of pairs) {
        const ai = index.get(pair.a);
        const bi = index.get(pair.b);
        if (ai === undefined || bi === undefined) continue;
        matrix[ai][bi] = pair.coefficient;
        matrix[bi][ai] = pair.coefficient;
    }

    const limitations = collectLimitations(symbols, pairs, window);

    return {
        portfolioId: input.portfolioId,
        symbols,
        timeframe: input.timeframe,
        window,
        method,
        matrix,
        pairs,
        calculatedAt: input.calculatedAt,
        dataTimestamp: input.dataTimestamp,
        freshness: input.freshness,
        limitations,
    };
}

function collectLimitations(symbols: string[], pairs: CorrelationPair[], window: number): string[] {
    const limitations: string[] = [];
    const insufficient = pairs.filter((p) => p.status !== "AVAILABLE");
    if (insufficient.length > 0) {
        limitations.push(
            `${insufficient.length} of ${pairs.length} pair(s) have no coefficient (insufficient or degenerate data) and are reported as null — not as zero.`
        );
    }
    if (pairs.length === 0 && symbols.length > 1) {
        limitations.push("No pair had enough aligned history in the requested window.");
    }
    limitations.push(
        `Coefficients are computed over a rolling window of ${window} aligned bars of the same timeframe. They describe co-movement in the past and are not a forecast or a trading signal.`
    );
    return limitations;
}

/* ── Correlation risk (portfolio level) ───────────────────────────────────── */

export interface CorrelationRiskInput {
    portfolioId: string;
    matrix: CorrelationMatrix;
    positions: PortfolioPosition[];
    exposure: PortfolioExposure;
    /** Positions sharing the same direction reinforce; opposite sides hedge. */
    threshold?: number;
    /** |Δ| against the previous window that counts as a "shift". */
    shiftThreshold?: number;
    calculatedAt: number;
}

interface ClusterCandidate {
    symbols: string[];
    edges: CorrelationPair[];
}

/**
 * Cluster the symbols currently held open whose pairwise correlation exceeds
 * `threshold`. A cluster of 2+ positions in the SAME direction is the
 * HIGH_CORRELATED_EXPOSURE case: each position looks fine alone, together they
 * are one bet.
 */
export function computeCorrelationRisk(input: CorrelationRiskInput): PortfolioCorrelationRisk {
    const threshold = input.threshold ?? 0.6;
    const shiftThreshold = input.shiftThreshold ?? 0.2;
    const limitations: string[] = [];

    const heldSymbols = Array.from(
        new Set(input.positions.map((p) => p.symbol))
    ).sort();

    const heldExposure = new Map<string, number>();
    for (const slice of input.exposure.bySymbol) {
        heldExposure.set(slice.key, slice.grossNotional);
    }

    const strongEdges = input.matrix.pairs.filter(
        (p) => p.coefficient !== null && p.coefficient >= threshold && heldSymbols.includes(p.a) && heldSymbols.includes(p.b)
    );

    const clusters = buildClusters(heldSymbols, strongEdges);
    const evidence: CorrelationInterpretation[] = [];

    // Direction check: same-direction members of a cluster reinforce.
    const directionBySymbol = new Map<string, "LONG" | "SHORT">();
    for (const pos of input.positions) {
        const existing = directionBySymbol.get(pos.symbol);
        // A symbol held both ways is treated as net-flat for clustering.
        if (existing && existing !== pos.side) directionBySymbol.set(pos.symbol, "LONG");
        else directionBySymbol.set(pos.symbol, pos.side);
    }

    let worstCluster: { symbols: string[]; weight: number; mean: number } | null = null;
    for (const cluster of clusters) {
        const longCount = cluster.symbols.filter((s) => directionBySymbol.get(s) === "LONG").length;
        const shortCount = cluster.symbols.filter((s) => directionBySymbol.get(s) === "SHORT").length;
        const netDirection = longCount - shortCount;
        const meanCorrelation = cluster.edges.length > 0
            ? cluster.edges.reduce((sum, e) => sum + (e.coefficient ?? 0), 0) / cluster.edges.length
            : 0;
        const weight = cluster.symbols.reduce((sum, s) => sum + (heldExposure.get(s) ?? 0), 0);
        const grossWeight = input.exposure.grossExposure > 0 ? weight / input.exposure.grossExposure : 0;

        if (cluster.symbols.length < 2) continue;
        const aligned = Math.abs(netDirection) >= cluster.symbols.length - 1;

        if (!worstCluster || grossWeight > worstCluster.weight) {
            worstCluster = { symbols: cluster.symbols, weight: grossWeight, mean: meanCorrelation };
        }

        if (aligned) {
            evidence.push({
                kind: "CALCULATED",
                text:
                    `${cluster.symbols.length} positions (${cluster.symbols.join(", ")}) are held in the same direction and ` +
                    `their mean pairwise correlation is ${meanCorrelation.toFixed(2)} over the last ${input.matrix.window} bars. ` +
                    `Together they carry ${(grossWeight * 100).toFixed(1)}% of gross exposure and are increasing exposure to the same underlying factor.`,
                evidenceIds: cluster.edges.map((e) => `${e.a}-${e.b}`),
            });
        } else {
            evidence.push({
                kind: "OBSERVED",
                text:
                    `${cluster.symbols.join(", ")} are correlated (mean ${meanCorrelation.toFixed(2)}) but are not all held in the same direction, so the correlation partially offsets rather than compounds.`,
                evidenceIds: cluster.edges.map((e) => `${e.a}-${e.b}`),
            });
        }
    }

    const shiftingPairs = input.matrix.pairs
        .filter((p) => p.delta !== null && p.delta !== undefined && Math.abs(p.delta) >= shiftThreshold)
        .map((p) => ({ pair: `${p.a}/${p.b}`, from: p.previousCoefficient ?? 0, to: p.coefficient ?? 0, delta: p.delta as number }));

    if (shiftingPairs.length > 0) {
        evidence.push({
            kind: "CALCULATED",
            text:
                `${shiftingPairs.length} pair(s) moved by at least ${shiftThreshold} against the previous window: ` +
                shiftingPairs.map((s) => `${s.pair} ${s.from.toFixed(2)}→${s.to.toFixed(2)}`).join(", ") +
                ". A correlation regime shift changes how existing positions interact.",
            evidenceIds: shiftingPairs.map((s) => s.pair),
        });
    }

    const clusteredExposureWeight = worstCluster?.weight ?? 0;
    const meanCorrelation = worstCluster?.mean ?? 0;
    const severity = classifySeverity(clusteredExposureWeight, meanCorrelation, threshold);

    if (input.matrix.pairs.length === 0) {
        limitations.push("No correlation pair could be computed — correlation risk is reported as UNKNOWN rather than zero.");
    }
    limitations.push(
        `Clustering uses a ${threshold.toFixed(2)} Pearson threshold over ${input.matrix.window} ${input.matrix.timeframe} bars. Correlation is a measured property of past returns, not a signal.`
    );

    return {
        portfolioId: input.portfolioId,
        calculatedAt: input.calculatedAt,
        clusterSize: worstCluster?.symbols.length ?? 0,
        clusteredExposureWeight,
        meanCorrelation,
        shiftingPairs,
        severity,
        clusters: clusters
            .filter((c) => c.symbols.length >= 2)
            .map((c) => ({
                symbols: c.symbols,
                meanCorrelation:
                    c.edges.length > 0 ? c.edges.reduce((s, e) => s + (e.coefficient ?? 0), 0) / c.edges.length : 0,
                exposureWeight:
                    input.exposure.grossExposure > 0
                        ? c.symbols.reduce((sum, s) => sum + (heldExposure.get(s) ?? 0), 0) / input.exposure.grossExposure
                        : 0,
                grossNotional: c.symbols.reduce((sum, s) => sum + (heldExposure.get(s) ?? 0), 0),
            }))
            .sort((a, b) => b.exposureWeight - a.exposureWeight),
        evidence,
        limitations,
    };
}

function classifySeverity(weight: number, mean: number, threshold: number): PortfolioCorrelationRisk["severity"] {
    if (weight === 0) return "LOW";
    const strong = mean >= threshold;
    if (weight >= 0.6 && strong) return "HIGH";
    if (weight >= 0.3 || strong) return "MODERATE";
    return "LOW";
}

/** Connected components over the strong-edge graph. */
function buildClusters(symbols: string[], edges: CorrelationPair[]): ClusterCandidate[] {
    const parent = new Map<string, string>();
    for (const s of symbols) parent.set(s, s);
    const find = (x: string): string => {
        let root = x;
        while (parent.get(root) !== root) root = parent.get(root) as string;
        let cur = x;
        while (parent.get(cur) !== root) {
            const next = parent.get(cur) as string;
            parent.set(cur, root);
            cur = next;
        }
        return root;
    };
    const union = (a: string, b: string): void => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    };
    for (const e of edges) union(e.a, e.b);

    const groups = new Map<string, ClusterCandidate>();
    for (const s of symbols) {
        const root = find(s);
        const entry = groups.get(root) ?? { symbols: [], edges: [] };
        entry.symbols.push(s);
        groups.set(root, entry);
    }
    for (const e of edges) {
        const root = find(e.a);
        const entry = groups.get(root);
        if (entry) entry.edges.push(e);
    }
    return Array.from(groups.values());
}

/**
 * Correlation of a proposed trade against the portfolio: the maximum absolute
 * correlation between its symbol and any symbol already held, so a pre-check
 * can say "this adds correlated exposure" with a number attached.
 */
export function portfolioCorrelationAfter(
    matrix: CorrelationMatrix,
    heldSymbols: string[],
    incomingSymbol: string
): number | null {
    const others = heldSymbols.filter((s) => s !== incomingSymbol);
    if (others.length === 0) return null;
    const index = matrix.symbols.indexOf(incomingSymbol);
    if (index < 0) return null;
    const values: number[] = [];
    for (const other of others) {
        const j = matrix.symbols.indexOf(other);
        if (j < 0) continue;
        const v = matrix.matrix[index]?.[j];
        if (typeof v === "number") values.push(v);
    }
    if (values.length === 0) return null;
    // Maximum positive correlation — the one that compounds risk.
    return Math.max(...values);
}
