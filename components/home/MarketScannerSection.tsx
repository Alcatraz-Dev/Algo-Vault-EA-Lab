"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Database } from "lucide-react";

type ScannerRow = {
    symbol: string;
    category: string;
    regime: string;
    trend: "bullish" | "bearish" | "neutral";
    volatility: string;
    liquidity: string;
    volume: string;
    vwap: string;
    mtfScore: number;
    zoneScore: number;
};

const SAMPLE_SCANNER_DATA: ScannerRow[] = [
    { symbol: "XAUUSD", category: "Metals", regime: "Trending Bullish", trend: "bullish", volatility: "Normal ATR", liquidity: "SSL Swept", volume: "High (+42%)", vwap: "Above VWAP", mtfScore: 92, zoneScore: 88 },
    { symbol: "BTCUSD", category: "Crypto", regime: "Expansion", trend: "bullish", volatility: "High ATR", liquidity: "BSL Liquidity", volume: "High (+68%)", vwap: "Above VWAP", mtfScore: 88, zoneScore: 90 },
    { symbol: "EURUSD", category: "Forex", regime: "Ranging", trend: "neutral", volatility: "Low ATR", liquidity: "Equal Lows", volume: "Normal", vwap: "At VWAP", mtfScore: 54, zoneScore: 60 },
    { symbol: "GBPUSD", category: "Forex", regime: "Trending Bearish", trend: "bearish", volatility: "Normal ATR", liquidity: "Daily High Swept", volume: "Normal", vwap: "Below VWAP", mtfScore: 78, zoneScore: 82 },
    { symbol: "NAS100", category: "Indices", regime: "Trending Bullish", trend: "bullish", volatility: "High ATR", liquidity: "OB Re-test", volume: "High (+55%)", vwap: "Above VWAP", mtfScore: 95, zoneScore: 94 },
    { symbol: "US30", category: "Indices", regime: "Consolidation", trend: "neutral", volatility: "Low ATR", liquidity: "Range Midpoint", volume: "Low (-12%)", vwap: "At VWAP", mtfScore: 48, zoneScore: 50 },
];

export default function MarketScannerSection() {
    const [selectedCategory, setSelectedCategory] = useState<string>("All");
    const categories = ["All", "Metals", "Crypto", "Forex", "Indices"];
    const filteredRows = selectedCategory === "All"
        ? SAMPLE_SCANNER_DATA
        : SAMPLE_SCANNER_DATA.filter((r) => r.category === selectedCategory);

    return (
        <section className="py-20 border-b border-border/40 bg-background relative overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Institutional Terminal</p>
                        <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                            Multi-Timeframe Market Scanner
                        </h2>
                        <p className="mt-3 text-base text-muted-foreground max-w-2xl">
                            Real-time structural matrix measuring regime, volatility state, liquidity pools, VWAP positioning, and institutional zone scores.
                        </p>
                    </div>
                    <Link
                        href="/scanner"
                        className="mt-4 md:mt-0 inline-flex items-center gap-1.5 text-xs font-bold text-violet-400 hover:text-violet-300 transition"
                    >
                        Full Scanner Console <ArrowRight size={14} />
                    </Link>
                </div>

                {/* Filter Tabs */}
                <div className="mt-8 flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                    {categories.map((cat) => (
                        <button
                            key={cat}
                            type="button"
                            onClick={() => setSelectedCategory(cat)}
                            className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                                selectedCategory === cat
                                    ? "bg-violet-600 text-white shadow-md"
                                    : "bg-card/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40"
                            }`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>

                {/* Scanner Data Table Terminal */}
                <div className="mt-6 overflow-x-auto rounded-2xl border border-border/80 bg-card/80 shadow-2xl backdrop-blur-xl">
                    <table className="w-full text-left font-mono text-xs">
                        <thead>
                            <tr className="border-b border-border bg-surface-muted text-text-muted uppercase tracking-wider text-xs">
                                <th className="p-4">Symbol</th>
                                <th className="p-4">Regime</th>
                                <th className="p-4">Volatility</th>
                                <th className="p-4">Liquidity</th>
                                <th className="p-4">Volume</th>
                                <th className="p-4">VWAP</th>
                                <th className="p-4">MTF Score</th>
                                <th className="p-4">Zone Score</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                            {filteredRows.map((row) => (
                                <tr key={row.symbol} className="hover:bg-muted/30 transition">
                                    <td className="p-4 font-bold text-foreground">
                                        <span className="rounded bg-muted/60 px-2 py-1 border border-border/40">{row.symbol}</span>
                                    </td>
                                    <td className="p-4">
                                        <span className={`inline-flex items-center gap-1 font-semibold ${
                                            row.trend === "bullish" ? "text-emerald-400" : row.trend === "bearish" ? "text-rose-400" : "text-muted-foreground"
                                        }`}>
                                            {row.regime}
                                        </span>
                                    </td>
                                    <td className="p-4 text-muted-foreground">{row.volatility}</td>
                                    <td className="p-4 text-sky-400">{row.liquidity}</td>
                                    <td className="p-4 text-muted-foreground">{row.volume}</td>
                                    <td className="p-4 text-violet-400">{row.vwap}</td>
                                    <td className="p-4 font-bold">
                                        <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-400 border border-emerald-500/20">
                                            {row.mtfScore} / 100
                                        </span>
                                    </td>
                                    <td className="p-4 font-bold">
                                        <span className="rounded bg-violet-500/10 px-2 py-1 text-violet-300 border border-violet-500/20">
                                            {row.zoneScore} / 100
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="mt-4 flex items-center justify-between text-xs font-mono text-muted-foreground">
                    <span className="flex items-center gap-1.5"><Database size={13} className="text-info" /> Provider OHLC engine · Twelve Data & Biquote</span>
                    <span>Live candle normalizer active</span>
                </div>

            </div>
        </section>
    );
}
