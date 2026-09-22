"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ChartType, Candle, PriceAlert, DrawingTool } from "./TradingChart/types";
import ChartEngine from "./TradingChart/ChartEngine";
import ChartStorage from "./TradingChart/ChartStorage";
import ChartContextMenu from "./TradingChart/ChartContextMenu";
import AlertManager from "./TradingChart/AlertManager";
import ChartToolbar from "./TradingChart/ChartToolbar";
import DrawingToolbar from "./TradingChart/DrawingToolbar";

interface TradingChartProps {
    symbol?: string;
    interval?: string;
    studies?: string[];
    height?: number;
}

// Map the toolbar interval label onto the timeframe enum accepted by the
// canonical OHLC API (M1..D1). Unsupported intervals return undefined so the
// request is not silently remapped to a different timeframe.
const INTERVAL_TO_TIMEFRAME: Record<string, string> = {
    "1m": "M1",
    "5m": "M5",
    "15m": "M15",
    "30m": "M30",
    "1h": "H1",
    "4h": "H4",
    "1D": "D1",
};

function normalizeSymbol(symbol: string): string {
    return symbol
        .replace(/^FX:/, "")
        .replace(/\/USD$/, "USD")
        .toUpperCase();
}

async function fetchRealCandles(symbol: string, timeframe: string): Promise<{ candles: Candle[]; providerError: string | null }> {
    const timeframeParam = INTERVAL_TO_TIMEFRAME[timeframe];
    if (!timeframeParam) {
        return { candles: [], providerError: `Timeframe ${timeframe} is not supported by the market data provider` };
    }
    const cleanSymbol = normalizeSymbol(symbol);
    try {
        const params = new URLSearchParams({ symbol: cleanSymbol, timeframe: timeframeParam, limit: "250" });
        const res = await fetch(`/api/analytics/ohlc?${params.toString()}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
            candles?: Array<{
                timestamp: number;
                open: number;
                high: number;
                low: number;
                close: number;
                volume?: number;
            }>;
            error?: string;
        };
        if (!res.ok || !data?.candles?.length) {
            return { candles: [], providerError: data?.error ?? "No market data available" };
        }
        return {
            candles: data.candles.map((c) => ({
                time: Math.floor(c.timestamp / 1000),
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume ?? 0,
            })),
            providerError: null,
        };
    } catch {
        return { candles: [], providerError: "Failed to load market data" };
    }
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
    // Market data keyed by symbol|interval: a symbol/interval change derives the
    // loading state from the key mismatch (no imperative setState in the effect).
    const [market, setMarket] = useState<{
        key: string;
        candles: Candle[];
        error: string | null;
    }>({ key: "", candles: [], error: null });
    const marketKey = `${chartSymbol}|${chartInterval}`;
    const marketIsCurrent = market.key === marketKey;
    const candles = marketIsCurrent ? market.candles : [];
    const marketError = marketIsCurrent ? market.error : null;
    const marketLoading = !marketIsCurrent;
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

    // Fetch real candles from the canonical OHLC API — never fabricated.
    useEffect(() => {
        let cancelled = false;
        const key = marketKey;
        (async () => {
            const result = await fetchRealCandles(chartSymbol, chartInterval);
            if (cancelled) return;
            setMarket({ key, candles: result.candles, error: result.providerError });
        })();
        return () => {
            cancelled = true;
        };
    }, [chartSymbol, chartInterval, marketKey]);

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

    const layout = { symbol: chartSymbol, interval: chartInterval, chartType, studies: activeStudies, theme: "dark" as const };

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
                                {marketError} — no candles were returned for {normalizeSymbol(chartSymbol)}{" "}
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
                <ChartEngine
                    width={containerWidth}
                    height={height}
                    chartType={chartType}
                    candles={candles}
                    onChartReady={(chart) => { chartRef.current = chart; }}
                    onSeriesReady={() => {}}
                />
                <ChartContextMenu onReset={() => chartRef.current?.timeScale().fitContent()} />
            </div>

            <AlertManager alerts={alerts} onChange={setAlerts} />
        </div>
    );
}