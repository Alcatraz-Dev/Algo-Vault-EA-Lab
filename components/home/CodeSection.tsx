"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import Reveal from "./Reveal";

/**
 * Code section ("Speak Pine and MQL5. Keep the tools you have."): a
 * read-only sample Pine Script v6 window beside an illustrative engine
 * readout, plus the integration checklist. The snippet is a labeled
 * sample — it opens in Strategy Lab rather than executing anything.
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

const FEATURES = [
    { title: "Pine Script v6 import", copy: "Strategies are read directly — signals, not screenshots." },
    { title: "MQL5 EA export", copy: "Validated systems leave the lab as terminal-ready experts." },
    { title: "Set files included", copy: "Parameters travel with every marketplace listing." },
    { title: "Deterministic readout", copy: "The same engines score every symbol, every timeframe." },
    { title: "Docs that match the UI", copy: "Guides describe the routes and controls that exist." },
] as const;

const READOUT = [
    ["Regime", "Trend · Bullish"],
    ["Market score", "74 / 100"],
    ["Liquidity", "Sell-side swept"],
    ["Risk check", "Pass · 1% risk"],
] as const;

export default function CodeSection() {
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
                        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                            <span className="flex items-center gap-1.5" aria-hidden>
                                <span className="h-2.5 w-2.5 rounded-full bg-negative/80" />
                                <span className="h-2.5 w-2.5 rounded-full bg-warning/80" />
                                <span className="h-2.5 w-2.5 rounded-full bg-positive/80" />
                            </span>
                            <span className="font-numeric text-[11px] text-muted-foreground">vault-breakout.pine · sample</span>
                            <Link href="/strategy-lab" className="text-[11px] font-semibold text-primary hover:underline">
                                Open in lab
                            </Link>
                        </div>
                        <pre className="overflow-x-auto p-4 font-numeric text-xs leading-5 text-foreground" aria-label="Sample Pine Script strategy">
                            <code>{PINE_SAMPLE}</code>
                        </pre>
                        <div className="border-t border-border px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                                Engine readout · sample
                            </p>
                            <dl className="mt-2 grid grid-cols-2 gap-2">
                                {READOUT.map(([k, v]) => (
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
