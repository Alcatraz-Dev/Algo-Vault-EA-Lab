"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, Play, FileCheck, Settings, Shield } from "lucide-react";
import { StepSlider } from "../step-slider/components/step-slider";
import { useReducedMotion } from "motion/react";
import { Area, AreaChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Terminal } from "@/components/ui/terminal";
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
    { id: "pine", label: "Pine import", desc: "Pine Script v6, read directly", file: "vault-breakout.pine", code: PINE_SAMPLE },
    { id: "mql5", label: "MQL5 export", desc: "Terminal-ready experts", file: "VaultBreakout.mq5", code: MQL5_SAMPLE },
    { id: "setfile", label: "Set file", desc: "Parameters that travel", file: "xauusd-m15.set.json", code: SETFILE_SAMPLE },
    { id: "signal", label: "Signal payload", desc: "Normalized lifecycle JSON", file: "signal.json", code: SIGNAL_SAMPLE },
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
    const reduceMotion = useReducedMotion();
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


    const tabCards = {
        pine: {
            title: "Sample equity",
            subtitle: "40 closed trades",
            tracesTitle: "Live traces",
            tracesSub: "ap-northeast",
            color: "#f97316",
            chartData: [{v:6},{v:8},{v:12},{v:9},{v:14},{v:11},{v:16},{v:10},{v:13},{v:15}],
            traces: [
                { id: "req_7f4a1f", model: "llama-3.1-70b", done: true, pct: 100, color: "#5cb87f" },
                { id: "req_7f49c1", model: "qwen-2.5-32b", done: false, pct: 28, color: "#e2a63f" },
                { id: "req_7f49e6", model: "whisper-large-v3", done: false, pct: 44, color: "#e2a63f" },
            ],
            tiles: [
                { label: "Recorded runs", value: "6" },
                { label: "Avg win rate", value: "52.0%" },
                { label: "Avg drawdown", value: "7.6%" },
            ],
            note: "Curve is a labeled sample; tiles are recorded aggregates.",
        },
        mql5: {
            title: "Batch jobs",
            color: "#10b981",
            chartData: [{v:2},{v:5},{v:4},{v:8},{v:6},{v:3},{v:7}],
            subtitle: "24h window",
            tracesTitle: "Live traces",
            tracesSub: "eu-west",
            traces: [
                { id: "batch_21a", model: "Vault Breakout", done: true, pct: 100, color: "#5cb87f" },
                { id: "batch_21b", model: "Trend guard", done: false, pct: 72, color: "#e2a63f" },
                { id: "batch_21c", model: "ATR length 21", done: false, pct: 18, color: "#e2a63f" },
            ],
            tiles: [
                { label: "Completed", value: "12" },
                { label: "Queued", value: "8" },
                { label: "Avg latency", value: "112 ms" },
            ],
            note: "Batch results from the last 24h; latency measured end-to-end.",
        },
        setfile: {
            title: "Parameter set",
            color: "#6366f1",
            chartData: [{v:1},{v:3},{v:2},{v:5},{v:4}],
            subtitle: "Active config",
            tracesTitle: "Live traces",
            tracesSub: "us-east",
            traces: [
                { id: "set_001", model: "xauusd-m15.set", done: true, pct: 100, color: "#5cb87f" },
                { id: "set_002", model: "eurusd-h1.set", done: false, pct: 34, color: "#e2a63f" },
            ],
            tiles: [
                { label: "Symbols", value: "2" },
                { label: "Active params", value: "21" },
                { label: "Risk %", value: "1.0" },
            ],
            note: "Active set file values; parameters travel unchanged.",
        },
        signal: {
            title: "Signal payload",
            color: "#f59e0b",
            chartData: [{v:3},{v:5},{v:4},{v:7},{v:6}],
            subtitle: "Lifecycle trace",
            tracesTitle: "Live traces",
            tracesSub: "global",
            traces: [
                { id: "sig_sample_01", model: "regime: trend / score 74", done: true, pct: 100, color: "#5cb87f" },
                { id: "sig_sample_02", model: "pending entry", done: false, pct: 0, color: "#e2a63f" },
            ],
            tiles: [
                { label: "Signals", value: "1" },
                { label: "Regime score", value: "74" },
                { label: "Risk decision", value: "OK" },
            ],
            note: "Normalized lifecycle JSON; ready for handler dispatch.",
        },
    } as const;
    const cardData = (tabCards as any)[tab] || tabCards.pine;

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
                    <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-card shadow-lg dark:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
                        {/* Sample tabs and action tools, inline at the top of the card */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
                            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                                <span className="flex h-7 shrink-0 items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 text-[11px] font-semibold text-foreground/80 shadow-xs">
                                    <span>sh</span>
                                    <span className="text-muted-foreground">terminal</span>
                                    <span className="text-muted-foreground/60">.env</span>
                                </span>
                                <div
                                    role="tablist"
                                    aria-label="Code samples"
                                    className="flex min-w-0 items-center gap-1 overflow-x-auto"
                                >
                                    {TABS.map((t) => {
                                        const selected = tab === t.id;
                                        return (
                                            <button
                                                key={t.id}
                                                type="button"
                                                role="tab"
                                                aria-selected={selected}
                                                title={t.desc}
                                                onClick={() => setTab(t.id)}
                                                className={cn(
                                                    "shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                                                    selected
                                                        ? "bg-card text-foreground font-semibold shadow-xs border border-border/80"
                                                        : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
                                                )}
                                            >
                                                {t.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={copy}
                                aria-label={copied ? "Copied code" : "Copy code"}
                                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-card px-2.5 text-[11px] font-medium text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                {copied ? (
                                    <>
                                        <Check className="size-3 text-positive" aria-hidden />
                                        <span className="text-positive font-medium">Copied</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy className="size-3" aria-hidden />
                                        <span>Copy code</span>
                                    </>
                                )}
                            </button>
                        </div>

                        {/* File meta and language pill */}
                        <div className="flex items-center justify-between border-b border-border bg-muted/20 px-4 py-2 text-xs">
                            <p className="truncate text-muted-foreground">
                                {active.desc}
                            </p>
                            <div className="flex shrink-0 items-center gap-2">
                                <span className="truncate font-numeric text-[11px] text-muted-foreground">{active.file} · UTF-8</span>
                                <span className="rounded border border-border/50 bg-muted px-1.5 py-0.5 font-numeric text-[11px] font-medium text-foreground">
                                    {tab === "pine" ? "Pine v6" : tab === "mql5" ? "MQL5" : tab === "setfile" ? "Set file" : "Signal"}
                                </span>
                            </div>
                        </div>

                        <div className="grid lg:grid-cols-[1.15fr_1fr] lg:divide-x lg:divide-border">
                            {/* Editor */}
                            <div className="flex min-h-85 min-w-0 flex-col bg-card">
                                <div className="min-h-0 flex-1 overflow-auto p-3">
                                    <Terminal
                                        key={tab}
                                        commands={[active.code]}
                                        outputs={{ 0: ["Compiling...", "Syntax OK — 0 errors, 0 warnings"] }}
                                        username="algovault"
                                        typingSpeed={25}
                                        delayBetweenCommands={2200}
                                        initialDelay={350}
                                        enableSound={false}
                                        className="w-full max-w-full p-0"
                                    />
                                </div>
                                <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 font-numeric text-[11px] text-muted-foreground">
                                    <span className="truncate">{active.file} · UTF-8 · strategy lab compatible</span>
                                    <span>Ln {active.code.split("\n").length}, Col 1</span>
                                </div>
                            </div>

                            {/* Curve + stats */}
                            <div className="flex min-h-85 flex-col bg-card p-4">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-semibold text-foreground">{cardData.title}</p>
                                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                                        {cardData.subtitle}
                                    </span>
                                </div>
                                <div className="mt-3 min-h-44 flex-1" role="img" aria-label={cardData.title + " preview"}>
                                    <div className="h-full rounded-xl border border-border bg-muted/25 p-3 shadow-xs text-[11px] flex flex-col justify-between">
                                        <div className="mb-2 flex justify-between text-xs font-medium">
                                            <span className="text-foreground">{cardData.tracesTitle}</span>
                                            <span className="text-muted-foreground font-numeric">{cardData.tracesSub}</span>
                                        </div>
                                        {tab === "pine" ? (
                                            <div className="h-32 w-full rounded-lg overflow-hidden my-auto">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <AreaChart data={cardData.chartData}>
                                                        <defs>
                                                            <linearGradient id="fill-curve" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor={cardData.color} stopOpacity={0.35} />
                                                                <stop offset="95%" stopColor={cardData.color} stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <Area type="monotone" dataKey="v" stroke={cardData.color} strokeWidth={2} fill="url(#fill-curve)" dot={false} />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </div>
                                        ) : tab === "mql5" ? (
                                            <div className="space-y-4 my-auto py-1">
                                                <div>
                                                    <div className="flex justify-between text-xs mb-1.5">
                                                        <span className="font-medium text-foreground">Batch progress</span>
                                                        <span className="font-numeric text-muted-foreground">72%</span>
                                                    </div>
                                                    <StepSlider aria-label="Batch progress" value={72} steps={[0, 25, 50, 72, 100]} onValueChange={() => {}} formatLabel={(v: number) => v + "%"} />
                                                </div>
                                                <div>
                                                    <div className="flex justify-between text-xs mb-1.5">
                                                        <span className="font-medium text-foreground">Queue depth</span>
                                                        <span className="font-numeric text-muted-foreground">28%</span>
                                                    </div>
                                                    <StepSlider aria-label="Queue depth" value={28} steps={[0, 10, 25, 28, 50]} onValueChange={() => {}} formatLabel={(v: number) => v + "%"} />
                                                </div>
                                            </div>
                                        ) : tab === "setfile" ? (
                                            <div className="grid grid-cols-1 gap-2.5 my-auto">
                                                <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 shadow-xs">
                                                    <div className="grid size-8 place-items-center rounded-lg bg-positive/10 text-positive">
                                                        <FileCheck size={16} />
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-semibold text-foreground">Symbols loaded</p>
                                                        <p className="text-[11px] text-muted-foreground font-numeric">2 active — XAUUSD, EURUSD</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 shadow-xs">
                                                    <div className="grid size-8 place-items-center rounded-lg bg-warning/10 text-warning">
                                                        <Settings size={16} />
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-semibold text-foreground">Parameters set</p>
                                                        <p className="text-[11px] text-muted-foreground font-numeric">21 verified · ATR 21 · Mult 1.8</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 shadow-xs">
                                                    <div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                                                        <Shield size={16} />
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-semibold text-foreground">Risk gate</p>
                                                        <p className="text-[11px] text-muted-foreground font-numeric">1.0 active · License OK</p>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="rounded-xl border border-border bg-card p-3 shadow-inner text-[11px] leading-5 font-mono overflow-auto">
                                                <div className="text-amber-600 dark:text-amber-300">{"{"}</div>
                                                <div className="pl-2"><span className="text-primary font-semibold">"id"</span>: <span className="text-positive">"sig_sample_01"</span>,</div>
                                                <div className="pl-2"><span className="text-primary font-semibold">"symbol"</span>: <span className="text-positive">"XAUUSD"</span>,</div>
                                                <div className="pl-2"><span className="text-primary font-semibold">"direction"</span>: <span className="text-positive">"long"</span>,</div>
                                                <div className="pl-2"><span className="text-primary font-semibold">"state"</span>: <span className="text-positive">"PENDING_ENTRY"</span>,</div>
                                                <div className="pl-2"><span className="text-primary font-semibold">"engines"</span>: <span className="text-amber-600 dark:text-amber-300">{"{"}</span></div>
                                                <div className="pl-4"><span className="text-primary font-semibold">"regime"</span>: <span className="text-positive">"trend"</span>,</div>
                                                <div className="pl-4"><span className="text-primary font-semibold">"score"</span>: <span className="text-info font-numeric">74</span></div>
                                                <div className="pl-2"><span className="text-amber-600 dark:text-amber-300">{"}"}</span>,</div>
                                                <div className="pl-2"><span className="text-primary font-semibold">"risk"</span>: <span className="text-amber-600 dark:text-amber-300">{"{"}</span></div>
                                                <div className="pl-4"><span className="text-primary font-semibold">"decision"</span>: <span className="text-positive">"approve"</span>,</div>
                                                <div className="pl-4"><span className="text-primary font-semibold">"code"</span>: <span className="text-positive">"OK"</span></div>
                                                <div className="pl-2"><span className="text-amber-600 dark:text-amber-300">{"}"}</span></div>
                                                <div className="text-amber-600 dark:text-amber-300">{"}"}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
                                    {(cardData.tiles || tiles).map((t: any) => (
                                        <div key={t.label} className="min-w-0">
                                            <dt className="truncate text-[11px] text-muted-foreground">{t.label}</dt>
                                            <dd className="mt-0.5 truncate font-numeric text-base font-semibold tracking-tight text-foreground">{t.value}</dd>
                                        </div>
                                    ))}
                                </dl>

                                <p className="mt-auto pt-2 text-[11px] leading-4 text-muted-foreground">{cardData.note}</p>
                            </div>
                        </div>
                    </div>
                </Reveal>
            </div>
        </section>
    );
}
