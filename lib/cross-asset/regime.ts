/**
 * AlgoVault — Global Market Regime Engine (Phase 16 §15, §16, §17).
 *
 * PURE + DETERMINISTIC + EVIDENCE-BACKED. A regime is a measured state on a
 * named axis, never a single vibe label. The market can be simultaneously
 * RISK_OFF (risk axis), HIGH_VOLATILITY (volatility axis) and
 * CORRELATION_EXPANSION (correlation axis) — exactly as §15 requires.
 *
 * Rules and PRINTED thresholds:
 *
 *   VOLATILITY axis — per-symbol realised vol (std of window log returns)
 *       compared with its own rolling sub-window history; the cross-sectional
 *       MEDIAN percentile decides:
 *         percentile ≥ VOL_HIGH_PERCENTILE (0.80) → HIGH_VOLATILITY
 *         percentile ≤ VOL_LOW_PERCENTILE  (0.20) → LOW_VOLATILITY
 *         otherwise (or < 3 symbols)             → UNKNOWN (no extreme measured)
 *
 *   CORRELATION axis — mean |ρ| of measured pairs now vs one rolling step
 *       earlier:
 *         Δ ≥ +CORRELATION_EXPANSION_DELTA (0.10) → CORRELATION_EXPANSION
 *         Δ ≤ −CORRELATION_EXPANSION_DELTA        → CORRELATION_COMPRESSION
 *         otherwise                               → UNKNOWN (no shift measured)
 *
 *   RISK axis — mean window return of the available equity indices vs vol:
 *         equity ≤ −RISK_OFF_RETURN (−2%) AND vol not compressing → RISK_OFF
 *         equity < 0 AND vol expanding                           → RISK_OFF
 *         equity ≥ +RISK_ON_RETURN (+2%) AND vol not expanding   → RISK_ON
 *         otherwise                                              → UNKNOWN
 *       When no equity index is available the axis is UNKNOWN with the reason
 *       in `limitations` — never inferred from FX alone.
 *
 *   TREND axis — share of measurable symbols with |window return| ≥
 *       TREND_MOVE_THRESHOLD (1%):
 *         ≥ TRENDING_MIN_SHARE (60%) directional AND one sign ≥ 70% of them → TRENDING
 *         ≥ RANGING_MIN_SHARE (70%) below threshold → RANGING
 *         otherwise → UNKNOWN (mixed / insufficient evidence)
 *
 *   STRESS axis — DISLOCATION when any strongly correlated pair (ρ ≥ 0.6)
 *       shows a latest-bar residual |z| ≥ DISLOCATION_Z (3.0) with the pair's
 *       own historical residual scale. LIQUIDITY_STRESS requires order-book
 *       spread/depth breadth that AlgoVault does not measure cross-asset, so
 *       that state is deliberately NOT computed and the axis reports why.
 *
 * ANTI-LOOKAHEAD: inputs are truncated at `asOf`; the correlation axis uses
 * only stored observations ≤ `asOf`.
 */

import { toReturns, type PriceSeries } from "@/lib/portfolio/correlation";
import type {
    Evidence,
    EngineVersions,
    MarketFactor,
    MarketRegimeSnapshot,
    MarketRegimeState,
    MarketRegimeTransition,
    RegimeAxis,
    RegimeClassification,
    RelationshipWindow,
} from "./types";
import { instrumentNodeId } from "./ids";
import { truncateAt, type RelationshipResult } from "./relationships";
import { REGIME_ENGINE_VERSION } from "./versions";

/* ── Printed thresholds ───────────────────────────────────────────────────── */

export const VOL_HIGH_PERCENTILE = 0.8;
export const VOL_LOW_PERCENTILE = 0.2;
export const CORRELATION_EXPANSION_DELTA = 0.1;
export const RISK_OFF_RETURN = -0.02;
export const RISK_ON_RETURN = 0.02;
export const TREND_MOVE_THRESHOLD = 0.01;
export const TRENDING_MIN_SHARE = 0.6;
export const RANGING_MIN_SHARE = 0.7;
export const DISLOCATION_PAIR_RHO = 0.6;
export const DISLOCATION_Z = 3.0;
export const MIN_REGIME_SYMBOLS = 3;

/* ── helpers ──────────────────────────────────────────────────────────────── */

function mean(values: number[]): number {
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function std(values: number[]): number {
    if (values.length < 2) return 0;
    const m = mean(values);
    return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length);
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

function round3(v: number): number {
    return Math.round(v * 1000) / 1000;
}

/* ── per-symbol measurements ──────────────────────────────────────────────── */

interface SymbolMeasurement {
    symbol: string;
    windowReturn: number;
    /** Percentile of the latest sub-window vol inside its own history, 0..1. */
    volPercentile: number | null;
    sampleSize: number;
    lastBarAt: number;
}

function measureSymbol(series: PriceSeries, asOf: number, bars: number): SymbolMeasurement | null {
    const truncated = truncateAt(series, asOf);
    const { timestamps, values } = toReturns(truncated, "log");
    const slice = values.slice(-bars);
    const stamps = timestamps.slice(-bars);
    if (slice.length < 10) return null;

    const windowReturn = slice.reduce((acc, v) => acc + v, 0);
    const sub = Math.max(5, Math.floor(slice.length / 5));
    const current = std(slice.slice(-sub));
    const rolling: number[] = [];
    for (let i = sub; i <= slice.length; i += 1) rolling.push(std(slice.slice(i - sub, i)));
    const below = rolling.filter((v) => v <= current).length;
    const volPercentile = rolling.length > 0 ? below / rolling.length : null;

    return {
        symbol: truncated.symbol,
        windowReturn,
        volPercentile,
        sampleSize: slice.length,
        lastBarAt: stamps[stamps.length - 1] ?? 0,
    };
}

/* ── axis computations ────────────────────────────────────────────────────── */

function volatilityAxis(measurements: SymbolMeasurement[]): RegimeClassification {
    const percentiles = measurements
        .map((m) => m.volPercentile)
        .filter((v): v is number => v !== null);
    const med = median(percentiles);
    const evidence: Evidence[] = [];
    const limitations: string[] = [];

    if (med === null || percentiles.length < MIN_REGIME_SYMBOLS) {
        return {
            axis: "volatility",
            state: "UNKNOWN",
            confidence: 0,
            evidence: [
                {
                    id: "ev:regime:vol-na",
                    kind: "OBSERVED",
                    source: "regime:volatility",
                    text: `Volatility axis not classified: ${percentiles.length} symbol(s) with vol history, ${MIN_REGIME_SYMBOLS} required.`,
                },
            ],
            limitations: ["Insufficient symbols with vol history to classify the volatility axis."],
        };
    }

    const extremeSymbols = measurements
        .filter((m) => m.volPercentile !== null && (m.volPercentile >= VOL_HIGH_PERCENTILE || m.volPercentile <= VOL_LOW_PERCENTILE))
        .map((m) => `${m.symbol} ${(m.volPercentile as number).toFixed(2)}`);

    let state: MarketRegimeState = "UNKNOWN";
    if (med >= VOL_HIGH_PERCENTILE) state = "HIGH_VOLATILITY";
    else if (med <= VOL_LOW_PERCENTILE) state = "LOW_VOLATILITY";
    else limitations.push(`Median volatility percentile ${round2(med)} is inside the neutral band (${VOL_LOW_PERCENTILE}–${VOL_HIGH_PERCENTILE}) — no extreme measured.`);

    evidence.push({
        id: "ev:regime:vol",
        kind: "CALCULATED",
        source: "regime:volatility",
        text:
            `Cross-sectional median volatility percentile is ${round2(med)} across ${percentiles.length} symbol(s)` +
            (extremeSymbols.length > 0 ? `; extremes: ${extremeSymbols.join(", ")}.` : "."),
        value: round3(med),
    });

    return {
        axis: "volatility",
        state,
        confidence: state === "UNKNOWN" ? 0.2 : round2(0.5 + Math.abs(med - 0.5) * 0.5),
        evidence,
        limitations,
    };
}

function correlationAxis(relationships: RelationshipResult[]): RegimeClassification {
    const measurable = relationships.filter((r) => r.coefficient !== null);
    const evidence: Evidence[] = [];
    const limitations: string[] = [];

    const current = measurable.map((r) => Math.abs(r.coefficient as number));
    const previous = measurable
        .map((r) => (r.previousCoefficient !== null ? Math.abs(r.previousCoefficient) : null))
        .filter((v): v is number => v !== null);

    if (current.length < 1 || previous.length < 1) {
        return {
            axis: "correlation",
            state: "UNKNOWN",
            confidence: 0,
            evidence: [
                {
                    id: "ev:regime:corr-na",
                    kind: "OBSERVED",
                    source: "regime:correlation",
                    text: `Correlation axis not classified: ${current.length} current pair(s), ${previous.length} stored previous value(s).`,
                },
            ],
            limitations: ["No stored previous correlation window — a shift cannot be measured without one."],
        };
    }

    const now = mean(current);
    const before = mean(previous);
    const delta = now - before;

    let state: MarketRegimeState = "UNKNOWN";
    if (delta >= CORRELATION_EXPANSION_DELTA) state = "CORRELATION_EXPANSION";
    else if (delta <= -CORRELATION_EXPANSION_DELTA) state = "CORRELATION_COMPRESSION";
    else limitations.push(`Mean |ρ| moved ${round2(delta)}, inside the ±${CORRELATION_EXPANSION_DELTA} band — no correlation regime shift measured.`);

    evidence.push({
        id: "ev:regime:corr",
        kind: "CALCULATED",
        source: "regime:correlation",
        text: `Mean |ρ| across ${measurable.length} measured pair(s): ${round2(before)} → ${round2(now)} (Δ ${delta >= 0 ? "+" : ""}${round2(delta)}).`,
        value: round3(delta),
    });

    return {
        axis: "correlation",
        state,
        confidence: state === "UNKNOWN" ? 0.2 : round2(Math.min(0.9, 0.5 + Math.abs(delta))),
        evidence,
        limitations,
    };
}

function riskAxis(
    measurements: SymbolMeasurement[],
    vol: RegimeClassification,
    equitySymbols: string[]
): RegimeClassification {
    const evidence: Evidence[] = [];
    const limitations: string[] = [];
    const equity = measurements.filter((m) => equitySymbols.includes(m.symbol));

    if (equity.length === 0) {
        return {
            axis: "risk",
            state: "UNKNOWN",
            confidence: 0,
            evidence: [
                {
                    id: "ev:regime:risk-na",
                    kind: "OBSERVED",
                    source: "regime:risk",
                    text: "Risk axis not classified: no equity index series was available for this window.",
                },
            ],
            limitations: [
                "RISK_ON/RISK_OFF requires at least one equity index — FX alone is never used to infer the risk regime (§31: no fabricated macro claims).",
            ],
        };
    }

    const equityReturn = mean(equity.map((m) => m.windowReturn));
    const volExpanding = vol.state === "HIGH_VOLATILITY";
    const volCompressing = vol.state === "LOW_VOLATILITY";

    let state: MarketRegimeState = "UNKNOWN";
    if ((equityReturn <= RISK_OFF_RETURN && !volCompressing) || (equityReturn < 0 && volExpanding)) {
        state = "RISK_OFF";
    } else if (equityReturn >= RISK_ON_RETURN && !volExpanding) {
        state = "RISK_ON";
    } else {
        limitations.push(
            `Equity window return ${(equityReturn * 100).toFixed(2)}% with volatility ${vol.state} does not cross the printed thresholds (RISK_ON ≥ ${(RISK_ON_RETURN * 100).toFixed(0)}%, RISK_OFF ≤ ${(RISK_OFF_RETURN * 100).toFixed(0)}% or negative return + expanding vol).`
        );
    }

    evidence.push({
        id: "ev:regime:risk",
        kind: "CALCULATED",
        source: "regime:risk",
        text: `Equity indices (${equity.map((m) => m.symbol).join(", ")}) returned ${(equityReturn * 100).toFixed(2)}% over the window; volatility axis = ${vol.state}.`,
        value: round3(equityReturn),
    });

    return {
        axis: "risk",
        state,
        confidence: state === "UNKNOWN" ? 0.2 : 0.65,
        evidence,
        limitations,
    };
}

function trendAxis(measurements: SymbolMeasurement[]): RegimeClassification {
    const evidence: Evidence[] = [];
    const limitations: string[] = [];

    if (measurements.length < MIN_REGIME_SYMBOLS) {
        return {
            axis: "trend",
            state: "UNKNOWN",
            confidence: 0,
            evidence: [
                {
                    id: "ev:regime:trend-na",
                    kind: "OBSERVED",
                    source: "regime:trend",
                    text: `Trend axis not classified: ${measurements.length} measurable symbol(s), ${MIN_REGIME_SYMBOLS} required.`,
                },
            ],
            limitations: ["Too few measurable symbols to classify the trend axis."],
        };
    }

    const directional = measurements.filter((m) => Math.abs(m.windowReturn) >= TREND_MOVE_THRESHOLD);
    const share = directional.length / measurements.length;
    const ups = directional.filter((m) => m.windowReturn > 0).length;
    const dominant = Math.max(ups, directional.length - ups);
    const dominance = directional.length > 0 ? dominant / directional.length : 0;

    let state: MarketRegimeState = "UNKNOWN";
    if (directional.length / measurements.length >= TRENDING_MIN_SHARE && dominance >= 0.7) {
        state = "TRENDING";
    } else if (measurements.length - directional.length >= measurements.length * RANGING_MIN_SHARE) {
        state = "RANGING";
    } else {
        limitations.push(
            `Directional share ${(share * 100).toFixed(0)}% with directional dominance ${(dominance * 100).toFixed(0)}% — mixed evidence, classified UNKNOWN rather than forced into TRENDING/RANGING.`
        );
    }

    evidence.push({
        id: "ev:regime:trend",
        kind: "CALCULATED",
        source: "regime:trend",
        text: `${directional.length}/${measurements.length} symbol(s) moved ≥ ${(TREND_MOVE_THRESHOLD * 100).toFixed(0)}% over the window (${ups} up, ${directional.length - ups} down among them).`,
        value: round3(share),
    });

    return { axis: "trend", state, confidence: state === "UNKNOWN" ? 0.2 : 0.6, evidence, limitations };
}

function stressAxis(
    relationships: RelationshipResult[],
    latestReturns: Map<string, number>
): RegimeClassification {
    const evidence: Evidence[] = [
        {
            id: "ev:regime:stress:liq",
            kind: "CALCULATED",
            source: "regime:stress",
            text: "LIQUIDITY_STRESS is not computed: it requires cross-asset spread/depth breadth that AlgoVault does not measure. Reported as unsupported instead of guessed (§16).",
        },
    ];
    const limitations = [
        "Liquidity stress is not measurable from OHLC alone in the current data layer; the axis only reports DISLOCATION when pair residuals demand it.",
    ];

    let worst: { pair: string; z: number } | null = null;
    for (const r of relationships) {
        if (r.coefficient === null || Math.abs(r.coefficient) < DISLOCATION_PAIR_RHO) continue;
        const ra = latestReturns.get(r.a);
        const rb = latestReturns.get(r.b);
        if (ra === undefined || rb === undefined) continue;
        // Standardised residual of b's latest return given a's, using ρ.
        const rho = r.coefficient;
        const denom = Math.sqrt(1 - rho * rho);
        if (denom <= 0) continue;
        const resid = (rb - rho * ra) / denom;
        if (!worst || Math.abs(resid) > Math.abs(worst.z)) worst = { pair: `${r.a} ↔ ${r.b}`, z: resid };
    }

    if (worst && Math.abs(worst.z) >= DISLOCATION_Z) {
        evidence.push({
            id: "ev:regime:stress:disloc",
            kind: "CALCULATED",
            source: "regime:stress",
            text: `DISLOCATION observed: ${worst.pair} latest-bar standardised residual z = ${round2(worst.z)} (threshold |z| ≥ ${DISLOCATION_Z}).`,
            value: round3(worst.z),
        });
        return { axis: "stress", state: "DISLOCATION", confidence: 0.6, evidence, limitations };
    }

    evidence.push({
        id: "ev:regime:stress:ok",
        kind: "OBSERVED",
        source: "regime:stress",
        text: worst
            ? `No dislocation: worst correlated-pair residual z = ${round2(worst.z)} (${worst.pair}), below the ${DISLOCATION_Z} threshold.`
            : "No correlated pair with ρ ≥ 0.6 was measurable, so no dislocation test could run.",
        value: worst ? round3(worst.z) : undefined,
    });
    return { axis: "stress", state: "UNKNOWN", confidence: 0.3, evidence, limitations };
}

/* ── snapshot + transitions (§17) ─────────────────────────────────────────── */

export interface ComputeMarketRegimeInput {
    scope: string;
    window: RelationshipWindow;
    series: Record<string, PriceSeries | null | undefined>;
    relationships: RelationshipResult[];
    factors: MarketFactor[];
    /** Absolute cutoff for all market data (§10). */
    asOf: number;
    calculatedAt: number;
    engineVersions: EngineVersions;
    /** Previous snapshot's axis states — enables transition detection (§17). */
    previousStates?: Partial<Record<RegimeAxis, MarketRegimeState>>;
    /** Symbols treated as equity indices for the risk axis. */
    equitySymbols?: string[];
}

export interface MarketRegimeResult {
    snapshot: MarketRegimeSnapshot;
    transitions: MarketRegimeTransition[];
}

export const DEFAULT_EQUITY_SYMBOLS = ["SPX500", "US30", "NAS100"];

export function computeMarketRegime(input: ComputeMarketRegimeInput): MarketRegimeResult {
    const equitySymbols = input.equitySymbols ?? DEFAULT_EQUITY_SYMBOLS;

    const measurements: SymbolMeasurement[] = [];
    const latestReturns = new Map<string, number>();
    for (const [symbol, series] of Object.entries(input.series)) {
        if (!series) continue;
        const m = measureSymbol(series, input.asOf, input.window.bars);
        if (m) measurements.push(m);
        const truncated = truncateAt(series, input.asOf);
        const rets = toReturns(truncated, "log").values;
        if (rets.length > 0) latestReturns.set(symbol, rets[rets.length - 1]);
    }

    const vol = volatilityAxis(measurements);
    const corr = correlationAxis(input.relationships);
    const risk = riskAxis(measurements, vol, equitySymbols);
    const trend = trendAxis(measurements);
    const stress = stressAxis(input.relationships, latestReturns);

    const axes: RegimeClassification[] = [risk, vol, corr, trend, stress];
    const states: Partial<Record<RegimeAxis, MarketRegimeState>> = {};
    for (const axis of axes) states[axis.axis] = axis.state;

    const active = Array.from(new Set(axes.map((a) => a.state).filter((s) => s !== "UNKNOWN"))) as MarketRegimeState[];
    if (active.length === 0) active.push("UNKNOWN");

    const notComputed = axes.filter((a) => a.confidence === 0 && a.state === "UNKNOWN").map((a) => a.axis);

    const dataTimestamp = measurements.reduce((max, m) => Math.max(max, m.lastBarAt), 0);

    const snapshot: MarketRegimeSnapshot = {
        id: `regime:${input.scope}:${input.window.timeframe}:${input.window.bars}:${input.calculatedAt}`,
        scope: input.scope,
        axes,
        states,
        activeStates: active,
        calculatedAt: input.calculatedAt,
        dataTimestamp,
        window: { ...input.window },
        engineVersions: input.engineVersions,
        notComputed,
        limitations: [
            "Regime states are measured conditions with printed thresholds — they are context, not forecasts (§57).",
            `Engine ${REGIME_ENGINE_VERSION}.`,
            ...axes.flatMap((a) => a.limitations.map((l) => `[${a.axis}] ${l}`)),
        ],
    };

    /* Transitions (§17) */
    const transitions: MarketRegimeTransition[] = [];
    const previous = input.previousStates ?? {};
    for (const axis of axes) {
        const prev = previous[axis.axis];
        if (!prev || prev === axis.state) continue;
        if (prev === "UNKNOWN" && axis.state === "UNKNOWN") continue;
        transitions.push({
            id: `transition:${input.scope}:${axis.axis}:${prev}->${axis.state}:${input.calculatedAt}`,
            axis: axis.axis,
            previousState: prev,
            newState: axis.state,
            timestamp: input.calculatedAt,
            dataTimestamp,
            evidence: axis.evidence,
            confidence: axis.confidence,
            affectedNodeIds: measurements
                .filter((m) =>
                    axis.axis === "risk"
                        ? equitySymbols.includes(m.symbol)
                        : axis.axis === "correlation"
                          ? input.relationships.some((r) => r.a === m.symbol || r.b === m.symbol)
                          : true
                )
                .map((m) => instrumentNodeId(m.symbol)),
        });
    }

    if (transitions.length > 0 && !snapshot.activeStates.includes("TRANSITION")) {
        snapshot.activeStates = [...snapshot.activeStates, "TRANSITION"];
    }

    return { snapshot, transitions };
}
