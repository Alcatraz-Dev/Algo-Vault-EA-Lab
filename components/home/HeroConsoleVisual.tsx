"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import HomeCandleChart, { buildSampleCandles } from "./HomeCandleChart";

const LIFECYCLE = ["NEW", "PENDING_ENTRY", "ENTRY_TRIGGERED", "TP_REACHED", "CLOSED"] as const;
const TERMINAL = ["STOPPED_OUT", "EXPIRED", "CANCELLED", "INVALIDATED"] as const;

const RISK_CHECKS = [
    { label: "Daily loss limit", detail: "2% of balance" },
    { label: "Drawdown guard", detail: "Armed" },
    { label: "Position sizing", detail: "1% risk" },
    { label: "Gateway heartbeat", detail: "Checked pre-trade" },
] as const;

const TIMEFRAMES = [
    { id: "M15", stepSeconds: 900, seed: 7, count: 64 },
    { id: "H1", stepSeconds: 3600, seed: 11, count: 72 },
    { id: "H4", stepSeconds: 14400, seed: 23, count: 60 },
] as const;

type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

function OverviewTab() {
    // Functional timeframe switch: each range loads its own deterministic
    // sample series (seed + step), so the control genuinely changes the chart.
    const [tf, setTf] = useState<TimeframeId>("M15");
    const spec = TIMEFRAMES.find((t) => t.id === tf) ?? TIMEFRAMES[0];
    const candles = useMemo(
        () => buildSampleCandles(spec.seed, 2650, spec.count, spec.stepSeconds),
        [spec],
    );
    const first = candles[0]?.close ?? 2650;
    const last = candles[candles.length - 1]?.close ?? 2650;
    const change = ((last - first) / first) * 100;
    const up = change >= 0;

    return (
        <div className="px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-2">
                    <span className="text-sm font-bold tracking-tight text-foreground">XAUUSD</span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">Gold / USD · sample</span>
                    <span className="font-numeric text-sm font-semibold text-foreground">
                        {last.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className={`font-numeric text-xs font-semibold ${up ? "text-positive" : "text-negative"}`}>
                        {up ? "▲" : "▼"} {up ? "+" : ""}
                        {change.toFixed(2)}%
                    </span>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-0.5" role="group" aria-label="Sample timeframe">
                    {TIMEFRAMES.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setTf(t.id)}
                            aria-pressed={tf === t.id}
                            className={cn(
                                "rounded-md px-2.5 py-1 font-numeric text-[11px] font-semibold transition-colors",
                                tf === t.id
                                    ? "bg-primary text-primary-foreground shadow-xs"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {t.id}
                        </button>
                    ))}
                </div>
            </div>
            <div className="mt-2 overflow-hidden rounded-lg border border-border bg-card">
                <HomeCandleChart
                    seed={spec.seed}
                    basePrice={2650}
                    precision={2}
                    count={spec.count}
                    stepSeconds={spec.stepSeconds}
                    height={236}
                    label={`XAUUSD ${tf} illustrative sample`}
                />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
                {[
                    { label: "Engines", value: "8" },
                    { label: "Session", value: "London" },
                    { label: "Spread model", value: "Real" },
                ].map((cell) => (
                    <div key={cell.label} className="bg-card px-3 py-2.5 text-center">
                        <p className="font-numeric text-sm font-semibold text-foreground">{cell.value}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{cell.label}</p>
                    </div>
                ))}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                Sample price action — shows the terminal layout, not live market data.
            </p>
        </div>
    );
}

export default function HeroConsoleVisual() {
    return (
        <Tabs defaultValue="overview" className="gap-0">
            <div className="border-b border-border px-3 pt-3">
                <TabsList className="h-8 w-full rounded-lg">
                    <TabsTrigger value="overview" className="text-xs">
                        Overview
                    </TabsTrigger>
                    <TabsTrigger value="lifecycle" className="text-xs">
                        Signals
                    </TabsTrigger>
                    <TabsTrigger value="risk" className="text-xs">
                        Risk
                    </TabsTrigger>
                </TabsList>
            </div>

            <TabsContent value="overview">
                <OverviewTab />
            </TabsContent>

            <TabsContent value="lifecycle" className="px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-positive">Active path</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {LIFECYCLE.map((state) => (
                        <Badge key={state} variant="success" className="font-numeric text-[11px]">
                            {state}
                        </Badge>
                    ))}
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-warning">Terminal states</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {TERMINAL.map((state) => (
                        <Badge key={state} variant="warning" className="font-numeric text-[11px]">
                            {state}
                        </Badge>
                    ))}
                </div>
                <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                    <ShieldCheck size={14} className="mt-0.5 shrink-0 text-positive" aria-hidden />
                    Outcomes are decided deterministically — TP/SL hits, never AI narrative.
                </p>
                <Link
                    href="/signals"
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                    How signals work <ArrowRight size={13} aria-hidden />
                </Link>
            </TabsContent>

            <TabsContent value="risk" className="px-4 py-4">
                <ul className="divide-y divide-border rounded-lg border border-border">
                    {RISK_CHECKS.map(({ label, detail }) => (
                        <li key={label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                            <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                                <ShieldCheck size={14} className="shrink-0 text-positive" aria-hidden />
                                {label}
                            </span>
                            <span className="font-numeric text-xs text-muted-foreground">{detail}</span>
                        </li>
                    ))}
                </ul>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Rejected intents carry a decision code — surfaced in the console, never silently dropped.
                </p>
                <Link
                    href="/risk"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                    Open risk controls <ArrowRight size={13} aria-hidden />
                </Link>
            </TabsContent>
        </Tabs>
    );
}
