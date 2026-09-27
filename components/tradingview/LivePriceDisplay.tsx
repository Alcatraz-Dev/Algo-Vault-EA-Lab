"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowDownRight, Loader2 } from "lucide-react";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import { useLiveQuote } from "@/hooks/useLiveCandles";

interface LivePriceDisplayProps {
    symbol: string;
    timeframe?: string;
    compact?: boolean;
}

/**
 * LivePriceDisplay — real-time price badge driven by the shared live quote
 * poller (`useLiveQuote` → /api/market/quotes). Falls back to a dark candle
 * fetch only when the quote feed has not answered yet.
 */
export default function LivePriceDisplay({ symbol, timeframe = "H1", compact = false }: LivePriceDisplayProps) {
    const [price, setPrice] = useState<number>(0);
    const [hasQuote, setHasQuote] = useState(false);
    const [loading, setLoading] = useState(true);
    const [flash, setFlash] = useState<"up" | "down" | null>(null);
    const [lastDirection, setLastDirection] = useState<"up" | "down">("up");

    const previousPriceRef = useRef(0);
    const flashTimerRef = useRef<NodeJS.Timeout | null>(null);

    const spec = getSymbolSpec(symbol);
    const decimals = spec ? spec.digits : 2;

    const { quotes } = useLiveQuote([symbol], 5000);
    const quote = quotes[symbol.toUpperCase()];

    // Track direction + flash when the quote changes.
    useEffect(() => {
        if (!quote || !Number.isFinite(quote.price)) return;
        const newPrice = quote.price;
        const prev = previousPriceRef.current;
        if (prev > 0 && newPrice !== prev) {
            setFlash(newPrice > prev ? "up" : "down");
            setLastDirection(newPrice > prev ? "up" : "down");
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => setFlash(null), 600);
        }
        previousPriceRef.current = newPrice;
        setPrice(newPrice);
        setHasQuote(true);
        setLoading(false);
    }, [quote]);

    // Fallback seed: if the quote feed has not produced anything yet, pull the
    // latest close from the canonical candle feed once.
    useEffect(() => {
        if (hasQuote) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(
                    `/api/analytics/ohlc?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=2`,
                    { cache: "no-store" }
                );
                const body = (await res.json().catch(() => null)) as
                    | { candles?: Array<{ close: number }> }
                    | null;
                if (cancelled || hasQuote || !body?.candles?.length) return;
                const close = body.candles[body.candles.length - 1].close;
                if (!Number.isFinite(close)) return;
                setPrice((prev) => {
                    if (prev > 0) return prev;
                    previousPriceRef.current = close;
                    return close;
                });
                setLoading(false);
            } catch {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [symbol, timeframe, hasQuote]);

    useEffect(() => () => {
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    }, []);

    if (loading) {
        return (
            <div className={`flex items-center gap-2 ${compact ? "" : "py-2"}`}>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading price...</span>
            </div>
        );
    }

    const isUp = lastDirection === "up";

    if (compact) {
        return (
            <div className="flex items-center gap-1.5">
                <span className={`font-numeric text-sm font-semibold ${isUp ? "text-positive" : "text-negative"}`}>
                    {price.toFixed(decimals)}
                </span>
                {hasQuote && <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive animate-pulse" />}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-4">
            <div>
                <div className="flex items-center gap-2">
                    <span className={`font-numeric text-2xl font-bold ${isUp ? "text-positive" : "text-negative"}`}>
                        {price.toFixed(decimals)}
                    </span>
                    {hasQuote && <span className="inline-block h-2 w-2 rounded-full bg-positive animate-pulse" />}
                    {flash === "up" && <ArrowUpRight className="h-5 w-5 text-positive" />}
                    {flash === "down" && <ArrowDownRight className="h-5 w-5 text-negative" />}
                </div>
            </div>
            <span className="text-xs text-muted-foreground">{symbol}</span>
        </div>
    );
}
