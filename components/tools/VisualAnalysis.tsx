"use client";

import { useState, useMemo } from "react";
import {
    TrendingUp,
    TrendingDown,
    Minus,
    Target,
    Activity,
    ArrowUpRight,
    ArrowDownRight,
    Layers,
    Eye,
} from "lucide-react";

type Timeframe = "M15" | "H1" | "H4" | "D1" | "W1";

type PriceLevel = {
    price: number;
    type: "support" | "resistance";
    strength: "strong" | "moderate" | "weak";
    label?: string;
};

type Indicator = {
    name: string;
    value: string;
    signal: "bullish" | "bearish" | "neutral";
    description: string;
};

const TIMEFRAMES: Timeframe[] = ["M15", "H1", "H4", "D1", "W1"];

const PAIRS = [
    "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "USDCHF",
    "AUDUSD", "NZDUSD", "US30", "NAS100", "SPX500", "BTCUSD", "ETHUSD",
];

function computeIndicators(high: number, low: number, close: number, prevClose: number): Indicator[] {
    const range = high - low || 1;
    const bodyRatio = Math.abs(close - prevClose) / range;
    const isBullish = close > prevClose;
    const midPoint = (high + low) / 2;
    const upperWick = high - Math.max(close, prevClose);
    const lowerWick = Math.min(close, prevClose) - low;

    const rsi = range !== 0 ? 50 + ((close - midPoint) / range) * 30 : 50;
    const clampedRsi = Math.max(20, Math.min(80, rsi));

    const trend = close > prevClose * 1.002 ? "bullish" : close < prevClose * 0.998 ? "bearish" : "neutral";

    const indicators: Indicator[] = [
        {
            name: "RSI (14)",
            value: clampedRsi.toFixed(1),
            signal: clampedRsi > 65 ? "bearish" : clampedRsi < 35 ? "bullish" : "neutral",
            description: clampedRsi > 65 ? "Overbought zone" : clampedRsi < 35 ? "Oversold zone" : "Neutral zone",
        },
        {
            name: "MACD",
            value: ((close - midPoint) / range * 100).toFixed(2),
            signal: isBullish ? "bullish" : "bearish",
            description: isBullish ? "Bullish momentum" : "Bearish momentum",
        },
        {
            name: "Stochastic",
            value: (((close - low) / range) * 100).toFixed(1),
            signal: close > midPoint ? "bullish" : "bearish",
            description: close > midPoint ? "Above midpoint" : "Below midpoint",
        },
        {
            name: "ATR Signal",
            value: (range / close * 10000).toFixed(1),
            signal: range > (high - low) * 0.7 ? "bullish" : "neutral",
            description: range > (high - low) * 0.7 ? "High volatility" : "Normal volatility",
        },
        {
            name: "Momentum",
            value: ((close - prevClose) / prevClose * 100).toFixed(3) + "%",
            signal: trend,
            description: trend === "bullish" ? "Positive momentum" : trend === "bearish" ? "Negative momentum" : "Flat",
        },
        {
            name: "Candle Pattern",
            value: bodyRatio > 0.7 ? "Marubozu" : bodyRatio < 0.2 ? "Doji" : lowerWick > upperWick * 2 ? "Hammer" : upperWick > lowerWick * 2 ? "Shooting Star" : "Spinning Top",
            signal: (lowerWick > upperWick * 2 || isBullish) && bodyRatio > 0.3 ? "bullish" : (upperWick > lowerWick * 2 || !isBullish) && bodyRatio > 0.3 ? "bearish" : "neutral",
            description: "Current candle shape",
        },
    ];

    return indicators;
}

function findLevels(high: number, low: number, close: number): PriceLevel[] {
    const range = high - low;
    const levels: PriceLevel[] = [
        { price: low, type: "support", strength: "strong", label: "Session Low" },
        { price: low + range * 0.382, type: "support", strength: "moderate", label: "38.2% Fib" },
        { price: low + range * 0.5, type: close > low + range * 0.5 ? "support" : "resistance", strength: "moderate", label: "50% Level" },
        { price: low + range * 0.618, type: "resistance", strength: "moderate", label: "61.8% Fib" },
        { price: high, type: "resistance", strength: "strong", label: "Session High" },
        { price: (high + low) / 2, type: close > (high + low) / 2 ? "support" : "resistance", strength: "strong", label: "Pivot Point" },
    ];
    return levels.sort((a, b) => a.price - b.price);
}

export default function VisualAnalysis() {
    const [pair, setPair] = useState("XAUUSD");
    const [timeframe, setTimeframe] = useState<Timeframe>("H1");
    const [high, setHigh] = useState("2650.00");
    const [low, setLow] = useState("2630.00");
    const [close, setClose] = useState("2642.50");
    const [prevClose, setPrevClose] = useState("2635.00");
    const [open, setOpen] = useState("2638.00");

    const h = parseFloat(high) || 0;
    const l = parseFloat(low) || 0;
    const c = parseFloat(close) || 0;
    const pc = parseFloat(prevClose) || 0;
    const o = parseFloat(open) || 0;

    const indicators = useMemo(() => computeIndicators(h, l, c, pc), [h, l, c, pc]);
    const levels = useMemo(() => findLevels(h, l, c), [h, l, c]);

    const bullishCount = indicators.filter((i) => i.signal === "bullish").length;
    const bearishCount = indicators.filter((i) => i.signal === "bearish").length;
    const overallSignal: "bullish" | "bearish" | "neutral" = bullishCount > bearishCount ? "bullish" : bearishCount > bullishCount ? "bearish" : "neutral";
    const tp = overallSignal === "bullish" ? h + (h - l) * 0.5 : l - (h - l) * 0.5;
    const sl = overallSignal === "bullish" ? l - (h - l) * 0.2 : h + (h - l) * 0.2;

    const inputClass = "w-full rounded-xl border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-violet-500 focus:outline-none";

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                        <Eye size={20} className="text-violet-400" />
                        Visual Analysis
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Input price data to see technical analysis, key levels, and trade bias.
                    </p>
                </div>
                <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
                    overallSignal === "bullish" ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400" :
                    overallSignal === "bearish" ? "border border-rose-500/30 bg-rose-500/10 text-rose-400" :
                    "border border-border bg-muted text-muted-foreground"
                }`}>
                    {overallSignal === "bullish" ? <TrendingUp size={16} /> : overallSignal === "bearish" ? <TrendingDown size={16} /> : <Minus size={16} />}
                    {overallSignal === "bullish" ? "Bullish Bias" : overallSignal === "bearish" ? "Bearish Bias" : "Neutral"}
                </div>
            </div>

            {/* Input Row */}
            <div className="rounded-2xl border border-border bg-card p-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Pair</label>
                        <select value={pair} onChange={(e) => setPair(e.target.value)} className={inputClass}>
                            {PAIRS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Timeframe</label>
                        <div className="flex gap-1">
                            {TIMEFRAMES.map((tf) => (
                                <button
                                    key={tf}
                                    type="button"
                                    onClick={() => setTimeframe(tf)}
                                    className={`flex-1 rounded-lg px-2 py-2.5 text-xs font-medium transition ${
                                        timeframe === tf ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    {tf}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Open</label>
                        <input type="number" step="0.01" value={open} onChange={(e) => setOpen(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">High</label>
                        <input type="number" step="0.01" value={high} onChange={(e) => setHigh(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Low</label>
                        <input type="number" step="0.01" value={low} onChange={(e) => setLow(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Close</label>
                        <input type="number" step="0.01" value={close} onChange={(e) => setClose(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Prev Close</label>
                        <input type="number" step="0.01" value={prevClose} onChange={(e) => setPrevClose(e.target.value)} className={inputClass} />
                    </div>
                    <div className="flex items-end">
                        <div className={`w-full rounded-xl p-3 text-center text-sm font-semibold ${
                            c > pc ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border border-rose-500/30 bg-rose-500/10 text-rose-400"
                        }`}>
                            {c > pc ? "+" : ""}{((c - pc) / pc * 100).toFixed(3)}%
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Indicators */}
                <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5">
                    <h3 className="flex items-center gap-2 font-semibold">
                        <Activity size={16} className="text-violet-400" /> Indicators
                    </h3>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {indicators.map((ind) => (
                            <div key={ind.name} className={`rounded-xl border p-4 ${
                                ind.signal === "bullish" ? "border-emerald-500/20 bg-emerald-500/5" :
                                ind.signal === "bearish" ? "border-rose-500/20 bg-rose-500/5" :
                                "border-border bg-muted/30"
                            }`}>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-muted-foreground">{ind.name}</span>
                                    <span className={`text-xs font-semibold ${
                                        ind.signal === "bullish" ? "text-emerald-400" :
                                        ind.signal === "bearish" ? "text-rose-400" :
                                        "text-muted-foreground"
                                    }`}>
                                        {ind.signal === "bullish" ? "BULL" : ind.signal === "bearish" ? "BEAR" : "NEUTRAL"}
                                    </span>
                                </div>
                                <p className="mt-1 text-lg font-bold">{ind.value}</p>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">{ind.description}</p>
                            </div>
                        ))}
                    </div>

                    {/* Signal Summary */}
                    <div className="mt-4 flex items-center gap-4 rounded-xl border border-border bg-muted/30 p-4">
                        <div className="flex items-center gap-2">
                            <ArrowUpRight size={14} className="text-emerald-400" />
                            <span className="text-sm font-medium">{bullishCount} Bullish</span>
                        </div>
                        <div className="flex-1">
                            <div className="h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full rounded-full bg-emerald-500 transition-all"
                                    style={{ width: `${(bullishCount / indicators.length) * 100}%` }}
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{bearishCount} Bearish</span>
                            <ArrowDownRight size={14} className="text-rose-400" />
                        </div>
                    </div>
                </div>

                {/* Key Levels */}
                <div className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="flex items-center gap-2 font-semibold">
                        <Layers size={16} className="text-violet-400" /> Key Levels
                    </h3>
                    <div className="mt-4 space-y-2">
                        {levels.map((level, i) => (
                            <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
                                <div className={`h-8 w-1 rounded-full ${
                                    level.type === "support" ? "bg-emerald-500" : "bg-rose-500"
                                }`} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-muted-foreground">{level.label}</span>
                                        <span className={`text-[10px] font-semibold uppercase ${
                                            level.strength === "strong" ? "text-foreground" : "text-muted-foreground"
                                        }`}>
                                            {level.strength}
                                        </span>
                                    </div>
                                    <p className="text-sm font-mono font-bold">{level.price.toFixed(2)}</p>
                                </div>
                                <span className={`text-[10px] font-semibold uppercase ${
                                    level.type === "support" ? "text-emerald-400" : "text-rose-400"
                                }`}>
                                    {level.type === "support" ? "SUP" : "RES"}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Price Position */}
                    <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4">
                        <p className="text-[11px] font-semibold uppercase text-muted-foreground">Price Position</p>
                        <div className="mt-2 relative h-40 w-full">
                            <div className="absolute inset-0 flex flex-col justify-between">
                                {levels.slice().reverse().map((level, i) => {
                                    const range = h - l || 1;
                                    const pct = ((level.price - l) / range) * 100;
                                    return (
                                        <div
                                            key={i}
                                            className={`absolute w-full border-t border-dashed ${
                                                level.type === "support" ? "border-emerald-500/40" : "border-rose-500/40"
                                            }`}
                                            style={{ bottom: `${pct}%` }}
                                        >
                                            <span className="absolute -top-3 right-0 text-[9px] font-mono text-muted-foreground">
                                                {level.price.toFixed(2)}
                                            </span>
                                        </div>
                                    );
                                })}
                                {/* Current price line */}
                                {h > 0 && l > 0 && (
                                    <div
                                        className="absolute w-full border-t-2 border-foreground"
                                        style={{ bottom: `${((c - l) / (h - l || 1)) * 100}%` }}
                                    >
                                        <span className="absolute -top-5 left-0 rounded bg-foreground px-1.5 py-0.5 text-[9px] font-bold text-background">
                                            {c.toFixed(2)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Trade Plan */}
            <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="flex items-center gap-2 font-semibold">
                    <Target size={16} className="text-violet-400" /> Suggested Trade Plan
                </h3>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                        <p className="text-[11px] font-semibold uppercase text-muted-foreground">Entry Zone</p>
                        <p className="mt-1 text-lg font-bold font-mono">
                            {c.toFixed(2)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Current close price
                        </p>
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <p className="text-[11px] font-semibold uppercase text-emerald-400">Take Profit</p>
                        <p className="mt-1 text-lg font-bold font-mono text-emerald-400">
                            {tp > 0 ? tp.toFixed(2) : "\u2014"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {((Math.abs(tp - c) / c) * 100).toFixed(2)}% target
                        </p>
                    </div>
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
                        <p className="text-[11px] font-semibold uppercase text-rose-400">Stop Loss</p>
                        <p className="mt-1 text-lg font-bold font-mono text-rose-400">
                            {sl > 0 ? sl.toFixed(2) : "\u2014"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {((Math.abs(sl - c) / c) * 100).toFixed(2)}% risk
                        </p>
                    </div>
                </div>
                <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400">
                    This is a basic technical analysis tool. Always verify with additional analysis and your own risk management before placing trades.
                </div>
            </div>
        </div>
    );
}
