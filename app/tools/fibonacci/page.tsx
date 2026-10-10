"use client";

import { useState, useMemo } from "react";
import { ArrowLeft, TrendingUp, Copy, Check, Crown, Sparkles, ArrowUpRight } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { cn } from "@/lib/utils";
import Link from "next/link";

const RETRACEMENT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];

/**
 * Fibonacci Calculator — Lite.
 *
 * Free: manual high / low input + standard retracement (0 → 1.0) with the
 *       three "key" levels (0.382, 0.5, 0.618) highlighted.
 * Pro: auto swing high / low from a live chart, save templates, extension
 *      targets (1.272 → 4.236), export with metadata.
 */

export default function FibonacciCalculator() {
    const [high, setHigh] = useState("");
    const [low, setLow] = useState("");
    const [copied, setCopied] = useState<number | null>(null);

    const levels = useMemo(() => {
        const h = Number(high) || 0;
        const l = Number(low) || 0;
        if (!h || !l || h === l) return null;

        const isUptrend = h > l;
        const range = Math.abs(h - l);

        return RETRACEMENT_LEVELS.map((fib) => {
            const price = isUptrend ? h - range * fib : l + range * fib;
            return {
                level: fib,
                price: Number(price.toFixed(5)),
                percent: (fib * 100).toFixed(1),
            };
        });
    }, [high, low]);

    const copyLevel = (price: number, idx: number) => {
        navigator.clipboard.writeText(String(price));
        setCopied(idx);
        setTimeout(() => setCopied(null), 1500);
    };

    const inputClass =
        "w-full rounded-md border border-border/40 bg-muted/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none transition";

    return (
        <ToolPageShell
            title="Fibonacci Calculator"
            description="Standard retracement levels from any swing high and low. Pro adds auto swing detection, extension targets and saved templates."
            badge="lite"
            icon={TrendingUp}
            backHref="/tools"
            proHeadline="Pro pulls the swing high / low directly from a live chart and unlocks extension targets."
            proFeatures={[
                "Auto swing high / low from a live chart",
                "Extension targets (1.272 → 4.236)",
                "Save templates for repeated setups",
                "Export levels with metadata to clipboard",
            ]}
        >
            <div className="rounded-lg border border-border bg-card p-5">
                <h2 className="mb-4 text-sm font-semibold text-foreground">Swing Points</h2>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Swing High</label>
                        <input type="number" step="any" value={high} onChange={(e) => setHigh(e.target.value)} placeholder="e.g. 1.12000" className={inputClass} />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-micro font-semibold uppercase tracking-wider text-muted-foreground">Swing Low</label>
                        <input type="number" step="any" value={low} onChange={(e) => setLow(e.target.value)} placeholder="e.g. 1.10000" className={inputClass} />
                    </div>
                </div>
                <p className="mt-3 text-micro text-muted-foreground">
                    Direction is auto-detected: if high &gt; low the trend is up; otherwise down.
                </p>
            </div>

            {levels ? (
                <div className="space-y-2">
                    {levels.map((level, idx) => {
                        const isKey = [0.382, 0.5, 0.618].includes(level.level);
                        return (
                            <div
                                key={idx}
                                onClick={() => copyLevel(level.price, idx)}
                                className={cn(
                                    "flex items-center justify-between rounded-md border px-5 py-3.5 cursor-pointer transition-all group",
                                    isKey
                                        ? "border-primary/15 bg-primary/[0.04] hover:bg-primary/[0.08]"
                                        : "border-border bg-card hover:bg-muted/60",
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <span
                                        className={cn(
                                            "w-16 text-center font-numeric text-xs font-bold rounded-lg px-2 py-1",
                                            isKey ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                                        )}
                                    >
                                        {level.percent}%
                                    </span>
                                    {level.level === 0.5 && <span className="text-micro font-semibold uppercase text-primary/70">EQ</span>}
                                    {level.level === 0.618 && <span className="text-micro font-semibold uppercase text-primary/70">GOLDEN</span>}
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="font-numeric text-sm font-bold text-foreground">{level.price}</span>
                                    {copied === idx ? (
                                        <Check size={13} className="text-positive" />
                                    ) : (
                                        <Copy size={13} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="rounded-lg border border-dashed border-border p-12 text-center">
                    <TrendingUp size={28} className="mx-auto text-muted-foreground" />
                    <p className="mt-3 text-sm text-muted-foreground">Enter swing high and low to calculate retracement levels.</p>
                </div>
            )}

            {/* Pro upsell row */}
            <div className="grid gap-3 md:grid-cols-3">
                <ProTile
                    title="Auto Swing Detect"
                    description="Pull the swing high / low directly from any chart on the platform."
                />
                <ProTile
                    title="Extension Targets"
                    description="1.272, 1.618, 2.0, 2.618, 3.618, 4.236 — all visible at once."
                />
                <ProTile
                    title="Save Templates"
                    description="Save the high+low pair as a reusable template for repeat setups."
                />
            </div>
        </ToolPageShell>
    );
}

function ProTile({ title, description }: { title: string; description: string }) {
    return (
        <Link
            href="/pricing"
            className="group flex flex-col gap-2 rounded-lg border border-dashed border-primary/25 bg-primary/[0.03] p-4 transition hover:border-primary/40 hover:bg-primary/[0.05]"
        >
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wider text-primary">
                    <Crown className="size-2.5" />
                    Pro
                </span>
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
            <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary transition group-hover:gap-1.5">
                <Sparkles className="size-3" />
                Unlock
                <ArrowUpRight className="size-3" />
            </span>
        </Link>
    );
}