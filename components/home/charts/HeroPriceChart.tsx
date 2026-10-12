"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

/** One sample candle, already labelled as illustrative by the console chrome. */
export type HeroCandleInput = {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    /** Direction from open → close; drives the positive/negative token only. */
    up: boolean;
};

/** The same candle with the `[low, high]` range Recharts draws the wick from. */
type CandleDatum = HeroCandleInput & { range: [number, number] };

const priceConfig = {
    price: { label: "Price", color: "var(--positive)" },
} satisfies ChartConfig;

const volumeConfig = {
    volume: { label: "Volume", color: "var(--primary)" },
} satisfies ChartConfig;

/**
 * Custom candle for a range Bar. Recharts hands the bar's `y`/`height` already
 * mapped to `[low, high]`, so the open/close body is placed by interpolating
 * within that span — no second scale, no re-derivation of the axis.
 */
function Candle({
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    payload,
}: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    payload?: CandleDatum;
}) {
    if (!payload) return <g />;

    const { open, close, high, low, up } = payload;
    const span = high - low || 1;
    const scale = height / span;
    const yAt = (price: number) => y + (high - price) * scale;

    const bodyTop = Math.min(yAt(open), yAt(close));
    const bodyHeight = Math.max(2, Math.abs(yAt(open) - yAt(close)));
    const bodyWidth = Math.max(3, width * 0.6);
    const centerX = x + width / 2;
    const stroke = up ? "var(--positive)" : "var(--negative)";

    return (
        <g>
            <line
                x1={centerX}
                x2={centerX}
                y1={y}
                y2={y + height}
                stroke={stroke}
                strokeWidth={1.25}
                strokeLinecap="round"
            />
            <rect
                x={centerX - bodyWidth / 2}
                y={bodyTop}
                width={bodyWidth}
                height={bodyHeight}
                rx={1.5}
                fill={stroke}
            />
        </g>
    );
}

/**
 * The console's sample market chart — XAUUSD candles over a volume pane, on
 * the same `ChartContainer` the rest of the landing page charts use.
 *
 * This is labelled sample data, not a recorded account: the console identity
 * bar carries the "Illustrative" badge and the footer repeats it. Colours stay
 * on the trading tokens (up = positive, down = negative; DESIGN.md §17) and the
 * series freeze under `prefers-reduced-motion`.
 */
export default function HeroPriceChart({
    data,
    height = 236,
    volumeHeight = 64,
    className,
}: {
    data: HeroCandleInput[];
    height?: number;
    volumeHeight?: number;
    className?: string;
}) {
    const reduced = usePrefersReducedMotion();

    const candles: CandleDatum[] = data.map((candle) => ({
        ...candle,
        range: [candle.low, candle.high],
    }));

    const lows = data.map((candle) => candle.low);
    const highs = data.map((candle) => candle.high);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const pad = (max - min) * 0.12 || 1;
    const priceDomain: [number, number] = [min - pad, max + pad];
    const maxVolume = Math.max(...data.map((candle) => candle.volume)) || 1;

    return (
        <div className={cn("flex flex-col", className)}>
            <ChartContainer
                config={priceConfig}
                className="aspect-auto w-full"
                style={{ height }}
                role="img"
                aria-label="Illustrative XAUUSD M15 candlesticks, morning session — sample preview data"
            >
                <BarChart
                    accessibilityLayer
                    data={candles}
                    margin={{ top: 12, right: 2, bottom: 0, left: 2 }}
                >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="time" hide />
                    <YAxis
                        orientation="right"
                        domain={priceDomain}
                        width={46}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={4}
                        tickFormatter={(value: number) => value.toFixed(0)}
                    />
                    <ChartTooltip
                        cursor={false}
                        content={
                            <ChartTooltipContent
                                hideLabel
                                indicator="dot"
                                className="min-w-44 gap-2"
                                formatter={(_value, _name, item) => {
                                    const candle = item.payload as CandleDatum;
                                    if (!candle) return null;
                                    const rows: Array<[string, number]> = [
                                        ["O", candle.open],
                                        ["H", candle.high],
                                        ["L", candle.low],
                                        ["C", candle.close],
                                    ];
                                    return (
                                        <div className="grid w-full gap-1.5">
                                            <div className="flex items-center justify-between gap-4">
                                                <span className="text-muted-foreground">
                                                    {candle.time}
                                                </span>
                                                <span
                                                    className={cn(
                                                        "font-numeric font-semibold tabular-nums",
                                                        candle.up
                                                            ? "text-positive"
                                                            : "text-negative"
                                                    )}
                                                >
                                                    {candle.close.toFixed(2)}
                                                </span>
                                            </div>
                                            <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                                {rows.map(([label, value]) => (
                                                    <div
                                                        key={label}
                                                        className="flex items-center justify-between gap-3"
                                                    >
                                                        <dt className="text-muted-foreground">
                                                            {label}
                                                        </dt>
                                                        <dd className="font-numeric tabular-nums text-foreground">
                                                            {value.toFixed(2)}
                                                        </dd>
                                                    </div>
                                                ))}
                                            </dl>
                                        </div>
                                    );
                                }}
                            />
                        }
                    />
                    <Bar
                        dataKey="range"
                        shape={(props) => <Candle {...props} />}
                        isAnimationActive={!reduced}
                    />
                </BarChart>
            </ChartContainer>

            <ChartContainer
                config={volumeConfig}
                className="aspect-auto w-full"
                style={{ height: volumeHeight }}
                role="img"
                aria-label="Illustrative session volume in lots — sample preview data"
            >
                <BarChart
                    accessibilityLayer
                    data={candles}
                    margin={{ top: 6, right: 2, bottom: 0, left: 2 }}
                    barCategoryGap="24%"
                >
                    <XAxis
                        dataKey="time"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={6}
                        interval={0}
                    />
                    <YAxis
                        orientation="right"
                        domain={[0, maxVolume * 1.3]}
                        width={46}
                        hide
                    />
                    <Bar
                        dataKey="volume"
                        radius={[2, 2, 0, 0]}
                        fillOpacity={0.55}
                        isAnimationActive={!reduced}
                    >
                        {candles.map((candle) => (
                            <Cell
                                key={candle.time}
                                fill={candle.up ? "var(--positive)" : "var(--negative)"}
                            />
                        ))}
                    </Bar>
                </BarChart>
            </ChartContainer>
        </div>
    );
}
