"use client";

import Link from "next/link";
import {
    Activity,
    ArrowUpRight,
    Brain,
    Copy,
    Gauge,
    Landmark,
    ShieldCheck,
} from "lucide-react";
import Reveal from "./Reveal";
import BrandLogo, { type BrandLogoName } from "./BrandLogos";

/**
 * "How the platform connects" — real brand marks (TradingView, MetaTrader 5,
 * Pine Script v6, MQL5, Telegram…) wired together with a glowing animated
 * connection flow: live quotes come in from TradingView, are read and
 * validated here, and execute out through MT5 to your broker.
 */

type Stage = {
    logo?: BrandLogoName;
    icon?: typeof Brain;
    badge: string;
    name: string;
    sub: string;
    role: string;
    tone: "brand" | "primary";
    href: string;
    /** One-liner shown on hover over the stage's logo/icon chip. */
    tip: string;
};

const STAGES: Stage[] = [
    {
        logo: "tradingview",
        badge: "TV",
        name: "TradingView",
        sub: "Live charts & ideas",
        role: "Live quotes stream into the ticker at the top of this page and fuel every analysis.",
        tone: "brand",
        href: "/account/tradingview",
        tip: "Streams live quotes into this page.",
    },
    {
        icon: Brain,
        badge: "AI",
        name: "Analysis engines",
        sub: "Deterministic + AI",
        role: "Eight pure engines read the feed; the AI layer explains them — it never overrides them.",
        tone: "primary",
        href: "/analysis",
        tip: "Reads the live feed and builds the plan.",
    },
    {
        icon: ShieldCheck,
        badge: "RK",
        name: "Risk validator",
        sub: "Pre-trade controls",
        role: "Rebuilds the plan from history and rejects anything that fails limits or the drawdown guard.",
        tone: "primary",
        href: "/account",
        tip: "Blocks any plan that fails the limits.",
    },
    {
        logo: "mt5",
        badge: "MT5",
        name: "MetaTrader 5",
        sub: "MQL5 Expert Advisor",
        role: "A risk-gated gateway hands approved orders to a custom EA running in your terminal.",
        tone: "brand",
        href: "/account/trading-access",
        tip: "Executes approved orders via your EA.",
    },
    {
        icon: Landmark,
        badge: "BK",
        name: "Your broker",
        sub: "Order fills",
        role: "The order reaches the market and the fill confirms back into the console — closed loop.",
        tone: "primary",
        href: "/broker-compare",
        tip: "Fills the order and closes the loop.",
    },
];

type Integration = {
    logo?: BrandLogoName;
    icon?: typeof Copy;
    mono: string;
    name: string;
    /** Tooltip copy shown on hover — what this integration actually does. */
    note: string;
};

const INTEGRATIONS: Integration[] = [
    {
        logo: "tradingview",
        mono: "TV",
        name: "TradingView",
        note: "Live quotes from your watchlists stream into the ticker and the analysis engines.",
    },
    {
        logo: "mt5",
        mono: "MT5",
        name: "MetaTrader 5",
        note: "Approved orders execute through a custom MQL5 Expert Advisor in your terminal.",
    },
    {
        logo: "mt4",
        mono: "MT4",
        name: "MetaTrader 4",
        note: "The same risk-gated gateway for legacy MT4 terminals.",
    },
    {
        logo: "pine",
        mono: "PS",
        name: "Pine Script v6",
        note: "Your Pine strategies are read directly — signals, not screenshots.",
    },
    {
        logo: "mql5",
        mono: "MQ",
        name: "MQL5",
        note: "Custom EAs and indicators plug straight into the execution pipeline.",
    },
    {
        logo: "telegram",
        mono: "TG",
        name: "Telegram",
        note: "Signal previews and alerts are mirrored to your channels.",
    },
    {
        icon: Copy,
        mono: "CT",
        name: "Copy Trading",
        note: "Mirror verified strategies to your own account in one click.",
    },
    {
        icon: Activity,
        mono: "LV",
        name: "Live Console",
        note: "See every fill, rejection and risk check as it happens.",
    },
];

/** Connection arcs drawn between the 5 stage cards (lg layout only). */
const CONNECTOR_PATHS = [
    "M 165 60 C 190 150, 210 150, 235 60",
    "M 365 60 C 390 150, 410 150, 435 60",
    "M 565 60 C 590 150, 610 150, 635 60",
    "M 765 60 C 790 150, 810 150, 835 60",
];

function ConnectorLayer() {
    return (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-0 hidden -translate-y-1/2 lg:block" aria-hidden="true">
            <div className="hero-radial left-1/2 top-1/2 h-[420px] w-[720px] -translate-x-1/2 -translate-y-1/2" />
            <svg
                className="relative h-36 w-full"
                viewBox="0 0 1000 160"
                preserveAspectRatio="none"
                fill="none"
            >
                {CONNECTOR_PATHS.map((d, i) => (
                    <g key={i}>
                        <path d={d} stroke="var(--border)" strokeOpacity={0.55} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                        <path d={d} className="flow-line" stroke="var(--primary)" strokeOpacity={0.65} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                        <path d={d} className="flow-line-accent" stroke="var(--primary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    </g>
                ))}
            </svg>
            {[20, 40, 60, 80].map((left, i) => (
                <span
                    key={left}
                    className={`eco-node ${i === 1 ? "eco-node-positive" : ""} top-1/2`}
                    style={{ left: `${left}%`, animationDelay: `${i * 420}ms` }}
                />
            ))}
        </div>
    );
}

function StageCard({ stage, index }: { stage: Stage; index: number }) {
    const Icon = stage.icon;
    return (
        <Link
            href={stage.href}
            className="eco-card group relative z-10 block rounded-lg border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_0_28px_-10px_color-mix(in_oklch,var(--primary)_55%,transparent)]"
        >
            <div className="flex items-start justify-between">
                <span className="relative">
                    <span className="eco-orbit transition-transform duration-300 group-hover:scale-105">
                        <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
                            {stage.logo ? (
                                <BrandLogo name={stage.logo} size={40} />
                            ) : (
                                Icon && (
                                    <span className="flex h-full w-full items-center justify-center text-primary">
                                        <Icon size={18} className="transition-transform duration-300 group-hover:scale-110" />
                                    </span>
                                )
                            )}
                        </span>
                        <span aria-hidden="true" className="eco-orbit-spin">
                            <span className="eco-orbit-ring" />
                            <span className="eco-orbit-dot" />
                            <span className="eco-orbit-dot-2" />
                        </span>
                    </span>
                    <span
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs leading-4 text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    >
                        {stage.tip}
                    </span>
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground transition-colors duration-300 group-hover:text-primary">
                    0{index + 1}
                    <ArrowUpRight size={12} className="opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                </span>
            </div>
            <h3 className="mt-5 text-base font-semibold text-foreground">{stage.name}</h3>
            <p className="mt-0.5 text-xs font-medium text-primary">{stage.sub}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{stage.role}</p>
        </Link>
    );
}

export default function EcosystemSection() {
    return (
        <section className="border-b border-border bg-background">
            <div className="page-container overflow-hidden py-14 md:py-20">
                <Reveal>
                    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Connected ecosystem</p>
                            <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-5xl">The tools you already use, connected as one pipeline.</h2>
                        </div>
                        <p className="max-w-md text-sm leading-6 text-muted-foreground">
                            Nothing is rebuilt in a silo. Live quotes come in from TradingView, strategies are read and validated here, and execution flows out through MetaTrader to your broker.
                        </p>
                    </div>
                </Reveal>

                <Reveal delay={100}>
                    <div className="eco-stage-wrap relative mt-10">
                        <ConnectorLayer />
                        <div className="relative grid gap-3 lg:grid-cols-5 lg:gap-3">
                            {STAGES.map((stage, index) => (
                                <StageCard key={stage.name} stage={stage} index={index} />
                            ))}
                        </div>
                    </div>
                </Reveal>

                <Reveal delay={180}>
                    <div className="mt-8 flex flex-wrap items-center gap-2">
                        {INTEGRATIONS.map(({ logo, icon: Icon, mono, name, note }) => (
                            <div
                                key={name}
                                className="group/tip relative flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 text-micro font-medium text-muted-foreground transition-all duration-300 hover:-translate-y-px hover:border-primary/40 hover:text-foreground active:scale-[0.98]"
                            >
                                <span className="eco-orbit eco-orbit-sm">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                                        {logo ? (
                                            <BrandLogo name={logo} size={24} />
                                        ) : Icon ? (
                                            <span className="flex items-center justify-center">
                                                <Icon size={13} className="text-primary" />
                                            </span>
                                        ) : (
                                            <span className="font-mono text-micro font-bold text-primary">{mono}</span>
                                        )}
                                    </span>
                                    <span aria-hidden="true" className="eco-orbit-spin">
                                        <span className="eco-orbit-ring" />
                                        <span className="eco-orbit-dot" />
                                        <span className="eco-orbit-dot-2" />
                                    </span>
                                </span>
                                {name}
                                <span
                                    role="tooltip"
                                    className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs leading-4 text-muted-foreground opacity-0 shadow-[0_8px_24px_-12px_color-mix(in_oklch,var(--primary)_45%,transparent)] transition-opacity duration-200 group-hover/tip:opacity-100"
                                >
                                    {note}
                                </span>
                            </div>
                        ))}
                        <span className="px-1 text-micro text-muted-foreground">…and every broker you already use.</span>
                    </div>
                </Reveal>

                <Reveal delay={240}>
                    <p className="mt-8 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                        <Gauge size={14} className="mt-0.5 shrink-0 text-primary" />
                        The connection is visible end to end: the ticker above is streaming TradingView&apos;s live quotes right now — same feed the analysis engines consume.
                    </p>
                </Reveal>
            </div>
        </section>
    );
}
