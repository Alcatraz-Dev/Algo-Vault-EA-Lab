"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    addEdge,
    Handle,
    Position,
    type Connection,
    type Edge,
    type Node,
    type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
    Layers,
    Save,
    Play,
    ArrowLeft,
    Plus,
    RefreshCw,
    AlertCircle,
    CheckCircle2,
    Sliders,
    TrendingUp,
    TrendingDown,
    Shield,
    Zap,
    Trash2,
    BarChart3,
    X,
} from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { auth } from "@/lib/firebase";
import type { NodeGraph, VisualNode, VisualEdge, CompilerDiagnostic } from "@/lib/bot-studio/compiler/types";
import type { Strategy } from "@/lib/strategy-lab/types";

// ─────────────────────────────────────────────────────────────────────────────
// Custom Node Components
// ─────────────────────────────────────────────────────────────────────────────

function MarketDataNodeComponent({ id, data }: NodeProps) {
    const d = (data || {}) as { symbol?: string; timeframe?: string; priceField?: string };
    return (
        <div className="p-3 rounded-xl border border-sky-500/30 bg-card/95 shadow-[0_1px_2px_rgb(0_0_0/0.05)] min-w-[180px] text-xs">
            <div className="flex items-center gap-1.5 font-bold text-sky-400 mb-2">
                <TrendingUp className="h-4 w-4" />
                <span>Market Data Feed</span>
            </div>
            <div className="space-y-1 text-muted-foreground">
                <div>Symbol: <strong className="text-foreground">{d.symbol || "EURUSD"}</strong></div>
                <div>Timeframe: <strong className="text-foreground">{d.timeframe || "H1"}</strong></div>
                <div>Source: <span className="font-mono">{d.priceField || "close"}</span></div>
            </div>
            <Handle type="source" position={Position.Right} className="!bg-sky-500 !w-3 !h-3" />
        </div>
    );
}

function IndicatorNodeComponent({ id, data }: NodeProps) {
    const d = (data || {}) as { kind?: string; period?: number; timeframe?: string };
    const kind = d.kind || "ema";
    return (
        <div className="p-3 rounded-xl border border-amber-500/30 bg-card/95 shadow-[0_1px_2px_rgb(0_0_0/0.05)] min-w-[180px] text-xs">
            <Handle type="target" position={Position.Left} className="!bg-amber-500 !w-3 !h-3" />
            <div className="flex items-center gap-1.5 font-bold text-amber-400 mb-2">
                <Sliders className="h-4 w-4" />
                <span className="uppercase">{kind} Indicator</span>
            </div>
            <div className="space-y-1 text-muted-foreground">
                <div>Period: <strong className="text-foreground">{d.period || 14}</strong></div>
                {d.timeframe && <div>TF: <span className="font-mono">{d.timeframe}</span></div>}
            </div>
            <Handle type="source" position={Position.Right} className="!bg-amber-500 !w-3 !h-3" />
        </div>
    );
}

function ConditionNodeComponent({ id, data }: NodeProps) {
    const d = (data || {}) as { kind?: string; label?: string; threshold?: number };
    return (
        <div className="p-3 rounded-xl border border-indigo-500/30 bg-card/95 shadow-[0_1px_2px_rgb(0_0_0/0.05)] min-w-[190px] text-xs">
            <Handle type="target" position={Position.Left} className="!bg-indigo-500 !w-3 !h-3" />
            <div className="flex items-center gap-1.5 font-bold text-indigo-400 mb-2">
                <Zap className="h-4 w-4" />
                <span>{d.label || "Condition Logic"}</span>
            </div>
            <div className="space-y-1 text-muted-foreground">
                <div>Condition: <strong className="text-foreground">{d.kind}</strong></div>
                {d.threshold !== undefined && <div>Threshold: <strong>{d.threshold}</strong></div>}
            </div>
            <Handle type="source" position={Position.Right} className="!bg-indigo-500 !w-3 !h-3" />
        </div>
    );
}

function ActionNodeComponent({ id, data }: NodeProps) {
    const d = (data || {}) as { kind?: string; riskPercent?: number; slMultiplier?: number; tpRatio?: number };
    const isLong = d.kind === "action_enter_long";
    return (
        <div className={`p-3 rounded-xl border bg-card/95 shadow-[0_1px_2px_rgb(0_0_0/0.05)] min-w-[210px] text-xs ${
            isLong ? "border-emerald-500/40" : "border-rose-500/40"
        }`}>
            <Handle type="target" position={Position.Left} className={isLong ? "!bg-emerald-500 !w-3 !h-3" : "!bg-rose-500 !w-3 !h-3"} />
            <div className={`flex items-center gap-1.5 font-bold mb-2 ${isLong ? "text-emerald-400" : "text-rose-400"}`}>
                <Play className="h-4 w-4" />
                <span>{isLong ? "Enter LONG Position" : "Enter SHORT Position"}</span>
            </div>
            <div className="space-y-1 text-muted-foreground">
                <div>Risk: <strong className="text-foreground">{d.riskPercent || 1.0}%</strong></div>
                <div>SL: <span>ATR x{d.slMultiplier || 2.0}</span></div>
                <div>TP: <span>{d.tpRatio ? `1:${d.tpRatio} R:R` : "Fixed"}</span></div>
            </div>
        </div>
    );
}

const nodeTypes = {
    market_data: MarketDataNodeComponent,
    indicator_ema: IndicatorNodeComponent,
    indicator_sma: IndicatorNodeComponent,
    indicator_rsi: IndicatorNodeComponent,
    condition_cross_above: ConditionNodeComponent,
    condition_cross_below: ConditionNodeComponent,
    condition_gt: ConditionNodeComponent,
    condition_lt: ConditionNodeComponent,
    action_enter_long: ActionNodeComponent,
    action_enter_short: ActionNodeComponent,
};

// ─────────────────────────────────────────────────────────────────────────────
// Initial Strategy Template Graph
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_NODES: Node[] = [
    {
        id: "feed_1",
        type: "market_data",
        position: { x: 50, y: 150 },
        data: { kind: "market_data", symbol: "EURUSD", timeframe: "H1", priceField: "close" },
    },
    {
        id: "ema_fast",
        type: "indicator_ema",
        position: { x: 280, y: 80 },
        data: { kind: "indicator_ema", period: 20 },
    },
    {
        id: "ema_slow",
        type: "indicator_ema",
        position: { x: 280, y: 220 },
        data: { kind: "indicator_ema", period: 50 },
    },
    {
        id: "cond_cross",
        type: "condition_cross_above",
        position: { x: 520, y: 140 },
        data: { kind: "condition_cross_above", label: "EMA20 crosses above EMA50" },
    },
    {
        id: "action_entry",
        type: "action_enter_long",
        position: { x: 780, y: 140 },
        data: {
            kind: "action_enter_long",
            riskPercent: 1.0,
            slType: "atr",
            slMultiplier: 2.0,
            tpType: "risk_reward",
            tpRatio: 2.0,
        },
    },
];

const INITIAL_EDGES: Edge[] = [
    { id: "e1", source: "feed_1", target: "ema_fast" },
    { id: "e2", source: "feed_1", target: "ema_slow" },
    { id: "e3", source: "ema_fast", target: "cond_cross" },
    { id: "e4", source: "ema_slow", target: "cond_cross" },
    { id: "e5", source: "cond_cross", target: "action_entry" },
];

export default function VisualBuilderPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const strategyId = searchParams.get("id");

    const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
    const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);

    const [strategyName, setStrategyName] = useState("Visual Trend Strategy");
    const [symbol, setSymbol] = useState("EURUSD");
    const [timeframe, setTimeframe] = useState("H1");
    const [direction, setDirection] = useState<"long" | "short" | "both">("long");

    const [compiling, setCompiling] = useState(false);
    const [saving, setSaving] = useState(false);
    const [backtesting, setBacktesting] = useState(false);
    const [backtestResult, setBacktestResult] = useState<any>(null);
    const [backtestModalOpen, setBacktestModalOpen] = useState(false);
    const [compiledStrategy, setCompiledStrategy] = useState<Strategy | null>(null);
    const [diagnostics, setDiagnostics] = useState<CompilerDiagnostic[]>([]);
    const [compileError, setCompileError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    const onConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
        [setEdges]
    );

    const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
        const user = auth.currentUser;
        if (!user) return {};
        const token = await user.getIdToken();
        return {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        };
    }, []);

    // Load existing strategy if strategyId provided
    useEffect(() => {
        if (!strategyId) return;
        (async () => {
            try {
                const headers = await getAuthHeaders();
                const res = await fetch(`/api/bot-studio/strategies/${strategyId}`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (data.ok && data.strategy) {
                        setStrategyName(data.strategy.name);
                        if (data.strategy.source?.kind === "visual_builder") {
                            try {
                                const parsed = JSON.parse(data.strategy.source.nodeGraph);
                                if (parsed.nodes) setNodes(parsed.nodes);
                                if (parsed.edges) setEdges(parsed.edges);
                                if (parsed.meta) {
                                    setSymbol(parsed.meta.symbol || "EURUSD");
                                    setTimeframe(parsed.meta.timeframe || "H1");
                                    setDirection(parsed.meta.direction || "long");
                                }
                            } catch {
                                // fallback
                            }
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to load strategy graph:", e);
            }
        })();
    }, [strategyId, getAuthHeaders, setNodes, setEdges]);

    const serializeGraph = useCallback((): NodeGraph => {
        const visualNodes: VisualNode[] = nodes.map((n) => ({
            id: n.id,
            kind: (n.data?.kind as any) || (n.type as any) || "indicator_ema",
            data: n.data as any,
            position: n.position,
        }));
        const visualEdges: VisualEdge[] = edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
        }));
        return {
            nodes: visualNodes,
            edges: visualEdges,
            meta: {
                name: strategyName,
                symbol,
                timeframe,
                direction,
            },
        };
    }, [nodes, edges, strategyName, symbol, timeframe, direction]);

    const handleCompile = useCallback(async () => {
        setCompiling(true);
        setCompileError(null);
        try {
            const graph = serializeGraph();
            const headers = await getAuthHeaders();
            const res = await fetch("/api/bot-studio/compile/visual", {
                method: "POST",
                headers,
                body: JSON.stringify({ graph }),
            });
            const data = await res.json();
            if (data.ok) {
                setCompiledStrategy(data.value);
                setDiagnostics(data.diagnostics || []);
            } else {
                setCompiledStrategy(null);
                setDiagnostics(data.diagnostics || []);
                setCompileError(data.error || "Compilation returned errors.");
            }
        } catch (e) {
            setCompileError(e instanceof Error ? e.message : "Compilation failed");
        } finally {
            setCompiling(false);
        }
    }, [serializeGraph, getAuthHeaders]);

    // Auto compile when loaded
    useEffect(() => {
        handleCompile();
    }, [handleCompile]);

    const handleSave = async (): Promise<string | null> => {
        const graph = serializeGraph();
        setSaving(true);
        setSaveSuccess(false);
        try {
            const headers = await getAuthHeaders();
            const compRes = await fetch("/api/bot-studio/compile/visual", {
                method: "POST",
                headers,
                body: JSON.stringify({ graph }),
            });
            const compData = await compRes.json();
            if (!compData.ok || !compData.value) {
                alert(`Cannot save: compiler errors exist.\n${compData.diagnostics?.map((d: any) => d.message).join("\n")}`);
                return null;
            }

            const res = await fetch("/api/bot-studio/strategies", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    id: strategyId || undefined,
                    name: strategyName,
                    sourceType: "visual",
                    visualGraph: graph,
                    canonicalStrategy: compData.value,
                }),
            });
            const data = await res.json();
            if (data.ok) {
                setSaveSuccess(true);
                setTimeout(() => setSaveSuccess(false), 3000);
                if (!strategyId) {
                    router.push(`/admin/bot-studio/builder?id=${data.strategy.id}`);
                }
                return data.strategy.id;
            } else {
                alert(`Failed to save strategy: ${data.error}`);
                return null;
            }
        } catch (e) {
            alert(`Error saving strategy: ${e instanceof Error ? e.message : String(e)}`);
            return null;
        } finally {
            setSaving(false);
        }
    };

    const handleBacktest = async () => {
        let targetId = strategyId;
        if (!targetId) {
            targetId = await handleSave();
            if (!targetId) return;
        }
        setBacktesting(true);
        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`/api/bot-studio/strategies/${targetId}/backtest`, {
                method: "POST",
                headers,
                body: JSON.stringify({ period: "1Y" }),
            });
            const data = await res.json();
            if (data.ok) {
                setBacktestResult(data.backtest);
                setBacktestModalOpen(true);
            } else {
                alert(`Backtest failed: ${data.error}`);
            }
        } catch (e) {
            alert(`Backtest error: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setBacktesting(false);
        }
    };

    // Quick node adders
    const addNode = (type: string, kind: string, defaultData: Record<string, unknown>) => {
        const id = `node_${Date.now()}`;
        const newNode: Node = {
            id,
            type,
            position: { x: 300 + Math.random() * 100, y: 150 + Math.random() * 100 },
            data: { kind, ...defaultData },
        };
        setNodes((nds) => [...nds, newNode]);
    };

    return (
        <AdminShell title="Visual Strategy Builder">
            <div className="p-6 max-w-7xl mx-auto space-y-4">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/admin/bot-studio"
                            className="p-2 rounded-lg border border-border hover:bg-muted text-muted-foreground transition"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                        <div>
                            <div className="flex items-center gap-2">
                                <Layers className="h-5 w-5 text-sky-400" />
                                <input
                                    type="text"
                                    value={strategyName}
                                    onChange={(e) => setStrategyName(e.target.value)}
                                    placeholder="Strategy Name"
                                    className="text-xl font-bold bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-1"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Visual No-Code Strategy Graph Builder (ReactFlow to Strategy Engine)
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCompile}
                            disabled={compiling}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted text-sm font-medium transition"
                        >
                            <RefreshCw className={`h-4 w-4 ${compiling ? "animate-spin" : ""}`} />
                            Compile Graph
                        </button>
                        <button
                            onClick={handleBacktest}
                            disabled={backtesting || compiling}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-sm transition"
                        >
                            <BarChart3 className={`h-4 w-4 ${backtesting ? "animate-spin" : ""}`} />
                            {backtesting ? "Backtesting..." : "Run Backtest"}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition ${
                                saveSuccess
                                    ? "bg-emerald-600 text-white"
                                    : "bg-primary text-white hover:bg-primary/90"
                            }`}
                        >
                            {saveSuccess ? (
                                <>
                                    <CheckCircle2 className="h-4 w-4" />
                                    Saved!
                                </>
                            ) : (
                                <>
                                    <Save className="h-4 w-4" />
                                    {saving ? "Saving..." : "Save Strategy"}
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Node Palette Bar */}
                <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)] text-xs">
                    <span className="font-semibold text-muted-foreground mr-1">Add Nodes:</span>
                    <button
                        onClick={() => addNode("indicator_ema", "indicator_ema", { period: 20 })}
                        className="px-2.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 font-medium"
                    >
                        + EMA Indicator
                    </button>
                    <button
                        onClick={() => addNode("indicator_rsi", "indicator_rsi", { period: 14 })}
                        className="px-2.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 font-medium"
                    >
                        + RSI Indicator
                    </button>
                    <button
                        onClick={() =>
                            addNode("condition_cross_above", "condition_cross_above", {
                                label: "Cross Above",
                            })
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 font-medium"
                    >
                        + Cross Above
                    </button>
                    <button
                        onClick={() =>
                            addNode("condition_lt", "condition_lt", {
                                label: "Less Than",
                                threshold: 70,
                            })
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 font-medium"
                    >
                        + Less Than
                    </button>
                    <button
                        onClick={() =>
                            addNode("action_enter_long", "action_enter_long", {
                                riskPercent: 1.0,
                                slType: "atr",
                                slMultiplier: 2.0,
                                tpType: "risk_reward",
                                tpRatio: 2.0,
                            })
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 font-medium"
                    >
                        + Enter Long
                    </button>
                </div>

                {/* Main Canvas & Inspector Split */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-[620px]">
                    {/* ReactFlow Canvas */}
                    <div className="lg:col-span-8 rounded-xl border border-border bg-card overflow-hidden relative shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            onConnect={onConnect}
                            nodeTypes={nodeTypes}
                            fitView
                        >
                            <Background gap={16} size={1} color="#333" />
                            <Controls />
                            <MiniMap nodeStrokeWidth={3} className="!bg-card !border !border-border" />
                        </ReactFlow>
                    </div>

                    {/* Diagnostics & Compiled Output */}
                    <div className="lg:col-span-4 flex flex-col space-y-4 overflow-y-auto">
                        <div className="p-4 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)] space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Graph Compiler
                                </span>
                                <span
                                    className={`text-xs px-2 py-0.5 rounded font-semibold ${
                                        compiledStrategy
                                            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                            : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                                    }`}
                                >
                                    {compiledStrategy ? "Valid Strategy" : "Compilation Error"}
                                </span>
                            </div>

                            {compileError && (
                                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
                                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                    <div>{compileError}</div>
                                </div>
                            )}

                            {diagnostics.length > 0 && (
                                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                    {diagnostics.map((d, i) => (
                                        <div
                                            key={i}
                                            className={`p-2 rounded text-xs flex items-start gap-2 ${
                                                d.severity === "error"
                                                    ? "bg-destructive/10 text-destructive"
                                                    : "bg-amber-500/10 text-amber-500"
                                            }`}
                                        >
                                            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                            <span>{d.message}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {compiledStrategy && (
                            <div className="p-4 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)] space-y-3 flex-1 text-xs">
                                <div className="flex items-center justify-between border-b border-border pb-2">
                                    <span className="font-semibold text-muted-foreground uppercase text-[11px]">
                                        Compiled Strategy
                                    </span>
                                    <span className="font-mono text-emerald-400">
                                        {compiledStrategy.asset} {compiledStrategy.timeframes.entry}
                                    </span>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between py-1 border-b border-border/40">
                                        <span className="text-muted-foreground">Model</span>
                                        <span className="font-semibold">{compiledStrategy.executionModel}</span>
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-border/40">
                                        <span className="text-muted-foreground">Risk</span>
                                        <span className="font-semibold">{compiledStrategy.risk.riskPercent}%</span>
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-border/40">
                                        <span className="text-muted-foreground">Stop Loss</span>
                                        <span className="font-semibold">{compiledStrategy.stopLoss.mode} (x{compiledStrategy.stopLoss.atrMultiple})</span>
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-border/40">
                                        <span className="text-muted-foreground">Take Profit</span>
                                        <span className="font-semibold">R:R 1:{compiledStrategy.takeProfit.r1}</span>
                                    </div>
                                </div>

                                <div>
                                    <span className="text-muted-foreground font-semibold block mb-1">
                                        Entry Rules ({compiledStrategy.entryRules.length})
                                    </span>
                                    <div className="space-y-1">
                                        {compiledStrategy.entryRules.map((r, i) => (
                                            <div key={i} className="p-1.5 rounded bg-muted/60 font-mono text-[11px]">
                                                {r.label}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Backtest Results Modal */}
                {backtestModalOpen && backtestResult && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
                        <div className="bg-card border border-border rounded-xl w-full max-w-3xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200 my-8 max-h-[90vh] flex flex-col">
                            <div className="flex items-center justify-between pb-3 border-b border-border">
                                <div className="flex items-center gap-2">
                                    <BarChart3 className="h-5 w-5 text-emerald-400" />
                                    <div>
                                        <h3 className="text-lg font-bold">Backtest Simulation Report</h3>
                                        <p className="text-xs text-muted-foreground">
                                            {backtestResult.symbol} · {backtestResult.timeframe} · {backtestResult.strategyName || strategyName}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setBacktestModalOpen(false)}
                                    className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="overflow-y-auto space-y-5 flex-1 pr-1">
                                {/* Key Metrics Cards */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                                        <span className="text-[11px] font-medium text-muted-foreground">Net PnL</span>
                                        <div className={`text-xl font-bold mt-1 ${
                                            backtestResult.metrics.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"
                                        }`}>
                                            ${backtestResult.metrics.netProfit.toFixed(2)}
                                        </div>
                                        <span className="text-[8px] text-muted-foreground">
                                            Return: {backtestResult.metrics.returnPct?.toFixed(2)}%
                                        </span>
                                    </div>

                                    <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                                        <span className="text-[11px] font-medium text-muted-foreground">Win Rate</span>
                                        <div className="text-xl font-bold mt-1 text-foreground">
                                            {backtestResult.metrics.winRate?.toFixed(1)}%
                                        </div>
                                        <span className="text-[8px] text-muted-foreground">
                                            {backtestResult.metrics.longTrades + backtestResult.metrics.shortTrades} total trades
                                        </span>
                                    </div>

                                    <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                                        <span className="text-[11px] font-medium text-muted-foreground">Profit Factor</span>
                                        <div className="text-xl font-bold mt-1 text-foreground">
                                            {backtestResult.metrics.profitFactor?.toFixed(2)}
                                        </div>
                                        <span className="text-[8px] text-muted-foreground">
                                            Exp: {backtestResult.metrics.expectancy?.toFixed(2)}
                                        </span>
                                    </div>

                                    <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                                        <span className="text-[11px] font-medium text-muted-foreground">Max Drawdown</span>
                                        <div className="text-xl font-bold mt-1 text-rose-400">
                                            {backtestResult.metrics.maxDrawdownPct?.toFixed(2)}%
                                        </div>
                                        <span className="text-[8px] text-muted-foreground">
                                            ${backtestResult.metrics.maxDrawdownAbs?.toFixed(2)}
                                        </span>
                                    </div>
                                </div>

                                {/* Rule Diagnostics */}
                                {backtestResult.diagnostics && (
                                    <div className="p-4 rounded-xl border border-border bg-muted/10 space-y-2">
                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                            Bar Diagnostics & Rule Evaluator
                                        </span>
                                        <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div className="p-2 rounded bg-card border border-border/40">
                                                <span className="text-muted-foreground">Scanned Bars:</span>
                                                <div className="font-bold">{backtestResult.diagnostics.loopBars}</div>
                                            </div>
                                            <div className="p-2 rounded bg-card border border-border/40">
                                                <span className="text-muted-foreground">Session Bars:</span>
                                                <div className="font-bold">{backtestResult.diagnostics.sessionBars}</div>
                                            </div>
                                            <div className="p-2 rounded bg-card border border-border/40">
                                                <span className="text-muted-foreground">Regime Bars:</span>
                                                <div className="font-bold">{backtestResult.diagnostics.regimeBars}</div>
                                            </div>
                                        </div>
                                        {backtestResult.diagnostics.blockingRuleIds?.length > 0 && (
                                            <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                                                <strong>Blocking Rules Detected:</strong> {backtestResult.diagnostics.blockingRuleIds.join(", ")}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Recent Trades Snippet */}
                                <div className="space-y-2">
                                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Executed Trades ({backtestResult.trades?.length || 0})
                                    </span>
                                    {(!backtestResult.trades || backtestResult.trades.length === 0) ? (
                                        <div className="p-4 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl">
                                            Zero trades triggered in the tested historical window. Check indicators and threshold conditions.
                                        </div>
                                    ) : (
                                        <div className="border border-border rounded-xl overflow-hidden text-xs">
                                            <table className="w-full text-left">
                                                <thead className="bg-muted/40 border-b border-border text-[11px] font-semibold text-muted-foreground">
                                                    <tr>
                                                        <th className="p-2.5">Side</th>
                                                        <th className="p-2.5">Entry Price</th>
                                                        <th className="p-2.5">Exit Price</th>
                                                        <th className="p-2.5">Profit</th>
                                                        <th className="p-2.5">R Return</th>
                                                        <th className="p-2.5">Exit Reason</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-border/40 font-mono text-[11px]">
                                                    {backtestResult.trades.slice(0, 8).map((t: any, idx: number) => (
                                                        <tr key={idx} className="hover:bg-muted/20">
                                                            <td className="p-2.5">
                                                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-semibold ${
                                                                    t.direction === "long" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                                                                }`}>
                                                                    {t.direction.toUpperCase()}
                                                                </span>
                                                            </td>
                                                            <td className="p-2.5">{t.entryPrice?.toFixed(2)}</td>
                                                            <td className="p-2.5">{t.exitPrice?.toFixed(2)}</td>
                                                            <td className={`p-2.5 font-bold ${t.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                                                ${t.pnl?.toFixed(2)}
                                                            </td>
                                                            <td className="p-2.5">{t.rMultiple ? `${t.rMultiple.toFixed(2)}R` : "-"}</td>
                                                            <td className="p-2.5 text-muted-foreground font-sans text-[8px]">{t.exitReason || "manual"}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="pt-3 border-t border-border flex items-center justify-end">
                                <button
                                    onClick={() => setBacktestModalOpen(false)}
                                    className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold transition-colors hover:bg-primary/90"
                                >
                                    Close Report
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </AdminShell>
    );
}
