"use client";

import { DragEvent, useCallback, useEffect, useMemo, useState, useRef, DragEventHandler } from "react";
import { Copy, Download, FolderOpen, Plus, Save, Trash2, Play, Check, AlertTriangle, BarChart3, Loader2, Brain, Wand2, Sparkles, Bell, Settings2, X, Search, Sliders, Layers, Power, Info } from "lucide-react";
import { auth } from "@/lib/firebase";
import ProGate from "@/components/subscription/ProGate";
import TradingViewChart from "@/components/tradingview/TradingViewChart";
import MarketReplay from "@/components/tradingview/MarketReplay";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { executePine } from "@/lib/pine-runtime";
import type { PineExecutionResult } from "@/lib/pine-runtime";
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
type NodeKind = "price" | "moving_average" | "hma" | "rsi" | "macd" | "bollinger" | "keltner" | "donchian" | "supertrend" | "stochastic" | "adx" | "atr" | "cci" | "psar" | "vwap" | "ichimoku" | "mfi" | "williams_r" | "roc" | "ao" | "stddev" | "pivots" | "volume" | "obv" | "cmf" | "crossover" | "rsi_oversold" | "rsi_overbought" | "macd_bullish" | "macd_bearish" | "stoch_oversold" | "stoch_overbought" | "stoch_cross" | "adx_strong" | "cci_oversold" | "cci_overbought" | "psar_bull" | "vwap_bull" | "ichimoku_bull" | "volume_surge" | "and" | "long_entry" | "short_entry" | "close_long" | "close_short" | "risk_manager" | "plot";
type FlowNode = { id: string; kind: NodeKind; x: number; y: number; label?: string; config?: Record<string, any>; enabled?: boolean };
type FlowEdge = { from: string; to: string };

type PineWorkspaceProps = { scope: WorkspaceScope };

const nodeTypes: Record<NodeKind, { label: string; color: string }> = {
    price: { label: "Price Quote", color: "border-sky-400/60 bg-sky-400/10" },
    moving_average: { label: "EMA Trend", color: "border-amber-400/60 bg-amber-400/10" },
    hma: { label: "Hull MA (HMA)", color: "border-amber-400/60 bg-amber-400/10" },
    rsi: { label: "RSI Momentum", color: "border-amber-400/60 bg-amber-400/10" },
    macd: { label: "MACD Oscillator", color: "border-amber-400/60 bg-amber-400/10" },
    bollinger: { label: "Bollinger Bands", color: "border-amber-400/60 bg-amber-400/10" },
    keltner: { label: "Keltner Channels", color: "border-amber-400/60 bg-amber-400/10" },
    donchian: { label: "Donchian Channels", color: "border-amber-400/60 bg-amber-400/10" },
    supertrend: { label: "Supertrend", color: "border-amber-400/60 bg-amber-400/10" },
    stochastic: { label: "Stochastic %K/%D", color: "border-amber-400/60 bg-amber-400/10" },
    adx: { label: "ADX Trend Strength", color: "border-amber-400/60 bg-amber-400/10" },
    atr: { label: "ATR Volatility", color: "border-amber-400/60 bg-amber-400/10" },
    cci: { label: "CCI Momentum", color: "border-amber-400/60 bg-amber-400/10" },
    psar: { label: "Parabolic SAR", color: "border-amber-400/60 bg-amber-400/10" },
    vwap: { label: "VWAP Average", color: "border-amber-400/60 bg-amber-400/10" },
    ichimoku: { label: "Ichimoku Cloud", color: "border-amber-400/60 bg-amber-400/10" },
    mfi: { label: "Money Flow (MFI)", color: "border-amber-400/60 bg-amber-400/10" },
    williams_r: { label: "Williams %R", color: "border-amber-400/60 bg-amber-400/10" },
    roc: { label: "Rate of Change", color: "border-amber-400/60 bg-amber-400/10" },
    ao: { label: "Awesome Oscillator", color: "border-amber-400/60 bg-amber-400/10" },
    stddev: { label: "Std Deviation", color: "border-amber-400/60 bg-amber-400/10" },
    pivots: { label: "Pivot Points", color: "border-amber-400/60 bg-amber-400/10" },
    volume: { label: "Volume Flow", color: "border-slate-400/60 bg-slate-400/10" },
    obv: { label: "On Balance Vol", color: "border-slate-400/60 bg-slate-400/10" },
    cmf: { label: "Chaikin Money Flow", color: "border-slate-400/60 bg-slate-400/10" },
    crossover: { label: "Cross Over", color: "border-orange-400/60 bg-orange-400/10" },
    rsi_oversold: { label: "RSI Oversold", color: "border-orange-400/60 bg-orange-400/10" },
    rsi_overbought: { label: "RSI Overbought", color: "border-orange-400/60 bg-orange-400/10" },
    macd_bullish: { label: "MACD Bullish", color: "border-emerald-400/60 bg-emerald-400/10" },
    macd_bearish: { label: "MACD Bearish", color: "border-rose-400/60 bg-rose-400/10" },
    stoch_oversold: { label: "Stoch Oversold", color: "border-orange-400/60 bg-orange-400/10" },
    stoch_overbought: { label: "Stoch Overbought", color: "border-orange-400/60 bg-orange-400/10" },
    stoch_cross: { label: "Stoch Cross", color: "border-orange-400/60 bg-orange-400/10" },
    adx_strong: { label: "ADX Strong Trend", color: "border-orange-400/60 bg-orange-400/10" },
    cci_oversold: { label: "CCI Oversold", color: "border-orange-400/60 bg-orange-400/10" },
    cci_overbought: { label: "CCI Overbought", color: "border-orange-400/60 bg-orange-400/10" },
    psar_bull: { label: "SAR Uptrend", color: "border-emerald-400/60 bg-emerald-400/10" },
    vwap_bull: { label: "VWAP Bull Trend", color: "border-sky-400/60 bg-sky-400/10" },
    ichimoku_bull: { label: "Ichimoku Bullish", color: "border-blue-400/60 bg-blue-400/10" },
    volume_surge: { label: "Volume Surge", color: "border-lime-400/60 bg-lime-400/10" },
    and: { label: "Logical AND", color: "border-indigo-400/60 bg-indigo-400/10" },
    long_entry: { label: "Enter Long", color: "border-blue-400/60 bg-blue-400/10" },
    short_entry: { label: "Enter Short", color: "border-rose-400/60 bg-rose-400/10" },
    close_long: { label: "Close Long", color: "border-orange-400/60 bg-orange-400/10" },
    close_short: { label: "Close Short", color: "border-orange-400/60 bg-orange-400/10" },
    risk_manager: { label: "Stop Loss & Take Profit", color: "border-red-400/60 bg-red-400/10" },
    plot: { label: "Draw Study Line", color: "border-cyan-400/60 bg-cyan-400/10" },
};

const initialNodes: FlowNode[] = [
    { id: "price", kind: "price", x: 300, y: 35 },
    { id: "average", kind: "moving_average", x: 300, y: 155 },
    { id: "cross", kind: "crossover", x: 300, y: 275 },
    { id: "entry", kind: "long_entry", x: 160, y: 395 },
    { id: "risk", kind: "risk_manager", x: 160, y: 515 },
    { id: "plot", kind: "plot", x: 440, y: 395 },
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
        price: "Live market price & OHLCV",
        moving_average: "20 / 50 EMA trend",
        hma: "9-period Hull moving average",
        rsi: "14-period momentum oscillator",
        macd: "12 / 26 / 9 MACD oscillator",
        bollinger: "20-period volatility bands",
        keltner: "20-period ATR channels",
        donchian: "20-period channel breakouts",
        supertrend: "10 / 3 ATR trend follower",
        stochastic: "14-period %K / %D momentum",
        adx: "14-period trend strength",
        atr: "14-period average true range",
        cci: "14-period commodity channel",
        psar: "0.02 / 0.2 trailing stop SAR",
        vwap: "Volume-weighted average price",
        ichimoku: "9 / 26 / 52 Ichimoku cloud",
        mfi: "14-period volume-weighted RSI",
        williams_r: "14-period Williams %R",
        roc: "12-period Rate of Change",
        ao: "Awesome Oscillator momentum",
        stddev: "20-period standard deviation",
        pivots: "Pivot highs & lows",
        volume: "Bar volume flow",
        obv: "On Balance Volume flow",
        cmf: "Chaikin Money Flow",
        crossover: "Trend crossover condition",
        rsi_oversold: "RSI below oversold 30",
        rsi_overbought: "RSI above overbought 70",
        macd_bullish: "MACD line crosses signal",
        macd_bearish: "MACD line crosses under signal",
        stoch_oversold: "Stochastic K below 20",
        stoch_overbought: "Stochastic K above 80",
        stoch_cross: "Stoch %K crosses %D",
        adx_strong: "ADX above strong trend 25",
        cci_oversold: "CCI below -100 oversold",
        cci_overbought: "CCI above 100 overbought",
        psar_bull: "Price above Parabolic SAR",
        vwap_bull: "Price relative to VWAP",
        ichimoku_bull: "Price above Ichimoku cloud",
        volume_surge: "Volume 1.5x above average",
        and: "Both input conditions agree",
        long_entry: "Open a long position",
        short_entry: "Open a short position",
        close_long: "Close active long position",
        close_short: "Close active short position",
        risk_manager: "Configurable Stop Loss & TP",
        plot: "Draw study lines on chart",
    };
    return hints[kind];
}

const nodeCategoryStyles: Record<NodeKind, { category: string; header: string; badge: string; dot: string }> = {
    price: { category: "Market Data", header: "bg-sky-500/10 border-b border-sky-500/30", badge: "bg-sky-100 text-sky-950 dark:bg-sky-900/70 dark:text-sky-100 font-extrabold border border-sky-400/50 shadow-xs", dot: "#0ea5e9" },
    moving_average: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    hma: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    rsi: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    macd: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    bollinger: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    keltner: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    donchian: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    supertrend: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    stochastic: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    adx: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    atr: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    cci: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    psar: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    vwap: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    ichimoku: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    mfi: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    williams_r: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    roc: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    ao: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    stddev: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    pivots: { category: "Technical", header: "bg-amber-500/10 border-b border-amber-500/30", badge: "bg-amber-100 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100 font-extrabold border border-amber-400/50 shadow-xs", dot: "#f59e0b" },
    volume: { category: "Volume", header: "bg-slate-500/10 border-b border-slate-500/30", badge: "bg-slate-200 text-slate-950 dark:bg-slate-800 dark:text-slate-100 font-extrabold border border-slate-400/50 shadow-xs", dot: "#64748b" },
    obv: { category: "Volume", header: "bg-slate-500/10 border-b border-slate-500/30", badge: "bg-slate-200 text-slate-950 dark:bg-slate-800 dark:text-slate-100 font-extrabold border border-slate-400/50 shadow-xs", dot: "#64748b" },
    cmf: { category: "Volume", header: "bg-slate-500/10 border-b border-slate-500/30", badge: "bg-slate-200 text-slate-950 dark:bg-slate-800 dark:text-slate-100 font-extrabold border border-slate-400/50 shadow-xs", dot: "#64748b" },
    crossover: { category: "Condition", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", dot: "#f97316" },
    rsi_oversold: { category: "Condition", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", dot: "#f97316" },
    rsi_overbought: { category: "Condition", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", dot: "#f97316" },
    macd_bullish: { category: "Signal", header: "bg-emerald-500/10 border-b border-emerald-500/30", badge: "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/70 dark:text-emerald-100 font-extrabold border border-emerald-400/50 shadow-xs", dot: "#22c55e" },
    macd_bearish: { category: "Signal", header: "bg-rose-500/10 border-b border-rose-500/30", badge: "bg-rose-100 text-rose-950 dark:bg-rose-900/70 dark:text-rose-100 font-extrabold border border-rose-400/50 shadow-xs", dot: "#f43f5e" },
    stoch_oversold: { category: "Condition", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", dot: "#f97316" },
    stoch_overbought: { category: "Condition", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", dot: "#f97316" },
    stoch_cross: { category: "Condition", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", dot: "#f97316" },
    adx_strong: { category: "Condition", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", dot: "#f97316" },
    cci_oversold: { category: "Condition", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", dot: "#f97316" },
    cci_overbought: { category: "Condition", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", dot: "#f97316" },
    psar_bull: { category: "Signal", header: "bg-emerald-500/10 border-b border-emerald-500/30", badge: "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/70 dark:text-emerald-100 font-extrabold border border-emerald-400/50 shadow-xs", dot: "#22c55e" },
    vwap_bull: { category: "Signal", header: "bg-sky-500/10 border-b border-sky-500/30", badge: "bg-sky-100 text-sky-950 dark:bg-sky-900/70 dark:text-sky-100 font-extrabold border border-sky-400/50 shadow-xs", dot: "#0ea5e9" },
    ichimoku_bull: { category: "Signal", header: "bg-blue-500/10 border-b border-blue-500/30", badge: "bg-blue-100 text-blue-950 dark:bg-blue-900/70 dark:text-blue-100 font-extrabold border border-blue-400/50 shadow-xs", dot: "#3b82f6" },
    volume_surge: { category: "Condition", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", dot: "#f97316" },
    and: { category: "Logic", header: "bg-indigo-500/10 border-b border-indigo-500/30", badge: "bg-indigo-100 text-indigo-950 dark:bg-indigo-900/70 dark:text-indigo-100 font-extrabold border border-indigo-400/50 shadow-xs", dot: "#6366f1" },
    long_entry: { category: "Execution", header: "bg-blue-500/10 border-b border-blue-500/30", badge: "bg-blue-100 text-blue-950 dark:bg-blue-900/70 dark:text-blue-100 font-extrabold border border-blue-400/50 shadow-xs", dot: "#3b82f6" },
    short_entry: { category: "Execution", header: "bg-rose-500/10 border-b border-rose-500/30", badge: "bg-rose-100 text-rose-950 dark:bg-rose-900/70 dark:text-rose-100 font-extrabold border border-rose-400/50 shadow-xs", dot: "#f43f5e" },
    close_long: { category: "Execution", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", dot: "#f97316" },
    close_short: { category: "Execution", header: "bg-orange-500/10 border-b border-orange-500/30", badge: "bg-orange-100 text-orange-950 dark:bg-orange-900/70 dark:text-orange-100 font-extrabold border border-orange-400/50 shadow-xs", dot: "#f97316" },
    risk_manager: { category: "Risk", header: "bg-red-500/10 border-b border-red-500/30", badge: "bg-red-100 text-red-950 dark:bg-red-900/70 dark:text-red-100 font-extrabold border border-red-400/50 shadow-xs", dot: "#ef4444" },
    plot: { category: "Output", header: "bg-cyan-500/10 border-b border-cyan-500/30", badge: "bg-cyan-100 text-cyan-950 dark:bg-cyan-900/70 dark:text-cyan-100 font-extrabold border border-cyan-400/50 shadow-xs", dot: "#0284c7" },
};

function PineNode({ data, selected }: { data: any; selected?: boolean }) {
    const kind: NodeKind = data.kind;
    const isNodeEnabled = data.enabled !== false;
    const cs = nodeCategoryStyles[kind] || {
        category: "Data",
        header: "bg-amber-500/10 border-b border-amber-500/20",
        badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
        dot: "#f59e0b",
    };
    const label = data.label || nodeTypes[kind]?.label || kind;
    const hint = nodeHint(kind);

    return (
        <div className={`relative rounded-xl border-2 ${selected ? "border-amber-500 ring-2 ring-amber-500/50 shadow-lg scale-102 z-10" : "border-slate-700/60"} bg-card text-card-foreground shadow-sm min-w-[168px] max-w-[208px] select-none transition-all duration-150 ${!isNodeEnabled ? "opacity-60" : ""}`}>
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
                <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground truncate flex-1 leading-tight">
                    {label}
                </span>
            </div>

            {/* Body */}
            <div className="px-2.5 py-2 space-y-1">
                <span className={`inline-flex text-[0.62rem] font-extrabold px-2 py-0.5 rounded-full ${cs.badge}`}>
                    {cs.category}
                </span>
                <p className="text-[9px] leading-3 text-muted-foreground truncate">{hint}</p>
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

    const generatedSource = useMemo(() => mode === "visual" ? createPineSource(flowNodes, flowEdges) : source, [mode, flowNodes, flowEdges, source]);

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
            <aside data-guide="palette" className="self-start rounded-2xl border border-border bg-card p-3.5 space-y-3 shadow-xs">
                {/* Navigation Tabs Header */}
                <div className="flex items-center gap-1 p-1 bg-muted/60 rounded-xl border border-border text-xs font-semibold">
                    <button
                        type="button"
                        onClick={() => setSidebarTab("library")}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1 ${
                            sidebarTab === "library" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                        }`}
                        title="Node Library"
                    >
                        <Plus size={13} className="text-amber-500 shrink-0" />
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
                        <FolderOpen size={13} className="text-amber-500 shrink-0" />
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
                        <Settings2 size={13} className={selectedNodeId ? "text-amber-500 animate-pulse shrink-0" : "shrink-0"} />
                        {selectedNodeId && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500" />}
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
                                className="h-8 text-xs pl-8 bg-background border-border rounded-xl"
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
                                            className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs bg-muted/30 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20 text-foreground transition flex items-center gap-2 group"
                                        >
                                            <Plus size={13} className="text-amber-500 shrink-0 group-hover:scale-110 transition-transform" />
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
                                    className="w-full mt-2 inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-red-500 transition py-1.5 rounded-xl border border-dashed border-border/80 hover:border-red-500/30"
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
                                className="h-8 text-xs pl-8 bg-background border-border rounded-xl"
                            />
                        </div>
                        <div className="space-y-2 max-h-[440px] overflow-y-auto pr-0.5 font-sans">
                            {loadingWorkspaces ? (
                                <p className="text-xs text-muted-foreground text-center py-4">Loading workspaces...</p>
                            ) : filteredWorkspaces.length === 0 ? (
                                <div className="text-center py-6 px-2 rounded-xl border border-dashed border-border">
                                    <FolderOpen size={20} className="mx-auto text-muted-foreground/60 mb-1.5" />
                                    <p className="text-xs text-muted-foreground font-medium">No saved workspaces found</p>
                                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">Build a strategy and click Save</p>
                                </div>
                            ) : (
                                filteredWorkspaces.map((workspace) => (
                                    <div
                                        key={workspace.id}
                                        className="flex flex-col gap-1.5 rounded-xl border border-border bg-background p-2.5 transition hover:border-amber-500/30 hover:bg-muted/40 shadow-xs"
                                    >
                                        <div className="flex items-center justify-between gap-1.5 min-w-0">
                                            <p className="truncate text-xs font-semibold text-foreground flex-1">{workspace.name}</p>
                                            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                                {workspace.type}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground font-mono">
                                            Saved: {new Date(workspace.createdAt).toLocaleDateString()}
                                        </p>
                                        <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/50">
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                onClick={() => openWorkspace(workspace.id)}
                                                className="h-7 text-[11px] font-semibold px-2.5 rounded-lg"
                                            >
                                                Open
                                            </Button>
                                            <button
                                                onClick={() => deleteWorkspace(workspace.id, workspace.name)}
                                                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-muted transition flex items-center justify-center"
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
                                <div className="rounded-xl border border-border bg-muted/40 p-3 space-y-2">
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
                                    <div className="flex items-center gap-1.5 text-[10px]">
                                        <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider">
                                            {selectedNode.kind.replace(/_/g, " ")}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1">
                                        <Info size={11} className="shrink-0 mt-0.5 text-blue-500" />
                                        {nodeHint(selectedNode.kind)}
                                    </p>
                                </div>

                                {/* Node Status Toggle */}
                                <div className="rounded-xl border border-border bg-background p-3 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                            <Layers size={13} className="text-muted-foreground" /> Node Status
                                        </span>
                                        <label className="inline-flex cursor-pointer items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={selectedNode.enabled !== false}
                                                onChange={(e) => updateNodeEnabled(selectedNode.id, e.target.checked)}
                                                className="rounded accent-amber-500 h-4 w-4"
                                            />
                                            <span className="text-xs text-muted-foreground">{selectedNode.enabled !== false ? "Active" : "Disabled"}</span>
                                        </label>
                                    </div>
                                </div>

                                {/* Node Specific Parameters */}
                                {(selectedNode.kind === "moving_average" || selectedNode.kind === "hma" || selectedNode.kind === "rsi" || selectedNode.kind === "macd" || selectedNode.kind === "bollinger" || selectedNode.kind === "keltner" || selectedNode.kind === "donchian" || selectedNode.kind === "supertrend" || selectedNode.kind === "stochastic" || selectedNode.kind === "adx" || selectedNode.kind === "atr" || selectedNode.kind === "cci" || selectedNode.kind === "mfi" || selectedNode.kind === "williams_r" || selectedNode.kind === "roc" || selectedNode.kind === "stddev" || selectedNode.kind === "risk_manager" || selectedNode.kind.includes("oversold") || selectedNode.kind.includes("overbought")) && (
                                    <div className="rounded-xl border border-border bg-background p-3 space-y-2.5">
                                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                            <Sliders size={13} className="text-muted-foreground" /> Parameters
                                        </span>

                                        {(selectedNode.kind === "moving_average" || selectedNode.kind === "hma" || selectedNode.kind === "rsi" || selectedNode.kind === "bollinger" || selectedNode.kind === "keltner" || selectedNode.kind === "donchian" || selectedNode.kind === "adx" || selectedNode.kind === "atr" || selectedNode.kind === "cci" || selectedNode.kind === "mfi" || selectedNode.kind === "williams_r" || selectedNode.kind === "roc" || selectedNode.kind === "stddev") && (
                                            <div className="space-y-1">
                                                <label className="text-[11px] font-medium text-muted-foreground">Period / Length</label>
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
                                                    <label className="text-[11px] font-medium text-muted-foreground">ATR Period</label>
                                                    <Input
                                                        type="number"
                                                        value={selectedNode.config?.atrPeriod ?? 10}
                                                        onChange={(e) => updateNodeConfig(selectedNode.id, "atrPeriod", Number(e.target.value))}
                                                        className="h-8 text-xs bg-background"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[11px] font-medium text-muted-foreground">Factor</label>
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
                                                    <label className="text-[10px] font-medium text-muted-foreground">Fast</label>
                                                    <Input
                                                        type="number"
                                                        value={selectedNode.config?.fast ?? 12}
                                                        onChange={(e) => updateNodeConfig(selectedNode.id, "fast", Number(e.target.value))}
                                                        className="h-8 text-xs bg-background"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-medium text-muted-foreground">Slow</label>
                                                    <Input
                                                        type="number"
                                                        value={selectedNode.config?.slow ?? 26}
                                                        onChange={(e) => updateNodeConfig(selectedNode.id, "slow", Number(e.target.value))}
                                                        className="h-8 text-xs bg-background"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-medium text-muted-foreground">Signal</label>
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
                                                    <label className="text-[11px] font-medium text-muted-foreground">Stop Loss %</label>
                                                    <Input
                                                        type="number"
                                                        step="0.1"
                                                        value={selectedNode.config?.stopLossPct ?? 1.0}
                                                        onChange={(e) => updateNodeConfig(selectedNode.id, "stopLossPct", Number(e.target.value))}
                                                        className="h-8 text-xs bg-background"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[11px] font-medium text-muted-foreground">Take Profit %</label>
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
                            <div className="text-center py-8 px-2 rounded-xl border border-dashed border-border font-sans">
                                <Settings2 size={24} className="mx-auto text-muted-foreground/60 mb-2" />
                                <p className="text-xs font-semibold text-foreground">No Node Selected</p>
                                <p className="text-[10px] text-muted-foreground/70 mt-1 max-w-[180px] mx-auto">
                                    Click any node on the canvas to inspect and edit its parameters.
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </aside>

            <div className="min-w-0 rounded-2xl border border-border bg-card p-4 space-y-4">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Input value={name} onChange={(event) => setName(event.target.value)} className="w-full font-semibold text-sm h-9 bg-background sm:w-72" aria-label="Pine script name" title="Name for this Pine workspace" />
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="flex flex-wrap gap-1 bg-muted p-1 rounded-xl border border-border" data-guide="modes">
                                <button onClick={() => setMode("visual")} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${mode === "visual" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}>Visual</button>
                                <button onClick={() => setMode("code")} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${mode === "code" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}>Code</button>
                                <button onClick={() => setMode("replay")} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${mode === "replay" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}>Replay</button>
                            </div>
                            <div className="h-4 w-px bg-border hidden sm:block" />
                            <div className="flex flex-wrap gap-1.5" data-guide="actions">
                                <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={saveWorkspace} disabled={saving}><Save size={14} className="mr-1" />{saving ? "Saving" : "Save"}</Button>
                                <Button size="sm" variant="outline" onClick={downloadWorkspace}><Download size={14} className="mr-1" />Download</Button>
                            </div>
                        </div>
                    </div>
                    {mode === "visual" && (
                        <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-amber-500/10 p-4" data-guide="ai-builder">
                            <div className="flex items-center gap-2">
                                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10">
                                    <Brain size={14} className="text-amber-500" />
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-foreground">AI Strategy Builder</p>
                                    <p className="text-[10px] text-muted-foreground">Describe it, AI builds it</p>
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
                                    className="bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs h-9 px-4"
                                >
                                    {isAiBuilding ? <Loader2 size={14} className="animate-spin mr-1" /> : <Wand2 size={14} className="mr-1" />}
                                    {isAiBuilding ? "Building..." : "Build"}
                                </Button>
                            </div>
                            {aiStrategyDescription && (
                                <div className="mt-3 rounded-xl border border-border bg-background/80 p-2.5">
                                    <p className="text-[11px] leading-relaxed text-muted-foreground">{aiStrategyDescription}</p>
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
                        className="relative mt-4 min-h-[580px] h-[600px] w-full rounded-2xl border border-border bg-[#030712] overflow-hidden shadow-md"
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
                            connectionLineStyle={{ stroke: "#6366f1", strokeWidth: 2, strokeDasharray: "6 3" }}
                            className="bg-[#030712]"
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
                        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-xs flex-wrap" data-guide="code-toolbar">
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-xs font-semibold text-foreground">Pine Script Editor</span>
                                {appliedStudies.length > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                        <Check size={11} />
                                        {appliedStudies.length} applied
                                    </span>
                                )}
                                {pineResult && pineResult.errors.length === 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                        <Check size={11} />
                                        Runtime compatible
                                    </span>
                                )}
                                {pineResult && pineResult.errors.length > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 px-2.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                                        <AlertTriangle size={11} />
                                        {pineResult.errors.length} error{pineResult.errors.length !== 1 ? "s" : ""}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-mono text-muted-foreground">v6</span>
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
                                            className="bg-amber-500 hover:bg-amber-600 text-white font-medium"
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
                                                className="border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
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
                            className="h-[480px] w-full resize-y rounded-2xl border border-border bg-background p-4 font-mono text-xs leading-relaxed outline-none transition focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20 shadow-xs"
                            aria-label="Pine Script editor"
                            placeholder="// Write your Pine Script v6 code here...&#10;// Click Analyze to check compatibility&#10;// Click Apply to Chart to visualize&#10;&#10;//@version=6&#10;indicator(&#10;    &quot;My Indicator&quot;,&#10;    overlay=true&#10;)&#10;&#10;ema20 = ta.ema(close, 20)&#10;plot(ema20, color=color.blue)"
                        />
                        {showAnalysis && (
                            <div className="mt-4">
                                {isAnalyzing ? (
                                    <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 shadow-xs">
                                        <Loader2 size={16} className="animate-spin text-amber-500" />
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
                            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 shadow-xs">
                                <div className="flex items-start gap-2.5">
                                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-500" />
                                    <div>
                                        <p className="text-xs font-semibold text-red-600 dark:text-red-400">Pine Runtime Errors</p>
                                        <div className="mt-1 space-y-1">
                                            {pineResult.errors.map((err, i) => (
                                                <p key={i} className="text-[11px] leading-relaxed text-muted-foreground font-mono">{err}</p>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {pineResult && pineResult.plots.length > 0 && (
                            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground px-1">
                                <span>Plots: {pineResult.plots.length}</span>
                                {pineResult.hlines.length > 0 && <span>· Hlines: {pineResult.hlines.length}</span>}
                                {pineResult.alerts.length > 0 && <span>· Alerts: {pineResult.alerts.length}</span>}
                                {pineResult.strategy && <span className="text-amber-500 font-medium">· Strategy active</span>}
                            </div>
                        )}
                        {aiStrategyDescription && (
                            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 shadow-xs">
                                <div className="flex items-start gap-2.5">
                                    <Brain size={15} className="mt-0.5 shrink-0 text-amber-500" />
                                    <div>
                                        <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">AI Analysis</p>
                                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{aiStrategyDescription}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                <div className="mt-4 rounded-2xl border border-border bg-card overflow-hidden shadow-xs p-1" data-guide="chart">
                    {mode === "replay" ? (
                        <MarketReplay studies={chartStudies} strategyType={generatedSource.includes("strategy(") ? "strategy" : "indicator"} />
                    ) : (
                        <TradingViewChart key={chartKey} studies={chartStudies} />
                    )}
                </div>
                <div className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-xs space-y-2">
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Generated Pine Preview</p>
                        <Button size="xs" variant="ghost" onClick={copyPineSource} className="text-xs font-medium gap-1.5 text-foreground hover:bg-muted">
                            <Copy size={13} />{copied ? "Copied ✓" : "Copy Pine source"}
                        </Button>
                    </div>
                    <pre className="max-h-48 overflow-auto rounded-xl border border-border/60 bg-background p-3.5 font-mono text-xs leading-relaxed text-foreground">{generatedSource}</pre>
                </div>
                {notice && (
                    <div className="mt-3 rounded-xl border border-border bg-muted/30 px-3.5 py-2 text-xs text-muted-foreground flex items-center justify-between">
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
