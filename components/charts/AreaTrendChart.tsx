"use client";

import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    XAxis,
    YAxis,
} from "recharts";
import { ReactNode } from "react";
import { ChartTooltip } from "@/components/charts/ChartTooltip";

export type SeriesConfig = {
    key: string;
    label: string;
    colorVar?: string;
    prefix?: string;
    suffix?: string;
};

export default function AreaTrendChart({
    data,
    xKey = "label",
    series,
    height = 280,
    formatXAxis,
}: {
    data: Record<string, unknown>[];
    xKey?: string;
    series: SeriesConfig[];
    height?: number;
    formatXAxis?: (v: ReactNode) => string;
}) {
    const palette = [
        "var(--chart-1)",
        "var(--chart-2)",
        "var(--chart-3)",
        "var(--chart-4)",
        "var(--chart-5)",
    ];

    return (
        <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data}>
                <defs>
                    {series.map((s, i) => (
                        <linearGradient
                            key={s.key}
                            id={`${s.key}Gradient`}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                        >
                            <stop
                                offset="5%"
                                stopColor={s.colorVar || palette[i % palette.length]}
                                stopOpacity={0.35}
                            />
                            <stop
                                offset="95%"
                                stopColor={s.colorVar || palette[i % palette.length]}
                                stopOpacity={0}
                            />
                        </linearGradient>
                    ))}
                </defs>

                <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border-color)"
                    strokeOpacity={0.5}
                />

                <XAxis
                    dataKey={xKey}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={formatXAxis}
                />

                <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={60}
                    tickFormatter={(v) => Number(v).toLocaleString()}
                />

                <ChartTooltip labelFormatter={formatXAxis} itemStyle={{ padding: 0 }} />

                {series.map((s, i) => (
                    <Area
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.label}
                        stroke={s.colorVar || palette[i % palette.length]}
                        strokeWidth={2}
                        fill={`url(#${s.key}Gradient)`}
                    />
                ))}
            </AreaChart>
        </ResponsiveContainer>
    );
}