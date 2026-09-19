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

export default function TradingViewChart({
    symbol = "FX:EURUSD",
    interval = "1h",
    studies = [],
    height = 620,
    theme,
}: TradingViewChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetRef = useRef<HTMLDivElement | null>(null);
    const scriptRef = useRef<HTMLScriptElement | null>(null);
    const dark = useSyncExternalStore(subscribeToTheme, isDarkMode, () => true);
    const effectiveTheme: "dark" | "light" = theme ?? (dark ? "dark" : "light");

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        container.replaceChildren();

        const widgetId = `tradingview_${Date.now()}`;
        const widgetDiv = document.createElement("div");
        widgetDiv.id = widgetId;
        widgetDiv.style.width = "100%";
        container.appendChild(widgetDiv);
        widgetRef.current = widgetDiv;

        const activeStudies = studies
            .filter((s) => STUDY_MAP[s])
            .map((s) => STUDY_MAP[s]);

        const dark = effectiveTheme === "dark";

        const script = document.createElement("script");
        script.src =
            "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
        script.async = true;
        script.type = "text/javascript";
        script.innerHTML = JSON.stringify({
            width: "100%",
            height,
            symbol: toTradingViewSymbol(symbol),
            interval: toTradingViewInterval(interval),
            timezone: "Etc/UTC",
            theme: dark ? "dark" : "light",
            style: "1",
            locale: "en",
            backgroundColor: dark ? "#0b1118" : "#ffffff",
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
        scriptRef.current = script;

        return () => {
            container.replaceChildren();
            widgetRef.current = null;
            scriptRef.current = null;
        };
    }, [symbol, interval, studies, height, effectiveTheme]);

    return <div ref={containerRef} className="w-full" style={{ height: `${height}px` }} />;
}
