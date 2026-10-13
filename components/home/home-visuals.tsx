"use client";

import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Shared presentational visuals for the homepage loop sections.
 * Sample figures are illustrative and labeled; real aggregates are passed
 * in as props by the sections that own them.
 */

const TOOLTIP_STYLE = {
    background: "var(--card)",
    border: "1px solid var(--border-color)",
    borderRadius: 12,
    color: "var(--foreground)",
    fontSize: 12,
} as const;

/** Sample engine scores (0–100) — illustrative. */
const ENGINE_SCORES = [
    { short: "RG", name: "Regime", score: 84 },
    { short: "ST", name: "Structure", score: 72 },
    { short: "ZN", name: "Zones", score: 65 },
    { short: "LQ", name: "Liquidity", score: 58 },
    { short: "VW", name: "VWAP", score: 77 },
    { short: "SS", name: "Sessions", score: 69 },
    { short: "VL", name: "Volume", score: 61 },
    { short: "SC", name: "Score", score: 74 },
] as const;

export function EngineBars() {
    return (
        <div>
            <div className="h-32" role="img" aria-label="Illustrative sample engine scores">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[...ENGINE_SCORES]} margin={{ top: 2, right: 0, left: 0, bottom: 0 }} barCategoryGap="28%">
                        <XAxis
                            dataKey="short"
                            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            interval={0}
                        />
                        <YAxis hide domain={[0, 100]} />
                        <Tooltip
                            cursor={{ fill: "var(--muted)" }}
                            contentStyle={TOOLTIP_STYLE}
                            formatter={(value) => [`${value} / 100`, "Score"]}
                            labelFormatter={(_, payload) => {
                                const first = payload?.[0]?.payload as { name?: string } | undefined;
                                return first?.name ?? "";
                            }}
                        />
                        <Bar dataKey="score" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false}>
                            {ENGINE_SCORES.map((e) => (
                                <Cell key={e.short} fill="var(--primary)" fillOpacity={0.45 + (e.score / 100) * 0.55} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                Sample scores — the eight engines run on live candles inside the product.
            </p>
        </div>
    );
}

/** Sample per-trade outcomes (%) — illustrative. */
const SAMPLE_RETURNS = [2.4, -1.2, 3.1, 0.8, -0.6, 4.2, -2.1, 1.5, 2.8, -0.9, 1.1, 3.6, -1.5, 2.2].map(
    (r, i) => ({ trade: `T${i + 1}`, ret: r }),
);

export function ReturnsHistogram() {
    const wins = SAMPLE_RETURNS.filter((t) => t.ret >= 0).length;
    const losses = SAMPLE_RETURNS.length - wins;
    return (
        <div>
            <div className="h-32" role="img" aria-label="Illustrative sample trade outcomes">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={SAMPLE_RETURNS} margin={{ top: 2, right: 0, left: 0, bottom: 0 }} barCategoryGap="30%">
                        <XAxis dataKey="trade" hide />
                        <YAxis hide domain={["dataMin - 0.5", "dataMax + 0.5"]} />
                        <Tooltip
                            cursor={{ fill: "var(--muted)" }}
                            contentStyle={TOOLTIP_STYLE}
                            formatter={(value) => [`${Number(value) >= 0 ? "+" : ""}${value}%`, "Return"]}
                            labelFormatter={(label) => `Trade ${String(label).slice(1)} of ${SAMPLE_RETURNS.length}`}
                        />
                        <ReferenceLine y={0} stroke="var(--border-color)" strokeWidth={1} />
                        <Bar dataKey="ret" radius={[2, 2, 2, 2]} maxBarSize={14} isAnimationActive={false}>
                            {SAMPLE_RETURNS.map((t) => (
                                <Cell key={t.trade} fill={t.ret >= 0 ? "var(--positive)" : "var(--negative)"} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            <p className="mt-2 font-numeric text-sm font-semibold text-foreground">
                {wins}<span className="text-positive">W</span> · {losses}<span className="text-negative">L</span>{" "}
                <span className="font-sans text-[11px] font-normal text-muted-foreground">
                    sample · {SAMPLE_RETURNS.length} closed trades
                </span>
            </p>
        </div>
    );
}

const LIFECYCLE = ["NEW", "PENDING_ENTRY", "ENTRY_TRIGGERED", "TP_REACHED", "CLOSED"] as const;
const TERMINAL = ["STOPPED_OUT", "EXPIRED", "CANCELLED", "INVALIDATED"] as const;

export function SignalLifecycle() {
    return (
        <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-positive">Active path</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
                {LIFECYCLE.map((s) => (
                    <Badge key={s} variant="success" className="font-numeric text-[11px]">
                        {s}
                    </Badge>
                ))}
            </div>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-widest text-warning">Terminal states</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
                {TERMINAL.map((s) => (
                    <Badge key={s} variant="warning" className="font-numeric text-[11px]">
                        {s}
                    </Badge>
                ))}
            </div>
            <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-positive" aria-hidden />
                Outcomes are decided deterministically — TP/SL hits, never AI narrative.
            </p>
        </div>
    );
}

const RISK_CHECKS = [
    { label: "Daily loss limit", detail: "2% of balance" },
    { label: "Drawdown guard", detail: "Armed" },
    { label: "Position sizing", detail: "1% risk" },
    { label: "Gateway heartbeat", detail: "Checked pre-trade" },
] as const;

export function RiskMini() {
    return (
        <ul className="divide-y divide-border rounded-lg border border-border">
            {RISK_CHECKS.map(({ label, detail }) => (
                <li key={label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                        <ShieldCheck size={14} className="shrink-0 text-positive" aria-hidden />
                        {label}
                    </span>
                    <span className="font-numeric text-xs text-muted-foreground">{detail}</span>
                </li>
            ))}
        </ul>
    );
}

const TELEMETRY: Array<[string, string, string]> = [
    ["Gateway heartbeat", "LIVE", "text-positive"],
    ["Data feed", "LIVE", "text-positive"],
    ["Drawdown guard", "Armed", "text-warning"],
];

export function TelemetryMini() {
    return (
        <ul className="space-y-1.5">
            {TELEMETRY.map(([k, v, tone]) => (
                <li key={k} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 text-xs">
                    <span className="text-muted-foreground">{k}</span>
                    <span className={`font-numeric font-semibold ${tone}`}>{v}</span>
                </li>
            ))}
        </ul>
    );
}
