/**
 * AlgoVault — Cross-Asset Relationship Engine (Phase 16 §4–§10).
 *
 * PURE + DETERMINISTIC. Real aligned return series in, measured relationships
 * out. No LLM is ever asked for a correlation, a stability label or a break.
 *
 * It deliberately REUSES the Phase 15 correlation core (`lib/portfolio/
 * correlation.ts`) for returns, alignment and coefficients, so there is exactly
 * one implementation of ρ in the platform. What this module adds on top:
 *
 *   1. multi-window rolling observations (§6) — 20/50/100/250/500 bars
 *   2. stability classification (§7) with PRINTED thresholds
 *   3. break / flip detection (§8) as observations, never signals
 *   4. data-quality accounting (§45) — coverage, missing bars, honest status
 *   5. evidence (§5) — every label comes with the numbers behind it
 *
 * ANTI-LOOKAHEAD (§10): every function takes an explicit `asOf` timestamp and
 * refuses to use any bar whose timestamp is strictly greater than `asOf`.
 * Coefficients are therefore computable point-in-time: `relationship(t)` can
 * only ever see data ≤ t. The no-lookahead tests prove this.
 *
 * PRINTED THRESHOLDS (all documented, none magic):
 *   CORRELATION_LABEL_THRESHOLD = 0.30  |ρ| below this is not typed as a
 *                                      correlation edge at all (§4: only label
 *                                      inverse when evidence supports it)
 *   STABILITY_FLIP_MIN          = 0.30  both observations |ρ| ≥ 0.30 with
 *                                      opposite sign → FLIPPING
 *   STABILITY_BREAK_DELTA       = 0.30  |Δρ| ≥ 0.30 vs the previous rolling
 *                                      observation → BREAKING
 *   STABILITY_TREND_DELTA       = 0.10  |ρ| moved ≥ 0.10 across the series →
 *                                      STRENGTHENING / WEAKENING
 *   QUALITY_GOOD_COVERAGE       = 0.90  coverage ≥ 90% → GOOD
 *   QUALITY_DEGRADED_COVERAGE   = 0.70  coverage ≥ 70% → DEGRADED
 *                                      below → INSUFFICIENT_DATA
 */

import {
    MIN_CORRELATION_OBSERVATIONS,
    alignReturns,
    correlationCoefficient,
    toReturns,
    type PriceSeries,
    type ReturnStyle,
} from "@/lib/portfolio/correlation";
import type {
    DataQuality,
    DataQualityStatus,
    Evidence,
    MarketRelationshipType,
    RelationshipObservation,
    RelationshipStability,
    RelationshipTerm,
    RelationshipWindow,
} from "./types";
import { relationshipTerm } from "./types";
import { RELATIONSHIP_ENGINE_VERSION } from "./versions";

/* ── Printed thresholds ───────────────────────────────────────────────────── */

export const CORRELATION_LABEL_THRESHOLD = 0.3;
export const STABILITY_FLIP_MIN = 0.3;
export const STABILITY_BREAK_DELTA = 0.3;
export const STABILITY_TREND_DELTA = 0.1;
export const QUALITY_GOOD_COVERAGE = 0.9;
export const QUALITY_DEGRADED_COVERAGE = 0.7;
export const DEFAULT_CORRELATION_METHOD: "pearson" | "spearman" = "pearson";
/** Rolling observations reconstructed for the stability series (§7). */
export const DEFAULT_OBSERVATION_COUNT = 5;

/* ── Pair identity ────────────────────────────────────────────────────────── */

/** Canonical unordered pair key so `XAUUSD|DXY` == `DXY|XAUUSD`. */
export function pairKey(a: string, b: string): string {
    return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/* ── Point-in-time helpers (§10) ──────────────────────────────────────────── */

/**
 * Drop every bar strictly after `asOf`. This is the single chokepoint that
 * makes the whole engine lookahead-safe: no other code path may slice series.
 */
export function truncateAt(series: PriceSeries, asOf: number): PriceSeries {
    let end = series.timestamps.length;
    for (let i = 0; i < series.timestamps.length; i += 1) {
        if (series.timestamps[i] > asOf) {
            end = i;
            break;
        }
    }
    return {
        symbol: series.symbol,
        timestamps: series.timestamps.slice(0, end),
        closes: series.closes.slice(0, end),
    };
}

/* ── Data quality (§45) ───────────────────────────────────────────────────── */

export function dataQualityOf(sampleSize: number, requiredBars: number): DataQuality {
    const missingBars = Math.max(0, requiredBars - sampleSize);
    const coverage = requiredBars > 0 ? Math.min(1, sampleSize / requiredBars) : 0;
    let status: DataQualityStatus;
    let reason: string | undefined;
    if (sampleSize < MIN_CORRELATION_OBSERVATIONS) {
        status = "INSUFFICIENT_DATA";
        reason = `Only ${sampleSize} aligned observation(s); at least ${MIN_CORRELATION_OBSERVATIONS} required.`;
    } else if (coverage >= QUALITY_GOOD_COVERAGE) {
        status = "GOOD";
    } else if (coverage >= QUALITY_DEGRADED_COVERAGE) {
        status = "DEGRADED";
        reason = `Coverage ${(coverage * 100).toFixed(0)}% of the requested window (${missingBars} missing bar(s)).`;
    } else {
        status = "INSUFFICIENT_DATA";
        reason = `Coverage ${(coverage * 100).toFixed(0)}% is below the ${QUALITY_DEGRADED_COVERAGE * 100}% floor — coefficient not reported.`;
    }
    return { sampleSize, requiredBars, dataCoverage: round4(coverage), missingBars, status, reason };
}

function round4(v: number): number {
    return Math.round(v * 10_000) / 10_000;
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

/* ── Relationship typing (§4) ─────────────────────────────────────────────── */

/**
 * Type a measured coefficient. Returns `null` when |ρ| is below the printed
 * label threshold — the pair then has NO typed relationship edge, because
 * "these move a bit together sometimes" is not a relationship worth showing.
 */
export function classifyRelationshipType(r: number | null): MarketRelationshipType | null {
    if (r === null || !Number.isFinite(r)) return null;
    if (r >= CORRELATION_LABEL_THRESHOLD) return "CORRELATION";
    if (r <= -CORRELATION_LABEL_THRESHOLD) return "INVERSE_CORRELATION";
    return null;
}

/* ── Stability (§7) ───────────────────────────────────────────────────────── */

/**
 * Classify a rolling coefficient series (OLDEST → NEWEST).
 *
 * Decision order:
 *   1. < 2 finite points                      → UNKNOWN
 *   2. sign change with both |ρ| ≥ FLIP_MIN   → FLIPPING
 *   3. |Δρ| ≥ BREAK_DELTA vs previous point   → BREAKING
 *   4. |ρ| moved ≥ TREND_DELTA vs first point → STRENGTHENING / WEAKENING
 *   5. otherwise                              → STABLE
 *
 * A single historical window never proves a stable relationship (§9) — the
 * label describes what was measured, nothing more.
 */
export function classifyStability(series: Array<number | null>): RelationshipStability {
    const values = series.filter((v): v is number => v !== null && Number.isFinite(v));
    if (values.length < 2) return "UNKNOWN";

    const curr = values[values.length - 1];
    const prev = values[values.length - 2];
    const first = values[0];

    const signChanged = curr * prev < 0;
    if (signChanged && Math.abs(curr) >= STABILITY_FLIP_MIN && Math.abs(prev) >= STABILITY_FLIP_MIN) {
        return "FLIPPING";
    }
    if (Math.abs(curr - prev) >= STABILITY_BREAK_DELTA) return "BREAKING";

    const drift = Math.abs(curr) - Math.abs(first);
    if (drift >= STABILITY_TREND_DELTA) return "STRENGTHENING";
    if (drift <= -STABILITY_TREND_DELTA) return "WEAKENING";
    return "STABLE";
}

/* ── Rolling observations (§5, §6) ────────────────────────────────────────── */

export interface RollingObservationInput {
    a: PriceSeries;
    b: PriceSeries;
    window: RelationshipWindow;
    asOf: number;
    method?: "pearson" | "spearman";
    returnStyle?: ReturnStyle;
    /** How many end-of-window observations to reconstruct (default 5). */
    observationCount?: number;
    /** Spacing between reconstructed windows in bars (default window/10). */
    observationStepBars?: number;
}

export interface RollingObservationSeries {
    observations: RelationshipObservation[];
    /** Coefficients oldest → newest, `null` where the window was under-sampled. */
    coefficients: Array<number | null>;
    /** Last aligned bar timestamp used (≤ asOf), 0 when nothing aligned. */
    dataTimestamp: number;
}

/**
 * Rebuild a short history of rolling coefficients ENDING at `asOf`.
 *
 * Each observation is computed strictly from bars ≤ its own window end, and
 * every window end is ≤ `asOf`, so the whole series is point-in-time safe.
 */
export function rollingObservations(input: RollingObservationInput): RollingObservationSeries {
    const method = input.method ?? DEFAULT_CORRELATION_METHOD;
    const style = input.returnStyle ?? "log";
    const window = input.window.bars;

    const left = truncateAt(input.a, input.asOf);
    const right = truncateAt(input.b, input.asOf);
    const aligned = alignReturns(toReturns(left, style), toReturns(right, style));
    const n = aligned.x.length;

    const count = Math.max(2, input.observationCount ?? DEFAULT_OBSERVATION_COUNT);
    const step = Math.max(1, input.observationStepBars ?? Math.max(1, Math.floor(window / 10)));

    const observations: RelationshipObservation[] = [];
    const coefficients: Array<number | null> = [];

    // Window end indices, newest first, then reversed to chronological order.
    const ends: number[] = [];
    for (let k = 0; k < count; k += 1) {
        const end = n - k * step;
        if (end < window) break;
        ends.push(end);
    }

    for (let i = ends.length - 1; i >= 0; i -= 1) {
        const end = ends[i];
        const start = end - window;
        const xs = aligned.x.slice(start, end);
        const ys = aligned.y.slice(start, end);
        const observedAt = aligned.timestamps[end - 1];
        const quality = dataQualityOf(xs.length, window);
        const coefficient =
            quality.status === "INSUFFICIENT_DATA" ? null : correlationCoefficient(xs, ys, method);
        coefficients.push(coefficient ?? null);
        observations.push({
            id: `obs:${pairKey(input.a.symbol, input.b.symbol)}:${input.window.timeframe}:${window}:${observedAt}`,
            observedAt,
            window: { ...input.window },
            method,
            coefficient,
            sampleSize: xs.length,
            dataQuality: quality,
        });
    }

    const dataTimestamp = observations.length > 0 ? observations[observations.length - 1].observedAt : 0;
    return { observations, coefficients, dataTimestamp };
}

/* ── Relationship result (§5) ─────────────────────────────────────────────── */

export interface RelationshipResult {
    a: string;
    b: string;
    window: RelationshipWindow;
    term: RelationshipTerm;
    method: "pearson" | "spearman";
    coefficient: number | null;
    previousCoefficient: number | null;
    delta: number | null;
    type: MarketRelationshipType | null;
    stability: RelationshipStability;
    observations: RelationshipObservation[];
    dataQuality: DataQuality;
    sampleSize: number;
    dataTimestamp: number;
    calculatedAt: number;
    /** 0..1 evidence confidence (coverage × sample sufficiency). Never a probability. */
    confidence: number;
    claims: Evidence[];
    limitations: string[];
}

export interface ComputeRelationshipInput extends RollingObservationInput {
    calculatedAt: number;
    /** Coefficient of the same pair/window from the previous snapshot, if any. */
    previousCoefficient?: number | null;
    /** Optional longer timeline (§23) — appended points for the explorer. */
    timelinePoints?: number;
}

/**
 * Compute one measured relationship with full evidence.
 *
 * The headline coefficient is the window ending at `asOf`. The stability
 * series is the reconstructed rolling history; `previousCoefficient` (when the
 * caller has an older snapshot) drives the change evidence.
 */
export function computeRelationship(input: ComputeRelationshipInput): RelationshipResult {
    const method = input.method ?? DEFAULT_CORRELATION_METHOD;
    const window = input.window;
    const roll = rollingObservations({
        ...input,
        observationCount: Math.max(input.observationCount ?? DEFAULT_OBSERVATION_COUNT, input.timelinePoints ?? 0),
    });

    const observations = roll.observations;
    const latest = observations.length > 0 ? observations[observations.length - 1] : null;
    const coefficient = latest?.coefficient ?? null;
    const sampleSize = latest?.sampleSize ?? 0;
    const quality = latest?.dataQuality ?? dataQualityOf(0, window.bars);

    const previous = input.previousCoefficient ?? null;
    const previousObservation = observations.length >= 2 ? observations[observations.length - 2].coefficient : null;
    const stability = classifyStability(roll.coefficients);
    const delta = coefficient !== null && previous !== null ? round4(coefficient - previous) : null;

    const term = relationshipTerm(window.bars);
    const type = quality.status === "GOOD" || quality.status === "DEGRADED"
        ? classifyRelationshipType(coefficient)
        : null;

    const confidence =
        quality.status === "INSUFFICIENT_DATA" || coefficient === null
            ? 0
            : round4(
                  Math.min(1, quality.dataCoverage) *
                      Math.min(1, sampleSize / (2 * MIN_CORRELATION_OBSERVATIONS))
              );

    /* Evidence (§5) — measured numbers only. */
    const claims: Evidence[] = [];
    const pairLabel = `${input.a.symbol} ↔ ${input.b.symbol}`;

    if (coefficient !== null) {
        claims.push({
            id: `ev:rho:${pairKey(input.a.symbol, input.b.symbol)}:${window.timeframe}:${window.bars}`,
            kind: "OBSERVED",
            source: `relationship:${method}`,
            text: `${pairLabel} rolling ${method} correlation is ${coefficient.toFixed(2)} over ${sampleSize} aligned ${window.timeframe} bars (window ${window.bars}).`,
            value: coefficient,
            dataTimestamp: roll.dataTimestamp,
        });
    } else {
        claims.push({
            id: `ev:rho-na:${pairKey(input.a.symbol, input.b.symbol)}:${window.timeframe}:${window.bars}`,
            kind: "OBSERVED",
            source: "relationship:insufficient",
            text: `${pairLabel} correlation is not reported: ${quality.reason ?? "insufficient aligned data."}`,
            dataTimestamp: roll.dataTimestamp,
        });
    }

    if (coefficient !== null && previous !== null && delta !== null) {
        claims.push({
            id: `ev:delta:${pairKey(input.a.symbol, input.b.symbol)}:${window.timeframe}:${window.bars}`,
            kind: "CALCULATED",
            source: "relationship:change",
            text: `Correlation moved from ${previous.toFixed(2)} to ${coefficient.toFixed(2)} (${delta >= 0 ? "+" : ""}${delta.toFixed(2)}) against the previous stored window.`,
            value: delta,
            dataTimestamp: roll.dataTimestamp,
        });
    }

    if (stability !== "UNKNOWN" && previousObservation !== null) {
        claims.push({
            id: `ev:stability:${pairKey(input.a.symbol, input.b.symbol)}:${window.timeframe}:${window.bars}`,
            kind: "CALCULATED",
            source: "relationship:stability",
            text: `Stability classified ${stability} from ${observations.length} consecutive rolling windows (thresholds: flip ${STABILITY_FLIP_MIN}, break Δ${STABILITY_BREAK_DELTA}, trend Δ${STABILITY_TREND_DELTA}).`,
            dataTimestamp: roll.dataTimestamp,
        });
    }

    claims.push({
        id: `ev:config:${pairKey(input.a.symbol, input.b.symbol)}:${window.timeframe}:${window.bars}`,
        kind: "CONFIGURED",
        source: "relationship:config",
        text: `Window ${window.bars} ${window.timeframe} bars, method ${method}, label threshold |ρ| ≥ ${CORRELATION_LABEL_THRESHOLD}, engine ${RELATIONSHIP_ENGINE_VERSION}.`,
    });

    const limitations: string[] = [
        "Correlation describes co-movement of past returns; it is not a forecast, a causal claim or a trading signal (§56, §57).",
    ];
    if (quality.status !== "GOOD") {
        limitations.push(quality.reason ?? "Data coverage for this window is incomplete.");
    }
    if (term === "SHORT_TERM") {
        limitations.push("Short-window relationships are noisier and change faster than long-window ones.");
    }

    return {
        a: input.a.symbol,
        b: input.b.symbol,
        window: { ...window },
        term,
        method,
        coefficient,
        previousCoefficient: previous,
        delta,
        type,
        stability,
        observations,
        dataQuality: quality,
        sampleSize,
        dataTimestamp: roll.dataTimestamp,
        calculatedAt: input.calculatedAt,
        confidence,
        claims,
        limitations,
    };
}

/* ── Matrix convenience (explorer §22) ────────────────────────────────────── */

export interface CorrelationCell {
    a: string;
    b: string;
    coefficient: number | null;
    status: DataQualityStatus;
}

/** Symmetric matrix cells for a symbol list (diagonal is 1 by definition). */
export function correlationMatrixCells(
    results: RelationshipResult[],
    symbols: string[]
): CorrelationCell[] {
    const byKey = new Map(results.map((r) => [pairKey(r.a, r.b), r]));
    const cells: CorrelationCell[] = [];
    for (let i = 0; i < symbols.length; i += 1) {
        for (let j = i; j < symbols.length; j += 1) {
            if (i === j) {
                cells.push({ a: symbols[i], b: symbols[j], coefficient: 1, status: "GOOD" });
                continue;
            }
            const r = byKey.get(pairKey(symbols[i], symbols[j]));
            cells.push({
                a: symbols[i],
                b: symbols[j],
                coefficient: r?.coefficient ?? null,
                status: r?.dataQuality.status ?? "UNAVAILABLE",
            });
        }
    }
    return cells;
}

/** Format a coefficient for display: `−0.72`, `n/a`. */
export function formatCoefficient(r: number | null): string {
    return r === null ? "n/a" : `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}`;
}

export { round2 };
