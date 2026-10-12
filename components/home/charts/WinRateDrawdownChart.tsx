"use client";

import { CSSProperties } from "react";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { Gauge, ShieldCheck } from "lucide-react";
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
    winRate: { label: "Win rate", color: "var(--primary)" },
    maxDrawdown: { label: "Max drawdown", color: "var(--negative)" },
} satisfies ChartConfig;

/**
 * Win rate line over a striped max-drawdown zone, per recorded run. ReUI chart
 * pattern "forecast line chart with stripe pattern zone" (`c-chart-17`) — both
 * series are percentages, so the shared 0–100 axis is honest.
 */
export default function WinRateDrawdownChart({
    data,
    height = 248,
    className,
}: {
    data: Array<{ label: string; winRate: number; maxDrawdown: number }>;
    height?: number;
    className?: string;
}) {
    const reduced = usePrefersReducedMotion();

    return (
        <Card className={className}>
            <CardHeader className="border-b border-border">
                <p className="text-xs font-medium text-primary">Risk profile</p>
                <h3 className="mt-2 text-lg font-semibold text-foreground">
                    Win rate vs max drawdown per run
                </h3>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-center">
                <ChartContainer
                    config={chartConfig}
                    className="aspect-auto w-full"
                    style={{ height }}
                    role="img"
                    aria-label="Win rate line against max drawdown per recorded run"
                >
                    <ComposedChart
                        accessibilityLayer
                        data={data}
                        margin={{ top: 16, right: 8, bottom: 0, left: 0 }}
                    >
                        <defs>
                            <pattern
                                id="home-drawdown-stripe"
                                patternUnits="userSpaceOnUse"
                                width="6"
                                height="6"
                            >
                                <rect width="6" height="6" fill="var(--negative)" opacity="0.04" />
                                <path
                                    d="M0,6 L6,0"
                                    stroke="var(--negative)"
                                    strokeWidth="0.8"
                                    opacity="0.18"
                                />
                            </pattern>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            domain={[0, 100]}
                            width={44}
                            tickLine={false}
                            axisLine={false}
                            tickMargin={4}
                            tickFormatter={(value: number) => `${Math.round(value)}%`}
                        />
                        <ChartTooltip
                            cursor={false}
                            content={
                                <ChartTooltipContent
                                    indicator="dot"
                                    className="min-w-40 gap-2.5"
                                    formatter={(value, name) => (
                                        <div className="flex w-full items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5">
                                                <div
                                                    className="h-2.5 w-2.5 shrink-0 rounded-xs bg-(--color-bg)"
                                                    style={
                                                        {
                                                            "--color-bg": `var(--color-${name})`,
                                                        } as CSSProperties
                                                    }
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
                        <Area
                            dataKey="maxDrawdown"
                            type="natural"
                            fill="url(#home-drawdown-stripe)"
                            stroke="none"
                            isAnimationActive={!reduced}
                        />
                        <Line
                            dataKey="winRate"
                            type="natural"
                            stroke="var(--color-winRate)"
                            strokeWidth={2.5}
                            dot={false}
                            isAnimationActive={!reduced}
                        />
                    </ComposedChart>
                </ChartContainer>
            </CardContent>
            <CardFooter className="justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                    <Gauge size={14} className="text-primary" aria-hidden />
                    Win rate
                </span>
                <span className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-negative" aria-hidden />
                    Max drawdown
                </span>
            </CardFooter>
        </Card>
    );
}
