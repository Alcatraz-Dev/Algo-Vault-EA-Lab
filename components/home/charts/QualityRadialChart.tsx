"use client";

import { CSSProperties } from "react";
import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts";
import { Activity, Target } from "lucide-react";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
} from "@/components/ui/card";
import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

const chartConfig = {
    value: { label: "Score" },
    winRate: { label: "Avg win rate", color: "var(--primary)" },
    positiveShare: { label: "Positive share", color: "var(--positive)" },
} satisfies ChartConfig;

/**
 * Average win rate and share of positive runs as radial gauges. ReUI chart
 * pattern "radial scores" (`c-chart-25`) — both values are recorded aggregates
 * out of 100.
 */
export default function QualityRadialChart({
    avgWinRate,
    positiveShare,
    className,
}: {
    avgWinRate: number;
    positiveShare: number;
    className?: string;
}) {
    const reduced = usePrefersReducedMotion();
    const data = [
        { key: "winRate", name: "Avg win rate", value: Math.max(0, Math.min(100, avgWinRate)), fill: "url(#home-radial-winrate)" },
        { key: "positiveShare", name: "Positive share", value: Math.max(0, Math.min(100, positiveShare)), fill: "url(#home-radial-positive)" },
    ];

    return (
        <Card className={className}>
            <CardHeader className="border-b border-border">
                <p className="text-xs font-medium text-primary">Performance score</p>
                <h3 className="mt-2 text-lg font-semibold text-foreground">
                    Win rate &amp; positive-run share
                </h3>
            </CardHeader>
            <CardContent className="flex flex-1 items-center justify-center">
                <ChartContainer
                    config={chartConfig}
                    className="mx-auto aspect-square h-[236px] w-[236px] shrink-0"
                    role="img"
                    aria-label="Average win rate and share of positive runs shown as gauges"
                >
                    <RadialBarChart
                        data={data}
                        innerRadius={34}
                        outerRadius={104}
                        barSize={18}
                    >
                        <defs>
                            <linearGradient id="home-radial-winrate" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.45} />
                                <stop offset="100%" stopColor="var(--primary)" stopOpacity={1} />
                            </linearGradient>
                            <linearGradient id="home-radial-positive" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor="var(--positive)" stopOpacity={0.45} />
                                <stop offset="100%" stopColor="var(--positive)" stopOpacity={1} />
                            </linearGradient>
                        </defs>
                        <ChartTooltip
                            content={
                                <ChartTooltipContent
                                    className="min-w-40 gap-2.5"
                                    nameKey="key"
                                    formatter={(value, name) => (
                                        <div className="flex w-full items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5">
                                                <div
                                                    className="h-2.5 w-2.5 shrink-0 rounded-xs bg-(--color-bg)"
                                                    style={{ "--color-bg": `var(--color-${name})` } as CSSProperties}
                                                />
                                                <span className="text-muted-foreground">
                                                    {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                                                </span>
                                            </div>
                                            <span className="text-foreground font-semibold tabular-nums">
                                                {Number(value).toFixed(1)}%
                                            </span>
                                        </div>
                                    )}
                                />
                            }
                        />
                        <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                        <RadialBar
                            dataKey="value"
                            background
                            cornerRadius={8}
                            isAnimationActive={!reduced}
                        />
                        <ChartLegend
                            content={<ChartLegendContent nameKey="key" />}
                        />
                    </RadialBarChart>
                </ChartContainer>
            </CardContent>
            <CardFooter className="justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                    <Target size={14} className="text-primary" aria-hidden />
                    Avg win rate
                </span>
                <span className="flex items-center gap-2">
                    <Activity size={14} className="text-positive" aria-hidden />
                    Positive share
                </span>
            </CardFooter>
        </Card>
    );
}
