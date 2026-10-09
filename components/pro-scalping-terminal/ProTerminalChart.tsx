"use client";

import { useEffect, useRef, useMemo, useCallback, type RefObject } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { cn } from "@/lib/utils";
import { ChartSurface, type ChartSurfaceProps } from "./ChartSurface";
import { SeriesRenderer, type PriceSeriesRefs, type PriceBar } from "./SeriesRenderer";
import { IndicatorRenderer, type IndicatorSeriesRefs } from "./IndicatorRenderer";
import { isLayerOn, type ChartLayerId } from "./chart-layers";
import { DrawingRenderer } from "./DrawingRenderer";
import { TradingOverlayRenderer, type TradeLineOwner, type TradePriceLine } from "./TradingOverlayRenderer";
import type { ChartSettings } from "./chart-settings";
import type { ChartPositionView, ChartPendingOrderView, ChartTradeFill } from "./chart-settings";
import type { OrderFlowSettings } from "@/lib/order-flow/settings";
import type { TerminalSignal } from "@/lib/ai/scalping/radar";
import type { AiDrawPlan } from "@/lib/chart-engine/ai-draw";
import type { PineStudyOverlay } from "./pine-overlays";
import { fmtPrice } from "./terminal-utils";
import type { MarketPriceTransform, MarketTimeTransform } from "./drawing-utils";

// ── public types (reexported so callers import from this module) ─────────────────────

export { hitTestTradeLine, TradingOverlayRenderer } from "./TradingOverlayRenderer";
export type { TradeLineOwner, TradePriceLine } from "./TradingOverlayRenderer";

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
  opacity?: number;
  width?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
};

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

// ── component props (mirror what the workspace / ProScalpingTerminal pass) ────────────

export interface ProTerminalChartProps {
  symbol: string;
  timeframe: string;
  layers: Record<string, boolean>;
  analysis: unknown;
  token?: string | null;
  height: number;
  studyOverlay?: PineStudyOverlay | null;
  onCandlesChange?: (candles: Candle[]) => void;
  signals?: TerminalSignal[];
  orderFlowSettings: OrderFlowSettings;
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
  onAiPlanChange?: (plan: AiDrawPlan | null) => void;
  onClosePosition?: (ticket: string, percent: number) => void;
  onCancelOrder?: (ticket: string) => void;
  onPositionSelect?: (ticket: string) => void;
  onModifyPositionStops?: (ticket: string, stops: { stopLoss?: number | null; takeProfit?: number | null }) => void;
}

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

function chartTheme(theme: "light" | "dark") {
  return theme === "light"
    ? {
        uiBackground: "#ffffff",
        textColor: "#546a82",
        gridColor: "rgba(148, 163, 184, 0.22)",
        crosshairColor: "rgba(234, 123, 74, 0.55)",
      }
    : {
        uiBackground: "#0b0f17",
        textColor: "#8b98ad",
        gridColor: "rgba(148, 163, 184, 0.08)",
        crosshairColor: "rgba(255, 255, 255, 0.35)",
      };
}

// ── component ─────────────────────────────────────────────────────────────────────────

export default function ProTerminalChart(props: ProTerminalChartProps) {
  const {
    symbol,
    theme,
    settings,
    gridVisible,
    chartType,
    activeDrawingTool,
    drawings,
    layers,
    positions = [],
    pendingOrders = [],
    tradeHistory = [],
    quote,
    height,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const baselineSeriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);
  const barSeriesRef = useRef<ISeriesApi<"Bar"> | null>(null);
  const activePriceRef = useRef<
    ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area"> | ISeriesApi<"Baseline"> | ISeriesApi<"Bar"> | null
  >(null);
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

  // Indicator-series refs — the parent owns the slots; IndicatorRenderer is their
  // only writer (same access contract as PriceSeriesRefs).
  const indicatorRefs: IndicatorSeriesRefs = useMemo(
    () => ({
      bb: { current: null },
      kc: { current: null },
      dc: { current: null },
      supertrend: { current: null },
      supertrendPane: { current: null },
      heikinAshi: { current: null },
      rsi: { current: null },
      rsiPane: { current: null },
      macd: { current: null },
      macdPane: { current: null },
      ma: { current: null },
      ichimoku: { current: null },
      stochastic: { current: null },
      stochasticPane: { current: null },
      atr: { current: null },
      atrPane: { current: null },
      delta: { current: null },
      deltaPane: { current: null },
    }),
    [],
  );

  const seriesRenderer = useMemo(() => new SeriesRenderer(seriesRefs), []);
  const indicatorRenderer = useRef(new IndicatorRenderer(indicatorRefs));
  const drawingRenderer = useRef(new DrawingRenderer());
  const overlayRenderer = useRef(new TradingOverlayRenderer());

  const cursor =
    activeDrawingTool === "select" ? "crosshair" : activeDrawingTool === "hand" ? "grab" : "default";

  // ── chart instance + series + renderers (created once) ─────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const t = chartTheme(theme);
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: t.uiBackground },
        textColor: t.textColor,
        fontFamily: "var(--font-sans, Inter), var(--font-mono, monospace), sans-serif",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: t.gridColor, style: LineStyle.Solid },
        horzLines: { color: t.gridColor, style: LineStyle.Solid },
      },
      rightPriceScale: { borderColor: t.gridColor, scaleMargins: { top: 0.10, bottom: 0.18 } },
      timeScale: { borderColor: t.gridColor, timeVisible: true, secondsVisible: false, rightOffset: 6 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: t.crosshairColor, labelBackgroundColor: t.uiBackground, width: 1, style: LineStyle.Dashed },
        horzLine: { color: t.crosshairColor, labelBackgroundColor: t.uiBackground, width: 1, style: LineStyle.Dashed },
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
      volumeVisible: settings.display.volume && !!(layers as Record<string, boolean>).volume,
    });

    try {
      indicatorRenderer.current.attach(chart);
    } catch {
      // IndicatorRenderer may not be fully wired in this snapshot; guard so the
      // chart still renders without indicators.
    }

    // Bind the drawing + overlay transforms to the candle series.
    const cs = candleSeriesRef.current;
    if (chart && cs) {
      drawingRenderer.current.attach(chart as unknown as MarketTimeTransform, cs as unknown as MarketPriceTransform);
      overlayRenderer.current.attach(chart, cs);
    }

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
    // Creation-once by design: the chart instance is stable for the lifetime of
    // the container. Settings/themes that should re-apply are handled by the
    // surface/apply-effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── chart-level options follow settings/theme ───────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const t = settings.colors;
    const gridOn = gridVisible && settings.display.grid;
    try {
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: t.background }, textColor: t.text },
        grid: {
          vertLines: { color: gridOn ? t.grid : "transparent" },
          horzLines: { color: gridOn ? t.grid : "transparent" },
        },
        rightPriceScale: { borderColor: gridOn ? t.grid : "transparent", autoScale: settings.display.autoScale },
        timeScale: { borderColor: gridOn ? t.grid : "transparent" },
        crosshair: {
          vertLine: { color: t.crosshair, labelBackgroundColor: t.background },
          horzLine: { color: t.crosshair, labelBackgroundColor: t.background },
        },
        handleScroll: settings.display.freeMove
          ? { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true }
          : false,
        handleScale: settings.display.freeMove
          ? { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true }
          : false,
      });
    } catch {
      // chart may have been removed between renders
    }
  }, [settings, gridVisible, chartRef]);

  // ── series appearance (candle colors + volume visibility) ──────────────────────────

  useEffect(() => {
    seriesRenderer.applyAppearance(settings.colors, settings.display.volume && !!(layers as Record<string, boolean>).volume);
  }, [settings, seriesRenderer]);

  // ── chart-type switch ───────────────────────────────────────────────────────────────

  useEffect(() => {
    try {
      seriesRenderer.syncChartType([], chartType);
    } catch {}
    activeTypeRef.current = chartType;
  }, [chartType, seriesRenderer]);

  // ── indicator layer sync (when layers or settings change) ───────────────────────────

  useEffect(() => {
    try {
      indicatorRenderer.current.syncLayers({
        layers: layers as Partial<Record<ChartLayerId, boolean>>,
        colors: settings.colors,
        pricePrecision: 2,
        maLayers: {
          ema50: { color: "#fb7185" },
          ema200: { color: "#f59e0b" },
          sma20: { color: "#94a3b8" },
          sma50: { color: "#22d3ee" },
          sma200: { color: "#60a5fa" },
        },
      });
    } catch {}
  }, [settings, layers, drawings, indicatorRenderer]);

  // ── trading overlay (positions / orders / fills) ────────────────────────────────────

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

// Named export so callers that import { ProTerminalChart } get the component.
export { ProTerminalChart };
