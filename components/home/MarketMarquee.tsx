"use client";

import { InfiniteMovingCards } from "@/components/ui/infinite-moving-cards";
import Reveal from "./Reveal";

/**
 * Product credibility as Aceternity `InfiniteMovingCards`: a slow,
 * pause-on-hover marquee of the platform's real modules. Every card names
 * an existing module, its route, and one factual line — no user counts,
 * no testimonials, no performance claims.
 */
const MODULES = [
    {
        quote: "Discover structural patterns and export Pine Script v6 or MQL5.",
        name: "Strategy Lab",
        title: "/strategy-lab",
    },
    {
        quote: "Deterministic simulations with real spread, slippage, and commission.",
        name: "Backtest Studio",
        title: "/backtests",
    },
    {
        quote: "Regime, liquidity, volume, and VWAP structure across timeframes.",
        name: "Market Scanner",
        title: "/scanner",
    },
    {
        quote: "Pre-trade validation and drawdown guards on every entry.",
        name: "Risk Engine",
        title: "/risk",
    },
    {
        quote: "AI-normalized signals with a canonical, audited lifecycle.",
        name: "Signal Center",
        title: "/signals",
    },
    {
        quote: "Equity, drawdown, and gateway heartbeats in one console.",
        name: "Live Monitoring",
        title: "/live",
    },
    {
        quote: "A risk-gated HTTP bridge to MetaTrader via a custom MQL5 EA.",
        name: "Execution Gateway",
        title: "/account/trading-access",
    },
    {
        quote: "Verified EAs, indicators, and set files with license activation.",
        name: "Marketplace",
        title: "/marketplace",
    },
];

export default function MarketMarquee() {
    return (
        <section className="overflow-hidden border-b border-border bg-muted/30">
            <div className="page-container pb-4 pt-14 md:pt-20">
                <Reveal>
                    <div className="mx-auto max-w-2xl text-center">
                        <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                            The whole loop
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                        </p>
                        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                            Every stage stays connected.
                        </h2>
                        <p className="mt-4 text-sm leading-6 text-pretty text-muted-foreground sm:text-[0.9375rem]">
                            One symbol, one timeframe, one risk context — from first scan to monitored fill. Hover to pause.
                        </p>
                    </div>
                </Reveal>
            </div>
            <Reveal delay={100}>
                <InfiniteMovingCards items={MODULES} direction="left" speed="slow" />
            </Reveal>
            <div className="page-container pb-14 md:pb-20" />
        </section>
    );
}
