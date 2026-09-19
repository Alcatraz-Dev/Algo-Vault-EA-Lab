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
};

const TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];

function getRegimeColor(regime: string): string {
    if (regime.includes("bullish")) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    if (regime.includes("bearish")) return "text-rose-400 bg-rose-500/10 border-rose-500/20";
    if (regime.includes("range")) return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    if (regime.includes("breakout")) return "text-violet-400 bg-violet-500/10 border-violet-500/20";
    if (regime.includes("high")) return "text-orange-400 bg-orange-500/10 border-orange-500/20";
    if (regime.includes("low")) return "text-blue-400 bg-blue-500/10 border-blue-500/20";
    return "text-muted-foreground bg-muted/10 border-border/30";
}

function getVolatilityColor(state: string): string {
    if (state === "extreme") return "text-rose-400";
    if (state === "high") return "text-orange-400";
    if (state === "low") return "text-blue-400";
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
}: MarketHeaderProps) {
    const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);

    const isPositive = (quote?.changePercent || 0) >= 0;

    return (
        <div className="border-b border-border/12 bg-foreground/80 backdrop-blur-md">
            <div className="flex items-center gap-4 px-4 py-2.5">
                {/* Symbol selector */}
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setShowSymbolDropdown(!showSymbolDropdown)}
                        className="flex items-center gap-2 rounded-lg bg-foreground/8 px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-background/14 transition"
                    >
                        {symbol}
                        <ChevronDown size={14} className="text-foreground/70" />
                    </button>
                    {showSymbolDropdown && (
                        <div className="absolute top-full left-0 z-50 mt-1 w-48 rounded-xl border border-border/15 bg-background p-1 shadow-2xl">
                            {SUPPORTED_SYMBOLS.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => { onSymbolChange(s); setShowSymbolDropdown(false); }}
                                    className={cn(
                                        "flex w-full items-center rounded-lg px-3 py-2 text-sm transition",
                                        s === symbol ? "bg-violet-500/15 text-violet-400" : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
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
                    <div className="flex items-center gap-3 text-xs text-foreground/70">
                        <span>Bid <span className="font-mono text-foreground/70">{quote.bid.toFixed(quote.bid >= 100 ? 2 : 5)}</span></span>
                        <span>Ask <span className="font-mono text-foreground/70">{quote.ask.toFixed(quote.ask >= 100 ? 2 : 5)}</span></span>
                        <span>Spread <span className="font-mono text-foreground/70">{quote.spread.toFixed(quote.spread >= 1 ? 2 : 5)}</span></span>
                    </div>
                )}

                <div className="ml-auto" />

                {/* Session */}
                {session && (
                    <div className="flex items-center gap-1.5 rounded-lg border border-border/12 bg-foreground/6 px-2.5 py-1.5 text-xs">
                        <Clock size={12} className="text-foreground/70" />
                        <span className="text-muted-foreground">{getSessionIcon(session.name)} {session.name}</span>
                    </div>
                )}

                {/* Volatility */}
                {volatility && (
                    <div className="flex items-center gap-1.5 rounded-lg border border-border/12 bg-foreground/6 px-2.5 py-1.5 text-xs">
                        <Zap size={12} className={getVolatilityColor(volatility.state)} />
                        <span className="text-muted-foreground">
                            Vol: <span className={cn("font-medium", getVolatilityColor(volatility.state))}>{volatility.state}</span>
                        </span>
                        <span className="font-mono text-foreground/70">{volatility.atrPercent.toFixed(2)}%</span>
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
                <div className="flex items-center gap-1.5 text-xs text-foreground/70">
                    {isConnected ? (
                        <><Wifi size={12} className="text-emerald-400" /> <span className="text-emerald-400">Live</span></>
                    ) : (
                        <><WifiOff size={12} /> <span>Offline</span></>
                    )}
                </div>

                {/* Actions */}
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={isLoading}
                    className="rounded-lg p-1.5 text-foreground/70 hover:text-foreground hover:bg-foreground/10 transition disabled:opacity-50"
                >
                    {isLoading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                </button>
            </div>

            {/* Timeframe bar */}
            <div className="flex items-center gap-1 px-4 pb-2">
                {TIMEFRAMES.map((tf) => (
                    <button
                        key={tf}
                        type="button"
                        onClick={() => onTimeframeChange(tf)}
                        className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-medium transition",
                            tf === timeframe
                                ? "bg-violet-500/15 text-violet-400"
                                : "text-foreground/70 hover:text-foreground/70 hover:bg-foreground/8"
                        )}
                    >
                        {tf}
                    </button>
                ))}
            </div>
        </div>
    );
}
