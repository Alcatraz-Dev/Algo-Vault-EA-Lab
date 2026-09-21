"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowDownRight, Loader2 } from "lucide-react";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { marketDataStream } from "@/lib/market-data/market-truth";

interface LivePriceDisplayProps {
    symbol: string;
    timeframe?: string;
    compact?: boolean;
}

export default function LivePriceDisplay({ symbol, timeframe = "H1", compact = false }: LivePriceDisplayProps) {
    const [price, setPrice] = useState<number>(0);
    const [isLive, setIsLive] = useState(false);
    const [loading, setLoading] = useState(true);
    const [flash, setFlash] = useState<"up" | "down" | null>(null);

    const previousPriceRef = useRef(0);
    const flashTimerRef = useRef<NodeJS.Timeout | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const spec = getSymbolSpec(symbol);
    const decimals = spec ? spec.digits : 2;

    useEffect(() => {
        let mounted = true;
        setLoading(true);

        const updatePrice = (newPrice: number) => {
            if (!mounted) return;
            const prev = previousPriceRef.current;
            if (prev > 0 && newPrice !== prev) {
                setFlash(newPrice > prev ? "up" : "down");
                if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
                flashTimerRef.current = setTimeout(() => setFlash(null), 600);
            }
            previousPriceRef.current = newPrice;
            setPrice(newPrice);
            setIsLive(true);
            setLoading(false);
        };

        const fetchAndSubscribe = async () => {
            try {
                const sym = symbol.toUpperCase();
                const result = await fetchCandles(sym as any, timeframe as any, { to: Date.now() });
                if (!mounted) return;
                if (result.length > 0) {
                    updatePrice(result[result.length - 1].close);
                }

                const unsubscribe = marketDataStream.subscribe(sym as any, timeframe as any, (snapshot) => {
                    if (!mounted || !snapshot) return;
                    updatePrice(snapshot.currentPrice);
                }, { intervalMs: 5000 });

                return unsubscribe;
            } catch {
                if (mounted) setLoading(false);
            }
        };

        const cleanup = fetchAndSubscribe();

        intervalRef.current = setInterval(fetchAndSubscribe, 15000);

        return () => {
            mounted = false;
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            void cleanup;
        };
    }, [symbol, timeframe]);

    if (loading) {
        return (
            <div className={`flex items-center gap-2 ${compact ? "" : "py-2"}`}>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading price...</span>
            </div>
        );
    }

    const isUp = price >= previousPriceRef.current;

    if (compact) {
        return (
            <div className="flex items-center gap-1.5">
                <span className={`font-numeric text-sm font-semibold ${isUp ? "text-positive" : "text-negative"}`}>
                    {price.toFixed(decimals)}
                </span>
                {isLive && <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive animate-pulse" />}
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
                    {isLive && <span className="inline-block h-2 w-2 rounded-full bg-positive animate-pulse" />}
                    {flash === "up" && <ArrowUpRight className="h-5 w-5 text-positive" />}
                    {flash === "down" && <ArrowDownRight className="h-5 w-5 text-negative" />}
                </div>
            </div>
            <span className="text-xs text-muted-foreground">{symbol}</span>
        </div>
    );
}
