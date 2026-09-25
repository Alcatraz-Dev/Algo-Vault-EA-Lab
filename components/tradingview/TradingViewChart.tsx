"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

type TradingViewChartProps = {
    symbol?: string;
    interval?: string;
    studies?: string[];
    height?: number;
    theme?: "dark" | "light";
};

const STUDY_MAP: Record<string, string> = {
    "MASimple@tv-basicstudies": "MASimple@tv-basicstudies",
    "RSI@tv-basicstudies": "RSI@tv-basicstudies",
    "MACD@tv-basicstudies": "MACD@tv-basicstudies",
    "BB@tv-basicstudies": "BB@tv-basicstudies",
    "Stochastic@tv-basicstudies": "Stochastic@tv-basicstudies",
    "ADX@tv-basicstudies": "ADX@tv-basicstudies",
    "ATR@tv-basicstudies": "ATR@tv-basicstudies",
    "CCI@tv-basicstudies": "CCI@tv-basicstudies",
    "PSAR@tv-basicstudies": "PSAR@tv-basicstudies",
    "VWAP@tv-basicstudies": "VWAP@tv-basicstudies",
    "Volume@tv-basicstudies": "Volume@tv-basicstudies",
    "IchimokuCloud@tv-basicstudies": "IchimokuCloud@tv-basicstudies",
    "SuperTrend@tv-basicstudies": "SuperTrend@tv-basicstudies",
    "EMA@tv-basicstudies": "MASimple@tv-basicstudies",
    "MAExp@tv-basicstudies": "MASimple@tv-basicstudies",
    "WilliamsR@tv-basicstudies": "WilliamsR@tv-basicstudies",
    "StochRSI@tv-basicstudies": "StochRSI@tv-basicstudies",
    "MOM@tv-basicstudies": "MOM@tv-basicstudies",
    "ROC@tv-basicstudies": "ROC@tv-basicstudies",
    "OBV@tv-basicstudies": "OBV@tv-basicstudies",
    "CMF@tv-basicstudies": "CMF@tv-basicstudies",
    "ForceIndex@tv-basicstudies": "ForceIndex@tv-basicstudies",
    "KeltnerChannels@tv-basicstudies": "KeltnerChannels@tv-basicstudies",
    "DonchianChannels@tv-basicstudies": "DonchianChannels@tv-basicstudies",
    "PriceVolume@tv-basicstudies": "PriceVolume@tv-basicstudies",
    "VolumeOscillator@tv-basicstudies": "VolumeOscillator@tv-basicstudies",
};

function subscribeToTheme(callback: () => void) {
    const observer = new MutationObserver(callback);
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
    });
    return () => observer.disconnect();
}

function isDarkMode() {
    return document.documentElement.classList.contains("dark");
}

function toTradingViewSymbol(symbol: string): string {
    if (symbol.startsWith("FX:")) return symbol.replace("FX:", "FX:");
    if (symbol.startsWith("XAU:")) return symbol.replace("XAU:", "XAU:");
    if (symbol.startsWith("BTC")) return "BTCUSD";
    if (symbol.startsWith("ETH")) return "ETHUSD";
    if (symbol.startsWith("INDU")) return "INDEX:DJI";
    return symbol;
}

function toTradingViewInterval(interval: string): string {
    const map: Record<string, string> = {
        "1m": "1",
        "5m": "5",
        "15m": "15",
        "30m": "30",
        "1h": "60",
        "4h": "240",
        "1D": "D",
        "1W": "W",
        "1M": "M",
    };
    return map[interval] ?? "60";
}

const SCRIPT_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

export default function TradingViewChart({
    symbol = "FX:EURUSD",
    interval = "1h",
    studies = [],
    height = 620,
    theme,
}: TradingViewChartProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mountedRef = useRef(true);
    const instanceIdRef = useRef<string>("");

    const dark = useSyncExternalStore(subscribeToTheme, isDarkMode, () => true);
    const effectiveTheme: "dark" | "light" = theme ?? (dark ? "dark" : "light");

    useEffect(() => {
        mountedRef.current = true;
        if (!instanceIdRef.current) {
            instanceIdRef.current = `tv-${Math.random().toString(36).slice(2)}-${Date.now()}`;
        }
        const container = containerRef.current;
        if (!container) return;

        const widgetId = `tradingview-widget-${instanceIdRef.current}`;
        const ownedScriptId = `tradingview-script-${instanceIdRef.current}`;

        // Prevent duplicate initialization for this instance container
        if (container.querySelector(`#${widgetId}`)) {
            return;
        }

        container.replaceChildren();

        const widgetDiv = document.createElement("div");
        widgetDiv.id = widgetId;
        widgetDiv.style.width = "100%";
        container.appendChild(widgetDiv);

        const activeStudies = studies
            .filter((s) => STUDY_MAP[s])
            .map((s) => STUDY_MAP[s]);

        const isDark = effectiveTheme === "dark";

        const script = document.createElement("script");
        script.id = ownedScriptId;
        script.src = SCRIPT_SRC;
        script.type = "text/javascript";
        // Synchronous execution ensures document.currentScript is available to the embed script
        script.async = false;
        script.innerHTML = JSON.stringify({
            width: "100%",
            height,
            symbol: toTradingViewSymbol(symbol),
            interval: toTradingViewInterval(interval),
            timezone: "Etc/UTC",
            theme: isDark ? "dark" : "light",
            style: "1",
            locale: "en",
            backgroundColor: isDark ? "#0b1118" : "#ffffff",
            hide_side_toolbar: false,
            allow_symbol_change: true,
            show_symbol_logo: false,
            withdaterange: true,
            studies: activeStudies,
            details: true,
            hotlist: true,
            calendar: false,
            studies_overlay: true,
            container_id: widgetId,
        });
        container.appendChild(script);

        return () => {
            mountedRef.current = false;
            // Use the captured container from effect start, not the mutable ref
            if (container) {
                const ownedWidget = container.querySelector(`#${widgetId}`);
                if (ownedWidget) ownedWidget.remove();
            }
            const ownedScript = document.getElementById(ownedScriptId);
            if (ownedScript) ownedScript.remove();
        };
    }, [symbol, interval, studies, height, effectiveTheme]);

    return <div ref={containerRef} className="w-full" style={{ height: `${height}px` }} />;
}
