/**
 * AlgoVault — Cross-Asset Intelligence service (Phase 16).
 *
 * ── Server-only ────────────────────────────────────────────────────────────
 * The ONE place that assembles a market graph. Surfaces (Explorer API, Pro
 * Terminal, Analyst, Chat, agents, alerts, mobile) all call this so no two
 * surfaces can disagree about the same relationship.
 *
 * Performance rules (§48):
 *   • bounded universe with explicit priority:
 *       focus symbol → portfolio holdings → watchlist → canonical universe;
 *   • in-process TTL cache with miss-markers so an unavailable provider is not
 *     re-hit on every render;
 *   • lead-lag only runs for the focus symbol's strongest pairs (lazy), never
 *     for every pair;
 *   • nothing polls — the caller decides when to recompute.
 *
 * Honesty rules (§31, §45, §53):
 *   • a symbol the provider cannot serve lands in `unavailableSymbols` with a
 *     reason — never in the graph with invented data;
 *   • a failed pair computation increments `relationshipFailures` and is
 *     skipped, never silently zeroed;
 *   • the previous snapshot (RTDB) supplies previous coefficients, previous
 *     regime states and previous signals, so change/stability/transition
 *     detection is real rather than simulated.
 */

import { loadSymbolSeries, type SymbolMarketData } from "@/lib/portfolio/service";
import { normalizeSymbolInput } from "@/lib/market-data/twelvedata/symbol-map";
import type { Timeframe } from "@/lib/market-data/types";
import { buildClusters, detectClusterChanges, type ClusterChange } from "./clustering";
import {
    buildPortfolioImpact,
    buildSetupCrossAssetSnapshot,
    buildSymbolCrossAssetContext,
    crossAssetLimits,
    relationshipChanged,
    type PortfolioHolding,
} from "./context";
import { computeFactors } from "./factors";
import { computeLeadLag } from "./lead-lag";
import { generateSignals, reconcileSignals } from "./events";
import { buildInstrumentNode, buildMarketGraphSnapshot, diffSnapshots, type SnapshotDiff } from "./graph";
import { computeRelationship, truncateAt, type RelationshipResult } from "./relationships";
import { computeMarketRegime, type MarketRegimeResult } from "./regime";
import {
    loadLatestSnapshot,
    loadPreviousRegime,
    loadSignals,
    loadUserRelationships,
    recordGraphMetrics,
    saveRegime,
    saveSignals,
    saveSnapshot,
} from "./store";
import type {
    CrossAssetSignal,
    CrossAssetTier,
    LeadLagResult,
    MarketCluster,
    MarketFactor,
    MarketGraphSnapshot,
    MarketNode,
    RelationshipWindowBars,
    SymbolCrossAssetContext,
    UserDefinedRelationship,
} from "./types";
import { RELATIONSHIP_TIMEFRAMES, RELATIONSHIP_WINDOWS, relationshipTerm } from "./types";
import { crossAssetEngineVersions } from "./versions";
import type { SetupMemoryRecord } from "@/lib/market-intelligence/memory/types";

/* ── defaults & universe ──────────────────────────────────────────────────── */

export const DEFAULT_TIMEFRAME = "H1";
export const DEFAULT_BARS: RelationshipWindowBars = 100;
export const GRAPH_CACHE_TTL_MS = 5 * 60_000;

/** Canonical bounded universe — the instruments AlgoVault's registry serves. */
export const DEFAULT_CROSS_ASSET_UNIVERSE = [
    "XAUUSD",
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "USDCHF",
    "AUDUSD",
    "NZDUSD",
    "SPX500",
    "US30",
    "NAS100",
    "BTCUSD",
    "ETHUSD",
] as const;

/** Bars fetched per symbol: window + rolling-history headroom. */
export function barsToFetch(bars: number): number {
    return Math.max(300, bars + Math.ceil(bars / 10) * 6 + 50);
}

export interface SeriesLoader {
    (symbol: string, timeframe: Timeframe, limit: number): Promise<SymbolMarketData>;
}

/* ── cache ────────────────────────────────────────────────────────────────── */

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}
const graphCache = new Map<string, CacheEntry<CrossAssetGraphResult | boolean>>();

function cacheGet<T>(map: Map<string, CacheEntry<T | boolean>>, key: string, now: number): T | null {
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
        map.delete(key);
        return null;
    }
    return (entry.value as boolean) === true ? null : (entry.value as T);
}

function cacheSet<T>(map: Map<string, CacheEntry<T | boolean>>, key: string, value: T | boolean, ttl: number, now: number): void {
    if (map.size > 200) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
    }
    map.set(key, { value, expiresAt: now + ttl });
}

function hasMiss(map: Map<string, CacheEntry<CrossAssetGraphResult | boolean>>, key: string, now: number): boolean {
    const entry = map.get(key);
    return entry !== undefined && entry.value === true && entry.expiresAt > now;
}

export function invalidateCrossAssetCache(): void {
    graphCache.clear();
}

/* ── options ──────────────────────────────────────────────────────────────── */

export interface ComputeGraphOptions {
    focusSymbol?: string;
    watchlist?: string[];
    timeframe?: string;
    bars?: RelationshipWindowBars;
    tier?: CrossAssetTier;
    userId?: string;
    /** Compute lead-lag for the focus symbol's strongest pairs (PRO only). */
    leadLag?: boolean;
    /** Absolute cutoff for market data — defaults to `asOf ?? Date.now()` (§10). */
    asOf?: number;
    persist?: boolean;
    /** Record observability metrics (§54). Tests disable this explicitly. */
    metrics?: boolean;
    force?: boolean;
    now?: number;
    /* injectable inputs (tests / callers that already have them) */
    holdings?: PortfolioHolding[];
    grossExposure?: number;
    loadSeries?: SeriesLoader;
    previousSnapshot?: MarketGraphSnapshot | null;
    previousStates?: Partial<Record<string, string>>;
    previousSignals?: CrossAssetSignal[];
    userRelationships?: UserDefinedRelationship[];
    universe?: string[];
}

export interface CrossAssetGraphResult {
    snapshot: MarketGraphSnapshot;
    relationships: RelationshipResult[];
    clusters: MarketCluster[];
    factors: MarketFactor[];
    regime: MarketRegimeResult;
    signals: CrossAssetSignal[];
    leadLag: LeadLagResult[];
    userRelationships: UserDefinedRelationship[];
    universe: string[];
    diff: SnapshotDiff | null;
    clusterChanges: ClusterChange[];
    limitations: string[];
}

/* ── universe resolution (§48 priority) ───────────────────────────────────── */

export function resolveUniverse(options: ComputeGraphOptions, maxSymbols: number): string[] {
    const limits = crossAssetLimits(options.tier ?? "FREE");
    const cap = Math.min(maxSymbols, options.universe ? options.universe.length : limits.maxSymbols);
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (symbol?: string) => {
        if (!symbol) return;
        const upper = symbol.trim().toUpperCase();
        if (!upper || seen.has(upper)) return;
        if (out.length >= cap) return;
        seen.add(upper);
        out.push(upper);
    };

    push(options.focusSymbol);
    for (const h of options.holdings ?? []) push(h.symbol);
    for (const s of options.watchlist ?? []) push(s);
    for (const s of options.universe ?? DEFAULT_CROSS_ASSET_UNIVERSE) push(s);

    // Only symbols the canonical provider mapping can serve are requested.
    return out.filter((s) => options.universe !== undefined || normalizeSymbolInput(s) !== null);
}

/* ── previous-snapshot lookups ────────────────────────────────────────────── */

function previousCoefficients(snapshot: MarketGraphSnapshot | null): Map<string, number> {
    const map = new Map<string, number>();
    if (!snapshot) return map;
    for (const edge of snapshot.edges) {
        if (edge.coefficient === null) continue;
        if (edge.relationshipType !== "CORRELATION" && edge.relationshipType !== "INVERSE_CORRELATION") continue;
        if (edge.window.timeframe !== snapshot.window.timeframe || edge.window.bars !== snapshot.window.bars) continue;
        const a = edge.sourceNodeId.replace(/^instrument:/, "");
        const b = edge.targetNodeId.replace(/^instrument:/, "");
        const key = a <= b ? `${a}|${b}` : `${b}|${a}`;
        map.set(key, edge.coefficient);
    }
    return map;
}

/* ── main computation ─────────────────────────────────────────────────────── */

export async function computeCrossAssetGraph(
    options: ComputeGraphOptions = {}
): Promise<CrossAssetGraphResult> {
    const now = options.now ?? Date.now();
    const asOf = options.asOf ?? now;
    const timeframe = options.timeframe ?? DEFAULT_TIMEFRAME;
    const validTimeframe = (RELATIONSHIP_TIMEFRAMES as readonly string[]).includes(timeframe)
        ? (timeframe as (typeof RELATIONSHIP_TIMEFRAMES)[number])
        : DEFAULT_TIMEFRAME;
    const bars: RelationshipWindowBars = (RELATIONSHIP_WINDOWS as readonly number[]).includes(options.bars ?? DEFAULT_BARS)
        ? ((options.bars ?? DEFAULT_BARS) as RelationshipWindowBars)
        : DEFAULT_BARS;
    const window = { timeframe: validTimeframe, bars };
    const tier = options.tier ?? "FREE";
    const limits = crossAssetLimits(tier);
    const loadSeries = options.loadSeries ?? ((s, tf, limit) => loadSymbolSeries(s, tf, limit));

    const cacheKey = `${validTimeframe}:${bars}:${tier}:${options.focusSymbol ?? ""}:${(options.watchlist ?? []).join(",")}`;
    if (!options.force) {
        const cached = cacheGet<CrossAssetGraphResult>(graphCache, cacheKey, now);
        if (cached) return { ...cached, limitations: [...cached.limitations, "Served from the cross-asset cache (§48)."] };
        if (hasMiss(graphCache, cacheKey, now)) {
            return emptyResult(window, now, "Market data provider unavailable — cached miss (fail-closed, §45).");
        }
    }

    const loadStartedAt = Date.now();

    /* 1 — holdings (priority 2) when a user context exists */
    let holdings = options.holdings;
    if (!holdings && options.userId) {
        const loaded = await loadHoldings(options.userId).catch(() => null);
        if (loaded) holdings = loaded.holdings;
    }

    /* 2 — bounded universe */
    const universe = resolveUniverse({ ...options, holdings }, limits.maxSymbols);

    /* 3 — load series (parallel, bounded) */
    const series: Record<string, PriceSeriesLike | null> = {};
    const unavailableSymbols: Array<{ symbol: string; reason: string }> = [];
    const limit = barsToFetch(bars);
    await Promise.all(
        universe.map(async (symbol) => {
            try {
                const data = await loadSeries(symbol, validTimeframe, limit);
                if (data.status === "AVAILABLE" && data.series) {
                    series[symbol] = data.series as unknown as PriceSeriesLike;
                } else {
                    unavailableSymbols.push({ symbol, reason: data.reason ?? "No series returned." });
                    series[symbol] = null;
                }
            } catch (err) {
                unavailableSymbols.push({
                    symbol,
                    reason: `Market data load failed: ${err instanceof Error ? err.message : "unknown error"}`,
                });
                series[symbol] = null;
            }
        })
    );
    const loadDataMs = Date.now() - loadStartedAt;

    const measurable = universe.filter((s) => series[s] !== null);
    const computeStartedAt = Date.now();

    /* 4 — previous state (change detection must compare against real history) */
    const previousSnapshot =
        options.previousSnapshot !== undefined
            ? options.previousSnapshot
            : await loadLatestSnapshot("global").catch(() => null);
    const prevCoeffs = previousCoefficients(previousSnapshot);
    const previousStatesRaw =
        options.previousStates ??
        (await loadPreviousRegime("global").catch(() => null))?.states;
    const previousSignals =
        options.previousSignals ?? (await loadSignals("global").catch(() => []));

    const userRelationships =
        options.userRelationships ??
        (options.userId ? await loadUserRelationships(options.userId).catch(() => []) : []);

    /* 5 — relationships for every pair (bounded: ≤ 12 symbols → 66 pairs) */
    const relationships: RelationshipResult[] = [];
    let relationshipFailures = 0;
    for (let i = 0; i < measurable.length; i += 1) {
        for (let j = i + 1; j < measurable.length; j += 1) {
            const a = measurable[i];
            const b = measurable[j];
            const key = a <= b ? `${a}|${b}` : `${b}|${a}`;
            try {
                const result = computeRelationship({
                    a: series[a] as never,
                    b: series[b] as never,
                    window,
                    asOf,
                    calculatedAt: now,
                    previousCoefficient: prevCoeffs.get(key) ?? null,
                    // Focus pairs get a longer timeline for the Explorer (§23).
                    timelinePoints:
                        options.focusSymbol && (a === options.focusSymbol.toUpperCase() || b === options.focusSymbol.toUpperCase())
                            ? 30
                            : undefined,
                });
                relationships.push(result);
            } catch (err) {
                relationshipFailures += 1;
                void err; // counted in observability; the pair is skipped, never guessed
            }
        }
    }

    /* 6 — clusters (with previous membership for change detection) */
    const clusterResult = buildClusters({
        symbols: measurable,
        results: relationships,
        window,
        calculatedAt: now,
        previousClusters: previousSnapshot?.clusters,
    });
    const clusterChanges = detectClusterChanges(previousSnapshot?.clusters ?? [], clusterResult.clusters);

    /* 7 — factors */
    const { factors } = computeFactors({
        series: series as never,
        window,
        asOf,
        calculatedAt: now,
    });

    /* 8 — regime (multi-axis, with previous states for transitions) */
    const engineVersions = crossAssetEngineVersions({
        correlation: "1.0.0",
        portfolio: "1.0.0",
    });
    const regime = computeMarketRegime({
        scope: "global",
        window,
        series: series as never,
        relationships,
        factors,
        asOf,
        calculatedAt: now,
        engineVersions,
        previousStates: previousStatesRaw as never,
    });

    /* 9 — lead-lag: focus symbol only, strongest pairs, PRO only (§48) */
    const leadLag: LeadLagResult[] = [];
    if (options.leadLag && tier === "PRO" && options.focusSymbol) {
        const focus = options.focusSymbol.toUpperCase();
        const focusPairs = relationships
            .filter((r) => (r.a === focus || r.b === focus) && r.coefficient !== null)
            .sort((x, y) => Math.abs(y.coefficient ?? 0) - Math.abs(x.coefficient ?? 0))
            .slice(0, 5);
        for (const pair of focusPairs) {
            try {
                const result = computeLeadLag({
                    a: series[pair.a] as never,
                    b: series[pair.b] as never,
                    window,
                    asOf,
                    calculatedAt: now,
                });
                if (result) leadLag.push(result);
            } catch {
                relationshipFailures += 1;
            }
        }
    }

    /* 10 — signals + reconciliation against stored history (§18) */
    const fresh = generateSignals({
        relationships,
        clusters: clusterResult.clusters,
        clusterChanges,
        regimeTransitions: regime.transitions,
        leadLag,
        window,
        calculatedAt: now,
    });
    const signals = reconcileSignals(previousSignals, fresh, now);

    /* 11 — nodes */
    const instruments: MarketNode[] = universe.map(buildInstrumentNode);

    const computeMs = Date.now() - computeStartedAt;
    const staleThresholdMs = 2 * windowBarsMs(window);
    const staleRelationships = relationships.filter(
        (r) => r.coefficient !== null && asOf - r.dataTimestamp > staleThresholdMs
    ).length;

    /* 12 — immutable snapshot (§43) */
    const snapshot = buildMarketGraphSnapshot({
        scope: "global",
        window,
        instruments,
        relationships,
        clusters: clusterResult.clusters,
        factors,
        regime: regime.snapshot,
        signals,
        userRelationships,
        unavailableSymbols,
        engineVersions,
        createdAt: now,
        observability: {
            loadDataMs,
            computeMs,
            relationshipFailures,
            staleRelationships,
            cacheHits: 0,
            cacheMisses: 1,
            nodeCount: instruments.length,
            edgeCount: 0, // filled below
        },
    });
    snapshot.observability.edgeCount = snapshot.edges.length;
    snapshot.observability.nodeCount = snapshot.nodes.length;

    const diff = previousSnapshot ? diffSnapshots(previousSnapshot, snapshot) : null;

    const limitations = [
        ...snapshot.limitations,
        ...clusterResult.limitations,
        ...regime.snapshot.limitations,
        `Universe: ${universe.length} symbol(s) bounded by the ${tier} tier (priority: focus → portfolio → watchlist → canonical universe).`,
    ];

    const result: CrossAssetGraphResult = {
        snapshot,
        relationships,
        clusters: clusterResult.clusters,
        factors,
        regime,
        signals,
        leadLag,
        userRelationships,
        universe,
        diff,
        clusterChanges,
        limitations: Array.from(new Set(limitations)),
    };

    /* cache + optional persistence */
    const failed = unavailableSymbols.length === universe.length && universe.length > 0;
    if (failed) cacheSet(graphCache, cacheKey, true, 30_000, now);
    else cacheSet(graphCache, cacheKey, result, GRAPH_CACHE_TTL_MS, now);

    if (options.persist) {
        await saveSnapshot(snapshot).catch(() => undefined);
        await saveSignals("global", signals).catch(() => undefined);
        await saveRegime("global", { states: regime.snapshot.states, calculatedAt: now }).catch(() => undefined);
    }
    if (options.metrics !== false) {
        await recordGraphMetrics("global", {
            computeMs: loadDataMs + computeMs,
            nodeCount: snapshot.nodes.length,
            edgeCount: snapshot.edges.length,
            relationshipFailures,
            staleRelationships,
            dataQuality: snapshot.dataQuality.status,
            at: now,
        }).catch(() => undefined);
    }

    return result;
}

/**
 * Latest stored graph for agent/workflow contexts (Phase 16 §33). Bounded
 * RTDB read — never recomputes the graph inside an agent runtime. Returns null
 * when nothing has been persisted yet (consumers must fail closed).
 */
export async function loadLatestCrossAssetContext(): Promise<MarketGraphSnapshot | null> {
    try {
        const { loadLatestSnapshot } = await import("./store");
        return await loadLatestSnapshot("global");
    } catch {
        return null;
    }
}

/**
 * Phase 16 §40 — freezes the latest stored graph's cross-asset context onto a
 * Setup Memory record. One bounded RTDB read; the graph is NEVER recomputed
 * here. Fail-closed: a missing/failed graph yields `status: UNAVAILABLE` with
 * a reason so the learning loop can tell "no relationship" from "no data".
 */
export async function captureSetupCrossAssetSnapshot(options?: {
    symbol?: string;
    capturedAt?: number;
}): Promise<SetupMemoryRecord["crossAsset"]> {
    const graph = await loadLatestCrossAssetContext();
    return buildSetupCrossAssetSnapshot({
        symbol: options?.symbol,
        graph,
        capturedAt: options?.capturedAt,
    });
}

/* ── per-symbol context (§19, §20) ────────────────────────────────────────── */

export interface SymbolContextOptions extends ComputeGraphOptions {
    symbol: string;
}

export async function getSymbolCrossAssetContext(
    options: SymbolContextOptions
): Promise<SymbolCrossAssetContext> {
    const graph = await computeCrossAssetGraph(options);
    const focus = options.symbol.toUpperCase();

    let impact = null as ReturnType<typeof buildPortfolioImpact> | null;
    const holdings = options.holdings;
    const grossExposure = options.grossExposure;
    if (holdings && grossExposure && grossExposure > 0) {
        impact = buildPortfolioImpact({
            focusSymbol: focus,
            holdings,
            grossExposure,
            relationships: graph.relationships,
            clusters: graph.clusters,
        });
    } else if (options.userId) {
        const loaded = await loadHoldings(options.userId).catch(() => null);
        if (loaded && loaded.grossExposure > 0) {
            impact = buildPortfolioImpact({
                focusSymbol: focus,
                holdings: loaded.holdings,
                grossExposure: loaded.grossExposure,
                relationships: graph.relationships,
                clusters: graph.clusters,
            });
        }
    }

    const focusRelationships = graph.relationships.filter((r) => r.a === focus || r.b === focus);
    const dataTimestamp = focusRelationships.reduce((max, r) => Math.max(max, r.dataTimestamp), 0);

    return buildSymbolCrossAssetContext({
        symbol: focus,
        window: graph.snapshot.window,
        relationships: focusRelationships,
        clusters: graph.clusters,
        regime: graph.regime.snapshot,
        factors: graph.factors,
        signals: graph.signals,
        portfolioImpact: impact,
        dataTimestamp,
        calculatedAt: graph.snapshot.createdAt,
        engineVersions: graph.snapshot.engineVersions,
    });
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

type PriceSeriesLike = Parameters<typeof truncateAt>[0];

function windowBarsMs(window: { timeframe: string; bars: number }): number {
    const tfMs: Record<string, number> = {
        M5: 300_000,
        M15: 900_000,
        M30: 1_800_000,
        H1: 3_600_000,
        H4: 14_400_000,
        D1: 86_400_000,
    };
    return (tfMs[window.timeframe] ?? 3_600_000) * window.bars;
}

function emptyResult(window: { timeframe: (typeof RELATIONSHIP_TIMEFRAMES)[number]; bars: RelationshipWindowBars }, now: number, reason: string): CrossAssetGraphResult {
    const snapshot = buildMarketGraphSnapshot({
        scope: "global",
        window,
        instruments: [],
        relationships: [],
        clusters: [],
        factors: [],
        regime: null,
        signals: [],
        userRelationships: [],
        unavailableSymbols: [],
        engineVersions: crossAssetEngineVersions(),
        createdAt: now,
        observability: {
            loadDataMs: 0,
            computeMs: 0,
            relationshipFailures: 0,
            staleRelationships: 0,
            cacheHits: 0,
            cacheMisses: 1,
            nodeCount: 0,
            edgeCount: 0,
        },
    });
    return {
        snapshot,
        relationships: [],
        clusters: [],
        factors: [],
        regime: {
            snapshot: {
                id: `regime:global:${now}`,
                scope: "global",
                axes: [],
                states: {},
                activeStates: ["UNKNOWN"],
                calculatedAt: now,
                dataTimestamp: 0,
                window,
                engineVersions: snapshot.engineVersions,
                notComputed: ["risk", "volatility", "correlation", "trend", "stress"],
                limitations: [reason],
            },
            transitions: [],
        },
        signals: [],
        leadLag: [],
        userRelationships: [],
        universe: [],
        diff: null,
        clusterChanges: [],
        limitations: [reason],
    };
}

/**
 * Holdings via the ONE canonical portfolio bundle (Phase 15) — the cross-asset
 * layer never re-implements exposure maths.
 */
async function loadHoldings(
    userId: string
): Promise<{ holdings: PortfolioHolding[]; grossExposure: number }> {
    const { buildPortfolioBundle } = await import("@/lib/portfolio/service");
    const bundle = await buildPortfolioBundle({ userId });
    const holdings = bundle.snapshot.exposure.bySymbol.map((slice) => ({
        symbol: slice.key,
        grossNotional: slice.grossNotional,
    }));
    return { holdings, grossExposure: bundle.snapshot.exposure.grossExposure };
}

export { relationshipTerm, relationshipChanged };
