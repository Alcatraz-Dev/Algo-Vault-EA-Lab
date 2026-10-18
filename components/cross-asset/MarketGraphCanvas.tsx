"use client";

/**
 * Interactive Market Relationship Graph (Phase 16 §21).
 *
 * Every visual edge maps 1:1 to a structured `MarketEdge` from the canonical
 * engine — nothing decorative, nothing invented:
 *   • correlation edges are coloured by sign and weighted by |ρ|;
 *   • user-declared links are dashed amber and always labelled USER_DEFINED;
 *   • metadata edges (asset class / currency) come from the instrument
 *     registry and are hidden by default to keep the graph readable;
 *   • hovering a node highlights its connections; clicking opens the
 *     relationship/evidence inspector.
 *
 * Layout is deterministic (columns by asset class) so the same snapshot always
 * draws the same picture.
 */

import { memo, useEffect, useMemo, useState } from "react";
import {
    Background,
    Controls,
    Handle,
    Position,
    ReactFlow,
    type Edge,
    type Node,
    type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import type { GraphEdge, GraphNode, GraphRelationshipRow } from "./useCrossAsset";

export type EdgeFilter = "measured" | "all" | "user" | "asset_class" | "currency" | "exposure";

interface MarketNodeData extends Record<string, unknown> {
    label: string;
    kind: string;
    assetClass?: string;
    active: boolean;
    dimmed: boolean;
    badge?: string;
}

type MarketFlowNode = Node<MarketNodeData, "market">;

/* Theme follows the app shell: `:root` is dark, `.light` opts into light.
 * ReactFlow draws its own canvas + controls, so we mirror that class here
 * instead of trusting `prefers-color-scheme` (which the shell ignores). */
function useIsLight(): boolean {
    const [isLight, setIsLight] = useState<boolean>(() =>
        typeof document !== "undefined" ? document.documentElement.classList.contains("light") : false
    );
    useEffect(() => {
        const el = document.documentElement;
        const sync = () => setIsLight(el.classList.contains("light"));
        sync();
        const obs = new MutationObserver(sync);
        obs.observe(el, { attributes: true, attributeFilter: ["class"] });
        return () => obs.disconnect();
    }, []);
    return isLight;
}

const COLUMN_ORDER = ["METALS", "FX", "INDICES", "CRYPTO", "EQUITIES", "COMMODITIES", "OTHER", "UNAVAILABLE"];

function columnOf(node: GraphNode): number {
    if (node.kind === "REGIME") return -2;
    if (node.kind === "FACTOR") return -1;
    if (node.kind === "ASSET_CLASS") return -3;
    if (node.kind === "CURRENCY") return -4;
    const cls = (node.assetClass ?? "OTHER").toUpperCase();
    const idx = COLUMN_ORDER.indexOf(cls);
    return idx === -1 ? COLUMN_ORDER.length - 1 : idx;
}

function MarketNodeCard({ data }: NodeProps<MarketFlowNode>) {
    return (
        <div
            className={cn(
                "min-w-[92px] rounded-md border px-2.5 py-1.5 text-micro font-medium shadow-sm transition",
                data.kind === "REGIME" && "border-warning/50 bg-warning/10 text-warning",
                data.kind === "FACTOR" && "border-chart-3/50 bg-chart-3/10 text-chart-3",
                data.kind === "CLUSTER" && "border-primary/40 bg-primary/10 text-primary",
                data.kind === "ASSET_CLASS" && "border-border bg-muted/40 text-muted-foreground",
                data.kind === "CURRENCY" && "border-info/40 bg-info/10 text-info",
                data.kind === "INSTRUMENT" && "border-border bg-card text-foreground",
                data.active && "border-primary ring-2 ring-primary/60",
                data.dimmed && "opacity-30 saturate-50"
            )}
            title={`${data.kind}${data.assetClass ? ` · ${data.assetClass}` : ""}`}
        >
            <span className="block max-w-[140px] truncate font-numeric">{data.label}</span>
            {data.badge ? <span className="block text-micro text-primary">{data.badge}</span> : null}
            <Handle type="target" position={Position.Left} className="!hidden" />
            <Handle type="source" position={Position.Right} className="!hidden" />
        </div>
    );
}

const nodeTypes = { market: MarketNodeCard };

function edgeColor(edge: GraphEdge): string {
    switch (edge.relationshipType) {
        case "CORRELATION":
            return "#34d399";
        case "INVERSE_CORRELATION":
            return "#fb7185";
        case "USER_DEFINED":
            return "#fbbf24";
        case "LEAD_LAG":
            return "#60a5fa";
        case "EXPOSURE":
            return "#a78bfa";
        case "CURRENCY":
            return "#38bdf8";
        default:
            return "#71717a";
    }
}

export interface MarketGraphCanvasProps {
    nodes: GraphNode[];
    edges: GraphEdge[];
    focusSymbol: string;
    filter: EdgeFilter;
    onSelectNode: (symbol: string | null) => void;
    onSelectEdge: (edge: GraphEdge | null) => void;
    selectedEdgeId?: string | null;
    emptyReason?: string;
}

export const MarketGraphCanvas = memo(function MarketGraphCanvas({
    nodes,
    edges,
    focusSymbol,
    filter,
    onSelectNode,
    onSelectEdge,
    selectedEdgeId,
    emptyReason,
}: MarketGraphCanvasProps) {
    const [hovered, setHovered] = useState<string | null>(null);
    const isLight = useIsLight();
    const dotColor = isLight ? "#e4e4e7" : "#27272a";
    const edgeLabelColor = isLight ? "#3f3f46" : "#e4e4e7";
    const edgeLabelBg = isLight ? "#fafafa" : "#18181b";

    const visibleEdges = useMemo(() => {
        return edges.filter((e) => {
            if (filter === "all") return true;
            if (filter === "measured")
                return e.relationshipType === "CORRELATION" || e.relationshipType === "INVERSE_CORRELATION" || e.relationshipType === "LEAD_LAG";
            if (filter === "user") return e.userDefined;
            if (filter === "asset_class") return e.relationshipType === "ASSET_CLASS";
            if (filter === "currency") return e.relationshipType === "CURRENCY";
            if (filter === "exposure") return e.relationshipType === "EXPOSURE";
            return true;
        });
    }, [edges, filter]);

    /* Only nodes touched by the visible edges stay on canvas — previously
     * every structural node rendered even when its edges were filtered out,
     * which read as "bogus" floating nodes. The focus node always stays. */
    const visibleNodeIds = useMemo(() => {
        const ids = new Set<string>();
        for (const e of visibleEdges) {
            ids.add(e.sourceNodeId);
            ids.add(e.targetNodeId);
        }
        const focusId = `instrument:${focusSymbol.toUpperCase()}`;
        const focusNode = nodes.find((n) => n.id === focusId);
        if (focusNode) ids.add(focusNode.id);
        // A structural filter with zero edges still shows its own lane.
        if (ids.size === 0) for (const n of nodes) ids.add(n.id);
        return ids;
    }, [visibleEdges, nodes, focusSymbol]);

    const neighborSet = useMemo(() => neighborIds(hovered, visibleEdges), [hovered, visibleEdges]);

    const flowNodes = useMemo<MarketFlowNode[]>(() => {
        const visible = nodes.filter((n) => visibleNodeIds.has(n.id));
        const byColumn = new Map<number, GraphNode[]>();
        for (const node of visible) {
            const col = columnOf(node);
            const bucket = byColumn.get(col) ?? [];
            bucket.push(node);
            byColumn.set(col, bucket);
        }
        // Structural lanes (negative columns) first, then asset-class columns.
        const columns = Array.from(byColumn.keys()).sort((a, b) => a - b);
        const out: MarketFlowNode[] = [];
        const COL_X = 250;
        const ROW_Y = 84;
        columns.forEach((col, colIndex) => {
            const bucket = (byColumn.get(col) ?? []).sort((a, b) => a.id.localeCompare(b.id));
            bucket.forEach((node, rowIndex) => {
                out.push({
                    id: node.id,
                    type: "market",
                    position: { x: 40 + colIndex * COL_X, y: 32 + rowIndex * ROW_Y },
                    data: {
                        label: node.label,
                        kind: node.kind,
                        assetClass: node.assetClass,
                        badge:
                            node.kind === "INSTRUMENT" && focusSymbol.toUpperCase() === node.symbol?.toUpperCase()
                                ? "focus"
                                : undefined,
                        active: focusSymbol.toUpperCase() === node.symbol?.toUpperCase(),
                        dimmed:
                            Boolean(hovered) && hovered !== node.id && !neighborSet.has(node.id),
                    },
                });
            });
        });
        return out;
    }, [nodes, visibleNodeIds, hovered, focusSymbol, neighborSet]);

    const symbolByNodeId = useMemo(() => {
        const map = new Map<string, string>();
        for (const n of nodes) if (n.symbol) map.set(n.id, n.symbol.toUpperCase());
        return map;
    }, [nodes]);

    const flowEdges = useMemo<Edge[]>(
        () =>
            visibleEdges
                .filter((e) => visibleNodeIds.has(e.sourceNodeId) && visibleNodeIds.has(e.targetNodeId))
                .map((e) => {
                    const touched = hovered ? e.sourceNodeId === hovered || e.targetNodeId === hovered : true;
                    const selected = selectedEdgeId === e.id;
                    const width = e.coefficient !== null ? 1 + Math.abs(e.coefficient) * 4 : 1.2;
                    return {
                        id: e.id,
                        source: e.sourceNodeId,
                        target: e.targetNodeId,
                        animated: selected || e.stability === "BREAKING" || e.stability === "FLIPPING",
                        style: {
                            stroke: edgeColor(e),
                            strokeWidth: selected ? width + 2 : width,
                            opacity: hovered && !touched ? 0.12 : e.userDefined ? 0.9 : 0.75,
                            strokeDasharray:
                                e.userDefined ||
                                e.relationshipType === "CURRENCY" ||
                                e.relationshipType === "ASSET_CLASS"
                                    ? "6 4"
                                    : undefined,
                        },
                        label:
                            e.coefficient !== null && (filter === "measured" || filter === "all")
                                ? `${e.coefficient >= 0 ? "+" : ""}${e.coefficient.toFixed(2)}`
                                : undefined,
                        labelStyle: { fill: edgeLabelColor, fontSize: 10, fontWeight: 600 },
                        labelBgStyle: { fill: edgeLabelBg, fillOpacity: 0.92 },
                        labelBgPadding: [3, 2] as [number, number],
                    };
                }),
        [visibleEdges, visibleNodeIds, hovered, selectedEdgeId, filter, edgeLabelColor, edgeLabelBg]
    );

    if (nodes.length === 0) {
        return (
            <div className="flex h-[420px] items-center justify-center rounded-lg border border-border bg-card p-6 text-center text-xs text-muted-foreground">
                {emptyReason ?? "No graph data yet — run an analysis to build the market graph."}
            </div>
        );
    }

    return (
        <div className="h-[420px] overflow-hidden rounded-lg border border-border bg-card">
            <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.22, maxZoom: 1.1 }}
                minZoom={0.25}
                maxZoom={1.6}
                nodesConnectable={false}
                nodesDraggable
                elementsSelectable
                colorMode={isLight ? "light" : "dark"}
                onNodeClick={(_, node) => {
                    const data = node.data as MarketNodeData;
                    if (data.kind !== "INSTRUMENT") {
                        onSelectNode(null);
                        return;
                    }
                    onSelectNode(symbolByNodeId.get(node.id) ?? String(data.label).toUpperCase());
                }}
                onNodeMouseEnter={(_, node) => setHovered(node.id)}
                onNodeMouseLeave={() => setHovered(null)}
                onEdgeClick={(_, edge) => {
                    const match = edges.find((e) => e.id === edge.id) ?? null;
                    onSelectEdge(match);
                }}
                onPaneClick={() => onSelectEdge(null)}
                proOptions={{ hideAttribution: true }}
            >
                <Background gap={22} size={1.2} color={dotColor} bgColor="transparent" />
                <Controls
                    showInteractive={false}
                    className="[&_.react-flow__controls-button]:border-border [&_.react-flow__controls-button]:bg-card [&_.react-flow__controls-button]:text-muted-foreground [&_.react-flow__controls-button:hover]:bg-muted [&_.react-flow__controls-button]:shadow-sm"
                />
            </ReactFlow>
        </div>
    );
});

function neighborIds(nodeId: string | null, edges: GraphEdge[]): Set<string> {
    const out = new Set<string>();
    if (!nodeId) return out;
    for (const e of edges) {
        if (e.sourceNodeId === nodeId) out.add(e.targetNodeId);
        if (e.targetNodeId === nodeId) out.add(e.sourceNodeId);
    }
    return out;
}

/* ── evidence inspector (§21 "inspect relationship") ──────────────────────── */

export function EdgeInspector({
    edge,
    relationship,
    onClose,
}: {
    edge: GraphEdge;
    relationship?: GraphRelationshipRow;
    onClose: () => void;
}) {
    const observations = relationship?.observations ?? edge.evidence;
    return (
        <div className="rounded-lg border border-border bg-card p-3 text-xs">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <p className="font-numeric text-sm font-semibold text-foreground">
                        {edge.sourceNodeId.replace("instrument:", "")} ↔ {edge.targetNodeId.replace(/^instrument:|^assetclass:|^currency:|^factor:/, "")}
                    </p>
                    <p className="text-micro uppercase tracking-wide text-muted-foreground">
                        {edge.relationshipType.replace(/_/g, " ")} · {edge.window.bars} {edge.window.timeframe} · {edge.term.toLowerCase()} term · stability {edge.stability}
                        {edge.userDefined ? " · USER_DEFINED" : ""}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded border border-border px-1.5 py-0.5 text-micro text-muted-foreground hover:bg-muted"
                >
                    Close
                </button>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2 font-numeric text-micro">
                <div>
                    <span className="text-muted-foreground">ρ</span>{" "}
                    <span className="text-foreground">{edge.coefficient === null ? "n/a" : edge.coefficient.toFixed(2)}</span>
                </div>
                <div>
                    <span className="text-muted-foreground">strength</span> <span className="text-foreground">{edge.strength.toFixed(2)}</span>
                </div>
                <div>
                    <span className="text-muted-foreground">confidence</span> <span className="text-foreground">{edge.confidence.toFixed(2)}</span>
                </div>
                <div>
                    <span className="text-muted-foreground">quality</span> <span className="text-foreground">{edge.dataQuality.status}</span>
                </div>
                <div>
                    <span className="text-muted-foreground">data ts</span>{" "}
                    <span className="text-foreground">{edge.dataTimestamp ? new Date(edge.dataTimestamp).toISOString().slice(0, 16).replace("T", " ") : "—"}</span>
                </div>
                <div>
                    <span className="text-muted-foreground">obs</span> <span className="text-foreground">{observations.length}</span>
                </div>
            </div>

            <p className="mt-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Evidence</p>
            <ul className="mt-1 space-y-1">
                {edge.claims.map((claim) => (
                    <li key={claim.id} className="text-micro leading-4 text-muted-foreground">
                        <span
                            className={cn(
                                "mr-1 rounded px-1 py-0.5 font-numeric text-micro",
                                claim.kind === "OBSERVED" && "bg-positive/15 text-positive",
                                claim.kind === "CALCULATED" && "bg-info/15 text-info",
                                claim.kind === "CONFIGURED" && "bg-muted/20 text-muted-foreground",
                                claim.kind === "USER_DEFINED" && "bg-warning/15 text-warning",
                                claim.kind === "INFERENCE" && "bg-chart-3/15 text-chart-3",
                                claim.kind === "RECOMMENDATION" && "bg-negative/15 text-negative"
                            )}
                        >
                            {claim.kind}
                        </span>
                        {claim.text}
                    </li>
                ))}
            </ul>

            {observations.length > 0 ? (
                <>
                    <p className="mt-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Rolling observations</p>
                    <div className="mt-1 max-h-28 overflow-y-auto">
                        <table className="w-full font-numeric text-micro">
                            <thead>
                                <tr className="text-left text-muted-foreground">
                                    <th className="py-0.5">window end</th>
                                    <th>ρ</th>
                                    <th>n</th>
                                    <th>quality</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...observations].reverse().map((o) => (
                                    <tr key={o.id} className="border-t border-border/50">
                                        <td className="py-0.5 text-foreground">{new Date(o.observedAt).toISOString().slice(5, 16).replace("T", " ")}</td>
                                        <td className="text-foreground">{o.coefficient === null ? "n/a" : o.coefficient.toFixed(2)}</td>
                                        <td className="text-muted-foreground">{o.sampleSize}</td>
                                        <td className="text-muted-foreground">{o.dataQuality.status}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            ) : null}
        </div>
    );
}
