/**
 * AlgoVault — Cross-Asset Events (Phase 16 §8, §17, §18).
 *
 * PURE + DETERMINISTIC. Turns measured relationship / regime / cluster changes
 * into structured `CrossAssetSignal`s. Signals are OBSERVATIONS with evidence —
 * they are never converted into LONG/SHORT (§18, §57).
 *
 * Lifecycle (deterministic, reconciled against the stored history):
 *   DETECTED    — first computation that observes the condition.
 *   CONFIRMED   — the same condition was observed again on a LATER bar
 *                 (two distinct dataTimestamps), so it is not a single-bar
 *                 artefact.
 *   EXPIRED     — not re-observed within twice the measurement window.
 *   INVALIDATED — the condition was re-observed with the OPPOSITE sign (e.g. a
 *                 break that re-strengthened) — set by `reconcileSignals`.
 *
 * Ids are deterministic (`signal:{type}:{subject}:{window}:{dataTimestamp}`),
 * so recomputing the same snapshot is idempotent and cannot spam history.
 */

import type {
    CrossAssetSignal,
    CrossAssetSignalStatus,
    CrossAssetSignalType,
    Evidence,
    MarketCluster,
    MarketRegimeTransition,
    RelationshipWindow,
    SymbolRelationshipSummary,
} from "./types";
import { pairKey, type RelationshipResult } from "./relationships";
import type { ClusterChange } from "./clustering";
import type { LeadLagResult } from "./types";

/** Bar duration per timeframe (ms) — used only for signal expiry windows. */
const TIMEFRAME_MS: Record<string, number> = {
    M5: 300_000,
    M15: 900_000,
    M30: 1_800_000,
    H1: 3_600_000,
    H4: 14_400_000,
    D1: 86_400_000,
};

export function windowDurationMs(window: RelationshipWindow): number {
    return (TIMEFRAME_MS[window.timeframe] ?? 3_600_000) * window.bars;
}

export function signalId(
    type: CrossAssetSignalType,
    subject: string,
    window: RelationshipWindow,
    dataTimestamp: number
): string {
    return `signal:${type}:${subject}:${window.timeframe}:${window.bars}:${dataTimestamp}`;
}

/**
 * Stable identity of a signal CONDITION (everything except the observation
 * timestamp). Two observations of the same condition share a base key, which
 * is what lets `reconcileSignals` move DETECTED → CONFIRMED instead of
 * treating every new bar as a brand-new signal.
 */
export function signalBaseKey(id: string): string {
    return id.replace(/:\d+$/, "");
}

function baseSignal(input: {
    type: CrossAssetSignalType;
    subject: string;
    sourceNodes: string[];
    targetNodes: string[];
    evidence: Evidence[];
    window: RelationshipWindow;
    dataTimestamp: number;
    timestamp: number;
    confidence: number;
    summary: string;
}): CrossAssetSignal {
    return {
        id: signalId(input.type, input.subject, input.window, input.dataTimestamp),
        type: input.type,
        sourceNodes: input.sourceNodes,
        targetNodes: input.targetNodes,
        evidence: input.evidence,
        timestamp: input.timestamp,
        dataTimestamp: input.dataTimestamp,
        confidence: Math.max(0, Math.min(1, Math.round(input.confidence * 100) / 100)),
        status: "DETECTED",
        window: { ...input.window },
        expiresAt: input.dataTimestamp + 2 * windowDurationMs(input.window),
        summary: input.summary,
    };
}

/* ── Generation ───────────────────────────────────────────────────────────── */

export interface GenerateSignalsInput {
    relationships: RelationshipResult[];
    clusters: MarketCluster[];
    clusterChanges: ClusterChange[];
    regimeTransitions: MarketRegimeTransition[];
    leadLag?: LeadLagResult[];
    window: RelationshipWindow;
    calculatedAt: number;
}

export function generateSignals(input: GenerateSignalsInput): CrossAssetSignal[] {
    const signals: CrossAssetSignal[] = [];

    /* Relationship stability signals (§8) */
    for (const r of input.relationships) {
        if (r.coefficient === null || r.type === null) continue;
        const subject = pairKey(r.a, r.b);
        const nodeA = `instrument:${r.a}`;
        const nodeB = `instrument:${r.b}`;
        const common = {
            subject,
            sourceNodes: [nodeA],
            targetNodes: [nodeB],
            window: r.window,
            dataTimestamp: r.dataTimestamp,
            timestamp: input.calculatedAt,
            confidence: r.confidence,
            evidence: r.claims,
        };

        if (r.stability === "BREAKING") {
            signals.push(
                baseSignal({
                    ...common,
                    type: "CORRELATION_BREAK",
                    summary: `${r.a} ↔ ${r.b} correlation broke: ${r.previousCoefficient?.toFixed(2) ?? "n/a"} → ${r.coefficient.toFixed(2)} over ${r.window.bars} ${r.window.timeframe} bars (Δ ${r.delta?.toFixed(2) ?? "n/a"}).`,
                })
            );
        } else if (r.stability === "FLIPPING") {
            signals.push(
                baseSignal({
                    ...common,
                    type: "RELATIONSHIP_FLIP",
                    summary: `${r.a} ↔ ${r.b} relationship flipped sign: ${r.previousCoefficient?.toFixed(2) ?? "n/a"} → ${r.coefficient.toFixed(2)} over ${r.window.bars} ${r.window.timeframe} bars.`,
                })
            );
        } else if (r.stability === "STRENGTHENING") {
            signals.push(
                baseSignal({
                    ...common,
                    type: "RELATIONSHIP_STRENGTHENING",
                    summary: `${r.a} ↔ ${r.b} ${r.type.toLowerCase()} strengthening: coefficient ${r.coefficient.toFixed(2)} over ${r.window.bars} ${r.window.timeframe} bars.`,
                })
            );
        } else if (r.stability === "WEAKENING") {
            signals.push(
                baseSignal({
                    ...common,
                    type: "RELATIONSHIP_WEAKENING",
                    summary: `${r.a} ↔ ${r.b} relationship weakening: coefficient ${r.coefficient.toFixed(2)} over ${r.window.bars} ${r.window.timeframe} bars.`,
                })
            );
        }
    }

    /* Regime transitions (§17) */
    for (const t of input.regimeTransitions) {
        let type: CrossAssetSignalType = "REGIME_SHIFT";
        if (t.axis === "volatility" && t.newState === "HIGH_VOLATILITY") type = "VOLATILITY_EXPANSION";
        else if (t.axis === "volatility" && t.newState === "LOW_VOLATILITY") type = "VOLATILITY_COMPRESSION";

        signals.push(
            baseSignal({
                type,
                subject: `${t.axis}:${t.previousState}->${t.newState}`,
                sourceNodes: t.affectedNodeIds.slice(0, 8),
                targetNodes: ["regime:global"],
                evidence: t.evidence,
                window: input.window,
                dataTimestamp: t.dataTimestamp,
                timestamp: t.timestamp,
                confidence: t.confidence,
                summary: `Regime shift on ${t.axis}: ${t.previousState} → ${t.newState} (${t.affectedNodeIds.length} affected node(s)).`,
            })
        );
    }

    /* Cluster changes (§11, §18) */
    for (const change of input.clusterChanges) {
        signals.push(
            baseSignal({
                type: "CLUSTER_CHANGE",
                subject: change.clusterId,
                sourceNodes: change.members,
                targetNodes: [],
                evidence: [
                    {
                        id: `ev:cluster-change:${change.clusterId}`,
                        kind: "CALCULATED",
                        source: "cluster:change",
                        text: change.text,
                    },
                ],
                window: input.window,
                dataTimestamp: input.clusters[0]?.dataTimestamp ?? 0,
                timestamp: input.calculatedAt,
                confidence: 0.6,
                summary: change.text,
            })
        );
    }

    /* Lead-lag observations (§9) */
    for (const ll of input.leadLag ?? []) {
        signals.push(
            baseSignal({
                type: "LEAD_LAG_OBSERVATION",
                subject: pairKey(ll.leader, ll.follower),
                sourceNodes: [`instrument:${ll.leader}`],
                targetNodes: [`instrument:${ll.follower}`],
                evidence: [
                    {
                        id: `ev:leadlag:${pairKey(ll.leader, ll.follower)}`,
                        kind: "OBSERVED",
                        source: "leadlag:cross-correlation",
                        text: `${ll.leader} returns preceded ${ll.follower} by ${ll.lag} bar(s) with ρ = ${ll.coefficient.toFixed(2)} (p = ${ll.pValue?.toFixed(3) ?? "n/a"}, n = ${ll.sampleSize}). ${ll.stabilityNote}`,
                        value: ll.coefficient,
                    },
                ],
                window: input.window,
                dataTimestamp: ll.period.to,
                timestamp: input.calculatedAt,
                confidence: ll.stable && ll.pValue !== null && ll.pValue <= 0.05 ? 0.6 : 0.4,
                summary: `Observed lead-lag: ${ll.leader} → ${ll.follower} at ${ll.lag} bar(s). Historical association only — not a prediction (§57).`,
            })
        );
    }

    return signals;
}

/* ── Status reconciliation (§18) ──────────────────────────────────────────── */

/**
 * Merge freshly generated signals with the stored history:
 *   • a repeat observation on a later bar CONFIRMS a DETECTED signal;
 *   • a stored signal past its expiry becomes EXPIRED;
 *   • a signal whose type disappeared but whose opposite condition is now
 *     measured (break ↔ strengthening) becomes INVALIDATED.
 * Returns the merged list sorted by timestamp descending.
 */
export function reconcileSignals(
    previous: CrossAssetSignal[],
    fresh: CrossAssetSignal[],
    now: number
): CrossAssetSignal[] {
    const previousByBase = new Map<string, CrossAssetSignal>();
    for (const s of previous) previousByBase.set(signalBaseKey(s.id), s);

    const freshBases = new Set(fresh.map((s) => signalBaseKey(s.id)));
    const merged = new Map<string, CrossAssetSignal>();

    for (const signal of fresh) {
        const base = signalBaseKey(signal.id);
        const prior = previousByBase.get(base);
        if (!prior) {
            merged.set(base, signal);
            continue;
        }
        const observedLater = prior.dataTimestamp < signal.dataTimestamp;
        const status: CrossAssetSignal["status"] =
            prior.status === "CONFIRMED" || observedLater ? "CONFIRMED" : "DETECTED";
        merged.set(base, {
            ...signal,
            status,
            confirmedAt: prior.confirmedAt ?? (status === "CONFIRMED" ? now : undefined),
        });
    }

    const OPPOSITE_TYPES: Partial<Record<CrossAssetSignalType, CrossAssetSignalType[]>> = {
        CORRELATION_BREAK: ["RELATIONSHIP_STRENGTHENING"],
        RELATIONSHIP_FLIP: ["RELATIONSHIP_FLIP"],
        RELATIONSHIP_WEAKENING: ["RELATIONSHIP_STRENGTHENING"],
        RELATIONSHIP_STRENGTHENING: ["RELATIONSHIP_WEAKENING", "CORRELATION_BREAK"],
        VOLATILITY_EXPANSION: ["VOLATILITY_COMPRESSION"],
        VOLATILITY_COMPRESSION: ["VOLATILITY_EXPANSION"],
    };

    for (const [base, stored] of Array.from(previousByBase.entries())) {
        if (freshBases.has(base)) continue;
        const stillFresh = stored.expiresAt !== undefined && stored.expiresAt > now;
        if (!stillFresh) {
            merged.set(base, { ...stored, status: "EXPIRED" });
            continue;
        }
        const opposites = OPPOSITE_TYPES[stored.type] ?? [];
        const invalidated = fresh.some(
            (f) =>
                opposites.includes(f.type) &&
                f.sourceNodes.join(",") === stored.sourceNodes.join(",") &&
                f.targetNodes.join(",") === stored.targetNodes.join(",")
        );
        merged.set(base, invalidated ? { ...stored, status: "INVALIDATED" } : stored);
    }

    return Array.from(merged.values()).sort((a, b) => b.timestamp - a.timestamp || (a.id < b.id ? 1 : -1));
}

/** Convenience: only live signals (DETECTED or CONFIRMED). */
export function activeSignals(signals: CrossAssetSignal[]): CrossAssetSignal[] {
    return signals.filter((s) => s.status === "DETECTED" || s.status === "CONFIRMED");
}

/**
 * Map a measured relationship onto the per-symbol summary shape (§19):
 * the summary is expressed from the FOCUS symbol's point of view — `symbol`
 * is always the counterparty the focus symbol is related to.
 */
export function toRelationshipSummary(
    r: RelationshipResult,
    focusSymbol: string,
    changed: boolean
): SymbolRelationshipSummary {
    const other = r.a === focusSymbol.toUpperCase() ? r.b : r.a;
    return {
        nodeId: `instrument:${other}`,
        symbol: other,
        label: `${focusSymbol.toUpperCase()} ↔ ${other}`,
        coefficient: r.coefficient,
        stability: r.stability,
        term: r.term,
        window: r.window,
        sampleSize: r.sampleSize,
        dataQuality: r.dataQuality.status,
        changed,
    };
}

export type { CrossAssetSignalStatus };
