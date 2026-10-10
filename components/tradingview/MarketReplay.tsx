"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Gauge, Pause, Play, RotateCcw, SkipBack, SkipForward, Scissors, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
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
    /** Optional TradingView-style symbol override, e.g. "FX:EURUSD" or "OANDA:XAUUSD". */
    symbol?: string;
    /** Optional interval override, e.g. "1m", "15m", "1h", "4h", "1D". */
    interval?: string;
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

const SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD", "US30", "NAS100", "SPX500"];

/** Map a replay UI symbol onto the canonical feed symbol (identity here, kept for callers). */
export function resolveReplaySymbol(rawSymbol: string): string | null {
    if (!rawSymbol) return null;
    const raw = rawSymbol.toUpperCase().replace(/^(FX|OANDA|COINBASE|TVC|INDEX):/, "").replace(/^XAU:USD$/, "XAUUSD").replace(/^XAG:USD$/, "XAGUSD");
    if (SYMBOLS.includes(raw)) return raw;
    if (raw.includes("XAU")) return "XAUUSD";
    if (raw.includes("XAG")) return "XAGUSD";
    if (raw.includes("BTC")) return "BTCUSD";
    if (raw.includes("ETH")) return "ETHUSD";
    if (raw.includes("NAS")) return "NAS100";
    if (raw.includes("SPX")) return "SPX500";
    if (raw.includes("DOW") || raw.includes("INDU")) return "US30";
    if (raw.includes("JPY")) return "USDJPY";
    if (raw.includes("GBP")) return "GBPUSD";
    if (raw.includes("EUR")) return "EURUSD";
    return null;
}

/** Map raw signal timeframes ("M1", "H1", "D1"…) onto replay intervals. */
export function resolveReplayInterval(rawTimeframe: string): string | null {
    const tf = String(rawTimeframe || "").toUpperCase();
    if (/^M(\d+)$/.test(tf)) return `${tf.slice(1)}m`;
    if (/^H(\d+)$/.test(tf)) return `${tf.slice(1)}h`;
    if (/^D(\d+)$/.test(tf)) return "1D";
    if (/^(\d+)(m|h|D)$/.test(tf)) return tf;
    return null;
}
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

export default function MarketReplay({ studies = [], strategyType = "indicator", symbol: symbolProp, interval: intervalProp }: MarketReplayProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const overlaySeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
    const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [symbol, setSymbol] = useState(() => resolveReplaySymbol(symbolProp ?? "") ?? SYMBOLS[3]); // XAU:USD fallback
    const [interval, setIntervalState] = useState(() => resolveReplayInterval(intervalProp ?? "") ?? "1h");

    // Keep internal selectors in sync when a parent passes a new signal
    // symbol/interval — using the React "adjust state during render" pattern
    // (setState during render is allowed for derived resets).
    const [lastProp, setLastProp] = useState({ symbol: symbolProp, interval: intervalProp });
    if (lastProp.symbol !== symbolProp || lastProp.interval !== intervalProp) {
        setLastProp({ symbol: symbolProp, interval: intervalProp });
        const resolvedSymbol = resolveReplaySymbol(symbolProp ?? "");
        if (resolvedSymbol && resolvedSymbol !== symbol) setSymbol(resolvedSymbol);
        const resolvedInterval = resolveReplayInterval(intervalProp ?? "");
        if (resolvedInterval && resolvedInterval !== interval) setIntervalState(resolvedInterval);
    }
    const [totalBars, setTotalBars] = useState(240);
    const [cursor, setCursor] = useState(120);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [width, setWidth] = useState(800);
    const [chartHeight, setChartHeight] = useState(540);
    const [isCutoffMode, setIsCutoffMode] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

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

    // ── Real market data: replay actual provider candles ──────────────────
    // The replay scrubs through REAL historical candles fetched from the
    // canonical feed — no synthetic/random candles are generated.
    const timeframe = useMemo(() => {
        const intv = interval;
        if (intv.endsWith("m")) return `M${parseInt(intv, 10)}`;
        if (intv.endsWith("h")) return `H${parseInt(intv, 10)}`;
        return "D1";
    }, [interval]);

    const [realCandles, setRealCandles] = useState<Candle[]>([]);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isLoadingData, setIsLoadingData] = useState(true);
    // Tracks the last requested key so a key change can flip the loading flag
    // during render (derived state) instead of inside the effect body.
    const [loadedKey, setLoadedKey] = useState("");
    const requestKey = `${symbol}|${timeframe}|${totalBars}`;
    if (loadedKey !== requestKey && isLoadingData === false && realCandles.length >= 0) {
        // Key changed: show loading state for the new request immediately.
        setIsLoadingData(true);
        setLoadedKey(requestKey);
    }

    useEffect(() => {
        const ctrl = new AbortController();
        let cancelled = false;

        (async () => {
            try {
                const res = await fetch(
                    `/api/replay-data?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${totalBars}`,
                    { signal: ctrl.signal, cache: "no-store" }
                );
                const body = (await res.json().catch(() => null)) as
                    | { candles?: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume?: number }>; error?: string }
                    | null;
                if (cancelled) return;
                if (!res.ok || !body?.candles?.length) {
                    setLoadError(body?.error ?? `No ${timeframe} candles returned for ${symbol}.`);
                    setIsLoadingData(false);
                    setLoadedKey(requestKey);
                    return;
                }
                const mapped: Candle[] = body.candles
                    .map((c) => ({
                        time: Math.floor(c.timestamp / 1000),
                        open: c.open,
                        high: c.high,
                        low: c.low,
                        close: c.close,
                        volume: c.volume ?? 0,
                    }))
                    .sort((a, b) => a.time - b.time);
                setLoadError(null);
                setRealCandles(mapped);
                setIsLoadingData(false);
                setLoadedKey(requestKey);
            } catch (err) {
                if (cancelled || (err as Error)?.name === "AbortError") return;
                setLoadError("Failed to load market data.");
                setIsLoadingData(false);
                setLoadedKey(requestKey);
            }
        })();

        return () => {
            cancelled = true;
            ctrl.abort();
        };
    }, [symbol, timeframe, totalBars, requestKey]);

    const candles = realCandles;

    // Clamp the playhead to the actual candle count once real data lands
    // (adjust-during-render pattern; no effect needed).
    if (candles.length > 0 && cursor > candles.length) {
        setCursor(candles.length);
    }

    const candlesRef = useRef(candles);
    useEffect(() => {
        candlesRef.current = candles;
    }, [candles]);

    const visible = useMemo(() => candles.slice(0, Math.max(1, Math.min(cursor, candles.length))), [candles, cursor]);
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
            
            void Promise.resolve().then(() => {
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
            });
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
            if (current) {
                setWidth(current.clientWidth || 800);
                const measuredH = current.clientHeight || (window.innerWidth < 640 ? 380 : window.innerWidth < 1024 ? 480 : 560);
                setChartHeight(measuredH);
            }
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
            height: chartHeight,
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
            const targetTime = typeof param.time === "number" ? param.time : ((param.time as { timestamp?: number }).timestamp ?? param.time);
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
    }, [width, chartHeight, dark, overlayForStudies]);

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
                if (prev >= candles.length) {
                    setPlaying(false);
                    return prev;
                }
                return prev + 1;
            });
        }, 1000 / speed);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [playing, speed, candles.length]);

    useEffect(() => () => {
        if (timerRef.current) clearInterval(timerRef.current);
    }, []);

    const totalWins = closedTrades.filter((t) => t.result === "WIN").length;
    const totalTrades = closedTrades.length;
    const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(0) : "0";
    const netPnL = balance - 10000;

    const floatingPnL = position ? (position.type === "LONG" ? (currentPrice - position.entryPrice) * 10 : (position.entryPrice - currentPrice) * 10) : 0;

    return (
        <div className="mt-4 space-y-4 font-sans">
            {/* TradingView Bar Replay Control Dock */}
            <div className="rounded-lg border border-border bg-card p-3 shadow-xs overflow-x-auto">
                <div className="flex items-center justify-between gap-2 min-w-[760px] whitespace-nowrap">
                    
                    {/* Left: Replay Status & Asset Selectors */}
                    <div className="flex items-center gap-1.5 text-xs shrink-0">
                        <span className="inline-flex items-center gap-1 rounded-lg bg-warning/10 px-2.5 py-1.5 text-micro font-bold uppercase tracking-wider text-warning border border-warning/20 shadow-xs shrink-0">
                            <Scissors size={12} className="text-warning shrink-0" /> REPLAY
                        </span>

                        <select
                            value={symbol}
                            onChange={(e) => { setSymbol(e.target.value); setCursor(120); setPlaying(false); setPosition(null); setClosedTrades([]); setBalance(10000); }}
                            className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground outline-none focus:ring-2 focus:ring-warning/20 transition shrink-0"
                        >
                            {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>

                        <select
                            value={interval}
                            onChange={(e) => { setIntervalState(e.target.value); setCursor(120); setPlaying(false); setPosition(null); setClosedTrades([]); setBalance(10000); }}
                            className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground outline-none focus:ring-2 focus:ring-warning/20 transition shrink-0"
                        >
                            {INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
                        </select>

                        <select
                            value={totalBars}
                            onChange={(e) => { setTotalBars(Number(e.target.value)); setCursor(Math.min(cursor, Number(e.target.value))); setPlaying(false); setPosition(null); }}
                            className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-muted-foreground outline-none transition shrink-0"
                        >
                            {BAR_COUNTS.map((count) => <option key={count} value={count}>{count} Bars</option>)}
                        </select>

                        {isLoadingData && (
                            <span className="inline-flex items-center gap-1 text-micro text-muted-foreground">
                                <RefreshCw size={11} className="animate-spin" /> loading real candles…
                            </span>
                        )}
                        {loadError && !isLoadingData && (
                            <span className="inline-flex items-center gap-1 text-micro text-negative" title={loadError}>
                                feed unavailable
                            </span>
                        )}
                    </div>

                    {/* Center: Play / Pause / Step / Cut Transport Controls */}
                    <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                            type="button"
                            size="sm"
                            variant={isCutoffMode ? "destructive" : "outline"}
                            onClick={() => { setIsCutoffMode(!isCutoffMode); setPlaying(false); }}
                            className={`h-8 px-2.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ${
                                isCutoffMode ? "animate-pulse" : ""
                            }`}
                            title="Click to activate Cut Mode, then click any candle on the chart below to jump replay cutoff"
                        >
                            <Scissors size={13} className="shrink-0 mr-1" />
                            <span>{isCutoffMode ? "Click Bar..." : "Cut Mode"}</span>
                        </Button>

                        <div className="flex items-center gap-0.5 shrink-0">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => { setCursor((p) => Math.max(1, p - 1)); setPlaying(false); }}
                                className="h-8 w-8 p-0 rounded-lg"
                                title="Step Back (1 Bar)"
                            >
                                <SkipBack size={14} />
                            </Button>

                            <Button
                                type="button"
                                size="sm"
                                onClick={() => setPlaying((p) => !p)}
                                className="h-8 px-3 rounded-lg bg-warning hover:bg-warning text-white font-semibold shadow-xs shrink-0"
                                title={playing ? "Pause" : "Play Sequential Bars"}
                            >
                                {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                            </Button>

                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => { setCursor((p) => Math.min(candles.length, p + 1)); setPlaying(false); }}
                                className="h-8 w-8 p-0 rounded-lg"
                                title="Step Forward (1 Bar)"
                            >
                                <SkipForward size={14} />
                            </Button>

                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => { setCursor(10); setPlaying(false); setPosition(null); setClosedTrades([]); setBalance(10000); }}
                                className="h-8 w-8 p-0 rounded-lg text-muted-foreground"
                                title="Reset to Start"
                            >
                                <RotateCcw size={14} />
                            </Button>
                        </div>

                        <select
                            value={speed}
                            onChange={(e) => setSpeed(Number(e.target.value))}
                            className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono outline-none transition shrink-0"
                        >
                            {SPEEDS.map((s) => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Right: Paper Execution Buttons & Trade Log Toggle */}
                    <div className="flex items-center gap-1.5 shrink-0">
                        {position ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={closePosition}
                                className="h-8 border-warning/40 bg-warning/10 text-warning hover:bg-warning/20 font-semibold text-xs px-3 rounded-lg"
                            >
                                <RefreshCw size={12} className="mr-1" /> Flat ({floatingPnL >= 0 ? `+$${floatingPnL.toFixed(2)}` : `-$${Math.abs(floatingPnL).toFixed(2)}`})
                            </Button>
                        ) : (
                            <div className="flex items-center gap-1.5 shrink-0">
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => openTrade("LONG")}
                                    className="h-8 bg-positive hover:bg-positive text-white font-semibold text-micro tracking-wider uppercase px-3 rounded-lg shadow-xs shrink-0"
                                >
                                    <TrendingUp size={13} className="mr-1" /> Buy Long
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => openTrade("SHORT")}
                                    className="h-8 bg-negative hover:bg-negative text-white font-semibold text-micro tracking-wider uppercase px-3 rounded-lg shadow-xs shrink-0"
                                >
                                    <TrendingDown size={13} className="mr-1" /> Sell Short
                                </Button>
                            </div>
                        )}

                        {closedTrades.length > 0 && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setShowHistory((prev) => !prev)}
                                className={`h-8 px-2.5 rounded-lg text-xs ${showHistory ? "bg-muted font-bold" : ""}`}
                                title="Toggle Paper Trade History"
                            >
                                Log ({closedTrades.length})
                            </Button>
                        )}
                    </div>
                </div>

                {/* Scrubber Range & Cutoff Status Indicator */}
                <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 text-micro font-mono text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                            <span className="inline-block h-2 w-2 rounded-full bg-warning animate-pulse" /> Replay Scrubber: Bar #{cursor} of {candles.length}
                        </span>
                        <span className="text-foreground font-bold">
                            Current Price: ${currentPrice > 0 ? currentPrice.toFixed(2) : "—"}
                        </span>
                    </div>

                    <input
                        type="range"
                        min={1}
                        max={Math.max(1, candles.length)}
                        value={Math.min(cursor, Math.max(1, candles.length))}
                        onChange={(e) => { setCursor(Number(e.target.value)); setPlaying(false); }}
                        className="w-full accent-warning h-1.5 bg-muted rounded-lg appearance-none cursor-pointer"
                    />
                </div>
            </div>

            {/* Live Paper Trading Scoreboard Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="rounded-lg border border-border bg-card p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 shadow-xs">
                    <span className="text-muted-foreground">Paper Balance:</span>
                    <span className="font-semibold text-foreground">${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="rounded-lg border border-border bg-card p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 shadow-xs">
                    <span className="text-muted-foreground">Net Replay PnL:</span>
                    <span className={`font-semibold ${netPnL >= 0 ? "text-positive" : "text-negative"}`}>
                        {netPnL >= 0 ? `+$${netPnL.toFixed(2)}` : `-$${Math.abs(netPnL).toFixed(2)}`}
                    </span>
                </div>
                <div className="rounded-lg border border-border bg-card p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 shadow-xs">
                    <span className="text-muted-foreground">Win Rate:</span>
                    <span className="font-semibold text-warning">{winRate}% ({totalWins}/{totalTrades})</span>
                </div>
                <div className="rounded-lg border border-border bg-card p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 shadow-xs">
                    <span className="text-muted-foreground">Open Position:</span>
                    {position ? (
                        <span className={`font-semibold ${position.type === "LONG" ? "text-positive" : "text-negative"}`}>
                            {position.type} @ ${position.entryPrice.toFixed(2)}
                        </span>
                    ) : (
                        <span className="text-muted-foreground">None</span>
                    )}
                </div>
            </div>

            {/* Optional Paper Trade History Panel */}
            {showHistory && closedTrades.length > 0 && (
                <div className="rounded-lg border border-border bg-card p-4 shadow-xs space-y-2">
                    <div className="flex items-center justify-between pb-2 border-b border-border">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Closed Paper Trades Log</h4>
                        <span className="text-micro font-mono text-muted-foreground">{closedTrades.length} trades recorded</span>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
                        {closedTrades.map((t) => (
                            <div key={t.id} className="flex items-center justify-between p-2 rounded-xl bg-background border border-border/60">
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded-lg text-micro font-bold ${t.type === "LONG" ? "bg-positive/10 text-positive border border-positive/20" : "bg-negative/10 text-negative border border-negative/20"}`}>
                                        {t.type}
                                    </span>
                                    <span className="text-muted-foreground">
                                        Entry: ${t.entryPrice.toFixed(2)} → Exit: ${t.exitPrice.toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 font-semibold">
                                    <span className={t.result === "WIN" ? "text-positive" : "text-negative"}>
                                        {t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`}
                                    </span>
                                    <span className={`text-micro px-1.5 py-0.5 rounded-md font-bold ${t.result === "WIN" ? "bg-positive/20 text-positive" : "bg-negative/20 text-negative"}`}>
                                        {t.result}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Active Cut Mode Banner Overlay */}
            {isCutoffMode && (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-negative/40 bg-negative/10 p-3 text-center text-xs font-mono font-bold text-negative animate-pulse shadow-xs">
                    <Scissors size={12} className="shrink-0" aria-hidden />
                    CUT MODE ACTIVE: Click any candle on the chart below to set the replay cut-off point.
                </div>
            )}

            {/* TradingView Lightweight Chart Container with Responsive CSS Sizing */}
            <div 
                ref={containerRef} 
                className={`relative overflow-hidden rounded-lg border border-border bg-card shadow-xs transition-all h-[380px] sm:h-[480px] lg:h-[560px] ${isCutoffMode ? "cursor-crosshair ring-2 ring-negative/50" : ""}`} 
            >
                {(isLoadingData || loadError) && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[2px]">
                        <div className="max-w-sm px-4 text-center">
                            {loadError ? (
                                <>
                                    <p className="text-xs font-medium text-foreground">Replay data unavailable</p>
                                    <p className="mt-1 text-micro leading-4 text-muted-foreground">{loadError}</p>
                                </>
                            ) : (
                                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                                    <RefreshCw size={12} className="animate-spin" /> Loading real market candles…
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}