"use client";

import { DragEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Download, FolderOpen, Plus, Save, Trash2, Play, Check, AlertTriangle, BarChart3, Loader2, Brain, Wand2, Sparkles, Bell } from "lucide-react";
import { auth } from "@/lib/firebase";
import ProGate from "@/components/subscription/ProGate";
import TradingViewChart from "@/components/tradingview/TradingViewChart";
import MarketReplay from "@/components/tradingview/MarketReplay";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { executePine } from "@/lib/pine-runtime";
import type { PineExecutionResult } from "@/lib/pine-runtime";
import type { PineBacktestResult } from "@/lib/pine-runtime/backtest";
import PineAnalysisPanel from "@/components/tradingview/PineAnalysisPanel";
import CreateAlertDialog from "@/components/tradingview/CreateAlertDialog";

type WorkspaceScope = "account" | "admin";
type SavedWorkspace = { id: string; name: string; mode: "visual" | "code"; type: "strategy" | "indicator"; createdAt: number };
type NodeKind = "price" | "moving_average" | "rsi" | "macd" | "bollinger" | "stochastic" | "adx" | "atr" | "cci" | "psar" | "vwap" | "ichimoku" | "volume" | "crossover" | "rsi_oversold" | "rsi_overbought" | "macd_bullish" | "macd_bearish" | "stoch_oversold" | "stoch_overbought" | "stoch_cross" | "adx_strong" | "cci_oversold" | "cci_overbought" | "psar_bull" | "vwap_bull" | "ichimoku_bull" | "volume_surge" | "and" | "long_entry" | "short_entry" | "close_long" | "close_short" | "risk_manager" | "plot";
type FlowNode = { id: string; kind: NodeKind; x: number; y: number };
type FlowEdge = { from: string; to: string };

type PineWorkspaceProps = { scope: WorkspaceScope };

const nodeTypes: Record<NodeKind, { label: string; color: string }> = {
    price: { label: "Price", color: "border-sky-400/60 bg-sky-400/10" },
    moving_average: { label: "EMA trend", color: "border-violet-400/60 bg-violet-400/10" },
    rsi: { label: "RSI momentum", color: "border-fuchsia-400/60 bg-fuchsia-400/10" },
    macd: { label: "MACD momentum", color: "border-indigo-400/60 bg-indigo-400/10" },
    bollinger: { label: "Bollinger bands", color: "border-blue-400/60 bg-blue-400/10" },
    stochastic: { label: "Stochastic", color: "border-teal-400/60 bg-teal-400/10" },
    adx: { label: "ADX trend strength", color: "border-purple-400/60 bg-purple-400/10" },
    atr: { label: "ATR volatility", color: "border-orange-400/60 bg-orange-400/10" },
    cci: { label: "CCI momentum", color: "border-lime-400/60 bg-lime-400/10" },
    psar: { label: "Parabolic SAR", color: "border-slate-400/60 bg-slate-400/10" },
    vwap: { label: "VWAP", color: "border-cyan-300/60 bg-cyan-300/10" },
    ichimoku: { label: "Ichimoku cloud", color: "border-blue-500/60 bg-blue-500/10" },
    volume: { label: "Volume", color: "border-gray-400/60 bg-gray-400/10" },
    crossover: { label: "Cross over", color: "border-amber-400/60 bg-amber-400/10" },
    rsi_oversold: { label: "RSI oversold", color: "border-yellow-400/60 bg-yellow-400/10" },
    rsi_overbought: { label: "RSI overbought", color: "border-yellow-400/60 bg-yellow-400/10" },
    macd_bullish: { label: "MACD bullish", color: "border-emerald-400/60 bg-emerald-400/10" },
    macd_bearish: { label: "MACD bearish", color: "border-rose-400/60 bg-rose-400/10" },
    stoch_oversold: { label: "Stoch oversold", color: "border-yellow-400/60 bg-yellow-400/10" },
    stoch_overbought: { label: "Stoch overbought", color: "border-amber-500/60 bg-amber-500/10" },
    stoch_cross: { label: "Stoch cross", color: "border-orange-300/60 bg-orange-300/10" },
    adx_strong: { label: "ADX strong trend", color: "border-purple-300/60 bg-purple-300/10" },
    cci_oversold: { label: "CCI oversold", color: "border-yellow-300/60 bg-yellow-300/10" },
    cci_overbought: { label: "CCI overbought", color: "border-amber-400/60 bg-amber-400/10" },
    psar_bull: { label: "SAR trend", color: "border-emerald-300/60 bg-emerald-300/10" },
    vwap_bull: { label: "VWAP trend", color: "border-sky-300/60 bg-sky-300/10" },
    ichimoku_bull: { label: "Ichimoku signal", color: "border-blue-300/60 bg-blue-300/10" },
    volume_surge: { label: "Volume surge", color: "border-lime-300/60 bg-lime-300/10" },
    and: { label: "Confirm both", color: "border-slate-300/60 bg-slate-300/10" },
    long_entry: { label: "Enter long", color: "border-emerald-400/60 bg-emerald-400/10" },
    short_entry: { label: "Enter short", color: "border-rose-400/60 bg-rose-400/10" },
    close_long: { label: "Close long", color: "border-orange-400/60 bg-orange-400/10" },
    close_short: { label: "Close short", color: "border-orange-400/60 bg-orange-400/10" },
    risk_manager: { label: "Stop loss + take profit", color: "border-red-400/60 bg-red-400/10" },
    plot: { label: "Draw line", color: "border-cyan-400/60 bg-cyan-400/10" },
};

const initialNodes: FlowNode[] = [
    { id: "price", kind: "price", x: 36, y: 230 },
    { id: "average", kind: "moving_average", x: 250, y: 155 },
    { id: "cross", kind: "crossover", x: 465, y: 230 },
    { id: "entry", kind: "long_entry", x: 680, y: 155 },
    { id: "risk", kind: "risk_manager", x: 680, y: 340 },
    { id: "plot", kind: "plot", x: 465, y: 360 },
];

const initialEdges: FlowEdge[] = [
    { from: "price", to: "average" },
    { from: "average", to: "cross" },
    { from: "cross", to: "entry" },
    { from: "entry", to: "risk" },
    { from: "average", to: "plot" },
];

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

function createPineSource(nodes: FlowNode[], edges: FlowEdge[]) {
    const kinds = new Set(nodes.map((node) => node.kind));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const inputs = (id: string) => edges.map((edge) => edge.to === id ? byId.get(edge.from) : undefined).filter((node): node is FlowNode => Boolean(node));
    const isStrategy = ["long_entry", "short_entry", "close_long", "close_short", "risk_manager"].some((kind) => kinds.has(kind as NodeKind));
    const lines = ["//@version=6", isStrategy ? "strategy(\"Visual strategy\", overlay=true, pyramiding=0)" : "indicator(\"Visual indicator\", overlay=true)"];

    if (kinds.has("moving_average")) lines.push("fast = ta.ema(close, 20)", "slow = ta.ema(close, 50)");
    if (kinds.has("rsi")) lines.push("rsiValue = ta.rsi(close, 14)");
    if (kinds.has("macd")) lines.push("[macdLine, macdSignal, _] = ta.macd(close, 12, 26, 9)");
    if (kinds.has("bollinger")) lines.push("[bbBasis, bbUpper, bbLower] = ta.bb(close, 20, 2)");
    if (kinds.has("stochastic")) lines.push("[stochK, stochD] = ta.stoch(close, high, low, 14)");
    if (kinds.has("adx")) lines.push("adxValue = ta.adx(high, low, close, 14)");
    if (kinds.has("atr")) lines.push("atrValue = ta.atr(14)");
    if (kinds.has("cci")) lines.push("cciValue = ta.cci(close, 14)");
    if (kinds.has("psar")) lines.push("psarValue = ta.psar(0.02, 0.2)");
    if (kinds.has("vwap")) lines.push("vwapValue = ta.vwap(hl3)");
    if (kinds.has("ichimoku")) lines.push("ichimokuConv = (ta.highest(high, 9) + ta.lowest(low, 9)) / 2", "ichimokuBase = (ta.highest(high, 26) + ta.lowest(low, 26)) / 2", "ichimokuSpanA = (ichimokuConv + ichimokuBase) / 2", "ichimokuSpanB = (ta.highest(high, 52) + ta.lowest(low, 52)) / 2");
    if (kinds.has("volume")) lines.push("volumeValue = volume");
    if (kinds.has("crossover") && kinds.has("moving_average")) lines.push("longCross = ta.crossover(fast, slow)", "shortCross = ta.crossunder(fast, slow)");
    if (kinds.has("rsi_oversold") && kinds.has("rsi")) lines.push("rsiOversold = rsiValue < 30");
    if (kinds.has("rsi_overbought") && kinds.has("rsi")) lines.push("rsiOverbought = rsiValue > 70");
    if (kinds.has("macd_bullish") && kinds.has("macd")) lines.push("macdBullish = ta.crossover(macdLine, macdSignal)");
    if (kinds.has("macd_bearish") && kinds.has("macd")) lines.push("macdBearish = ta.crossunder(macdLine, macdSignal)");
    if (kinds.has("stoch_oversold") && kinds.has("stochastic")) lines.push("stochOversold = stochK < 20");
    if (kinds.has("stoch_overbought") && kinds.has("stochastic")) lines.push("stochOverbought = stochK > 80");
    if (kinds.has("stoch_cross") && kinds.has("stochastic")) lines.push("stochCross = ta.crossover(stochK, stochD)", "stochCrossUnder = ta.crossunder(stochK, stochD)");
    if (kinds.has("adx_strong") && kinds.has("adx")) lines.push("adxStrong = adxValue > 25");
    if (kinds.has("cci_oversold") && kinds.has("cci")) lines.push("cciOversold = cciValue < -100");
    if (kinds.has("cci_overbought") && kinds.has("cci")) lines.push("cciOverbought = cciValue > 100");
    if (kinds.has("psar_bull") && kinds.has("psar")) lines.push("sarUptrend = close > psarValue");
    if (kinds.has("vwap_bull") && kinds.has("vwap")) lines.push("vwapBull = close > vwapValue", "vwapBear = close < vwapValue");
    if (kinds.has("ichimoku_bull") && kinds.has("ichimoku")) lines.push("ichimokuBull = close > ichimokuSpanA and close > ichimokuSpanB", "ichimokuBear = close < ichimokuSpanA and close < ichimokuSpanB");
    if (kinds.has("volume_surge") && kinds.has("volume")) lines.push("volumeAvg = ta.sma(volume, 20)", "volumeSurge = volume > volumeAvg * 1.5");

    const condition = (node: FlowNode, direction: "long" | "short", visited = new Set<string>()): string | null => {
        if (visited.has(node.id)) return null;
        visited.add(node.id);
        if (node.kind === "crossover") return direction === "long" ? "longCross" : "shortCross";
        if (node.kind === "rsi_oversold") return direction === "long" ? "rsiOversold" : null;
        if (node.kind === "rsi_overbought") return direction === "short" ? "rsiOverbought" : null;
        if (node.kind === "macd_bullish") return direction === "long" ? "macdBullish" : null;
        if (node.kind === "macd_bearish") return direction === "short" ? "macdBearish" : null;
        if (node.kind === "stoch_oversold") return direction === "long" ? "stochOversold" : null;
        if (node.kind === "stoch_overbought") return direction === "short" ? "stochOverbought" : null;
        if (node.kind === "stoch_cross") return direction === "long" ? "stochCross" : "stochCrossUnder";
        if (node.kind === "adx_strong") return "adxStrong";
        if (node.kind === "cci_oversold") return direction === "long" ? "cciOversold" : null;
        if (node.kind === "cci_overbought") return direction === "short" ? "cciOverbought" : null;
        if (node.kind === "psar_bull") return direction === "long" ? "sarUptrend" : "not sarUptrend";
        if (node.kind === "vwap_bull") return direction === "long" ? "vwapBull" : "vwapBear";
        if (node.kind === "ichimoku_bull") return direction === "long" ? "ichimokuBull" : "ichimokuBear";
        if (node.kind === "volume_surge") return "volumeSurge";
        if (node.kind === "moving_average") return direction === "long" ? "fast > slow" : "fast < slow";
        if (node.kind === "bollinger") return direction === "long" ? "close < bbLower" : "close > bbUpper";
        const childConditions = inputs(node.id).map((input) => condition(input, direction, new Set(visited))).filter((value): value is string => Boolean(value));
        return childConditions.length > 1 ? `(${childConditions.join(" and ")})` : childConditions[0] || null;
    };

    const addEntry = (kind: "long_entry" | "short_entry", label: "Long" | "Short", direction: "long" | "short") => {
        nodes.filter((node) => node.kind === kind).forEach((node) => {
            const value = condition(node, direction);
            if (value) lines.push(`if ${value}`, `    strategy.entry(\"${label}\", strategy.${direction})`);
        });
    };
    addEntry("long_entry", "Long", "long");
    addEntry("short_entry", "Short", "short");
    nodes.filter((node) => node.kind === "close_long").forEach((node) => {
        const value = condition(node, "short");
        if (value) lines.push(`if ${value}`, "    strategy.close(\"Long\")");
    });
    nodes.filter((node) => node.kind === "close_short").forEach((node) => {
        const value = condition(node, "long");
        if (value) lines.push(`if ${value}`, "    strategy.close(\"Short\")");
    });
    const hasConnectedRiskManager = nodes.some((node) => node.kind === "risk_manager" && inputs(node.id).some((input) => input.kind === "long_entry" || input.kind === "short_entry"));
    if (hasConnectedRiskManager && isStrategy) lines.push(
        "stopPercent = input.float(1.0, \"Stop loss %\", minval=0.1, step=0.1)",
        "takeProfitPercent = input.float(3.0, \"Take profit %\", minval=0.1, step=0.1)",
        "strategy.exit(\"Long risk\", \"Long\", stop=strategy.position_avg_price * (1 - stopPercent / 100), limit=strategy.position_avg_price * (1 + takeProfitPercent / 100))",
        "strategy.exit(\"Short risk\", \"Short\", stop=strategy.position_avg_price * (1 + stopPercent / 100), limit=strategy.position_avg_price * (1 - takeProfitPercent / 100))"
    );
    if (kinds.has("plot") && kinds.has("moving_average")) lines.push("plot(fast, color=color.aqua, linewidth=2)", "plot(slow, color=color.orange, linewidth=2)");
    if (kinds.has("plot") && kinds.has("bollinger")) lines.push("plot(bbUpper, color=color.blue)", "plot(bbBasis, color=color.gray)", "plot(bbLower, color=color.blue)");
    if (kinds.has("plot") && kinds.has("stochastic")) lines.push("plot(stochK, color=color.aqua)", "plot(stochD, color=color.orange)");
    if (kinds.has("plot") && kinds.has("adx")) lines.push("plot(adxValue, color=color.purple)", "hline(25, \"Strong trend\", color=color.gray, linestyle=hline.style_dashed)");
    if (kinds.has("plot") && kinds.has("atr")) lines.push("plot(atrValue, color=color.orange)");
    if (kinds.has("plot") && kinds.has("cci")) lines.push("plot(cciValue, color=color.lime)", "hline(100, color=color.gray, linestyle=hline.style_dashed)", "hline(-100, color=color.gray, linestyle=hline.style_dashed)");
    if (kinds.has("plot") && kinds.has("psar")) lines.push("plot(psarValue, style=plot.style_cross, color=color.white)");
    if (kinds.has("plot") && kinds.has("vwap")) lines.push("plot(vwapValue, color=color.orange, linewidth=2)");
    if (kinds.has("plot") && kinds.has("ichimoku")) lines.push("plot(ichimokuSpanA, color=color.lime, linewidth=1, title=\"Senkou A\")", "plot(ichimokuSpanB, color=color.red, linewidth=1, title=\"Senkou B\")", "plot(ichimokuConv, color=color.blue, linewidth=1, title=\"Tenkan\")", "plot(ichimokuBase, color=color.orange, linewidth=1, title=\"Kijun\")");
    if (kinds.has("plot") && kinds.has("volume")) lines.push("plot(volumeValue, style=plot.style_columns, color=color.gray)");
    const hasNoPlottableIndicator = !["moving_average", "bollinger", "stochastic", "adx", "atr", "cci", "psar", "vwap", "ichimoku", "volume"].some((kind) => kinds.has(kind as NodeKind));
    if (hasNoPlottableIndicator && kinds.has("plot")) lines.push("plot(close, color=color.aqua, linewidth=2)");

    return lines.join("\n\n");
}

function nodeHint(kind: NodeKind) {
    const hints: Record<NodeKind, string> = {
        price: "Live market price",
        moving_average: "20 / 50 EMA trend",
        rsi: "14-period momentum",
        macd: "12 / 26 / 9 momentum",
        bollinger: "20-period volatility",
        stochastic: "14-period %K / %D momentum",
        adx: "14-period trend strength",
        atr: "14-period volatility",
        cci: "14-period momentum",
        psar: "0.02 / 0.2 trailing stops",
        vwap: "Volume-weighted average price",
        ichimoku: "9 / 26 / 52 cloud",
        volume: "Bar volume flow",
        crossover: "Trend crossover event",
        rsi_oversold: "RSI below 30",
        rsi_overbought: "RSI above 70",
        macd_bullish: "MACD crosses upward",
        macd_bearish: "MACD crosses downward",
        stoch_oversold: "Stochastic K below 20",
        stoch_overbought: "Stochastic K above 80",
        stoch_cross: "K crosses D",
        adx_strong: "ADX above 25",
        cci_oversold: "CCI below -100",
        cci_overbought: "CCI above 100",
        psar_bull: "Price above SAR",
        vwap_bull: "Price vs VWAP",
        ichimoku_bull: "Price above cloud",
        volume_surge: "Volume spikes above average",
        and: "Both inputs must agree",
        long_entry: "Open a long position",
        short_entry: "Open a short position",
        close_long: "Close a long position",
        close_short: "Close a short position",
        risk_manager: "Configurable SL and TP",
        plot: "Draw studies on chart",
    };
    return hints[kind];
}

export default function PineWorkspace({ scope }: PineWorkspaceProps) {
    const [name, setName] = useState("Untitled Pine script");
    const [mode, setMode] = useState<"visual" | "code" | "replay">("visual");
    const [nodes, setNodes] = useState<FlowNode[]>(initialNodes);
    const [edges, setEdges] = useState<FlowEdge[]>(initialEdges);
    const [pendingConnection, setPendingConnection] = useState<string | null>(null);
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
                setNodes(loaded.nodes?.length ? loaded.nodes : initialNodes);
                setEdges(loaded.edges?.length ? loaded.edges : initialEdges);
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

    const generatedSource = useMemo(() => mode === "visual" ? createPineSource(nodes, edges) : source, [mode, nodes, edges, source]);

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
        const kinds = new Set(nodes.map((node) => node.kind));
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
    }, [mode, nodes, source, parsePineIndicators]);

    const [chartKey, setChartKey] = useState(0);
    const [appliedStudies, setAppliedStudies] = useState<string[]>([]);

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
        setChartKey((k) => k + 1);
        setNotice(`Applied ${chartStudies.length} indicator${chartStudies.length !== 1 ? "s" : ""} to chart.`);
    }

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
                setNodes(data.nodes);
                setEdges(data.edges || []);
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

    function addNode(kind: NodeKind, x = 90, y = 90) {
        setNodes((current) => [...current, { id: `${kind}-${Date.now()}`, kind, x, y }]);
    }

    function handleCanvasDrop(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        const payload = event.dataTransfer.getData("text/plain");
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = Math.max(8, event.clientX - bounds.left - 75);
        const y = Math.max(8, event.clientY - bounds.top - 32);

        if (payload.startsWith("palette:")) {
            addNode(payload.replace("palette:", "") as NodeKind, x, y);
            return;
        }
        if (payload.startsWith("node:")) {
            const id = payload.replace("node:", "");
            setNodes((current) => current.map((node) => node.id === id ? { ...node, x, y } : node));
        }
    }

    function connect(from: string, to: string) {
        if (from === to || edges.some((edge) => edge.from === from && edge.to === to)) return;
        setEdges((current) => [...current, { from, to }]);
    }

    function handleOutputClick(id: string) {
        setPendingConnection(id);
        setNotice("Choose the input on the next node to connect it.");
    }

    function handleInputClick(id: string) {
        if (!pendingConnection) {
            setNotice("Choose an output dot first.");
            return;
        }
        connect(pendingConnection, id);
        setPendingConnection(null);
        setNotice("Nodes connected.");
    }

    function removeNode(id: string) {
        setNodes((current) => current.filter((node) => node.id !== id));
        setEdges((current) => current.filter((edge) => edge.from !== id && edge.to !== id));
        if (pendingConnection === id) setPendingConnection(null);
    }

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
                    nodes,
                    edges,
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

    return (
        <ProGate>
            <section className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
            <aside data-guide="palette" className="self-start rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/10">
                        <FolderOpen size={15} />
                    </span>
                    <p className="text-sm font-semibold">Saved workspaces</p>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Reopen a saved workspace, or start from a blank canvas below.</p>
                <div className="mt-3 space-y-2">
                    {loadingWorkspaces ? (
                        <p className="text-xs text-muted-foreground">Loading…</p>
                    ) : workspaces.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">No saved workspaces yet. Build one and hit Save.</p>
                    ) : (
                        workspaces.map((workspace) => (
                            <div key={workspace.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 transition hover:border-foreground/30 hover:bg-muted/50">
                                <div className="min-w-0">
                                    <p className="truncate text-xs font-medium">{workspace.name}</p>
                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{workspace.type} · {new Date(workspace.createdAt).toLocaleDateString()}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <button onClick={() => openWorkspace(workspace.id)} className="rounded-md border border-border px-2 py-1 text-[11px] font-medium transition hover:border-foreground/40 hover:bg-muted" title="Open workspace">Open</button>
                                    <button onClick={() => deleteWorkspace(workspace.id, workspace.name)} className="rounded-md p-1 text-muted-foreground transition hover:text-rose-400" title="Delete workspace" aria-label={`Delete ${workspace.name}`}><Trash2 size={13} /></button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                <p className="mt-5 text-sm font-semibold">Strategy nodes</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Drag a node onto the canvas. Join output dots to input dots to define the flow.</p>
                <div className="mt-4 space-y-2">
                    {(Object.keys(nodeTypes) as NodeKind[]).map((kind) => (
                        <Tooltip key={kind}>
                            <TooltipTrigger render={<button draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", `palette:${kind}`)} onClick={() => addNode(kind)} className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-xs text-foreground transition hover:border-foreground/40 hover:bg-muted"><Plus size={13} />{nodeTypes[kind].label}</button>} />
                            <TooltipContent>{nodeHint(kind)} — click or drag to add this node.</TooltipContent>
                        </Tooltip>
                    ))}
                </div>
                <Tooltip>
                    <TooltipTrigger render={<button onClick={() => { setNodes([]); setEdges([]); setPendingConnection(null); }} className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground transition hover:text-rose-400"><Trash2 size={13} />Clear canvas</button>} />
                    <TooltipContent>Remove every node and connection from the canvas.</TooltipContent>
                </Tooltip>
            </aside>
            <div className="min-w-0 rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-foreground/40 sm:w-auto" aria-label="Pine script name" title="Name for this Pine workspace" />
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="flex flex-wrap gap-1.5" data-guide="modes">
                                <button onClick={() => setMode("visual")} className={`rounded-lg px-3 py-2 text-xs transition ${mode === "visual" ? "bg-foreground font-semibold text-background" : "border border-border text-muted-foreground hover:text-foreground"}`}>Visual</button>
                                <button onClick={() => setMode("code")} className={`rounded-lg px-3 py-2 text-xs transition ${mode === "code" ? "bg-foreground font-semibold text-background" : "border border-border text-muted-foreground hover:text-foreground"}`}>Code</button>
                                <button onClick={() => setMode("replay")} className={`rounded-lg px-3 py-2 text-xs transition ${mode === "replay" ? "bg-foreground font-semibold text-background" : "border border-border text-muted-foreground hover:text-foreground"}`}>Replay</button>
                            </div>
                            <div className="h-4 w-px bg-border hidden sm:block" />
                            <div className="flex flex-wrap gap-1.5" data-guide="actions">
                                <button onClick={saveWorkspace} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"><Save size={13} />{saving ? "Saving" : "Save"}</button>
                                <button onClick={downloadWorkspace} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"><Download size={13} />Download</button>
                            </div>
                        </div>
                    </div>
                    {mode === "visual" && (
                        <div className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-violet-500/10 p-4" data-guide="ai-builder">
                            <div className="flex items-center gap-2">
                                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10">
                                    <Brain size={14} className="text-violet-400" />
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-foreground">AI Strategy Builder</p>
                                    <p className="text-[10px] text-muted-foreground">Describe it, AI builds it</p>
                                </div>
                            </div>
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                <input
                                    value={aiDescription}
                                    onChange={(e) => setAiDescription(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleAiBuildStrategy()}
                                    placeholder="e.g. Buy when EMA crosses above RSI below 70, with 1% SL and 3% TP"
                                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none transition placeholder:text-muted-foreground/50 focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
                                />
                                <button
                                    onClick={handleAiBuildStrategy}
                                    disabled={isAiBuilding || !aiDescription.trim()}
                                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-500 px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-violet-400 disabled:opacity-50"
                                >
                                    {isAiBuilding ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                                    {isAiBuilding ? "Building..." : "Build"}
                                </button>
                            </div>
                            {aiStrategyDescription && (
                                <div className="mt-3 rounded-lg border border-border bg-background/80 p-2.5">
                                    <p className="text-[11px] leading-5 text-muted-foreground">{aiStrategyDescription}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                {mode === "visual" || mode === "replay" ? (
                    <div data-guide="canvas" onDragOver={(event) => event.preventDefault()} onDrop={handleCanvasDrop} className="relative mt-4 min-h-[520px] overflow-auto rounded-xl border border-dashed border-border bg-background" aria-label="Visual Pine strategy builder">
                        <div className="relative h-[520px] min-w-[900px] bg-[linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] bg-[size:24px_24px]">
                            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                                {edges.map((edge) => {
                                    const from = nodes.find((node) => node.id === edge.from);
                                    const to = nodes.find((node) => node.id === edge.to);
                                    if (!from || !to) return null;
                                    return <path key={`${edge.from}-${edge.to}`} d={`M ${from.x + 156} ${from.y + 34} C ${from.x + 205} ${from.y + 34}, ${to.x - 48} ${to.y + 34}, ${to.x} ${to.y + 34}`} className="stroke-foreground/60" strokeWidth="2" fill="none" />;
                                })}
                            </svg>
                            {nodes.map((node) => <div key={node.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", `node:${node.id}`)} style={{ left: node.x, top: node.y }} className={`absolute w-40 cursor-grab rounded-lg border p-3 shadow-lg active:cursor-grabbing ${nodeTypes[node.kind].color}`}>
                                <div className="flex items-center justify-between gap-2"><Tooltip><TooltipTrigger render={<button onClick={() => handleInputClick(node.id)} className="h-3 w-3 rounded-full border border-foreground bg-background" aria-label={`Connect to ${nodeTypes[node.kind].label}`} />} /><TooltipContent>Input — connect this from a previous node&apos;s output dot.</TooltipContent></Tooltip><span className="text-xs font-semibold text-foreground">{nodeTypes[node.kind].label}</span><Tooltip><TooltipTrigger render={<button onClick={() => removeNode(node.id)} className="text-muted-foreground transition hover:text-rose-400" aria-label={`Remove ${nodeTypes[node.kind].label}`}><Trash2 size={12} /></button>} /><TooltipContent>Remove this node and its connections.</TooltipContent></Tooltip></div>
                                <p className="mt-2 text-[10px] text-muted-foreground">{nodeHint(node.kind)}</p>
                                <Tooltip><TooltipTrigger render={<button onClick={() => handleOutputClick(node.id)} className={`absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-foreground ${pendingConnection === node.id ? "bg-foreground" : "bg-background"}`} aria-label={`Connect to next node from ${nodeTypes[node.kind].label}`} />} /><TooltipContent>Output — connect this to the next node&apos;s input dot.</TooltipContent></Tooltip>
                            </div>)}
                        </div>
                    </div>
                ) : (
                    <div className="mt-4">
                        <div className="flex items-center justify-between gap-3 rounded-t-xl border border-border border-b-0 bg-muted/40 px-4 py-2" data-guide="code-toolbar">
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-semibold text-foreground">Pine Script Editor</span>
                                {appliedStudies.length > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                                        <Check size={10} />
                                        {appliedStudies.length} applied
                                    </span>
                                )}
                                {pineResult && pineResult.errors.length === 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                                        <Check size={10} />
                                        Runtime compatible
                                    </span>
                                )}
                                {pineResult && pineResult.errors.length > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-400">
                                        <AlertTriangle size={10} />
                                        {pineResult.errors.length} error{pineResult.errors.length !== 1 ? "s" : ""}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground">v6</span>
                                <Tooltip>
                                    <TooltipTrigger render={
                                        <button
                                            onClick={analyzeScript}
                                            disabled={isAnalyzing}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted active:scale-95 disabled:opacity-50"
                                        >
                                            {isAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <BarChart3 size={12} />}
                                            Analyze
                                        </button>
                                    } />
                                    <TooltipContent>Analyze your Pine script for compatibility and features.</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger render={
                                        <button
                                            onClick={applyToChart}
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-violet-400 active:scale-95"
                                        >
                                            <Play size={12} />
                                            Apply to Chart
                                        </button>
                                    } />
                                    <TooltipContent>Parse indicators from your Pine code and apply them to the chart below.</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger render={
                                        <button
                                            onClick={handleCreateAlert}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted active:scale-95"
                                        >
                                            <Bell size={12} />
                                            Create Alert
                                        </button>
                                    } />
                                    <TooltipContent>Create a TradingView alert for this Pine script with webhook &amp; notification options.</TooltipContent>
                                </Tooltip>
                                {pineResult && pineResult.errors.length > 0 && (
                                    <Tooltip>
                                        <TooltipTrigger render={
                                            <button
                                                onClick={handleAiFixCode}
                                                disabled={isAiFixing}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 transition hover:bg-amber-500/20 active:scale-95 disabled:opacity-50"
                                            >
                                                {isAiFixing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                                {isAiFixing ? "Fixing..." : "AI Fix"}
                                            </button>
                                        } />
                                        <TooltipContent>Use AI to automatically fix errors in your Pine script.</TooltipContent>
                                    </Tooltip>
                                )}
                                <Tooltip>
                                    <TooltipTrigger render={
                                        <button
                                            onClick={handleAiDescribe}
                                            disabled={isAiDescribing}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted active:scale-95 disabled:opacity-50"
                                        >
                                            {isAiDescribing ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
                                            {isAiDescribing ? "Describing..." : "Describe"}
                                        </button>
                                    } />
                                    <TooltipContent>AI will describe what your Pine script does.</TooltipContent>
                                </Tooltip>
                            </div>
                        </div>
                        <textarea
                            value={source}
                            onChange={(event) => setSource(event.target.value)}
                            spellCheck={false}
                            className="h-[480px] w-full resize-y rounded-b-xl border border-t-0 border-border bg-background p-4 font-mono text-xs leading-6 outline-none transition focus:border-foreground/40"
                            aria-label="Pine Script editor"
                            placeholder="// Write your Pine Script v6 code here...&#10;// Click Analyze to check compatibility&#10;// Click Apply to Chart to visualize&#10;&#10;//@version=6&#10;indicator(&#10;    &quot;My Indicator&quot;,&#10;    overlay=true&#10;)&#10;&#10;ema20 = ta.ema(close, 20)&#10;plot(ema20, color=color.blue)"
                        />
                        {showAnalysis && (
                            <div className="mt-4">
                                {isAnalyzing ? (
                                    <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4">
                                        <Loader2 size={16} className="animate-spin text-violet-400" />
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
                            <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
                                <div className="flex items-start gap-2">
                                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-rose-400" />
                                    <div>
                                        <p className="text-xs font-medium text-rose-400">Pine Runtime Errors</p>
                                        <div className="mt-1 space-y-1">
                                            {pineResult.errors.map((err, i) => (
                                                <p key={i} className="text-[11px] leading-5 text-muted-foreground font-mono">{err}</p>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {pineResult && pineResult.plots.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                <span className="text-[10px] text-muted-foreground">Plots: {pineResult.plots.length}</span>
                                {pineResult.hlines.length > 0 && <span className="text-[10px] text-muted-foreground">· Hlines: {pineResult.hlines.length}</span>}
                                {pineResult.alerts.length > 0 && <span className="text-[10px] text-muted-foreground">· Alerts: {pineResult.alerts.length}</span>}
                                {pineResult.strategy && <span className="text-[10px] text-muted-foreground">· Strategy active</span>}
                            </div>
                        )}
                        {aiStrategyDescription && (
                            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                                <div className="flex items-start gap-2">
                                    <Brain size={14} className="mt-0.5 shrink-0 text-violet-400" />
                                    <div>
                                        <p className="text-xs font-medium text-violet-400">AI Analysis</p>
                                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{aiStrategyDescription}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                <div className="mt-4" data-guide="chart">
                    {mode === "replay" ? (
                        <MarketReplay studies={chartStudies} strategyType={generatedSource.includes("strategy(") ? "strategy" : "indicator"} />
                    ) : (
                        <TradingViewChart key={chartKey} studies={chartStudies} />
                    )}
                </div>
                <div className="mt-4 border-t border-border pt-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium text-muted-foreground">Generated Pine preview</p><button onClick={copyPineSource} className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground transition hover:opacity-80"><Copy size={13} />{copied ? "Copied" : "Copy Pine source"}</button></div><pre className="mt-2 max-h-44 overflow-auto rounded-lg bg-background p-3 text-xs leading-5">{generatedSource}</pre></div>
                {notice && <p className="mt-3 text-xs text-foreground/80">{notice}</p>}
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
