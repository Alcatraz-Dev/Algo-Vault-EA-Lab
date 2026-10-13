"use client";

import Link from "next/link";
import { Activity, ArrowRight, Copy, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import Reveal from "./Reveal";
import BrandLogo, { type BrandLogoName } from "./BrandLogos";

/**
 * Ecosystem as a logo cloud.
 *
 * A calm, centered cloud of the tools AlgoVault connects — brand marks
 * with names, each linking to the real route behind it (Telegram has no
 * standalone route, so it renders as an annotated mark instead of a
 * link). Hover/focus reveals a one-line note per tool. No flow lines, no
 * glow: the section reads at a glance, like a classic SaaS logo cloud.
 */

type Logo = {
    logo?: BrandLogoName;
    icon?: typeof Copy;
    name: string;
    note: string;
    href?: string;
};

const LOGOS: Logo[] = [
    { logo: "tradingview", name: "TradingView", note: "Live quotes stream into the ticker and the analysis engines.", href: "/account/tradingview" },
    { logo: "mt5", name: "MetaTrader 5", note: "Approved orders execute through a custom MQL5 Expert Advisor.", href: "/account/trading-access" },
    { logo: "mt4", name: "MetaTrader 4", note: "The same risk-gated gateway for legacy MT4 terminals.", href: "/account/trading-access" },
    { logo: "pine", name: "Pine Script v6", note: "Your Pine strategies are read directly — signals, not screenshots.", href: "/strategy-lab" },
    { logo: "mql5", name: "MQL5", note: "Custom EAs and indicators plug straight into the execution pipeline.", href: "/marketplace" },
    { logo: "telegram", name: "Telegram", note: "Signal previews and alerts are mirrored to your channels." },
    { icon: Copy, name: "Copy Trading", note: "Mirror verified strategies to your own account in one click.", href: "/copy-trading" },
    { icon: Activity, name: "Live Console", note: "See every fill, rejection and risk check as it happens.", href: "/live" },
];

function LogoCell({ item }: { item: Logo }) {
    const Icon = item.icon;
    const inner = (
        <>
            <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-border bg-background transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                {item.logo ? (
                    <BrandLogo name={item.logo} size={44} />
                ) : (
                    Icon && <Icon size={18} className="text-primary" aria-hidden />
                )}
            </span>
            <span className="mt-3 block text-[13px] font-semibold text-foreground">{item.name}</span>
            <span
                role="tooltip"
                className="pointer-events-none absolute -top-2 left-1/2 z-30 w-52 max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs leading-5 text-muted-foreground opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-within:opacity-100"
            >
                {item.note}
            </span>
        </>
    );

    const classes =
        "group relative flex flex-col items-center rounded-xl px-4 py-6 text-center outline-none transition-colors duration-200 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring";
    return item.href ? (
        <Link href={item.href} aria-label={`${item.name} — ${item.note}`} className={classes}>
            {inner}
        </Link>
    ) : (
        <div className={classes}>{inner}</div>
    );
}

export default function EcosystemSection() {
    return (
        <section className="border-b border-border bg-background">
            <div className="page-container py-14 md:py-20">
                <Reveal>
                    <div className="mx-auto max-w-2xl text-center">
                        <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                            Connected ecosystem
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                        </p>
                        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                            The tools you already use, connected as one pipeline.
                        </h2>
                        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-pretty text-muted-foreground sm:text-[0.9375rem]">
                            Nothing is rebuilt in a silo. Quotes flow in, strategies are
                            validated here, and execution flows out through MetaTrader.
                        </p>
                    </div>
                </Reveal>

                <Reveal delay={100}>
                    <div className="mx-auto mt-10 grid max-w-4xl grid-cols-2 gap-2 sm:grid-cols-4">
                        {LOGOS.map((item) => (
                            <LogoCell key={item.name} item={item} />
                        ))}
                    </div>
                </Reveal>

                <Reveal delay={160}>
                    <div className="mx-auto mt-8 flex max-w-4xl flex-col items-center justify-between gap-3 border-t border-border pt-5 sm:flex-row">
                        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                            <Gauge size={14} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                            The ticker above streams TradingView&apos;s live quotes — the same feed the engines consume.
                        </p>
                        <Button render={<Link href="/live" />} size="sm" variant="outline" className="shrink-0">
                            Open live console <ArrowRight data-icon="inline-end" />
                        </Button>
                    </div>
                </Reveal>
            </div>
        </section>
    );
}
