"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, Play } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
                    <div className="mt-10 overflow-hidden rounded-2xl border-none bg-[#141414] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
                        {/* Sample tabs, inline at the top of the card */}
                        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-2 py-1.5">
                            <span className="flex h-7 items-center gap-2 rounded-lg bg-[#0a0a0a] px-2.5 text-[10px] font-semibold text-foreground/70 shadow-md">
                                <span>sh</span>
                                <span className="text-foreground/40">terminal</span>
                                <span className="text-foreground/30">.env</span>
                            </span>
                            <div
                                role="tablist"
                                aria-label="Code samples"
                                className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
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
                                                    ? "bg-muted text-foreground shadow-xs"
                                                    : "text-muted-foreground hover:text-foreground",
                                            )}
                                        >
                                            {t.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <span className="flex shrink-0 items-center gap-1.5">
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
                                <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted/80 transition-colors"><Play size={10} /> Run</button>
                            </span>
                        </div>
                        <p className="border-b border-border px-3.5 py-2 text-[13px] leading-5 text-muted-foreground">
                            {active.desc}
                        </p>

                        <div className="flex items-center justify-between border-t border-border px-4 py-1.5">
                            <span className="truncate font-mono text-[11px] text-muted-foreground">{active.file} · UTF-8 · sample</span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">{tab === "pine" ? "Pine v6" : tab === "mql5" ? "MQL5" : "Set"}</span>
                        </div>
                        <div className="grid lg:grid-cols-[1.15fr_1fr] lg:divide-x lg:divide-border">
                            {/* Editor */}
                            <div className="flex min-h-85 min-w-0 flex-col">
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
                                <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border px-4 font-numeric text-[11px] text-muted-foreground">
                                    <span className="truncate">{active.file} · UTF-8 · sample</span>
                                    <span>Ln {active.code.split("\n").length}, Col 1</span>
                                </div>
                            </div>

                            {/* Curve + stats */}
                            <div className="flex min-h-85 flex-col p-4">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-semibold text-foreground">Sample equity</p>
                                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                                        40 closed trades
                                    </span>
                                </div>
                                <div className="h-44" role="img" aria-label="Sample equity curve">
                                    <div className="h-full rounded-xl bg-[#141414] p-2 shadow-md text-[11px]">
                                        <div className="mb-1 flex justify-between text-xs font-medium"><span>Live traces</span><span className="text-muted-foreground">ap-northeast</span></div>
                                        <ul className="space-y-1">
                                            {[{id:"req_7f4a1f",model:"llama-3.1-70b",done:true,pct:100,color:"#5cb87f"},{id:"req_7f49c1",model:"qwen-2.5-32b",done:false,pct:28,color:"#e2a63f"},{id:"req_7f49e6",model:"whisper-large-v3",done:false,pct:44,color:"#e2a63f"}].map(r=>
                                            <li key={r.id} className="grid grid-cols-[auto_1fr_2.75rem] items-center gap-3 rounded px-2 py-1 bg-white/[0.03]">
                                                <span className="size-1.5 rounded-full" style={{backgroundColor:r.color}}/>
                                                <span className="min-w-0"><span className="block truncate text-xs text-foreground">{r.id}</span><span className="block truncate text-[10px] text-muted-foreground">{r.model}</span></span>
                                                <div className="relative h-3 rounded-full bg-[#2b2b2b] overflow-hidden"><div className="absolute inset-y-0 left-0" style={{width:`${r.pct}%`,backgroundColor:r.color}}/><span className="absolute inset-y-0 right-0 flex items-center px-1 text-[10px] font-semibold">{r.done?"Done":"Queue"} <span className="opacity-75">{r.pct}%</span></span></div>
                                            </li>)}
                                        </ul>
                                    </div>
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
                    </div>
                </Reveal>
            </div>
            {/* Tab-specific right cards matching reference */}
            <div className="mx-auto max-w-5xl mt-6 grid lg:grid-cols-3 gap-4">
                {tab === "pine" && (
                    <div className="rounded-2xl bg-[#141414] p-3 shadow-md text-[11px]">
                        <div className="mb-2 flex justify-between text-xs font-medium"><span>Training loss</span><span className="text-muted-foreground">Epoch 3 of 3</span></div>
                        <div className="h-32 w-full rounded-lg bg-[#0a0a0a] flex items-end gap-1 px-1 pb-1">
                            {[40,55,50,70,65,80,75,90,85,100,95].map((h,i)=><div key={i} className="flex-1 rounded-t bg-amber-400/60" style={{height:`${h}%`}}/>)}
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs"><div><span className="block text-muted-foreground">Step</span><span className="font-semibold">1,240 / 1,500</span></div><div><span className="block text-muted-foreground">Loss</span><span className="font-semibold">0.412</span></div><div><span className="block text-muted-foreground">Time left</span><span className="font-semibold">6 min</span></div></div>
                    </div>
                )}
                {tab === "mql5" && (
                    <div className="rounded-2xl bg-[#141414] p-3 shadow-md text-[11px]">
                        <div className="mb-2 flex justify-between text-xs font-medium"><span>Batch jobs</span><span className="text-muted-foreground">Last 24h</span></div>
                        <div className="space-y-1.5">
                            {[{id:"batch_21a",req:"120,000",pct:100,status:"Done"},{id:"batch_21b",req:"48,500",pct:72,status:"72%"},{id:"batch_21c",req:"9,200",pct:18,status:"18%"},{id:"batch_21d",req:"250,000",pct:0,status:"Queued"}].map(b=><div key={b.id} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 text-xs"><span className="font-mono truncate">{b.id}</span><span className="tabular-nums">{b.req}</span><div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden"><div className="h-full rounded-full bg-[var(--brand)]" style={{width:`${b.pct}%`}}/></div><span className="text-right">{b.status}</span></div>)}
                        </div>
                    </div>
                )}
                {tab === "env" && (
                    <div className="rounded-2xl bg-[#141414] p-3 shadow-md text-[11px]">
                        <div className="mb-2 flex justify-between text-xs font-medium"><span>Tool call</span><span className="text-muted-foreground">Valid</span></div>
                        <pre className="rounded-lg bg-black/30 p-2 text-[11px] leading-5">{"{\"name\":\"refund_order\",\"arguments\":{\"order_id\":\"4821\"}}"}</pre>
                        <ul className="mt-2 space-y-1 text-xs text-foreground/80"><li>✓ Matched refund_order</li><li>✓ JSON schema valid</li><li>✓ Ready for handler — 112 ms</li></ul>
                    </div>
                )}
            </div>
        </section>
    );
}
