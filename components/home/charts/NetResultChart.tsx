"use client";

import { CSSProperties } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/reui/badge";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { formatCompactUsd, formatSignedUsd } from "./format";

const chartConfig = {
    netProfit: { label: "Net result", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * Net result per recorded run, colour split by sign (positive / negative keep
 * their trading meaning, DESIGN.md §17). ReUI chart pattern "gradient bar
 * chart" (`c-chart-7`), with the sign carried by token colour, not the gradient
 * alone.
 */
export default function NetResultChart({
    data,
    height = 224,
    className,
}: {
    data: Array<{ label: string; netProfit: number }>;
    height?: number;
    className?: string;
}) {
    const reduced = usePrefersReducedMotion();
    const total = data.reduce((sum, run) => sum + run.netProfit, 0);
    const positive = total >= 0;

    return (
        <Card className={className}>
            <CardHeader className="border-b border-border">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs font-medium text-primary">Net result</p>
                        <h3 className="mt-2 text-lg font-semibold text-foreground">
                            Net result per recorded run
                        </h3>
                    </div>
                    <Badge
                        variant={positive ? "success-light" : "destructive-light"}
                        radius="full"
                        className="shrink-0 font-numeric tabular-nums"
                    >
                        {formatSignedUsd(Math.round(total))}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-center">
                <ChartContainer
                    config={chartConfig}
                    className="aspect-auto w-full"
                    style={{ height }}
                    role="img"
                    aria-label="Net result per recorded run"
                >
                    <BarChart
                        accessibilityLayer
                        data={data}
                        margin={{ top: 16, right: 8, bottom: 0, left: 0 }}
                        barCategoryGap="18%"
                    >
                        <defs>
                            <linearGradient id="home-net-pos" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--positive)" stopOpacity={0.95} />
                                <stop offset="100%" stopColor="var(--positive)" stopOpacity={0.35} />
                            </linearGradient>
                            <linearGradient id="home-net-neg" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--negative)" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="var(--negative)" stopOpacity={0.95} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            interval={0}
                        />
                        <YAxis
                            width={56}
                            tickLine={false}
                            axisLine={false}
                            tickMargin={4}
                            tickFormatter={(value: number) => formatCompactUsd(value)}
                        />
                        <ReferenceLine y={0} stroke="var(--border)" />
                        <ChartTooltip
                            cursor={false}
                            content={
                                <ChartTooltipContent
                                    indicator="dot"
                                    className="min-w-40 gap-2.5"
                                    formatter={(value) => {
                                        const numeric = Number(value);
                                        return (
                                            <div className="flex w-full items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5">
                                                    <div
                                                        className="h-2.5 w-2.5 shrink-0 rounded-xs bg-(--color-bg)"
                                                        style={
                                                            {
                                                                "--color-bg": numeric >= 0 ? "var(--positive)" : "var(--negative)",
                                                            } as CSSProperties
                                                        }
                                                    />
                                                    <span className="text-muted-foreground">Net result</span>
                                                </div>
                                                <span className="text-foreground font-semibold tabular-nums">
                                                    {formatSignedUsd(Math.round(numeric))}
                                                </span>
                                            </div>
                                        );
                                    }}
                                />
                            }
                        />
                        <Bar
                            dataKey="netProfit"
                            radius={[4, 4, 0, 0]}
                            isAnimationActive={!reduced}
                        >
                            {data.map((run, index) => (
                                <Cell
                                    key={`${run.label}-${index}`}
                                    fill={run.netProfit >= 0 ? "url(#home-net-pos)" : "url(#home-net-neg)"}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ChartContainer>
            </CardContent>
            <CardFooter className="justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-xs bg-positive" aria-hidden />
                    Closed positive
                </span>
                <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-xs bg-negative" aria-hidden />
                    Closed negative
                </span>
            </CardFooter>
        </Card>
    );
}
