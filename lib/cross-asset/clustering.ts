/**
 * AlgoVault — Market Clustering (Phase 16 §11, §12).
 *
 * PURE + DETERMINISTIC. Correlation-distance hierarchical clustering with
 * average linkage — no LLM, no randomness, no hardcoded groups. "BTC is
 * always risk-on" is never encoded here; clusters are whatever the measured
 * correlations say they are right now.
 *
 * Method (documented so it can be reproduced):
 *   distance(a, b) = (1 − ρ_ab) / 2          ∈ [0, 1]
 *   linkage         = average of member-pair distances
 *   cut             = merge while avgDistance ≤ distanceThreshold (default 0.5
 *                     ⇔ average ρ ≥ 0.5 inside the cluster)
 *   ties            = resolved by lexicographic cluster-id order, so the same
 *                     inputs always produce the same clusters.
 *
 * Pairs with no measurable coefficient are treated as distance 1 (never
 * merged) — missing data never pulls symbols together.
 */

import type { Evidence, MarketCluster, RelationshipWindow } from "./types";
import { instrumentNodeId } from "./ids";
import { pairKey, type RelationshipResult } from "./relationships";
import { CLUSTER_ENGINE_VERSION } from "./versions";
import { instrumentMetadata } from "@/lib/portfolio/instruments";

/**
 * Default cut: distance 0.25 ⇔ average ρ ≥ 0.5 inside a cluster. Tight enough
 * that "these move together" means something, loose enough that genuine
 * co-moving groups (USD-sensitive, risk assets) can form.
 */
export const DEFAULT_CLUSTER_DISTANCE_THRESHOLD = 0.25;
/** Members needed before a group is called a cluster (§11 examples are ≥2). */
export const MIN_CLUSTER_MEMBERS = 2;

export interface ClusterInput {
    symbols: string[];
    results: RelationshipResult[];
    window: RelationshipWindow;
    calculatedAt: number;
    distanceThreshold?: number;
    /** Prior snapshot's clusters, used to annotate membership change (§11). */
    previousClusters?: MarketCluster[];
}

export interface ClusterResult {
    clusters: MarketCluster[];
    unclustered: string[];
    distanceThreshold: number;
    method: "CORRELATION_DISTANCE_AVERAGE_LINKAGE";
    limitations: string[];
}

/** Distance lookup with an honest "unmeasured = 1" default. */
function distanceLookup(results: RelationshipResult[]): (a: string, b: string) => number {
    const byPair = new Map<string, number | null>();
    for (const r of results) {
        byPair.set(pairKey(r.a, r.b), r.coefficient);
    }
    return (a, b) => {
        if (a === b) return 0;
        const rho = byPair.get(pairKey(a, b));
        if (rho === undefined || rho === null) return 1;
        return (1 - rho) / 2;
    };
}

/** Deterministic label: dominant asset class when ≥ 70% share it, else Mixed. */
export function clusterLabel(members: string[]): string {
    const counts = new Map<string, number>();
    for (const symbol of members) {
        const cls = instrumentMetadata(symbol).assetClass ?? "UNAVAILABLE";
        counts.set(cls, (counts.get(cls) ?? 0) + 1);
    }
    let best = "";
    let bestCount = 0;
    for (const [cls, count] of Array.from(counts.entries()).sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        if (count > bestCount) {
            best = cls;
            bestCount = count;
        }
    }
    if (best && bestCount / members.length >= 0.7) return `${best} cluster`;
    return `Mixed cluster (${members.join(", ")})`;
}

/**
 * Average-linkage agglomerative clustering with a distance cut.
 * Deterministic: candidate merges are always picked by (distance, id order).
 */
export function buildClusters(input: ClusterInput): ClusterResult {
    const threshold = input.distanceThreshold ?? DEFAULT_CLUSTER_DISTANCE_THRESHOLD;
    const symbols = [...new Set(input.symbols)].sort();
    const dist = distanceLookup(input.results);
    const limitations: string[] = [
        `Clusters use correlation distance (1−ρ)/2 with average linkage, cut at ${threshold.toFixed(2)} (⇒ mean ρ ≥ ${(1 - 2 * threshold).toFixed(2)} inside a cluster) over ${input.window.bars} ${input.window.timeframe} bars.`,
        "Clusters describe recent co-movement only — membership is expected to change as relationships change (§11).",
        `Engine ${CLUSTER_ENGINE_VERSION}.`,
    ];

    if (symbols.length < MIN_CLUSTER_MEMBERS) {
        return {
            clusters: [],
            unclustered: symbols,
            distanceThreshold: threshold,
            method: "CORRELATION_DISTANCE_AVERAGE_LINKAGE",
            limitations: [...limitations, "Fewer than two measurable symbols — clustering skipped."],
        };
    }

    // Start from singletons (sorted ids keep tie-breaking deterministic).
    const groups: string[][] = symbols.map((s) => [s]);
    const meanDistance = (a: string[], b: string[]): number => {
        let sum = 0;
        let count = 0;
        for (const x of a) {
            for (const y of b) {
                sum += dist(x, y);
                count += 1;
            }
        }
        return count > 0 ? sum / count : 1;
    };

    while (groups.length > 1) {
        let best: { i: number; j: number; d: number } | null = null;
        for (let i = 0; i < groups.length; i += 1) {
            for (let j = i + 1; j < groups.length; j += 1) {
                const d = meanDistance(groups[i], groups[j]);
                const better =
                    !best ||
                    d < best.d - 1e-12 ||
                    (Math.abs(d - best.d) <= 1e-12 &&
                        [...groups[i], ...groups[j]].join(",") < [...groups[best.i], ...groups[best.j]].join(","));
                if (better) best = { i, j, d };
            }
        }
        if (!best || best.d > threshold) break;
        const merged = [...groups[best.i], ...groups[best.j]].sort();
        groups.splice(best.j, 1);
        groups.splice(best.i, 1, merged);
    }

    const previousByKey = new Map<string, string>();
    for (const prev of input.previousClusters ?? []) {
        for (const member of prev.memberNodeIds) previousByKey.set(member, prev.id);
    }

    const clusters: MarketCluster[] = [];
    const unclustered: string[] = [];

    for (const members of groups) {
        if (members.length < MIN_CLUSTER_MEMBERS) {
            unclustered.push(...members);
            continue;
        }
        let rhoSum = 0;
        let pairs = 0;
        for (let i = 0; i < members.length; i += 1) {
            for (let j = i + 1; j < members.length; j += 1) {
                const d = dist(members[i], members[j]);
                if (d < 1) {
                    rhoSum += 1 - 2 * d;
                    pairs += 1;
                }
            }
        }
        const meanCorrelation = pairs > 0 ? Math.round((rhoSum / pairs) * 10_000) / 10_000 : null;
        const nodeIds = members.map(instrumentNodeId).sort();
        const id = `cluster:${nodeIds.join("_")}`.slice(0, 160);

        const changedFrom = previousByKey.get(nodeIds[0]);
        const evidence: Evidence[] = [
            {
                id: `ev:cluster:${id}`,
                kind: "CALCULATED",
                source: "cluster:average-linkage",
                text:
                    meanCorrelation !== null
                        ? `${members.length} instruments (${members.join(", ")}) form a cluster with mean pairwise correlation ${meanCorrelation.toFixed(2)} over ${input.window.bars} ${input.window.timeframe} bars.`
                        : `${members.length} instruments (${members.join(", ")}) merged without enough measured pairs to report a mean correlation.`,
                dataTimestamp: input.results[0]?.dataTimestamp,
                value: meanCorrelation ?? undefined,
            },
        ];
        if (changedFrom === undefined && previousByKey.size > 0) {
            evidence.push({
                id: `ev:cluster-change:${id}`,
                kind: "CALCULATED",
                source: "cluster:change",
                text: `This cluster membership was not present in the previous snapshot — cluster composition changed.`,
            });
        }

        clusters.push({
            id,
            label: clusterLabel(members),
            memberNodeIds: nodeIds,
            method: "CORRELATION_DISTANCE_AVERAGE_LINKAGE",
            distanceThreshold: threshold,
            meanCorrelation,
            window: { ...input.window },
            calculatedAt: input.calculatedAt,
            dataTimestamp: input.results[0]?.dataTimestamp ?? 0,
            dataQuality: {
                sampleSize: pairs,
                requiredBars: (members.length * (members.length - 1)) / 2,
                dataCoverage: 1,
                missingBars: 0,
                status: pairs > 0 ? "GOOD" : "INSUFFICIENT_DATA",
            },
            evidence,
            limitations,
        });
    }

    clusters.sort((a, b) => b.memberNodeIds.length - a.memberNodeIds.length || (a.id < b.id ? -1 : 1));
    unclustered.sort();

    if (unclustered.length > 0) {
        limitations.push(`${unclustered.length} symbol(s) had no partner above the threshold and are reported as unclustered.`);
    }

    return {
        clusters,
        unclustered,
        distanceThreshold: threshold,
        method: "CORRELATION_DISTANCE_AVERAGE_LINKAGE",
        limitations,
    };
}

/* ── Cluster change detection (§11, §18) ──────────────────────────────────── */

export interface ClusterChange {
    kind: "NEW" | "DISSOLVED" | "MEMBERSHIP_CHANGED";
    clusterId: string;
    members: string[];
    text: string;
}

/** Compare two cluster snapshots; empty array means nothing changed. */
export function detectClusterChanges(
    previous: MarketCluster[],
    next: MarketCluster[]
): ClusterChange[] {
    const changes: ClusterChange[] = [];
    const prevMembers = new Map(previous.map((c) => [c.id, new Set(c.memberNodeIds)]));
    const nextMembers = new Map(next.map((c) => [c.id, new Set(c.memberNodeIds)]));

    const memberSignature = (set: Set<string>): string => Array.from(set).sort().join(",");

    for (const [id, members] of prevMembers) {
        if (!nextMembers.has(id)) {
            changes.push({
                kind: "DISSOLVED",
                clusterId: id,
                members: Array.from(members),
                text: `Cluster dissolved: ${Array.from(members).join(", ")} no longer co-move above the threshold.`,
            });
        }
    }
    for (const [id, members] of nextMembers) {
        const prev = prevMembers.get(id);
        if (!prev) {
            changes.push({
                kind: "NEW",
                clusterId: id,
                members: Array.from(members),
                text: `New cluster observed: ${Array.from(members).join(", ")} now co-move above the threshold.`,
            });
        } else if (memberSignature(prev) !== memberSignature(members)) {
            changes.push({
                kind: "MEMBERSHIP_CHANGED",
                clusterId: id,
                members: Array.from(members),
                text: `Cluster membership changed for ${id}: now ${Array.from(members).join(", ")}.`,
            });
        }
    }
    return changes;
}
