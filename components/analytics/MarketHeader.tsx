"use client";

import { useState } from "react";
import {
    TrendingUp,
    TrendingDown,
    Clock,
    Zap,
    Target,
    ChevronDown,
    Loader2,
    RefreshCw,
    Wifi,
    WifiOff,
} from "lucide-react";
import { SupportedSymbol, Timeframe, SUPPORTED_SYMBOLS } from "@/lib/market-data/types";
import { cn } from "@/lib/utils";

type MarketQuote = {
    symbol: string;
    bid: number;
    ask: number;
    spread: number;
    change: number;
    changePercent: number;
    timestamp: number;
};

type SessionData = {
    current: string;
    name: string;
    high: number;
    low: number;
    range: number;
};

type VolatilityData = {
    atr: number;
    atrPercent: number;
    state: string;
};

type RegimeData = {
    regime: string;
    confidence: number;
};

type MarketHeaderProps = {
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    quote?: MarketQuote;
    session?: SessionData;
    volatility?: VolatilityData;
    regime?: RegimeData;
    onSymbolChange: (symbol: SupportedSymbol) => void;
    onTimeframeChange: (timeframe: Timeframe) => void;
    isLoading: boolean;
    isConnected: boolean;
    onRefresh: () => void;
    stickyTop?: string;
};

const TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];

function getRegimeColor(regime: string): string {
    if (regime.includes("bullish")) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    if (regime.includes("bearish")) return "text-rose-400 bg-rose-500/10 border-rose-500/20";
    if (regime.includes("range")) return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    if (regime.includes("breakout")) return "text-primary bg-primary/10 border-primary/20";
    if (regime.includes("high")) return "text-orange-400 bg-orange-500/10 border-orange-500/20";
    if (regime.includes("low")) return "text-sky-400 bg-sky-500/10 border-sky-500/20";
    return "text-muted-foreground bg-muted/10 border-border/30";
}

function getVolatilityColor(state: string): string {
    if (state === "extreme") return "text-rose-400";
    if (state === "high") return "text-orange-400";
    if (state === "low") return "text-sky-400";
    return "text-muted-foreground";
}

function getSessionIcon(name: string): string {
    if (name === "London") return "🇬🇧";
    if (name === "New York") return "🇺🇸";
    if (name === "Asian") return "🇯🇵";
    if (name.includes("Overlap")) return "🌐";
    return "⏸️";
}

export default function MarketHeader({
    symbol,
    timeframe,
    quote,
    session,
    volatility,
    regime,
    onSymbolChange,
    onTimeframeChange,
    isLoading,
    isConnected,
    onRefresh,
    stickyTop = "top-14",
}: MarketHeaderProps) {
    const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);

    const isPositive = (quote?.changePercent || 0) >= 0;

    return (
        <div className={cn("sticky z-30 border-b border-border bg-background/95 backdrop-blur-md", stickyTop)}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
                {/* Symbol selector */}
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setShowSymbolDropdown(!showSymbolDropdown)}
                        className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 font-mono text-sm font-semibold text-foreground transition hover:border-primary/40 hover:text-primary"
                    >
                        {symbol}
                        <ChevronDown size={14} className={cn("text-muted-foreground transition-transform", showSymbolDropdown && "rotate-180")} />
                    </button>
                    {showSymbolDropdown && (
                        <div className="absolute top-full left-0 z-50 mt-1 w-48 rounded-xl border border-border bg-popover p-1 shadow-2xl">
                            {SUPPORTED_SYMBOLS.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => { onSymbolChange(s); setShowSymbolDropdown(false); }}
                                    className={cn(
                                        "flex w-full items-center rounded-lg px-3 py-2 font-mono text-sm transition",
                                        s === symbol ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                    )}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Price */}
                <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold font-mono text-foreground tabular-nums">
                        {quote ? quote.bid.toFixed(quote.bid >= 100 ? 2 : quote.bid >= 1 ? 5 : 6) : "—"}
                    </span>
                    {quote && (
                        <span className={cn("flex items-center gap-1 text-sm font-medium", isPositive ? "text-emerald-400" : "text-rose-400")}>
                            {isPositive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                            {isPositive ? "+" : ""}{quote.changePercent.toFixed(2)}%
                        </span>
                    )}
                </div>

                {/* Bid/Ask */}
                {quote && (
                    <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
                        <span>Bid <span className="font-mono tabular-nums text-foreground/80">{quote.bid.toFixed(quote.bid >= 100 ? 2 : 5)}</span></span>
                        <span>Ask <span className="font-mono tabular-nums text-foreground/80">{quote.ask.toFixed(quote.ask >= 100 ? 2 : 5)}</span></span>
                        <span>Spread <span className="font-mono tabular-nums text-foreground/80">{quote.spread.toFixed(quote.spread >= 1 ? 2 : 5)}</span></span>
                    </div>
                )}

                <div className="ml-auto" />

                {/* Session */}
                {session && (
                    <div className="hidden items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs sm:flex">
                        <Clock size={12} className="text-muted-foreground" />
                        <span className="text-muted-foreground">{getSessionIcon(session.name)} {session.name}</span>
                    </div>
                )}

                {/* Volatility */}
                {volatility && (
                    <div className="hidden items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs md:flex">
                        <Zap size={12} className={getVolatilityColor(volatility.state)} />
                        <span className="text-muted-foreground">
                            Vol: <span className={cn("font-medium capitalize", getVolatilityColor(volatility.state))}>{volatility.state}</span>
                        </span>
                        <span className="font-mono tabular-nums text-muted-foreground">{volatility.atrPercent.toFixed(2)}%</span>
                    </div>
                )}

                {/* Regime */}
                {regime && (
                    <div className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs", getRegimeColor(regime.regime))}>
                        <Target size={12} />
                        <span className="font-medium">{regime.regime.replace(/_/g, " ")}</span>
                        <span className="opacity-60">{regime.confidence}%</span>
                    </div>
                )}

                {/* Connection status */}
                <div className="flex items-center gap-1.5 text-xs">
                    {isConnected ? (
                        <><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span> <span className="font-medium text-emerald-400">Live</span></>
                    ) : (
                        <><WifiOff size={12} className="text-muted-foreground" /> <span className="text-muted-foreground">Offline</span></>
                    )}
                </div>

                {/* Actions */}
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={isLoading}
                    aria-label="Refresh analytics"
                    className="rounded-lg border border-border bg-muted p-1.5 text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:opacity-50"
                >
                    {isLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                </button>
            </div>

            {/* Timeframe bar */}
            <div className="flex items-center gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
                {TIMEFRAMES.map((tf) => (
                    <button
                        key={tf}
                        type="button"
                        onClick={() => onTimeframeChange(tf)}
                        className={cn(
                            "rounded-md px-2.5 py-1 font-mono text-xs font-medium transition",
                            tf === timeframe
                                ? "bg-primary/15 text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                    >
                        {tf}
                    </button>
                ))}
            </div>
        </div>
    );
}
