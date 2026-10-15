"use client"

import { TrendingUp } from "lucide-react"
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, RadialBar, RadialBarChart } from "recharts";
import { useReducedMotion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

/**
 * Shared presentational visuals for the homepage loop sections.
 * Sample figures are illustrative and labeled; real aggregates are passed
 * in as props by the sections that own them.
 */

const TOOLTIP_STYLE = {
    background: "var(--card)",
    border: "1px solid var(--border-color)",
    borderRadius: 12,
    color: "var(--foreground)",
    fontSize: 12,
} as const;

/** Sample engine scores (0–100) — illustrative. */
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

/** Sample per-trade outcomes (%) — illustrative. */
const SAMPLE_RETURNS = [2.4, -1.2, 3.1, 0.8, -0.6, 4.2, -2.1, 1.5, 2.8, -0.9, 1.1, 3.6, -1.5, 2.2].map(
    (r, i) => ({ trade: `T${i + 1}`, ret: r }),
);

const LIFECYCLE = ["NEW", "PENDING_ENTRY", "ENTRY_TRIGGERED", "TP_REACHED", "CLOSED"] as const;
const TERMINAL = ["STOPPED_OUT", "EXPIRED", "CANCELLED", "INVALIDATED"] as const;

const RISK_CHECKS = [
    { label: "Daily loss limit", detail: "2% of balance" },
    { label: "Drawdown guard", detail: "Armed" },
    { label: "Position sizing", detail: "1% risk" },
    { label: "Gateway heartbeat", detail: "Checked pre-trade" },
] as const;

const TELEMETRY: Array<[string, string, string]> = [
    ["Gateway heartbeat", "LIVE", "text-positive"],
    ["Data feed", "LIVE", "text-positive"],
    ["Drawdown guard", "Armed", "text-warning"],
];

export function EngineBars() {
    const reduceMotion = useReducedMotion();
    return (
        <Card className="flex flex-col border-border/40 shadow-sm">
            <CardHeader className="items-center pb-0">
                <CardTitle className="text-sm font-semibold">Engine Scores</CardTitle>
                <CardDescription className="text-[8px]">Sample scores — the eight engines run on live candles inside the product.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 pb-0">
                <ChartContainer
                    config={{ score: { label: "Score", color: "#3b82f6" } } }
                    className="mx-auto aspect-square max-h-[240px]"
                >
                    <RadialBarChart data={ENGINE_SCORES} innerRadius={30} outerRadius={90} startAngle={0} endAngle={270}>
                        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                        <PolarGrid gridType="circle" strokeWidth={0} />
                        <RadialBar dataKey="score" background cornerRadius={8} />
                    </RadialBarChart>
                </ChartContainer>
            </CardContent>
            <CardFooter className="flex-col gap-1 text-[8px]">
                <div className="flex items-center gap-1 leading-none font-medium">
                    Higher scores = stronger signals <TrendingUp className="h-3 w-3" />
                </div>
                <div className="leading-none text-muted-foreground">
                    Sample scores — the eight engines run on live candles inside the product.
                </div>
            </CardFooter>
        </Card>
    );
}

export function ReturnsHistogram() {
    const chartData = [
        { month: "Jan", desktop: 186 },
        { month: "Feb", desktop: 305 },
        { month: "Mar", desktop: 237 },
        { month: "Apr", desktop: 273 },
        { month: "May", desktop: 209 },
        { month: "Jun", desktop: 214 },
    ]
    const chartConfig = {
        desktop: {
            label: "Return %",
            color: "#3b82f6",
        },
    } satisfies ChartConfig
    return (
        <Card className="border-border/40 shadow-sm">
            <CardHeader className="items-center pb-2 pt-4">
                <CardTitle className="text-sm font-semibold">Trade Outcomes</CardTitle>
                <CardDescription className="text-[8px]">Sample returns (radar view)</CardDescription>
            </CardHeader>
            <CardContent className="pb-0">
                <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[240px]">
                    <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="80%">
                        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                        <PolarAngleAxis dataKey="month" tick={{ fontSize: 10 }} />
                        <PolarGrid />
                        <Radar dataKey="desktop" fill="#3b82f6" fillOpacity={0.6} dot={{ r: 3, fillOpacity: 1 }} />
                    </RadarChart>
                </ChartContainer>
            </CardContent>
        </Card>
    );
}

export function SignalLifecycle() {
    return (
        <div>
            <p className="text-[8px] font-bold uppercase tracking-widest text-foreground">Active path</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
                {LIFECYCLE.map((s) => (
                    <span key={s} className="inline-flex items-center rounded-full bg-neutral-950 px-2.5 py-0.5 text-[8px] font-extrabold text-white shadow-sm dark:bg-white dark:text-black">
                        {s}
                    </span>
                ))}
            </div>
            <p className="mt-4 text-[8px] font-bold uppercase tracking-widest text-muted-foreground">Terminal states</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
                {TERMINAL.map((s) => (
                    <span key={s} className="inline-flex items-center rounded-full bg-neutral-800 px-2.5 py-0.5 text-[8px] font-extrabold text-neutral-200 shadow-sm dark:bg-neutral-200 dark:text-neutral-800">
                        {s}
                    </span>
                ))}
            </div>
            <p className="mt-4 flex items-start gap-2 text-[8px] leading-5 text-muted-foreground">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-foreground/60" aria-hidden />
                Outcomes are decided deterministically — TP/SL hits, never AI narrative.
            </p>
        </div>
    );
}

export function RiskMini() {
    return (
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
    );
}

export function TelemetryMini() {
    return (
        <ul className="space-y-1.5">
            {TELEMETRY.map(([k, v, tone]) => (
                <li key={k} className="flex items-center justify-between rounded-xl border border-border/30 bg-card px-3 py-2 shadow-sm">
                    <span className="text-[11px] font-medium text-foreground">{k}</span>
                    <span className="inline-flex rounded-full bg-neutral-950 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-sm dark:bg-white dark:text-black">{v}</span>
                </li>
            ))}
        </ul>
    );
}