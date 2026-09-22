"use client";

import { useEffect, useRef, useState } from "react";

type GoChartingProps = {
    symbol?: string;
    interval?: string;
    chartType?: "candle" | "line" | "area" | "bar" | "heikinashi";
    studies?: string[];
    onTick?: (data: GoChartTick) => void;
    height?: number;
};

export type GoChartTick = {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

export type StudyType = "MA" | "EMA" | "RSI" | "MACD" | "BOLLINGER" | "VOLUME" | "VWAP";

const STUDY_LABELS: Record<StudyType, string> = {
    MA: "Moving Average",
    EMA: "Exponential MA",
    RSI: "RSI",
    MACD: "MACD",
    BOLLINGER: "Bollinger Bands",
    VOLUME: "Volume",
    VWAP: "VWAP",
};

const STUDY_COLORS: Record<StudyType, string> = {
    MA: "#fbbf24",
    EMA: "#f59e0b",
    RSI: "#a78bea",
    MACD: "#22d3ee",
    BOLLINGER: "#3b82f6",
    VOLUME: "rgba(139,92,247,0.4)",
    VWAP: "#ec4899",
};

const STUDY_IDS: Record<StudyType, string> = {
    MA: "MASimple@tv-basicstudies",
    EMA: "EMA@tv-basicstudies",
    RSI: "RSI@tv-basicstudies",
    MACD: "MACD@tv-basicstudies",
    BOLLINGER: "BollingerBands@tv-basicstudies",
    VOLUME: "Volume@tv-basicstudies",
    VWAP: "VWAP@tv-basicstudies",
};

// Map the toolbar interval onto the timeframe enum accepted by the canonical
// OHLC API (M1..D1). Unsupported intervals fall back to H1 and the chart
// footer labels the actual timeframe so the displayed data is never misleading.
const INTERVAL_TO_TIMEFRAME: Record<string, string> = {
    "60": "H1",
    M1: "M1",
    M5: "M5",
    M15: "M15",
    M30: "M30",
    H1: "H1",
    H4: "H4",
    D1: "D1",
    W1: "D1",
    MN: "D1",
    "1m": "M1",
    "5m": "M5",
    "15m": "M15",
    "30m": "M30",
    "1h": "H1",
    "4h": "H4",
    "240": "H4",
    "1D": "D1",
    "1W": "D1",
    "1M": "D1",
};

const CHART_TYPE_MAP: Record<string, string> = {
    candle: "candles",
    line: "line",
    area: "area",
    bar: "bar",
    heikinashi: "heikinashi",
};

const LICENSE_KEY =
    process.env.NEXT_PUBLIC_GOCHARTING_LICENSE_KEY || "demo-550e8400-e29b-41d4-a716-446655440000";

const SDK_URL = `https://gocharting.com/sdk/library/${LICENSE_KEY}/index.umd.js`;

const INTERVALS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"];

interface GoChartingSymbolInfo {
    symbol: string;
    full_name: string;
    description?: string;
    type?: string;
    session?: string;
    timezone?: string;
    has_intraday?: boolean;
    has_daily?: boolean;
    supported_resolutions?: string[];
    tick_size?: number;
    display_tick_size?: number;
    data_status?: string;
    tradeable?: boolean;
    exchange?: string;
    segment?: string;
    exchange_info?: {
        name: string;
        code: string;
        zone: string;
        hours: Array<Record<string, unknown>>;
        valid_intervals: string[];
    };
}

interface GoChartingUDFResponse {
    s: "ok" | "no_data" | "error";
    t?: number[];
    o?: number[];
    h?: number[];
    l?: number[];
    c?: number[];
    v?: number[];
    nextTime?: number | null;
    errmsg?: string;
}

interface GoChartingPeriodParams {
    from?: number;
    to?: number;
    firstDataRequest?: boolean;
    countBack?: number;
    rows?: number;
    duration?: number;
}

interface GoChartingRealtimeTick {
    type: "trade";
    productId: string;
    symbol: string;
    exchange: string;
    segment: string;
    timeStamp: Date;
    tradeID: string;
    price: number;
    quantity: number;
    amount: number;
    side: string;
}

interface GoChartingDatafeed {
    resolveSymbol: (
        symbolName: string,
        onResolve: (info: GoChartingSymbolInfo) => void,
        onError: (error: string) => void
    ) => void;
    getBars: (
        symbolInfo: GoChartingSymbolInfo,
        resolution: ResolutionLike,
        periodParams: GoChartingPeriodParams
    ) => Promise<GoChartingUDFResponse>;
    subscribeTicks?: (
        symbolInfo: GoChartingSymbolInfo,
        resolution: ResolutionLike,
        onRealtimeCallback: (tick: GoChartingRealtimeTick) => void,
        subscriberUID: string,
        onResetCacheNeededCallback?: () => void
    ) => void;
    unsubscribeTicks?: (subscriberUID: string) => void;
    searchSymbols?: (
        userInput: string,
        exchange: string,
        symbolType: string,
        onResult: (result: { searchInProgress: boolean; items: unknown[] }) => void
    ) => void;
    destroy?: () => void;
}

interface GoChartingChartConfig {
    symbol: string;
    interval: string;
    datafeed: GoChartingDatafeed;
    licenseKey: string;
    theme?: "dark" | "light";
    debugLog?: boolean;
    studies?: string[];
    chartType?: string;
    disableSearch?: boolean;
    disableCompare?: boolean;
    autoSave?: boolean;
    onReady?: (instance: Record<string, unknown>) => void;
    onError?: (error: unknown) => void;
    appCallback?: (event: unknown) => void;
    contextMenu?: { showTradingOptions?: boolean };
    trading?: { enableTrading?: boolean; showReverseButton?: boolean };
    [key: string]: unknown;
}

interface GoChartingChartWrapper {
    destroy: () => void;
    isDestroyed: () => boolean;
}

declare global {
    interface Window {
        GoChartingSDK?: {
            createChart: (
                selector: string,
                config: GoChartingChartConfig
            ) => GoChartingChartWrapper;
        };
    }
}

const STUDY_OPTIONS: { type: StudyType; label: string }[] = [
    { type: "MA", label: "Moving Average" },
    { type: "EMA", label: "Exponential MA" },
    { type: "RSI", label: "RSI" },
    { type: "MACD", label: "MACD" },
    { type: "BOLLINGER", label: "Bollinger Bands" },
    { type: "VOLUME", label: "Volume" },
    { type: "VWAP", label: "VWAP" },
];

type ResolutionLike = string | { scale?: string; units?: number; type?: string };

function normalizeSymbolInput(symbolName: string): string {
    return symbolName.replace(/^FX:/, "").toUpperCase();
}

function symbolKind(symbolName: string): { type: string; exchange: string; tickSize: number } {
    const clean = normalizeSymbolInput(symbolName);
    if (/^BTC|^ETH|^SOL|^XRP|^ADA|^DOGE/.test(clean)) {
        return { type: "crypto", exchange: "CRYPTO", tickSize: 0.01 };
    }
    if (/^(US30|NAS100|SPX500|DXY|SPY|QQQ|AAPL|TSLA|MSFT|NVDA|AMZN|META|GOOGL|AMD|NFLX|COIN)$/.test(clean)) {
        return { type: "index", exchange: "INDEX", tickSize: 0.1 };
    }
    return { type: "forex", exchange: "FX", tickSize: 0.0001 };
}

// Fetch REAL daily/intraday candles from the canonical OHLC API — the GoCharting
// SDK is wired to this feed instead of fabricated data.
async function fetchMarketCandles(symbolName: string, timeframe: string, limit: number): Promise<GoChartTick[]> {
    const cleanSymbol = normalizeSymbolInput(symbolName);
    try {
        const params = new URLSearchParams({
            symbol: cleanSymbol,
            timeframe,
            limit: String(Math.min(Math.max(limit, 10), 500)),
        });
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
        if (!res.ok || !data?.candles?.length) return [];
        return data.candles.map((c) => ({
            time: Math.floor(c.timestamp / 1000),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume ?? 0,
        }));
    } catch {
        return [];
    }
}

function createRealDatafeed(onTick?: (data: GoChartTick) => void): GoChartingDatafeed {
    return {
        resolveSymbol(
            symbolName: string,
            onResolve: (info: GoChartingSymbolInfo) => void,
            onError: (error: string) => void
        ) {
            const cleanSymbol = normalizeSymbolInput(symbolName);
            if (!cleanSymbol) {
                onError("Invalid symbol");
                return;
            }
            const { type, exchange, tickSize } = symbolKind(symbolName);
            onResolve({
                symbol: cleanSymbol,
                full_name: symbolName,
                description: symbolName,
                type,
                session: "24x7",
                timezone: "UTC",
                has_intraday: true,
                has_daily: true,
                supported_resolutions: ["1m", "5m", "15m", "30m", "1h", "4h", "1D"],
                tick_size: tickSize,
                display_tick_size: tickSize,
                data_status: "streaming",
                tradeable: true,
                exchange,
                segment: "SPOT",
                exchange_info: {
                    name: "algovault",
                    code: "ALGOVAULT",
                    zone: "UTC",
                    hours: [{ open: true }],
                    valid_intervals: ["1m", "5m", "15m", "30m", "1h", "4h", "1D"],
                },
            });
        },

        async getBars(
            symbolInfo: GoChartingSymbolInfo,
            resolution: ResolutionLike,
            periodParams: GoChartingPeriodParams
        ): Promise<GoChartingUDFResponse> {
            const count = Math.min(periodParams?.countBack || periodParams?.rows || 150, 500);
            const resolutionStr = typeof resolution === "string" ? resolution : String(resolution?.type ?? "");
            const timeframe = INTERVAL_TO_TIMEFRAME[resolutionStr] ?? INTERVAL_TO_TIMEFRAME[String(resolutionStr).toUpperCase()] ?? "H1";

            const bars = await fetchMarketCandles(symbolInfo.full_name || symbolInfo.symbol, timeframe, count);
            if (!bars.length) {
                return { s: "no_data", nextTime: null };
            }

            return {
                s: "ok",
                t: bars.map((b) => b.time),
                o: bars.map((b) => b.open),
                h: bars.map((b) => b.high),
                l: bars.map((b) => b.low),
                c: bars.map((b) => b.close),
                v: bars.map((b) => b.volume),
                nextTime: null,
            };
        },

        // No fabricated ticks: historical candles above are real. Live tick
        // streaming is intentionally omitted rather than simulated.
        subscribeTicks(
            _symbolInfo: GoChartingSymbolInfo,
            _resolution: ResolutionLike,
            _onRealtimeCallback: (tick: GoChartingRealtimeTick) => void
        ) {
            void onTick;
        },

        unsubscribeTicks(_subscriberUID: string) {
        },

        searchSymbols(
            userInput: string,
            _exchange: string,
            _symbolType: string,
            onResult: (result: { searchInProgress: boolean; items: unknown[] }) => void
        ) {
            const items = userInput
                ? [
                      "FX:EURUSD",
                      "FX:GBPUSD",
                      "FX:XAUUSD",
                      "BTCUSD",
                      "ETHUSD",
                      "USDJPY",
                      "AUDUSD",
                      "US30",
                  ]
                      .filter((s) => s.toLowerCase().includes(userInput.toLowerCase()))
                      .map((s) => ({
                          symbol: s.replace(/^FX:/, ""),
                          key: s,
                          full_name: s,
                          description: s,
                          exchange: s.startsWith("FX:") ? "FX" : "CRYPTO",
                          type: "crypto",
                          ticker: s.replace(/^FX:/, ""),
                      }))
                : [];
            onResult({ searchInProgress: false, items });
        },

        destroy() {
        },
    };
}

function resolveStudies(studies: string[]): string[] {
    return studies.map((s) => {
        if (s.includes("@")) return s;
        const mapped = STUDY_IDS[s as StudyType];
        return mapped ?? s;
    });
}

function studyLabel(study: string): string {
    if (study.includes("@")) return study;
    const entry = STUDY_LABELS[study as StudyType];
    return entry ?? study;
}

function studyColor(study: string): string {
    const entry = STUDY_COLORS[study as StudyType];
    return entry ?? "#94a3b8";
}

export default function GoCharting({
    symbol = "FX:EURUSD",
    interval = "1h",
    chartType = "candle",
    studies = [],
    onTick,
    height = 600,
}: GoChartingProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartWrapperRef = useRef<GoChartingChartWrapper | null>(null);
    const scriptRef = useRef<HTMLScriptElement | null>(null);
    const [sdkLoaded, setSdkLoaded] = useState(() =>
        typeof window !== "undefined" && Boolean(window.GoChartingSDK)
    );
    const [sdkError, setSdkError] = useState<string | null>(null);
    const [currentSymbol, setCurrentSymbol] = useState(symbol);
    const [timeframe, setTimeframe] = useState(interval);
    const [chartTypes, setChartTypes] = useState(chartType);
    const [appliedStudies, setAppliedStudies] = useState<string[]>(() =>
        resolveStudies(studies)
    );
    const [showStudyMenu, setShowStudyMenu] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined" || window.GoChartingSDK) return;

        const script = document.createElement("script");
        script.src = SDK_URL;
        script.async = true;
        script.onload = () => setSdkLoaded(true);
        script.onerror = () => setSdkError("Failed to load GoCharting SDK");
        document.head.appendChild(script);
        scriptRef.current = script;

        return () => {
            if (scriptRef.current && scriptRef.current.parentNode) {
                scriptRef.current.parentNode.removeChild(scriptRef.current);
            }
            scriptRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!sdkLoaded || sdkError || !containerRef.current) return;

        const containerId = `gocharting-sdk-${Date.now()}`;
        containerRef.current.id = containerId;

        const datafeed = createRealDatafeed(onTick);

        const resolvedStudies = resolveStudies(appliedStudies);

        try {
            const wrapper = window.GoChartingSDK!.createChart(`#${containerId}`, {
                symbol: currentSymbol,
                interval: INTERVAL_TO_TIMEFRAME[timeframe] ?? timeframe,
                datafeed,
                licenseKey: LICENSE_KEY,
                theme: "dark",
                chartType: CHART_TYPE_MAP[chartTypes] ?? "candles",
                studies: resolvedStudies.length ? resolvedStudies : undefined,
                autoSave: false,
                disableSearch: false,
                disableCompare: false,
                onReady: () => {
                },
                onError: (error: unknown) => {
                    setSdkError(
                        error instanceof Error ? error.message : String(error)
                    );
                },
            });

            chartWrapperRef.current = wrapper;

            return () => {
                if (chartWrapperRef.current && !chartWrapperRef.current.isDestroyed()) {
                    chartWrapperRef.current.destroy();
                }
                chartWrapperRef.current = null;
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to create GoCharting chart";
            // The SDK failure is an external-system event; surface it outside the
            // synchronous effect body to avoid cascading renders.
            queueMicrotask(() => setSdkError(message));
            return;
        }
    }, [sdkLoaded, sdkError, currentSymbol, timeframe, chartTypes, appliedStudies, onTick]);

    if (sdkError) {
        return (
            <div
                className="rounded-xl border border-destructive/30 bg-destructive/5 flex items-center justify-center"
                style={{ height }}
            >
                <span className="text-sm text-destructive">{sdkError}</span>
            </div>
        );
    }

    const resolvedInterval = INTERVAL_TO_TIMEFRAME[timeframe] ?? timeframe;

    return (
        <div
            className="rounded-xl border border-border bg-card overflow-hidden"
            style={{ height }}
        >
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 bg-muted/30">
                <select
                    value={currentSymbol}
                    onChange={(e) => setCurrentSymbol(e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none"
                >
                    <option value="FX:EURUSD">EUR/USD</option>
                    <option value="FX:GBPUSD">GBP/USD</option>
                    <option value="FX:XAUUSD">XAU/USD</option>
                    <option value="BTCUSD">BTC/USD</option>
                    <option value="ETHUSD">ETH/USD</option>
                    <option value="USDJPY">USD/JPY</option>
                    <option value="AUDUSD">AUD/USD</option>
                    <option value="US30">US30</option>
                </select>

                <div className="flex items-center gap-0.5">
                    {INTERVALS.map((tf) => (
                        <button
                            key={tf}
                            type="button"
                            onClick={() => setTimeframe(tf)}
                            className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                                timeframe === tf
                                    ? "bg-foreground text-background"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            }`}
                        >
                            {tf}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-0.5">
                    {[
                        { type: "candle", label: "Candles" },
                        { type: "line", label: "Line" },
                        { type: "area", label: "Area" },
                        { type: "bar", label: "Bars" },
                        { type: "heikinashi", label: "HA" },
                    ].map((ct) => (
                        <button
                            key={ct.type}
                            type="button"
                            onClick={() => setChartTypes(ct.type as typeof chartTypes)}
                            className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                                chartTypes === ct.type
                                    ? "bg-foreground text-background"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            }`}
                        >
                            {ct.label}
                        </button>
                    ))}
                </div>

                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setShowStudyMenu(!showStudyMenu)}
                        className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                        + Studies
                    </button>
                    {showStudyMenu && (
                        <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-lg border border-border bg-card p-1 shadow-lg">
                            {STUDY_OPTIONS.map(({ type, label }) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => {
                                        setAppliedStudies((prev) =>
                                            prev.includes(type)
                                                ? prev.filter((s) => s !== type)
                                                : [...prev, type]
                                        );
                                        setShowStudyMenu(false);
                                    }}
                                    className={`block w-full rounded px-2 py-1.5 text-left text-xs transition ${
                                        appliedStudies.includes(type)
                                            ? "bg-foreground text-background"
                                            : "text-muted-foreground hover:bg-muted"
                                    }`}
                                >
                                    {label}
                                    {appliedStudies.includes(type) && " ✓"}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => setAppliedStudies([])}
                    className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                    Clear
                </button>

                <div className="flex items-center gap-1.5 ml-auto">
                    {appliedStudies.map((s) => (
                        <span
                            key={s}
                            className="rounded px-1.5 py-0.5 text-[10px]"
                            style={{
                                backgroundColor: studyColor(s) + "20",
                                color: studyColor(s),
                            }}
                        >
                            {studyLabel(s)}
                        </span>
                    ))}
                </div>
            </div>

            <div
                ref={containerRef}
                className="relative w-full cursor-crosshair"
                style={{ height: height - 48 }}
            >
                {!sdkLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm text-muted-foreground">Loading GoCharting widget...</span>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 bg-muted/30 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Bullish
                </span>
                <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    Bearish
                </span>
                {STUDY_OPTIONS.map(({ type, label }) => (
                    <span key={type} className="flex items-center gap-1">
                        <span
                            className="h-0.5 w-3"
                            style={{ backgroundColor: STUDY_COLORS[type] }}
                        />
                        {label}
                    </span>
                ))}
                <span className="ml-auto">
                    {currentSymbol} · {resolvedInterval}
                </span>
            </div>
        </div>
    );
}