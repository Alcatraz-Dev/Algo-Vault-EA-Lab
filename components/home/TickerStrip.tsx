"use client";

import { useEffect, useRef, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { tradingViewLivePriceCache } from "@/lib/market-data/tradingview-live";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";

// Live quotes come from TradingView via the platform's own market-data client.
// The strip stays compact — just symbol, live price and change.
const SYMBOLS = [
    "XAUUSD",
    "BTCUSD",
    "EURUSD",
    "GBPUSD",
    "US30",
    "NAS100",
    "SPX500",
    "USDJPY",
    "ETHUSD",
    "XAGUSD",
] as const;

type Quote = {
    price: number;
    changePercent?: number;
    provider: string;
};

type QuoteMap = Record<string, Quote | undefined>;

function digitsFor(symbol: string): number {
    return getSymbolSpec(symbol)?.digits ?? 2;
}

function formatChange(percent?: number): string {
    if (percent === undefined || !Number.isFinite(percent)) return "—";
    return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function TickerItem({
    symbol,
    quote,
    flash,
    digits,
}: {
    symbol: string;
    quote?: Quote;
    flash?: "up" | "down";
    digits: number;
}) {
    const up = (quote?.changePercent ?? 0) >= 0;
    return (
        <div className="flex items-center gap-2 border-r border-border/60 px-4 py-1.5 text-micro">
            <span className="font-bold text-foreground">{symbol}</span>
            {quote ? (
                <>
                    <span
                        className={`font-mono tabular-nums ${
                            flash === "up"
                                ? "text-positive"
                                : flash === "down"
                                  ? "text-negative"
                                  : "text-muted-foreground"
                        }`}
                    >
                        {quote.price.toFixed(digits)}
                    </span>
                    <span
                        className={`flex items-center gap-0.5 font-semibold ${
                            up ? "text-positive" : "text-negative"
                        }`}
                    >
                        {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        {formatChange(quote.changePercent)}
                    </span>
                </>
            ) : (
                <span className="font-mono text-muted-foreground/50">···</span>
            )}
        </div>
    );
}

function TickerRow({
    quotes,
    flashes,
    digits,
}: {
    quotes: QuoteMap;
    flashes: Record<string, "up" | "down">;
    digits: Record<string, number>;
}) {
    return (
        <div className="flex shrink-0 items-center">
            {SYMBOLS.map((symbol) => (
                <TickerItem
                    key={symbol}
                    symbol={symbol}
                    quote={quotes[symbol]}
                    flash={flashes[symbol]}
                    digits={digits[symbol] ?? 2}
                />
            ))}
        </div>
    );
}

export default function TickerStrip() {
    const [quotes, setQuotes] = useState<QuoteMap>({});
    const [flashes, setFlashes] = useState<Record<string, "up" | "down">>({});
    const [loading, setLoading] = useState(true);
    const prevPricesRef = useRef<Record<string, number>>({});
    const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const digits = Object.fromEntries(SYMBOLS.map((s) => [s, digitsFor(s)]));

    useEffect(() => {
        let mounted = true;
        const timers = timersRef.current;

        const load = async () => {
            const entries = await Promise.all(
                SYMBOLS.map(async (symbol) => {
                    try {
                        const quote = await tradingViewLivePriceCache.get(symbol);
                        return [
                            symbol,
                            quote
                                ? {
                                      price: quote.price,
                                      changePercent: quote.changePercent,
                                      provider: quote.provider,
                                  }
                                : undefined,
                        ] as const;
                    } catch {
                        return [symbol, undefined] as const;
                    }
                })
            );
            if (!mounted) return;

            const next: QuoteMap = {};
            for (const [symbol, quote] of entries) next[symbol] = quote;
            setQuotes(next);
            setLoading(false);
        };

        void load();
        const id = setInterval(load, 6000);

        return () => {
            mounted = false;
            clearInterval(id);
            Object.values(timers).forEach((timer) => clearTimeout(timer));
        };
    }, []);

    // Flash the price color when a live quote ticks in a different direction.
    useEffect(() => {
        for (const [symbol, quote] of Object.entries(quotes)) {
            if (!quote) continue;
            const previous = prevPricesRef.current[symbol];
            if (previous !== undefined && previous !== quote.price) {
                const direction = quote.price > previous ? "up" : "down";
                if (timersRef.current[symbol]) clearTimeout(timersRef.current[symbol]);
                setFlashes((current) => ({ ...current, [symbol]: direction }));
                timersRef.current[symbol] = setTimeout(() => {
                    setFlashes((current) => {
                        const next = { ...current };
                        delete next[symbol];
                        return next;
                    });
                }, 800);
            }
            prevPricesRef.current[symbol] = quote.price;
        }
    }, [quotes]);

    return (
        <section className="relative overflow-hidden border-b border-border bg-card">
            <div className="flex items-stretch">
                <div className="flex shrink-0 items-center gap-2 border-r border-border px-3 py-1.5 text-micro font-semibold uppercase tracking-wider text-foreground">
                    <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive/60" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
                    </span>
                    Live
                    <span className="hidden text-muted-foreground sm:inline">· TradingView</span>
                </div>

                <div className="relative min-w-0 flex-1 overflow-hidden">
                    {loading ? (
                        <p className="px-3 py-1.5 text-micro text-muted-foreground">Connecting to TradingView…</p>
                    ) : (
                        <div className="ticker-track" aria-hidden="true">
                            <TickerRow quotes={quotes} flashes={flashes} digits={digits} />
                            <TickerRow quotes={quotes} flashes={flashes} digits={digits} />
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}