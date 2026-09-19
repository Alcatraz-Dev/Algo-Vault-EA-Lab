"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Play, Pause, SkipBack, SkipForward, RotateCcw, Scissors, TrendingUp, TrendingDown, RefreshCw, BarChart2, ShieldCheck, Zap } from "lucide-react";

export default function ReplaySection() {
    const [cursor, setCursor] = useState(120);
    const [isPlaying, setIsPlaying] = useState(true);
    const [speed, setSpeed] = useState(1);
    const [isCutoffMode, setIsCutoffMode] = useState(false);
    
    // Interactive Paper Trade state inside Homepage Demo
    const [position, setPosition] = useState<{ type: "LONG" | "SHORT"; entry: number; tp: number; sl: number } | null>(null);
    const [pnl, setPnl] = useState(420.50);
    const [tradesCount, setTradesCount] = useState(8);
    const [winsCount, setWinsCount] = useState(6);

    const totalBars = 240;

    // Simulated historical candle data generation for the SVG chart
    const candleData = Array.from({ length: totalBars }).map((_, i) => {
        const base = 2620 + Math.sin(i * 0.1) * 35 + Math.cos(i * 0.05) * 20 + (i * 0.15);
        const open = base;
        const close = base + (Math.sin(i * 1.5) * 6);
        const high = Math.max(open, close) + Math.abs(Math.cos(i) * 4);
        const low = Math.min(open, close) - Math.abs(Math.sin(i) * 4);
        return { open, close, high, low, isUp: close >= open };
    });

    const visibleCandles = candleData.slice(0, cursor);
    const currentCandle = visibleCandles[visibleCandles.length - 1] || candleData[0];
    const currentPrice = currentCandle.close;

    useEffect(() => {
        if (!isPlaying) return;
        const timer = setInterval(() => {
            setCursor((prev) => {
                if (prev >= totalBars) {
                    setIsPlaying(false);
                    return prev;
                }
                return prev + 1;
            });
        }, 800 / speed);
        return () => clearInterval(timer);
    }, [isPlaying, speed]);

    // Handle paper position updates
    const handleBuy = () => {
        if (position) return;
        setPosition({
            type: "LONG",
            entry: currentPrice,
            tp: currentPrice + 12.0,
            sl: currentPrice - 6.0,
        });
    };

    const handleSell = () => {
        if (position) return;
        setPosition({
            type: "SHORT",
            entry: currentPrice,
            tp: currentPrice - 12.0,
            sl: currentPrice + 6.0,
        });
    };

    const handleClose = () => {
        if (!position) return;
        const tradePnl = position.type === "LONG" ? (currentPrice - position.entry) * 10 : (position.entry - currentPrice) * 10;
        setPnl((prev) => prev + tradePnl);
        setTradesCount((prev) => prev + 1);
        if (tradePnl > 0) setWinsCount((prev) => prev + 1);
        setPosition(null);
    };

    return (
        <section className="py-24 border-b border-border/40 bg-background relative overflow-hidden">
            {/* Ambient Background Gradient Lighting */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-violet-600/10 blur-[130px] rounded-full pointer-events-none" />

            <div className="mx-auto max-w-7xl px-6 md:px-8 relative z-10">
                
                {/* Section Header */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 border border-violet-500/20 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-violet-400 mb-3">
                            <Scissors size={13} className="text-violet-400" /> TradingView-Grade Market Replay
                        </div>
                        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                            Bar-by-Bar Replay & Execution Simulator
                        </h2>
                        <p className="mt-3 text-base text-muted-foreground max-w-2xl">
                            Step through past market price action bar by bar. Practice manual entry triggers, analyze market structure without lookahead bias, and test paper trades in real time.
                        </p>
                    </div>
                    <Link
                        href="/trade-replay"
                        className="mt-6 md:mt-0 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-violet-500 transition shadow-lg shadow-violet-600/20"
                    >
                        Launch Replay Studio <ArrowRight size={14} />
                    </Link>
                </div>

                {/* Main TradingView Replay Console Window */}
                <div className="mt-10 rounded-3xl border border-border/80 bg-card/90 p-5 sm:p-7 shadow-2xl backdrop-blur-2xl space-y-6">
                    
                    {/* Floating Top Control Toolbar (TradingView Replay Toolbar) */}
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-border/40 pb-5">
                        
                        {/* Symbol & Cutoff Badge */}
                        <div className="flex items-center gap-3 font-mono text-xs">
                            <span className="rounded-lg bg-violet-500/15 border border-violet-500/30 px-3 py-1.5 font-bold text-violet-300 flex items-center gap-1.5">
                                <Zap size={14} /> XAUUSD · 1H
                            </span>
                            <span className="text-muted-foreground hidden sm:inline">|</span>
                            <span className="text-foreground font-semibold flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Replay Cut-off Active
                            </span>
                        </div>

                        {/* Center Controls: Play, Step, Jump Cut */}
                        <div className="flex flex-wrap items-center gap-2 self-center lg:self-auto">
                            <button
                                type="button"
                                onClick={() => { setIsCutoffMode(!isCutoffMode); setIsPlaying(false); }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                                    isCutoffMode
                                        ? "bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse"
                                        : "bg-muted/50 text-muted-foreground border-border hover:text-foreground"
                                }`}
                                title="Jump to bar (Cut point)"
                            >
                                <Scissors size={14} /> {isCutoffMode ? "Click Bar to Cut" : "Jump To..."}
                            </button>

                            <button
                                type="button"
                                onClick={() => { setCursor((p) => Math.max(1, p - 1)); setIsPlaying(false); }}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted text-foreground transition"
                                title="Step Back"
                            >
                                <SkipBack size={14} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsPlaying((p) => !p)}
                                className="flex h-8.5 w-10 items-center justify-center rounded-lg bg-violet-600 text-white font-bold hover:bg-violet-500 transition shadow-md"
                                title={isPlaying ? "Pause" : "Play"}
                            >
                                {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setCursor((p) => Math.min(totalBars, p + 1)); setIsPlaying(false); }}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted text-foreground transition"
                                title="Step Forward"
                            >
                                <SkipForward size={14} />
                            </button>
                            <button
                                type="button"
                                onClick={() => { setCursor(10); setIsPlaying(false); setPosition(null); }}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted text-muted-foreground transition"
                                title="Reset"
                            >
                                <RotateCcw size={14} />
                            </button>

                            <select
                                value={speed}
                                onChange={(e) => setSpeed(Number(e.target.value))}
                                className="ml-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-mono outline-none focus:border-violet-500"
                            >
                                {[1, 2, 5, 10].map((s) => (
                                    <option key={s} value={s}>{s}x Speed</option>
                                ))}
                            </select>
                        </div>

                        {/* Paper Execution Simulator Action Buttons */}
                        <div className="flex items-center gap-2">
                            {position ? (
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 px-3 py-1.5 text-xs font-bold hover:bg-amber-500/30 transition"
                                >
                                    <RefreshCw size={13} /> Close Position
                                </button>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={handleBuy}
                                        className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-emerald-500 transition shadow-sm"
                                    >
                                        <TrendingUp size={13} /> Buy Long
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSell}
                                        className="flex items-center gap-1 rounded-lg bg-rose-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-rose-500 transition shadow-sm"
                                    >
                                        <TrendingDown size={13} /> Sell Short
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Timeline Scrubber Bar */}
                    <div className="space-y-1.5 font-mono text-xs">
                        <div className="flex items-center justify-between text-muted-foreground">
                            <span>Bar Sequence ({cursor} / {totalBars})</span>
                            <span className="text-foreground font-bold">XAUUSD @ ${currentPrice.toFixed(2)}</span>
                        </div>
                        <input
                            type="range"
                            min={1}
                            max={totalBars}
                            value={cursor}
                            onChange={(e) => { setCursor(Number(e.target.value)); setIsPlaying(false); }}
                            className="w-full accent-violet-500 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer"
                        />
                    </div>

                    {/* Interactive SVG TradingView Chart Simulator Container */}
                    <div className="relative h-64 rounded-2xl border border-border/60 bg-background/95 p-4 overflow-hidden flex flex-col justify-between">
                        
                        {/* Replay Watermark & Cutoff Indicator Line */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5 font-mono text-6xl font-black text-foreground uppercase tracking-widest">
                            TradingView Replay
                        </div>

                        {/* Top Info Bar */}
                        <div className="flex items-center justify-between text-xs font-mono text-muted-foreground z-10">
                            <div className="flex items-center gap-4">
                                <span className="text-foreground font-semibold">EMA(20): ${(currentPrice * 0.998).toFixed(2)}</span>
                                <span>RSI(14): 58.4</span>
                            </div>
                            <span className="text-violet-400 font-bold">
                                {isPlaying ? "REPLAY PLAYING" : "PAUSED (NO LOOKAHEAD)"}
                            </span>
                        </div>

                        {/* SVG Candlestick Render */}
                        <div className="relative my-auto h-40 w-full flex items-end justify-between px-2">
                            {visibleCandles.slice(-60).map((candle, idx) => {
                                const heightPct = Math.max(10, Math.min(90, ((candle.close - 2600) / 70) * 100));
                                return (
                                    <div key={idx} className="flex flex-col items-center justify-end h-full w-1.5 group relative">
                                        <div
                                            className={`w-0.5 ${candle.isUp ? "bg-emerald-500" : "bg-rose-500"}`}
                                            style={{ height: `${Math.min(100, heightPct + 15)}%` }}
                                        />
                                        <div
                                            className={`w-1.5 rounded-sm ${candle.isUp ? "bg-emerald-500" : "bg-rose-500"}`}
                                            style={{ height: `${Math.max(15, Math.abs(candle.close - candle.open) * 5)}px` }}
                                        />
                                    </div>
                                );
                            })}
                            
                            {/* Vertical Cutoff Indicator Line */}
                            <div className="absolute right-4 top-0 bottom-0 border-r-2 border-dashed border-rose-500/80 flex flex-col justify-between items-end pr-1 text-[10px] font-mono text-rose-400 font-bold">
                                <span>REPLAY CUTOFF</span>
                                <span>FUTURE HIDDEN</span>
                            </div>
                        </div>

                        {/* Bottom Scorecard Strip */}
                        <div className="flex items-center justify-between border-t border-border/40 pt-2 text-xs font-mono z-10">
                            <div className="flex items-center gap-4">
                                <span className="text-muted-foreground">Session PnL: <strong className="text-emerald-400">+${pnl.toFixed(2)}</strong></span>
                                <span className="text-muted-foreground">Win Rate: <strong className="text-violet-400">{((winsCount / tradesCount) * 100).toFixed(0)}% ({winsCount}/{tradesCount})</strong></span>
                            </div>
                            {position && (
                                <span className={`font-bold ${position.type === "LONG" ? "text-emerald-400" : "text-rose-400"}`}>
                                    Active: {position.type} @ ${position.entry.toFixed(2)}
                                </span>
                            )}
                        </div>
                    </div>

                </div>

            </div>
        </section>
    );
}
