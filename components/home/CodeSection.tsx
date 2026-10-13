"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Reveal from "./Reveal";

/**
 * Code section ("Speak Pine and MQL5. Keep the tools you have."): five
 * switchable sample tabs — Pine import, MQL5 export, set file, signal
 * payload — each with a read-only snippet and an illustrative readout.
 * Nothing executes; the panel opens in Strategy Lab instead.
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

const FEATURES = [
    { title: "Pine Script v6 import", copy: "Strategies are read directly — signals, not screenshots." },
    { title: "MQL5 EA export", copy: "Validated systems leave the lab as terminal-ready experts." },
    { title: "Set files included", copy: "Parameters travel with every marketplace listing." },
    { title: "Deterministic readout", copy: "The same engines score every symbol, every timeframe." },
    { title: "Docs that match the UI", copy: "Guides describe the routes and controls that exist." },
] as const;

const TABS = [
    {
        id: "pine",
        label: "Pine import",
        file: "vault-breakout.pine · sample",
        code: PINE_SAMPLE,
        readout: [
            ["Regime", "Trend · Bullish"],
            ["Market score", "74 / 100"],
            ["Liquidity", "Sell-side swept"],
            ["Risk check", "Pass · 1% risk"],
        ],
    },
    {
        id: "mql5",
        label: "MQL5 export",
        file: "VaultBreakout.mq5 · sample",
        code: MQL5_SAMPLE,
        readout: [
            ["Build", "Clean compile"],
            ["Risk gate", "Checked pre-trade"],
            ["Execution", "EA bridge"],
            ["Logging", "Every fill stored"],
        ],
    },
    {
        id: "setfile",
        label: "Set file",
        file: "xauusd-m15.set.json · sample",
        code: SETFILE_SAMPLE,
        readout: [
            ["Symbol", "XAUUSD · M15"],
            ["Risk", "1.0% per trade"],
            ["Session", "London"],
            ["Portable", "Ships with listing"],
        ],
    },
    {
        id: "signal",
        label: "Signal payload",
        file: "signal.json · sample",
        code: SIGNAL_SAMPLE,
        readout: [
            ["State", "PENDING_ENTRY"],
            ["Engines", "Regime · 74"],
            ["Decision", "Approve · OK"],
            ["Outcome", "Decided by TP/SL"],
        ],
    },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function CodeSection() {
    const [tab, setTab] = useState<TabId>("pine");
    const active = TABS.find((t) => t.id === tab) ?? TABS[0];
    return (
        <section className="border-b border-border bg-muted/30">
            <div className="page-container grid items-center gap-10 py-14 md:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
                <Reveal>
                    <div>
                        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                            Developer-friendly
                        </p>
                        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                            Speak Pine and MQL5. Keep the tools you have.
                        </h2>
                        <ul className="mt-8 space-y-4">
                            {FEATURES.map(({ title, copy }) => (
                                <li key={title} className="flex items-start gap-3">
                                    <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-positive/12 text-positive">
                                        <Check size={11} strokeWidth={3} aria-hidden />
                                    </span>
                                    <span>
                                        <span className="block text-sm font-semibold text-foreground">{title}</span>
                                        <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">{copy}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                            <Button render={<Link href="/docs" />} variant="outline">
                                Read the docs <ArrowRight data-icon="inline-end" />
                            </Button>
                            <Button render={<Link href="/strategy-lab" />}>
                                Open Strategy Lab <ArrowRight data-icon="inline-end" />
                            </Button>
                        </div>
                    </div>
                </Reveal>

                <Reveal delay={120}>
                    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-md">
                        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="gap-0">
                            <div className="border-b border-border px-3 pt-2">
                                <TabsList className="h-8 w-full justify-start gap-1 overflow-x-auto rounded-lg">
                                    {TABS.map((t) => (
                                        <TabsTrigger key={t.id} value={t.id} className="flex-1 whitespace-nowrap px-2 text-xs">
                                            {t.label}
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </div>
                        </Tabs>
                        <div className="flex items-center justify-between border-b border-border px-4 py-2">
                            <span className="flex items-center gap-1.5" aria-hidden>
                                <span className="h-2.5 w-2.5 rounded-full bg-negative/80" />
                                <span className="h-2.5 w-2.5 rounded-full bg-warning/80" />
                                <span className="h-2.5 w-2.5 rounded-full bg-positive/80" />
                            </span>
                            <span className="font-numeric text-[11px] text-muted-foreground">{active.file}</span>
                            <Link href="/strategy-lab" className="text-[11px] font-semibold text-primary hover:underline">
                                Open in lab
                            </Link>
                        </div>
                        <pre className="min-h-56 overflow-x-auto p-4 font-numeric text-xs leading-5 text-foreground" aria-label={`Sample ${active.label}`}>
                            <code>{active.code}</code>
                        </pre>
                        <div className="border-t border-border px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                                Readout · sample
                            </p>
                            <dl className="mt-2 grid grid-cols-2 gap-2">
                                {active.readout.map(([k, v]) => (
                                    <div key={k} className="rounded-lg bg-muted/60 px-3 py-2">
                                        <dt className="text-[11px] text-muted-foreground">{k}</dt>
                                        <dd className="mt-0.5 font-numeric text-xs font-semibold text-foreground">{v}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    </div>
                </Reveal>
            </div>
        </section>
    );
}
