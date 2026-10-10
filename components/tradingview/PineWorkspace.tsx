"use client";

import { DragEvent, useCallback, useEffect, useMemo, useState, useRef, DragEventHandler } from "react";
import { Copy, Download, FolderOpen, Plus, Save, Trash2, Play, Check, AlertTriangle, BarChart3, Loader2, Brain, Wand2, Sparkles, Bell, Settings2, X, Search, Sliders, Layers, Power, Info } from "lucide-react";
import { auth } from "@/lib/firebase";
import ProGate from "@/components/subscription/ProGate";
import TradingViewChart from "@/components/tradingview/TradingViewChart";
import MarketReplay from "@/components/tradingview/MarketReplay";
import { ProTerminalChartWorkspace } from "@/components/pro-scalping-terminal/ProTerminalChartWorkspace";
import { ProTerminalReplay } from "@/components/pro-scalping-terminal/ProTerminalReplay";
import { defaultLayerState } from "@/components/pro-scalping-terminal/chart-layers";
import { SUPPORTED_SYMBOLS, type SupportedSymbol } from "@/lib/market-data/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { executePine } from "@/lib/pine-runtime";
import type { PineExecutionResult } from "@/lib/pine-runtime";
import { buildPineStudyOverlay, type PineStudyOverlay } from "@/components/pro-scalping-terminal/pine-overlays";
import {
  createPineSource as buildPineFromVisual,
  DEFAULT_VISUAL_EDGES,
  DEFAULT_VISUAL_NODES,
  VISUAL_NODE_LIBRARY,
  VISUAL_NODE_MAP,
  type VisualNodeKind,
} from "@/components/tradingview/visual-builder";
import { toPineCandles } from "@/lib/pine-runtime/backtest";
import type { PineBacktestResult } from "@/lib/pine-runtime/backtest";
import PineAnalysisPanel from "@/components/tradingview/PineAnalysisPanel";
import CreateAlertDialog from "@/components/tradingview/CreateAlertDialog";
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  Connection, Edge, Node, NodeTypes,
  Handle, Position, MarkerType, EdgeTypes,
  getBezierPath, EdgeProps, BaseEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type WorkspaceScope = "account" | "admin";
type SavedWorkspace = { id: string; name: string; mode: "visual" | "code"; type: "strategy" | "indicator"; createdAt: number };
type NodeKind = VisualNodeKind;
type FlowNode = { id: string; kind: NodeKind; x: number; y: number; label?: string; config?: Record<string, any>; enabled?: boolean };
type FlowEdge = { from: string; to: string };

type PineWorkspaceProps = { scope: WorkspaceScope };

// Node labels/colors derive from the shared visual-builder library so the
// palette, the AI builder and the canvas stay in sync automatically.
const nodeTypes: Record<NodeKind, { label: string; color: string }> = Object.fromEntries(
    VISUAL_NODE_LIBRARY.map((entry) => [entry.kind, { label: entry.label, color: entry.color }])
) as Record<NodeKind, { label: string; color: string }>;

const initialNodes: FlowNode[] = DEFAULT_VISUAL_NODES;

const initialEdges: FlowEdge[] = DEFAULT_VISUAL_EDGES;

const starterCode = `//@version=6
strategy("Visual Strategy", overlay=true, pyramiding=0)

// Inputs
length = input.int(20, "MA Length", minval=1)
emaLen = input.int(50, "EMA Length", minval=1)
rsiLen = input.int(14, "RSI Length", minval=1)
stopPct = input.float(1.0, "Stop Loss %", minval=0.1, step=0.1)
tpPct = input.float(3.0, "Take Profit %", minval=0.1, step=0.1)

// Indicators
fast = ta.ema(close, 20)
slow = ta.ema(close, 50)
rsiValue = ta.rsi(close, rsiLen)

// Plots
plot(fast, color=color.aqua, linewidth=2, title="Fast MA")
plot(slow, color=color.orange, linewidth=2, title="Slow MA")
hline(30, "RSI Oversold", color=color.red, linestyle=hline.style_dashed)
hline(70, "RSI Overbought", color=color.green, linestyle=hline.style_dashed)

// Conditions
longCondition = ta.crossover(fast, slow) and rsiValue < 70
shortCondition = ta.crossunder(fast, slow) and rsiValue > 30

// Entries
if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

// Risk Management
strategy.exit("Long Exit", "Long", stop=strategy.position_avg_price * (1 - stopPct / 100), limit=strategy.position_avg_price * (1 + tpPct / 100))
strategy.exit("Short Exit", "Short", stop=strategy.position_avg_price * (1 + stopPct / 100), limit=strategy.position_avg_price * (1 - tpPct / 100))`;

// The visual→Pine generator lives in components/tradingview/visual-builder.ts
// (leaf module, shared with the AI strategy builder). Everything it emits is
// real runtime-executable Pine — every `ta.*` call exists in lib/pine-runtime.
function nodeHint(kind: NodeKind) {
    const entry = VISUAL_NODE_MAP[kind];
    return entry?.hint ?? kind;
}


const VISUAL_CATEGORY_STYLES: Record<string, { header: string; badge: string; dot: string }> = {
    "Market Data": { header: "bg-info/10 border-b border-info/30", badge: "bg-info-muted text-info-foreground font-extrabold border border-info/50 shadow-xs", dot: "#0ea5e9" },
    Technical: { header: "bg-warning/10 border-b border-warning/30", badge: "bg-warning-muted text-warning-foreground font-extrabold border border-warning/50 shadow-xs", dot: "#f59e0b" },
    Volume: { header: "bg-muted/10 border-b border-border/30", badge: "bg-muted text-foreground dark:bg-secondary font-extrabold border border-border/50 shadow-xs", dot: "#64748b" },
    Condition: { header: "bg-warning/10 border-b border-warning/30", badge: "bg-warning-muted text-warning-foreground font-extrabold border border-warning/50 shadow-xs", dot: "#f97316" },
    Signal: { header: "bg-positive/10 border-b border-positive/30", badge: "bg-positive-muted text-positive-foreground font-extrabold border border-positive/50 shadow-xs", dot: "#22c55e" },
    Logic: { header: "bg-primary/10 border-b border-primary/30", badge: "bg-primary/10 text-primary font-extrabold border border-primary/50 shadow-xs", dot: "#6366f1" },
    Execution: { header: "bg-info/10 border-b border-info/30", badge: "bg-info-muted text-info-foreground font-extrabold border border-info/50 shadow-xs", dot: "#3b82f6" },
    Risk: { header: "bg-negative/10 border-b border-negative/30", badge: "bg-negative-muted text-negative-foreground font-extrabold border border-negative/50 shadow-xs", dot: "#ef4444" },
    Output: { header: "bg-info/10 border-b border-info/30", badge: "bg-info-muted text-info-foreground font-extrabold border border-info/50 shadow-xs", dot: "#0284c7" },
};

const nodeCategoryStyles: Record<NodeKind, { category: string; header: string; badge: string; dot: string }> = Object.fromEntries(
    VISUAL_NODE_LIBRARY.map((entry) => [
        entry.kind,
        { category: entry.category, ...(VISUAL_CATEGORY_STYLES[entry.category] ?? VISUAL_CATEGORY_STYLES.Technical) },
    ])
) as Record<NodeKind, { category: string; header: string; badge: string; dot: string }>;

function PineNode({ data, selected }: { data: any; selected?: boolean }) {
    const kind: NodeKind = data.kind;
    const isNodeEnabled = data.enabled !== false;
    const cs = nodeCategoryStyles[kind] || {
        category: "Data",
        header: "bg-warning/10 border-b border-warning/20",
        badge: "bg-warning/10 text-warning border border-warning/20",
        dot: "#f59e0b",
    };
    const label = data.label || nodeTypes[kind]?.label || kind;
    const hint = nodeHint(kind);

    return (
        <div className={`relative rounded-lg border-2 ${selected ? "border-warning ring-2 ring-warning/50 shadow-lg scale-102 z-10" : "border-border/60"} bg-card text-card-foreground shadow-sm min-w-[168px] max-w-[208px] select-none transition-all duration-150 ${!isNodeEnabled ? "opacity-60" : ""}`}>
            {/* Top Target Handle */}
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex flex-col items-center z-20">
                <Handle
                    type="target"
                    id="in"
                    position={Position.Top}
                    style={{ width: 14, height: 14, background: cs.dot, border: "3px solid #fff", boxShadow: "0 0 0 2px #475569", top: 4, zIndex: 10, borderRadius: "50%" }}
                />
            </div>

            {/* Category Header */}
            <div className={`flex items-center gap-1.5 px-2.5 pt-2 pb-1.5 rounded-t-xl ${cs.header}`}>
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: cs.dot }} />
                <span className="text-micro font-semibold uppercase tracking-wider text-foreground truncate flex-1 leading-tight">
                    {label}
                </span>
            </div>

            {/* Body */}
            <div className="px-2.5 py-2 space-y-1">
                <span className={`inline-flex text-[0.62rem] font-extrabold px-2 py-0.5 rounded-full ${cs.badge}`}>
                    {cs.category}
                </span>
                <p className="text-micro leading-3 text-muted-foreground truncate">{hint}</p>
            </div>

            {/* Bottom Source Handle */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center z-20">
                <Handle
                    type="source"
                    id="out"
                    position={Position.Bottom}
                    style={{ width: 14, height: 14, background: "#22c55e", border: "3px solid #fff", boxShadow: "0 0 0 2px #475569", bottom: 4, zIndex: 10, borderRadius: "50%" }}
                />
            </div>
        </div>
    );
}

function PineEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd }: EdgeProps) {
    const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
    return (
        <BaseEdge
            path={path}
            markerEnd={markerEnd}
            style={{
                stroke: selected ? "hsl(var(--ring, 221 83% 53%))" : "#64748b",
                strokeWidth: selected ? 2.5 : 1.5,
                opacity: selected ? 1 : 0.7,
                filter: selected ? "drop-shadow(0 0 4px hsl(var(--ring, 221 83% 53%) / 0.5))" : undefined,
            }}
        />
    );
}

const rfNodeTypes: NodeTypes = { pineNode: PineNode };
const rfEdgeTypes: EdgeTypes = { pineEdge: PineEdge };
const RF_EDGE_DEF = { type: "pineEdge", markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13 }, selectable: true, deletable: true };

const initialReactFlowNodes: Node[] = initialNodes.map((n) => ({
    id: n.id,
    type: "pineNode",
    position: { x: n.x, y: n.y },
    data: { kind: n.kind, label: n.label, config: n.config, enabled: n.enabled },
}));

const initialReactFlowEdges: Edge[] = initialEdges.map((e) => ({
    id: `e-${e.from}-${e.to}`,
    source: e.from,
    target: e.to,
    ...RF_EDGE_DEF,
}));

export default function PineWorkspace({ scope }: PineWorkspaceProps) {
    const [name, setName] = useState("Untitled Pine script");
    const [mode, setMode] = useState<"visual" | "code" | "replay">("visual");
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialReactFlowNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialReactFlowEdges);

    const flowNodes = useMemo<FlowNode[]>(() => {
        return nodes.map((n) => ({
            id: n.id,
            kind: (n.data?.kind as NodeKind) || "moving_average",
            x: n.position.x,
            y: n.position.y,
            label: n.data?.label as string | undefined,
            config: n.data?.config as Record<string, any> | undefined,
            enabled: n.data?.enabled as boolean | undefined,
        }));
    }, [nodes]);

    const flowEdges = useMemo<FlowEdge[]>(() => {
        return edges.map((e) => ({
            from: e.source,
            to: e.target,
        }));
    }, [edges]);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [sidebarTab, setSidebarTab] = useState<"library" | "workspaces" | "inspector">("library");
    const [librarySearch, setLibrarySearch] = useState("");
    const [workspaceSearch, setWorkspaceSearch] = useState("");
    const [source, setSource] = useState(starterCode);
    const [saving, setSaving] = useState(false);
    const [copied, setCopied] = useState(false);
    const [notice, setNotice] = useState("");
    const [workspaces, setWorkspaces] = useState<SavedWorkspace[]>([]);
    const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string>("");
    const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
    const [pineResult, setPineResult] = useState<PineExecutionResult | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [showAnalysis, setShowAnalysis] = useState(false);
    const [isBacktestLoading, setIsBacktestLoading] = useState(false);
    const [backtestResult, setBacktestResult] = useState<PineBacktestResult | null>(null);
    const [aiDescription, setAiDescription] = useState("");
    const [isAiBuilding, setIsAiBuilding] = useState(false);
    const [isAiFixing, setIsAiFixing] = useState(false);
    const [isAiDescribing, setIsAiDescribing] = useState(false);
    const [aiStrategyDescription, setAiStrategyDescription] = useState("");
    const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);

    const selectNode = useCallback((id: string | null) => {
        setSelectedNodeId(id);
        if (id) setSidebarTab("inspector");
    }, []);

    const loadWorkspaces = useCallback(async () => {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        setLoadingWorkspaces(true);
        try {
            const response = await fetch(`/api/tradingview/workspaces?scope=${scope}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const result = await response.json() as { success?: boolean; workspaces?: SavedWorkspace[]; error?: string };
            if (response.ok && result.success) {
                setWorkspaces(result.workspaces ?? []);
            } else {
                setNotice(result.error || "Could not load saved workspaces.");
            }
        } catch {
            setNotice("Could not load saved workspaces.");
        } finally {
            setLoadingWorkspaces(false);
        }
    }, [scope]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            void loadWorkspaces();
        }, 0);
        return () => clearTimeout(timeout);
    }, [loadWorkspaces]);

    async function openWorkspace(id: string) {
        const user = auth.currentUser;
        if (!user) return;
        try {
            const token = await user.getIdToken();
            const response = await fetch(`/api/tradingview/workspaces?id=${encodeURIComponent(id)}&scope=${scope}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const result = await response.json() as { success?: boolean; workspace?: { name?: string; mode?: string; source?: string; nodes?: FlowNode[]; edges?: FlowEdge[] }; error?: string };
            if (!response.ok || !result.success || !result.workspace) {
                setNotice(result.error || "Could not open that workspace.");
                return;
            }
            const loaded = result.workspace;
            setCurrentWorkspaceId(id);
            setName(loaded.name || "Untitled Pine script");
            if (loaded.mode === "code") {
                setSource(loaded.source || "");
                setMode("code");
            } else {
                const loadedNodes: FlowNode[] = loaded.nodes?.length ? loaded.nodes : initialNodes;
                const loadedEdges: FlowEdge[] = loaded.edges?.length ? loaded.edges : initialEdges;
                setNodes(loadedNodes.map((n) => ({
                    id: n.id,
                    type: "pineNode",
                    position: { x: n.x, y: n.y },
                    data: { kind: n.kind, label: n.label, config: n.config, enabled: n.enabled },
                })));
                setEdges(loadedEdges.map((e) => ({
                    id: `e-${e.from}-${e.to}`,
                    source: e.from,
                    target: e.to,
                    ...RF_EDGE_DEF,
                })));
                setMode("visual");
            }
            setNotice(`Opened "${loaded.name || "Untitled Pine script"}".`);
        } catch {
            setNotice("Could not open that workspace.");
        }
    }

    async function deleteWorkspace(id: string, name: string) {
        const user = auth.currentUser;
        if (!user) return;
        try {
            const token = await user.getIdToken();
            const response = await fetch(`/api/tradingview/workspaces?id=${encodeURIComponent(id)}&scope=${scope}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            const result = await response.json() as { success?: boolean; error?: string };
            if (!response.ok || !result.success) {
                setNotice(result.error || "Could not delete the workspace.");
                return;
            }
            setWorkspaces((current) => current.filter((workspace) => workspace.id !== id));
            setNotice(`Deleted "${name}".`);
        } catch {
            setNotice("Could not delete the workspace.");
        }
    }

    const generatedSource = useMemo(() => mode === "visual" ? buildPineFromVisual(flowNodes, flowEdges) : source, [mode, flowNodes, flowEdges, source]);

    const parsePineIndicators = useCallback((pineSource: string): { studies: string[]; detectedNames: string[] } => {
        const detected = new Set<string>();
        const detectedNames = new Set<string>();
        const src = pineSource.toLowerCase();

        // Moving Averages (EMA, SMA, WMA, VWMA, DEMA, TEMA, HMA, RMA)
        if (/ta\.(ema|sma|wma|vwma|dema|tema|hma|rma)\s*\(/.test(src)) {
            detected.add("MASimple@tv-basicstudies");
            detectedNames.add("Moving Average");
        }
        // Also match function-style ma() calls
        if (/\bma\s*\([^)]*\b(sma|ema|rma|wma|vwma|hma)\b/.test(src)) {
            detected.add("MASimple@tv-basicstudies");
            detectedNames.add("Moving Average");
        }

        // RSI
        if (/ta\.rsi\s*\(/.test(src) || /\brsi\b/.test(src)) {
            detected.add("RSI@tv-basicstudies");
            detectedNames.add("RSI");
        }

        // MACD
        if (/ta\.macd\s*\(/.test(src) || /\bmacd\b/.test(src)) {
            detected.add("MACD@tv-basicstudies");
            detectedNames.add("MACD");
        }

        // Bollinger Bands
        if (/ta\.bb\s*\(/.test(src) || /ta\.bbands\s*\(/.test(src) || /\bbollinger\b/.test(src)) {
            detected.add("BB@tv-basicstudies");
            detectedNames.add("Bollinger Bands");
        }

        // Stochastic
        if (/ta\.stoch\s*\(/.test(src) || /\bstoch(?:astic)?\b/.test(src)) {
            detected.add("Stochastic@tv-basicstudies");
            detectedNames.add("Stochastic");
        }

        // ADX
        if (/ta\.adx\s*\(/.test(src) || /\badx\b/.test(src)) {
            detected.add("ADX@tv-basicstudies");
            detectedNames.add("ADX");
        }

        // ATR
        if (/ta\.atr\s*\(/.test(src) || /\batr\b/.test(src)) {
            detected.add("ATR@tv-basicstudies");
            detectedNames.add("ATR");
        }

        // CCI
        if (/ta\.cci\s*\(/.test(src) || /\bcci\b/.test(src)) {
            detected.add("CCI@tv-basicstudies");
            detectedNames.add("CCI");
        }

        // Parabolic SAR
        if (/ta\.psar\s*\(/.test(src) || /\bpsar\b/.test(src) || /\bparabolic\b/.test(src)) {
            detected.add("PSAR@tv-basicstudies");
            detectedNames.add("Parabolic SAR");
        }

        // VWAP
        if (/ta\.vwap\s*\(/.test(src) || /\bvwap\b/.test(src)) {
            detected.add("VWAP@tv-basicstudies");
            detectedNames.add("VWAP");
        }

        // Ichimoku
        if (/ichimoku|tenkan|kijun|senkou|kumo/.test(src)) {
            detected.add("IchimokuCloud@tv-basicstudies");
            detectedNames.add("Ichimoku Cloud");
        }

        // Volume
        if (/\bvolume\b/.test(src)) {
            detected.add("Volume@tv-basicstudies");
            detectedNames.add("Volume");
        }

        // SuperTrend
        if (/\bsupertrend\b/.test(src)) {
            detectedNames.add("SuperTrend");
        }

        // EMA specific
        if (/ta\.ema\s*\(/.test(src)) {
            detected.add("MASimple@tv-basicstudies");
        }

        // Heikin Ashi
        if (/\bheikin\b/.test(src) || /\bha_close\b/.test(src) || /\bha_open\b/.test(src)) {
            detectedNames.add("Heikin Ashi");
        }

        // OBV
        if (/ta\.obv\s*\(/.test(src) || /\bobv\b/.test(src)) {
            detectedNames.add("OBV");
        }

        // MFI
        if (/ta\.mfi\s*\(/.test(src) || /\bmfi\b/.test(src)) {
            detectedNames.add("MFI");
        }

        // Williams %R
        if (/ta\.r\s*\(/.test(src) || /\bwilliams\b/.test(src)) {
            detectedNames.add("Williams %R");
        }

        // ROC
        if (/ta\.roc\s*\(/.test(src) || /\broc\b/.test(src)) {
            detectedNames.add("ROC");
        }

        // Momentum
        if (/ta\.mom\s*\(/.test(src) || /\bmomentum\b/.test(src)) {
            detectedNames.add("Momentum");
        }

        // VWMA
        if (/ta\.vwma\s*\(/.test(src)) {
            detectedNames.add("VWMA");
        }

        // Hull MA
        if (/ta\.hma\s*\(/.test(src)) {
            detectedNames.add("Hull MA");
        }

        return { studies: Array.from(detected), detectedNames: Array.from(detectedNames) };
    }, []);

    const chartStudies = useMemo(() => {
        if (mode === "code") {
            return parsePineIndicators(source).studies;
        }
        const kinds = new Set(flowNodes.map((node) => node.kind));
        return [
            ...(kinds.has("moving_average") ? ["MASimple@tv-basicstudies"] : []),
            ...(kinds.has("rsi") ? ["RSI@tv-basicstudies"] : []),
            ...(kinds.has("macd") ? ["MACD@tv-basicstudies"] : []),
            ...(kinds.has("bollinger") ? ["BB@tv-basicstudies"] : []),
            ...(kinds.has("stochastic") ? ["Stochastic@tv-basicstudies"] : []),
            ...(kinds.has("adx") ? ["ADX@tv-basicstudies"] : []),
            ...(kinds.has("atr") ? ["ATR@tv-basicstudies"] : []),
            ...(kinds.has("cci") ? ["CCI@tv-basicstudies"] : []),
            ...(kinds.has("psar") ? ["PSAR@tv-basicstudies"] : []),
            ...(kinds.has("vwap") ? ["VWAP@tv-basicstudies"] : []),
            ...(kinds.has("volume") ? ["Volume@tv-basicstudies"] : []),
            ...(kinds.has("ichimoku") ? ["IchimokuCloud@tv-basicstudies"] : []),
        ];
    }, [mode, flowNodes, source, parsePineIndicators]);

    const [chartKey, setChartKey] = useState(0);
    const [appliedStudies, setAppliedStudies] = useState<string[]>([]);
    // Real-candle chart state: symbol/timeframe selection + overlay layers
    // shared with the Pro Scalping Terminal chart engine.
    const [chartSymbol, setChartSymbol] = useState<SupportedSymbol>("XAUUSD");
    const [chartTimeframe, setChartTimeframe] = useState<"M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1">("M15");
    // Initial layer map (current values — workspace owns its own per-symbol
    // persistence, so this is the seed only).
    const [chartLayers] = useState(defaultLayerState);
    // Pine study overlays computed from the real chart candles (plots, hlines,
    // plotshapes) — rendered by the Pro Terminal chart engine.
    const [studyOverlay, setStudyOverlay] = useState<PineStudyOverlay | null>(null);
    // Candles the chart fetched from /api/analytics/ohlc — the Pine runtime
    // runs against these same bars so overlays align 1:1 with what is drawn.
    const chartCandlesRef = useRef<Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume?: number }>>([]);
    const [chartCandlesVersion, setChartCandlesVersion] = useState(0);
    const [useRealChart, setUseRealChart] = useState(true);
    const [authToken, setAuthToken] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const user = auth.currentUser;
            if (!user) return;
            try {
                const t = await user.getIdToken();
                if (!cancelled) setAuthToken(t);
            } catch { /* anonymous use of the public OHLC feed still works */ }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const analyzeScript = useCallback(() => {
        setIsAnalyzing(true);
        setShowAnalysis(true);
        try {
            const result = executePine(source, []);
            setPineResult(result);
        } catch {
            setPineResult(null);
        } finally {
            setIsAnalyzing(false);
        }
    }, [source]);

    function applyToChart() {
        setAppliedStudies(chartStudies);
        // Execute the generated script against the chart's real candles via
        // the shared runtime, then draw its plots/hlines/shapes on the
        // terminal chart. The projection is what the chart renders — no
        // separate indicator re-implementation on the UI side.
        const candles = chartCandlesRef.current;
        const overlay = buildPineStudyOverlay(
            executePine(generatedSource, toPineCandles(candles.map((c) => ({ ...c, volume: c.volume ?? 0 })))),
            candles.length
        );
        setStudyOverlay(overlay);
        setChartKey((k) => k + 1);
        const applied = overlay.lines.length + overlay.levels.length + overlay.shapes.length > 0
            ? `${overlay.lines.length} plot${overlay.lines.length !== 1 ? "s" : ""}, ${overlay.levels.length} hline${overlay.levels.length !== 1 ? "s" : ""}, ${overlay.shapes.length} shape${overlay.shapes.length !== 1 ? "s" : ""}`
            : "no drawable output";
        setNotice(`Applied to chart — ${applied}.`);
    }

    // Re-apply the study overlay automatically when the applied script or the
    // chart's candles change, so overlays always run on the displayed bars.
    // Runs once the script has been applied at least once (studyOverlay set).
    useEffect(() => {
        if (!studyOverlay) return;
        const candles = chartCandlesRef.current;
        if (candles.length === 0) return;
        const overlay = buildPineStudyOverlay(
            executePine(generatedSource, toPineCandles(candles.map((c) => ({ ...c, volume: c.volume ?? 0 })))),
            candles.length
        );
        setStudyOverlay(overlay);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chartCandlesVersion, appliedStudies]);

    async function handleBacktest() {
        const user = auth.currentUser;
        if (!user) { setNotice("Sign in to run a backtest."); return; }
        try {
            setIsBacktestLoading(true);
            setNotice("Running Pine backtest...");
            const token = await user.getIdToken();
            const res = await fetch("/api/pine-backtest", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    source: generatedSource,
                    symbol: "FX:EURUSD",
                    timeframe: "H1",
                }),
            });
            const data = await res.json();
            if (data.success && data.backtest) {
                setBacktestResult(data.backtest);
                setNotice(`Backtest complete: ${data.backtest.metrics.totalTrades} trades | Net P&L: ${data.backtest.metrics.netProfit?.toFixed(2)} | Win rate: ${data.backtest.metrics.winRate?.toFixed(1)}%`);
            } else {
                setNotice("Backtest failed: " + (data.error || "Unknown error"));
            }
        } catch {
            setNotice("Could not run backtest. Please try again.");
        } finally {
            setIsBacktestLoading(false);
        }
    }

    function handleReplay() {
        setMode("replay");
        setNotice("Replay mode — use the controls below to replay bar-by-bar.");
    }

    function handleCreateAlert() {
        const user = auth.currentUser;
        if (!user) {
            setNotice("Sign in to create alerts.");
            return;
        }
        setIsAlertDialogOpen(true);
    }

    async function handleAiBuildStrategy() {
        if (!aiDescription.trim()) { setNotice("Enter a strategy description first."); return; }
        setIsAiBuilding(true);
        setNotice("AI is building your strategy...");
        try {
            const res = await fetch("/api/ai-pine", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "build-strategy", description: aiDescription }),
            });
            const data = await res.json();
            if (data.success && data.nodes?.length) {
                const aiNodes: FlowNode[] = data.nodes;
                const aiEdges: FlowEdge[] = data.edges || [];
                setNodes(aiNodes.map((n: FlowNode) => ({
                    id: n.id,
                    type: "pineNode",
                    position: { x: n.x ?? 300, y: n.y ?? 200 },
                    data: { kind: n.kind, label: n.label, config: n.config, enabled: n.enabled },
                })));
                setEdges(aiEdges.map((e: FlowEdge) => ({
                    id: `e-${e.from}-${e.to}`,
                    source: e.from,
                    target: e.to,
                    ...RF_EDGE_DEF,
                })));
                setName(data.name || aiDescription.slice(0, 50));
                setAiStrategyDescription(data.description || `Built ${data.nodes.length} nodes: ${data.nodes.map((n: { kind: string }) => n.kind.replace(/_/g, " ")).join(", ")}`);
                setAiDescription("");
                setNotice(`AI built "${data.name}" with ${data.nodes.length} nodes.`);
            } else {
                setNotice("AI could not build the strategy: " + (data.error || "Invalid response"));
            }
        } catch {
            setNotice("AI request failed.");
        } finally {
            setIsAiBuilding(false);
        }
    }

    async function handleAiFixCode() {
        if (!source.trim()) { setNotice("No code to fix."); return; }
        setIsAiFixing(true);
        setNotice("AI is analyzing and fixing your code...");
        try {
            const res = await fetch("/api/ai-pine", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "fix-code", source, errors: pineResult?.errors }),
            });
            const data = await res.json();
            if (data.success && data.fixedCode) {
                setSource(data.fixedCode);
                setNotice("AI fixed your code. Click Analyze to verify.");
            } else {
                setNotice("AI could not fix the code: " + (data.error || "No fix available"));
            }
        } catch {
            setNotice("AI request failed. Check your AI_API_KEY configuration.");
        } finally {
            setIsAiFixing(false);
        }
    }

    async function handleAiDescribe() {
        if (!source.trim()) { setNotice("No code to describe."); return; }
        setIsAiDescribing(true);
        try {
            const res = await fetch("/api/ai-pine", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "describe", source }),
            });
            const data = await res.json();
            if (data.success) {
                const desc = data.description || data.name || "Strategy analyzed by AI";
                setAiStrategyDescription(typeof desc === "string" ? desc : JSON.stringify(desc));
                setNotice("AI analyzed your strategy.");
            }
        } catch {
            setNotice("AI description failed.");
        } finally {
            setIsAiDescribing(false);
        }
    }

    const onConnect = useCallback((connection: Connection) => {
        if (!connection.source || !connection.target) return;
        setEdges((eds) => addEdge({ ...connection, ...RF_EDGE_DEF }, eds));
    }, [setEdges]);

    const onDrop = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const dataStr = event.dataTransfer.getData("text/plain") || event.dataTransfer.getData("application/node-type");
            if (!dataStr) return;
            const kind = (dataStr.startsWith("node:") || dataStr.startsWith("palette:") ? dataStr.replace(/^(node|palette):/, "") : dataStr) as NodeKind;
            if (!nodeTypes[kind]) return;

            const bounds = event.currentTarget.getBoundingClientRect();
            const position = {
                x: Math.max(20, event.clientX - bounds.left - 88),
                y: Math.max(20, event.clientY - bounds.top - 40),
            };

            const id = `${kind}_${Date.now().toString(36)}`;
            const newNode: Node = {
                id,
                type: "pineNode",
                position,
                data: { kind, label: nodeTypes[kind]?.label || kind, enabled: true },
            };

            setNodes((nds) => nds.concat(newNode));
            selectNode(id);
        },
        [selectNode, setNodes]
    );

    const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    }, []);

    const addNode = useCallback((kind: NodeKind, x = 300, y = 150) => {
        const id = `${kind}_${Date.now().toString(36)}`;
        const newNode: Node = {
            id,
            type: "pineNode",
            position: { x, y },
            data: { kind, label: nodeTypes[kind]?.label || kind, enabled: true },
        };
        setNodes((nds) => nds.concat(newNode));
        selectNode(id);
    }, [selectNode, setNodes]);

    const removeNode = useCallback((id: string) => {
        setNodes((nds) => nds.filter((n) => n.id !== id));
        setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
        if (selectedNodeId === id) selectNode(null);
    }, [selectedNodeId, selectNode, setEdges, setNodes]);

    async function saveWorkspace() {
        const user = auth.currentUser;
        if (!user) {
            setNotice("Please sign in before saving.");
            return;
        }
        setSaving(true);
        try {
            const token = await user.getIdToken();
            const response = await fetch("/api/tradingview/workspaces", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    name: name.trim() || "Untitled Pine script",
                    source: generatedSource,
                    mode: mode === "replay" ? "code" : mode,
                    nodes: flowNodes,
                    edges: flowEdges,
                    type: generatedSource.includes("strategy(") ? "strategy" : "indicator",
                    scope,
                }),
            });
            const result = await response.json() as { success?: boolean; error?: string };
            if (!response.ok || !result.success) throw new Error(result.error || "Unable to save the workspace.");
            setNotice("Saved to your Trading workspace.");
            loadWorkspaces();
        } catch (error) {
            setNotice(error instanceof Error ? error.message : "Could not save this workspace.");
        } finally {
            setSaving(false);
        }
    }

    function downloadWorkspace() {
        const file = new Blob([generatedSource], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${name.trim().replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "pine-script"}.txt`;
        link.click();
        URL.revokeObjectURL(url);
    }

    async function copyPineSource() {
        try {
            await navigator.clipboard.writeText(generatedSource);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2_000);
        } catch {
            setNotice("Could not copy the Pine source.");
        }
    }

    const selectedNode = useMemo(() => {
        if (!selectedNodeId) return null;
        const n = nodes.find((node) => node.id === selectedNodeId);
        if (!n) return null;
        return {
            id: n.id,
            kind: (n.data?.kind as NodeKind) || "moving_average",
            x: n.position.x,
            y: n.position.y,
            label: (n.data?.label as string) || undefined,
            config: (n.data?.config as Record<string, any>) || undefined,
            enabled: n.data?.enabled !== false,
        };
    }, [nodes, selectedNodeId]);

    const filteredNodeKinds = useMemo(() => {
        const query = librarySearch.toLowerCase().trim();
        return (Object.keys(nodeTypes) as NodeKind[]).filter((kind) => {
            if (!query) return true;
            return nodeTypes[kind].label.toLowerCase().includes(query) || nodeHint(kind).toLowerCase().includes(query);
        });
    }, [librarySearch]);

    const filteredWorkspaces = useMemo(() => {
        const query = workspaceSearch.toLowerCase().trim();
        return workspaces.filter((ws) => !query || ws.name.toLowerCase().includes(query));
    }, [workspaces, workspaceSearch]);

    const updateNodeLabel = useCallback((id: string, label: string) => {
        setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data: { ...n.data, label } } : n));
    }, [setNodes]);

    const updateNodeEnabled = useCallback((id: string, enabled: boolean) => {
        setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data: { ...n.data, enabled } } : n));
    }, [setNodes]);

    const updateNodeConfig = useCallback((id: string, key: string, val: any) => {
        setNodes((nds) => nds.map((n) => {
            if (n.id !== id) return n;
            const currentConfig = (n.data?.config as Record<string, any>) || {};
            return { ...n, data: { ...n.data, config: { ...currentConfig, [key]: val } } };
        }));
    }, [setNodes]);

    const duplicateNode = useCallback((id: string) => {
        const n = nodes.find((x) => x.id === id);
        if (!n) return;
        const kind = (n.data?.kind as NodeKind) || "moving_average";
        const newId = `${kind}_${Date.now().toString(36)}`;
        const newNode: Node = {
            id: newId,
            type: "pineNode",
            position: { x: n.position.x + 30, y: n.position.y + 30 },
            data: { ...n.data },
        };
        setNodes((nds) => nds.concat(newNode));
        selectNode(newId);
    }, [nodes, selectNode, setNodes]);

    return (
        <ProGate>
            <section className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
            {/* Left Sidebar Dock with Library, Saved Workspaces, and Node Inspector */}
            <aside data-guide="palette" className="self-start rounded-lg border border-border bg-card p-3.5 space-y-3 shadow-xs">
                {/* Navigation Tabs Header */}
                <div className="flex items-center gap-1 p-1 bg-muted/60 rounded-lg border border-border text-xs font-semibold">
                    <button
                        type="button"
                        onClick={() => setSidebarTab("library")}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1 ${
                            sidebarTab === "library" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                        }`}
                        title="Node Library"
                    >
                        <Plus size={13} className="text-warning shrink-0" />
                        <span className="truncate">Library</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setSidebarTab("workspaces")}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1 ${
                            sidebarTab === "workspaces" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                        }`}
                        title="Saved Workspaces"
                    >
                        <FolderOpen size={13} className="text-warning shrink-0" />
                        <span className="truncate">Saved ({workspaces.length})</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setSidebarTab("inspector")}
                        className={`py-1.5 px-2.5 rounded-lg text-center transition flex items-center justify-center gap-1 relative ${
                            sidebarTab === "inspector" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                        }`}
                        title="Node Inspector"
                    >
                        <Settings2 size={13} className={selectedNodeId ? "text-warning animate-pulse shrink-0" : "shrink-0"} />
                        {selectedNodeId && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-warning" />}
                    </button>
                </div>

                {/* Tab 1: Node Library */}
                {sidebarTab === "library" && (
                    <div className="space-y-3">
                        <div className="relative">
                            <Search size={13} className="absolute left-2.5 top-2.5 text-muted-foreground" />
                            <Input
                                value={librarySearch}
                                onChange={(e) => setLibrarySearch(e.target.value)}
                                placeholder="Search nodes..."
                                className="h-8 text-xs pl-8 bg-background border-border rounded-lg"
                            />
                        </div>
                        <div className="space-y-1.5 max-h-[440px] overflow-y-auto pr-0.5 font-sans">
                            {filteredNodeKinds.map((kind) => (
                                <Tooltip key={kind}>
                                    <TooltipTrigger render={
                                        <button
                                            draggable
                                            onDragStart={(event) => event.dataTransfer.setData("text/plain", `palette:${kind}`)}
                                            onClick={() => addNode(kind)}
                                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs bg-muted/30 hover:bg-warning/10 border border-transparent hover:border-warning/20 text-foreground transition flex items-center gap-2 group"
                                        >
                                            <Plus size={13} className="text-warning shrink-0 group-hover:scale-110 transition-transform" />
                                            <span className="truncate font-medium flex-1">{nodeTypes[kind].label}</span>
                                        </button>
                                    } />
                                    <TooltipContent>{nodeHint(kind)} — click or drag to add.</TooltipContent>
                                </Tooltip>
                            ))}
                        </div>
                        <Tooltip>
                            <TooltipTrigger render={
                                <button
                                    onClick={() => { setNodes([]); setEdges([]); selectNode(null); }}
                                    className="w-full mt-2 inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition py-1.5 rounded-lg border border-dashed border-border/80 hover:border-destructive/30"
                                >
                                    <Trash2 size={13} />Clear canvas
                                </button>
                            } />
                            <TooltipContent>Remove every node and connection from the canvas.</TooltipContent>
                        </Tooltip>
                    </div>
                )}

                {/* Tab 2: Saved Workspaces (Styled like Library) */}
                {sidebarTab === "workspaces" && (
                    <div className="space-y-3">
                        <div className="relative">
                            <Search size={13} className="absolute left-2.5 top-2.5 text-muted-foreground" />
                            <Input
                                value={workspaceSearch}
                                onChange={(e) => setWorkspaceSearch(e.target.value)}
                                placeholder="Search saved..."
                                className="h-8 text-xs pl-8 bg-background border-border rounded-lg"
                            />
                        </div>
                        <div className="space-y-2 max-h-[440px] overflow-y-auto pr-0.5 font-sans">
                            {loadingWorkspaces ? (
                                <p className="text-xs text-muted-foreground text-center py-4">Loading workspaces...</p>
                            ) : filteredWorkspaces.length === 0 ? (
                                <div className="text-center py-6 px-2 rounded-lg border border-dashed border-border">
                                    <FolderOpen size={20} className="mx-auto text-muted-foreground/60 mb-1.5" />
                                    <p className="text-xs text-muted-foreground font-medium">No saved workspaces found</p>
                                    <p className="text-micro text-muted-foreground/70 mt-0.5">Build a strategy and click Save</p>
                                </div>
                            ) : (
                                filteredWorkspaces.map((workspace) => (
                                    <div
                                        key={workspace.id}
                                        className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2.5 transition hover:border-warning/30 hover:bg-muted/40 shadow-xs"
                                    >
                                        <div className="flex items-center justify-between gap-1.5 min-w-0">
                                            <p className="truncate text-xs font-semibold text-foreground flex-1">{workspace.name}</p>
                                            <span className="px-1.5 py-0.5 rounded-md text-micro font-bold uppercase tracking-wider bg-warning/10 text-warning border border-warning/20">
                                                {workspace.type}
                                            </span>
                                        </div>
                                        <p className="text-micro text-muted-foreground font-numeric">
                                            Saved: {new Date(workspace.createdAt).toLocaleDateString()}
                                        </p>
                                        <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/50">
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                onClick={() => openWorkspace(workspace.id)}
                                                className="h-7 text-micro font-semibold px-2.5 rounded-lg"
                                            >
                                                Open
                                            </Button>
                                            <button
                                                onClick={() => deleteWorkspace(workspace.id, workspace.name)}
                                                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted transition flex items-center justify-center"
                                                title={`Delete ${workspace.name}`}
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* Tab 3: Node Inspector Panel */}
                {sidebarTab === "inspector" && (
                    <div className="space-y-3">
                        {selectedNode ? (
                            <div className="space-y-3 font-sans">
                                {/* Header */}
                                <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <Input
                                            value={selectedNode.label || nodeTypes[selectedNode.kind].label}
                                            onChange={(e) => updateNodeLabel(selectedNode.id, e.target.value)}
                                            className="h-7 text-xs font-semibold border-none bg-transparent px-0 focus-visible:ring-0 text-foreground"
                                            placeholder="Node Label"
                                        />
                                        <button
                                            onClick={() => selectNode(null)}
                                            className="text-muted-foreground hover:text-foreground shrink-0 p-1 rounded-md hover:bg-muted transition-colors"
                                            title="Deselect"
                                        >
                                            <X size={13} />
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-micro">
                                        <span className="px-2 py-0.5 rounded-full bg-warning/10 border border-warning/20 text-warning font-bold uppercase tracking-wider">
                                            {selectedNode.kind.replace(/_/g, " ")}
                                        </span>
                                    </div>
                                    <p className="text-micro text-muted-foreground leading-relaxed flex items-start gap-1">
                                        <Info size={11} className="shrink-0 mt-0.5 text-info" />
                                        {nodeHint(selectedNode.kind)}
                                    </p>
                                </div>

                                {/* Node Status Toggle */}
                                <div className="rounded-lg border border-border bg-background p-3 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                            <Layers size={13} className="text-muted-foreground" /> Node Status
                                        </span>
                                        <label className="inline-flex cursor-pointer items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={selectedNode.enabled !== false}
                                                onChange={(e) => updateNodeEnabled(selectedNode.id, e.target.checked)}
                                                className="rounded accent-warning h-4 w-4"
                                            />
                                            <span className="text-xs text-muted-foreground">{selectedNode.enabled !== false ? "Active" : "Disabled"}</span>
                                        </label>
                                    </div>
                                </div>

                                {/* Node Specific Parameters */}
                                {(selectedNode.kind === "moving_average" || selectedNode.kind === "hma" || selectedNode.kind === "rsi" || selectedNode.kind === "macd" || selectedNode.kind === "bollinger" || selectedNode.kind === "keltner" || selectedNode.kind === "donchian" || selectedNode.kind === "supertrend" || selectedNode.kind === "stochastic" || selectedNode.kind === "adx" || selectedNode.kind === "atr" || selectedNode.kind === "cci" || selectedNode.kind === "mfi" || selectedNode.kind === "williams_r" || selectedNode.kind === "roc" || selectedNode.kind === "stddev" || selectedNode.kind === "risk_manager" || selectedNode.kind.includes("oversold") || selectedNode.kind.includes("overbought")) && (
                                    <div className="rounded-lg border border-border bg-background p-3 space-y-2.5">
                                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                            <Sliders size={13} className="text-muted-foreground" /> Parameters
                                        </span>

                                        {(selectedNode.kind === "moving_average" || selectedNode.kind === "hma" || selectedNode.kind === "rsi" || selectedNode.kind === "bollinger" || selectedNode.kind === "keltner" || selectedNode.kind === "donchian" || selectedNode.kind === "adx" || selectedNode.kind === "atr" || selectedNode.kind === "cci" || selectedNode.kind === "mfi" || selectedNode.kind === "williams_r" || selectedNode.kind === "roc" || selectedNode.kind === "stddev") && (
                                            <div className="space-y-1">
                                                <label className="text-micro font-medium text-muted-foreground">Period / Length</label>
                                                <Input
                                                    type="number"
                                                    value={selectedNode.config?.length ?? (selectedNode.kind === "rsi" || selectedNode.kind === "mfi" || selectedNode.kind === "williams_r" ? 14 : selectedNode.kind === "hma" ? 9 : selectedNode.kind === "roc" ? 12 : 20)}
                                                    onChange={(e) => updateNodeConfig(selectedNode.id, "length", Number(e.target.value))}
                                                    className="h-8 text-xs bg-background"
                                                />
                                            </div>
                                        )}

                                        {selectedNode.kind === "supertrend" && (
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1">
                                                    <label className="text-micro font-medium text-muted-foreground">ATR Period</label>
                                                    <Input
                                                        type="number"
                                                        value={selectedNode.config?.atrPeriod ?? 10}
                                                        onChange={(e) => updateNodeConfig(selectedNode.id, "atrPeriod", Number(e.target.value))}
                                                        className="h-8 text-xs bg-background"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-micro font-medium text-muted-foreground">Factor</label>
                                                    <Input
                                                        type="number"
                                                        step="0.5"
                                                        value={selectedNode.config?.factor ?? 3.0}
                                                        onChange={(e) => updateNodeConfig(selectedNode.id, "factor", Number(e.target.value))}
                                                        className="h-8 text-xs bg-background"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {selectedNode.kind === "macd" && (
                                            <div className="grid grid-cols-3 gap-1.5">
                                                <div className="space-y-1">
                                                    <label className="text-micro font-medium text-muted-foreground">Fast</label>
                                                    <Input
                                                        type="number"
                                                        value={selectedNode.config?.fast ?? 12}
                                                        onChange={(e) => updateNodeConfig(selectedNode.id, "fast", Number(e.target.value))}
                                                        className="h-8 text-xs bg-background"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-micro font-medium text-muted-foreground">Slow</label>
                                                    <Input
                                                        type="number"
                                                        value={selectedNode.config?.slow ?? 26}
                                                        onChange={(e) => updateNodeConfig(selectedNode.id, "slow", Number(e.target.value))}
                                                        className="h-8 text-xs bg-background"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-micro font-medium text-muted-foreground">Signal</label>
                                                    <Input
                                                        type="number"
                                                        value={selectedNode.config?.signal ?? 9}
                                                        onChange={(e) => updateNodeConfig(selectedNode.id, "signal", Number(e.target.value))}
                                                        className="h-8 text-xs bg-background"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {selectedNode.kind === "risk_manager" && (
                                            <div className="space-y-2">
                                                <div className="space-y-1">
                                                    <label className="text-micro font-medium text-muted-foreground">Stop Loss %</label>
                                                    <Input
                                                        type="number"
                                                        step="0.1"
                                                        value={selectedNode.config?.stopLossPct ?? 1.0}
                                                        onChange={(e) => updateNodeConfig(selectedNode.id, "stopLossPct", Number(e.target.value))}
                                                        className="h-8 text-xs bg-background"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-micro font-medium text-muted-foreground">Take Profit %</label>
                                                    <Input
                                                        type="number"
                                                        step="0.1"
                                                        value={selectedNode.config?.takeProfitPct ?? 3.0}
                                                        onChange={(e) => updateNodeConfig(selectedNode.id, "takeProfitPct", Number(e.target.value))}
                                                        className="h-8 text-xs bg-background"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="flex items-center gap-2 pt-1">
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        onClick={() => duplicateNode(selectedNode.id)}
                                        className="flex-1 h-8 text-xs"
                                    >
                                        <Copy size={12} className="mr-1" /> Duplicate
                                    </Button>
                                    <Button
                                        size="xs"
                                        variant="destructive"
                                        onClick={() => { removeNode(selectedNode.id); selectNode(null); }}
                                        className="h-8 text-xs"
                                    >
                                        <Trash2 size={12} className="mr-1" /> Delete
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-8 px-2 rounded-lg border border-dashed border-border font-sans">
                                <Settings2 size={24} className="mx-auto text-muted-foreground/60 mb-2" />
                                <p className="text-xs font-semibold text-foreground">No Node Selected</p>
                                <p className="text-micro text-muted-foreground/70 mt-1 max-w-[180px] mx-auto">
                                    Click any node on the canvas to inspect and edit its parameters.
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </aside>

            <div className="min-w-0 rounded-lg border border-border bg-card p-4 space-y-4">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Input value={name} onChange={(event) => setName(event.target.value)} className="w-full font-semibold text-sm h-9 bg-background sm:w-72" aria-label="Pine script name" title="Name for this Pine workspace" />
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="flex flex-wrap gap-1 bg-muted p-1 rounded-lg border border-border" data-guide="modes">
                                <button onClick={() => setMode("visual")} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${mode === "visual" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}>Visual</button>
                                <button onClick={() => setMode("code")} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${mode === "code" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}>Code</button>
                                <button onClick={() => setMode("replay")} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${mode === "replay" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}>Replay</button>
                            </div>
                            <div className="h-4 w-px bg-border hidden sm:block" />
                            <div className="flex flex-wrap gap-1.5" data-guide="actions">
                                <Button size="sm" className="bg-warning hover:bg-warning text-background" onClick={saveWorkspace} disabled={saving}><Save size={14} className="mr-1" />{saving ? "Saving" : "Save"}</Button>
                                <Button size="sm" variant="outline" onClick={downloadWorkspace}><Download size={14} className="mr-1" />Download</Button>
                            </div>
                        </div>
                    </div>
                    {mode === "visual" && (
                        <div className="rounded-lg border border-warning/20 bg-warning-muted p-4" data-guide="ai-builder">
                            <div className="flex items-center gap-2">
                                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-warning/10">
                                    <Brain size={14} className="text-warning" />
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-foreground">AI Strategy Builder</p>
                                    <p className="text-micro text-muted-foreground">Describe it, AI builds it</p>
                                </div>
                            </div>
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                <Input
                                    value={aiDescription}
                                    onChange={(e) => setAiDescription(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleAiBuildStrategy()}
                                    placeholder="e.g. Buy when EMA crosses above RSI below 70, with 1% SL and 3% TP"
                                    className="flex-1 text-xs h-9 bg-background"
                                />
                                <Button
                                    onClick={handleAiBuildStrategy}
                                    disabled={isAiBuilding || !aiDescription.trim()}
                                    className="bg-warning hover:bg-warning text-background font-semibold text-xs h-9 px-4"
                                >
                                    {isAiBuilding ? <Loader2 size={14} className="animate-spin mr-1" /> : <Wand2 size={14} className="mr-1" />}
                                    {isAiBuilding ? "Building..." : "Build"}
                                </Button>
                            </div>
                            {aiStrategyDescription && (
                                <div className="mt-3 rounded-lg border border-border bg-background/80 p-2.5">
                                    <p className="text-micro leading-relaxed text-muted-foreground">{aiStrategyDescription}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                {mode === "visual" || mode === "replay" ? (
                    <div
                        data-guide="canvas"
                        onDragOver={onDragOver}
                        onDrop={onDrop}
                        className="relative mt-4 min-h-[580px] h-[600px] w-full rounded-lg border border-border bg-background overflow-hidden"
                        aria-label="Visual Pine strategy builder"
                    >
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            onConnect={onConnect}
                            nodeTypes={rfNodeTypes}
                            edgeTypes={rfEdgeTypes}
                            onNodeClick={(_e, n) => selectNode(n.id)}
                            onPaneClick={() => selectNode(null)}
                            onEdgeClick={(_e) => selectNode(null)}
                            fitView
                            deleteKeyCode="Delete"
                            snapToGrid
                            snapGrid={[16, 16]}
                            minZoom={0.2}
                            maxZoom={2.5}
                            defaultEdgeOptions={RF_EDGE_DEF}
                            connectionLineStyle={{ stroke: "var(--chart-1)", strokeWidth: 2, strokeDasharray: "6 3" }}
                            className="bg-background"
                        >
                            <Background color="#334155" gap={24} size={1.2} />
                            <Controls className="!bg-card !border-border !fill-foreground" />
                            <MiniMap
                                nodeStrokeWidth={3}
                                zoomable
                                pannable
                                maskColor="rgba(0, 0, 0, 0.6)"
                                className="!bg-card !border-border"
                            />
                        </ReactFlow>
                    </div>
                ) : (
                    <div className="mt-4 space-y-4">
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-xs flex-wrap" data-guide="code-toolbar">
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-xs font-semibold text-foreground">Pine Script Editor</span>
                                {appliedStudies.length > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 border border-positive/20 px-2.5 py-0.5 text-micro font-medium text-positive">
                                        <Check size={11} />
                                        {appliedStudies.length} applied
                                    </span>
                                )}
                                {pineResult && pineResult.errors.length === 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 border border-positive/20 px-2.5 py-0.5 text-micro font-medium text-positive">
                                        <Check size={11} />
                                        Runtime compatible
                                    </span>
                                )}
                                {pineResult && pineResult.errors.length > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-negative/10 border border-negative/20 px-2.5 py-0.5 text-micro font-medium text-negative">
                                        <AlertTriangle size={11} />
                                        {pineResult.errors.length} error{pineResult.errors.length !== 1 ? "s" : ""}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-micro font-numeric text-muted-foreground">v6</span>
                                <Tooltip>
                                    <TooltipTrigger render={
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={analyzeScript}
                                            disabled={isAnalyzing}
                                        >
                                            {isAnalyzing ? <Loader2 size={13} className="animate-spin mr-1" /> : <BarChart3 size={13} className="mr-1" />}
                                            Analyze
                                        </Button>
                                    } />
                                    <TooltipContent>Analyze your Pine script for compatibility and features.</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger render={
                                        <Button
                                            size="sm"
                                            className="bg-warning hover:bg-warning text-background font-medium"
                                            onClick={applyToChart}
                                        >
                                            <Play size={13} className="mr-1" />
                                            Apply to Chart
                                        </Button>
                                    } />
                                    <TooltipContent>Parse indicators from your Pine code and apply them to the chart below.</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger render={
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={handleCreateAlert}
                                        >
                                            <Bell size={13} className="mr-1" />
                                            Create Alert
                                        </Button>
                                    } />
                                    <TooltipContent>Create a TradingView alert for this Pine script with webhook &amp; notification options.</TooltipContent>
                                </Tooltip>
                                {pineResult && pineResult.errors.length > 0 && (
                                    <Tooltip>
                                        <TooltipTrigger render={
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={handleAiFixCode}
                                                disabled={isAiFixing}
                                                className="border-warning/40 text-warning hover:bg-warning/10"
                                            >
                                                {isAiFixing ? <Loader2 size={13} className="animate-spin mr-1" /> : <Sparkles size={13} className="mr-1" />}
                                                {isAiFixing ? "Fixing..." : "AI Fix"}
                                            </Button>
                                        } />
                                        <TooltipContent>Use AI to automatically fix errors in your Pine script.</TooltipContent>
                                    </Tooltip>
                                )}
                                <Tooltip>
                                    <TooltipTrigger render={
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={handleAiDescribe}
                                            disabled={isAiDescribing}
                                        >
                                            {isAiDescribing ? <Loader2 size={13} className="animate-spin mr-1" /> : <Brain size={13} className="mr-1" />}
                                            {isAiDescribing ? "Describing..." : "Describe"}
                                        </Button>
                                    } />
                                    <TooltipContent>AI will describe what your Pine script does.</TooltipContent>
                                </Tooltip>
                            </div>
                        </div>
                        <textarea
                            value={source}
                            onChange={(event) => setSource(event.target.value)}
                            spellCheck={false}
                            className="h-[480px] w-full resize-y rounded-lg border border-border bg-background p-4 font-numeric text-xs leading-relaxed outline-none transition focus:border-warning/50 focus:ring-2 focus:ring-warning/20 shadow-xs"
                            aria-label="Pine Script editor"
                            placeholder="// Write your Pine Script v6 code here...&#10;// Click Analyze to check compatibility&#10;// Click Apply to Chart to visualize&#10;&#10;//@version=6&#10;indicator(&#10;    &quot;My Indicator&quot;,&#10;    overlay=true&#10;)&#10;&#10;ema20 = ta.ema(close, 20)&#10;plot(ema20, color=color.blue)"
                        />
                        {showAnalysis && (
                            <div className="mt-4">
                                {isAnalyzing ? (
                                    <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 shadow-xs">
                                        <Loader2 size={16} className="animate-spin text-warning" />
                                        <span className="text-xs text-muted-foreground">Analyzing Pine script...</span>
                                    </div>
                                ) : pineResult ? (
                                    <PineAnalysisPanel
                                        source={source}
                                        onApply={applyToChart}
                                        onBacktest={handleBacktest}
                                        onReplay={handleReplay}
                                        onAlert={handleCreateAlert}
                                        isBacktestLoading={isBacktestLoading}
                                        backtestResult={backtestResult}
                                    />
                                ) : null}
                            </div>
                        )}
                        {pineResult && pineResult.errors.length > 0 && (
                            <div className="rounded-lg border border-negative/20 bg-negative/5 p-4 shadow-xs">
                                <div className="flex items-start gap-2.5">
                                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-negative" />
                                    <div>
                                        <p className="text-xs font-semibold text-negative">Pine Runtime Errors</p>
                                        <div className="mt-1 space-y-1">
                                            {pineResult.errors.map((err, i) => (
                                                <p key={i} className="text-micro leading-relaxed text-muted-foreground font-numeric">{err}</p>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {pineResult && pineResult.plots.length > 0 && (
                            <div className="flex flex-wrap gap-2 text-micro text-muted-foreground px-1">
                                <span>Plots: {pineResult.plots.length}</span>
                                {pineResult.hlines.length > 0 && <span>· Hlines: {pineResult.hlines.length}</span>}
                                {pineResult.alerts.length > 0 && <span>· Alerts: {pineResult.alerts.length}</span>}
                                {pineResult.strategy && <span className="text-warning font-medium">· Strategy active</span>}
                            </div>
                        )}
                        {aiStrategyDescription && (
                            <div className="rounded-lg border border-warning/20 bg-warning/5 p-4 shadow-xs">
                                <div className="flex items-start gap-2.5">
                                    <Brain size={15} className="mt-0.5 shrink-0 text-warning" />
                                    <div>
                                        <p className="text-xs font-semibold text-warning">AI Analysis</p>
                                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{aiStrategyDescription}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                <div className="mt-4 rounded-lg border border-border bg-card overflow-hidden shadow-xs p-1" data-guide="chart">
                    {/* Real-candle chart toolbar: symbol, timeframe, overlays, engine */}
                    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-2">
                        <select
                            value={chartSymbol}
                            onChange={(e) => setChartSymbol(e.target.value as SupportedSymbol)}
                            className="rounded-md border border-border bg-background px-1.5 py-1 font-numeric text-xs outline-none focus:border-primary/50"
                            aria-label="Chart symbol"
                        >
                            {SUPPORTED_SYMBOLS.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                        <div className="flex gap-0.5 rounded-md border border-border bg-background p-0.5">
                            {(["M1", "M5", "M15", "M30", "H1", "H4", "D1"] as const).map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setChartTimeframe(t)}
                                    aria-pressed={chartTimeframe === t}
                                    className={`rounded px-1.5 py-0.5 font-numeric text-micro transition ${chartTimeframe === t ? "bg-primary/10 font-bold text-primary" : "text-muted-foreground hover:bg-muted"}`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => setUseRealChart((v) => !v)}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            title="Toggle between the real candle chart and the TradingView embed"
                        >
                            {useRealChart ? "TradingView embed" : "Real candles"}
                        </button>
                    </div>
                    {mode === "replay" && useRealChart ? (
                        <div className="p-2">
                            <ProTerminalReplay token={authToken} />
                        </div>
                    ) : mode === "replay" ? (
                        <div className="p-1">
                            <MarketReplay studies={chartStudies} strategyType={generatedSource.includes("strategy(") ? "strategy" : "indicator"} />
                        </div>
                    ) : useRealChart ? (
                        <div className="p-2">
                            <ProTerminalChartWorkspace
                                initialSymbol={chartSymbol}
                                initialTimeframe={chartTimeframe}
                                initialLayers={chartLayers}
                                studyOverlay={studyOverlay}
                                onCandlesChange={(candles) => {
                                    chartCandlesRef.current = candles;
                                    setChartCandlesVersion((v) => v + 1);
                                }}
                                token={authToken}
                                height={480}
                                hideWatchlist
                                storageScope="pine-workspace"
                            />
                        </div>
                    ) : (
                        <TradingViewChart key={chartKey} studies={chartStudies} />
                    )}
                </div>
                <div className="mt-4 rounded-lg border border-border bg-card p-4 shadow-xs space-y-2">
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Generated Pine Preview</p>
                        <Button size="xs" variant="ghost" onClick={copyPineSource} className="text-xs font-medium gap-1.5 text-foreground hover:bg-muted">
                            <Copy size={13} />{copied ? "Copied" : "Copy Pine source"}
                        </Button>
                    </div>
                    <pre className="max-h-48 overflow-auto rounded-lg border border-border/60 bg-background p-3.5 font-numeric text-xs leading-relaxed text-foreground">{generatedSource}</pre>
                </div>
                {studyOverlay && studyOverlay.errors.length > 0 && (
                    <div className="rounded-lg border border-negative/20 bg-negative/5 p-4 shadow-xs">
                        <div className="flex items-start gap-2.5">
                            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-negative" />
                            <div>
                                <p className="text-xs font-semibold text-negative">Pine chart overlay errors</p>
                                <div className="mt-1 space-y-1">
                                    {studyOverlay.errors.map((err, i) => (
                                        <p key={i} className="text-micro leading-relaxed text-muted-foreground font-numeric">{err}</p>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {notice && (
                    <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3.5 py-2 text-xs text-muted-foreground flex items-center justify-between">
                        <span>{notice}</span>
                        <button onClick={() => setNotice("")} className="text-muted-foreground hover:text-foreground text-xs font-medium ml-2">Dismiss</button>
                    </div>
                )}
            </div>
            <CreateAlertDialog
                open={isAlertDialogOpen}
                onOpenChange={setIsAlertDialogOpen}
                scriptName={name}
                scriptId={currentWorkspaceId}
                scope={scope}
                symbol="FX:EURUSD"
                timeframe="1H"
                source={source}
                pineResult={pineResult}
                onCreated={(evt) => {
                    setNotice(`Alert "${evt.signal || name}" created successfully!`);
                }}
            />
        </section>
        </ProGate>
    );
}
