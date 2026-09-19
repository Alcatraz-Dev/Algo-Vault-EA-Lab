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

const INTERVAL_MAP: Record<string, string> = {
    "60": "1h",
    M1: "1m",
    M5: "5m",
    M15: "15m",
    M30: "30m",
    H1: "1h",
    H4: "4h",
    D1: "1D",
    W1: "1W",
    MN: "1M",
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "4h": "4h",
    "240": "4h",
    "1D": "1D",
    "1W": "1W",
    "1M": "1M",
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

function generateMockData(count = 150, basePrice = 1.085): GoChartTick[] {
    const points: GoChartTick[] = [];
    let price = basePrice;
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        const change = (Math.random() - 0.48) * 0.003;
        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + Math.random() * 0.001;
        const low = Math.min(open, close) - Math.random() * 0.001;
        const volume = Math.floor(Math.random() * 100000 + 5000);
        points.push({
            time: now - (count - i) * 60000,
            open,
            high,
            low,
            close,
            volume,
        });
        price = close;
    }
    return points;
}

type ResolutionLike = string | { scale?: string; units?: number; type?: string };

function resolutionToSeconds(resolution: ResolutionLike): number {
    const str = typeof resolution === "string"
        ? resolution
        : resolution?.type || "";
    const num = parseInt(str, 10);
    if (str.endsWith("m") && !isNaN(num)) return num * 60;
    if (str.endsWith("h") && !isNaN(num)) return num * 3600;
    if (str === "1D" || str === "D" || str === "D1") return 86400;
    if (str === "1W" || str === "W" || str === "W1") return 604800;
    if (str === "1M" || str === "MN" || str === "MN1") return 2592000;
    if (typeof resolution !== "string" && resolution?.scale) {
        const secs: Record<string, number> = {
            seconds: 1, minutes: 60, hours: 3600,
            days: 86400, weeks: 604800, months: 2592000,
        };
        return (resolution.units ?? 1) * (secs[resolution.scale] ?? 60);
    }
    return 60;
}

function createMockDatafeed(
    onTick?: (data: GoChartTick) => void
): GoChartingDatafeed {
    const initialData = generateMockData(150, 1.085);
    let lastPrice = initialData[initialData.length - 1]?.close ?? 1.085;

    return {
        resolveSymbol(
            symbolName: string,
            onResolve: (info: GoChartingSymbolInfo) => void
        ) {
            const cleanSymbol = symbolName.replace(/^FX:/, "");
            onResolve({
                symbol: cleanSymbol,
                full_name: symbolName,
                description: symbolName,
                type:
                    symbolName.startsWith("BTC") || symbolName.startsWith("ETH")
                        ? "crypto"
                        : "forex",
                session: "24x7",
                timezone: "UTC",
                has_intraday: true,
                has_daily: true,
                supported_resolutions: ["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W", "1M"],
                tick_size: symbolName.startsWith("FX:") ? 0.0001 : 0.01,
                display_tick_size: symbolName.startsWith("FX:") ? 0.0001 : 0.01,
                data_status: "streaming",
                tradeable: true,
                exchange: symbolName.startsWith("FX:")
                    ? "FX"
                    : symbolName.startsWith("BTC") || symbolName.startsWith("ETH")
                      ? "CRYPTO"
                      : "INDEX",
                segment: "SPOT",
                exchange_info: {
                    name: "mock",
                    code: "MOCK",
                    zone: "UTC",
                    hours: [{ open: true }],
                    valid_intervals: ["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W", "1M"],
                },
            });
        },

        async getBars(
            _symbolInfo: GoChartingSymbolInfo,
            resolution: ResolutionLike,
            periodParams: GoChartingPeriodParams
        ): Promise<GoChartingUDFResponse> {
            const count = Math.min(periodParams?.countBack || periodParams?.rows || 150, 500);
            const now = Math.floor(Date.now() / 1000);
            const intervalSec = resolutionToSeconds(resolution);
            const bars: GoChartTick[] = [];
            let price = lastPrice;

            for (let i = count - 1; i >= 0; i--) {
                const time = now - i * intervalSec;
                const change = (Math.random() - 0.48) * 0.003;
                const open = price;
                const close = price + change;
                const high = Math.max(open, close) + Math.random() * 0.001;
                const low = Math.min(open, close) - Math.random() * 0.001;
                const volume = Math.floor(Math.random() * 100000 + 5000);
                bars.push({ time: time * 1000, open, high, low, close, volume });
                price = close;
            }

            lastPrice = price;

            if (!bars.length) {
                return { s: "no_data", nextTime: null };
            }

            return {
                s: "ok",
                t: bars.map((b) => Math.floor(b.time / 1000)),
                o: bars.map((b) => b.open),
                h: bars.map((b) => b.high),
                l: bars.map((b) => b.low),
                c: bars.map((b) => b.close),
                v: bars.map((b) => b.volume),
                nextTime: null,
            };
        },

        subscribeTicks(
            symbolInfo: GoChartingSymbolInfo,
            _resolution: ResolutionLike,
            onRealtimeCallback: (tick: GoChartingRealtimeTick) => void
        ) {
            const interval = setInterval(() => {
                const change = (Math.random() - 0.48) * 0.002;
                lastPrice = Math.max(0.001, lastPrice + change);
                const volume = Math.floor(Math.random() * 100000 + 5000);
                const tick: GoChartingRealtimeTick = {
                    type: "trade",
                    productId: symbolInfo.full_name || "FX:EURUSD",
                    symbol: symbolInfo.symbol || "EURUSD",
                    exchange: symbolInfo.exchange || "FX",
                    segment: symbolInfo.segment || "SPOT",
                    timeStamp: new Date(),
                    tradeID: String(Date.now()),
                    price: lastPrice,
                    quantity: volume,
                    amount: lastPrice * volume,
                    side: Math.random() > 0.5 ? "Buy" : "Sell",
                };
                onRealtimeCallback(tick);
                onTick?.({
                    time: tick.timeStamp.getTime(),
                    open: lastPrice - change,
                    high: Math.max(lastPrice - change, lastPrice) + Math.random() * 0.0005,
                    low: Math.min(lastPrice - change, lastPrice) - Math.random() * 0.0005,
                    close: lastPrice,
                    volume,
                });
            }, 3000);
            return interval;
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
    const [sdkLoaded, setSdkLoaded] = useState(false);
    const [sdkError, setSdkError] = useState<string | null>(null);
    const [currentSymbol, setCurrentSymbol] = useState(symbol);
    const [timeframe, setTimeframe] = useState(interval);
    const [chartTypes, setChartTypes] = useState(chartType);
    const [appliedStudies, setAppliedStudies] = useState<string[]>(() =>
        resolveStudies(studies)
    );
    const [showStudyMenu, setShowStudyMenu] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (window.GoChartingSDK) {
            setSdkLoaded(true);
            return;
        }

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

        const datafeed = createMockDatafeed(onTick);

        const resolvedStudies = resolveStudies(appliedStudies);

        try {
            const wrapper = window.GoChartingSDK!.createChart(`#${containerId}`, {
                symbol: currentSymbol,
                interval: INTERVAL_MAP[timeframe] ?? timeframe,
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
            setSdkError(err instanceof Error ? err.message : "Failed to create GoCharting chart");
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
                    {currentSymbol} · {INTERVAL_MAP[timeframe] ?? timeframe}
                </span>
            </div>
        </div>
    );
}
