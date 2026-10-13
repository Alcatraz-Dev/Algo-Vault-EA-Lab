"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HomeData } from "@/lib/home-data";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Reveal from "./Reveal";

/**
 * Terminal section: a code editor with line numbers, token-based syntax
 * tinting, a working copy button, and switchable samples — beside a
 * sample equity curve and real backtest aggregates. Nothing executes;
 * the panel opens in Strategy Lab instead.
 */

const PINE_SAMPLE = `//@version=6
strategy("Vault Breakout", overlay=true)

len   = input.int(21, "ATR length")
mult  = input.float(1.8, "ATR multiple")
atr   = ta.atr(len)

longOk  = close > ta.highest(high, 50)[1]
shortOk = close < ta.lowest(low, 50)[1]

if longOk
    strategy.entry("Long", strategy.long)

if shortOk
    strategy.entry("Short", strategy.short)`;

const MQL5_SAMPLE = `//+----------------------------------------------------+
//| Vault Breakout — sample skeleton                  |
//+----------------------------------------------------+
input double RiskPct = 1.0;
input int    ATRLen  = 21;

int OnInit() { return(INIT_SUCCEEDED); }

void OnTick() {
   double atr = iATR(_Symbol, PERIOD_CURRENT, ATRLen, 0);
   // entries pass the risk gate before send
}`;

const SETFILE_SAMPLE = `{
  "symbol": "XAUUSD",
  "timeframe": "M15",
  "risk_pct": 1.0,
  "atr_len": 21,
  "atr_mult": 1.8,
  "session": "London"
}`;

const SIGNAL_SAMPLE = `{
  "id": "sig_sample_01",
  "symbol": "XAUUSD",
  "direction": "long",
  "state": "PENDING_ENTRY",
  "engines": { "regime": "trend", "score": 74 },
  "risk": { "decision": "approve", "code": "OK" }
}`;

const TABS = [
    { id: "pine", label: "Pine import", desc: "Pine Script v6, read directly", file: "vault-breakout.pine · sample", code: PINE_SAMPLE },
    { id: "mql5", label: "MQL5 export", desc: "Terminal-ready experts", file: "VaultBreakout.mq5 · sample", code: MQL5_SAMPLE },
    { id: "setfile", label: "Set file", desc: "Parameters that travel", file: "xauusd-m15.set.json · sample", code: SETFILE_SAMPLE },
    { id: "signal", label: "Signal payload", desc: "Normalized lifecycle JSON", file: "signal.json · sample", code: SIGNAL_SAMPLE },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Sample equity route for the curve — illustrative, labeled in the UI. */
const EQUITY = Array.from({ length: 40 }, (_, i) => ({
    i,
    v: Math.round((100 + i * 0.62 + Math.sin(i / 3.1) * 1.8 + (i > 26 ? (i - 26) * 0.5 : 0)) * 100) / 100,
}));

const KEYWORDS = new Set([
    "input", "strategy", "if", "for", "in", "return", "void", "int", "double",
    "import", "from", "const", "true", "false", "include", "define",
]);

function tintLine(line: string, key: string) {
    const parts = line.split(/("[^"]*"|'[^']*'|\/\/.*$|#[^\n]*$|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_.]*\b)/g);
    return (
        <span key={key}>
            {parts.map((part, j) => {
                if (!part) return null;
                if (/^(\/\/|#)/.test(part) && !/^#[0-9a-fA-F]+$/.test(part) && !/^"\{"?$/.test(part)) {
                    return (
                        <span key={j} className="text-muted-foreground/70 italic">
                            {part}
                        </span>
                    );
                }
                if (/^["']/.test(part)) {
                    return (
                        <span key={j} className="text-positive">
                            {part}
                        </span>
                    );
                }
                if (/^\d/.test(part)) {
                    return (
                        <span key={j} className="font-numeric text-info">
                            {part}
                        </span>
                    );
                }
                if (KEYWORDS.has(part)) {
                    return (
                        <span key={j} className="font-semibold text-primary">
                            {part}
                        </span>
                    );
                }
                return <span key={j}>{part}</span>;
            })}
        </span>
    );
}

export default function CodeSection({ data }: { data: HomeData }) {
    const { backtestAnalytics } = data;
    const [tab, setTab] = useState<TabId>("pine");
    const [copied, setCopied] = useState(false);
    const active = TABS.find((t) => t.id === tab) ?? TABS[0];

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(active.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch {
            setCopied(false);
        }
    };

    const tiles = [
        { label: "Recorded runs", value: String(backtestAnalytics.total) },
        {
            label: "Avg win rate",
            value: backtestAnalytics.analyzableCount > 0 ? `${backtestAnalytics.avgWinRate.toFixed(1)}%` : "—",
        },
        {
            label: "Avg drawdown",
            value: backtestAnalytics.analyzableCount > 0 ? `${backtestAnalytics.avgMaxDrawdown.toFixed(1)}%` : "—",
        },
    ];

    return (
        <section className="border-b border-border bg-muted/30">
            <div className="page-container py-14 md:py-20">
                <Reveal>
                    <h2 className="max-w-[22ch] text-4xl font-semibold tracking-[-0.03em] text-balance text-foreground sm:text-5xl">
                        Speak Pine and MQL5. Keep the tools you have.
                    </h2>
                    <p className="mt-5 max-w-[56ch] text-base text-pretty text-muted-foreground">
                        Strategies are read directly and experts export terminal-ready — the languages and files you already use work without changes.
                    </p>
                    <div className="mt-8 flex flex-wrap gap-3">
                        <Button render={<Link href="/docs" />} variant="outline">
                            Read the docs <ArrowRight data-icon="inline-end" />
                        </Button>
                        <Button render={<Link href="/strategy-lab" />}>
                            Open Strategy Lab <ArrowRight data-icon="inline-end" />
                        </Button>
                    </div>
                </Reveal>

                <Reveal delay={100}>
                    <div role="tablist" aria-label="Code samples" className="-mx-6 mt-12 flex snap-x gap-6 overflow-x-auto px-6 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
                        {TABS.map((t) => {
                            const selected = tab === t.id;
                            return (
                                <button
                                    key={t.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={selected}
                                    onClick={() => setTab(t.id)}
                                    className="group relative w-52 shrink-0 snap-start py-4 pr-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-auto"
                                >
                                    <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-border" />
                                    <span
                                        aria-hidden
                                        className={cn(
                                            "absolute inset-x-0 top-0 h-px origin-left bg-primary transition-transform duration-300 motion-reduce:transition-none",
                                            selected ? "scale-x-100" : "scale-x-0",
                                        )}
                                    />
                                    <span className={cn("text-sm font-medium transition-colors", selected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                                        {t.label}
                                    </span>
                                    <span className="mt-1 block text-[13px] leading-5 text-muted-foreground/80">{t.desc}</span>
                                </button>
                            );
                        })}
                    </div>
                </Reveal>

                <Reveal delay={160}>
                    <div className="mt-6 grid gap-4 border-t border-border pt-8 lg:grid-cols-[1.15fr_1fr]">
                        {/* Editor */}
                        <div className="flex min-h-85 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-md">
                            <div className="flex h-10 shrink-0 items-center justify-between gap-2 px-3">
                                <span className="flex items-center gap-1.5 font-numeric text-[11px] text-muted-foreground">
                                    <span className="rounded bg-muted px-1.5 py-0.5 font-semibold">txt</span>
                                    {active.file}
                                </span>
                                <span className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={copy}
                                        aria-label={copied ? "Copied" : "Copy sample code"}
                                        className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                    >
                                        {copied ? <Check size={14} className="text-positive" aria-hidden /> : <Copy size={14} aria-hidden />}
                                    </button>
                                    <Link
                                        href="/strategy-lab"
                                        className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                                    >
                                        Open in lab
                                    </Link>
                                </span>
                            </div>
                            <pre className="min-h-0 flex-1 overflow-auto p-4 font-numeric text-xs leading-5" aria-label={`Sample ${active.label}`}>
                                <code>
                                    {active.code.split("\n").map((line, i) => (
                                        <span key={i} className="flex">
                                            <span aria-hidden className="w-8 shrink-0 select-none pr-3 text-right text-muted-foreground/50">
                                                {i + 1}
                                            </span>
                                            <span className="whitespace-pre text-foreground/90">{tintLine(line || " ", `l${i}`)}</span>
                                        </span>
                                    ))}
                                </code>
                            </pre>
                            <div className="flex h-8 shrink-0 items-center justify-between gap-3 px-3 font-numeric text-[11px] text-muted-foreground">
                                <span>UTF-8 · sample</span>
                                <span>Ln {active.code.split("\n").length}, Col 1</span>
                            </div>
                        </div>

                        {/* Curve + stats */}
                        <div className="flex min-h-85 flex-col rounded-xl border border-border bg-card p-4 shadow-md">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-semibold text-foreground">Sample equity</p>
                                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                                    40 closed trades
                                </span>
                            </div>
                            <div className="mt-2 h-44" role="img" aria-label="Illustrative sample equity curve">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={EQUITY} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                                        <XAxis dataKey="i" hide />
                                        <YAxis
                                            domain={["dataMin - 1", "dataMax + 1"]}
                                            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                                            axisLine={false}
                                            tickLine={false}
                                            width={44}
                                            tickFormatter={(v: number) => v.toFixed(0)}
                                        />
                                        <Tooltip
                                            cursor={{ stroke: "var(--border-color)", strokeDasharray: "3 3" }}
                                            contentStyle={{
                                                background: "var(--card)",
                                                border: "1px solid var(--border-color)",
                                                borderRadius: 12,
                                                color: "var(--foreground)",
                                                fontSize: 12,
                                            }}
                                            formatter={(value) => [`$${Number(value).toFixed(2)}`, "Equity"]}
                                            labelFormatter={(label) => `Trade ${Number(label) + 1}`}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="v"
                                            stroke="var(--primary)"
                                            strokeWidth={2}
                                            dot={false}
                                            isAnimationActive={false}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
                                {tiles.map((t) => (
                                    <div key={t.label} className="min-w-0">
                                        <dt className="truncate text-[11px] text-muted-foreground">{t.label}</dt>
                                        <dd className="mt-0.5 truncate font-numeric text-lg font-semibold tracking-tight text-foreground">
                                            {t.value}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                            <p className="mt-auto pt-2 text-[11px] leading-4 text-muted-foreground">
                                Curve is a labeled sample; tiles are recorded aggregates.
                            </p>
                        </div>
                    </div>
                </Reveal>
            </div>
        </section>
    );
}
