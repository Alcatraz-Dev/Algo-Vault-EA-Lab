"use client";

import Link from "next/link";
import { ArrowRight, Check, Gauge, History, ScanSearch, Send } from "lucide-react";
import type { HomeData } from "@/lib/home-data";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardSpotlight } from "@/components/ui/card-spotlight";
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
                    <Tabs defaultValue="discover" className="mt-10 items-center">
                        <TabsList className="h-auto flex-wrap rounded-full border border-border bg-card p-1 shadow-sm">
                            {[
                                { value: "discover", label: "Discover", icon: ScanSearch },
                                { value: "validate", label: "Validate", icon: History },
                                { value: "execute", label: "Execute", icon: Send },
                                { value: "monitor", label: "Monitor", icon: Gauge },
                            ].map(({ value, label, icon: Icon }) => (
                                <TabsTrigger
                                    key={value}
                                    value={value}
                                    className="rounded-full px-4 py-1.5 text-[13px] data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm dark:data-active:bg-primary dark:data-active:text-primary-foreground"
                                >
                                    <Icon size={14} aria-hidden />
                                    {label}
                                </TabsTrigger>
                            ))}
                        </TabsList>

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
        <Card className="mx-auto mt-6 max-w-5xl gap-0 overflow-hidden py-0 shadow-md">
            <div className="grid md:grid-cols-[0.9fr_1.1fr]">
                <div className="p-6 md:p-8">
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
                    <div className="relative z-10 bg-muted/40 p-6 md:p-8">{visual}</div>
                </CardSpotlight>
            </div>
        </Card>
    );
}
