"use client";

import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
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
    SelectionMode,
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
    Zap,
    BarChart3,
    X,
    Code2,
    Trash2,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
    AnyNodeData,
    NodeGraph,
    NodeKind,
    VisualNode,
    VisualEdge,
    CompilerDiagnostic,
} from "@/lib/bot-studio/compiler/types";
import type { Strategy } from "@/lib/strategy-lab/types";
import { strategyToAvScript } from "@/lib/bot-studio/compiler/strategy-to-avscript";
import { ENGINE_NODE_CATALOG, findEngineNode, type EngineNodeCategory } from "@/lib/bot-studio/compiler/engine-nodes";
import {
    INDICATOR_DEFS,
    INDICATOR_FAMILIES,
    INDICATOR_OPERATORS,
    defaultConditionFor,
    indicatorDef,
} from "@/lib/strategy-lab/indicator-library";
import { BOT_TEMPLATES, type BotTemplate } from "@/lib/bot-studio/templates";
import { duplicateGraphSelection, type DuplicateEdgesMode } from "@/lib/bot-studio/graph-operations";

const ENGINE_CATEGORIES: EngineNodeCategory[] = [
    "Trend",
    "Indicators",
    "Market structure",
    "Liquidity & FVG",
    "Smart money",
    "Sessions",
    "Price action & momentum",
    "Volatility",
];

type CompileOutcome =
    | { ok: true; strategy: Strategy; diagnostics: CompilerDiagnostic[] }
    | { ok: false; strategy: null; diagnostics: CompilerDiagnostic[]; error: string };

interface BacktestTrade {
    direction: string;
    entryPrice?: number;
    exitPrice?: number;
    pnl?: number;
    rMultiple?: number;
    exitReason?: string;
}

interface BacktestResult {
    symbol: string;
    timeframe: string;
    strategyName?: string;
    metrics: {
        netProfit: number;
        returnPct?: number;
        winRate?: number;
        longTrades: number;
        shortTrades: number;
        profitFactor?: number;
        expectancy?: number;
        maxDrawdownPct?: number;
        maxDrawdownAbs?: number;
    };
    diagnostics?: {
        loopBars: number;
        sessionBars: number;
        regimeBars: number;
        blockingRuleIds?: string[];
    };
    trades?: BacktestTrade[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Node Components
// ─────────────────────────────────────────────────────────────────────────────

const NODE_CARD = "rounded-xl border border-border bg-card p-3 text-xs shadow-sm";
const NODE_HEAD = "mb-2 flex items-center gap-2 font-semibold text-foreground";
const NODE_ICON = "flex h-6 w-6 items-center justify-center rounded-md";
const NODE_META = "space-y-1 text-muted-foreground";
const HANDLE = "!h-2.5 !w-2.5 !border-2 !border-card !bg-muted-foreground";

function MarketDataNodeComponent({ data }: NodeProps) {
    const d = (data || {}) as { symbol?: string; timeframe?: string; priceField?: string };
    return (
        <div className={`${NODE_CARD} min-w-[180px]`}>
            <div className={NODE_HEAD}>
                <span className={`${NODE_ICON} bg-info-muted text-info`}>
                    <TrendingUp className="h-3.5 w-3.5" />
                </span>
                <span>Market Data Feed</span>
            </div>
            <div className={NODE_META}>
                <div>Symbol: <strong className="font-numeric text-foreground">{d.symbol || "EURUSD"}</strong></div>
                <div>Timeframe: <strong className="font-numeric text-foreground">{d.timeframe || "H1"}</strong></div>
                <div>Source: <span className="font-numeric">{d.priceField || "close"}</span></div>
            </div>
            <Handle type="source" position={Position.Right} className={HANDLE} />
        </div>
    );
}

function IndicatorNodeComponent({ data }: NodeProps) {
    const d = (data || {}) as { kind?: string; period?: number; timeframe?: string };
    const kind = d.kind || "ema";
    return (
        <div className={`${NODE_CARD} min-w-[180px]`}>
            <Handle type="target" position={Position.Left} className={HANDLE} />
            <div className={NODE_HEAD}>
                <span className={`${NODE_ICON} bg-warning-muted text-warning`}>
                    <Sliders className="h-3.5 w-3.5" />
                </span>
                <span className="uppercase">{kind} Indicator</span>
            </div>
            <div className={NODE_META}>
                <div>Period: <strong className="font-numeric text-foreground">{d.period || 14}</strong></div>
                {d.timeframe && <div>TF: <span className="font-numeric">{d.timeframe}</span></div>}
            </div>
            <Handle type="source" position={Position.Right} className={HANDLE} />
        </div>
    );
}

function ConditionNodeComponent({ data }: NodeProps) {
    const d = (data || {}) as { kind?: string; label?: string; threshold?: number };
    return (
        <div className={`${NODE_CARD} min-w-[190px]`}>
            <Handle type="target" position={Position.Left} className={HANDLE} />
            <div className={NODE_HEAD}>
                <span className={`${NODE_ICON} bg-muted text-foreground`}>
                    <Zap className="h-3.5 w-3.5" />
                </span>
                <span>{d.label || "Condition Logic"}</span>
            </div>
            <div className={NODE_META}>
                <div>Condition: <strong className="text-foreground">{d.kind}</strong></div>
                {d.threshold !== undefined && <div>Threshold: <strong className="font-numeric text-foreground">{d.threshold}</strong></div>}
            </div>
            <Handle type="source" position={Position.Right} className={HANDLE} />
        </div>
    );
}

function ActionNodeComponent({ data }: NodeProps) {
    const d = (data || {}) as { kind?: string; riskPercent?: number; slMultiplier?: number; tpRatio?: number };
    const isLong = d.kind === "action_enter_long";
    return (
        <div className={`${NODE_CARD} min-w-[210px] ${isLong ? "border-positive/40" : "border-negative/40"}`}>
            <Handle type="target" position={Position.Left} className={HANDLE} />
            <div className={NODE_HEAD}>
                <span className={`${NODE_ICON} ${isLong ? "bg-positive-muted text-positive" : "bg-negative-muted text-negative"}`}>
                    <Play className="h-3.5 w-3.5" />
                </span>
                <span>{isLong ? "Enter LONG Position" : "Enter SHORT Position"}</span>
            </div>
            <div className={NODE_META}>
                <div>Risk: <strong className="font-numeric text-foreground">{d.riskPercent || 1.0}%</strong></div>
                <div>SL: <span className="font-numeric">ATR x{d.slMultiplier || 2.0}</span></div>
                <div>TP: <span className="font-numeric">{d.tpRatio ? `1:${d.tpRatio} R:R` : "Fixed"}</span></div>
            </div>
        </div>
    );
}

/** Engine-backed condition nodes: one shared card, label comes from the catalog. */
function EngineNodeComponent({ data }: NodeProps) {
    const d = (data || {}) as { label?: string };
    return (
        <div className={`${NODE_CARD} min-w-[200px]`}>
            <div className={NODE_HEAD}>
                <span className={`${NODE_ICON} bg-muted text-foreground`}>
                    <Zap className="h-3.5 w-3.5" />
                </span>
                <span>{d.label || "Engine condition"}</span>
            </div>
            <div className={NODE_META}>Evaluated by the strategy engine</div>
            <Handle type="source" position={Position.Right} className={HANDLE} />
        </div>
    );
}

function IndicatorConditionNodeComponent({ data }: NodeProps) {
    const d = (data || {}) as { indicator?: string; operator?: string; value?: number; compareTo?: string };
    const lhs = (d.indicator && indicatorDef(d.indicator)?.label) || d.indicator || "Indicator";
    const op = INDICATOR_OPERATORS.find((o) => o.value === d.operator)?.label ?? d.operator ?? "";
    const rhs = d.compareTo ? indicatorDef(d.compareTo)?.label ?? d.compareTo : String(d.value ?? 0);
    return (
        <div className={`${NODE_CARD} min-w-[220px]`}>
            <div className={NODE_HEAD}>
                <span className={`${NODE_ICON} bg-info-muted text-info`}>
                    <Sliders className="h-3.5 w-3.5" />
                </span>
                <span>Indicator condition</span>
            </div>
            <div className="font-numeric text-foreground">
                {lhs} {op} {rhs}
            </div>
            <Handle type="source" position={Position.Right} className={HANDLE} />
        </div>
    );
}

const legacyNodeTypes = {
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

const nodeTypes = {
    ...legacyNodeTypes,
    indicator_condition: IndicatorConditionNodeComponent,
    ...Object.fromEntries(ENGINE_NODE_CATALOG.map((d) => [d.kind, EngineNodeComponent])),
};

// ─────────────────────────────────────────────────────────────────────────────
// Initial Strategy Template Graph
// ─────────────────────────────────────────────────────────────────────────────

function toFlowNode(n: BotTemplate["nodes"][number]): Node {
    return { id: n.id, type: n.kind || (n.data?.kind as string) || "indicator_ema", position: n.position, data: n.data };
}

function toFlowEdge(e: BotTemplate["edges"][number]): Edge {
    return { id: e.id, source: e.source, target: e.target };
}

const DEFAULT_TEMPLATE = BOT_TEMPLATES[0];
const INITIAL_NODES: Node[] = DEFAULT_TEMPLATE.nodes.map(toFlowNode);
const INITIAL_EDGES: Edge[] = DEFAULT_TEMPLATE.edges.map(toFlowEdge);

const PALETTE_BUTTON = "h-8 rounded-lg px-2.5 text-xs font-medium";

const METRIC_TILE = "rounded-xl border border-border bg-card p-3.5";

const INSPECTOR_FIELD = "h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground";

function NodeInspector({
    node,
    onChange,
    onDelete,
    onClose,
}: {
    node: Node;
    onChange: (patch: Record<string, unknown>) => void;
    onDelete: () => void;
    onClose: () => void;
}) {
    const d = (node.data || {}) as Record<string, unknown>;
    const kind = String(d.kind ?? node.type ?? "");
    const num = (key: string) => (typeof d[key] === "number" ? (d[key] as number) : Number(d[key] ?? 0));
    const numberInput = (key: string, label: string, step = "any") => (
        <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{label}</span>
            <input
                type="number"
                step={step}
                value={num(key)}
                onChange={(e) => onChange({ [key]: Number(e.target.value) })}
                className={`${INSPECTOR_FIELD} font-numeric`}
            />
        </label>
    );

    let body: ReactNode;
    if (kind === "indicator_condition") {
        const indicator = String(d.indicator ?? "");
        const isSeries = typeof d.compareTo === "string";
        const directional = d.operator === "rising" || d.operator === "falling";
        body = (
            <>
                <label className="block space-y-1">
                    <span className="text-xs text-muted-foreground">Indicator</span>
                    <select
                        value={indicator}
                        onChange={(e) => onChange({ indicator: e.target.value })}
                        className={INSPECTOR_FIELD}
                    >
                        {INDICATOR_FAMILIES.map((family) => (
                            <optgroup key={family} label={family}>
                                {INDICATOR_DEFS.filter((def) => def.family === family).map((def) => (
                                    <option key={def.key} value={def.key}>
                                        {def.label}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </label>
                <label className="block space-y-1">
                    <span className="text-xs text-muted-foreground">Operator</span>
                    <select
                        value={String(d.operator ?? "gt")}
                        onChange={(e) => onChange({ operator: e.target.value })}
                        className={INSPECTOR_FIELD}
                    >
                        {INDICATOR_OPERATORS.map((op) => (
                            <option key={op.value} value={op.value}>
                                {op.label}
                            </option>
                        ))}
                    </select>
                </label>
                {!directional && (
                <>
                <label className="block space-y-1">
                    <span className="text-xs text-muted-foreground">Compare with</span>
                    <select
                        value={isSeries ? "series" : "value"}
                        onChange={(e) =>
                            e.target.value === "series"
                                ? onChange({ compareTo: defaultConditionFor(indicator).compareTo ?? "close" })
                                : onChange({ compareTo: undefined, value: Number(defaultConditionFor(indicator).value ?? 0) })
                        }
                        className={INSPECTOR_FIELD}
                    >
                        <option value="value">A fixed number</option>
                        <option value="series">Another indicator</option>
                    </select>
                </label>
                {isSeries ? (
                    <label className="block space-y-1">
                        <span className="text-xs text-muted-foreground">Other indicator</span>
                        <select
                            value={String(d.compareTo)}
                            onChange={(e) => onChange({ compareTo: e.target.value })}
                            className={INSPECTOR_FIELD}
                        >
                            {INDICATOR_DEFS.map((def) => (
                                <option key={def.key} value={def.key}>
                                    {def.label}
                                </option>
                            ))}
                        </select>
                    </label>
                ) : (
                    numberInput("value", "Value")
                )}
                </>
                )}
            </>
        );
    } else if (findEngineNode(kind)) {
        const def = findEngineNode(kind)!;
        const currentValue = d.value ?? def.value;
        const usesIndicatorRule = def.group === "indicator";
        body = (
            <>
                {usesIndicatorRule && def.editableOperator && (
                    <label className="block space-y-1">
                        <span className="text-xs text-muted-foreground">Operator</span>
                        <select
                            value={String(d.operator ?? def.operator)}
                            onChange={(e) => onChange({ operator: e.target.value })}
                            className={INSPECTOR_FIELD}
                        >
                            {INDICATOR_OPERATORS.filter((operator) => !["rising", "falling"].includes(operator.value)).map((operator) => (
                                <option key={operator.value} value={operator.value}>{operator.label}</option>
                            ))}
                        </select>
                    </label>
                )}
                {typeof def.value === "number" && numberInput("value", "Threshold")}
                {typeof def.value === "string" && (
                    <label className="block space-y-1">
                        <span className="text-xs text-muted-foreground">Rule value</span>
                        <input
                            type="text"
                            value={String(currentValue)}
                            onChange={(e) => onChange({ value: e.target.value })}
                            className={INSPECTOR_FIELD}
                        />
                    </label>
                )}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={d.negate === true}
                        onChange={(e) => onChange({ negate: e.target.checked })}
                        className="accent-primary"
                    />
                    Invert this condition only
                </label>
            </>
        );
    } else if (kind === "action_enter_long" || kind === "action_enter_short") {
        body = (
            <>
                {numberInput("riskPercent", "Risk per trade (%)", "0.1")}
                {numberInput("slMultiplier", "Stop loss (ATR ×)", "0.1")}
                {numberInput("tpRatio", "Take profit (R:R)", "0.1")}
            </>
        );
    } else {
        body = <p className="text-xs text-muted-foreground">This node has no editable values.</p>;
    }

    const title =
        kind === "indicator_condition"
            ? "Indicator condition"
            : typeof d.label === "string"
              ? d.label
              : kind;

    return (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-foreground">{title}</span>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close editor"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
            {body}
            <Button variant="outline" size="sm" className="w-full text-negative" onClick={onDelete}>
                <Trash2 />
                Delete node
            </Button>
        </div>
    );
}

export function VisualStrategyBuilder() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const strategyId = searchParams.get("id");

    const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
    const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);

    const [strategyName, setStrategyName] = useState("Visual Trend Strategy");
    const [symbol, setSymbol] = useState("EURUSD");
    const [timeframe, setTimeframe] = useState("H1");
    const [direction, setDirection] = useState<"long" | "short" | "both">("long");

    const [compiling, setCompiling] = useState(true);
    const [saving, setSaving] = useState(false);
    const [backtesting, setBacktesting] = useState(false);
    const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
    const [backtestModalOpen, setBacktestModalOpen] = useState(false);
    const [compiledStrategy, setCompiledStrategy] = useState<Strategy | null>(null);
    const [generatedAvs, setGeneratedAvs] = useState<string | null>(null);
    const [diagnostics, setDiagnostics] = useState<CompilerDiagnostic[]>([]);
    const [compileError, setCompileError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const selectedIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
    const selectedNodes = nodes.filter((n) => selectedIds.includes(n.id));
    const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
    const selectedEdgeCount = edges.filter((edge) => edge.selected).length;

    const handlePaneClick = useCallback(() => {
        // React Flow clears its own selection; nothing to mirror back into state.
    }, []);

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
                                const parsed = JSON.parse(data.strategy.source.nodeGraph) as {
                                    nodes?: Array<{
                                        id: string;
                                        kind?: NodeKind;
                                        type?: string;
                                        data?: Record<string, unknown>;
                                        position?: { x: number; y: number };
                                    }>;
                                    edges?: Array<{
                                        id: string;
                                        source: string;
                                        target: string;
                                        sourceHandle?: string | null;
                                        targetHandle?: string | null;
                                        animated?: boolean;
                                        selected?: boolean;
                                    }>;
                                    meta?: { symbol?: string; timeframe?: string; direction?: "long" | "short" | "both" };
                                };
                                if (parsed.nodes) {
                                    setNodes(parsed.nodes.map((node) => {
                                        const dataKind = node.data?.kind;
                                        const kind = node.kind ?? (typeof dataKind === "string" ? dataKind as NodeKind : undefined) ?? node.type ?? "indicator_ema";
                                        return {
                                            id: node.id,
                                            type: kind,
                                            position: node.position ?? { x: 0, y: 0 },
                                            data: { ...node.data, kind },
                                        };
                                    }));
                                }
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
        const visualNodes: VisualNode[] = nodes.map((node) => ({
            id: node.id,
            kind: (node.data?.kind as NodeKind | undefined) || (node.type as NodeKind | undefined) || "indicator_ema",
            data: node.data as AnyNodeData,
            position: node.position,
        }));
        const visualEdges: VisualEdge[] = edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            sourceHandle: edge.sourceHandle ?? undefined,
            target: edge.target,
            targetHandle: edge.targetHandle ?? undefined,
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

    // Request a compile of the current graph. Resolves to the outcome; state is
    // written by the caller, so effects never set state synchronously.
    const compileGraphNow = useCallback(async (): Promise<CompileOutcome> => {
        const headers = await getAuthHeaders();
        const graph = serializeGraph();
        const res = await fetch("/api/bot-studio/compile/visual", {
            method: "POST",
            headers,
            body: JSON.stringify({ graph }),
        });
        const data = await res.json();
        if (data.ok) {
            return { ok: true, strategy: data.value, diagnostics: data.diagnostics || [] };
        }
        return {
            ok: false,
            strategy: null,
            diagnostics: data.diagnostics || [],
            error: data.error || "Compilation returned errors.",
        };
    }, [serializeGraph, getAuthHeaders]);

    const applyCompileOutcome = useCallback((outcome: CompileOutcome) => {
        setCompiledStrategy(outcome.strategy);
        setDiagnostics(outcome.diagnostics);
        setCompileError(outcome.ok ? null : outcome.error);
    }, []);

    const handleCompile = useCallback(() => {
        setCompiling(true);
        setCompileError(null);
        return compileGraphNow()
            .then(applyCompileOutcome)
            .catch((e: unknown) => {
                setCompileError(e instanceof Error ? e.message : "Compilation failed");
            })
            .finally(() => setCompiling(false));
    }, [compileGraphNow, applyCompileOutcome]);

    const handleGenerateAvs = useCallback(() => {
        if (!compiledStrategy) return;
        const result = strategyToAvScript(compiledStrategy);
        setGeneratedAvs(result.source);
        if (result.unsupported.length > 0) {
            setCompileError(`AVS generation reported unsupported constructs: ${result.unsupported.join("; ")}`);
        } else {
            setCompileError(null);
        }
    }, [compiledStrategy]);

    // Auto compile when loaded and whenever the graph changes. Stale results are dropped.
    useEffect(() => {
        let cancelled = false;
        compileGraphNow()
            .then((outcome) => {
                if (!cancelled) applyCompileOutcome(outcome);
            })
            .catch((e: unknown) => {
                if (!cancelled) setCompileError(e instanceof Error ? e.message : "Compilation failed");
            })
            .finally(() => {
                if (!cancelled) setCompiling(false);
            });
        return () => {
            cancelled = true;
        };
    }, [compileGraphNow, applyCompileOutcome]);

    // Close the backtest report with Escape
    useEffect(() => {
        if (!backtestModalOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setBacktestModalOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [backtestModalOpen]);

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
            const compData = (await compRes.json()) as {
                ok: boolean;
                value?: Strategy;
                diagnostics?: CompilerDiagnostic[];
            };
            if (!compData.ok || !compData.value) {
                alert(`Cannot save: compiler errors exist.\n${compData.diagnostics?.map((d) => d.message).join("\n")}`);
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
                    router.push(`${window.location.pathname}?id=${data.strategy.id}`);
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
    const nodeCounter = useRef(0);
    const addNode = (type: string, kind: string, defaultData: Record<string, unknown>) => {
        nodeCounter.current += 1;
        const id = `added_${nodeCounter.current}`;
        setNodes((nds) => {
            const newNode: Node = {
                id,
                type,
                position: { x: 300 + (nds.length % 5) * 40, y: 150 + (nds.length % 7) * 30 },
                data: { kind, ...defaultData },
            };
            return [...nds, newNode];
        });
    };

    const addIndicatorCondition = (key: string) => {
        addNode("indicator_condition", "indicator_condition", { ...defaultConditionFor(key), indicator: key });
    };

    const updateNodeData = useCallback(
        (id: string, patch: Record<string, unknown>) => {
            setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
        },
        [setNodes],
    );

    const deleteNode = useCallback(
        (id: string) => {
            setNodes((nds) => nds.filter((n) => n.id !== id));
            setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
        },
        [setNodes, setEdges],
    );

    const loadTemplate = (id: string) => {
        const tpl = BOT_TEMPLATES.find((t) => t.id === id);
        if (!tpl) return;
        setNodes(tpl.nodes.map(toFlowNode).map((n) => ({ ...n, selected: false })));
        setEdges(tpl.edges.map(toFlowEdge).map((e) => ({ ...e, selected: false })));
        setStrategyName(tpl.name);
        setDirection(tpl.direction);
    };

    const duplicateSelection = useCallback((mode: DuplicateEdgesMode) => {
        const ids = selectedIds;
        if (ids.length === 0) return;
        const nodeIds = new Set(nodes.map((node) => node.id));
        const edgeIds = new Set(edges.map((edge) => edge.id));
        let counter = nodeCounter.current;
        const nextId = (kind: "node" | "edge", originalId: string) => {
            let id = "";
            do {
                counter += 1;
                id = `${kind === "node" ? "copy" : "edge_copy"}_${counter}_${originalId}`;
            } while ((kind === "node" ? nodeIds : edgeIds).has(id));
            (kind === "node" ? nodeIds : edgeIds).add(id);
            return id;
        };
        const result = duplicateGraphSelection(nodes, edges, ids, mode, nextId);
        nodeCounter.current = counter;
        setNodes((current) =>
            current.map((n) =>
                result.duplicatedNodeIds.includes(n.id) ? { ...n, selected: true } : { ...n, selected: false },
            ),
        );
        setEdges(result.edges.map((e) => ({ ...e, selected: false })));
    }, [nodes, edges, selectedIds, setNodes, setEdges]);

    const deleteSelection = useCallback(() => {
        const ids = new Set(selectedIds);
        const selectedEdgeIds = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id));
        if (ids.size === 0 && selectedEdgeIds.size === 0) return;
        setNodes((current) => current.filter((node) => !ids.has(node.id)));
        setEdges((current) => current.filter((edge) =>
            !selectedEdgeIds.has(edge.id) && !ids.has(edge.source) && !ids.has(edge.target),
        ));
    }, [selectedIds, edges, setNodes, setEdges]);

    return (
        <div className="mx-auto max-w-7xl space-y-4 p-6">
            {/* Toolbar */}
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                    <Link
                        href="/account/strategy-studio"
                        aria-label="Back to Strategy Studio"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                    <div className="min-w-0">
                        <label className="sr-only" htmlFor="strategy-name">Strategy name</label>
                        <div className="flex items-center gap-2">
                            <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <input
                                id="strategy-name"
                                type="text"
                                value={strategyName}
                                onChange={(e) => setStrategyName(e.target.value)}
                                placeholder="Strategy name"
                                className="min-w-0 rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold text-foreground hover:border-border focus:border-ring focus:outline-none"
                            />
                        </div>
                        <p className="mt-0.5 pl-6 text-xs text-muted-foreground">
                            Visual no-code strategy graph · compiled to the strategy engine
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleCompile} disabled={compiling}>
                        <RefreshCw className={compiling ? "animate-spin" : ""} />
                        Compile
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleGenerateAvs} disabled={!compiledStrategy}>
                        <Code2 />
                        Generate AVS
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleBacktest} disabled={backtesting || compiling}>
                        <BarChart3 className={backtesting ? "animate-pulse" : ""} />
                        {backtesting ? "Backtesting…" : "Run backtest"}
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={saving} variant={saveSuccess ? "secondary" : "default"}>
                        {saveSuccess ? <CheckCircle2 /> : <Save />}
                        {saveSuccess ? "Saved" : saving ? "Saving…" : "Save strategy"}
                    </Button>
                </div>
            </div>

            {/* Actions and templates */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
                <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Plus className="h-3.5 w-3.5" />
                    Add action
                </span>
                {([
                    ["action_enter_long", "Enter long", "border-positive/30 text-positive"],
                    ["action_enter_short", "Enter short", "border-negative/30 text-negative"],
                ] as const).map(([kind, label, tone]) => (
                    <Button
                        key={kind}
                        variant="outline"
                        className={`${PALETTE_BUTTON} ${tone}`}
                        onClick={() =>
                            addNode(kind, kind, {
                                riskPercent: 1.0,
                                slType: "atr",
                                slMultiplier: 2.0,
                                tpType: "risk_reward",
                                tpRatio: 2.0,
                            })
                        }
                    >
                        {label}
                    </Button>
                ))}
                <span className="ml-auto flex items-center gap-2">
                    <label htmlFor="bot-template" className="text-xs font-medium text-muted-foreground">
                        Start from a bot template
                    </label>
                    <select
                        id="bot-template"
                        value=""
                        onChange={(e) => e.target.value && loadTemplate(e.target.value)}
                        className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground"
                    >
                        <option value="">Choose a template…</option>
                        {BOT_TEMPLATES.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </select>
                </span>
            </div>

            {/* Indicator library: each click adds an editable indicator condition to the canvas. */}
            <div className="space-y-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
                <span className="text-xs font-medium text-muted-foreground">
                    Indicator library · click to add an editable condition
                </span>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {INDICATOR_FAMILIES.map((family) => {
                        const defs = INDICATOR_DEFS.filter((def) => def.family === family);
                        return (
                            <details key={family} className="rounded-lg border border-border p-2">
                                <summary className="cursor-pointer text-xs font-semibold text-foreground">
                                    {family} <span className="font-numeric font-normal text-muted-foreground">({defs.length})</span>
                                </summary>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {defs.map((def) => (
                                        <Button
                                            key={def.key}
                                            variant="outline"
                                            size="sm"
                                            className={PALETTE_BUTTON}
                                            title={def.description}
                                            onClick={() => addIndicatorCondition(def.key)}
                                        >
                                            {def.label}
                                        </Button>
                                    ))}
                                </div>
                            </details>
                        );
                    })}
                </div>
            </div>

            {/* Engine-backed condition library: every node compiles to a rule the strategy engine evaluates. */}
            <div className="space-y-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
                <span className="text-xs font-medium text-muted-foreground">
                    Condition library · each node is evaluated by the strategy engine
                </span>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {ENGINE_CATEGORIES.map((category) => {
                        const defs = ENGINE_NODE_CATALOG.filter((d) => d.category === category);
                        return (
                            <details key={category} className="rounded-lg border border-border p-2" open={category === "Trend"}>
                                <summary className="cursor-pointer text-xs font-semibold text-foreground">
                                    {category} <span className="font-numeric font-normal text-muted-foreground">({defs.length})</span>
                                </summary>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {defs.map((def) => (
                                        <Button
                                            key={def.kind}
                                            variant="outline"
                                            size="sm"
                                            className={PALETTE_BUTTON}
                                            title={def.description}
                                            onClick={() => addNode(def.kind, def.kind, { label: def.label, ...(def.indicator ? { value: def.value } : {}) })}
                                        >
                                            {def.label}
                                        </Button>
                                    ))}
                                </div>
                            </details>
                        );
                    })}
                </div>
            </div>

            {/* Canvas and compiler panel */}
            <div className="grid h-[620px] grid-cols-1 gap-5 lg:grid-cols-12">
                <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:col-span-8">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        nodeTypes={nodeTypes}
                        onPaneClick={handlePaneClick}
                        selectionOnDrag
                        selectionMode={SelectionMode.Partial}
                        multiSelectionKeyCode={["Meta", "Control"]}
                        selectionKeyCode="Shift"
                        panOnDrag={[1]}
                        fitView
                    >
                        <Background gap={16} size={1} color="currentColor" className="text-border" />
                        <Controls />
                        <MiniMap nodeStrokeWidth={3} className="!bg-card !border !border-border" />
                    </ReactFlow>
                </div>

                <div className="flex flex-col space-y-4 overflow-y-auto lg:col-span-4">
                    {(selectedNodes.length > 0 || selectedEdgeCount > 0) && (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
                            <span aria-live="polite" className="mr-auto text-xs font-medium text-muted-foreground">
                                {selectedNodes.length} node{selectedNodes.length === 1 ? "" : "s"} selected
                                {selectedEdgeCount > 0 ? ` · ${selectedEdgeCount} edge${selectedEdgeCount === 1 ? "" : "s"}` : ""}
                            </span>
                            <Button variant="outline" size="sm" onClick={() => duplicateSelection("internal")} disabled={selectedNodes.length === 0}>
                                Duplicate selection
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => duplicateSelection("connected")} disabled={selectedNodes.length === 0}>
                                Duplicate connected
                            </Button>
                            <Button variant="outline" size="sm" className="text-negative" onClick={deleteSelection}>
                                Delete selection
                            </Button>
                        </div>
                    )}
                    {selectedNode && (
                        <NodeInspector
                            node={selectedNode}
                            onChange={(patch) => updateNodeData(selectedNode.id, patch)}
                            onDelete={() => deleteNode(selectedNode.id)}
                            onClose={() => setNodes((current) => current.map((n) => ({ ...n, selected: false })))}
                        />
                    )}
                    <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Graph compiler
                            </span>
                            <StatusBadge
                                tone={compiledStrategy ? "positive" : "negative"}
                                dot
                                label={compiledStrategy ? "Valid strategy" : "Compilation error"}
                            />
                        </div>

                        {compileError && (
                            <div role="alert" className="flex items-start gap-2 rounded-lg border border-negative/30 bg-negative-muted p-3 text-xs text-negative">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                <div>{compileError}</div>
                            </div>
                        )}

                        {diagnostics.length > 0 && (
                            <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                                {diagnostics.map((d, i) => (
                                    <li
                                        key={i}
                                        className={`flex items-start gap-2 rounded-lg p-2 text-xs ${
                                            d.severity === "error"
                                                ? "bg-negative-muted text-negative"
                                                : "bg-warning-muted text-warning"
                                        }`}
                                    >
                                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        <span>{d.message}</span>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {!compiledStrategy && !compileError && diagnostics.length === 0 && (
                            <p className="text-xs text-muted-foreground">Compile the graph to see the strategy summary.</p>
                        )}
                    </div>

                    {compiledStrategy && (
                        <div className="flex-1 space-y-3 rounded-xl border border-border bg-card p-4 text-xs shadow-sm">
                            <div className="flex items-center justify-between border-b border-border pb-2">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Compiled strategy
                                </span>
                                <span className="font-numeric text-foreground">
                                    {compiledStrategy.asset} {compiledStrategy.timeframes.entry}
                                </span>
                            </div>
                            <dl className="space-y-2">
                                {[
                                    ["Model", compiledStrategy.executionModel],
                                    ["Risk", `${compiledStrategy.risk.riskPercent}%`],
                                    ["Stop loss", `${compiledStrategy.stopLoss.mode} (x${compiledStrategy.stopLoss.atrMultiple})`],
                                    ["Take profit", `R:R 1:${compiledStrategy.takeProfit.r1}`],
                                ].map(([label, value]) => (
                                    <div key={label} className="flex justify-between border-b border-border/60 py-1">
                                        <dt className="text-muted-foreground">{label}</dt>
                                        <dd className="font-numeric font-semibold text-foreground">{value}</dd>
                                    </div>
                                ))}
                            </dl>

                            <div>
                                <span className="mb-1 block font-semibold text-muted-foreground">
                                    Entry rules ({compiledStrategy.entryRules.length})
                                </span>
                                <div className="space-y-1">
                                    {compiledStrategy.entryRules.map((r, i) => (
                                        <div key={i} className="rounded-md bg-muted p-1.5 font-mono text-[11px] text-foreground">
                                            {r.label}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {generatedAvs && (
                                <div>
                                    <label htmlFor="generated-avs" className="mb-1 block font-semibold text-muted-foreground">
                                        Generated AVS
                                    </label>
                                    <textarea
                                        id="generated-avs"
                                        readOnly
                                        value={generatedAvs}
                                        className="h-48 w-full rounded-md border border-border bg-muted p-2 font-mono text-[11px] text-foreground"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Backtest report */}
            {backtestModalOpen && backtestResult && (
                <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/40 p-4 backdrop-blur-sm">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="backtest-title"
                        className="my-8 flex max-h-[90vh] w-full max-w-3xl flex-col space-y-5 rounded-xl border border-border bg-card p-6 shadow-lg"
                    >
                        <div className="flex items-center justify-between border-b border-border pb-3">
                            <div className="flex items-center gap-2.5">
                                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-positive-muted text-positive">
                                    <BarChart3 className="h-4 w-4" />
                                </span>
                                <div>
                                    <h2 id="backtest-title" className="text-base font-semibold text-foreground">Backtest report</h2>
                                    <p className="text-xs text-muted-foreground">
                                        {backtestResult.symbol} · {backtestResult.timeframe} · {backtestResult.strategyName || strategyName}
                                    </p>
                                </div>
                            </div>
                            <Button variant="ghost" size="icon-sm" aria-label="Close report" onClick={() => setBacktestModalOpen(false)}>
                                <X />
                            </Button>
                        </div>

                        <div className="flex-1 space-y-5 overflow-y-auto pr-1">
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                <div className={METRIC_TILE}>
                                    <span className="text-xs font-medium text-muted-foreground">Net PnL</span>
                                    <div className={`font-numeric mt-1 text-xl font-bold ${
                                        backtestResult.metrics.netProfit >= 0 ? "text-positive" : "text-negative"
                                    }`}>
                                        ${backtestResult.metrics.netProfit.toFixed(2)}
                                    </div>
                                    <span className="font-numeric text-xs text-muted-foreground">
                                        Return: {backtestResult.metrics.returnPct?.toFixed(2)}%
                                    </span>
                                </div>

                                <div className={METRIC_TILE}>
                                    <span className="text-xs font-medium text-muted-foreground">Win rate</span>
                                    <div className="font-numeric mt-1 text-xl font-bold text-foreground">
                                        {backtestResult.metrics.winRate?.toFixed(1)}%
                                    </div>
                                    <span className="font-numeric text-xs text-muted-foreground">
                                        {backtestResult.metrics.longTrades + backtestResult.metrics.shortTrades} total trades
                                    </span>
                                </div>

                                <div className={METRIC_TILE}>
                                    <span className="text-xs font-medium text-muted-foreground">Profit factor</span>
                                    <div className="font-numeric mt-1 text-xl font-bold text-foreground">
                                        {backtestResult.metrics.profitFactor?.toFixed(2)}
                                    </div>
                                    <span className="font-numeric text-xs text-muted-foreground">
                                        Expectancy: {backtestResult.metrics.expectancy?.toFixed(2)}
                                    </span>
                                </div>

                                <div className={METRIC_TILE}>
                                    <span className="text-xs font-medium text-muted-foreground">Max drawdown</span>
                                    <div className="font-numeric mt-1 text-xl font-bold text-negative">
                                        {backtestResult.metrics.maxDrawdownPct?.toFixed(2)}%
                                    </div>
                                    <span className="font-numeric text-xs text-muted-foreground">
                                        ${backtestResult.metrics.maxDrawdownAbs?.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {backtestResult.diagnostics && (
                                <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-4">
                                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Bar diagnostics &amp; rule evaluator
                                    </span>
                                    <div className="grid grid-cols-3 gap-2 text-xs">
                                        <div className="rounded-md border border-border bg-card p-2">
                                            <span className="text-muted-foreground">Scanned bars</span>
                                            <div className="font-numeric font-semibold text-foreground">{backtestResult.diagnostics.loopBars}</div>
                                        </div>
                                        <div className="rounded-md border border-border bg-card p-2">
                                            <span className="text-muted-foreground">Session bars</span>
                                            <div className="font-numeric font-semibold text-foreground">{backtestResult.diagnostics.sessionBars}</div>
                                        </div>
                                        <div className="rounded-md border border-border bg-card p-2">
                                            <span className="text-muted-foreground">Regime bars</span>
                                            <div className="font-numeric font-semibold text-foreground">{backtestResult.diagnostics.regimeBars}</div>
                                        </div>
                                    </div>
                                    {(backtestResult.diagnostics.blockingRuleIds?.length ?? 0) > 0 && (
                                        <div className="rounded-md border border-warning/30 bg-warning-muted p-2.5 text-xs text-warning">
                                            <strong>Blocking rules:</strong> {backtestResult.diagnostics.blockingRuleIds?.join(", ")}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="space-y-2">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Executed trades ({backtestResult.trades?.length || 0})
                                </span>
                                {(!backtestResult.trades || backtestResult.trades.length === 0) ? (
                                    <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                                        No trades triggered in the tested window. Check indicators and threshold conditions.
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto rounded-xl border border-border">
                                        <table className="w-full text-left text-xs">
                                            <thead className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                                                <tr>
                                                    <th scope="col" className="p-2.5">Side</th>
                                                    <th scope="col" className="p-2.5">Entry</th>
                                                    <th scope="col" className="p-2.5">Exit</th>
                                                    <th scope="col" className="p-2.5">Profit</th>
                                                    <th scope="col" className="p-2.5">R return</th>
                                                    <th scope="col" className="p-2.5">Exit reason</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/60">
                                                {backtestResult.trades.slice(0, 8).map((t, idx) => (
                                                    <tr key={idx} className="hover:bg-muted/30">
                                                        <td className="p-2.5">
                                                            <StatusBadge
                                                                tone={t.direction === "long" ? "positive" : "negative"}
                                                                label={String(t.direction).toUpperCase()}
                                                            />
                                                        </td>
                                                        <td className="font-numeric p-2.5">{t.entryPrice?.toFixed(2)}</td>
                                                        <td className="font-numeric p-2.5">{t.exitPrice?.toFixed(2)}</td>
                                                        <td className={`font-numeric p-2.5 font-semibold ${(t.pnl ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>
                                                            ${t.pnl?.toFixed(2)}
                                                        </td>
                                                        <td className="font-numeric p-2.5">{t.rMultiple ? `${t.rMultiple.toFixed(2)}R` : "—"}</td>
                                                        <td className="p-2.5 text-muted-foreground">{t.exitReason || "manual"}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-end border-t border-border pt-3">
                            <Button onClick={() => setBacktestModalOpen(false)}>Close report</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default VisualStrategyBuilder;
