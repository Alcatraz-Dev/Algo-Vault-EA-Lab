"use client";

import { useState, useMemo } from "react";
import { ArrowLeft, TrendingUp, TrendingDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618, 2.0, 2.618, 3.618, 4.236];

export default function FibonacciCalculator() {
    const [high, setHigh] = useState("");
    const [low, setLow] = useState("");
    const [direction, setDirection] = useState<"retracement" | "extension">("retracement");
    const [copied, setCopied] = useState<number | null>(null);

    const levels = useMemo(() => {
        const h = Number(high) || 0;
        const l = Number(low) || 0;
        if (!h || !l || h === l) return null;

        const isUptrend = h > l;
        const range = Math.abs(h - l);

        return FIB_LEVELS.map((fib) => {
            let price: number;
            if (direction === "retracement") {
                price = isUptrend ? h - range * fib : l + range * fib;
            } else {
                price = isUptrend ? l + range * fib : h - range * fib;
            }
            return {
                level: fib,
                price: Number(price.toFixed(5)),
                percent: (fib * 100).toFixed(1),
            };
        });
    }, [high, low, direction]);

    const copyLevel = (price: number, idx: number) => {
        navigator.clipboard.writeText(String(price));
        setCopied(idx);
        setTimeout(() => setCopied(null), 1500);
    };

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6" data-guide="page-header">
                    <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Fibonacci Calculator</h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">Calculate retracement and extension levels</p>
                </div>

                {/* Inputs */}
                <div className="mb-6 rounded-2xl border border-border/30 bg-muted/50 p-5">
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Swing High</label>
                            <input type="number" step="any" value={high} onChange={(e) => setHigh(e.target.value)} placeholder="e.g. 1.12000" className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none transition" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Swing Low</label>
                            <input type="number" step="any" value={low} onChange={(e) => setLow(e.target.value)} placeholder="e.g. 1.10000" className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none transition" />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setDirection("retracement")} className={cn("flex-1 rounded-xl border px-4 py-2.5 text-xs font-medium transition", direction === "retracement" ? "border-violet-500/40 bg-violet-500/10 text-violet-400" : "border-border/30 bg-muted/50 text-muted-foreground")}>
                            Retracement
                        </button>
                        <button type="button" onClick={() => setDirection("extension")} className={cn("flex-1 rounded-xl border px-4 py-2.5 text-xs font-medium transition", direction === "extension" ? "border-violet-500/40 bg-violet-500/10 text-violet-400" : "border-border/30 bg-muted/50 text-muted-foreground")}>
                            Extension
                        </button>
                    </div>
                </div>

                {/* Results */}
                {levels ? (
                    <div className="space-y-2">
                        {levels.map((level, idx) => {
                            const isKey = [0.382, 0.5, 0.618].includes(level.level);
                            const isExtension = level.level > 1;
                            const isTarget = level.level === 1.618 || level.level === 2.618;

                            return (
                                <div
                                    key={idx}
                                    onClick={() => copyLevel(level.price, idx)}
                                    className={cn(
                                        "flex items-center justify-between rounded-xl border px-5 py-3.5 cursor-pointer transition-all group",
                                        isTarget ? "border-amber-500/15 bg-amber-500/[0.04] hover:bg-amber-500/[0.08]" :
                                        isKey ? "border-violet-500/15 bg-violet-500/[0.04] hover:bg-violet-500/[0.08]" :
                                        "border-border/30 bg-muted/50 hover:bg-muted"
                                    )}
                                >
                                    <div className="flex items-center gap-3">
                                        <span className={cn(
                                            "w-16 text-center font-mono text-xs font-bold rounded-lg px-2 py-1",
                                            isTarget ? "bg-amber-500/10 text-amber-400" :
                                            isKey ? "bg-violet-500/10 text-violet-400" :
                                            "bg-muted text-muted-foreground"
                                        )}>
                                            {level.percent}%
                                        </span>
                                        {level.level === 0.5 && <span className="text-[9px] font-semibold uppercase text-violet-400/60">EQ</span>}
                                        {level.level === 0.618 && <span className="text-[9px] font-semibold uppercase text-violet-400/60">GOLDEN</span>}
                                        {level.level === 1.618 && <span className="text-[9px] font-semibold uppercase text-amber-400/60">TARGET</span>}
                                        {level.level === 2.618 && <span className="text-[9px] font-semibold uppercase text-amber-400/60">EXT</span>}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="font-mono text-sm font-bold text-foreground">{level.price}</span>
                                        {copied === idx ? (
                                            <Check size={13} className="text-emerald-400" />
                                        ) : (
                                            <Copy size={13} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                        <TrendingUp size={32} className="mx-auto text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">Enter swing high and low to calculate Fibonacci levels</p>
                    </div>
                )}
            </div>
        </div>
    );
}
