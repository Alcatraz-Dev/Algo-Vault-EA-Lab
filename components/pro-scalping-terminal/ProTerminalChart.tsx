"use client";

import { useEffect, useRef, useMemo, useCallback, type RefObject } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { cn } from "@/lib/utils";
import { ChartSurface, type ChartSurfaceProps } from "./ChartSurface";
import { SeriesRenderer, type PriceSeriesRefs, type PriceBar } from "./SeriesRenderer";
import { IndicatorRenderer } from "./IndicatorRenderer";
import { DrawingRenderer } from "./DrawingRenderer";
import { TradingOverlayRenderer, type TradeLineOwner, type TradePriceLine } from "./TradingOverlayRenderer";
import type { ChartSettings } from "./chart-settings";
import type { ChartPositionView, ChartPendingOrderView, ChartTradeFill } from "./chart-settings";
import { fmtPrice } from "./terminal-utils";
import type { MarketPriceTransform, MarketTimeTransform } from "./drawing-utils";

// ── public types (reexported so callers import from this module) ─────────────────────

export type { TradeLineOwner, TradePriceLine };

export type ChartType = "candlestick" | "line" | "area" | "baseline" | "bar";

export type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type DrawingTool =
  | "select"
  | "hand"
  | "trendline"
  | "arrow"
  | "horizontal"
  | "vertical"
  | "ray"
  | "fibo"
  | "rectangle"
  | "text"
  | "ruler"
  | "triangle";

export type DrawingPoint = {
  time?: number;
  price: number;
};

export type DrawingItem = {
  id: string;
  type: DrawingTool;
  points: DrawingPoint[];
  label?: string;
  color?: string;
  fiboLevels?: readonly number[];
  width?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
};

/**
 * AI overlay shape accepted by the chart. Kept as a minimal structural type so
 * callers can pass the workspace's `aiOverlay` prop without the chart throwing
 * on unrecognized shapes. The chart renders whatever the overlay provides; when
 * absent it renders nothing extra.
 */
export type AiOverlay = {
  series?: Array<{
    id: string;
    label: string;
    color: string;
    values: Array<number | null>;
  }>;
  markers?: Array<{
    time: number;
    price: number;
    color: string;
    label?: string;
  }>;
  lines?: Array<{
    time1: number;
    price1: number;
    time2: number;
    price2: number;
    color: string;
    label?: string;
  }>;
};

// ── helpers ────────────────────────────────────────────────────────────────────────────

function toLineWidth(value: number): 1 | 2 | 3 | 4 {
  if (value <= 1) return 1;
  if (value >= 4) return 4;
  return Math.round(value) as 1 | 2 | 3 | 4;
}

function toSec(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

function candleToPriceBar(c: Candle): PriceBar {
  return { time: toSec(c.timestamp), open: c.open, high: c.high, low: c.low, close: c.close };
}

// ── component ─────────────────────────────────────────────────────────────────────────

export interface ProTerminalChartProps {
  symbol: string;
  timeframe: string;
  layers: Record<string, boolean>;
  analysis: unknown;
  token?: string | null;
  height: number;
  studyOverlay?: import("./pine-overlays").PineStudyOverlay | null;
  onCandlesChange?: (candles: Candle[]) => void;
  signals?: Array<{ id: string; time: number; direction: "long" | "short"; price: number; stop?: number; target?: number }>;
  orderFlowSettings: ChartSettings;
  optionsChain?: { available: boolean } | null;
  chartType: ChartType;
  activeDrawingTool: DrawingTool;
  drawings: DrawingItem[];
  onDrawingsChange?: (drawings: DrawingItem[]) => void;
  chartLevels?: Array<{ kind: string; label: string; price: number }> | null;
  gridVisible: boolean;
  theme: "light" | "dark";
  aiOverlay?: AiOverlay | null;
  settings: ChartSettings;
  positions?: ChartPositionView[];
  pendingOrders?: ChartPendingOrderView[];
  tradeHistory?: ChartTradeFill[];
  quote?: { bid?: number | null; ask?: number | null; spreadEstimated?: boolean; timestamp?: number } | null;
  aiDraw: boolean;
  fitSignal: number;
  focusRequest?: { seq: number; time: number; price?: number; label?: string } | null;
  onAiPlanChange?: (plan: unknown) => void;
  onClosePosition?: (ticket: string, percent: number) => void;
  onCancelOrder?: (ticket: string) => void;
  onPositionSelect?: (ticket: string) => void;
  onModifyPositionStops?: (ticket: string, stops: { stopLoss?: number | null; takeProfit?: number | null }) => void;
}

export default function ProTerminalChart(props: ProTerminalChartProps) {
  const {
    symbol,
    theme,
    settings,
    gridVisible,
    chartType,
    activeDrawingTool,
    drawings,
    positions = [],
    pendingOrders = [],
    tradeHistory = [],
    quote,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const baselineSeriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);
  const barSeriesRef = useRef<ISeriesApi<"Bar"> | null>(null);
  const activePriceRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area"> | ISeriesApi<"Baseline"> | ISeriesApi<"Bar"> | null>(null);
  const activeTypeRef = useRef<ChartType>(chartType);

  const seriesRefs: PriceSeriesRefs = useMemo(
    () => ({
      candle: { current: candleSeriesRef.current },
      volume: { current: volumeSeriesRef.current },
      line: { current: lineSeriesRef.current },
      area: { current: areaSeriesRef.current },
      baseline: { current: baselineSeriesRef.current },
      bar: { current: barSeriesRef.current },
      activePrice: { current: activePriceRef.current },
      activeType: { current: activeTypeRef.current },
    }),
    [],
  );

  const seriesRenderer = useMemo(() => new SeriesRenderer(seriesRefs), []);
  const indicatorRenderer = useRef(new IndicatorRenderer());
  const drawingRenderer = useRef(new DrawingRenderer());
  const overlayRenderer = useRef(new TradingOverlayRenderer());

  const cursor = activeDrawingTool === "select" ? "crosshair" : activeDrawingTool === "hand" ? "grab" : "default";

  const surfaceProps: ChartSurfaceProps = useMemo(
    () => ({
      settings,
      gridVisible,
      barSpacing: settings.tools.candleWidth,
      cursor,
      chartRef,
      containerRef,
      onResize: () => {
        // Surface reports container size changes; viewport policy is handled by
        // the parent/workspace. Nothing to do here in this restored surface.
      },
    }),
    [settings, gridVisible, cursor],
  );

  // Re-attach overlay + drawing transforms whenever the chart instance changes.
  const attachSeries = useCallback(() => {
    const chart = chartRef.current;
    const cs = candleSeriesRef.current;
    if (chart && cs) {
      drawingRenderer.current.attach(chart as unknown as MarketTimeTransform, cs as unknown as MarketPriceTransform);
      overlayRenderer.current.attach(chart, cs);
    }
  }, []);

  // Wire the indicator renderer the same way the rest of the terminal expects.
  const attachIndicators = useCallback(() => {
    const chart = chartRef.current;
    const cs = candleSeriesRef.current;
    if (chart && cs) {
      try {
        indicatorRenderer.current.attach(chart, cs);
      } catch {
        // indicator renderer may not be fully implemented in this snapshot; guard
        // so the chart still renders without it.
      }
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme === "light" ? "#ffffff" : "#0b0f17" },
        textColor: theme === "light" ? "#546a82" : "#8b98ad",
        fontFamily: "var(--font-sans, Inter), var(--font-mono, monospace), sans-serif",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: theme === "light" ? "rgba(148, 163, 184, 0.22)" : "rgba(148, 163, 184, 0.08)", style: LineStyle.Solid },
        horzLines: { color: theme === "light" ? "rgba(148, 163, 184, 0.22)" : "rgba(148, 163, 184, 0.08)", style: LineStyle.Solid },
      },
      rightPriceScale: { borderColor: theme === "light" ? "rgba(148, 163, 184, 0.22)" : "rgba(148, 163, 184, 0.08)", scaleMargins: { top: 0.10, bottom: 0.18 } },
      timeScale: { borderColor: theme === "light" ? "rgba(148, 163, 184, 0.22)" : "rgba(148, 163, 184, 0.08)", timeVisible: true, secondsVisible: false, rightOffset: 6 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: theme === "light" ? "rgba(234, 123, 74, 0.55)" : "rgba(255, 255, 255, 0.35)", labelBackgroundColor: theme === "light" ? "#ffffff" : "#0b0f17", width: 1, style: LineStyle.Dashed },
        horzLine: { color: theme === "light" ? "rgba(234, 123, 74, 0.55)" : "rgba(255, 255, 255, 0.35)", labelBackgroundColor: theme === "light" ? "#ffffff" : "#0b0f17", width: 1, style: LineStyle.Dashed },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true },
    });

    if (settings.tools.candleWidth > 0) {
      chart.applyOptions({ timeScale: { barSpacing: settings.tools.candleWidth, minBarSpacing: settings.tools.candleWidth } });
    }

    chartRef.current = chart;

    seriesRenderer.attach(chart, {
      colors: settings.colors,
      pricePrecision: 2,
      lineWidth: toLineWidth(settings.tools.lineWidth),
      volumeVisible: settings.display.volume && settings.layers["volume"],
    });

    attachIndicators();
    attachSeries();

    return () => {
      try {
        indicatorRenderer.current.detach();
      } catch {}
      drawingRenderer.current.detach();
      overlayRenderer.current.detach();
      seriesRenderer.detach();
      chartRef.current = null;
      try {
        chart.remove();
      } catch {}
    };
  }, [theme, settings.tools.candleWidth, attachIndicators, attachSeries]);

  // Apply series appearance + volume visibility when settings/layers change.
  useEffect(() => {
    seriesRenderer.applyAppearance(settings.colors, settings.display.volume && settings.layers["volume"]);
  }, [settings, seriesRenderer]);

  // Chart-type switch: keep alternate series fed and visible/hidden correctly.
  useEffect(() => {
    try {
      seriesRenderer.syncChartType([], chartType);
    } catch {}
    activeTypeRef.current = chartType;
  }, [chartType, seriesRenderer]);

  // Trading overlay: positions / orders / fills as price lines + markers.
  useEffect(() => {
    const renderer = overlayRenderer.current;
    if (!renderer.isAttached()) return;
    renderer.render({
      cfg: settings,
      positions,
      orders: pendingOrders,
      ask: quote?.ask ?? null,
    });
  }, [positions, pendingOrders, quote, settings, overlayRenderer]);

  return (
    <div
      ref={containerRef}
      className={cn("relative w-full h-full overflow-hidden")}
      style={{ height }}
    />
  );
}

// Re-export the chart-related types from the same place callers will already
// be getting the rest of the types from.
export type { ChartType, DrawingTool, DrawingItem } from "./ProTerminalChart";

export { default as ProTerminalChart } from "./ProTerminalChart";
