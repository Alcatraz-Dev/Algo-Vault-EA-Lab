/**
 * AlgoVault — Market Graph assembly (Phase 16 §2, §3, §43).
 *
 * PURE + DETERMINISTIC. Turns measured relationships, clusters, factors and
 * regime output into the canonical node/edge graph. Nothing here invents a
 * link:
 *
 *   • CORRELATION / INVERSE_CORRELATION edges only exist where a measured
 *     coefficient passed the label threshold (relationships.ts);
 *   • CURRENCY / ASSET_CLASS edges come from the canonical instrument
 *     registry (`lib/portfolio/instruments`) — real metadata, never guessed;
 *   • EXPOSURE edges come from declared factor inputs (each printed);
 *   • USER_DEFINED edges come only from user configuration and are flagged.
 *
 * The snapshot (§43) is immutable: once written, it is never mutated — it is
 * the reproducibility record together with `engineVersions` (§44).
 */

import { instrumentMetadata } from "@/lib/portfolio/instruments";
import type {
    CrossAssetSignal,
    DataQuality,
    EngineVersions,
    Evidence,
    MarketCluster,
    MarketEdge,
    MarketFactor,
    MarketGraphSnapshot,
    MarketNode,
    MarketRelationshipType,
    MarketRegimeSnapshot,
    GraphObservability,
    RelationshipWindow,
    UserDefinedRelationship,
} from "./types";
import {
    assetClassNodeId,
    clusterNodeId,
    currencyNodeId,
    edgeId,
    instrumentNodeId,
    regimeNodeId,
} from "./ids";
import { pairKey, type RelationshipResult } from "./relationships";
import { MARKET_NODE_METADATA_VERSION } from "./versions";

/* ── Nodes ────────────────────────────────────────────────────────────────── */

export function buildInstrumentNode(symbol: string): MarketNode {
    const meta = instrumentMetadata(symbol);
    const upper = symbol.toUpperCase();
    return {
        id: instrumentNodeId(upper),
        kind: "INSTRUMENT",
        symbol: upper,
        assetClass: meta.assetClass,
        currency: meta.currency ?? undefined,
        label: upper,
        metadataVersion: MARKET_NODE_METADATA_VERSION,
        measurable: meta.assetClass !== "UNAVAILABLE",
    };
}

/** Asset-class + currency structural nodes derived from real metadata. */
export function buildStructureNodes(instruments: MarketNode[]): MarketNode[] {
    const nodes = new Map<string, MarketNode>();
    for (const node of instruments) {
        if (node.kind !== "INSTRUMENT") continue;
        if (node.assetClass && node.assetClass !== "UNAVAILABLE") {
            const id = assetClassNodeId(node.assetClass);
            if (!nodes.has(id)) {
                nodes.set(id, {
                    id,
                    kind: "ASSET_CLASS",
                    assetClass: node.assetClass,
                    label: String(node.assetClass),
                    metadataVersion: MARKET_NODE_METADATA_VERSION,
                    measurable: false,
                });
            }
        }
        if (node.currency) {
            const id = currencyNodeId(node.currency);
            if (!nodes.has(id)) {
                nodes.set(id, {
                    id,
                    kind: "CURRENCY",
                    currency: node.currency,
                    label: node.currency,
                    metadataVersion: MARKET_NODE_METADATA_VERSION,
                    measurable: false,
                });
            }
        }
        // Both FX legs are real exposure legs — only added when determinable.
        const pair = instrumentMetadata(node.symbol ?? "").currencyPair;
        if (pair) {
            for (const ccy of pair) {
                const id = currencyNodeId(ccy);
                if (!nodes.has(id)) {
                    nodes.set(id, {
                        id,
                        kind: "CURRENCY",
                        currency: ccy,
                        label: ccy,
                        metadataVersion: MARKET_NODE_METADATA_VERSION,
                        measurable: false,
                    });
                }
            }
        }
    }
    return Array.from(nodes.values()).sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function buildFactorNodes(factors: MarketFactor[]): MarketNode[] {
    return factors.map((f) => ({
        id: f.id,
        kind: "FACTOR" as const,
        label: f.name,
        metadataVersion: MARKET_NODE_METADATA_VERSION,
        measurable: false,
    }));
}

export function buildRegimeNode(regime: MarketRegimeSnapshot | null): MarketNode[] {
    if (!regime) return [];
    return [
        {
            id: regimeNodeId(),
            kind: "REGIME",
            label: `Regime: ${regime.activeStates.join(" + ")}`,
            metadataVersion: MARKET_NODE_METADATA_VERSION,
            measurable: false,
        },
    ];
}

export function buildClusterNodes(clusters: MarketCluster[]): MarketNode[] {
    return clusters.map((c) => ({
        id: clusterNodeId(c.id),
        kind: "CLUSTER",
        label: c.label,
        metadataVersion: MARKET_NODE_METADATA_VERSION,
        measurable: false,
    }));
}

/* ── Edges ────────────────────────────────────────────────────────────────── */

function emptyQuality(): DataQuality {
    return { sampleSize: 0, requiredBars: 0, dataCoverage: 0, missingBars: 0, status: "UNAVAILABLE", reason: "Metadata edge — no market data required." };
}

/** instrument → asset class / currency edges from canonical metadata (§4). */
export function metadataEdges(instruments: MarketNode[]): MarketEdge[] {
    const edges: MarketEdge[] = [];
    for (const node of instruments) {
        if (node.kind !== "INSTRUMENT") continue;
        const evidence: Evidence[] = [];
        if (node.assetClass && node.assetClass !== "UNAVAILABLE") {
            const target = assetClassNodeId(node.assetClass);
            evidence.push({
                id: `ev:meta:${node.id}->${target}`,
                kind: "OBSERVED",
                source: "registry:instrument",
                text: `${node.symbol} belongs to asset class ${node.assetClass} per the canonical instrument registry.`,
            });
            edges.push({
                id: edgeId(node.id, target, "ASSET_CLASS", "metadata", 0),
                sourceNodeId: node.id,
                targetNodeId: target,
                relationshipType: "ASSET_CLASS",
                strength: 1,
                coefficient: null,
                window: { timeframe: "H1", bars: 20 },
                term: "UNKNOWN",
                stability: "UNKNOWN",
                dataTimestamp: 0,
                calculatedAt: 0,
                confidence: 1,
                evidence: [],
                claims: evidence,
                dataQuality: emptyQuality(),
                userDefined: false,
            });
        }
        const pair = instrumentMetadata(node.symbol ?? "").currencyPair;
        if (pair) {
            for (const ccy of pair) {
                const target = currencyNodeId(ccy);
                edges.push({
                    id: edgeId(node.id, target, "CURRENCY", "metadata", 0),
                    sourceNodeId: node.id,
                    targetNodeId: target,
                    relationshipType: "CURRENCY",
                    strength: 1,
                    coefficient: null,
                    window: { timeframe: "H1", bars: 20 },
                    term: "UNKNOWN",
                    stability: "UNKNOWN",
                    dataTimestamp: 0,
                    calculatedAt: 0,
                    confidence: 1,
                    evidence: [],
                    claims: [
                        {
                            id: `ev:meta:${node.id}->${target}`,
                            kind: "OBSERVED",
                            source: "registry:instrument",
                            text: `${node.symbol} has deterministic ${ccy} exposure from its currency legs (${pair.join("/")}), split by contract definition.`,
                        },
                    ],
                    dataQuality: emptyQuality(),
                    userDefined: false,
                });
            }
        } else if (node.currency) {
            const target = currencyNodeId(node.currency);
            edges.push({
                id: edgeId(node.id, target, "CURRENCY", "metadata", 0),
                sourceNodeId: node.id,
                targetNodeId: target,
                relationshipType: "CURRENCY",
                strength: 1,
                coefficient: null,
                window: { timeframe: "H1", bars: 20 },
                term: "UNKNOWN",
                stability: "UNKNOWN",
                dataTimestamp: 0,
                calculatedAt: 0,
                confidence: 1,
                evidence: [],
                claims: [
                    {
                        id: `ev:meta:${node.id}->${target}`,
                        kind: "OBSERVED",
                        source: "registry:instrument",
                        text: `${node.symbol} settles in ${node.currency} per contract definition; no two-currency split is determinable, so only one currency edge exists.`,
                    },
                ],
                dataQuality: emptyQuality(),
                userDefined: false,
            });
        }
    }
    return edges;
}

/** Measured relationship edges (typed only when |ρ| ≥ label threshold). */
export function relationshipEdges(results: RelationshipResult[]): MarketEdge[] {
    const edges: MarketEdge[] = [];
    for (const r of results) {
        if (r.type === null || r.coefficient === null) continue;
        const type: MarketRelationshipType = r.type;
        edges.push({
            id: edgeId(instrumentNodeId(r.a), instrumentNodeId(r.b), type, r.window.timeframe, r.window.bars),
            sourceNodeId: instrumentNodeId(r.a),
            targetNodeId: instrumentNodeId(r.b),
            relationshipType: type,
            strength: Math.round(Math.abs(r.coefficient) * 10_000) / 10_000,
            coefficient: r.coefficient,
            window: r.window,
            term: r.term,
            stability: r.stability,
            dataTimestamp: r.dataTimestamp,
            calculatedAt: r.calculatedAt,
            confidence: r.confidence,
            evidence: r.observations,
            claims: r.claims,
            dataQuality: r.dataQuality,
            userDefined: false,
        });
    }
    return edges;
}

/** LEAD_LAG edges from measured lead-lag results (§9). */
export function leadLagEdges(results: Array<{ leader: string; follower: string; result: import("./types").LeadLagResult }>): MarketEdge[] {
    return results.map(({ leader, follower, result }) => ({
        id: edgeId(instrumentNodeId(leader), instrumentNodeId(follower), "LEAD_LAG", "H1", 0),
        sourceNodeId: instrumentNodeId(leader),
        targetNodeId: instrumentNodeId(follower),
        relationshipType: "LEAD_LAG" as const,
        strength: Math.round(Math.abs(result.coefficient) * 10_000) / 10_000,
        coefficient: result.coefficient,
        window: { timeframe: "H1" as const, bars: 100 as const },
        term: "MEDIUM_TERM" as const,
        stability: result.stable ? ("STABLE" as const) : ("UNKNOWN" as const),
        dataTimestamp: result.period.to,
        calculatedAt: Date.now(),
        confidence: result.stable ? 0.6 : 0.4,
        evidence: [],
        claims: [
            {
                id: `ev:leadlag:${leader}:${follower}`,
                kind: "OBSERVED" as const,
                source: "leadlag:cross-correlation",
                text: `${leader} returns preceded ${follower} by ${result.lag} bar(s) with ρ = ${result.coefficient.toFixed(2)} (p = ${result.pValue?.toFixed(3) ?? "n/a"}, n = ${result.sampleSize}). ${result.stabilityNote}`,
                value: result.coefficient,
            },
            ...result.limitations.map((text, i) => ({
                id: `ev:leadlag-lim:${leader}:${follower}:${i}`,
                kind: "CALCULATED" as const,
                source: "leadlag:limitations",
                text,
            })),
        ],
        dataQuality: {
            sampleSize: result.sampleSize,
            requiredBars: result.sampleSize,
            dataCoverage: 1,
            missingBars: 0,
            status: result.sampleSize >= 30 ? "GOOD" : "DEGRADED",
        },
        userDefined: false,
    }));
}

/** factor → input instrument edges; every weight is printed (§14). */
export function factorEdges(factors: MarketFactor[]): MarketEdge[] {
    const edges: MarketEdge[] = [];
    for (const f of factors) {
        for (const input of f.inputs) {
            if (!input.used) continue;
            edges.push({
                id: edgeId(f.id, input.nodeId, "EXPOSURE", f.window.timeframe, f.window.bars),
                sourceNodeId: f.id,
                targetNodeId: input.nodeId,
                relationshipType: "EXPOSURE",
                strength: input.weight,
                coefficient: null,
                window: f.window,
                term: "UNKNOWN",
                stability: "UNKNOWN",
                dataTimestamp: f.dataTimestamp,
                calculatedAt: f.timestamp,
                confidence: f.confidence,
                evidence: [],
                claims: [
                    {
                        id: `ev:factor-edge:${f.id}:${input.nodeId}`,
                        kind: "CONFIGURED",
                        source: "factor:weights",
                        text: `${f.name} includes ${input.symbol} with declared weight ${input.weight} (${f.formula}).`,
                    },
                ],
                dataQuality: emptyQuality(),
                userDefined: false,
            });
        }
    }
    return edges;
}

/** User-declared edges — always flagged `USER_DEFINED` (§4). */
export function userDefinedEdges(relationships: UserDefinedRelationship[]): MarketEdge[] {
    return relationships.map((rel) => ({
        id: edgeId(
            instrumentNodeId(rel.sourceSymbol),
            instrumentNodeId(rel.targetSymbol),
            "USER_DEFINED",
            "user",
            0
        ),
        sourceNodeId: instrumentNodeId(rel.sourceSymbol),
        targetNodeId: instrumentNodeId(rel.targetSymbol),
        relationshipType: "USER_DEFINED" as const,
        strength: 1,
        coefficient: null,
        window: { timeframe: "H1" as const, bars: 20 as const },
        term: "UNKNOWN" as const,
        stability: "UNKNOWN" as const,
        dataTimestamp: rel.updatedAt,
        calculatedAt: rel.updatedAt,
        confidence: 1,
        evidence: [],
        claims: [
            {
                id: `ev:user:${rel.id}`,
                kind: "USER_DEFINED" as const,
                source: "user:relationship",
                text: `User-declared ${rel.declaredType} relationship${rel.note ? `: ${rel.note}` : "."} This is a declared link, not a measured one.`,
            },
        ],
        dataQuality: emptyQuality(),
        userDefined: true,
    }));
}

/* ── Snapshot (§43) ───────────────────────────────────────────────────────── */

export interface BuildSnapshotInput {
    scope: string;
    window: RelationshipWindow;
    instruments: MarketNode[];
    relationships: RelationshipResult[];
    clusters: MarketCluster[];
    factors: MarketFactor[];
    regime: MarketRegimeSnapshot | null;
    signals: CrossAssetSignal[];
    userRelationships: UserDefinedRelationship[];
    unavailableSymbols: Array<{ symbol: string; reason: string }>;
    engineVersions: EngineVersions;
    createdAt: number;
    observability: GraphObservability;
    extraEdges?: MarketEdge[];
}

export function buildMarketGraphSnapshot(input: BuildSnapshotInput): MarketGraphSnapshot {
    const structure = buildStructureNodes(input.instruments);
    const nodes: MarketNode[] = [
        ...input.instruments,
        ...structure,
        ...buildFactorNodes(input.factors),
        ...buildRegimeNode(input.regime),
        ...buildClusterNodes(input.clusters),
    ];

    const edges: MarketEdge[] = [
        ...metadataEdges(input.instruments),
        ...relationshipEdges(input.relationships),
        ...factorEdges(input.factors),
        ...userDefinedEdges(input.userRelationships),
        ...(input.extraEdges ?? []),
    ];

    const measuredPairs = input.relationships.filter((r) => r.coefficient !== null);
    const qualityPairs = measuredPairs.length;
    const goodPairs = measuredPairs.filter((r) => r.dataQuality.status === "GOOD").length;
    const dataQuality: DataQuality = {
        sampleSize: goodPairs,
        requiredBars: qualityPairs,
        dataCoverage: qualityPairs > 0 ? Math.round((goodPairs / qualityPairs) * 10_000) / 10_000 : 0,
        missingBars: Math.max(0, qualityPairs - goodPairs),
        status:
            qualityPairs === 0
                ? "INSUFFICIENT_DATA"
                : goodPairs / qualityPairs >= 0.9
                  ? "GOOD"
                  : goodPairs / qualityPairs >= 0.7
                    ? "DEGRADED"
                    : "INSUFFICIENT_DATA",
        reason:
            qualityPairs === 0
                ? "No pair produced a coefficient in this window."
                : undefined,
    };

    const limitations: string[] = [
        "Graph edges are measured or declared associations — never causal claims and never trade signals (§56, §57).",
        `Snapshot scope ${input.scope}; window ${input.window.bars} ${input.window.timeframe}; immutable once written (§43).`,
    ];
    if (input.unavailableSymbols.length > 0) {
        limitations.push(
            `${input.unavailableSymbols.length} symbol(s) had no usable market data and were excluded: ${input.unavailableSymbols.map((u) => u.symbol).join(", ")}.`
        );
    }

    return {
        snapshotId: `mgs:${input.scope}:${input.window.timeframe}:${input.window.bars}:${input.createdAt}`,
        scope: input.scope,
        nodes,
        edges,
        clusters: input.clusters,
        factors: input.factors,
        regime: input.regime,
        signals: input.signals,
        unavailableSymbols: input.unavailableSymbols,
        window: input.window,
        createdAt: input.createdAt,
        dataTimestamp: measuredPairs.reduce((max, r) => Math.max(max, r.dataTimestamp), 0),
        engineVersions: input.engineVersions,
        dataQuality,
        observability: input.observability,
        limitations,
    };
}

/* ── Snapshot diff (used for event-driven recomputation, §48) ─────────────── */

export interface SnapshotDiff {
    addedEdges: string[];
    removedEdges: string[];
    changedEdges: Array<{ id: string; from: number | null; to: number | null }>;
    addedSignals: string[];
    removedSignals: string[];
}

export function diffSnapshots(previous: MarketGraphSnapshot | null, next: MarketGraphSnapshot): SnapshotDiff {
    const prevEdges = new Map((previous?.edges ?? []).map((e) => [e.id, e]));
    const nextEdges = new Map(next.edges.map((e) => [e.id, e]));
    const prevSignals = new Set((previous?.signals ?? []).map((s) => s.id));
    const nextSignals = new Set(next.signals.map((s) => s.id));

    const addedEdges: string[] = [];
    const removedEdges: string[] = [];
    const changedEdges: SnapshotDiff["changedEdges"] = [];
    for (const [id, edge] of nextEdges) {
        const prior = prevEdges.get(id);
        if (!prior) addedEdges.push(id);
        else if ((prior.coefficient ?? null) !== (edge.coefficient ?? null)) {
            changedEdges.push({ id, from: prior.coefficient ?? null, to: edge.coefficient ?? null });
        }
    }
    for (const id of prevEdges.keys()) if (!nextEdges.has(id)) removedEdges.push(id);

    return {
        addedEdges,
        removedEdges,
        changedEdges,
        addedSignals: Array.from(nextSignals).filter((id) => !prevSignals.has(id)),
        removedSignals: Array.from(prevSignals).filter((id) => !nextSignals.has(id)),
    };
}

/** Canonical pair key re-export so consumers need only one import. */
export { pairKey };
