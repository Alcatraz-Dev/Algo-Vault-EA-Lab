"use client";

/**
 * TEMPORARY visual-QA page for the new dashboard command-centre widgets.
 * Deleted after verification — not part of the shipped routes.
 */

import {
    ConfidenceView,
    SignalCoreView,
    WIDGET_SPEC_BY_TYPE,
    WidgetBody,
    defaultWidgetConfig,
} from "@/components/dashboard/widgets";
import LiveCandlesPanel from "@/components/dashboard/LiveCandlesPanel";
import LevelBars from "@/components/charts/LevelBars";
import MiniSparkline from "@/components/charts/MiniSparkline";
import CountUp from "@/components/charts/CountUp";

const NEW_TYPES = ["signal_core", "confidence_meter", "live_chart", "mtf_bias"];

const bearishScore = {
    total: 34,
    bias: "bearish" as const,
    confidence: "medium" as const,
    components: [
        { name: "Structure", value: -18, max: 18, direction: "bearish" as const },
        { name: "Momentum", value: -7, max: 16, direction: "bearish" as const },
        { name: "Liquidity", value: 0, max: 12, direction: "neutral" as const },
        { name: "Volume", value: -10, max: 10, direction: "bearish" as const },
        { name: "VWAP", value: 8, max: 8, direction: "bullish" as const },
        { name: "Zones", value: 14, max: 14, direction: "bullish" as const },
    ],
    timestamp: Date.now() - 120_000,
};

const bullishScore = {
    total: 78,
    bias: "bullish" as const,
    confidence: "high" as const,
    components: [
        { name: "Structure", value: 18, max: 18, direction: "bullish" as const },
        { name: "Momentum", value: 12, max: 16, direction: "bullish" as const },
        { name: "Liquidity", value: 12, max: 12, direction: "bullish" as const },
        { name: "Volume", value: 10, max: 10, direction: "bullish" as const },
        { name: "VWAP", value: 0, max: 8, direction: "neutral" as const },
        { name: "Zones", value: -14, max: 14, direction: "bearish" as const },
    ],
    timestamp: Date.now() - 45_000,
};

const liquidityItems = [
    { id: "1", label: "Equal highs", value: 92, right: "2,411.80", colorVar: "var(--chart-1)", hint: "High-side pool · strength 92" },
    { id: "2", label: "Previous day high", value: 74, right: "2,408.15", colorVar: "var(--chart-1)", hint: "High-side pool · strength 74" },
    { id: "3", label: "Swing high", value: 55, right: "2,404.60", colorVar: "var(--chart-1)", hint: "High-side pool · strength 55" },
    { id: "4", label: "Equal lows", value: 88, right: "2,389.40", colorVar: "var(--chart-2)", hint: "Low-side pool · strength 88" },
    { id: "5", label: "Session low", value: 61, right: "2,392.05", colorVar: "var(--chart-2)", hint: "Low-side pool · strength 61" },
    { id: "6", label: "Swing low", value: 40, right: "2,395.70", colorVar: "var(--chart-2)", hint: "Low-side pool · strength 40" },
];

const mtfRows = [
    { tf: "M15", values: [2401, 2402, 2400, 2399, 2401, 2403, 2402, 2400, 2398, 2397, 2399, 2398], bias: "bearish" as const, total: 41 },
    { tf: "H1", values: [2395, 2397, 2399, 2401, 2400, 2398, 2397, 2399, 2398, 2396, 2395, 2397], bias: "neutral" as const, total: 52 },
    { tf: "H4", values: [2380, 2384, 2388, 2391, 2394, 2397, 2400, 2399, 2401, 2403, 2402, 2404], bias: "bullish" as const, total: 68 },
    { tf: "D1", values: [2350, 2362, 2371, 2368, 2380, 2389, 2394, 2388, 2401, 2410, 2405, 2412], bias: "bullish" as const, total: 74 },
];

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
    return (
        <section className={`flex flex-col rounded-lg border border-border bg-card shadow-sm ${className ?? ""}`}>
            <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
                </span>
                <h2 className="text-[13px] font-medium text-foreground">{title}</h2>
            </header>
            <div className="flex-1 p-4">{children}</div>
        </section>
    );
}

export default function DevWidgetPreviewPage() {
    return (
        <main className="mx-auto max-w-[1400px] space-y-4 p-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Temporary widget QA — signal core · confidence · live chart · MTF · level bars
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Card title="Signal Core">
                    <SignalCoreView symbol="XAUUSD" timeframe="H1" score={bearishScore} />
                </Card>

                <Card title="Signal Confidence">
                    <ConfidenceView symbol="XAUUSD" timeframe="H1" score={bullishScore} />
                </Card>

                <Card title="Multi-Timeframe Bias">
                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-numeric text-[11px] uppercase tracking-wide text-muted-foreground">
                                XAUUSD · multi-timeframe
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="inline-flex items-center rounded-full border border-positive/30 bg-positive/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-positive">
                                    Buy
                                </span>
                                <span className="font-numeric text-[11px] text-muted-foreground">2/4 aligned</span>
                            </span>
                        </div>
                        <ul className="space-y-2.5">
                            {mtfRows.map((row) => (
                                <li key={row.tf} className="flex items-center gap-3">
                                    <span className="font-numeric w-9 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                                        {row.tf}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <MiniSparkline
                                            values={row.values}
                                            colorVar={
                                                row.bias === "bullish"
                                                    ? "var(--positive)"
                                                    : row.bias === "bearish"
                                                        ? "var(--negative)"
                                                        : "var(--info)"
                                            }
                                            height={28}
                                            animate
                                        />
                                    </span>
                                    <span className="font-numeric w-8 shrink-0 text-right text-[11px] text-muted-foreground">
                                        {row.total}
                                    </span>
                                    <span
                                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
                                            row.bias === "bullish"
                                                ? "border-positive/30 bg-positive/10 text-positive"
                                                : row.bias === "bearish"
                                                    ? "border-negative/30 bg-negative/10 text-negative"
                                                    : "border-border bg-muted text-muted-foreground"
                                        }`}
                                    >
                                        {row.bias === "bullish" ? "Buy" : row.bias === "bearish" ? "Sell" : "Flat"}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </Card>

                <Card title="Live Chart" className="sm:col-span-2">
                    <LiveCandlesPanel
                        symbol="XAUUSD"
                        timeframe="H1"
                        height={260}
                        badge={
                            <span className="flex items-center gap-1.5">
                                <span className="inline-flex items-center rounded-full border border-negative/30 bg-negative/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-negative">
                                    Sell
                                </span>
                                <span className="font-numeric text-[11px] text-muted-foreground">42/100</span>
                            </span>
                        }
                    />
                </Card>

                <Card title="Liquidity Pools (LevelBars)">
                    <LevelBars items={liquidityItems} />
                </Card>

                <Card title={`Dispatch check — ${NEW_TYPES.length} types registered`}>
                    <div className="space-y-3">
                        <ul className="space-y-1 text-[11px]">
                            {NEW_TYPES.map((type) => {
                                const spec = WIDGET_SPEC_BY_TYPE[type];
                                return (
                                    <li key={type} className="flex items-center gap-2">
                                        <span className={spec ? "text-positive" : "text-negative"}>
                                            {spec ? "✓" : "✗"}
                                        </span>
                                        <span className="font-numeric">{type}</span>
                                        <span className="text-muted-foreground">
                                            {spec ? `${spec.label} · widths ${spec.widths.join("/")}${spec.live ? " · live" : ""}` : "MISSING SPEC"}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                        <div className="grid gap-3">
                            {NEW_TYPES.map((type) => (
                                <div key={type} className="rounded-md border border-border p-3">
                                    <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                                        WidgetBody({type})
                                    </p>
                                    <WidgetBody
                                        type={type}
                                        user={null}
                                        refreshKey={0}
                                        config={defaultWidgetConfig(type)}
                                        accountId=""
                                        isPro={false}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>

                <Card title="CountUp sample">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Price</p>
                            <p className="font-numeric mt-1 text-xl font-semibold text-foreground">
                                <CountUp value={2412.37861} decimals={5} />
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Score</p>
                            <p className="font-numeric mt-1 text-xl font-semibold text-positive">
                                <CountUp value={78} suffix="%" />
                            </p>
                        </div>
                    </div>
                </Card>
            </div>
        </main>
    );
}
