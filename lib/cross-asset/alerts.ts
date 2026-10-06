/**
 * AlgoVault — Cross-Asset Alerts (Phase 16 §36).
 *
 * PURE evaluation against the ONE stored market graph — this extends the
 * existing Alerts infrastructure (`app/api/alerts/*`, `alerts/{uid}` RTDB
 * node) instead of creating a second notification engine.
 *
 * Supported alert types (all fail-closed: no stored graph → no trigger, and
 * the caller records why):
 *   correlation_above   measured ρ ≥ targetCorrelation
 *   correlation_below   measured ρ ≤ targetCorrelation
 *   relationship_flip   stability FLIPPING or sign change vs stored previous
 *   regime_change       active regime states differ from the stored baseline
 *   volatility_expand   volatility axis moved to HIGH_VOLATILITY
 *   correlated_exposure portfolio share correlated with `symbol` ≥ target
 *
 * Every trigger message cites the measured numbers and the window — an alert
 * without evidence is not delivered (§5).
 */

import type { MarketGraphSnapshot, MarketRegimeState } from "./types";

export interface CrossAssetAlert {
    id: string;
    symbol: string;
    type:
        | "correlation_above"
        | "correlation_below"
        | "relationship_flip"
        | "regime_change"
        | "volatility_expand"
        | "correlated_exposure";
    /** Counterparty symbol for pair alerts (e.g. DXY for XAUUSD). */
    pair?: string;
    /** Threshold ρ for correlation_above / correlation_below. */
    targetCorrelation?: number;
    /** Threshold (0..1) for correlated_exposure. */
    targetExposure?: number;
    /** Baseline captured when the alert was created (regime/volatility). */
    baseline?: string;
    createdAt: number;
    triggered?: boolean;
}

export interface AlertEvaluation {
    triggered: boolean;
    /** Why it did NOT fire — surfaced as an observability reason, never silence. */
    reason: string;
    message?: string;
}

/** Snapshot too old to judge an alert on (relative to `now`). */
export const STALE_SNAPSHOT_MS = 6 * 3_600_000;

const NOT_TRIGGERED = (reason: string): AlertEvaluation => ({ triggered: false, reason });

function edgeFor(
    snapshot: MarketGraphSnapshot,
    a: string,
    b: string
): { coefficient: number | null; previous: number | null; stability: string; window: string } | null {
    const A = a.toUpperCase();
    const B = b.toUpperCase();
    for (const edge of snapshot.edges) {
        if (edge.coefficient === null) continue;
        if (edge.relationshipType !== "CORRELATION" && edge.relationshipType !== "INVERSE_CORRELATION") continue;
        const src = edge.sourceNodeId.replace(/^instrument:/, "");
        const tgt = edge.targetNodeId.replace(/^instrument:/, "");
        if ((src === A && tgt === B) || (src === B && tgt === A)) {
            const prevClaim = edge.claims.find((c) => c.kind === "CALCULATED" && c.text.startsWith("Correlation moved"));
            const prevMatch = prevClaim?.text.match(/from (-?\d+\.\d+)/);
            return {
                coefficient: edge.coefficient,
                previous: prevMatch ? Number(prevMatch[1]) : null,
                stability: edge.stability,
                window: `${edge.window.bars} ${edge.window.timeframe}`,
            };
        }
    }
    return null;
}

function activeStates(snapshot: MarketGraphSnapshot): string[] {
    return snapshot.regime?.activeStates ?? [];
}

/** Evaluate one cross-asset alert against the latest stored graph. */
export function evaluateCrossAssetAlert(
    alert: CrossAssetAlert,
    snapshot: MarketGraphSnapshot | null,
    now: number
): AlertEvaluation {
    if (!snapshot) return NOT_TRIGGERED("no_stored_graph");
    if (now - snapshot.createdAt > STALE_SNAPSHOT_MS) return NOT_TRIGGERED("stale_graph");
    if (alert.triggered) return NOT_TRIGGERED("already_triggered");

    const window = `${snapshot.window.bars} ${snapshot.window.timeframe}`;

    switch (alert.type) {
        case "correlation_above":
        case "correlation_below": {
            if (!alert.pair) return NOT_TRIGGERED("missing_pair");
            if (typeof alert.targetCorrelation !== "number") return NOT_TRIGGERED("missing_threshold");
            const edge = edgeFor(snapshot, alert.symbol, alert.pair);
            if (!edge || edge.coefficient === null) return NOT_TRIGGERED("no_measured_relationship");
            const fire =
                alert.type === "correlation_above"
                    ? edge.coefficient >= alert.targetCorrelation
                    : edge.coefficient <= alert.targetCorrelation;
            if (!fire) return NOT_TRIGGERED("threshold_not_crossed");
            return {
                triggered: true,
                reason: "threshold_crossed",
                message: `${alert.symbol} ↔ ${alert.pair} correlation is ${edge.coefficient.toFixed(2)} (threshold ${alert.type === "correlation_above" ? "≥" : "≤"} ${alert.targetCorrelation.toFixed(2)}, window ${window}).`,
            };
        }
        case "relationship_flip": {
            if (!alert.pair) return NOT_TRIGGERED("missing_pair");
            const edge = edgeFor(snapshot, alert.symbol, alert.pair);
            if (!edge) return NOT_TRIGGERED("no_measured_relationship");
            const flipped =
                edge.stability === "FLIPPING" ||
                (edge.previous !== null && edge.coefficient !== null && edge.previous * edge.coefficient < 0);
            if (!flipped) return NOT_TRIGGERED("no_flip_observed");
            return {
                triggered: true,
                reason: "flip_observed",
                message: `${alert.symbol} ↔ ${alert.pair} relationship flipped: ${edge.previous?.toFixed(2) ?? "n/a"} → ${edge.coefficient?.toFixed(2) ?? "n/a"} (stability ${edge.stability}, window ${window}).`,
            };
        }
        case "regime_change": {
            const states = activeStates(snapshot);
            if (states.length === 0) return NOT_TRIGGERED("regime_unknown");
            const baseline = new Set(
                String(alert.baseline ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
            );
            const current = new Set(states);
            const changed =
                baseline.size === 0
                    ? false
                    : states.some((s) => !baseline.has(s)) || Array.from(baseline).some((s) => !current.has(s));
            if (!changed) return NOT_TRIGGERED("no_regime_change");
            return {
                triggered: true,
                reason: "regime_changed",
                message: `Regime changed for ${alert.symbol}: baseline [${Array.from(baseline).join(", ")}] → now [${states.join(", ")}] (data ${snapshot.dataTimestamp}).`,
            };
        }
        case "volatility_expand": {
            const volAxis = snapshot.regime?.states?.volatility ?? "UNKNOWN";
            const baselineVol = String(alert.baseline ?? "");
            if (volAxis !== "HIGH_VOLATILITY") return NOT_TRIGGERED("volatility_not_expanded");
            if (baselineVol === "HIGH_VOLATILITY") return NOT_TRIGGERED("already_high_volatility");
            return {
                triggered: true,
                reason: "volatility_expanded",
                message: `Volatility axis expanded to HIGH_VOLATILITY (baseline ${baselineVol || "unknown"}, window ${window}).`,
            };
        }
        case "correlated_exposure": {
            const impact = correlatedExposureOf(snapshot, alert.symbol);
            if (impact === null) return NOT_TRIGGERED("no_portfolio_context");
            const threshold = alert.targetExposure ?? 0.3;
            if (impact < threshold) return NOT_TRIGGERED("threshold_not_crossed");
            return {
                triggered: true,
                reason: "exposure_threshold_crossed",
                message: `Correlated exposure around ${alert.symbol} is ${(impact * 100).toFixed(1)}% (threshold ${(threshold * 100).toFixed(0)}%) in the stored graph.`,
            };
        }
        default:
            return NOT_TRIGGERED("unknown_type");
    }
}

/**
 * Correlated share stored on the graph's regime/edges is not portfolio-aware
 * (the graph is global). This helper reports the graph-side proxy: share of
 * measured strong pairs touching `symbol`. Portfolio-accurate warnings live in
 * `buildPortfolioImpact` (§24). Kept explicit so an alert never claims more
 * than the data supports.
 */
function correlatedExposureOf(snapshot: MarketGraphSnapshot, symbol: string): number | null {
    const A = symbol.toUpperCase();
    const strong = snapshot.edges.filter((e) => {
        if (e.coefficient === null) return false;
        if (e.relationshipType !== "CORRELATION" && e.relationshipType !== "INVERSE_CORRELATION") return false;
        const src = e.sourceNodeId.replace(/^instrument:/, "");
        const tgt = e.targetNodeId.replace(/^instrument:/, "");
        return (src === A || tgt === A) && Math.abs(e.coefficient) >= 0.6;
    });
    const total = snapshot.edges.filter(
        (e) => e.relationshipType === "CORRELATION" || e.relationshipType === "INVERSE_CORRELATION"
    ).length;
    if (total === 0) return null;
    return Math.round((strong.length / total) * 10_000) / 10_000;
}

/** Regime baseline string for an alert created "now" (used by the API route). */
export function regimeBaseline(snapshot: MarketGraphSnapshot | null): string {
    if (!snapshot) return "";
    return activeStates(snapshot).join(",");
}

export type { MarketRegimeState };
