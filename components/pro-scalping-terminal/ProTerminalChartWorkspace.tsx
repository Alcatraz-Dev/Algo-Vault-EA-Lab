"use client";

/**
 * ProTerminalChartWorkspace — the canonical Pro Terminal chart surface.
 *
 * One source of truth for every page that wants the same Pro Terminal chart
 * UI/UX and working logic:
 *
 *   • Symbol/timeframe pickers
 *   • Chart type selector (candlestick / bar / line / area / baseline)
 *   • Drawing tools (trendline / horizontal / vertical / ray / fibo /
 *     rectangle / text / ruler / pointer)
 *   • Layer / overlay picker (volume, VWAP, sessions, FVG, OB, BOS/CHoCH,
 *     pivots, S/R, equal H/L, EMA/SMA, BB/KC/DC, supertrend, HA, RSI pane,
 *     MACD pane, stochastic pane, ATR pane, parabolic SAR, Ichimoku, and
 *     the Order-Flow candle-grade overlays: VP / POC / VAH-VAL / HVN-LVN /
 *     absorption / exhaustion / estimated delta / cumulative delta)
 *   • Watchlist side panel
 *   • Fullscreen toggle
 *   • Drawings are persisted per-symbol in localStorage so they survive
 *     reloads and symbol switches within a page
 *   • Layer state is persisted per-symbol too — the layer state for XAUUSD
 *     doesn't bleed into poll's EURUSD view
 *   • Analysis payload is wired in automatically for pages that already have
 *     one (pass `analysis`); pages that don't can ignore the prop.
 *   • Optional signals + chart-confluence levels (entry/SL/TP) for pages
 *     that have a deterministic signal in context
 *
 * The component does NOT fetch analytics, radar, or journal data on its own;
 * that lives in the parent (e.g. ProScalpingTerminal, analysis workspace).
 * This keeps the chart's data flow local and lets callers add their own
 * intelligence layer on top.
 *
 * The chart itself is the same ProTerminalChart used everywhere — every
 * page that renders this workspace renders the same engine, the same
 * overlays, the same drawing persistence and the same set of buttons.
  */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    BarChart3,
    Box,
    ChevronDown,
    Layers,
    LineChart,
    Maximize2,
    Minimize2,
    MousePointer,
    Ruler,
    Split,
    TrendingUp,
    Type,
    Activity,
    Minus,
    AlertTriangle,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Watchlist from "@/components/trading/Watchlist";
import ChartToolbar from "@/components/trading/ChartToolbar";
import { LayerPicker } from "./LayerPicker";
import { ProTerminalChart } from "./ProTerminalChart";
import {
    TERMINAL_TIMEFRAMES,
    defaultLayerState,
    type ChartLayerId,
} from "./chart-layers";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type { AdvancedAnalysisResult } from "@/lib/ai/analysis/intelligence";
import type { TerminalSignal } from "@/lib/ai/scalping/radar";
import type {
    ChartType,
    DrawingTool,
    DrawingItem,
} from "./ProTerminalChart";
import { useLayerAvailability } from "@/hooks/use-layer-availability";
import { useOrderFlowSettings } from "@/hooks/use-order-flow-settings";
import { useOptionsChain } from "@/hooks/use-options-chain";
import { useChartSettings } from "@/hooks/use-chart-settings";
import { useAiDrawGate } from "@/hooks/use-ai-draw-gate";
import {
    withPreset,
    type ChartPositionView,
    type ChartPendingOrderView,
    type ChartTradeFill,
} from "./chart-settings";
import type { AiDrawPlan } from "@/lib/chart-engine/ai-draw";

// ── persistent per-symbol storage helpers ───────────────────────────────────

const LAYERS_STORAGE_PREFIX = "pro_terminal_chart_workspace_layers_v1";
const DRAWINGS_STORAGE_PREFIX = "pro_terminal_chart_workspace_drawings_v1";

function safeStorageRead<T>(key: string): T | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed as T;
    } catch {
        return null;
    }
}

function safeStorageWrite(key: string, value: unknown): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // localStorage may be disabled (private mode / quota) — silently skip
    }
}

/** Strip known provider aliases so SP500/GOLD/etc. → SPX500/XAUUSD. */
function normaliseSymbol(input: string): SupportedSymbol {
    const cleaned = String(input ?? "")
        .replace(/^(FX|CRYPTO|INDICES|FOREX):/, "")
        .replace(/[\s_/-]/g, "")
        .toUpperCase();
    const ALIASES: Record<string, string> = {
        SP500: "SPX500", S500: "SPX500", US500: "SPX500", SPXUSD: "SPX500", SPX: "SPX500",
        DJIA: "US30", DOW: "US30", DOW30: "US30", DOWJONES: "US30",
        NDX: "NAS100", NAS: "NAS100", NASDAQ: "NAS100", NASDAQ100: "NAS100",
        GOLD: "XAUUSD", SILVER: "XAGUSD",
        BTCUSDT: "BTCUSD", ETHUSDT: "ETHUSD",
    };
    return (ALIASES[cleaned] ?? cleaned) as SupportedSymbol;
}

// ── component ──────────────────────────────────────────────────────────────

export interface ProTerminalChartWorkspaceProps {
    /** Initial symbol. Defaults to XAUUSD. The workspace persists per-symbol state. */
    initialSymbol?: string;
    /** Initial timeframe. Defaults to M5. */
    initialTimeframe?: Timeframe;
    /** Initial chart type. Defaults to candlestick. */
    initialChartType?: ChartType;
    /** Default layer state for symbols that have no persisted state yet. */
    initialLayers?: Record<ChartLayerId, boolean>;
    /** Optional analysis payload (BOS/CHoCH events, structure, regime). */
    analysis?: AdvancedAnalysisResult | null;
    /** Auth token. Optional — OHLC feed works without one. */
    token?: string | null;
    /** Optional signals to draw as entry/SL/TP markers on the chart. */
    signals?: TerminalSignal[];
    /** Optional chart-confluence levels (entry / SL / TP from a signal). */
    chartLevels?: Array<{ kind: string; label: string; price: number }> | null;
    /** Pine overlay (used by PineWorkspace). Optional. */
    studyOverlay?: import("./pine-overlays").PineStudyOverlay | null;
    /** Optional callback fired when the engine produces a new candles array —
     *  used by the Pine workspace to re-execute the script on every new candle. */
    onCandlesChange?: (candles: import("./ProTerminalChart").Candle[]) => void;
    /** Chart height in px. */
    height?: number;
    /** Disable the watchlist side panel. */
    hideWatchlist?: boolean;
    /** Hide the fullscreen toggle button. */
    hideFullscreen?: boolean;
    /** Storage scope prefix — different pages can keep separate persisted state. */
    storageScope?: string;
    /** AI-computed overlay (indicator preview / backtested strategy) to draw. */
    aiOverlay?: import("./ProTerminalChart").AiOverlay | null;
    /** Open positions drawn as trade levels (entry/SL/TP) on the chart. */
    positions?: ChartPositionView[];
    /** Pending orders (buy/sell limit & stop) drawn on the price pane. */
    pendingOrders?: ChartPendingOrderView[];
    /** Historical fills shown as entry/exit markers (real executions). */
    tradeHistory?: ChartTradeFill[];
    /** Close a position by percentage from the chart's trade strip. */
    onClosePosition?: (ticket: string, percent: number) => void;
    /** Cancel a pending order from the chart's trade strip. */
    onCancelOrder?: (ticket: string) => void;
    /**
     * Fired when the user clicks a drawn position (entry/SL/TP line) on the
     * chart. The chart only EMITS the ticket — surfacing the position editor
     * is the host's job.
     */
    onPositionSelect?: (ticket: string) => void;
    /**
     * Fired when the user drags a position's SL or TP line to a new price.
     * The chart emits identity + which stop changed + the new price; the host
     * decides how (or whether) to execute it through Unified Trading.
     */
    onModifyPositionStops?: (
        ticket: string,
        stops: { stopLoss?: number | null; takeProfit?: number | null }
    ) => void;
    /**
     * Fired when the user picks a different instrument in the chart (watchlist
     * or symbol control). Hosts that pair a chart with an order ticket MUST
     * handle this — otherwise the ticket keeps quoting one symbol while the
     * chart shows another, which is how traders end up sizing the wrong trade.
     */
    onSymbolChange?: (symbol: string) => void;
    /** Fired when the user changes the chart timeframe. */
    onTimeframeChange?: (timeframe: Timeframe) => void;
    /**
     * Event → chart navigation: a request from an external feed to centre the
     * chart on a specific bar. Propagated to the chart, which applies it once
     * data for the (possibly new) symbol is available.
     */
    focusRequest?: { seq: number; time: number; price?: number; label?: string } | null;
    /** AI Draw entitlement override: true = always allowed, false = never. */
    canUseAiDraw?: boolean;
    /** Receives the AI draw plan whenever it recomputes (null when off). */
    onAiPlanChange?: (plan: AiDrawPlan | null) => void;
    /** Extra classes for the outer container. */
    className?: string;
}

export function ProTerminalChartWorkspace({
    initialSymbol = "XAUUSD",
    initialTimeframe = "M5",
    initialChartType = "candlestick",
    initialLayers,
    analysis = null,
    token = null,
    signals = [],
    chartLevels = null,
    studyOverlay = null,
    aiOverlay = null,
    onCandlesChange,
    height = 540,
    hideWatchlist = false,
    hideFullscreen = false,
    storageScope = "default",
    positions = [],
    pendingOrders = [],
    tradeHistory = [],
    onClosePosition,
    onCancelOrder,
    onPositionSelect,
    onModifyPositionStops,
    onSymbolChange,
    onTimeframeChange,
    focusRequest = null,
    canUseAiDraw,
    onAiPlanChange,
    className,
}: ProTerminalChartWorkspaceProps) {
    // ── core workspace state ─────────────────────────────────────────────
    const [symbol, setSymbolRaw] = useState<string>(initialSymbol);
    const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
    const [chartType, setChartType] = useState<ChartType>(initialChartType);
    const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingTool>("select");
    const [drawings, setDrawings] = useState<DrawingItem[]>([]);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [layersOpen, setLayersOpen] = useState(false);
    // Chart settings — one persisted source of truth (theme preset, colors,
    // display flags, tool style) shared by the toolbar and the chart.
    const { settings, update: updateSettings } = useChartSettings();
    const gridVisible = settings.display.grid;
    const theme: "light" | "dark" = settings.preset === "light" ? "light" : "dark";
    // AI Draw (Pro) — entitlement verified server-side by the shared gate.
    const aiGate = useAiDrawGate({ token, canUseAiDraw });
    // Viewport reset counter — each increment makes the chart refit.
    const [fitSignal, setFitSignal] = useState(0);
    // Real-time bid/ask for the chart's BID/ASK lines (best-effort poll).
    const [quote, setQuote] = useState<{
        bid?: number | null;
        ask?: number | null;
        spreadEstimated?: boolean;
        timestamp?: number;
    } | null>(null);

    const cleanSymbol = useMemo(() => normaliseSymbol(symbol), [symbol]);
    // Report the change upward so a paired order ticket follows the chart.
    const setSymbol = useCallback(
        (s: string) => {
            const next = normaliseSymbol(s);
            setSymbolRaw(next);
            onSymbolChange?.(next);
        },
        [onSymbolChange]
    );

    const selectTimeframe = useCallback(
        (tf: Timeframe) => {
            setTimeframe(tf);
            onTimeframeChange?.(tf);
        },
        [onTimeframeChange]
    );

    // ── External control ────────────────────────────────────────────────
    // `initialSymbol` / `initialTimeframe` seed the chart, but hosts that own a
    // symbol selector (order ticket symbol, policy-restricted symbol list)
    // change them afterwards. Without this sync the chart silently keeps
    // showing the seed while the rest of the page quotes another instrument —
    // the exact "chart and ticket disagree" failure the change callbacks exist
    // to prevent. Effects only fire when the PROP changes, so a watchlist
    // click (internal state, prop unchanged) is never reverted.
    /* eslint-disable react-hooks/set-state-in-effect -- controlled-prop sync: mirrors a prop into internal chart state so an external symbol/timeframe control drives the chart. */
    useEffect(() => {
        const next = normaliseSymbol(initialSymbol);
        setSymbolRaw((prev) => (prev === next ? prev : next));
    }, [initialSymbol]);

    useEffect(() => {
        setTimeframe((prev) => (prev === initialTimeframe ? prev : initialTimeframe));
    }, [initialTimeframe]);
    /* eslint-enable react-hooks/set-state-in-effect */

    // Keep the document-level chart theme marker in sync so charts created
    // later (initial palette) match the user's chosen preset.
    useEffect(() => {
        if (typeof document !== "undefined") {
            document.documentElement.dataset.chartTheme = theme;
        }
    }, [theme]);

    // ── Live bid/ask for the chart's BID/ASK lines ──────────────────────
    // Uses the platform's own quote endpoint (the same feed the Watchlist
    // displays). The endpoint derives ask from a fixed spread estimate, so
    // the chart labels it "ASK ≈" — never presented as a broker ask.
    useEffect(() => {
        if (!settings.display.bidAsk) return;
        let cancelled = false;
        const load = async () => {
            try {
                const res = await fetch(`/api/analytics/watchlist?symbols=${encodeURIComponent(cleanSymbol)}`);
                if (!res.ok) return;
                const data = (await res.json()) as {
                    quotes?: Record<string, { symbol?: string; bid?: number; ask?: number; spread?: number; timestamp?: number }>;
                };
                if (cancelled) return;
                const q = data.quotes?.[cleanSymbol] ?? Object.values(data.quotes ?? {})[0];
                if (q && typeof q.bid === "number" && Number.isFinite(q.bid)) {
                    setQuote({
                        bid: q.bid,
                        ask: typeof q.ask === "number" && Number.isFinite(q.ask) ? q.ask : null,
                        spreadEstimated: true,
                        timestamp: q.timestamp ?? Date.now(),
                    });
                }
            } catch {
                // quote polling is best-effort — the chart falls back to the
                // last rendered close for the BID line.
            }
        };
        void load();
        const id = window.setInterval(load, 5_000);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [cleanSymbol, settings.display.bidAsk]);

    // ── AI Draw toggle with server-side Pro verification ──────────────────
    const handleToggleAiDraw = async () => {
        await aiGate.toggle();
    };

    // ── per-symbol layers & drawings with hydration from localStorage ───
    const [layers, setLayers] = useState<Record<ChartLayerId, boolean>>(
        () => initialLayers ?? defaultLayerState()
    );

    // Load persisted layers/drawings for the *active* symbol whenever it changes.
    /* eslint-disable react-hooks/set-state-in-effect -- hydration from localStorage: synchronous client storage reads keyed by the active symbol; must run after mount (SSR has no localStorage). */
    useEffect(() => {
        const layersKey = `${LAYERS_STORAGE_PREFIX}:${storageScope}:${cleanSymbol}`;
        const drawingsKey = `${DRAWINGS_STORAGE_PREFIX}:${storageScope}:${cleanSymbol}`;
        const storedLayers = safeStorageRead<Record<string, boolean>>(layersKey);
        if (storedLayers && typeof storedLayers === "object") {
            const merged = { ...(initialLayers ?? defaultLayerState()), ...storedLayers };
            setLayers(merged);
        } else {
            setLayers(initialLayers ?? defaultLayerState());
        }
        const storedDrawings = safeStorageRead<DrawingItem[]>(drawingsKey);
        setDrawings(Array.isArray(storedDrawings) ? storedDrawings : []);
    }, [cleanSymbol, storageScope, initialLayers]);
    /* eslint-enable react-hooks/set-state-in-effect */

    // Persist layers when they change.
    useEffect(() => {
        safeStorageWrite(`${LAYERS_STORAGE_PREFIX}:${storageScope}:${cleanSymbol}`, layers);
    }, [layers, cleanSymbol, storageScope]);

    const layerAvailability = useLayerAvailability(cleanSymbol);
    const orderFlowSettings = useOrderFlowSettings();
    const optionsChain = useOptionsChain(cleanSymbol, token, { pollMs: 120_000 });

    const toggleLayer = useCallback((id: ChartLayerId) => {
        setLayers((prev) => ({ ...prev, [id]: !prev[id] }));
    }, []);

    // ── drawing persistence + keyboard shortcut ─────────────────────────
    const handleDrawingsChange = useCallback(
        (next: DrawingItem[]) => {
            setDrawings(next);
            safeStorageWrite(`${DRAWINGS_STORAGE_PREFIX}:${storageScope}:${cleanSymbol}`, next);
        },
        [cleanSymbol, storageScope]
    );

    const handleClearDrawings = useCallback(() => {
        handleDrawingsChange([]);
    }, [handleDrawingsChange]);

    // Esc clears the active drawing tool back to "select" so the user can
    // re-pan/zoom the chart instead of being stuck placing shapes.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && activeDrawingTool !== "select") {
                setActiveDrawingTool("select");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [activeDrawingTool]);

    const activeLayerCount = useMemo(
        () => Object.values(layers).filter(Boolean).length,
        [layers]
    );

    // Fullscreen uses the Fullscreen API when possible so the chart can use
    // the entire viewport (browser chrome, address bar, etc.). Fallback to
    // an overlay-fixed layout when the API is unavailable (sandboxed iframes).
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!isFullscreen) return;
        const node = containerRef.current;
        if (!node || typeof document === "undefined") return;
        const requestFn = node.requestFullscreen ?? (node as unknown as {
            webkitRequestFullscreen?: () => Promise<void>;
        }).webkitRequestFullscreen;
        if (requestFn) {
            try {
                void requestFn.call(node);
            } catch {
                /* permission denied or not allowed — fallback layout still works */
            }
        }
        const onChange = () => {
            if (!document.fullscreenElement) setIsFullscreen(false);
        };
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, [isFullscreen]);

    return (
        <div
            ref={containerRef}
            className={cn(
                "flex min-w-0 flex-col gap-3",
                isFullscreen && "fixed inset-0 z-50 h-screen overflow-hidden bg-background p-4",
                className
            )}
            data-pro-terminal-workspace
        >
            {/* ── Professional top toolbar ─────────────────────────────────── */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/80 px-4 py-2.5 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                    <span
                        className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1 font-numeric text-base font-bold text-primary tracking-tight"
                        title="Active symbol"
                    >
                        {cleanSymbol}
                    </span>
                    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
                        {TERMINAL_TIMEFRAMES.map((tf) => (
                            <button
                                key={tf}
                                type="button"
                                onClick={() => selectTimeframe(tf)}
                                aria-pressed={timeframe === tf}
                                className={cn(
                                    "rounded-md px-2.5 py-1 font-numeric text-xs font-semibold transition-all",
                                    timeframe === tf
                                        ? "bg-primary text-primary-foreground shadow-sm"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                            >
                                {tf}
                            </button>
                        ))}
                    </div>
                    {activeLayerCount > 0 && (
                        <ChartInfo
                            chartType={chartType}
                            timeframe={timeframe}
                            layerCount={activeLayerCount}
                        />
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setLayersOpen((o) => !o)}
                        aria-expanded={layersOpen}
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition hover:bg-muted"
                    >
                        <Layers className="size-4" />
                        <span className="hidden sm:inline">Indicators</span>
                        <span className="inline sm:hidden">Indicators</span>
                        {activeLayerCount > 0 && (
                            <span className="rounded-full bg-primary/20 px-2 py-0.5 font-numeric text-micro text-primary">
                                {activeLayerCount}
                            </span>
                        )}
                        <ChevronDown
                            className={cn("size-3.5 transition-transform", layersOpen && "rotate-180")}
                        />
                    </button>
                    {!hideFullscreen ? (
                        <button
                            type="button"
                            onClick={() => {
                                if (isFullscreen && document.fullscreenElement) {
                                    const exitFn = (document as unknown as { exitFullscreen?: () => Promise<void> }).exitFullscreen;
                                    if (exitFn) void exitFn.call(document);
                                }
                                setIsFullscreen((f) => !f);
                            }}
                            aria-pressed={isFullscreen}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium transition hover:bg-muted"
                            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                        >
                            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                            {isFullscreen ? "Exit" : "Fullscreen"}
                        </button>
                    ) : null}
                </div>
            </div>

            {/* ── Drawing + chart-type toolbar ────────────────────────────── */}
            <ChartToolbar
                chartType={chartType}
                onChartTypeChange={setChartType}
                activeDrawingTool={activeDrawingTool}
                onDrawingToolChange={setActiveDrawingTool}
                onClearDrawings={handleClearDrawings}
                drawingCount={drawings.length}
                isFullscreen={isFullscreen}
                onToggleFullscreen={hideFullscreen ? undefined : () => setIsFullscreen((f) => !f)}
                onToggleGrid={() =>
                    updateSettings((prev) => ({ ...prev, display: { ...prev.display, grid: !prev.display.grid } }))
                }
                gridVisible={gridVisible}
                onToggleTheme={() =>
                    updateSettings((prev) => withPreset(prev, prev.preset === "light" ? "midnight" : "light"))
                }
                currentTheme={theme}
                settings={settings}
                onSettingsChange={updateSettings}
                onFitView={() => setFitSignal((s) => s + 1)}
                onUndoDrawing={() => handleDrawingsChange(drawings.slice(0, -1))}
                magnet={settings.display.magnet}
                onToggleMagnet={() =>
                    updateSettings((prev) => ({ ...prev, display: { ...prev.display, magnet: !prev.display.magnet } }))
                }
                aiDraw={aiGate.enabled}
                onToggleAiDraw={() => void handleToggleAiDraw()}
                aiDrawLocked={aiGate.locked}
                aiDrawChecking={aiGate.checking}
            />

            {/* ── Layer picker (collapsible) ─────────────────────────────── */}
            {layersOpen ? (
                <div className="rounded-lg border border-border/50 bg-card p-4 shadow-md">
                    <div className="mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Layers className="size-4 text-primary" />
                            <h3 className="text-sm font-semibold text-foreground">Technical Indicators &amp; Overlays</h3>
                        </div>
                        <button
                            type="button"
                            onClick={() => setLayersOpen(false)}
                            className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            aria-label="Close indicator panel"
                        >
                            <X className="size-4" />
                        </button>
                    </div>
                    <p className="mb-4 text-micro text-muted-foreground">
                        Select indicators to overlay on the chart. Click any indicator to toggle it on/off.
                    </p>
                    <LayerPicker
                        layers={layers}
                        availability={layerAvailability}
                        onToggle={toggleLayer}
                        compact={false}
                    />
                    {activeLayerCount > 0 && (
                        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                            <span className="text-micro text-muted-foreground">
                                {activeLayerCount} active overlay{activeLayerCount > 1 ? "s" : ""}
                            </span>
                            <button
                                type="button"
                                onClick={() => setLayers(defaultLayerState())}
                                className="text-micro text-muted-foreground transition hover:text-foreground"
                            >
                                Reset all
                            </button>
                        </div>
                    )}
                </div>
            ) : null}

            {aiGate.error ? (
                <div role="alert" className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                    <AlertTriangle className="size-3.5 shrink-0 text-warning" />
                    <span className="text-warning">{aiGate.error}</span>
                </div>
            ) : null}

            {/* ── Main chart + watchlist ─────────────────────────────────── */}
            <div
                className={cn(
                    "grid min-w-0 gap-4",
                    isFullscreen ? "flex-1 min-h-0" : "",
                    hideWatchlist ? "" : "xl:grid-cols-[minmax(0,1fr)_280px]"
                )}
            >
                <div className={cn("overflow-hidden rounded-lg border border-border bg-card shadow-md", isFullscreen && "flex-1 min-h-0 h-full")}>
                    <ProTerminalChart
                        symbol={cleanSymbol}
                        timeframe={timeframe}
                        layers={layers}
                        analysis={analysis}
                        token={token}
                        height={isFullscreen ? (typeof window !== "undefined" ? Math.max(600, window.innerHeight - 240) : 800) : height}
                        studyOverlay={studyOverlay}
                        onCandlesChange={onCandlesChange}
                        signals={signals}
                        orderFlowSettings={orderFlowSettings.settings}
                        optionsChain={optionsChain.available ? optionsChain : null}
                        chartType={chartType}
                        activeDrawingTool={activeDrawingTool}
                        drawings={drawings}
                        onDrawingsChange={handleDrawingsChange}
                        chartLevels={chartLevels}
                        gridVisible={gridVisible}
                        theme={theme}
                        aiOverlay={aiOverlay}
                        settings={settings}
                        positions={positions}
                        pendingOrders={pendingOrders}
                        tradeHistory={tradeHistory}
                        quote={settings.display.bidAsk ? quote : null}
                        aiDraw={aiGate.enabled}
                        fitSignal={fitSignal}
                        focusRequest={focusRequest}
                        onAiPlanChange={onAiPlanChange}
                        onClosePosition={onClosePosition}
                        onCancelOrder={onCancelOrder}
                        onPositionSelect={onPositionSelect}
                        onModifyPositionStops={onModifyPositionStops}
                    />
                </div>
                {hideWatchlist ? null : (
                    <div className="flex flex-col gap-3 xl:max-w-[280px]">
                        <Watchlist selectedSymbol={cleanSymbol} onSelect={setSymbol} />
                        <ChartInfoCard
                            symbol={cleanSymbol}
                            timeframe={timeframe}
                            chartType={chartType}
                            drawings={drawings.length}
                            layers={activeLayerCount}
                            onClearDrawings={handleClearDrawings}
                            onClearLayers={() => setLayers(defaultLayerState())}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

// ── sub-components ────────────────────────────────────────────────────────

function ChartInfo({
    chartType,
    timeframe,
    layerCount,
}: {
    chartType: ChartType;
    timeframe: Timeframe;
    layerCount: number;
}) {
    const Icon = CHART_TYPE_ICONS[chartType];
    return (
        <div className="hidden items-center gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1 font-numeric text-micro text-muted-foreground md:flex">
            <span className="inline-flex items-center gap-1.5">
                <Icon className="size-3 text-primary" />
                <span className="font-semibold text-foreground">{chartType.toUpperCase()}</span>
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{timeframe}</span>
            <span className="text-muted-foreground">·</span>
            <span className="inline-flex items-center gap-1 text-primary">
                <Layers className="size-2.5" />
                <span>{layerCount}</span>
            </span>
        </div>
    );
}

const CHART_TYPE_ICONS: Record<ChartType, React.ComponentType<{ className?: string }>> = {
    candlestick: BarChart3,
    bar: BarChart3,
    line: LineChart,
    area: TrendingUp,
    baseline: Activity,
};

function ChartInfoCard({
    symbol,
    timeframe,
    chartType,
    drawings,
    layers,
    onClearDrawings,
    onClearLayers,
}: {
    symbol: string;
    timeframe: string;
    chartType: string;
    drawings: number;
    layers: number;
    onClearDrawings: () => void;
    onClearLayers: () => void;
}) {
    return (
        <div className="rounded-lg border border-border bg-card p-3 text-xs shadow-sm">
            <div className="flex items-center gap-1.5 border-b border-border pb-1.5">
                <Layers className="size-3.5 text-muted-foreground" />
                <h3 className="font-semibold uppercase tracking-wide text-foreground">Chart Info</h3>
            </div>
            {layers === 0 ? (
                <div className="mt-2 space-y-2">
                    <div className="flex items-start gap-2 rounded-md bg-primary/5 p-2 text-micro">
                        <Box className="mt-0.5 size-3.5 text-primary shrink-0" />
                        <div>
                            <p className="text-foreground font-medium">Clean chart — no overlays</p>
                            <p className="text-muted-foreground mt-0.5">
                                Click the Indicators button above to add technical analysis layers.
                            </p>
                        </div>
                    </div>
                    <dl className="space-y-1 text-muted-foreground">
                        <Row label="Symbol" value={symbol} mono />
                        <Row label="Timeframe" value={timeframe} mono />
                        <Row label="Chart type" value={chartType} mono />
                        <Row label="Drawings" value={String(drawings)} mono />
                    </dl>
                </div>
            ) : (
                <>
                    <dl className="mt-2 space-y-1 text-muted-foreground">
                        <Row label="Symbol" value={symbol} mono />
                        <Row label="Timeframe" value={timeframe} mono />
                        <Row label="Chart type" value={chartType} mono />
                        <Row label="Drawings" value={String(drawings)} mono />
                        <Row label="Active layers" value={String(layers)} mono />
                    </dl>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                        <button
                            type="button"
                            onClick={onClearDrawings}
                            disabled={drawings === 0}
                            className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-micro font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
                            title="Clear all drawings on the active chart"
                        >
                            <Ruler className="size-3" />
                            Clear drawings
                        </button>
                        <button
                            type="button"
                            onClick={onClearLayers}
                            disabled={layers === 0}
                            className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-micro font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
                            title="Reset overlays to defaults"
                        >
                            <Layers className="size-3" />
                            Reset layers
                        </button>
                    </div>
                </>
            )}
            <p className="mt-2 text-micro text-muted-foreground">
                Draw with the toolbar above. Press <kbd className="rounded border border-border px-1 font-numeric text-micro">Esc</kbd> to
                return to pointer.
            </p>
        </div>
    );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn("text-foreground", mono && "font-numeric")}>{value}</dd>
        </div>
    );
}

// Re-export the chart-related types from the same place callers will already
// be getting the rest of the types from. Lets pages `import { ChartType }`
// from this module if they want.
export type { ChartType, DrawingTool, DrawingItem } from "./ProTerminalChart";

// Light-up the icons we expose as named members so tree-shakers don't drop them
// and to keep the file's intent obvious for callers.
export const PRO_TERMINAL_DRAWING_ICONS = {
    select: MousePointer,
    trendline: TrendingUp,
    horizontal: Minus,
    vertical: Split,
    ray: TrendingUp,
    fibo: Activity,
    rectangle: Box,
    text: Type,
    ruler: Ruler,
} as const;