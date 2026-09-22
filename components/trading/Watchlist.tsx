"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
    TrendingUp,
    TrendingDown,
    Loader2,
    RefreshCw,
} from "lucide-react";

const DEFAULT_SYMBOLS = [
    "XAUUSD",
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "BTCUSD",
    "ETHUSD",
    "US30",
    "NAS100",
    "SPX500",
    "USDCHF",
    "AUDUSD",
    "NZDUSD",
];

type QuoteData = {
    symbol: string;
    bid: number;
    ask: number;
    spread: number;
    change: number;
    changePercent: number;
    timestamp: number;
};

type QuoteMap = Record<string, QuoteData>;

export default function Watchlist({
    symbols = DEFAULT_SYMBOLS,
    onSelect,
    selectedSymbol,
}: {
    symbols?: string[];
    onSelect: (symbol: string) => void;
    selectedSymbol: string;
}) {
    const [quotes, setQuotes] = useState<QuoteMap>({});
    const [loading, setLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState<number>(0);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const fetchQuotes = useCallback(async () => {
        try {
            const symbolList = symbols.join(",");
            const res = await fetch(`/api/analytics/watchlist?symbols=${symbolList}`);
            const json = await res.json();
            if (json.success && json.quotes) {
                setQuotes(json.quotes);
                setLastUpdate(Date.now());
            }
        } catch {} finally {
            setLoading(false);
        }
    }, [symbols]);

    useEffect(() => {
        void Promise.resolve().then(() => fetchQuotes());
        intervalRef.current = setInterval(fetchQuotes, 5000);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [fetchQuotes]);

    const getQuote = (symbol: string): QuoteData | null => quotes[symbol] || null;

    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Watchlist
                </p>
                <div className="flex items-center gap-2">
                    {lastUpdate > 0 && (
                        <span className="text-[9px] text-foreground/50">
                            {new Date(lastUpdate).toLocaleTimeString()}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={fetchQuotes}
                        className="rounded p-0.5 text-foreground/50 hover:text-foreground transition"
                    >
                        <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>
            <div className="flex flex-col overflow-y-auto">
                {symbols.map((symbol) => {
                    const isSelected = symbol === selectedSymbol;
                    const quote = getQuote(symbol);
                    const isPositive = quote ? quote.changePercent >= 0 : null;

                    return (
                        <button
                            key={symbol}
                            type="button"
                            onClick={() => onSelect(symbol)}
                            className={cn(
                                "flex items-center justify-between border-b border-border/50 px-3 py-2 text-left text-sm transition-colors",
                                isSelected
                                    ? "bg-foreground text-background"
                                    : "text-foreground hover:bg-muted"
                            )}
                        >
                            <div className="flex flex-col">
                                <span className="font-semibold">{symbol}</span>
                                {quote && (
                                    <span className={cn(
                                        "text-[10px] font-mono",
                                        isPositive ? "text-emerald-500" : "text-rose-500"
                                    )}>
                                        {isPositive ? "+" : ""}{quote.changePercent.toFixed(2)}%
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-col items-end">
                                {quote ? (
                                    <span className="font-mono text-xs tabular-nums">
                                        {quote.bid.toFixed(quote.bid >= 100 ? 2 : quote.bid >= 1 ? 5 : 6)}
                                    </span>
                                ) : (
                                    <span className="font-mono text-xs text-muted-foreground">--</span>
                                )}
                                {quote && quote.spread > 0 && (
                                    <span className="text-[9px] text-foreground/50">
                                        Spread: {quote.spread.toFixed(quote.spread >= 1 ? 2 : 5)}
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
