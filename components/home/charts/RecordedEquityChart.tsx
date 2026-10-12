"use client";

import { CSSProperties } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Sigma } from "lucide-react";
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
import { formatCompactUsd, formatSignedUsd } from "./format";

const chartConfig = {
    equity: { label: "Equity", color: "var(--primary)" },
} satisfies ChartConfig;

/**
 * Cumulative equity across the recorded runs — the account-backtest style curve.
 * ReUI chart pattern "gradient area with glowing dot markers" (`c-chart-16`),
 * wired to real recorded figures only.
 */
export default function RecordedEquityChart({
    data,
    height = 224,
    className,
}: {
    data: Array<{ label: string; equity: number }>;
    height?: number;
    className?: string;
}) {
    const reduced = usePrefersReducedMotion();

    return (
        <Card className={className}>
            <CardHeader className="border-b border-border">
                <p className="text-xs font-medium text-primary">Equity curve</p>
                <h3 className="mt-2 text-lg font-semibold text-foreground">
                    Cumulative equity across recorded runs
                </h3>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-center">
                <ChartContainer
                    config={chartConfig}
                    className="aspect-auto w-full"
                    style={{ height }}
                    role="img"
                    aria-label="Cumulative equity across recorded backtests"
                >
                    <AreaChart
                        accessibilityLayer
                        data={data}
                        margin={{ top: 16, right: 8, bottom: 0, left: 0 }}
                    >
                        <defs>
                            <linearGradient id="home-equity-fill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="var(--color-equity)" stopOpacity={0.35} />
                                <stop offset="95%" stopColor="var(--color-equity)" stopOpacity={0} />
                            </linearGradient>
                            <filter id="home-equity-line-glow" x="-10%" y="-20%" width="120%" height="140%">
                                <feGaussianBlur stdDeviation="6" result="blur" />
                                <feComposite in="SourceGraphic" in2="blur" operator="over" />
                            </filter>
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
                            width={56}
                            tickLine={false}
                            axisLine={false}
                            tickMargin={4}
                            tickFormatter={(value: number) => formatCompactUsd(value)}
                        />
                        <ChartTooltip
                            cursor={false}
                            content={
                                <ChartTooltipContent
                                    indicator="dot"
                                    className="min-w-40 gap-2.5"
                                    formatter={(value) => (
                                        <div className="flex w-full items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5">
                                                <div
                                                    className="h-2.5 w-2.5 shrink-0 rounded-xs bg-(--color-bg)"
                                                    style={{ "--color-bg": "var(--color-equity)" } as CSSProperties}
                                                />
                                                <span className="text-muted-foreground">Equity</span>
                                            </div>
                                            <span className="text-foreground font-semibold tabular-nums">
                                                {formatSignedUsd(Math.round(Number(value)))}
                                            </span>
                                        </div>
                                    )}
                                />
                            }
                        />
                        <Area
                            dataKey="equity"
                            type="natural"
                            fill="url(#home-equity-fill)"
                            stroke="var(--color-equity)"
                            strokeWidth={2}
                            filter="url(#home-equity-line-glow)"
                            isAnimationActive={!reduced}
                            dot={{
                                r: 3.5,
                                fill: "var(--color-equity)",
                                strokeWidth: 2,
                                stroke: "var(--background)",
                            }}
                            activeDot={{ r: 6, strokeWidth: 3, stroke: "var(--background)" }}
                        />
                    </AreaChart>
                </ChartContainer>
            </CardContent>
            <CardFooter className="gap-2 text-xs text-muted-foreground">
                <Sigma size={14} className="text-primary" aria-hidden />
                Cumulative net of spread, slippage and commission — deterministic simulation
            </CardFooter>
        </Card>
    );
}
