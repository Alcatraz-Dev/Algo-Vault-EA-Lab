"use client";

import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

export default function MiniSparkline({
    values,
    colorVar = "var(--chart-1)",
    height = 40,
    animate = false,
}: {
    values: number[];
    colorVar?: string;
    height?: number;
    /** Draw/morph the area on mount and on data changes instead of snapping. */
    animate?: boolean;
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
    // `colorVar` is a CSS variable ("var(--chart-1)"), which is not a legal
    // url(#…) fragment — slugify it so the gradient reference always resolves.
    const gradientId = `spark-${colorVar.replace(/[^a-zA-Z0-9]+/g, "-")}`;
    // Recharts otherwise defaults the y domain to [0, max], which flattens any
    // series whose values live far from zero (prices, equity…). Fit the domain
    // to the data with a little headroom so the shape of the run is visible.
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low || Math.max(Math.abs(high) * 0.001, 1e-9);

    return (
        <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colorVar} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={colorVar} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <YAxis hide domain={[low - span * 0.15, high + span * 0.15]} />
                <Area
                    type="monotone"
                    dataKey="value"
                    stroke={colorVar}
                    strokeWidth={1.5}
                    fill={`url(#${gradientId})`}
                    isAnimationActive={animate}
                    animationDuration={600}
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}