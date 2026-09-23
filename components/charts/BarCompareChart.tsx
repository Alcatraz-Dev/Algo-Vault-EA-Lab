"use client";

import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

export default function BarCompareChart({
    data,
    xKey = "label",
    valueKey = "value",
    colorVar = "var(--chart-1)",
    height = 260,
    formatValue,
    cellColors,
}: {
    data: Record<string, unknown>[];
    xKey?: string;
    valueKey?: string;
    colorVar?: string;
    height?: number;
    formatValue?: (v: number) => string;
    cellColors?: (entry: Record<string, unknown>, index: number) => string;
}) {
    return (
        <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data}>
                <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                    strokeOpacity={0.5}
                    vertical={false}
                />

                <XAxis
                    dataKey={xKey}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                />

                <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={60}
                    tickFormatter={(v) => Number(v).toLocaleString()}
                />

                <Tooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                    contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        color: "var(--foreground)",
                        fontSize: 13,
                    }}
                    labelStyle={{ color: "var(--muted-foreground)", marginBottom: 4 }}
                    formatter={(value: unknown) =>
                        formatValue
                            ? formatValue(Number(value))
                            : Number(value).toLocaleString()
                    }
                />

                <Bar dataKey={valueKey} radius={[6, 6, 0, 0]} maxBarSize={48}>
                    {data.map((entry, i) => (
                        <Cell
                            key={i}
                            fill={cellColors ? cellColors(entry, i) : colorVar}
                        />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}