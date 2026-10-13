"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Gauge, History, ScanSearch, Send } from "lucide-react";
import type { HomeData } from "@/lib/home-data";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardSpotlight } from "@/components/ui/card-spotlight";
import { cn } from "@/lib/utils";
import HomeCandleChart from "./HomeCandleChart";
import { EngineBars, ReturnsHistogram, RiskMini, SignalLifecycle, TelemetryMini } from "./home-visuals";
import Reveal from "./Reveal";

/**
 * Tabbed loop section ("Everything between your signal and your fill"):
 * four stages, one shared context. Panels pair concise copy with a live
 * product visual — engine bars, a sample candlestick chart beside real
 * backtest aggregates, the signal lifecycle, and telemetry.
 */
export default function LoopTabs({ data }: { data: HomeData }) {
    const { backtestAnalytics } = data;
    const [tab, setTab] = useState("discover");
    const tiles = [
        { label: "Recorded runs", value: String(backtestAnalytics.total) },
        {
            label: "Avg win rate",
            value: backtestAnalytics.analyzableCount > 0 ? `${backtestAnalytics.avgWinRate.toFixed(1)}%` : "—",
        },
        {
            label: "Avg max drawdown",
            value: backtestAnalytics.analyzableCount > 0 ? `${backtestAnalytics.avgMaxDrawdown.toFixed(1)}%` : "—",
        },
        {
            label: "Positive runs",
            value:
                backtestAnalytics.analyzableCount > 0
                    ? `${backtestAnalytics.positiveCount}/${backtestAnalytics.analyzableCount}`
                    : "—",
        },
    ];

    return (
        <section className="border-b border-border bg-background">
            <div className="page-container py-14 md:py-20">
                <Reveal>
                    <div className="mx-auto max-w-2xl text-center">
                        <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                            How it works
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                        </p>
                        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                            Everything between your signal and your fill
                        </h2>
                    </div>
                </Reveal>

                <Reveal delay={100}>
                    <div aria-hidden className="relative mt-10 overflow-hidden rounded-2xl border border-border bg-muted/40 sm:mt-14">
                        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border-color)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-color)_1px,transparent_1px)] bg-[size:44px_44px] opacity-60 [mask-image:radial-gradient(ellipse_65%_85%_at_50%_100%,black_25%,transparent_100%)]" />
                        <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-[36rem] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />
                        <div className="relative grid place-items-center gap-4 p-5 sm:p-8 lg:grid-cols-[1fr_auto_1fr] lg:gap-8">
                            <div className="hidden w-full max-w-64 justify-self-end lg:block">
                                <MiniStat
                                    label="workspace"
                                    value={String(backtestAnalytics.total)}
                                    unit="recorded runs"
                                    note="Every run stored with metrics"
                                />
                            </div>
                            <div className="w-full max-w-xs rounded-xl border border-border bg-card p-4 shadow-lg">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="truncate font-numeric text-xs text-muted-foreground">pipeline · sample</p>
                                    <Badge variant="success" className="h-6 shrink-0 gap-1.5 text-[11px]">
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive/60 motion-reduce:animate-none" />
                                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
                                        </span>
                                        Live
                                    </Badge>
                                </div>
                                <p className="mt-2 font-numeric text-3xl font-semibold tracking-tight text-foreground">
                                    3<span className="ml-1.5 text-sm font-normal text-muted-foreground">gates passed</span>
                                </p>
                                <ul className="mt-3 space-y-1.5">
                                    {[
                                        ["Scan the feed", "8 engines"],
                                        ["Validate the idea", "costs modeled"],
                                        ["Gate the order", "risk decides"],
                                    ].map(([step, meta]) => (
                                        <li key={step} className="flex items-center gap-2 text-xs">
                                            <span className="grid size-4 place-items-center rounded-full bg-positive text-background">
                                                <Check size={10} strokeWidth={3.5} aria-hidden />
                                            </span>
                                            <span className="font-medium text-foreground">{step}</span>
                                            <span className="ml-auto font-numeric text-muted-foreground">{meta}</span>
                                        </li>
                                    ))}
                                </ul>
                                <p className="mt-3 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
                                    From scan to fill
                                </p>
                            </div>
                            <div className="hidden w-full max-w-64 justify-self-start lg:block">
                                <MiniStat
                                    label="validator"
                                    value={backtestAnalytics.analyzableCount > 0 ? `${backtestAnalytics.positiveCount}/${backtestAnalytics.analyzableCount}` : "—"}
                                    unit="positive runs"
                                    note="Rejected intents carry a code"
                                    tone="text-positive"
                                />
                            </div>
                            <div className="grid w-full max-w-md grid-cols-2 gap-3 lg:hidden">
                                <MiniStat
                                    label="workspace"
                                    value={String(backtestAnalytics.total)}
                                    unit="runs"
                                    note="Stored with metrics"
                                />
                                <MiniStat
                                    label="validator"
                                    value={backtestAnalytics.analyzableCount > 0 ? `${backtestAnalytics.positiveCount}/${backtestAnalytics.analyzableCount}` : "—"}
                                    unit="positive"
                                    note="Rejections carry a code"
                                    tone="text-positive"
                                />
                            </div>
                        </div>
                    </div>
                </Reveal>

                <Reveal delay={140}>
                    <Tabs value={tab} onValueChange={setTab} className="mt-10 items-stretch">
                        <TabsContent value="discover" className="w-full">
                            <TabPanel
                                title="Find the setup worth researching"
                                copy="Scan regimes, liquidity maps, and session structure from one screener, then open any symbol straight into analysis."
                                bullets={[
                                    "Regime + liquidity + VWAP in one view",
                                    "Session-aware London / New York / Tokyo",
                                    "Opens directly into Strategy Lab",
                                ]}
                                cta={{ label: "Open the scanner", href: "/scanner" }}
                                visual={<EngineBars />}
                            />
                        </TabsContent>

                        <TabsContent value="validate" className="w-full">
                            <TabPanel
                                title="Prove it before you risk it"
                                copy="Deterministic backtests with real costs, walk-forward and Monte Carlo robustness, and bar-by-bar replay — stored as runs you can re-open."
                                bullets={[
                                    "Spread, slippage & commission modeled",
                                    "Walk-forward + Monte Carlo checks",
                                    "Every run stored with its metrics",
                                ]}
                                cta={{ label: "Open Backtest Studio", href: "/backtests" }}
                                visual={
                                    <div>
                                        <div className="overflow-hidden rounded-lg border border-border">
                                            <HomeCandleChart seed={11} basePrice={1840} precision={2} count={56} stepSeconds={3600} height={170} label="Validate tab illustrative sample" />
                                        </div>
                                        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
                                            {tiles.map((t) => (
                                                <div key={t.label} className="bg-card px-3 py-2.5">
                                                    <p className="text-[11px] text-muted-foreground">{t.label}</p>
                                                    <p className="mt-0.5 font-numeric text-base font-semibold text-foreground">{t.value}</p>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-3">
                                            <ReturnsHistogram />
                                        </div>
                                    </div>
                                }
                            />
                        </TabsContent>

                        <TabsContent value="execute" className="w-full">
                            <TabPanel
                                title="Send orders through a risk gate"
                                copy="Approved intents travel to MetaTrader through a custom MQL5 Expert Advisor. Anything that fails limits is rejected with a decision code."
                                bullets={[
                                    "Pre-trade risk validation",
                                    "Custom MQL5 execution EA",
                                    "Every rejection explained and logged",
                                ]}
                                cta={{ label: "Set up trading access", href: "/account/trading-access" }}
                                visual={
                                    <div className="space-y-4">
                                        <SignalLifecycle />
                                        <RiskMini />
                                    </div>
                                }
                            />
                        </TabsContent>

                        <TabsContent value="monitor" className="w-full">
                            <TabPanel
                                title="Watch the loop stay honest"
                                copy="Track signal lifecycle, drawdown guards, and gateway heartbeats from the live console. Stale feeds are labeled stale — never live."
                                bullets={[
                                    "Equity & drawdown telemetry",
                                    "Signal lifecycle audit trail",
                                    "Gateway heartbeat honesty",
                                ]}
                                cta={{ label: "Open live console", href: "/live" }}
                                visual={
                                    <div>
                                        <TelemetryMini />
                                        <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                                            Every step reads from the same recorded data.
                                        </p>
                                    </div>
                                }
                            />
                        </TabsContent>

                        <TabsList className="mt-8 flex h-auto w-full gap-6 overflow-x-auto rounded-none border-0 border-b border-border bg-transparent p-0 [scrollbar-width:none] md:grid md:grid-cols-4 md:overflow-visible">
                            {[
                                { value: "discover", label: "Discover", copy: "Scan the market", icon: ScanSearch },
                                { value: "validate", label: "Validate", copy: "Prove it first", icon: History },
                                { value: "execute", label: "Execute", copy: "Through the gate", icon: Send },
                                { value: "monitor", label: "Monitor", copy: "Watch it honestly", icon: Gauge },
                            ].map(({ value, label, copy, icon: Icon }) => {
                                const active = tab === value;
                                return (
                                    <TabsTrigger
                                        key={value}
                                        value={value}
                                        className="relative w-44 shrink-0 justify-start rounded-none border-0 bg-transparent px-0 pb-3 pt-1 data-active:bg-transparent data-active:shadow-none dark:data-active:bg-transparent md:w-auto"
                                    >
                                        <span className="flex w-full flex-col items-start gap-0.5 text-left">
                                            <span className={cn("flex items-center gap-1.5 text-sm font-medium transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                                <Icon size={14} aria-hidden />
                                                {label}
                                            </span>
                                            <span className="block text-xs text-muted-foreground/70">{copy}</span>
                                        </span>
                                        <span
                                            aria-hidden
                                            className={cn(
                                                "absolute inset-x-0 bottom-0 h-px origin-left bg-primary transition-transform duration-300 motion-reduce:transition-none",
                                                active ? "scale-x-100" : "scale-x-0",
                                            )}
                                        />
                                    </TabsTrigger>
                                );
                            })}
                        </TabsList>
                    </Tabs>
                </Reveal>
            </div>
        </section>
    );
}

function TabPanel({
    title,
    copy,
    bullets,
    cta,
    visual,
}: {
    title: string;
    copy: string;
    bullets: string[];
    cta: { label: string; href: string };
    visual: React.ReactNode;
}) {
    return (
        <Card className="mx-auto max-w-5xl gap-0 overflow-hidden py-0 shadow-md">
            <div className="grid md:grid-cols-[0.9fr_1.1fr]">
                <div className="p-5 sm:p-6 md:p-8">
                    <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">{title}</h3>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy}</p>
                    <ul className="mt-5 space-y-2.5">
                        {bullets.map((b) => (
                            <li key={b} className="flex items-start gap-2.5 text-[13px] leading-5 text-foreground">
                                <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-positive/12 text-positive">
                                    <Check size={11} strokeWidth={3} aria-hidden />
                                </span>
                                {b}
                            </li>
                        ))}
                    </ul>
                    <Button render={<Link href={cta.href} />} className="mt-6">
                        {cta.label} <ArrowRight data-icon="inline-end" />
                    </Button>
                </div>
                <CardSpotlight radius={420} className="rounded-none border-0 border-t md:border-l md:border-t-0">
                    <div className="relative z-10 bg-muted/40 p-5 sm:p-6 md:p-8">{visual}</div>
                </CardSpotlight>
            </div>
        </Card>
    );
}

function MiniStat({
    label,
    value,
    unit,
    note,
    tone,
}: {
    label: string;
    value: string;
    unit: string;
    note: string;
    tone?: string;
}) {
    return (
        <div className="w-full rounded-xl border border-border bg-card p-4 shadow-md">
            <p className="truncate font-numeric text-xs text-muted-foreground">{label} · sample</p>
            <p className={cn("mt-1 font-numeric text-2xl font-semibold tracking-tight", tone ?? "text-foreground")}>
                {value}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">{unit}</span>
            </p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{note}</p>
        </div>
    );
}
