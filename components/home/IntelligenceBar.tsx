"use client";

import { Activity, ShieldCheck, Zap, BarChart2, Radio } from "lucide-react";

export type MarketItem = {
    symbol: string;
    price: string;
    change: string;
    regime: string;
    volatility: string;
    liquidity: string;
    structure: string;
    signal: string;
    status: "bullish" | "bearish" | "neutral";
};

const DEFAULT_ITEMS: MarketItem[] = [
    { symbol: "XAUUSD", price: "2,654.40", change: "+1.42%", regime: "Trending Bullish", volatility: "Normal ATR", liquidity: "SSL Swept", structure: "BOS Confirmed", signal: "BUY 92%", status: "bullish" },
    { symbol: "BTCUSD", price: "68,450.00", change: "+3.10%", regime: "Expansion", volatility: "High ATR", liquidity: "BSL Liquidity Pool", structure: "Higher High", signal: "BUY 88%", status: "bullish" },
    { symbol: "EURUSD", price: "1.0845", change: "-0.15%", regime: "Ranging", volatility: "Low ATR", liquidity: "Equal Lows", structure: "CHOCH Bearish", signal: "NEUTRAL", status: "neutral" },
    { symbol: "NAS100", price: "20,120.50", change: "+0.85%", regime: "Trending Bullish", volatility: "Normal ATR", liquidity: "Daily High Swept", structure: "Order Block Bounce", signal: "BUY 85%", status: "bullish" },
    { symbol: "SPX500", price: "5,740.20", change: "+0.45%", regime: "Consolidation", volatility: "Low ATR", liquidity: "Session Range", structure: "Inside Bar", signal: "NEUTRAL", status: "neutral" },
];

export default function IntelligenceBar() {
    return (
        <section className="border-b border-border/40 bg-card/40 py-3.5 backdrop-blur-md overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    
                    {/* Left Ticker Title */}
                    <div className="flex items-center gap-2 shrink-0">
                        <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                        </span>
                        <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <Radio size={14} className="text-emerald-400" />
                            Market Intelligence Status
                        </span>
                        <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground font-mono">
                            Preview
                        </span>
                    </div>

                    {/* Horizontal Items Stream */}
                    <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-1 text-xs">
                        {DEFAULT_ITEMS.map((item) => (
                            <div
                                key={item.symbol}
                                className="flex items-center gap-3 shrink-0 rounded-xl border border-border/50 bg-background/60 px-3.5 py-1.5 font-mono shadow-2xs hover:border-violet-500/40 transition"
                            >
                                <span className="font-bold text-foreground">{item.symbol}</span>
                                <span className={item.status === "bullish" ? "text-emerald-400" : item.status === "bearish" ? "text-rose-400" : "text-muted-foreground"}>
                                    {item.price} ({item.change})
                                </span>
                                <span className="text-[10px] text-muted-foreground border-l border-border/40 pl-2">
                                    {item.regime}
                                </span>
                                <span className="text-[10px] text-violet-400 font-semibold bg-violet-500/10 px-1.5 py-0.5 rounded">
                                    {item.signal}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Right Gateway Indicator */}
                    <div className="hidden xl:flex items-center gap-2 text-xs font-mono shrink-0 border-l border-border/40 pl-4 text-muted-foreground">
                        <ShieldCheck size={14} className="text-emerald-400" />
                        <span>MT5 Gateway Status:</span>
                        <span className="text-emerald-400 font-bold">READY</span>
                    </div>
                </div>
            </div>
        </section>
    );
}
