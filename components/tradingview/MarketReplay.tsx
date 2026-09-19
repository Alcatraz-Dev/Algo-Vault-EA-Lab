"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Gauge, Pause, Play, RotateCcw, SkipBack, SkipForward, Scissors, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
    CandlestickSeries,
    createChart,
    HistogramSeries,
    IChartApi,
    ISeriesApi,
    LineSeries,
} from "lightweight-charts";
import type { Candle } from "./TradingChart/types";

type MarketReplayProps = {
    studies?: string[];
    strategyType?: "strategy" | "indicator";
};

type TradePosition = {
    type: "LONG" | "SHORT";
    entryPrice: number;
    tp: number;
    sl: number;
    entryBar: number;
    entryTime: number;
};

type ClosedTrade = {
    id: string;
    type: "LONG" | "SHORT";
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPercent: number;
    result: "WIN" | "LOSS";
};

const SYMBOLS = ["FX:EURUSD", "FX:GBPUSD", "FX:USDJPY", "XAU:USD", "XAG:USD", "BTCUSD", "ETHUSD", "INDU", "NAS100", "SPX500"];
const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1D"];
const BAR_COUNTS = [120, 240, 500, 1000];
const SPEEDS = [
    { label: "0.1s / Bar", value: 10 },
    { label: "0.25s / Bar", value: 4 },
    { label: "0.5s / Bar", value: 2 },
    { label: "1s / Bar", value: 1 },
    { label: "2s / Bar", value: 0.5 },
];

function subscribeToTheme(callback: () => void) {
    const observer = new MutationObserver(callback);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
}

function isDarkMode() {
    return document.documentElement.classList.contains("dark");
}

function hashCode(value: string) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
}

function mulberry32(seed: number) {
    return () => {
        let next = (seed += 0x6d2b79f5);
        next = Math.imul(next ^ (next >>> 15), next | 1);
        next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
        return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
}

function intervalToSeconds(intv: string): number {
    if (intv.endsWith("m")) return parseInt(intv, 10) * 60;
    if (intv.endsWith("h")) return parseInt(intv, 10) * 3600;
    if (intv.endsWith("D")) return parseInt(intv, 10) * 86400;
    return 3600;
}

function generateReplayCandles(symbol: string, interval: string, count: number): Candle[] {
    const seconds = intervalToSeconds(interval);
    const seed = hashCode(`${symbol}|${interval}|${count}`);
    const random = mulberry32(seed);
    const basePrice = symbol.includes("BTC") ? 45000 : symbol.includes("ETH") ? 2600 : symbol.includes("XAU") ? 2650 : symbol.includes("XAG") ? 31 : symbol === "INDU" ? 43000 : symbol === "NAS100" ? 20200 : symbol === "SPX500" ? 5600 : symbol.includes("JPY") ? 152 : 1.0850;
    const volBase = symbol.includes("BTC") ? 18 : symbol.includes("ETH") ? 12 : symbol.includes("XAU") || symbol.includes("XAG") ? 240 : symbol === "INDU" || symbol === "NAS100" || symbol === "SPX500" ? 400 : symbol.includes("JPY") ? 1400 : 1200;
    const alignedNow = Math.floor(Date.now() / 1000 / seconds) * seconds;
    const data: Candle[] = [];
    let current = basePrice;
    for (let i = count - 1; i >= 0; i -= 1) {
        const timestamp = alignedNow - i * seconds;
        const volatility = basePrice * 0.008;
        const open = current;
        const wick = (random() - 0.48) * volatility;
        const body = (random() - 0.48) * volatility * 0.75;
        const close = Math.max(open * 0.985, open + body);
        const high = Math.max(open, close) + Math.abs(wick);
        const low = Math.min(open, close) - Math.abs(wick);
        const volume = Math.floor(volBase * (0.4 + random()));
        data.push({ time: timestamp, open, high, low, close, volume });
        current = close;
    }
    return data;
}

function computeEma(values: number[], period: number) {
    const output: (number | null)[] = new Array(values.length).fill(null);
    if (values.length < period) return output;
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    output[period - 1] = ema;
    for (let i = period; i < values.length; i += 1) {
        ema = values[i] * k + ema * (1 - k);
        output[i] = ema;
    }
    return output;
}

function computeBollinger(values: number[], period: number, mult: number) {
    const basis: (number | null)[] = new Array(values.length).fill(null);
    const upper: (number | null)[] = new Array(values.length).fill(null);
    const lower: (number | null)[] = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i += 1) {
        const slice = values.slice(i - period + 1, i + 1);
        const mean = slice.reduce((sum, value) => sum + value, 0) / period;
        const variance = slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
        const sd = Math.sqrt(variance);
        basis[i] = mean;
        upper[i] = mean + mult * sd;
        lower[i] = mean - mult * sd;
    }
    return { basis, upper, lower };
}

function computeRsi(values: number[], period: number) {
    const output: (number | null)[] = new Array(values.length).fill(null);
    if (values.length <= period) return output;
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i += 1) {
        const change = values[i] - values[i - 1];
        if (change >= 0) avgGain += change;
        else avgLoss -= change;
    }
    avgGain /= period;
    avgLoss /= period;
    output[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < values.length; i += 1) {
        const change = values[i] - values[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        if (avgLoss === 0) output[i] = 100;
        else output[i] = 100 - 100 / (1 + avgGain / avgLoss);
    }
    return output;
}

const STUDY_TO_OVERLAY: Record<string, { kind: "ma" | "bb" | "rsi"; label: string; color: string }> = {
    "MASimple@tv-basicstudies": { kind: "ma", label: "EMA 20", color: "#22d3ee" },
    "MAExp@tv-basicstudies": { kind: "ma", label: "EMA 50", color: "#a855f7" },
    "BB@tv-basicstudies": { kind: "bb", label: "Bollinger", color: "#34d399" },
    "RSI@tv-basicstudies": { kind: "rsi", label: "RSI", color: "#f59e0b" },
};

export default function MarketReplay({ studies = [], strategyType = "indicator" }: MarketReplayProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const overlaySeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
    const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [symbol, setSymbol] = useState(SYMBOLS[3]); // XAU:USD
    const [interval, setIntervalState] = useState("1h");
    const [totalBars, setTotalBars] = useState(240);
    const [cursor, setCursor] = useState(120);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [width, setWidth] = useState(800);
    const [isCutoffMode, setIsCutoffMode] = useState(false);

    // Refs for chart click handler
    const isCutoffModeRef = useRef(isCutoffMode);
    useEffect(() => {
        isCutoffModeRef.current = isCutoffMode;
    }, [isCutoffMode]);

    // Paper Trading state
    const [position, setPosition] = useState<TradePosition | null>(null);
    const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
    const [balance, setBalance] = useState(10000);

    const dark = useSyncExternalStore(subscribeToTheme, isDarkMode, () => true);
    const candles = useMemo(() => generateReplayCandles(symbol, interval, totalBars), [symbol, interval, totalBars]);
    
    const candlesRef = useRef(candles);
    useEffect(() => {
        candlesRef.current = candles;
    }, [candles]);

    const visible = useMemo(() => candles.slice(0, Math.max(1, cursor)), [candles, cursor]);
    const currentPrice = visible.length > 0 ? visible[visible.length - 1].close : 0;

    const overlayForStudies = useMemo(() => {
        const seen = new Set<string>();
        const result: { kind: "ma" | "bb" | "rsi"; label: string; color: string }[] = [];
        studies.forEach((id) => {
            const overlay = STUDY_TO_OVERLAY[id];
            if (!overlay || seen.has(overlay.kind)) return;
            seen.add(overlay.kind);
            result.push(overlay);
        });
        return result;
    }, [studies]);

    // Handle paper position TP/SL check on every cursor move
    useEffect(() => {
        if (!position || visible.length === 0) return;
        const currentCandle = visible[visible.length - 1];
        
        let exitPrice: number | null = null;
        let result: "WIN" | "LOSS" = "WIN";

        if (position.type === "LONG") {
            if (currentCandle.high >= position.tp) {
                exitPrice = position.tp;
                result = "WIN";
            } else if (currentCandle.low <= position.sl) {
                exitPrice = position.sl;
                result = "LOSS";
            }
        } else {
            if (currentCandle.low <= position.tp) {
                exitPrice = position.tp;
                result = "WIN";
            } else if (currentCandle.high >= position.sl) {
                exitPrice = position.sl;
                result = "LOSS";
            }
        }

        if (exitPrice !== null) {
            const pnl = position.type === "LONG" 
                ? (exitPrice - position.entryPrice) * 10 
                : (position.entryPrice - exitPrice) * 10;
            const pnlPercent = (pnl / balance) * 100;
            
            setClosedTrades((prev) => [
                {
                    id: `trade-${Date.now()}`,
                    type: position.type,
                    entryPrice: position.entryPrice,
                    exitPrice,
                    pnl,
                    pnlPercent,
                    result,
                },
                ...prev,
            ]);
            setBalance((prev) => prev + pnl);
            setPosition(null);
        }
    }, [visible, position, balance]);

    const openTrade = (type: "LONG" | "SHORT") => {
        if (position || currentPrice === 0) return;
        const mult = symbol.includes("XAU") ? 15 : symbol.includes("BTC") ? 800 : currentPrice * 0.01;
        const entryPrice = currentPrice;
        const tp = type === "LONG" ? entryPrice + mult * 2 : entryPrice - mult * 2;
        const sl = type === "LONG" ? entryPrice - mult : entryPrice + mult;

        setPosition({
            type,
            entryPrice,
            tp,
            sl,
            entryBar: cursor,
            entryTime: visible[visible.length - 1]?.time as number || Date.now(),
        });
    };

    const closePosition = () => {
        if (!position || currentPrice === 0) return;
        const pnl = position.type === "LONG" 
            ? (currentPrice - position.entryPrice) * 10 
            : (position.entryPrice - currentPrice) * 10;
        const pnlPercent = (pnl / balance) * 100;
        const result = pnl >= 0 ? "WIN" : "LOSS";

        setClosedTrades((prev) => [
            {
                id: `trade-${Date.now()}`,
                type: position.type,
                entryPrice: position.entryPrice,
                exitPrice: currentPrice,
                pnl,
                pnlPercent,
                result,
            },
            ...prev,
        ]);
        setBalance((prev) => prev + pnl);
        setPosition(null);
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        function handleResize() {
            const current = containerRef.current;
            if (current) setWidth(current.clientWidth || 800);
        }
        handleResize();
        const observer = new ResizeObserver(handleResize);
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || width < 200) return;

        if (chartRef.current) {
            chartRef.current.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            volumeSeriesRef.current = null;
            overlaySeriesRef.current = new Map();
            rsiSeriesRef.current = null;
        }

        const chart = createChart(container, {
            width,
            height: 580,
            layout: {
                background: { color: dark ? "#0a0d14" : "#ffffff" },
                textColor: dark ? "#94a3b8" : "#475569",
                fontFamily: "Inter, -apple-system, sans-serif",
            },
            grid: {
                vertLines: { color: dark ? "rgba(148, 163, 184, 0.05)" : "rgba(100, 116, 139, 0.08)" },
                horzLines: { color: dark ? "rgba(148, 163, 184, 0.05)" : "rgba(100, 116, 139, 0.08)" },
            },
            rightPriceScale: {
                borderColor: dark ? "rgba(148, 163, 184, 0.15)" : "rgba(100, 116, 139, 0.15)",
                scaleMargins: { top: 0.1, bottom: 0.25 },
            },
            timeScale: {
                borderColor: dark ? "rgba(148, 163, 184, 0.15)" : "rgba(100, 116, 139, 0.15)",
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 6,
                barSpacing: 8,
            },
            crosshair: {
                mode: 0,
            },
        });
        chartRef.current = chart;

        // Register Cut Mode Chart Click Handler
        chart.subscribeClick((param) => {
            if (!isCutoffModeRef.current || !param.time) return;
            const targetTime = typeof param.time === "number" ? param.time : (param.time as any).timestamp || param.time;
            const foundIndex = candlesRef.current.findIndex((c) => c.time === targetTime);
            if (foundIndex !== -1) {
                setCursor(foundIndex + 1);
                setIsCutoffMode(false);
                setPlaying(false);
            }
        });

        candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: "#10b981",
            downColor: "#ef4444",
            borderDownColor: "#ef4444",
            borderUpColor: "#10b981",
            wickDownColor: "#ef4444",
            wickUpColor: "#10b981",
        });

        try {
            volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
                color: "#10b981",
                priceFormat: { type: "volume" },
                priceScaleId: "",
            });
            chart.priceScale("").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        } catch {
            volumeSeriesRef.current = null;
        }

        overlayForStudies.forEach((overlay) => {
            if (overlay.kind === "bb") {
                overlaySeriesRef.current.set("bb", chart.addSeries(LineSeries, { color: "#64748b", lineWidth: 1 }));
                overlaySeriesRef.current.set("bb-upper", chart.addSeries(LineSeries, { color: overlay.color, lineWidth: 1 }));
                overlaySeriesRef.current.set("bb-lower", chart.addSeries(LineSeries, { color: overlay.color, lineWidth: 1 }));
            } else if (overlay.kind === "rsi") {
                const series = chart.addSeries(LineSeries, {
                    color: overlay.color,
                    lineWidth: 2,
                    priceScaleId: "rsi",
                });
                chart.priceScale("rsi").applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
                rsiSeriesRef.current = series;
            } else {
                overlaySeriesRef.current.set(overlay.kind, chart.addSeries(LineSeries, { color: overlay.color, lineWidth: 2 }));
            }
        });

        return () => {
            chart.remove();
            chartRef.current = null;
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [width, dark, overlayForStudies]);

    const drawSlice = useCallback(() => {
        const chart = chartRef.current;
        if (!chart) return;
        candleSeriesRef.current?.setData(visible as never);
        if (volumeSeriesRef.current) {
            volumeSeriesRef.current.setData(
                visible.map((c) => ({
                    time: c.time as never,
                    value: c.volume,
                    color: c.close >= c.open ? "rgba(16, 185, 129, 0.5)" : "rgba(239, 68, 68, 0.5)",
                }))
            );
        }

        const closes = visible.map((c) => c.close);
        overlayForStudies.forEach((overlay) => {
            if (overlay.kind === "ma") {
                const values = computeEma(closes, 20);
                const points = values.map((value, i) => ({ time: visible[i].time, value })).filter((point) => point.value !== null) as never;
                overlaySeriesRef.current.get("ma")?.setData(points);
            } else if (overlay.kind === "bb") {
                const { basis, upper, lower } = computeBollinger(closes, 20, 2);
                const pointsFor = (values: (number | null)[]) => values.map((value, i) => ({ time: visible[i].time, value })).filter((point) => point.value !== null);
                overlaySeriesRef.current.get("bb")?.setData(pointsFor(basis) as never);
                overlaySeriesRef.current.get("bb-upper")?.setData(pointsFor(upper) as never);
                overlaySeriesRef.current.get("bb-lower")?.setData(pointsFor(lower) as never);
            } else if (overlay.kind === "rsi") {
                const values = computeRsi(closes, 14);
                const points = values.map((value, i) => ({ time: visible[i].time, value })).filter((point) => point.value !== null) as never;
                rsiSeriesRef.current?.setData(points);
            }
        });

        if (playing) {
            chart.timeScale().scrollToRealTime();
        } else {
            chart.timeScale().fitContent();
        }
    }, [visible, overlayForStudies, playing]);

    useEffect(() => {
        drawSlice();
    }, [drawSlice]);

    useEffect(() => {
        if (!playing) return;
        timerRef.current = setInterval(() => {
            setCursor((prev) => {
                if (prev >= totalBars) {
                    setPlaying(false);
                    return prev;
                }
                return prev + 1;
            });
        }, 1000 / speed);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [playing, speed, totalBars]);

    useEffect(() => () => {
        if (timerRef.current) clearInterval(timerRef.current);
    }, []);

    const totalWins = closedTrades.filter((t) => t.result === "WIN").length;
    const totalTrades = closedTrades.length;
    const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(0) : "0";
    const netPnL = balance - 10000;

    const floatingPnL = position ? (position.type === "LONG" ? (currentPrice - position.entryPrice) * 10 : (position.entryPrice - currentPrice) * 10) : 0;

    return (
        <div className="mt-4 space-y-3 font-sans">
            {/* TradingView Bar Replay Floating Control Dock */}
            <div className="rounded-2xl border border-border/80 bg-card/95 p-3 sm:p-4 shadow-xl backdrop-blur-xl">
                <div className="flex flex-col gap-3.5 xl:flex-row xl:items-center xl:justify-between">
                    
                    {/* Left: Replay Status & Symbol Selector */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500/10 px-3 py-2 font-bold uppercase tracking-wider text-violet-400 border border-violet-500/20 shadow-sm whitespace-nowrap shrink-0">
                            <Scissors size={14} className="text-violet-400 shrink-0" /> REPLAY
                        </span>

                        <select
                            value={symbol}
                            onChange={(e) => { setSymbol(e.target.value); setCursor(120); setPlaying(false); setPosition(null); }}
                            className="h-9 rounded-xl border border-border bg-background px-3 text-xs font-semibold text-foreground outline-none focus:border-violet-500 transition whitespace-nowrap shrink-0"
                        >
                            {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>

                        <select
                            value={interval}
                            onChange={(e) => { setIntervalState(e.target.value); setCursor(120); setPlaying(false); }}
                            className="h-9 rounded-xl border border-border bg-background px-3 text-xs font-semibold text-foreground outline-none focus:border-violet-500 transition whitespace-nowrap shrink-0"
                        >
                            {INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
                        </select>

                        <select
                            value={totalBars}
                            onChange={(e) => { setTotalBars(Number(e.target.value)); setCursor(Math.min(cursor, Number(e.target.value))); setPlaying(false); }}
                            className="h-9 rounded-xl border border-border bg-background px-3 text-xs text-muted-foreground outline-none transition whitespace-nowrap shrink-0"
                        >
                            {BAR_COUNTS.map((count) => <option key={count} value={count}>{count} Bars</option>)}
                        </select>
                    </div>

                    {/* Center: Play / Pause / Step / Cut Controls */}
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 self-stretch xl:self-auto">
                        <button
                            type="button"
                            onClick={() => { setIsCutoffMode(!isCutoffMode); setPlaying(false); }}
                            className={`h-9 px-3.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition border flex items-center gap-1.5 ${
                                isCutoffMode 
                                    ? "bg-rose-500/20 text-rose-400 border-rose-500/50 shadow-sm animate-pulse" 
                                    : "bg-muted/50 text-muted-foreground border-border hover:text-foreground"
                            }`}
                            title="Click to activate Cut Mode, then click any candle on the chart below to jump replay cutoff"
                        >
                            <Scissors size={13} className="shrink-0" /> 
                            <span>{isCutoffMode ? "Click Bar on Chart..." : "Cut Mode"}</span>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                            <button
                                type="button"
                                onClick={() => { setCursor((p) => Math.max(1, p - 1)); setPlaying(false); }}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background hover:bg-muted text-foreground transition active:scale-95 shrink-0"
                                title="Step Back (1 Bar)"
                            >
                                <SkipBack size={15} />
                            </button>

                            <button
                                type="button"
                                onClick={() => setPlaying((p) => !p)}
                                className="flex h-9 w-11 items-center justify-center rounded-xl bg-violet-600 text-white font-bold hover:bg-violet-500 transition shadow-md shadow-violet-600/20 active:scale-95 shrink-0"
                                title={playing ? "Pause" : "Play Sequential Bars"}
                            >
                                {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                            </button>

                            <button
                                type="button"
                                onClick={() => { setCursor((p) => Math.min(totalBars, p + 1)); setPlaying(false); }}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background hover:bg-muted text-foreground transition active:scale-95 shrink-0"
                                title="Step Forward (1 Bar)"
                            >
                                <SkipForward size={15} />
                            </button>

                            <button
                                type="button"
                                onClick={() => { setCursor(10); setPlaying(false); setPosition(null); }}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background hover:bg-muted text-muted-foreground transition active:scale-95 shrink-0"
                                title="Reset to Start"
                            >
                                <RotateCcw size={15} />
                            </button>
                        </div>

                        <select
                            value={speed}
                            onChange={(e) => setSpeed(Number(e.target.value))}
                            className="h-9 rounded-xl border border-border bg-background px-3 text-xs font-mono outline-none transition whitespace-nowrap shrink-0"
                        >
                            {SPEEDS.map((s) => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Right: Paper Execution Buttons (Never Wrap Text) */}
                    <div className="flex items-center gap-2 shrink-0">
                        {position ? (
                            <button
                                type="button"
                                onClick={closePosition}
                                className="h-9 px-4 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold whitespace-nowrap shrink-0 hover:bg-amber-500/30 transition inline-flex items-center gap-1.5"
                            >
                                <RefreshCw size={13} className="shrink-0" /> Flat ({floatingPnL >= 0 ? `+$${floatingPnL.toFixed(2)}` : `-$${Math.abs(floatingPnL).toFixed(2)}`})
                            </button>
                        ) : (
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => openTrade("LONG")}
                                    className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wider uppercase whitespace-nowrap shadow-md hover:shadow-emerald-500/20 active:scale-95 transition inline-flex items-center gap-1.5 shrink-0"
                                >
                                    <TrendingUp size={14} className="shrink-0" /> Buy Long
                                </button>
                                <button
                                    type="button"
                                    onClick={() => openTrade("SHORT")}
                                    className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs tracking-wider uppercase whitespace-nowrap shadow-md hover:shadow-rose-500/20 active:scale-95 transition inline-flex items-center gap-1.5 shrink-0"
                                >
                                    <TrendingDown size={14} className="shrink-0" /> Sell Short
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Scrubber Range & Cutoff Status Indicator */}
                <div className="mt-3 pt-2 border-t border-border/40 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Replay Scrubber: Bar #{cursor} of {totalBars}
                        </span>
                        <span className="text-foreground font-bold">
                            Current Price: ${(currentPrice).toFixed(2)}
                        </span>
                    </div>

                    <input
                        type="range"
                        min={1}
                        max={totalBars}
                        value={cursor}
                        onChange={(e) => { setCursor(Number(e.target.value)); setPlaying(false); }}
                        className="w-full accent-violet-500 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer"
                    />
                </div>
            </div>

            {/* Live Paper Trading Scoreboard Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="rounded-xl border border-border/60 bg-card/60 p-2.5 flex items-center justify-between">
                    <span className="text-muted-foreground">Paper Balance:</span>
                    <span className="font-bold text-foreground">${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="rounded-xl border border-border/60 bg-card/60 p-2.5 flex items-center justify-between">
                    <span className="text-muted-foreground">Net Replay PnL:</span>
                    <span className={`font-bold ${netPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {netPnL >= 0 ? `+$${netPnL.toFixed(2)}` : `-$${Math.abs(netPnL).toFixed(2)}`}
                    </span>
                </div>
                <div className="rounded-xl border border-border/60 bg-card/60 p-2.5 flex items-center justify-between">
                    <span className="text-muted-foreground">Win Rate:</span>
                    <span className="font-bold text-violet-400">{winRate}% ({totalWins}/{totalTrades})</span>
                </div>
                <div className="rounded-xl border border-border/60 bg-card/60 p-2.5 flex items-center justify-between">
                    <span className="text-muted-foreground">Open Position:</span>
                    {position ? (
                        <span className={`font-bold ${position.type === "LONG" ? "text-emerald-400" : "text-rose-400"}`}>
                            {position.type} @ ${position.entryPrice.toFixed(2)}
                        </span>
                    ) : (
                        <span className="text-muted-foreground">None</span>
                    )}
                </div>
            </div>

            {/* Active Cut Mode Banner Overlay */}
            {isCutoffMode && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-center text-xs font-mono font-bold text-rose-300 animate-pulse">
                    ✂️ CUT MODE ACTIVE: Click any candle on the chart below to set the replay cut-off point.
                </div>
            )}

            {/* TradingView Lightweight Chart Container */}
            <div ref={containerRef} className={`relative overflow-hidden rounded-2xl border border-border/80 bg-card/90 shadow-2xl transition-all ${isCutoffMode ? "cursor-crosshair ring-2 ring-rose-500/50" : ""}`} style={{ height: 580 }} />
        </div>
    );
}