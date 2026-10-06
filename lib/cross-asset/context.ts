/**
 * AlgoVault — Per-symbol Cross-Asset Context (Phase 16 §19, §20, §24, §30).
 *
 * PURE. Builds the "what else is happening around this market?" payload that
 * the Pro Terminal, AI Market Analyst, Trading Chat and mobile Market Context
 * screen all consume — one builder, many surfaces (no per-surface logic).
 *
 * Rules enforced here:
 *   • only relationships that passed the label threshold are shown (§20: the
 *     panel must not be filled with arbitrary symbols);
 *   • strongest |ρ| first, capped, so the panel stays answerable to
 *     "why should I care?" (§55);
 *   • the narrative uses the §30 output contract: Observed / Calculated /
 *     Inferred / Recommendation — and Recommendation is clearly labelled;
 *   • portfolio impact is only reported from REAL holdings; without holdings
 *     the status is `NO_HOLDINGS`, not a fabricated "high impact".
 */

import type {
    CrossAssetSignal,
    DataQuality,
    EngineVersions,
    Evidence,
    MarketCluster,
    MarketFactor,
    MarketRegimeSnapshot,
    PortfolioCrossAssetImpact,
    SymbolCrossAssetContext,
    SymbolRelationshipSummary,
    RelationshipWindow,
    MarketGraphSnapshot,
} from "./types";
import type { SetupMemoryRecord } from "@/lib/market-intelligence/memory/types";
import { instrumentNodeId } from "./ids";
import { toRelationshipSummary } from "./events";
import { CORRELATION_LABEL_THRESHOLD, type RelationshipResult } from "./relationships";

/** Max relationships surfaced per symbol (bounded read, §48). */
export const MAX_SYMBOL_RELATIONSHIPS = 10;

/** |Δρ| against the previous snapshot that marks a relationship as "changed". */
export const RELATIONSHIP_CHANGED_DELTA = 0.1;

export function relationshipChanged(r: RelationshipResult): boolean {
    if (r.stability === "BREAKING" || r.stability === "FLIPPING") return true;
    return r.delta !== null && Math.abs(r.delta) >= RELATIONSHIP_CHANGED_DELTA;
}

/* ── Context builder ──────────────────────────────────────────────────────── */

export interface BuildSymbolContextInput {
    symbol: string;
    window: RelationshipWindow;
    relationships: RelationshipResult[];
    clusters: MarketCluster[];
    regime: MarketRegimeSnapshot | null;
    factors: MarketFactor[];
    signals: CrossAssetSignal[];
    portfolioImpact: PortfolioCrossAssetImpact | null;
    dataTimestamp: number;
    calculatedAt: number;
    engineVersions: EngineVersions;
    maxRelationships?: number;
}

export function buildSymbolCrossAssetContext(
    input: BuildSymbolContextInput
): SymbolCrossAssetContext {
    const focus = input.symbol.toUpperCase();
    const max = input.maxRelationships ?? MAX_SYMBOL_RELATIONSHIPS;

    const own = input.relationships.filter(
        (r) =>
            (r.a === focus || r.b === focus) &&
            r.coefficient !== null &&
            r.type !== null &&
            r.dataQuality.status !== "INSUFFICIENT_DATA"
    );
    own.sort((x, y) => Math.abs(y.coefficient ?? 0) - Math.abs(x.coefficient ?? 0));

    const relationships: SymbolRelationshipSummary[] = own
        .slice(0, max)
        .map((r) => toRelationshipSummary(r, focus, relationshipChanged(r)));

    const focusNodeId = instrumentNodeId(focus);
    const ownClusterIds = new Set(
        input.clusters.filter((c) => c.memberNodeIds.includes(focusNodeId)).map((c) => c.id)
    );
    const clusters = input.clusters.filter((c) => ownClusterIds.has(c.id));

    const relatedNodeIds = new Set<string>(relationships.map((r) => r.nodeId));
    const signals = input.signals.filter(
        (s) =>
            s.sourceNodes.includes(focusNodeId) ||
            s.targetNodes.includes(focusNodeId) ||
            relatedNodeIds.has(s.sourceNodes[0] ?? "") ||
            relatedNodeIds.has(s.targetNodes[0] ?? "")
    );

    const narrative = buildNarrative(focus, relationships, input);

    const quality = contextDataQuality(relationships);

    const limitations: string[] = [
        "Cross-asset context describes measured associations in the current window — it is not a prediction and not a trade signal (§57).",
        `Showing ${relationships.length} of ${own.length} measured relationship(s) for ${focus} (capped at ${max}, strongest |ρ| first).`,
    ];
    if (own.length === 0) {
        limitations.push(
            `No relationship for ${focus} passed the |ρ| ≥ ${CORRELATION_LABEL_THRESHOLD} label threshold in this window — the panel is empty by design, not by failure.`
        );
    }

    return {
        symbol: focus,
        calculatedAt: input.calculatedAt,
        dataTimestamp: input.dataTimestamp,
        window: input.window,
        relationships,
        clusters,
        regime: input.regime,
        factors: input.factors.filter((f) => f.status === "AVAILABLE"),
        signals,
        portfolioImpact: input.portfolioImpact,
        narrative,
        dataQuality: quality,
        limitations,
        engineVersions: input.engineVersions,
    };
}

function contextDataQuality(relationships: SymbolRelationshipSummary[]): DataQuality {
    const usable = relationships.filter((r) => r.dataQuality !== "INSUFFICIENT_DATA");
    const good = relationships.filter((r) => r.dataQuality === "GOOD");
    const required = relationships.length;
    const status =
        required === 0
            ? "INSUFFICIENT_DATA"
            : good.length / required >= 0.9
              ? "GOOD"
              : usable.length / required >= 0.7
                ? "DEGRADED"
                : "INSUFFICIENT_DATA";
    return {
        sampleSize: good.length,
        requiredBars: required,
        dataCoverage: required > 0 ? Math.round((good.length / required) * 10_000) / 10_000 : 0,
        missingBars: Math.max(0, required - good.length),
        status,
        reason: required === 0 ? "No measurable relationship for this symbol in the current window." : undefined,
    };
}

/* ── §30 evidence narrative ───────────────────────────────────────────────── */

export function buildNarrative(
    focus: string,
    relationships: SymbolRelationshipSummary[],
    input: Pick<BuildSymbolContextInput, "regime" | "portfolioImpact" | "signals" | "calculatedAt">
): Evidence[] {
    const out: Evidence[] = [];
    const top = relationships[0];

    if (top) {
        const dir = (top.coefficient ?? 0) >= 0 ? "positive" : "inverse";
        out.push({
            id: `narr:observed:${focus}:${top.symbol}`,
            kind: "OBSERVED",
            source: "relationship:headline",
            text: `Observed: ${focus} ↔ ${top.symbol} rolling correlation is ${
                top.coefficient === null ? "not available" : top.coefficient.toFixed(2)
            } (${dir}, ${top.window.bars} ${top.window.timeframe} bars, n=${top.sampleSize}).`,
            value: top.coefficient ?? undefined,
        });
        if (top.changed) {
            out.push({
                id: `narr:calculated:${focus}:${top.symbol}`,
                kind: "CALCULATED",
                source: "relationship:stability",
                text: `Calculated: this relationship is ${top.stability.toLowerCase()} and flagged as changed (|Δρ| ≥ ${RELATIONSHIP_CHANGED_DELTA} or a break/flip condition).`,
            });
        }
        out.push({
            id: `narr:inferred:${focus}`,
            kind: "INFERENCE",
            source: "context:interpret",
            text: `Inferred: the historical ${dir} relationship with ${top.symbol} is ${
                top.stability === "STABLE" ? "stable" : top.stability.toLowerCase()
            } in the current window. This is an association observed in past data — not a causal or predictive claim.`,
        });
    } else {
        out.push({
            id: `narr:observed:${focus}:none`,
            kind: "OBSERVED",
            source: "relationship:headline",
            text: `Observed: no relationship for ${focus} passed the |ρ| ≥ ${CORRELATION_LABEL_THRESHOLD} label threshold in this window.`,
        });
    }

    if (input.regime) {
        out.push({
            id: `narr:regime:${input.regime.id}`,
            kind: "OBSERVED",
            source: "regime:axes",
            text: `Observed: global regime — ${input.regime.activeStates.join(", ")} (axes: ${Object.entries(
                input.regime.states
            )
                .map(([axis, state]) => `${axis}=${state}`)
                .join(", ")}).`,
        });
    }

    if (input.signals.length > 0) {
        out.push({
            id: `narr:signals:${focus}`,
            kind: "OBSERVED",
            source: "events:cross-asset",
            text: `Observed: ${input.signals.length} active cross-asset event(s): ${input.signals
                .slice(0, 3)
                .map((s) => s.summary)
                .join(" | ")}`,
        });
    }

    const impact = input.portfolioImpact;
    if (impact?.status === "AVAILABLE") {
        out.push({
            id: `narr:portfolio:${focus}`,
            kind: "CALCULATED",
            source: "portfolio:impact",
            text: `Calculated: ${(impact.relatedExposureWeight * 100).toFixed(1)}% of gross exposure sits in positions correlated with ${focus}${
                impact.correlatedHoldings.length > 0 ? ` (${impact.correlatedHoldings.join(", ")})` : ""
            }.`,
            value: impact.relatedExposureWeight,
        });
        for (const w of impact.warnings) out.push(w);
    } else if (impact?.status === "NO_HOLDINGS") {
        out.push({
            id: `narr:portfolio:${focus}`,
            kind: "OBSERVED",
            source: "portfolio:impact",
            text: "Calculated: no open holdings — portfolio impact is not applicable.",
        });
    }

    out.push({
        id: `narr:rec:${focus}`,
        kind: "RECOMMENDATION",
        source: "context:policy",
        text: "Recommendation: treat cross-asset context as confluence for an existing setup — decisions still require market data, strategy, risk, portfolio and execution (§57).",
    });

    return out;
}

/* ── Portfolio impact (§24) ───────────────────────────────────────────────── */

export interface PortfolioHolding {
    symbol: string;
    grossNotional: number;
}

export interface PortfolioImpactInput {
    focusSymbol: string;
    holdings: PortfolioHolding[];
    grossExposure: number;
    relationships: RelationshipResult[];
    clusters: MarketCluster[];
    /** |ρ| at or above a holding counts as "correlated with the focus". */
    correlationThreshold?: number;
    /** Share of gross exposure above which a concentration warning fires. */
    warningThreshold?: number;
}

/** Evidence-backed portfolio impact for one symbol (§24). */
export function buildPortfolioImpact(input: PortfolioImpactInput): PortfolioCrossAssetImpact {
    const focus = input.focusSymbol.toUpperCase();
    const corrThreshold = input.correlationThreshold ?? 0.6;
    const warnThreshold = input.warningThreshold ?? 0.3;

    if (input.holdings.length === 0 || input.grossExposure <= 0) {
        return {
            relatedExposureWeight: 0,
            correlatedHoldings: [],
            warnings: [],
            status: "NO_HOLDINGS",
            limitations: ["No open holdings with measurable exposure — impact not applicable."],
        };
    }

    const correlated = new Set<string>();
    for (const r of input.relationships) {
        if (r.coefficient === null) continue;
        const other = r.a === focus ? r.b : r.b === focus ? r.a : null;
        if (!other || other === focus) continue;
        if (Math.abs(r.coefficient) >= corrThreshold) correlated.add(other);
    }

    const focusNodeId = instrumentNodeId(focus);
    for (const cluster of input.clusters) {
        if (!cluster.memberNodeIds.includes(focusNodeId)) continue;
        for (const member of cluster.memberNodeIds) {
            const symbol = member.replace(/^instrument:/, "");
            if (symbol !== focus) correlated.add(symbol);
        }
    }

    const correlatedHoldings = input.holdings
        .filter((h) => correlated.has(h.symbol.toUpperCase()) && h.symbol.toUpperCase() !== focus)
        .map((h) => h.symbol.toUpperCase());

    const relatedWeight = correlatedHoldings.reduce(
        (sum, symbol) =>
            sum + (input.holdings.find((h) => h.symbol.toUpperCase() === symbol)?.grossNotional ?? 0),
        0
    ) / input.grossExposure;

    const warnings: Evidence[] = [];
    if (relatedWeight >= warnThreshold) {
        warnings.push({
            id: `warn:concentration:${focus}`,
            kind: "CALCULATED",
            source: "portfolio:cross-asset",
            text: `Cross-Asset Concentration Warning: ${(relatedWeight * 100).toFixed(1)}% of gross exposure is in positions correlated with ${focus} (${correlatedHoldings.join(", ") || "none"}), at or above the ${(warnThreshold * 100).toFixed(0)}% threshold.`,
            value: relatedWeight,
        });
    }

    return {
        relatedExposureWeight: Math.round(relatedWeight * 10_000) / 10_000,
        correlatedHoldings: correlatedHoldings.sort(),
        warnings,
        status: "AVAILABLE",
        limitations: [
            `Correlation threshold |ρ| ≥ ${corrThreshold} over the current window; exposure weights use gross notional.`,
            "Correlated exposure compounds risk but does not predict loss.",
        ],
    };
}

/* ── Free vs Pro limits (§51) ─────────────────────────────────────────────── */

export function crossAssetLimits(tier: "FREE" | "PRO"): {
    maxSymbols: number;
    maxWindows: number;
    leadLag: boolean;
    clusters: boolean;
    regime: boolean;
    factors: boolean;
    explorer: boolean;
    research: boolean;
} {
    if (tier === "PRO") {
        return {
            maxSymbols: 12,
            maxWindows: 5,
            leadLag: true,
            clusters: true,
            regime: true,
            factors: true,
            explorer: true,
            research: true,
        };
    }
    return {
        maxSymbols: 5,
        maxWindows: 1,
        leadLag: false,
        clusters: false,
        regime: true,
        factors: false,
        explorer: false,
        research: false,
    };
}

/* ── Setup Memory cross-asset snapshot (Phase 16 §40) ──────────────────────── */

/** The cross-asset field frozen onto a `SetupMemoryRecord` (§40). */
type SetupCrossAssetSnapshot = NonNullable<SetupMemoryRecord["crossAsset"]>;

export interface SetupCrossAssetSnapshotInput {
    /** Symbol the setup was formed on (normalised to upper case). */
    symbol?: string;
    /** Latest stored graph — null means nothing was persisted (fail-closed). */
    graph: MarketGraphSnapshot | null;
    /** Frozen capture timestamp so replays/tests can pin it. Defaults to now. */
    capturedAt?: number;
    maxRelationships?: number;
}

/** Relationship types copied onto a setup snapshot (measured + declared). */
const SETUP_SNAPSHOT_EDGE_TYPES = new Set([
    "CORRELATION",
    "INVERSE_CORRELATION",
    "LEAD_LAG",
    "USER_DEFINED",
]);

/**
 * Phase 16 §40 — freezes what the cross-asset engine KNEW when a setup formed,
 * so the learning loop (§41) can later ask whether that context improved the
 * outcome without any risk of hindsight: this is a point-in-time copy.
 *
 * Honesty rules:
 *   • absent context is stored explicitly (`status: UNAVAILABLE` + reason),
 *     never omitted — "no relationship" and "no data" must stay distinguishable;
 *   • only instrument↔instrument correlation-type edges touching the focus
 *     symbol are copied (structural asset-class/currency edges would be noise);
 *   • strongest |ρ| first, capped — same §20 "no filler symbols" rule;
 *   • the regime/window copied are the ones measured at capture time.
 */
export function buildSetupCrossAssetSnapshot(
    input: SetupCrossAssetSnapshotInput
): SetupCrossAssetSnapshot {
    const capturedAt = input.capturedAt ?? Date.now();

    if (!input.graph) {
        return {
            capturedAt,
            status: "UNAVAILABLE",
            reason: "No stored market graph was available when this setup was recorded.",
        };
    }

    const graph = input.graph;
    const window = { timeframe: graph.window.timeframe, bars: graph.window.bars };
    const regimeStates = graph.regime ? [...graph.regime.activeStates] : [];
    const focus = input.symbol?.trim().toUpperCase();
    const max = input.maxRelationships ?? MAX_SYMBOL_RELATIONSHIPS;

    if (!focus) {
        return { capturedAt, regimeStates, window, status: "AVAILABLE" };
    }

    const symbolByNodeId = new Map<string, string>();
    for (const node of graph.nodes) {
        if (node.kind === "INSTRUMENT" && node.symbol) symbolByNodeId.set(node.id, node.symbol);
    }
    const focusNodeId = instrumentNodeId(focus);

    const relationships: NonNullable<SetupCrossAssetSnapshot["relationships"]> = [];
    for (const edge of graph.edges) {
        if (!SETUP_SNAPSHOT_EDGE_TYPES.has(edge.relationshipType)) continue;
        const otherId =
            edge.sourceNodeId === focusNodeId
                ? edge.targetNodeId
                : edge.targetNodeId === focusNodeId
                  ? edge.sourceNodeId
                  : null;
        if (otherId === null) continue;
        const other = symbolByNodeId.get(otherId);
        if (!other || other === focus) continue;
        relationships.push({ symbol: other, coefficient: edge.coefficient, stability: edge.stability });
    }
    // Strongest |ρ| first; unknown coefficients (null) sort last, never first.
    relationships.sort((a, b) => {
        const av = a.coefficient === null ? -1 : Math.abs(a.coefficient);
        const bv = b.coefficient === null ? -1 : Math.abs(b.coefficient);
        return bv - av;
    });

    const focusInGraph = symbolByNodeId.has(focusNodeId);
    const reason = focusInGraph
        ? undefined
        : `Focus symbol ${focus} was not part of the computed graph universe — regime was measured, relationships were not.`;

    return {
        capturedAt,
        relationships: relationships.slice(0, max),
        regimeStates,
        window,
        status: "AVAILABLE",
        ...(reason ? { reason } : {}),
    };
}
