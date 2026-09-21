"use client";

import Link from "next/link";
import {
    Area,
    AreaChart,
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import {
    ArrowRight,
    Database,
    Gauge,
    ShieldCheck,
    Sigma,
} from "lucide-react";
import Reveal from "./Reveal";
import CountUp from "./CountUp";
import type { HomeBacktestAnalytics } from "@/lib/home-data";

const TOOLTIP_STYLE = {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    color: "var(--foreground)",
    fontSize: 12,
} as const;

function formatUsd(value: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(value);
}

function formatSignedUsd(value: number): string {
    const sign = value >= 0 ? "+" : "-";
    return `${sign}${formatUsd(Math.abs(value))}`;
}

function shortLabel(backtest: {
    title?: string;
    pair?: string;
    timeframe?: string;
}): string {
    if (backtest.title && backtest.title.length <= 14) return backtest.title;
    return [backtest.pair, backtest.timeframe].filter(Boolean).join(" · ") || "Run";
}

/** Cumulative equity across runs — the account-backtest style curve. */
function buildEquityData(
    data: Array<{ label: string; netProfit: number }>,
): Array<{ label: string; equity: number }> {
    const rows: Array<{ label: string; equity: number }> = [];
    let cumulative = 0;
    for (const d of data) {
        cumulative += d.netProfit;
        rows.push({ label: d.label, equity: cumulative });
    }
    return rows;
}

/** Rich tooltip for the quality chart — win rate + drawdown side by side. */
function QualityTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{ dataKey?: string | number; value?: number | string }>;
    label?: string;
}) {
    if (!active || !payload || payload.length === 0) return null;
    const win = payload.find((p) => p.dataKey === "winRate")?.value;
    const dd = payload.find((p) => p.dataKey === "maxDrawdown")?.value;
    return (
        <div className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-xs font-semibold text-foreground">{label}</p>
            <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: "var(--primary)" }} />
                Win rate
                <span className="ml-auto pl-4 font-mono font-semibold text-foreground">{win}%</span>
            </p>
            <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: "var(--negative)" }} />
                Max drawdown
                <span className="ml-auto pl-4 font-mono font-semibold text-foreground">{dd}%</span>
            </p>
        </div>
    );
}

const LOGIC_STEPS = [
    { icon: Database, label: "Deterministic single-pass" },
    { icon: Gauge, label: "Spread & slippage included" },
    { icon: ShieldCheck, label: "Stored runs, not claims" },
];

export default function EvidenceAnalytics({
    analytics,
    preview = false,
}: {
    analytics: HomeBacktestAnalytics;
    /** True when the section shows the labeled sample-preview set. */
    preview?: boolean;
}) {
    const chartData = analytics.recent.map((b) => ({
        label: shortLabel(b),
        netProfit: Number(b.netProfit) || 0,
        winRate: Number(b.winRate) || 0,
        maxDrawdown: Number(b.maxDrawdown) || 0,
        returnPct:
            Number(b.initialBalance) > 0
                ? (Number(b.netProfit) / Number(b.initialBalance)) * 100
                : 0,
    }));

    // Cumulative equity across the recorded runs — the account-backtest
    // style curve, drawn as a gradient area with the same mount animation.
    const equityData = buildEquityData(chartData);

    const hasRuns = analytics.total > 0;
    const positiveShare =
        analytics.analyzableCount > 0
            ? Math.round((analytics.positiveCount / analytics.analyzableCount) * 100)
            : 0;

    // CountUp-friendly tiles: decimals are scaled ×10 and re-formatted so the
    // eased count still lands on the exact published value.
    const tiles = [
        { label: "Recorded runs", count: analytics.total, format: (n: number) => String(n), tone: "text-foreground" },
        { label: "Avg win rate", count: Math.round(analytics.avgWinRate * 10), format: (n: number) => `${(n / 10).toFixed(1)}%`, tone: "text-positive" },
        { label: "Avg max drawdown", count: Math.round(analytics.avgMaxDrawdown * 10), format: (n: number) => `${(n / 10).toFixed(1)}%`, tone: "text-negative" },
        { label: "Avg return on balance", count: Math.round(analytics.avgReturnPct * 10), format: (n: number) => `${(n / 10).toFixed(1)}%`, tone: "text-foreground" },
        { label: "Positive runs", count: analytics.positiveCount, format: (n: number) => `${n}/${analytics.analyzableCount || 0}`, tone: "text-positive" },
        { label: "Total net result", count: analytics.totalNetProfit, format: (n: number) => formatSignedUsd(n), tone: analytics.totalNetProfit >= 0 ? "text-positive" : "text-negative" },
    ];

    return (
        <section className="border-b border-border bg-muted/30">
            <div className="page-container py-14 md:py-20">
                <Reveal>
                    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
                        <div>
                            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                                Recorded evidence
                                {preview && (
                                    <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 font-mono text-micro font-medium normal-case tracking-normal text-warning">Sample preview</span>
                                )}
                            </p>
                            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-5xl">Backtests with numbers anyone can check.</h2>
                        </div>
                        <Link href="/backtests" className="group inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">Browse every run <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-0.5" /></Link>
                    </div>
                </Reveal>

                <Reveal delay={80}>
                    <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
                        {LOGIC_STEPS.map(({ icon: Icon, label }) => (
                            <span key={label} className="flex items-center gap-2">
                                <Icon size={14} className="text-primary" />
                                {label}
                            </span>
                        ))}
                    </div>
                </Reveal>

                {hasRuns ? (
                    <>
                        <div className="mt-10 grid gap-6 lg:grid-cols-2">
                            <Reveal delay={120}>
                                <div className="group rounded-lg border border-border bg-card transition-all duration-300 hover:border-primary/40 hover:shadow-[0_0_28px_-10px_color-mix(in_oklch,var(--primary)_45%,transparent)]">
                                    <div className="border-b border-border px-5 py-4">
                                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Equity curve</p>
                                        <h3 className="mt-2 text-xl font-semibold text-foreground">Recent recorded backtests</h3>
                                    </div>
                                    <div className="px-3 py-4">
                                        <div className="h-52">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={equityData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="recordedEquity" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#ff4d00" stopOpacity={0.35} />
                                                            <stop offset="95%" stopColor="#ff4d00" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} interval={0} />
                                                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} width={52} tickFormatter={(v: number) => formatUsd(v)} />
                                                    <Tooltip cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} contentStyle={TOOLTIP_STYLE} formatter={(value) => [formatSignedUsd(Number(value)), "Equity"]} />
                                                    <Area type="monotone" dataKey="equity" stroke="#ff4d00" strokeWidth={2.5} fillOpacity={1} fill="url(#recordedEquity)" />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                    <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-2"><Sigma size={14} className="text-primary" />Cumulative net of spread, slippage and commission — deterministic simulation</span>
                                    </div>
                                </div>
                            </Reveal>

                            <Reveal delay={180}>
                                <div className="group rounded-lg border border-border bg-card transition-all duration-300 hover:border-primary/40 hover:shadow-[0_0_28px_-10px_color-mix(in_oklch,var(--primary)_45%,transparent)]">
                                    <div className="border-b border-border px-5 py-4">
                                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Quality profile</p>
                                        <h3 className="mt-2 text-xl font-semibold text-foreground">Win rate vs drawdown per run</h3>
                                    </div>
                                    <div className="px-3 py-4">
                                        <div className="h-52">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="winRateGradient" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor="#ff4d00" stopOpacity={0.95} />
                                                            <stop offset="100%" stopColor="#ff4d00" stopOpacity={0.2} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} interval={0} />
                                                    <YAxis domain={[0, 100]} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} width={36} tickFormatter={(v: number) => `${v}%`} />
                                                    <Tooltip cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} content={<QualityTooltip />} />
                                                    <ReferenceLine y={50} stroke="var(--muted-foreground)" strokeOpacity={0.45} strokeDasharray="4 4" label={{ value: "50%", position: "insideTopLeft", fontSize: 10, fill: "var(--muted-foreground)" }} />
                                                    <Bar dataKey="winRate" name="Win rate" fill="url(#winRateGradient)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                                                    <Line type="monotone" dataKey="maxDrawdown" name="Max drawdown" stroke="var(--negative)" strokeWidth={2} dot={{ r: 3, fill: "var(--negative)", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                                                </ComposedChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-2"><Gauge size={14} className="text-primary" />Win rate</span>
                                        <span className="flex items-center gap-2"><ShieldCheck size={14} className="text-negative" />Max drawdown</span>
                                    </div>
                                </div>
                            </Reveal>
                        </div>

                        <Reveal delay={140}>
                            <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-6">
                                {tiles.map((tile) => (
                                    <div key={tile.label} className="bg-card px-4 py-4">
                                        <p className="text-xs text-muted-foreground">{tile.label}</p>
                                        <p className={`mt-2 font-mono text-xl font-semibold ${tile.tone}`}>
                                            <CountUp value={tile.count} format={tile.format} />
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </Reveal>

                        <p className="mt-4 text-xs text-muted-foreground">
                            {positiveShare}% of analyzable runs closed positive.{" "}
                            {preview
                                ? "Sample preview set — publish your own recorded backtests to replace it. Public, anonymous, no private accounts."
                                : "Publicly stored simulation runs — anonymous, no private accounts."}
                        </p>
                    </>
                ) : (
                    <Reveal delay={120}>
                        <div className="mt-10 rounded-lg border border-dashed border-border bg-card px-5 py-14 text-center">
                            <p className="text-sm font-semibold text-foreground">No recorded runs yet</p>
                            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">
                                Published backtests appear here with their numbers — initial balance, net result, win rate and max drawdown. Nothing is simulated or claimed until it is recorded.
                            </p>
                            <Link href="/backtests" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline">Open backtest studio <ArrowRight size={13} /></Link>
                        </div>
                    </Reveal>
                )}
            </div>
        </section>
    );
}