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

function intervalToSeconds(intv: string): number {
    if (intv.endsWith("m")) return parseInt(intv, 10) * 60;
    if (intv.endsWith("h")) return parseInt(intv, 10) * 3600;
    if (intv.endsWith("D")) return parseInt(intv, 10) * 86400;
    if (intv.endsWith("W")) return parseInt(intv, 10) * 604800;
    if (intv.endsWith("M")) return parseInt(intv, 10) * 2592000;
    return 3600;
}

function generateCandles(sym: string, intv: string, count: number): Candle[] {
    const seconds = intervalToSeconds(intv);
    const basePrice = sym.includes("BTC") ? 45000 : sym.includes("XAU") ? 2400 : 1.1;
    const volBase = sym.includes("BTC") ? 10 : sym.includes("XAU") ? 100 : 1000;
    const now = Math.floor(Date.now() / 1000);
    const alignedNow = Math.floor(now / seconds) * seconds;
    const data: Candle[] = [];
    let current = basePrice;
    for (let i = count - 1; i >= 0; i--) {
        const timestamp = alignedNow - i * seconds;
        const volatility = basePrice * 0.012;
        const open = current;
        const wick = (Math.random() - 0.5) * volatility;
        const body = (Math.random() - 0.5) * volatility * 0.6;
        const close = Math.max(open * 0.99, open + body);
        const high = Math.max(open, close) + Math.abs(wick);
        const low = Math.min(open, close) - Math.abs(wick);
        const volume = Math.floor(volBase * (0.5 + Math.random()));
        data.push({ time: timestamp, open, high, low, close, volume });
        current = close;
    }
    return data;
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
    const [candles, setCandles] = useState<Candle[]>(() => generateCandles(chartSymbol, chartInterval, 120));
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
        setCandles(generateCandles(sym, chartInterval, 120));
    }, [chartSymbol, chartInterval]);

    const handleIntervalChange = useCallback((intv: string) => {
        setUndoStack((prev) => [...prev, [{ symbol: chartSymbol, interval: chartInterval }]]);
        setChartInterval(intv);
        setCandles(generateCandles(chartSymbol, intv, 120));
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
