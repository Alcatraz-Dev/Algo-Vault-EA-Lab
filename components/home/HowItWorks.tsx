"use client";

import Link from "next/link";
import {
    ArrowCounterClockwise,
    ArrowRight,
    ListChecks,
    PaperPlaneTilt,
    SlidersHorizontal,
} from "@phosphor-icons/react";
import Reveal from "./Reveal";
import TacticalCard from "./TacticalCard";
import HomeAurora from "./HomeAurora";
import HomeSectionHeader from "./HomeSectionHeader";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { HomeBacktestAnalytics } from "@/lib/home-data";

const STEPS = [
    {
        value: "backtest",
        icon: ArrowCounterClockwise,
        title: "Backtest & replay",
        copy: "Single-pass simulations with realistic costs, plus bar-by-bar replay on real candles so you can see exactly where an edge breaks.",
        cta: { href: "/backtests", label: "Open backtests" },
    },
    {
        value: "optimize",
        icon: SlidersHorizontal,
        title: "Optimize & stress",
        copy: "Grid search, walk-forward windows and Monte Carlo robustness run against recorded results — the ones that survive out of sample.",
        cta: { href: "/monte-carlo", label: "Open Monte Carlo" },
    },
    {
        value: "execute",
        icon: PaperPlaneTilt,
        title: "Execute & monitor",
        copy: "Risk-validated dispatch to MetaTrader with heartbeats, drawdown telemetry and alerts on every position the platform opens.",
        cta: { href: "/live", label: "Open live console" },
    },
];

/* Walk-forward configuration: these are the knobs a trader sets, not results,
   so the panel states a setup rather than claiming an outcome. */
const OPTIMIZER = [
    { label: "Parameters", value: "6" },
    { label: "Grid size", value: "4,096" },
    { label: "Walk-forward windows", value: "5" },
    { label: "Out-of-sample split", value: "30%" },
    { label: "Monte Carlo paths", value: "10,000" },
    { label: "Objective", value: "Risk-adjusted" },
];

const GUARDS = [
    "Daily loss limit",
    "Position sizing",
    "Max drawdown",
    "Spread filter",
    "Session window",
    "Duplicate signal guard",
];

/** A labelled read-out used by both the empty and the populated variants. */
function Readout({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-card px-4 py-3.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-numeric text-lg font-bold tabular-nums text-foreground">{value}</dd>
        </div>
    );
}

function pct(value: number): string {
    return Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
}

/**
 * 02 · Workflow — the validation loop, rendered as a real tablist.
 *
 * The read-outs are data a visitor must actually read, so they stay on crisp
 * Frame surfaces (DESIGN.md §21.3) rather than glass: the panel states setups
 * and recorded aggregates, never invented outcomes.
 */
export default function HowItWorks({ analytics }: { analytics: HomeBacktestAnalytics }) {
    const hasEvidence = analytics.total > 0;

    return (
        <section id="workflow" className="home-section py-20 md:py-28">
            <HomeAurora
                className="opacity-50"
                aClassName="left-[8%] top-[-6rem] h-[26rem] w-[26rem]"
                bClassName="right-[-4%] bottom-[-8rem] h-[24rem] w-[24rem]"
            />
            <div className="page-container">
                <Reveal>
                    <HomeSectionHeader
                        eyebrow="02 · Workflow"
                        title="Validate before you risk anything"
                        description="The validation tooling that normally lives in three separate subscriptions — built in."
                    />
                </Reveal>

                <Reveal delay={70}>
                    {/* The vertical orientation only stacks the rail on top of the
                        panels at lg; below that the root must go column itself,
                        or the rail's width plus the panel overflows sideways. */}
                    <TacticalCard dir={0} spotlight={true} className="mt-12 rounded-2xl">
                        <Tabs defaultValue="backtest" orientation="vertical" className="flex-col gap-6 lg:flex-row lg:gap-12">
                            {/* Step rail — a real tablist, so arrow keys and
                                screen readers move through the steps in order. */}
                            <TabsList className="h-auto w-full flex-col items-stretch justify-start gap-2 lg:w-80 lg:shrink-0">
                            {STEPS.map(({ value, icon: Icon, title, copy }, i) => (
                                <TabsTrigger
                                    key={value}
                                    value={value}
                                    className="h-auto items-start justify-start gap-3 px-3 py-3 text-left"
                                >
                                    <span className="mt-0.5 font-numeric text-xs font-semibold tabular-nums text-muted-foreground">
                                        {String(i + 1).padStart(2, "0")}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2 text-sm font-semibold">
                                            <Icon size={15} weight="bold" aria-hidden />
                                            {title}
                                        </span>
                                        {/* TabsTrigger ships whitespace-nowrap, which
                                            inherits here and would run each step's
                                            description out to ~700px on one line. */}
                                        <span className="mt-1 block whitespace-normal text-xs font-normal leading-5 text-muted-foreground">
                                            {copy}
                                        </span>
                                    </span>
                                </TabsTrigger>
                            ))}
                        </TabsList>

                        <div className="min-w-0 flex-1">
                            {/* Step 1 — real aggregates over recorded runs. */}
                            <TabsContent value="backtest">
                                <Frame dense className="shadow-sm">
                                    <FramePanel className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-5 py-4">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold tracking-tight text-foreground">
                                                Recorded results
                                            </p>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {hasEvidence
                                                    ? `Averaged across ${analytics.total.toLocaleString()} runs on the platform.`
                                                    : "Aggregates appear once backtests are recorded."}
                                            </p>
                                        </div>
                                        <Badge variant="outline" radius="full" className="shrink-0">
                                            {hasEvidence ? "Live data" : "Awaiting data"}
                                        </Badge>
                                    </FramePanel>

                                    {hasEvidence ? (
                                        <dl className="grid grid-cols-2 gap-px bg-border/80 sm:grid-cols-4">
                                            <Readout label="Runs measured" value={analytics.total.toLocaleString()} />
                                            <Readout label="Average win rate" value={pct(analytics.avgWinRate)} />
                                            <Readout label="Average max drawdown" value={pct(analytics.avgMaxDrawdown)} />
                                            <Readout
                                                label="Profitable runs"
                                                value={`${analytics.positiveCount} of ${analytics.total}`}
                                            />
                                        </dl>
                                    ) : (
                                        <div className="px-5 py-12 text-center">
                                            <p className="text-sm font-medium text-foreground">
                                                No recorded runs yet
                                            </p>
                                            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                                                Run your first backtest and these numbers populate automatically —
                                                no placeholder figures.
                                            </p>
                                            <Button render={<Link href="/backtests" />} size="sm" className="mt-5">
                                                Run a backtest <ArrowRight data-icon="inline-end" size={14} />
                                            </Button>
                                        </div>
                                    )}
                                </Frame>
                            </TabsContent>

                            {/* Step 2 — the optimizer's setup, stated as inputs. */}
                            <TabsContent value="optimize">
                                <Frame dense className="shadow-sm">
                                    <FramePanel className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-5 py-4">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold tracking-tight text-foreground">
                                                Optimizer configuration
                                            </p>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                What you set before a sweep runs. Results are reported per window.
                                            </p>
                                        </div>
                                        <Badge variant="outline" radius="full" className="shrink-0">
                                            Walk-forward
                                        </Badge>
                                    </FramePanel>
                                    <dl className="grid grid-cols-2 gap-px bg-border/80 sm:grid-cols-3">
                                        {OPTIMIZER.map((row) => (
                                            <Readout key={row.label} label={row.label} value={row.value} />
                                        ))}
                                    </dl>
                                </Frame>
                            </TabsContent>

                            {/* Step 3 — the guards that run before dispatch. */}
                            <TabsContent value="execute">
                                <Frame dense className="shadow-sm">
                                    <FramePanel className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-5 py-4">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold tracking-tight text-foreground">
                                                Pre-trade guards
                                            </p>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                Checked on every order before it can reach your terminal.
                                            </p>
                                        </div>
                                        <Badge variant="success-light" radius="full" className="shrink-0 gap-1">
                                            <ListChecks size={12} aria-hidden /> {GUARDS.length} active
                                        </Badge>
                                    </FramePanel>
                                    <ul className="grid grid-cols-1 gap-px bg-border/80 sm:grid-cols-2">
                                        {GUARDS.map((guard) => (
                                            <li key={guard} className="flex items-center justify-between gap-3 bg-card px-5 py-3.5">
                                                <span className="text-sm text-foreground">{guard}</span>
                                                <Badge variant="success-light" size="xs" radius="full">
                                                    Enforced
                                                </Badge>
                                            </li>
                                        ))}
                                    </ul>
                                </Frame>
                            </TabsContent>
                        </div>
                    </Tabs>
                    </TacticalCard>
                </Reveal>

                {/* Section-level action, so the step rail and the panels resolve
                    to somewhere rather than leaving the reader at a dead end. */}
                <Reveal delay={120}>
                    <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border/70 pt-6">
                        {STEPS.map(({ value, cta }) => (
                            <Link
                                key={value}
                                href={cta.href}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                            >
                                {cta.label}
                                <ArrowRight size={13} aria-hidden />
                            </Link>
                        ))}
                    </div>
                </Reveal>
            </div>
        </section>
    );
}