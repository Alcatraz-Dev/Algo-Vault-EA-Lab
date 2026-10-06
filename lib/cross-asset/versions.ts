/**
 * AlgoVault — Cross-Asset engine versions (Phase 16 §44).
 *
 * Every cross-asset artefact (edge, cluster, factor, regime, snapshot) carries
 * these versions so a historical result can be reproduced against the exact
 * engine that produced it. Bump the constant whenever the calculation changes
 * in a way that could alter output; never edit historical snapshots.
 */

/** Contract version of the graph/snapshot shapes in `types.ts`. */
export const MARKET_GRAPH_CONTRACT_VERSION = "1.0.0";

/** Rolling relationship / stability / break-flip maths. */
export const RELATIONSHIP_ENGINE_VERSION = "1.0.0";

/** Lead-lag cross-correlation engine. */
export const LEAD_LAG_ENGINE_VERSION = "1.0.0";

/** Correlation-distance clustering. */
export const CLUSTER_ENGINE_VERSION = "1.0.0";

/** Deterministic factor construction (derived baskets etc.). */
export const FACTOR_ENGINE_VERSION = "1.0.0";

/** Global market regime engine (multi-axis, evidence-backed). */
export const REGIME_ENGINE_VERSION = "1.0.0";

/** Node construction from the canonical instrument registry. */
export const MARKET_NODE_METADATA_VERSION = "1.0.0";

/** Per-symbol cross-asset context contract (Pro Terminal / Analyst / Chat). */
export const CROSS_ASSET_CONTEXT_VERSION = "1.0.0";

/** Full version block attached to every snapshot. */
export function crossAssetEngineVersions(input?: { correlation?: string; portfolio?: string }) {
    return {
        marketData: "unversioned",
        relationship: RELATIONSHIP_ENGINE_VERSION,
        regime: REGIME_ENGINE_VERSION,
        factor: FACTOR_ENGINE_VERSION,
        graph: MARKET_GRAPH_CONTRACT_VERSION,
        correlation: input?.correlation,
        portfolio: input?.portfolio,
    };
}
