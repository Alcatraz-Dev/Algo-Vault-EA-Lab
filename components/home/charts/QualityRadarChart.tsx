"use client";

import { CSSProperties } from "react";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart } from "recharts";
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

const chartConfig = {
    value: { label: "Score", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * Recorded quality across a fixed set of measures, every one a share out of
 * 100 derived from the aggregates. ReUI chart pattern "radar chart with
 * gradient fill" (`c-chart-23`).
 */
export default function QualityRadarChart({
    data,
    className,
}: {
    data: Array<{ metric: string; value: number }>;
    className?: string;
}) {
    const reduced = usePrefersReducedMotion();

    return (
        <Card className={className}>
            <CardHeader className="border-b border-border">
                <p className="text-xs font-medium text-primary">Metric balance</p>
                <h3 className="mt-2 text-lg font-semibold text-foreground">
                    Where the recorded edge holds
                </h3>
            </CardHeader>
            <CardContent className="flex flex-1 items-center justify-center">
                <ChartContainer
                    config={chartConfig}
                    className="mx-auto aspect-square h-[248px] w-[248px] shrink-0"
                    role="img"
                    aria-label="Recorded quality measures shown as a radar"
                >
                    <RadarChart accessibilityLayer data={data} outerRadius="72%">
                        <defs>
                            <linearGradient id="home-radar-fill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.5} />
                                <stop offset="100%" stopColor="var(--color-value)" stopOpacity={0.08} />
                            </linearGradient>
                            <filter id="home-radar-glow" x="-20%" y="-20%" width="140%" height="140%">
                                <feGaussianBlur stdDeviation="5" result="blur" />
                                <feComposite in="SourceGraphic" in2="blur" operator="over" />
                            </filter>
                        </defs>
                        <ChartTooltip
                            content={
                                <ChartTooltipContent
                                    className="min-w-32 gap-2.5"
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
                                                {Number(value).toFixed(0)}/100
                                            </span>
                                        </div>
                                    )}
                                />
                            }
                        />
                        <PolarGrid strokeDasharray="3 3" />
                        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar
                            dataKey="value"
                            fill="url(#home-radar-fill)"
                            stroke="var(--color-value)"
                            strokeWidth={2}
                            filter="url(#home-radar-glow)"
                            isAnimationActive={!reduced}
                            dot={{ r: 3.5, fill: "var(--color-value)", strokeWidth: 0 }}
                        />
                    </RadarChart>
                </ChartContainer>
            </CardContent>
        </Card>
    );
}
