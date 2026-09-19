"use client";

import { useEffect, useRef } from "react";

export default function TradingViewEconomicCalendar() {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        container.replaceChildren();
        const widget = document.createElement("div");
        widget.className = "tradingview-widget-container__widget";
        container.appendChild(widget);

        const script = document.createElement("script");
        script.src = "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
        script.async = true;
        script.innerHTML = JSON.stringify({
            colorTheme: "dark",
            isTransparent: true,
            width: "100%",
            height: 520,
            locale: "en",
            importanceFilter: "0,1",
            currencyFilter: "USD,EUR,GBP,JPY,AUD,CAD,CHF,NZD",
        });
        container.appendChild(script);

        return () => container.replaceChildren();
    }, []);

    return <div ref={containerRef} className="min-h-[520px] w-full" />;
}
