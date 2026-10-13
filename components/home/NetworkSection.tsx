"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { HomeData } from "@/lib/home-data";
import { Button } from "@/components/ui/button";
import Reveal from "./Reveal";

/**
 * Coverage section ("Every session, one workspace"): real aggregates on
 * the left with the sessions the engine reads, four capability bullets
 * on the right. No latency or region counts — only what the product
 * actually records and supports.
 */
const SESSIONS = [
    { name: "Tokyo", desc: "Asian range structure" },
    { name: "London", desc: "Liquidity sweeps + breakouts" },
    { name: "New York", desc: "Trend continuation + reversals" },
] as const;

const BULLETS = [
    {
        title: "One vocabulary everywhere",
        copy: "Symbol, timeframe, data age, and risk context travel from scanner to fill — nothing is re-entered.",
    },
    {
        title: "Deterministic engines first",
        copy: "Eight pure engines compute from real candles; AI explains their output and never overrides it.",
    },
    {
        title: "A gate on every order",
        copy: "Limits and drawdown guards approve or reject before the gateway may act — with a decision code.",
    },
    {
        title: "An audit trail by default",
        copy: "Signals, backtests, fills, and rejections are stored runs and states, not claims.",
    },
] as const;

export default function NetworkSection({ data }: { data: HomeData }) {
    const { stats } = data;
    const figures = [
        { value: stats.strategies.toLocaleString("en-US"), label: "Strategies listed" },
        { value: stats.backtests.toLocaleString("en-US"), label: "Recorded backtest runs" },
        { value: "8", label: "Deterministic engines" },
        { value: stats.reviewCount > 0 ? stats.reviewCount.toLocaleString("en-US") : "Free", label: stats.reviewCount > 0 ? "Verified reviews" : "Workspace to start" },
    ];

    return (
        <section className="relative overflow-hidden border-b border-border bg-background">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-50 [background-image:radial-gradient(var(--border-color)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_55%_60%_at_30%_40%,black_20%,transparent_100%)] motion-reduce:hidden"
            />
            <div className="page-container relative grid gap-10 py-14 md:py-20 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14">
                <Reveal>
                    <div>
                        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                            Market coverage
                        </p>
                        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                            Every session, one workspace
                        </h2>
                        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
                            {figures.map((f) => (
                                <div key={f.label} className="bg-card px-4 py-4">
                                    <dd className="font-numeric text-2xl font-semibold tracking-tight text-foreground">
                                        {f.value}
                                    </dd>
                                    <dt className="mt-1 text-xs text-muted-foreground">{f.label}</dt>
                                </div>
                            ))}
                        </dl>
                        <ul className="mt-4 space-y-2">
                            {SESSIONS.map((s) => (
                                <li key={s.name} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5 text-[13px]">
                                    <span className="flex items-center gap-2 font-semibold text-foreground">
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive/60 motion-reduce:animate-none" />
                                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
                                        </span>
                                        {s.name}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{s.desc}</span>
                                </li>
                            ))}
                        </ul>
                        <Button render={<Link href="/market-intelligence" />} variant="outline" className="mt-6">
                            Open market intelligence <ArrowRight data-icon="inline-end" />
                        </Button>
                    </div>
                </Reveal>
                <div className="flex flex-col justify-center gap-6">
                    {BULLETS.map((b, i) => (
                        <Reveal key={b.title} delay={i * 70}>
                            <div className="flex gap-4">
                                <span className="font-numeric text-xs font-semibold text-primary">0{i + 1}</span>
                                <div>
                                    <h3 className="text-base font-semibold tracking-tight text-foreground">{b.title}</h3>
                                    <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{b.copy}</p>
                                </div>
                            </div>
                        </Reveal>
                    ))}
                </div>
            </div>
        </section>
    );
}
