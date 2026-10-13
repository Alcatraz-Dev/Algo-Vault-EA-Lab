"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { StickyScroll } from "@/components/ui/sticky-scroll-reveal";
import { Badge } from "@/components/ui/badge";
import Reveal from "./Reveal";

/**
 * Immersive product showcase built on Aceternity `StickyScroll`
 * (page-scroll variant — the section's copy scrolls while each stage's
 * visual sticks beside it; normal page navigation is never hijacked).
 *
 * Four real stages, each sticky visual a static, honest panel with a
 * working link into the product. Illustrative figures are labeled.
 */

const VALIDATE_SAMPLE = Array.from({ length: 20 }, (_, i) => ({
    idx: i,
    v: 100 + i * 1.3 + Math.sin(i / 2.4) * 2.4,
}));

function PanelShell({ children, label }: { children: React.ReactNode; label: string }) {
    return (
        <div className="flex h-full flex-col bg-card p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
            <div className="mt-3 flex min-h-0 flex-1 flex-col justify-center">{children}</div>
        </div>
    );
}

const CONTENT = [
    {
        title: "Discover — scan the market like an analyst",
        description:
            "Eight deterministic engines read regime, structure, zones, liquidity, VWAP, sessions, volume, and a composite score from the same candles. Open any symbol straight into research.",
        content: (
            <PanelShell label="Scanner · live in app">
                <ul className="grid grid-cols-2 gap-1.5 text-[11px]">
                    {["Regime · Trend", "Structure · BOS", "Zones · OB", "Liquidity · Swept", "VWAP · Above", "Session · London"].map(
                        (row) => (
                            <li
                                key={row}
                                className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 font-medium text-foreground"
                            >
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-positive" aria-hidden />
                                {row}
                            </li>
                        ),
                    )}
                </ul>
                <Link href="/scanner" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    Open the scanner <ArrowRight size={12} aria-hidden />
                </Link>
            </PanelShell>
        ),
    },
    {
        title: "Validate — prove it before you risk it",
        description:
            "Run deterministic backtests with real costs, stress parameters with walk-forward and Monte Carlo, and replay history bar by bar with no look-ahead bias.",
        content: (
            <PanelShell label="Backtest studio · sample curve">
                <div className="h-24" role="img" aria-label="Illustrative sample backtest curve">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={VALIDATE_SAMPLE} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="stickyValidate" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <Area
                                type="monotone"
                                dataKey="v"
                                stroke="var(--primary)"
                                strokeWidth={2}
                                fill="url(#stickyValidate)"
                                dot={false}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
                <p className="mt-2 font-numeric text-sm font-semibold text-foreground">
                    +24.6% <span className="font-sans text-[11px] font-normal text-muted-foreground">sample · costs modeled</span>
                </p>
                <Link href="/backtests" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    Open Backtest Studio <ArrowRight size={12} aria-hidden />
                </Link>
            </PanelShell>
        ),
    },
    {
        title: "Execute — send orders through a risk gate",
        description:
            "Approved intents travel to MetaTrader through a custom MQL5 Expert Advisor. Anything that fails limits is rejected with a decision code — surfaced, never hidden.",
        content: (
            <PanelShell label="Execution gateway · risk-gated">
                <div className="flex flex-wrap gap-1.5">
                    {["NEW", "ENTRY_TRIGGERED", "TP_REACHED"].map((s) => (
                        <Badge key={s} variant="success" className="font-numeric text-[11px]">
                            {s}
                        </Badge>
                    ))}
                </div>
                <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
                    <ShieldCheck size={13} className="mt-0.5 shrink-0 text-positive" aria-hidden />
                    Zero orders bypass the validator.
                </p>
                <Link href="/account/trading-access" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    Set up trading access <ArrowRight size={12} aria-hidden />
                </Link>
            </PanelShell>
        ),
    },
    {
        title: "Monitor — watch the loop stay honest",
        description:
            "Track equity, drawdown, signal lifecycle, and gateway heartbeats from the live console. Stale feeds are labeled stale — never presented as live.",
        content: (
            <PanelShell label="Live console · telemetry">
                <ul className="space-y-1.5 text-xs">
                    {[
                        ["Gateway heartbeat", "LIVE", "text-positive"],
                        ["Data feed", "LIVE", "text-positive"],
                        ["Drawdown guard", "Armed", "text-warning"],
                    ].map(([k, v, tone]) => (
                        <li key={k} className="flex items-center justify-between rounded-md border border-border bg-background px-2.5 py-1.5">
                            <span className="text-muted-foreground">{k}</span>
                            <span className={`font-numeric font-semibold ${tone}`}>{v}</span>
                        </li>
                    ))}
                </ul>
                <Link href="/live" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    Open live console <ArrowRight size={12} aria-hidden />
                </Link>
            </PanelShell>
        ),
    },
];

export default function StickyShowcase() {
    return (
        <section className="border-b border-border bg-background">
            <div className="page-container pt-14 md:pt-20">
                <Reveal>
                    <div className="mx-auto max-w-2xl text-center">
                        <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                            Product tour
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                        </p>
                        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                            From first scan to filled order.
                        </h2>
                        <p className="mt-4 text-sm leading-6 text-pretty text-muted-foreground sm:text-[0.9375rem]">
                            Scroll — each stage pins its console beside the story.
                        </p>
                    </div>
                </Reveal>
            </div>
            <div className="page-container pb-14 md:pb-20">
                <StickyScroll content={CONTENT} />
            </div>
        </section>
    );
}
