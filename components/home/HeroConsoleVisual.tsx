"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, YAxis } from "recharts";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

const TOTAL = 28;

/** Deterministic illustrative route — labeled as a sample in the UI, never presented as market data. */
const SERIES = Array.from({ length: TOTAL }, (_, i) => {
    const base = i * 0.9;
    const wave = Math.sin(i / 3.2) * 1.7 + Math.cos(i / 1.8) * 0.7;
    const breakout = i > 19 ? (i - 19) * 0.6 : 0;
    return { idx: i, equity: Math.round((100 + base + wave + breakout) * 100) / 100 };
});

const LIFECYCLE = ["NEW", "PENDING_ENTRY", "ENTRY_TRIGGERED", "TP_REACHED", "CLOSED"] as const;
const TERMINAL = ["STOPPED_OUT", "EXPIRED", "CANCELLED", "INVALIDATED"] as const;

const RISK_CHECKS = [
    { label: "Daily loss limit", detail: "2% of balance" },
    { label: "Drawdown guard", detail: "Armed" },
    { label: "Position sizing", detail: "1% risk" },
    { label: "Gateway heartbeat", detail: "Checked pre-trade" },
] as const;

export default function HeroConsoleVisual() {
    const data = useMemo(() => SERIES, []);
    const last = data[data.length - 1]?.equity ?? 100;
    const first = data[0]?.equity ?? 100;
    const delta = ((last - first) / first) * 100;

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

            <TabsContent value="overview" className="px-4 py-4">
                <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">Workspace equity</span>
                    <span className="flex items-center gap-2">
                        <span className="font-numeric font-semibold text-foreground">
                            ${last.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="font-numeric font-semibold text-positive">
                            +{delta.toFixed(1)}%
                        </span>
                    </span>
                </div>
                <div className="mt-2 h-32" role="img" aria-label="Illustrative sample equity curve, not live account data">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="heroConsoleEquity" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--positive)" stopOpacity={0.3} />
                                    <stop offset="100%" stopColor="var(--positive)" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid
                                stroke="var(--border-color)"
                                strokeDasharray="3 3"
                                strokeOpacity={0.35}
                                vertical={false}
                            />
                            <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
                            <Area
                                type="monotone"
                                dataKey="equity"
                                stroke="var(--positive)"
                                strokeWidth={1.75}
                                fill="url(#heroConsoleEquity)"
                                dot={false}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
                    {[
                        { label: "Engines", value: "8" },
                        { label: "Timeframes", value: "M1–D1" },
                        { label: "Costs modeled", value: "Spread+Slip" },
                    ].map((cell) => (
                        <div key={cell.label} className="bg-card px-3 py-2.5 text-center">
                            <p className="font-numeric text-sm font-semibold text-foreground">{cell.value}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{cell.label}</p>
                        </div>
                    ))}
                </div>
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                    Illustrative sample curve — shows the layout, not account performance.
                </p>
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
