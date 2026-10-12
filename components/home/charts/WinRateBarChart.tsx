"use client";

import { CSSProperties } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import {
    Card,
    CardContent,
    CardHeader,
} from "@/components/ui/card";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

const CHART_COLORS = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
];

const chartConfig = {
    winRate: { label: "Win rate" },
} satisfies ChartConfig;

/**
 * Recorded win rate per listed strategy — a horizontal bar so long names stay
 * readable. ReUI chart pattern "vertical (horizontal) bar chart" (`c-chart-12`),
 * fed only by strategies that carry a recorded win rate.
 */
export default function WinRateBarChart({
    data,
    height,
    className,
}: {
    data: Array<{ name: string; winRate: number }>;
    height?: number;
    className?: string;
}) {
    const reduced = usePrefersReducedMotion();
    const rows = data.length;
    const resolvedHeight = height ?? Math.max(160, rows * 46 + 24);

    return (
        <Card className={className}>
            <CardHeader className="border-b border-border">
                <p className="text-xs font-medium text-primary">Marketplace performance</p>
                <h3 className="mt-2 text-lg font-semibold text-foreground">
                    Recorded win rate by listed strategy
                </h3>
            </CardHeader>
            <CardContent>
                <ChartContainer
                    config={chartConfig}
                    className="aspect-auto w-full"
                    style={{ height: resolvedHeight }}
                    role="img"
                    aria-label="Recorded win rate by listed strategy"
                >
                    <BarChart
                        accessibilityLayer
                        data={data}
                        layout="vertical"
                        margin={{ top: 4, right: 40, bottom: 4, left: 8 }}
                        barCategoryGap="24%"
                    >
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                        <XAxis
                            type="number"
                            domain={[0, 100]}
                            tickLine={false}
                            axisLine={false}
                            tickMargin={6}
                            tickFormatter={(value: number) => `${value}%`}
                        />
                        <YAxis
                            type="category"
                            dataKey="name"
                            width={128}
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            tick={{ fontSize: 12 }}
                        />
                        <ReferenceLine x={50} stroke="var(--border)" />
                        <ChartTooltip
                            cursor={false}
                            content={
                                <ChartTooltipContent
                                    indicator="dot"
                                    className="min-w-32 gap-2.5"
                                    hideLabel
                                    formatter={(value) => (
                                        <div className="flex w-full items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5">
                                                <div
                                                    className="h-2.5 w-2.5 shrink-0 rounded-xs bg-(--color-bg)"
                                                    style={{ "--color-bg": "var(--chart-1)" } as CSSProperties}
                                                />
                                                <span className="text-muted-foreground">Win rate</span>
                                            </div>
                                            <span className="text-foreground font-semibold tabular-nums">
                                                {Number(value).toFixed(1)}%
                                            </span>
                                        </div>
                                    )}
                                />
                            }
                        />
                        <Bar
                            dataKey="winRate"
                            radius={[0, 4, 4, 0]}
                            isAnimationActive={!reduced}
                        >
                            {data.map((row, index) => (
                                <Cell
                                    key={`${row.name}-${index}`}
                                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ChartContainer>
            </CardContent>
        </Card>
    );
}
