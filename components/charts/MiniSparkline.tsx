"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";

export default function MiniSparkline({
    values,
    colorVar = "var(--chart-1)",
    height = 40,
}: {
    values: number[];
    colorVar?: string;
    height?: number;
}) {
    if (values.length < 2) {
        return (
            <div
                className="flex items-end justify-start gap-[2px]"
                style={{ height }}
            >
                {values.map((v, i) => (
                    <div
                        key={i}
                        className="w-[3px] rounded-full"
                        style={{
                            height: "100%",
                            background: colorVar,
                            opacity: 0.25,
                        }}
                    />
                ))}
            </div>
        );
    }

    const data = values.map((value, index) => ({ index, value }));

    return (
        <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                    <linearGradient id={`spark-${colorVar}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colorVar} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={colorVar} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <Area
                    type="monotone"
                    dataKey="value"
                    stroke={colorVar}
                    strokeWidth={1.5}
                    fill={`url(#spark-${colorVar})`}
                    isAnimationActive={false}
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}