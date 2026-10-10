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

import { memo, useMemo, useState } from "react";
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
                "rounded-md border px-2.5 py-1.5 text-micro font-medium shadow-sm transition",
                data.kind === "REGIME" && "border-warning/50 bg-warning/10 text-warning",
                data.kind === "FACTOR" && "border-chart-3/50 bg-chart-3/10 text-chart-3",
                data.kind === "ASSET_CLASS" && "border-border bg-card text-muted-foreground",
                data.kind === "CURRENCY" && "border-info/40 bg-info/10 text-info",
                data.kind === "INSTRUMENT" && "border-positive/40 bg-card text-foreground",
                data.active && "ring-2 ring-primary",
                data.dimmed && "opacity-35"
            )}
            title={`${data.kind}${data.assetClass ? ` · ${data.assetClass}` : ""}`}
        >
            <span className="block truncate font-mono">{data.label}</span>
            {data.badge ? <span className="block text-micro text-muted-foreground">{data.badge}</span> : null}
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

    const flowNodes = useMemo<MarketFlowNode[]>(() => {
        const byColumn = new Map<number, GraphNode[]>();
        for (const node of nodes) {
            const col = columnOf(node);
            const bucket = byColumn.get(col) ?? [];
            bucket.push(node);
            byColumn.set(col, bucket);
        }
        const columns = Array.from(byColumn.keys()).sort((a, b) => a - b);
        const out: MarketFlowNode[] = [];
        columns.forEach((col, colIndex) => {
            const bucket = (byColumn.get(col) ?? []).sort((a, b) => a.id.localeCompare(b.id));
            bucket.forEach((node, i) => {
                const row = col === -2 ? 0 : col === -3 ? 1 : col === -1 ? 6 : col === -4 ? 7 : 3 + (i % 3);
                const y = row * 90 + (col === -1 || col === -4 ? Math.floor(i / 4) * 70 : Math.floor(i / 3) * 8);
                out.push({
                    id: node.id,
                    type: "market",
                    position: { x: 60 + colIndex * 230, y: col >= 0 && i >= 3 ? y + Math.floor(i / 3) * 46 : y },
                    data: {
                        label: node.label,
                        kind: node.kind,
                        assetClass: node.assetClass,
                        badge:
                            node.kind === "INSTRUMENT" && focusSymbol === node.symbol
                                ? "focus"
                                : undefined,
                        active: focusSymbol === node.symbol,
                        dimmed: Boolean(hovered) && hovered !== node.id && !neighborIds(hovered, visibleEdges).has(node.id),
                    },
                });
            });
        });
        return out;
    }, [nodes, hovered, focusSymbol, visibleEdges]);

    const flowEdges = useMemo<Edge[]>(
        () =>
            visibleEdges.map((e) => {
                const touched = hovered ? e.sourceNodeId === hovered || e.targetNodeId === hovered : true;
                const selected = selectedEdgeId === e.id;
                const width = e.coefficient !== null ? 1 + Math.abs(e.coefficient) * 4 : 1.2;
                return {
                    id: e.id,
                    source: e.sourceNodeId,
                    target: e.targetNodeId,
                    animated: selected || (e.stability === "BREAKING" || e.stability === "FLIPPING"),
                    style: {
                        stroke: edgeColor(e),
                        strokeWidth: selected ? width + 2 : width,
                        opacity: hovered && !touched ? 0.12 : e.userDefined ? 0.9 : 0.75,
                        strokeDasharray: e.userDefined || e.relationshipType === "CURRENCY" || e.relationshipType === "ASSET_CLASS" ? "6 4" : undefined,
                    },
                    label: e.coefficient !== null && (filter === "measured" || filter === "all") ? e.coefficient.toFixed(2) : undefined,
                    labelStyle: { fill: "#e4e4e7", fontSize: 9 },
                };
            }),
        [visibleEdges, hovered, selectedEdgeId, filter]
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
                minZoom={0.3}
                maxZoom={1.6}
                onNodeClick={(_, node) => onSelectNode(node.data.kind === "INSTRUMENT" ? String((node.data as MarketNodeData).label) : null)}
                onNodeMouseEnter={(_, node) => setHovered(node.id)}
                onNodeMouseLeave={() => setHovered(null)}
                onEdgeClick={(_, edge) => {
                    const match = edges.find((e) => e.id === edge.id) ?? null;
                    onSelectEdge(match);
                }}
                onPaneClick={() => onSelectEdge(null)}
                proOptions={{ hideAttribution: true }}
            >
                <Background gap={18} color="#27272a" />
                <Controls showInteractive={false} />
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
                    <p className="font-mono text-sm font-semibold text-foreground">
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

            <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-micro">
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
                                "mr-1 rounded px-1 py-0.5 font-mono text-micro",
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
                        <table className="w-full font-mono text-micro">
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
