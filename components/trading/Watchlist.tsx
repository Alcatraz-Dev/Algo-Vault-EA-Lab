"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
    TrendingUp,
    TrendingDown,
    Loader2,
    RefreshCw,
    Plus,
    Trash2,
    Search,
    X,
    RotateCcw,
    Eye,
} from "lucide-react";
import { SUPPORTED_SYMBOLS } from "@/lib/market-data/types";

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

const STORAGE_KEY = "trading_watchlist_symbols_v2";

export default function Watchlist({
    onSelect,
    selectedSymbol,
}: {
    onSelect: (symbol: string) => void;
    selectedSymbol: string;
}) {
    const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);

    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) setSymbols(parsed);
            }
        } catch {
            // Ignore fallback
        }
    }, []);

    const [quotes, setQuotes] = useState<QuoteMap>({});
    const [loading, setLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState<number>(0);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    // Save symbols to localStorage
    const updateSymbols = (newList: string[]) => {
        setSymbols(newList);
        if (typeof window !== "undefined") {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(newList));
            } catch {
                // Ignore
            }
        }
    };

    const handleAddSymbol = (sym: string) => {
        if (!symbols.includes(sym)) {
            const updated = [...symbols, sym];
            updateSymbols(updated);
        }
        setIsAddOpen(false);
        setSearchQuery("");
        onSelect(sym);
    };

    const handleRemoveSymbol = (e: React.MouseEvent, sym: string) => {
        e.stopPropagation();
        if (symbols.length <= 1) return; // keep at least 1 symbol
        const updated = symbols.filter((s) => s !== sym);
        updateSymbols(updated);
        if (sym === selectedSymbol && updated.length > 0) {
            onSelect(updated[0]);
        }
    };

    const handleResetWatchlist = () => {
        updateSymbols(DEFAULT_SYMBOLS);
    };

    const fetchQuotes = useCallback(async () => {
        if (symbols.length === 0) return;
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
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [fetchQuotes]);

    const getQuote = (symbol: string): QuoteData | null => quotes[symbol] || null;

    const availableToAdd = SUPPORTED_SYMBOLS.filter(
        (s) =>
            !symbols.includes(s) &&
            s.toLowerCase().includes(searchQuery.toLowerCase().trim())
    );

    return (
        <div className="flex flex-col rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            {/* Pro Terminal Panel Header */}
            <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-card">
                <div className="flex items-center gap-2">
                    <Eye className="size-3.5 text-muted-foreground" />
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Watchlist</h2>
                    <span className="text-xs text-muted-foreground font-mono">({symbols.length})</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setIsAddOpen(!isAddOpen)}
                        title="Add symbol to watchlist"
                        className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                        <Plus className="size-3" />
                    </button>
                    <button
                        type="button"
                        onClick={handleResetWatchlist}
                        title="Reset to default watchlist"
                        className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                        <RotateCcw className="size-3" />
                    </button>
                    <button
                        type="button"
                        onClick={fetchQuotes}
                        title="Refresh quotes"
                        className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                        <RefreshCw className={cn("size-3", loading && "animate-spin")} />
                    </button>
                </div>
            </div>

            {/* Add Symbol Filter Box */}
            {isAddOpen && (
                <div className="border-b border-border bg-muted/30 p-2">
                    <div className="relative mb-1.5">
                        <Search className="absolute left-2.5 top-2 size-3 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search market symbol..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full rounded-md border border-border bg-background pl-7 pr-6 py-1 text-xs font-mono outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
                            autoFocus
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery("")}
                                className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                    <div className="max-h-36 overflow-y-auto">
                        {availableToAdd.length > 0 ? (
                            availableToAdd.slice(0, 15).map((sym) => (
                                <button
                                    key={sym}
                                    type="button"
                                    onClick={() => handleAddSymbol(sym)}
                                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left font-mono text-xs text-foreground/80 transition hover:bg-muted hover:text-foreground"
                                >
                                    <span>{sym}</span>
                                    <Plus className="size-3 text-primary" />
                                </button>
                            ))
                        ) : (
                            <p className="px-2 py-1 text-xs text-muted-foreground">
                                {searchQuery ? "No matching symbol." : "All supported symbols on watchlist."}
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Pro Terminal Scalping Table */}
            <div className="min-w-0 max-h-[460px] overflow-y-auto">
                <table className="w-full border-collapse text-xs">
                    <thead>
                        <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground sticky top-0 bg-card z-10">
                            <th className="px-3 py-1.5 font-medium">Symbol</th>
                            <th className="px-2 py-1.5 text-right font-medium">Bid</th>
                            <th className="px-2 py-1.5 text-right font-medium">Chg%</th>
                            <th className="px-2 py-1.5 text-right font-medium">Spr</th>
                            <th className="w-6 px-1 py-1.5" aria-label="Remove" />
                        </tr>
                    </thead>
                    <tbody>
                        {symbols.map((symbol) => {
                            const isSelected = symbol === selectedSymbol;
                            const quote = getQuote(symbol);
                            const chg = quote?.changePercent ?? null;
                            const isPositive = chg !== null ? chg >= 0 : null;

                            return (
                                <tr
                                    key={symbol}
                                    onClick={() => onSelect(symbol)}
                                    className={cn(
                                        "group cursor-pointer border-b border-border/50 transition last:border-0 hover:bg-muted/60",
                                        isSelected && "bg-primary/10 font-semibold"
                                    )}
                                >
                                    <td className="px-3 py-2">
                                        <span className={cn(
                                            "font-mono text-xs font-bold",
                                            isSelected ? "text-primary" : "text-foreground"
                                        )}>
                                            {symbol}
                                        </span>
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                        {quote ? (
                                            <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                                                {quote.bid.toFixed(quote.bid >= 100 ? 2 : quote.bid >= 1 ? 4 : 5)}
                                            </span>
                                        ) : (
                                            <span className="font-mono text-xs text-muted-foreground">—</span>
                                        )}
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                        {chg !== null ? (
                                            <span className={cn(
                                                "font-mono text-xs font-medium tabular-nums",
                                                isPositive ? "text-positive" : "text-negative"
                                            )}>
                                                {isPositive ? "+" : ""}{chg.toFixed(2)}%
                                            </span>
                                        ) : (
                                            <span className="font-mono text-xs text-muted-foreground">—</span>
                                        )}
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                        {quote && quote.spread > 0 ? (
                                            <span className="font-mono text-micro text-muted-foreground tabular-nums">
                                                {quote.spread.toFixed(quote.spread >= 1 ? 2 : 4)}
                                            </span>
                                        ) : (
                                            <span className="font-mono text-xs text-muted-foreground">—</span>
                                        )}
                                    </td>
                                    <td className="px-1 py-2 text-center">
                                        <button
                                            type="button"
                                            onClick={(e) => handleRemoveSymbol(e, symbol)}
                                            title="Remove symbol"
                                            className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-negative transition-opacity"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
