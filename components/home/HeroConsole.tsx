"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
    ArrowRight,
    ChartLineUp,
    CheckCircle,
    Cpu,
    ShieldCheck,
    Target,
    TerminalWindow,
    TrendDown,
    TrendUp,
} from "@phosphor-icons/react";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { HomeBacktestAnalytics } from "@/lib/home-data";
import HomeAurora from "./HomeAurora";
import TacticalCard from "./TacticalCard";
import HeroPriceChart, { type HeroCandleInput } from "./charts/HeroPriceChart";

/* Illustrative XAUUSD M15 series for the console preview. This is sample
   market data, never a recorded account: the identity bar carries an explicit
   "Illustrative" badge and the footer echoes it with a "Sample preview" chip,
   so none of it can be read as a live result (DESIGN.md §17, §21.3). */
const HERO_TIMES = [
    "08:00", "08:15", "08:30", "08:45", "09:00", "09:15",
    "09:30", "09:45", "10:00", "10:15", "10:30", "10:45",
];
const HERO_VOLUME = [42, 68, 55, 90, 76, 48, 84, 95, 61, 72, 88, 70];
const HERO_CANDLES = [
    [2644.2, 2645.0, 2643.1, 2644.6],
    [2644.6, 2647.5, 2644.0, 2646.8],
    [2646.8, 2647.2, 2644.4, 2645.1],
    [2645.1, 2650.2, 2644.8, 2649.6],
    [2649.6, 2653.0, 2648.9, 2652.3],
    [2652.3, 2653.1, 2650.0, 2650.7],
    [2650.7, 2655.0, 2650.2, 2654.4],
    [2654.4, 2658.8, 2653.9, 2658.1],
    [2658.1, 2658.9, 2655.2, 2655.9],
    [2655.9, 2660.0, 2655.4, 2659.4],
    [2661.2, 2662.0, 2660.8, 2661.2],
];

/** The sample series, shaped for the price chart: open/high/low/close + volume. */
const HERO_SERIES: HeroCandleInput[] = HERO_CANDLES.map(
    ([open, high, low, close], i) => ({
        time: HERO_TIMES[i],
        open,
        high,
        low,
        close,
        volume: HERO_VOLUME[i],
        up: close >= open,
    })
);

/** Order levels shown beside the sample chart — the shape a signal uses. */
const ORDER_ROWS = [
    { label: "Entry", value: "2,650.10", tone: "text-foreground" },
    { label: "Stop loss", value: "2,642.00", tone: "text-negative" },
    { label: "Take profit", value: "2,662.00", tone: "text-positive" },
];

/** The three gateway behaviour rows — what happens once an order is accepted. */
const GATEWAY = [
    {
        icon: CheckCircle,
        title: "Risk-gated dispatch",
        copy: "Orders are blocked before they leave if a guard trips.",
    },
    {
        icon: ChartLineUp,
        title: "Execution analytics",
        copy: "Slippage and fill quality tracked per trade.",
    },
    {
        icon: ShieldCheck,
        title: "Drawdown telemetry",
        copy: "Live equity curve with alert thresholds.",
    },
];

function pct(value: number): string {
    if (!Number.isFinite(value)) return "—";
    return `${value.toFixed(1)}%`;
}

/**
 * The product console — the hero's media, and the one place the landing page
 * shows the actual tool surface.
 *
 * It reads as the same object system as every other band: a solid `Card`, the
 * Recharts `ChartContainer`, the shared `Reveal` entrance and `HomeAurora`
 * atmosphere. The chart, read-outs and order levels are data a visitor has to
 * read, so the panel stays opaque — no glass or blur over the plot (§21.3).
 *
 * The identity bar is real terminal chrome (no macOS window dots, which a
 * trading audience reads as P&L colours), and the footer states plainly that
 * the whole surface is deterministic sample-preview data.
 */
export default function HeroConsole({ analytics }: { analytics: HomeBacktestAnalytics }) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        // Calm cadence: one quote every 2s. Never per-frame state.
        const id = setInterval(() => setTick((t) => (t + 1) % 100), 2000);
        return () => clearInterval(id);
    }, []);

    const price = (2654.4 + Math.sin(tick / 5) * 1.8).toFixed(2);
    const up = Math.sin(tick / 5) >= 0;

    /* Real aggregates — no invented numbers. When nothing is recorded the risk
       tab shows an explicit empty state instead of placeholder figures. */
    const hasEvidence = analytics.total > 0;

    return (
        <section
            id="console"
            aria-label="Product console preview"
            className="home-section pb-20 pt-2 md:pb-28 md:pt-4"
        >
            <HomeAurora
                className="opacity-50"
                aClassName="right-[4%] top-[-6rem] h-[28rem] w-[28rem]"
                bClassName="left-[-6%] bottom-[-8rem] h-[26rem] w-[26rem]"
            />
            <div className="page-container relative">
                <TacticalCard dir={0} spotlight={true} className="mx-auto max-w-5xl rounded-xl">
                    <Card className="gap-0 p-0 shadow-xl shadow-black/10">
                        {/* Identity bar. */}
                        <CardHeader className="flex flex-row flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/80 bg-muted/40 px-4 py-3">
                            <TerminalWindow
                                size={16}
                                className="shrink-0 text-muted-foreground"
                                aria-hidden
                            />
                            <div className="flex min-w-0 items-baseline gap-2">
                                <span className="font-numeric text-sm font-semibold text-foreground">
                                    XAUUSD
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                    Gold Spot · M15
                                </span>
                            </div>
                            <span
                                className={`ml-auto flex items-center gap-1 font-numeric text-sm font-semibold tabular-nums ${
                                    up ? "text-positive" : "text-negative"
                                }`}
                            >
                                {up ? (
                                    <TrendUp size={15} aria-hidden />
                                ) : (
                                    <TrendDown size={15} aria-hidden />
                                )}
                                {price}
                            </span>
                            <Badge variant="warning-light" radius="full">
                                Illustrative
                            </Badge>
                        </CardHeader>

                        {/* One Tabs root owns the rail and every panel below it, so the
                            active trigger and the visible panel can never drift. */}
                        <CardContent className="p-0">
                            <Tabs defaultValue="terminal" className="flex-col gap-0">
                                <div className="border-b border-border/80 px-3 py-2">
                                    <TabsList className="w-full justify-start sm:w-fit">
                                        <TabsTrigger value="terminal">Chart</TabsTrigger>
                                        <TabsTrigger value="risk">Risk guard</TabsTrigger>
                                        <TabsTrigger value="execution">MT5 gateway</TabsTrigger>
                                    </TabsList>
                                </div>

                                <TabsContent value="terminal">
                                    <div className="px-2 pt-3">
                                        <HeroPriceChart data={HERO_SERIES} />
                                    </div>

                                    {/* Order levels only. The old "Signal score 88/100" cell is
                                        gone: it was an invented number with no source behind it
                                        (§17 — no fabricated data, even in a labelled sample). */}
                                    <dl className="grid grid-cols-1 gap-px border-t border-border/80 bg-border/80 sm:grid-cols-3">
                                        {ORDER_ROWS.map((row) => (
                                            <div key={row.label} className="bg-card px-4 py-3">
                                                <dt className="text-xs text-muted-foreground">
                                                    {row.label}
                                                </dt>
                                                <dd
                                                    className={`mt-0.5 font-numeric text-sm font-semibold tabular-nums ${row.tone}`}
                                                >
                                                    {row.value}
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>
                                </TabsContent>

                                <TabsContent value="risk">
                                    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                                        <div className="min-w-0">
                                            <h3 className="text-sm font-semibold tracking-tight text-foreground">
                                                Pre-trade validation
                                            </h3>
                                            <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                                                Every entry is checked against daily loss limits,
                                                position sizing and drawdown guards before it can
                                                reach your terminal.
                                            </p>
                                        </div>
                                        <Badge
                                            variant="success-light"
                                            radius="full"
                                            className="shrink-0 gap-1"
                                        >
                                            <ShieldCheck size={12} aria-hidden /> Guard active
                                        </Badge>
                                    </div>

                                    {hasEvidence ? (
                                        <dl className="grid grid-cols-2 gap-px border-t border-border/80 bg-border/80 sm:grid-cols-4">
                                            {[
                                                {
                                                    label: "Runs measured",
                                                    value: analytics.total.toLocaleString(),
                                                },
                                                {
                                                    label: "Average win rate",
                                                    value: pct(analytics.avgWinRate),
                                                },
                                                {
                                                    label: "Average max drawdown",
                                                    value: pct(analytics.avgMaxDrawdown),
                                                },
                                                {
                                                    label: "Profitable runs",
                                                    value: `${analytics.positiveCount} of ${analytics.total}`,
                                                },
                                            ].map((cell) => (
                                                <div key={cell.label} className="bg-card px-4 py-4">
                                                    <dt className="text-xs text-muted-foreground">
                                                        {cell.label}
                                                    </dt>
                                                    <dd className="mt-1 font-numeric text-xl font-semibold tabular-nums text-foreground">
                                                        {cell.value}
                                                    </dd>
                                                </div>
                                            ))}
                                        </dl>
                                    ) : (
                                        <div className="border-t border-border/80 px-5 py-10 text-center">
                                            <p className="text-sm font-medium text-foreground">
                                                No recorded runs yet
                                            </p>
                                            <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                                                Risk aggregates appear here once backtests are
                                                recorded. Run one to see real numbers instead of a
                                                demo.
                                            </p>
                                            <Button
                                                render={<Link href="/backtests" />}
                                                variant="outline"
                                                size="sm"
                                                className="mt-4"
                                            >
                                                Run a backtest{" "}
                                                <ArrowRight data-icon="inline-end" size={14} />
                                            </Button>
                                        </div>
                                    )}
                                </TabsContent>

                                <TabsContent value="execution">
                                    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                                        <div className="min-w-0">
                                            <h3 className="text-sm font-semibold tracking-tight text-foreground">
                                                Broker gateway
                                            </h3>
                                            <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                                                Connect your own terminal to dispatch
                                                risk-validated orders and stream heartbeats
                                                back. Credentials never leave your broker.
                                            </p>
                                        </div>
                                        <Badge
                                            variant="outline"
                                            radius="full"
                                            className="shrink-0 gap-1"
                                        >
                                            <Target size={12} aria-hidden /> Bring your own MT5
                                        </Badge>
                                    </div>

                                    <ul className="grid grid-cols-1 gap-px border-t border-border/80 bg-border/80 sm:grid-cols-3">
                                        {GATEWAY.map(({ icon: Icon, title, copy }) => (
                                            <li key={title} className="flex gap-3 bg-card px-4 py-4">
                                                <Icon
                                                    size={16}
                                                    className="mt-0.5 shrink-0 text-positive"
                                                    aria-hidden
                                                />
                                                <div className="min-w-0">
                                                    <p className="text-xs font-semibold text-foreground">
                                                        {title}
                                                    </p>
                                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                                        {copy}
                                                    </p>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </TabsContent>
                            </Tabs>
                        </CardContent>

                        {/* Footer: the engine statement and the honest sample-preview
                            label, on the same hairline the other panels use. */}
                        <CardFooter className="flex-wrap justify-between gap-x-4 gap-y-2 border-border/80 bg-muted/20 px-4 py-2.5">
                            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Cpu size={14} className="text-primary" aria-hidden />
                                Deterministic market engine
                                <Badge variant="warning-light" size="xs" radius="full">
                                    Sample preview
                                </Badge>
                            </span>
                            <span className="font-numeric text-xs tabular-nums text-muted-foreground">
                                Base · <span className="text-foreground">Lyra</span>
                            </span>
                        </CardFooter>
                    </Card>
                </TacticalCard>
            </div>
        </section>
    );
}
