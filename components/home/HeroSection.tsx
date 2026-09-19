"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    ArrowRight,
    Sparkles,
    TrendingUp,
    Activity,
    Star,
    Brain,
    Sliders,
} from "lucide-react";

export type HeroStats = {
    strategies: number;
    liveAccounts: number;
    averageRating: number;
    reviewCount: number;
};

export default function HeroSection({
    siteName,
    stats,
}: {
    siteName: string;
    stats: HeroStats;
}) {
    const [activeTab, setActiveTab] = useState<"chart" | "structure" | "ai" | "ticket">("chart");

    // Live animated chart simulation state with proper unmount cleanup & prefers-reduced-motion check
    const [tick, setTick] = useState(0);
    const [candles, setCandles] = useState([
        { h: 35, type: "up", vwap: 30, vol: 40 },
        { h: 28, type: "down", vwap: 32, vol: 35 },
        { h: 45, type: "up", vwap: 38, vol: 55 },
        { h: 40, type: "up", vwap: 40, vol: 45 },
        { h: 60, type: "up", vwap: 48, vol: 70 },
        { h: 30, type: "down", vwap: 46, vol: 30 },
        { h: 75, type: "up", vwap: 56, vol: 85 },
        { h: 50, type: "down", vwap: 52, vol: 50 },
        { h: 85, type: "up", vwap: 68, vol: 90 },
        { h: 90, type: "up", vwap: 75, vol: 95 },
        { h: 70, type: "down", vwap: 72, vol: 60 },
        { h: 95, type: "up", vwap: 82, vol: 98 }
    ]);

    useEffect(() => {
        const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (prefersReducedMotion) return;

        const interval = setInterval(() => {
            setTick((prev) => (prev + 1) % 100);
            setCandles((prevCandles) => {
                const next = [...prevCandles];
                const lastIdx = next.length - 1;
                const delta = (Math.sin(Date.now() / 400) + 1) * 4.5;
                next[lastIdx] = {
                    ...next[lastIdx],
                    h: Math.min(98, Math.max(78, 86 + delta)),
                    vwap: 80 + delta * 0.5,
                    vol: Math.min(100, 88 + delta * 2),
                };
                return next;
            });
        }, 700);

        return () => clearInterval(interval);
    }, []);

    const currentPrice = (2654.40 + (Math.sin(tick / 5) * 0.35)).toFixed(2);

    return (
        <section className="relative overflow-hidden pt-10 pb-16 md:pt-16 md:pb-24 border-b border-border/40">
            {/* Background Radial Glow */}
            <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[650px] w-[1100px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-violet-600/20 via-sky-500/10 to-emerald-500/10 blur-3xl opacity-70" />
            
            {/* Grid Pattern Overlay */}
            <div className="pointer-events-none absolute inset-0 -z-10 bg-grid-pattern opacity-40" />

            <div className="mx-auto max-w-7xl px-6 md:px-8">
                <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:items-center">
                    
                    {/* Left Headline & Intro */}
                    <div className="lg:col-span-6 text-left">
                        {/* Status Badge */}
                        <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-xs font-semibold text-violet-300 backdrop-blur-md shadow-sm">
                            <Sparkles size={14} className="animate-spin text-violet-400" />
                            <span>LIVE TRADING INTELLIGENCE</span>
                        </div>

                        {/* Main Title */}
                        <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl text-foreground">
                            {siteName}
                            <br />
                            <span className="bg-gradient-to-r from-violet-400 via-sky-400 to-emerald-400 bg-clip-text text-transparent">
                                Build. Backtest. Optimize. Execute.
                            </span>
                        </h1>

                        {/* Subtitle */}
                        <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
                            One intelligent trading ecosystem. Deploy MT5 Expert Advisors, build visual Pine strategies, mirror master accounts, and analyze markets with real-time AI models.
                        </p>

                        {/* CTA Buttons */}
                        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                            <Link
                                href="/register"
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-7 py-3.5 text-sm font-semibold text-white shadow-xl shadow-violet-600/25 transition hover:opacity-95 active:scale-95"
                            >
                                Explore Platform
                                <ArrowRight size={16} />
                            </Link>
                            <Link
                                href="/strategy-lab"
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/60 px-7 py-3.5 text-sm font-semibold backdrop-blur-md transition hover:bg-muted active:scale-95"
                            >
                                Open Strategy Lab
                            </Link>
                        </div>

                        {/* Stats Bar */}
                        <div className="mt-10 grid grid-cols-3 gap-4 rounded-2xl border border-border/60 bg-card/40 p-4 backdrop-blur-md text-xs text-muted-foreground">
                            <div className="flex flex-col">
                                <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                                    <TrendingUp size={14} />
                                    <span>{stats.strategies}+ EAs</span>
                                </div>
                                <span className="mt-1 text-[11px] text-muted-foreground">Verified Strategies</span>
                            </div>
                            <div className="flex flex-col border-l border-border/40 pl-4">
                                <div className="flex items-center gap-1.5 text-sky-400 font-semibold">
                                    <Activity size={14} />
                                    <span>{stats.liveAccounts} MT5</span>
                                </div>
                                <span className="mt-1 text-[11px] text-muted-foreground">Gateway Connections</span>
                            </div>
                            <div className="flex flex-col border-l border-border/40 pl-4">
                                <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                                    <Star size={14} className="fill-amber-400" />
                                    <span>{stats.averageRating} / 5</span>
                                </div>
                                <span className="mt-1 text-[11px] text-muted-foreground">{stats.reviewCount} Reviews</span>
                            </div>
                        </div>
                    </div>

                    {/* Right Interactive SaaS Product Terminal Preview */}
                    <div className="lg:col-span-6">
                        <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/90 shadow-2xl backdrop-blur-xl">
                            
                            {/* Terminal Top Window Controls */}
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-4 py-3 text-xs">
                                <div className="flex items-center gap-2">
                                    <div className="h-3 w-3 rounded-full bg-rose-500/80" />
                                    <div className="h-3 w-3 rounded-full bg-amber-500/80" />
                                    <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
                                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">AlgoVault Terminal v2.4 · Product Preview</span>
                                </div>
                                <div className="flex items-center gap-1 rounded-lg bg-background/60 p-1 border border-border/40">
                                    {(["chart", "structure", "ai", "ticket"] as const).map((tab) => (
                                        <button
                                            key={tab}
                                            type="button"
                                            onClick={() => setActiveTab(tab)}
                                            className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition ${
                                                activeTab === tab
                                                    ? "bg-violet-600 text-white shadow-xs"
                                                    : "text-muted-foreground hover:text-foreground"
                                            }`}
                                        >
                                            {tab}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Terminal Active Screen Content */}
                            <div className="p-5 min-h-[360px]">
                                {activeTab === "chart" && (
                                    <div className="space-y-4 animate-in fade-in-0 duration-200">
                                        <div className="flex items-center justify-between rounded-xl bg-muted/30 p-3 border border-border/40 text-xs">
                                            <div className="flex items-center gap-3">
                                                <span className="rounded-lg bg-amber-500/20 px-2 py-1 font-mono font-bold text-amber-400">XAUUSD</span>
                                                <div>
                                                    <span className="font-bold text-foreground">Gold Spot / US Dollar</span>
                                                    <span className="ml-2 font-mono text-emerald-400">${currentPrice} (+1.42%)</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">PREVIEW DEMO</span>
                                                <span className="rounded bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-400 border border-violet-500/20">M15 TF</span>
                                            </div>
                                        </div>

                                        {/* Animated Visual Price Candles Canvas Representation */}
                                        <div className="relative h-48 rounded-xl border border-border/40 bg-background/80 p-3 overflow-hidden flex flex-col justify-between">
                                            
                                            {/* Liquidity Zone & VWAP Line Overlay */}
                                            <div className="absolute inset-x-0 top-1/3 h-8 bg-amber-500/10 border-y border-amber-500/20 pointer-events-none flex items-center justify-between px-3 text-[9px] font-mono text-amber-400/80">
                                                <span>SSL Liquidity Zone</span>
                                                <span>Swept @ 2,642.10</span>
                                            </div>

                                            {/* VWAP Line Path Overlay */}
                                            <svg className="absolute inset-0 h-full w-full pointer-events-none" preserveAspectRatio="none">
                                                <path
                                                    d="M 10 120 Q 120 100, 240 70 T 480 30"
                                                    fill="none"
                                                    stroke="rgba(56, 189, 248, 0.6)"
                                                    strokeWidth="2"
                                                    strokeDasharray="4 2"
                                                />
                                            </svg>

                                            <div className="flex items-center justify-between text-[11px] text-muted-foreground z-10">
                                                <span className="flex items-center gap-1 font-mono text-sky-400"><Sliders size={12} /> Institutional VWAP & Zones</span>
                                                <span className="font-mono text-emerald-400">BOS Confirmed ↑</span>
                                            </div>

                                            {/* Animated Candlestick Bars */}
                                            <div className="relative my-auto flex items-end justify-between gap-1 h-28 px-2 z-10">
                                                {candles.map((c, i) => (
                                                    <div key={i} className="relative flex flex-col items-center flex-1 h-full justify-end group">
                                                        {/* Signal Marker on Candle 8 */}
                                                        {i === 8 && (
                                                            <div className="absolute -top-5 rounded bg-emerald-500 px-1 py-0.5 text-[9px] font-bold text-black animate-bounce">
                                                                BUY
                                                            </div>
                                                        )}
                                                        <div
                                                            className={`w-full max-w-[12px] rounded-xs transition-all duration-300 ${
                                                                c.type === "up" ? "bg-emerald-500/85 shadow-sm shadow-emerald-500/30" : "bg-rose-500/85 shadow-sm shadow-rose-500/30"
                                                            }`}
                                                            style={{ height: `${c.h}%` }}
                                                        />
                                                        {/* Volume Bar underneath */}
                                                        <div
                                                            className="w-full max-w-[8px] mt-1 bg-muted/60 rounded-xs"
                                                            style={{ height: `${c.vol * 0.2}%` }}
                                                        />
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground pt-1 border-t border-border/30 z-10">
                                                <span>SSL Swept @ 2,642.10</span>
                                                <span>FVG Filled @ 2,648.50</span>
                                                <span className="text-emerald-400 font-bold">TP1 Target @ 2,662.00</span>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 text-xs">
                                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                                                <div className="text-[10px] font-medium text-emerald-400">LONG Setup Confirmed</div>
                                                <div className="font-mono font-bold text-foreground">Entry: 2,650.10 | SL: 2,642.00</div>
                                            </div>
                                            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-2.5">
                                                <div className="text-[10px] font-medium text-violet-400">Risk Allocation</div>
                                                <div className="font-mono font-bold text-foreground">1.0% ($100) | 1:2.4 R/R</div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === "structure" && (
                                    <div className="space-y-3 animate-in fade-in-0 duration-200 text-xs">
                                        <div className="flex items-center justify-between text-muted-foreground font-semibold">
                                            <span>Market Structure Matrix</span>
                                            <span className="text-emerald-400">Bullish Order Flow</span>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between rounded-lg bg-background/80 p-2.5 border border-border/40">
                                                <span>Macro Trend (H4)</span>
                                                <span className="font-mono text-emerald-400 font-bold">Trending Bullish (+84 Score)</span>
                                            </div>
                                            <div className="flex items-center justify-between rounded-lg bg-background/80 p-2.5 border border-border/40">
                                                <span>Liquidity Status</span>
                                                <span className="font-mono text-sky-400 font-bold">Sell-Side Liquidity Swept</span>
                                            </div>
                                            <div className="flex items-center justify-between rounded-lg bg-background/80 p-2.5 border border-border/40">
                                                <span>Fair Value Gap (FVG)</span>
                                                <span className="font-mono text-amber-400 font-bold">Active M15 Bullish FVG</span>
                                            </div>
                                            <div className="flex items-center justify-between rounded-lg bg-background/80 p-2.5 border border-border/40">
                                                <span>Order Block Zone</span>
                                                <span className="font-mono text-violet-400 font-bold">Institutional OB @ 2,648.00</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === "ai" && (
                                    <div className="space-y-3 animate-in fade-in-0 duration-200">
                                        <div className="flex items-center gap-2.5 rounded-xl bg-violet-500/10 p-3.5 border border-violet-500/20 text-xs">
                                            <Brain size={20} className="text-violet-400 shrink-0" />
                                            <div>
                                                <p className="font-bold text-foreground">AI Intelligence Model (Gemini 3.6)</p>
                                                <p className="text-muted-foreground mt-0.5">
                                                    "XAUUSD setup exhibits a 92% structural confluence. Liquidity sweep on London open followed by bullish CHOCH on M15."
                                                </p>
                                            </div>
                                        </div>
                                        <div className="rounded-xl border border-border/40 bg-background/80 p-3 text-xs space-y-2">
                                            <div className="flex justify-between font-mono"><span>AI Confidence Score</span><span className="text-emerald-400 font-bold">92 / 100</span></div>
                                            <div className="flex justify-between font-mono"><span>Recommended Action</span><span className="text-sky-400 font-bold">Execute via MT5 Gateway</span></div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === "ticket" && (
                                    <div className="space-y-3 animate-in fade-in-0 duration-200 text-xs">
                                        <div className="p-3 rounded-xl bg-background/80 border border-border/40 space-y-2 font-mono">
                                            <div className="flex justify-between"><span>Account ID</span><span className="text-foreground">MT5-Live-49201</span></div>
                                            <div className="flex justify-between"><span>Order Type</span><span className="text-emerald-400">BUY MARKET</span></div>
                                            <div className="flex justify-between"><span>Volume</span><span>0.50 Lots</span></div>
                                            <div className="flex justify-between"><span>Stop Loss</span><span className="text-rose-400">2,642.00</span></div>
                                            <div className="flex justify-between"><span>Take Profit 1</span><span className="text-emerald-400">2,662.00</span></div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button type="button" className="flex-1 rounded-lg bg-emerald-600 py-2.5 font-bold text-white transition hover:bg-emerald-500">
                                                Simulate Order
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </section>
    );
}
