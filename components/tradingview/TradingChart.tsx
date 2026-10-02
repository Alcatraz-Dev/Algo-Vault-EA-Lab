"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { ChartType, Candle, PriceAlert, DrawingTool } from "./TradingChart/types";
import ChartEngine from "./TradingChart/ChartEngine";
import ChartStorage from "./TradingChart/ChartStorage";
import ChartContextMenu from "./TradingChart/ChartContextMenu";
import AlertManager from "./TradingChart/AlertManager";
import ChartToolbar from "./TradingChart/ChartToolbar";
import DrawingToolbar from "./TradingChart/DrawingToolbar";
import { useLiveCandles } from "@/hooks/useLiveCandles";

interface TradingChartProps {
    symbol?: string;
    interval?: string;
    studies?: string[];
    height?: number;
}

// Map the toolbar interval label onto the timeframe enum accepted by the
// canonical OHLC API (M1..H4 for the chart engine). Unsupported intervals
// return undefined so the request is not silently remapped to a different
// timeframe.
const INTERVAL_TO_TIMEFRAME: Record<string, string> = {
    "1m": "M1",
    "3m": "M3",
    "5m": "M5",
    "15m": "M15",
    "30m": "M30",
    "1h": "H1",
    "4h": "H4",
};

function normalizeSymbol(symbol: string): string {
    return symbol
        .replace(/^FX:/, "")
        .replace(/^FX_IDC:/, "")
        .replace(/^OANDA:/, "")
        .replace(/^COINBASE:/, "")
        .replace(/^BINANCE:/, "")
        .replace(/^TVC:/, "")
        .replace(/^NASDAQ:/, "")
        .replace(/^INDEX:/, "")
        .replace(/\//g, "")
        .replace(/^XAU:USD$/, "XAUUSD")
        .replace(/^XAG:USD$/, "XAGUSD")
        .replace(/^INDU$/, "US30")
        .toUpperCase();
}

/** Coloured dot class for the live-status badge. */
function cnLiveDot(isLive: boolean): string {
    return isLive
        ? "inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"
        : "inline-block h-1.5 w-1.5 rounded-full bg-amber-500";
}

export default function TradingChart({
    symbol = "FX:EURUSD",
    interval = "1h",
    studies: externalStudies,
    height = 620,
}: TradingChartProps) {
    const [chartSymbol, setChartSymbol] = useState(symbol);
    const [chartInterval, setChartInterval] = useState(interval);
    const [chartType, setChartType] = useState<ChartType>("candlestick");
    const [activeStudies, setActiveStudies] = useState<string[]>(externalStudies ?? []);
    const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingTool>("cursor");
    const [alerts, setAlerts] = useState<PriceAlert[]>([]);
    const [containerWidth, setContainerWidth] = useState(800);
    const timeframeParam = INTERVAL_TO_TIMEFRAME[chartInterval];
    const feedSymbol = normalizeSymbol(chartSymbol);
    const { candles: liveCandles, error: liveError, isLoading: liveLoading, isLive, lastUpdate } = useLiveCandles(
        feedSymbol,
        timeframeParam ?? "H1",
        { limit: 250, enabled: Boolean(timeframeParam) }
    );

    const candles = useMemo<Candle[]>(
        () =>
            liveCandles.map((c) => ({
                time: Math.floor(c.timestamp / 1000),
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume ?? 0,
            })),
        [liveCandles]
    );

    const marketError = !timeframeParam
        ? `Timeframe ${chartInterval} is not supported by the market data provider`
        : liveError;
    const marketLoading = liveLoading;
    const [undoStack, setUndoStack] = useState<unknown[][]>([]);
    const [redoStack, setRedoStack] = useState<unknown[][]>([]);

    const chartRef = useRef<import("lightweight-charts").IChartApi | null>(null);

    useEffect(() => {
        function handleResize() {
            const el = document.querySelector("[data-chart-container]");
            if (el) setContainerWidth(el.clientWidth);
        }
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const handleSymbolChange = useCallback((sym: string) => {
        setUndoStack((prev) => [...prev, [{ symbol: chartSymbol, interval: chartInterval }]]);
        setChartSymbol(sym);
    }, [chartSymbol, chartInterval]);

    const handleIntervalChange = useCallback((intv: string) => {
        setUndoStack((prev) => [...prev, [{ symbol: chartSymbol, interval: chartInterval }]]);
        setChartInterval(intv);
    }, [chartSymbol, chartInterval]);

    const handleChartTypeChange = useCallback((type: ChartType) => {
        setChartType(type);
    }, []);

    const handleStudiesChange = useCallback((studies: string[]) => {
        setActiveStudies(studies);
    }, []);

    const handleUndo = useCallback(() => {
        if (undoStack.length === 0) return;
        const last = undoStack[undoStack.length - 1];
        setRedoStack((prev) => [...prev, last]);
        setUndoStack((prev) => prev.slice(0, -1));
    }, [undoStack]);

    const handleRedo = useCallback(() => {
        if (redoStack.length === 0) return;
        const next = redoStack[redoStack.length - 1];
        setUndoStack((prev) => [...prev, next]);
        setRedoStack((prev) => prev.slice(0, -1));
    }, [redoStack]);

    const [theme, setTheme] = useState<"dark" | "light">(() => (typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light"));

    // ── live-follow state (Phase 6) ─────────────────────────────────────
    const [followLive, setFollowLive] = useState(true);
    const [showGoLive, setShowGoLive] = useState(false);

    useEffect(() => {
        const observer = new MutationObserver(() => {
            const isDark = document.documentElement.classList.contains("dark");
            setTheme(isDark ? "dark" : "light");
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);

    const layout = { symbol: chartSymbol, interval: chartInterval, chartType, studies: activeStudies, theme };

    const showEmptyState = !marketLoading && marketError !== null;

    return (
        <div className="flex h-full flex-col rounded-lg border border-border/20 bg-background">
            <ChartStorage layout={layout} />

            <ChartToolbar
                symbol={chartSymbol}
                interval={chartInterval}
                chartType={chartType}
                studies={activeStudies}
                candles={candles}
                canUndo={undoStack.length > 0}
                canRedo={redoStack.length > 0}
                onChangeSymbol={handleSymbolChange}
                onChangeInterval={handleIntervalChange}
                onChangeChartType={handleChartTypeChange}
                onChangeStudies={handleStudiesChange}
                onUndo={handleUndo}
                onRedo={handleRedo}
            />

            <DrawingToolbar activeTool={activeDrawingTool} onChangeTool={setActiveDrawingTool} />

            <div className="relative flex-1" data-chart-container>
                {showEmptyState && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md border border-dashed border-border/40 bg-background/70 backdrop-blur-sm">
                        <div className="max-w-xs text-center">
                            <p className="text-xs font-medium text-muted-foreground">Chart unavailable</p>
                            <p className="mt-1 text-[11px] leading-5 text-muted-foreground/70">
                                {marketError} — no candles were returned for {feedSymbol}{" "}
                                {chartInterval}.
                            </p>
                        </div>
                    </div>
                )}
                {marketLoading && candles.length === 0 && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center">
                        <span className="text-xs text-muted-foreground">Loading market data…</span>
                    </div>
                )}
                {!marketLoading && candles.length > 0 && (
                    <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded-full border border-border/40 bg-background/80 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur-sm">
                        <span
                            className={cnLiveDot(isLive)}
                            aria-hidden
                        />
                        {isLive ? "Live" : "Reconnecting…"}
                        {lastUpdate > 0 && (
                            <span className="text-muted-foreground/60">
                                · {new Date(lastUpdate).toLocaleTimeString([], { hour12: false })}
                            </span>
                        )}
                    </div>
                )}
                {showGoLive && candles.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => {
                            setFollowLive(true);
                            setShowGoLive(false);
                            chartRef.current?.timeScale().scrollToRealTime();
                        }}
                        className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-background/90 px-3 py-1 text-[11px] font-semibold text-primary shadow-sm backdrop-blur-sm transition hover:bg-primary/10"
                    >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden />
                        Go to Live →
                    </button>
                ) : null}
                <ChartEngine
                    width={containerWidth}
                    height={height}
                    chartType={chartType}
                    candles={candles}
                    onChartReady={(chart) => { chartRef.current = chart; }}
                    onSeriesReady={() => {}}
                    onFollowChange={(following) => {
                        setFollowLive(following);
                        setShowGoLive(!following);
                    }}
                />
                <ChartContextMenu onReset={() => chartRef.current?.timeScale().fitContent()} />
            </div>

            <AlertManager alerts={alerts} onChange={setAlerts} />
        </div>
    );
}