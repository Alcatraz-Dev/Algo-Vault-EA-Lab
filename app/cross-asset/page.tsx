"use client";

/**
 * Market Relationship Explorer (Phase 16 §22).
 *
 * Search a symbol, inspect the interactive graph, correlation matrix,
 * relationship timeline, regime, clusters, factors and events. Every value on
 * this page comes from the deterministic relationship engine — if the engine
 * produced nothing, the page says so (§45, §55).
 */

import { useCallback, useMemo, useState } from "react";
import { Loader2, Network, RefreshCw, Search, Sparkles, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { RELATIONSHIP_TIMEFRAMES, RELATIONSHIP_WINDOWS } from "@/lib/cross-asset/types";
import {
    EdgeInspector,
    MarketGraphCanvas,
    type EdgeFilter,
} from "@/components/cross-asset/MarketGraphCanvas";
import {
    ClustersPanel,
    CorrelationMatrix,
    EventsPanel,
    FactorsPanel,
    RelationshipList,
    RelationshipTimeline,
    RegimePanel,
} from "@/components/cross-asset/ExplorerPanels";
import { useCrossAsset } from "@/components/cross-asset/useCrossAsset";

const FILTERS: Array<{ id: EdgeFilter; label: string }> = [
    { id: "measured", label: "Measured" },
    { id: "all", label: "All" },
    { id: "user", label: "User-defined" },
    { id: "asset_class", label: "Asset class" },
    { id: "currency", label: "Currency" },
    { id: "exposure", label: "Factor inputs" },
];

export default function CrossAssetExplorerPage() {
    const [symbol, setSymbol] = useState("XAUUSD");
    const [query, setQuery] = useState("XAUUSD");
    const [timeframe, setTimeframe] = useState<(typeof RELATIONSHIP_TIMEFRAMES)[number]>("H1");
    const [bars, setBars] = useState<(typeof RELATIONSHIP_WINDOWS)[number]>(100);
    const [filter, setFilter] = useState<EdgeFilter>("measured");
    const [selectedPair, setSelectedPair] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

    const { data, loading, error, reload } = useCrossAsset({ symbol, timeframe, bars });

    const selectNode = useCallback((next: string | null) => {
        if (next) {
            setSymbol(next);
            setQuery(next);
            setSelectedPair(null);
            setSelectedEdgeId(null);
        }
    }, []);

    const selectedEdge = useMemo(
        () => data?.edges.find((e) => e.id === selectedEdgeId) ?? null,
        [data, selectedEdgeId]
    );
    const selectedRelationship = useMemo(() => {
        if (!selectedEdge || !data) return undefined;
        const a = selectedEdge.sourceNodeId.replace(/^instrument:/, "");
        const b = selectedEdge.targetNodeId.replace(/^instrument:/, "");
        return data.relationships.find(
            (r) => (r.a === a && r.b === b) || (r.a === b && r.b === a)
        );
    }, [selectedEdge, data]);

    const timelinePair = useMemo(() => {
        if (!data) return null;
        if (selectedPair) {
            const [a, b] = selectedPair.split("|");
            return data.relationships.find((r) => r.a === a && r.b === b) ?? null;
        }
        const focus = symbol.toUpperCase();
        return (
            data.relationships
                .filter((r) => (r.a === focus || r.b === focus) && r.coefficient !== null)
                .sort((x, y) => Math.abs(y.coefficient ?? 0) - Math.abs(x.coefficient ?? 0))[0] ?? null
        );
    }, [data, selectedPair, symbol]);

    const matrixSymbols = useMemo(() => data?.universe ?? [], [data]);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-7xl px-4 py-6">
                {/* header */}
                <header className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="flex items-center gap-2 text-lg font-semibold">
                            <Network className="size-5 text-primary" />
                            Market Relationship Explorer
                        </h1>
                        <p className="text-xs text-muted-foreground">
                            Deterministic cross-asset intelligence — every edge is measured, every label carries evidence
                            (Phase 16).
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {data ? (
                            <span
                                className={cn(
                                    "rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                                    data.tier === "PRO" ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/20 text-zinc-300"
                                )}
                            >
                                {data.tier} tier
                            </span>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => reload(true)}
                            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs transition hover:bg-muted"
                            disabled={loading}
                        >
                            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                            Recompute
                        </button>
                    </div>
                </header>

                {/* controls */}
                <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
                    <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Symbol
                        <span className="flex items-center gap-1">
                            <Search className="size-3" />
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value.toUpperCase())}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && query.trim()) {
                                        setSymbol(query.trim().toUpperCase());
                                        setSelectedPair(null);
                                    }
                                }}
                                className="w-32 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-primary"
                                aria-label="Search symbol"
                            />
                        </span>
                    </label>
                    <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Timeframe
                        <select
                            value={timeframe}
                            onChange={(e) => setTimeframe(e.target.value as (typeof RELATIONSHIP_TIMEFRAMES)[number])}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
                        >
                            {RELATIONSHIP_TIMEFRAMES.map((tf) => (
                                <option key={tf} value={tf}>
                                    {tf}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Window
                        <select
                            value={bars}
                            onChange={(e) => setBars(Number(e.target.value) as (typeof RELATIONSHIP_WINDOWS)[number])}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
                        >
                            {RELATIONSHIP_WINDOWS.map((w) => (
                                <option key={w} value={w}>
                                    {w} bars
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className="flex flex-wrap gap-1">
                        {FILTERS.map((f) => (
                            <button
                                key={f.id}
                                type="button"
                                onClick={() => setFilter(f.id)}
                                className={cn(
                                    "rounded-full border px-2.5 py-1 text-[10px] transition",
                                    filter === f.id
                                        ? "border-primary bg-primary/15 text-primary"
                                        : "border-border text-muted-foreground hover:bg-muted"
                                )}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* status banners */}
                {error ? (
                    <div role="alert" className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        <TriangleAlert className="size-4 shrink-0" />
                        {error}
                    </div>
                ) : null}
                {data && data.unavailableSymbols.length > 0 ? (
                    <p className="mt-3 text-[11px] text-muted-foreground">
                        Excluded (no usable data): {data.unavailableSymbols.map((u) => `${u.symbol} — ${u.reason}`).join(" | ")}
                    </p>
                ) : null}
                {data && data.upgrade ? (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
                        <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                            Free tier: top relationships + basic market context. Pro unlocks {data.upgrade.join(", ")} (§51).
                        </span>
                    </div>
                ) : null}

                {/* graph + inspector */}
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
                    <MarketGraphCanvas
                        nodes={data?.nodes ?? []}
                        edges={data?.edges ?? []}
                        focusSymbol={symbol.toUpperCase()}
                        filter={filter}
                        onSelectNode={selectNode}
                        onSelectEdge={(edge) => setSelectedEdgeId(edge?.id ?? null)}
                        selectedEdgeId={selectedEdgeId}
                        emptyReason={loading ? "Loading the market graph…" : error ?? undefined}
                    />
                    <div className="space-y-3">
                        {selectedEdge ? (
                            <EdgeInspector
                                edge={selectedEdge}
                                relationship={selectedRelationship}
                                onClose={() => setSelectedEdgeId(null)}
                            />
                        ) : (
                            <div className="rounded-lg border border-dashed border-border bg-card/50 p-3 text-xs text-muted-foreground">
                                Hover a node to highlight its connections. Click a node to focus it, or click an edge to
                                inspect its evidence, window, sample size and data quality (§21).
                            </div>
                        )}
                        <RegimePanel regime={data?.regime} transitions={data?.regimeTransitions} />
                    </div>
                </div>

                {/* relationships + timeline */}
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <RelationshipList
                        rows={data?.relationships ?? []}
                        focusSymbol={symbol.toUpperCase()}
                        selectedPair={selectedPair}
                        onSelect={setSelectedPair}
                    />
                    <section className="rounded-lg border border-border bg-card p-3">
                        <header className="flex items-baseline justify-between gap-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                                Correlation timeline
                            </h3>
                            <span className="font-mono text-[10px] text-muted-foreground">
                                {timelinePair ? `${timelinePair.a} ↔ ${timelinePair.b}` : "select a relationship"}
                            </span>
                        </header>
                        <div className="mt-2">
                            {timelinePair ? (
                                <RelationshipTimeline
                                    observations={timelinePair.observations}
                                    pairLabel={`${timelinePair.a} ↔ ${timelinePair.b}`}
                                />
                            ) : (
                                <p className="text-xs text-muted-foreground">
                                    Pick a relationship from the list (or click an edge) to inspect its historical
                                    window (§23).
                                </p>
                            )}
                        </div>
                    </section>
                </div>

                {/* matrix */}
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <section className="rounded-lg border border-border bg-card p-3">
                        <header className="flex items-baseline justify-between gap-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                                Correlation matrix
                            </h3>
                            <span className="text-[10px] text-muted-foreground">
                                {bars} {timeframe} bars · click a cell to select the pair
                            </span>
                        </header>
                        <div className="mt-2">
                            <CorrelationMatrix
                                cells={data?.matrix ?? []}
                                symbols={matrixSymbols}
                                onSelectPair={(a, b) => setSelectedPair(`${a}|${b}`)}
                            />
                        </div>
                    </section>
                    <div className="grid gap-3">
                        <section className="rounded-lg border border-border bg-card p-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Clusters</h3>
                            <div className="mt-2">
                                <ClustersPanel clusters={data?.clusters} />
                            </div>
                        </section>
                        <section className="rounded-lg border border-border bg-card p-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Market factors</h3>
                            <div className="mt-2">
                                <FactorsPanel factors={data?.factors} />
                            </div>
                        </section>
                    </div>
                </div>

                {/* events */}
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <section className="rounded-lg border border-border bg-card p-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                            Cross-asset events
                        </h3>
                        <div className="mt-2">
                            <EventsPanel signals={data?.signals} />
                        </div>
                    </section>
                    <section className="rounded-lg border border-border bg-card p-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Lead-lag (observed)</h3>
                        <div className="mt-2 space-y-2">
                            {(data?.leadLag ?? []).length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                    Lead-lag analysis runs on Pro for the focused symbol and only when enough aligned
                                    history exists. An observed lead-lag is a historical association — never a prediction
                                    (§9, §57).
                                </p>
                            ) : (
                                (data?.leadLag ?? []).map((l) => (
                                    <div key={`${l.leader}-${l.follower}`} className="rounded border border-border/70 p-2 text-[11px]">
                                        <p className="font-mono text-xs text-foreground">
                                            {l.leader} → {l.follower} @ {l.lag} bar(s) · ρ {l.coefficient.toFixed(2)} · p{" "}
                                            {l.pValue === null ? "n/a" : l.pValue.toFixed(3)} · n {l.sampleSize}
                                        </p>
                                        <p className="mt-0.5 text-muted-foreground">{l.stabilityNote}</p>
                                        <p className="mt-0.5 text-[10px] text-muted-foreground/80">{l.limitations[0]}</p>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>
                </div>

                {/* provenance */}
                {data ? (
                    <footer className="mt-4 rounded-lg border border-border bg-card/60 p-3 text-[10px] leading-4 text-muted-foreground">
                        <p className="font-mono">
                            snapshot {data.snapshot.snapshotId} · data ts{" "}
                            {data.snapshot.dataTimestamp ? new Date(data.snapshot.dataTimestamp).toISOString() : "—"} ·
                            engines {Object.entries(data.snapshot.engineVersions).map(([k, v]) => `${k}=${v}`).join(" ")}
                        </p>
                        <p className="mt-1">
                            quality {data.snapshot.dataQuality.status} ({(data.snapshot.dataQuality.dataCoverage * 100).toFixed(0)}% coverage)
                            {" · "}
                            {data.snapshot.observability.nodeCount ?? 0} nodes / {data.snapshot.observability.edgeCount ?? 0} edges
                            {" · load "}
                            {data.snapshot.observability.loadDataMs ?? 0}ms · compute {data.snapshot.observability.computeMs ?? 0}ms
                        </p>
                        <ul className="mt-1 list-inside list-disc">
                            {data.limitations.slice(0, 6).map((l) => (
                                <li key={l}>{l}</li>
                            ))}
                        </ul>
                    </footer>
                ) : null}
            </div>
        </div>
    );
}
