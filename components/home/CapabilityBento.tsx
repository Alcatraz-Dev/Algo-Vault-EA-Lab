"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BentoGrid, BentoGridItem } from "@/components/ui/bento-grid";
import { Badge } from "@/components/ui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import HomeCandleChart from "./HomeCandleChart";
import Reveal from "./Reveal";

/**
 * Platform capabilities as an Aceternity `BentoGrid`. Each `BentoGridItem`
 * carries a bespoke visual header (mini equity curve, lifecycle chips,
 * risk checklist, engine rows, copy sizing) instead of repeating one
 * generic card — varied composition over identical cells.
 *
 * All figures in headers are illustrative samples and labeled as such;
 * module names, routes, and engine lists are real.
 */

function MiniCandles() {
    return (
        <div className="flex h-full min-h-36 flex-col justify-center p-4">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-semibold uppercase tracking-widest">Sample price action</span>
                <span className="font-numeric font-semibold text-muted-foreground">M15</span>
            </div>
            <div className="mt-2 overflow-hidden rounded-lg border border-border">
                <HomeCandleChart seed={21} basePrice={1840} precision={2} count={40} height={128} showVolume={false} label="Strategy Lab illustrative sample" />
            </div>
        </div>
    );
}

function LifecycleChips() {
    return (
        <div className="flex h-full min-h-28 flex-col justify-center gap-1.5 p-4">
            <div className="flex flex-wrap gap-1.5">
                {["NEW", "PENDING_ENTRY", "ENTRY_TRIGGERED"].map((s) => (
                    <Badge key={s} variant="success" className="font-numeric text-[11px]">
                        {s}
                    </Badge>
                ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {["TP_REACHED", "CLOSED"].map((s) => (
                    <Badge key={s} variant="success" className="font-numeric text-[11px]">
                        {s}
                    </Badge>
                ))}
                {["STOPPED_OUT", "EXPIRED"].map((s) => (
                    <Badge key={s} variant="warning" className="font-numeric text-[11px]">
                        {s}
                    </Badge>
                ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Canonical audited lifecycle</p>
        </div>
    );
}

function RiskRows() {
    return (
        <ul className="flex h-full min-h-28 flex-col justify-center divide-y divide-border p-4 text-[13px]">
            {[
                ["Daily loss limit", "2%"],
                ["Drawdown guard", "Armed"],
                ["Sizing", "1% risk"],
            ].map(([k, v]) => (
                <li key={k} className="flex items-center justify-between py-1.5">
                    <span className="font-medium text-foreground">{k}</span>
                    <span className="font-numeric text-muted-foreground">{v}</span>
                </li>
            ))}
        </ul>
    );
}

/** Sample engine scores (0–100) — illustrative, labeled in the UI. */
const ENGINE_SCORES = [
    { short: "RG", name: "Regime", score: 84 },
    { short: "ST", name: "Structure", score: 72 },
    { short: "ZN", name: "Zones", score: 65 },
    { short: "LQ", name: "Liquidity", score: 58 },
    { short: "VW", name: "VWAP", score: 77 },
    { short: "SS", name: "Sessions", score: 69 },
    { short: "VL", name: "Volume", score: 61 },
    { short: "SC", name: "Score", score: 74 },
] as const;

function EngineBars() {
    return (
        <div className="flex h-full min-h-36 flex-col justify-center p-4">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-semibold uppercase tracking-widest">Sample engine scores</span>
                <span className="font-numeric font-semibold text-muted-foreground">0–100</span>
            </div>
            <div className="mt-2 h-28" role="img" aria-label="Illustrative sample engine scores">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[...ENGINE_SCORES]} margin={{ top: 2, right: 0, left: 0, bottom: 0 }} barCategoryGap="28%">
                        <XAxis
                            dataKey="short"
                            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            interval={0}
                        />
                        <YAxis hide domain={[0, 100]} />
                        <Tooltip
                            cursor={{ fill: "var(--muted)" }}
                            contentStyle={{
                                background: "var(--card)",
                                border: "1px solid var(--border-color)",
                                borderRadius: 12,
                                color: "var(--foreground)",
                                fontSize: 12,
                            }}
                            formatter={(value) => [`${value} / 100`, "Score"]}
                            labelFormatter={(_, payload) => {
                                const first = payload?.[0]?.payload as { name?: string } | undefined;
                                return first?.name ?? "";
                            }}
                        />
                        <Bar dataKey="score" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false}>
                            {ENGINE_SCORES.map((e) => (
                                <Cell key={e.short} fill="var(--primary)" fillOpacity={0.45 + (e.score / 100) * 0.55} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

function CopyRows() {
    return (
        <div className="flex h-full min-h-28 flex-col justify-center gap-2 p-4">
            {[
                ["Master allocation", "2.0%"],
                ["Follower scale", "×0.5"],
                ["Max followers", "50"],
            ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-numeric font-semibold text-foreground">{v}</span>
                </div>
            ))}
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-2/3 rounded-full bg-primary" aria-hidden />
            </div>
        </div>
    );
}

const ITEMS = [
    {
        title: "Strategy Lab",
        description: "Discover structural patterns, assemble visual strategies, and export Pine Script v6 or MQL5.",
        header: <MiniCandles />,
        icon: null,
        href: "/strategy-lab",
        link: "Open Strategy Lab",
        className: "md:col-span-2",
    },
    {
        title: "Signal Center",
        description: "AI-normalized signals on a canonical, audited lifecycle — nothing closes without a recorded outcome.",
        header: <LifecycleChips />,
        icon: null,
        href: "/signals",
        link: "Open signals",
        className: "",
    },
    {
        title: "Risk Engine",
        description: "Pre-trade validation and drawdown guards in front of every order. Rejections carry a decision code.",
        header: <RiskRows />,
        icon: null,
        href: "/risk",
        link: "Open risk controls",
        className: "",
    },
    {
        title: "Market Scanner",
        description: "Eight deterministic engines read regime, liquidity, and VWAP structure across timeframes.",
        header: <EngineBars />,
        icon: null,
        href: "/scanner",
        link: "Open scanner",
        className: "",
    },
    {
        title: "Copy Trading",
        description: "Risk-scaled mirroring between verified strategies and follower allocations.",
        header: <CopyRows />,
        icon: null,
        href: "/copy-trading",
        link: "Open copy trading",
        className: "md:col-span-2",
    },
];

export default function CapabilityBento() {
    return (
        <section className="border-b border-border bg-background">
            <div className="page-container py-14 md:py-20">
                <Reveal>
                    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
                        <div className="max-w-2xl">
                            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                                <span aria-hidden className="h-px w-6 bg-primary/60" />
                                Platform map
                            </p>
                            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                                One workspace, every stage of the trade.
                            </h2>
                            <p className="mt-4 text-sm leading-6 text-pretty text-muted-foreground sm:text-[0.9375rem]">
                                Separate modules sharing one vocabulary — symbol, timeframe,
                                data age, and risk context travel with you.
                            </p>
                        </div>
                        <Link
                            href="/dashboard"
                            className="group inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                        >
                            Open the dashboard
                            <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                        </Link>
                    </div>
                </Reveal>
                <Reveal delay={100}>
                    <BentoGrid className="mt-10 max-w-none">
                        {ITEMS.map((item) => (
                            <BentoGridItem
                                key={item.href}
                                title={
                                    <span className="flex items-center gap-2">
                                        {item.title}
                                        <ArrowUpRight
                                            size={14}
                                            className="text-muted-foreground transition-all duration-200 group-hover/bento:translate-x-0.5 group-hover/bento:text-primary"
                                            aria-hidden
                                        />
                                    </span>
                                }
                                description={
                                    <>
                                        {item.description}{" "}
                                        <Link
                                            href={item.href}
                                            className="mt-2 inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                                            aria-label={`${item.link}`}
                                        >
                                            {item.link} <ArrowRight size={12} aria-hidden />
                                        </Link>
                                    </>
                                }
                                header={item.header}
                                icon={
                                    <IconTile variant="soft" size="xs" aria-hidden>
                                        <span className="font-numeric text-[11px] font-bold text-primary">AV</span>
                                    </IconTile>
                                }
                                className={item.className}
                            />
                        ))}
                    </BentoGrid>
                </Reveal>
                <p className="mt-4 text-xs text-muted-foreground">
                    Visual headers show illustrative samples of each module&apos;s layout — live figures appear inside the product.
                </p>
            </div>
        </section>
    );
}
