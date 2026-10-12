"use client";

import { CSSProperties } from "react";
import { Cell, Label, Pie, PieChart } from "recharts";
import { Activity, PieChart as PieIcon } from "lucide-react";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
} from "@/components/ui/card";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

const chartConfig = {
    count: { label: "Runs" },
    positive: { label: "Positive runs", color: "var(--positive)" },
    rest: { label: "Rest of analyzed", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

/**
 * Positive vs rest of analyzed runs. ReUI chart pattern "donut with center
 * total" (`c-chart-19`); the centre reads the recorded run count, never a
 * invented figure.
 */
export default function OutcomeSplitChart({
    positive,
    rest,
    total,
    className,
}: {
    positive: number;
    rest: number;
    total: number;
    className?: string;
}) {
    const reduced = usePrefersReducedMotion();
    const data = [
        { key: "positive", value: positive, fill: "url(#home-outcome-positive)" },
        { key: "rest", value: rest, fill: "url(#home-outcome-rest)" },
    ];

    return (
        <Card className={className}>
            <CardHeader className="border-b border-border">
                <p className="text-xs font-medium text-primary">Outcome split</p>
                <h3 className="mt-2 text-lg font-semibold text-foreground">
                    Positive vs rest of analyzed runs
                </h3>
            </CardHeader>
            <CardContent className="flex flex-1 items-center justify-center">
                <ChartContainer
                    config={chartConfig}
                    className="mx-auto aspect-square h-[248px] w-[248px] shrink-0"
                    role="img"
                    aria-label="Share of analyzed runs that closed positive"
                >
                    <PieChart accessibilityLayer>
                        <defs>
                            <linearGradient id="home-outcome-positive" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--positive)" stopOpacity={1} />
                                <stop offset="100%" stopColor="var(--positive)" stopOpacity={0.75} />
                            </linearGradient>
                            <linearGradient id="home-outcome-rest" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--muted-foreground)" stopOpacity={0.9} />
                                <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity={0.55} />
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
                                                {Number(value).toLocaleString()}
                                            </span>
                                        </div>
                                    )}
                                />
                            }
                        />
                        <Pie
                            data={data}
                            dataKey="value"
                            nameKey="key"
                            innerRadius={62}
                            outerRadius={92}
                            cornerRadius={8}
                            paddingAngle={4}
                            stroke="var(--background)"
                            strokeWidth={4}
                            isAnimationActive={!reduced}
                        >
                            {data.map((entry) => (
                                <Cell key={entry.key} fill={entry.fill} />
                            ))}
                            <Label
                                content={({ viewBox }) => {
                                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                                        return (
                                            <text
                                                x={viewBox.cx}
                                                y={viewBox.cy}
                                                textAnchor="middle"
                                                dominantBaseline="middle"
                                            >
                                                <tspan
                                                    x={viewBox.cx}
                                                    y={viewBox.cy}
                                                    className="fill-foreground font-numeric text-3xl font-bold tabular-nums"
                                                >
                                                    {total.toLocaleString()}
                                                </tspan>
                                                <tspan
                                                    x={viewBox.cx}
                                                    y={(viewBox.cy || 0) + 22}
                                                    className="fill-muted-foreground text-xs"
                                                >
                                                    Runs analyzed
                                                </tspan>
                                            </text>
                                        );
                                    }
                                    return null;
                                }}
                            />
                        </Pie>
                    </PieChart>
                </ChartContainer>
            </CardContent>
            <CardFooter className="justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                    <PieIcon size={14} className="text-positive" aria-hidden />
                    Positive runs
                </span>
                <span className="flex items-center gap-2">
                    <Activity size={14} className="text-muted-foreground" aria-hidden />
                    Rest of analyzed
                </span>
            </CardFooter>
        </Card>
    );
}
