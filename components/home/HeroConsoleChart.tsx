"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, YAxis } from "recharts";
import { Activity } from "lucide-react";

const TOTAL = 30;
const START = 4;

// Deterministic route for the demo curve — smooth, stable, monotone-friendly.
const SERIES = Array.from({ length: TOTAL }, (_, i) => {
    const base = i * 0.85;
    const wave = Math.sin(i / 3.4) * 1.6 + Math.cos(i / 1.9) * 0.7;
    const breakout = i > 20 ? (i - 20) * 0.55 : 0;
    return {
        idx: i,
        equity: Math.round((100 + base + wave + breakout) * 100) / 100,
    };
});

function formatUsd(value: number): string {
    return value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

export default function HeroConsoleChart() {
    const [progress, setProgress] = useState(TOTAL);

    useEffect(() => {
        if (
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
            return;
        }
        const id = setInterval(() => {
            setProgress((p) => (p >= TOTAL ? START : p + 1));
        }, 240);
        return () => clearInterval(id);
    }, []);

    const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const data = useMemo(() => SERIES.slice(0, progress), [progress]);

    const last = data[data.length - 1]?.equity ?? 100;
    const first = data[0]?.equity ?? 100;
    const delta = ((last - first) / first) * 100;

    return (
        <div className="border-t border-border px-4 py-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                    <Activity size={14} className="text-positive" />
                    Equity curve
                </span>
                <span className="flex items-center gap-3">
                    <span className="font-mono text-foreground">{formatUsd(last)}</span>
                    <span className="font-semibold text-positive">
                        {delta >= 0 ? "+" : ""}
                        {delta.toFixed(1)}%
                    </span>
                </span>
            </div>

            <div className="mt-2 h-24">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="heroEquityGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--positive)" stopOpacity={0.28} />
                                <stop offset="100%" stopColor="var(--positive)" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid
                            stroke="var(--border)"
                            strokeDasharray="3 3"
                            strokeOpacity={0.35}
                            vertical={false}
                        />
                        <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
                        <Area
                            type="monotone"
                            dataKey="equity"
                            stroke="var(--positive)"
                            strokeWidth={1.75}
                            fill="url(#heroEquityGradient)"
                            dot={false}
                            isAnimationActive={!reduceMotion}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            <div className="mt-1 flex items-center justify-between text-micro text-muted-foreground">
                <span>Paper simulation · deterministic route</span>
                <span className="text-positive/80">{progress}/{TOTAL} bars</span>
            </div>
        </div>
    );
}