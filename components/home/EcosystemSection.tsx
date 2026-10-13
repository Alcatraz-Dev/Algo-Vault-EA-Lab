"use client";

import Link from "next/link";
import { Activity, ArrowRight, Copy, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import SiteLogo from "@/components/ui/site-logo";
import Reveal from "./Reveal";
import BrandLogo, { type BrandLogoName } from "./BrandLogos";

/**
 * Ecosystem as a hub-and-spoke flow map.
 *
 * AlgoVault sits at the center: four input tools converge from one side
 * ("Feeds in") and four execution surfaces leave from the other
 * ("Fills out"). Base hairlines carry the geometry; an ember dash overlay
 * pulses along each path (CSS animation, stilled by the global
 * reduced-motion guard). Mobile gets a vertical variant of the same map.
 *
 * Every node links to the route behind it, except Telegram, which has no
 * standalone route and renders as an annotated mark.
 */

type Spoke = {
    logo?: BrandLogoName;
    icon?: typeof Copy;
    name: string;
    note: string;
    href?: string;
};

const INPUTS: Spoke[] = [
    { logo: "tradingview", name: "TradingView", note: "Live quotes stream into the ticker and the engines.", href: "/account/tradingview" },
    { logo: "pine", name: "Pine Script v6", note: "Your Pine strategies are read directly.", href: "/strategy-lab" },
    { logo: "mql5", name: "MQL5", note: "Custom EAs and indicators plug into the pipeline.", href: "/marketplace" },
    { logo: "telegram", name: "Telegram", note: "Signal previews mirrored to your channels." },
];

const OUTPUTS: Spoke[] = [
    { logo: "mt5", name: "MetaTrader 5", note: "Approved orders via a custom MQL5 EA.", href: "/account/trading-access" },
    { logo: "mt4", name: "MetaTrader 4", note: "The same risk-gated gateway for MT4.", href: "/account/trading-access" },
    { icon: Copy, name: "Copy Trading", note: "Mirror verified strategies in one click.", href: "/copy-trading" },
    { icon: Activity, name: "Live Console", note: "Fills, rejections, and heartbeats live.", href: "/live" },
];

/* Desktop geometry (viewBox 1200x400, hub at 600,200). */
const LEFT_X = 170;
const RIGHT_X = 1030;
const ROW_Y = [64, 155, 245, 336];
const HUB_L = 560;
const HUB_R = 640;

/* Mobile geometry (viewBox 360x440, hub at 180,220). */
const M_XS = [60, 140, 220, 300];
const M_TOP = 48;
const M_BOTTOM = 392;

function SpokeNode({ spoke, style }: { spoke: Spoke; style: React.CSSProperties }) {
    const Icon = spoke.icon;
    const tile = (
        <span className="grid size-11 place-items-center overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 sm:size-12">
            {spoke.logo ? (
                <BrandLogo name={spoke.logo} size={40} />
            ) : (
                Icon && <Icon size={17} className="text-primary" aria-hidden />
            )}
        </span>
    );
    const tip = (
        <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-52 max-w-[calc(100vw-3rem)] -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs leading-5 text-muted-foreground opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-within:opacity-100"
        >
            {spoke.note}
        </span>
    );
    const cls =
        "group absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return spoke.href ? (
        <Link href={spoke.href} aria-label={`${spoke.name} — ${spoke.note}`} title={spoke.name} className={cls} style={style}>
            {tile}
            {tip}
        </Link>
    ) : (
        <div aria-label={`${spoke.name} — ${spoke.note}`} title={spoke.name} className={cls} style={style}>
            {tile}
            {tip}
        </div>
    );
}

function FlowMap() {
    return (
        <figure className="relative mx-auto mt-10 w-full max-w-6xl px-2 sm:px-4">
            {/* ── Mobile map ── */}
            <div className="relative mx-auto w-full max-w-sm md:hidden" style={{ aspectRatio: "360 / 440" }}>
                <svg viewBox="0 0 360 440" className="pointer-events-none absolute inset-0 size-full" fill="none" aria-hidden="true">
                    <defs>
                        <filter id="vault-flow-glow-m" x="-20%" y="-40%" width="140%" height="180%">
                            <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>
                    {M_XS.map((x) => (
                        <g key={`in-${x}`}>
                            <path d={`M ${x} 70 V 140 H 180 V 192`} stroke="var(--primary)" strokeOpacity="0.16" strokeWidth="7" strokeLinecap="round" />
                            <path d={`M ${x} 70 V 140 H 180 V 192`} stroke="var(--border-color)" strokeWidth="1.25" strokeLinecap="round" />
                        </g>
                    ))}
                    {M_XS.map((x) => (
                        <g key={`out-${x}`}>
                            <path d={`M 180 248 V 300 H ${x} V 368`} stroke="var(--primary)" strokeOpacity="0.16" strokeWidth="7" strokeLinecap="round" />
                            <path d={`M 180 248 V 300 H ${x} V 368`} stroke="var(--border-color)" strokeWidth="1.25" strokeLinecap="round" />
                        </g>
                    ))}
                    <g className="motion-reduce:hidden">
                        {M_XS.map((x) => (
                            <path key={`fi-${x}`} d={`M ${x} 70 V 140 H 180 V 192`} stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" filter="url(#vault-flow-glow-m)" className="folio-flow" />
                        ))}
                        {M_XS.map((x) => (
                            <path key={`fo-${x}`} d={`M 180 248 V 300 H ${x} V 368`} stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" filter="url(#vault-flow-glow-m)" className="folio-flow" />
                        ))}
                    </g>
                </svg>
                <span className="absolute z-10 inline-flex -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground" style={{ left: "50%", top: "27%" }}>
                    Feeds in
                </span>
                <span className="absolute z-10 inline-flex -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground" style={{ left: "50%", top: "73%" }}>
                    Fills out
                </span>
                <div className="absolute z-20 -translate-x-1/2 -translate-y-1/2" style={{ left: "50%", top: "50%" }}>
                    <HubMark />
                </div>
                {INPUTS.map((s, i) => (
                    <SpokeNode key={s.name} spoke={s} style={{ left: `${(M_XS[i] / 360) * 100}%`, top: `${(M_TOP / 440) * 100}%` }} />
                ))}
                {OUTPUTS.map((s, i) => (
                    <SpokeNode key={s.name} spoke={s} style={{ left: `${(M_XS[i] / 360) * 100}%`, top: `${(M_BOTTOM / 440) * 100}%` }} />
                ))}
            </div>

            {/* ── Desktop map ── */}
            <div className="relative hidden w-full md:block" style={{ aspectRatio: "1200 / 400" }}>
                <svg viewBox="0 0 1200 400" className="pointer-events-none absolute inset-0 size-full" fill="none" aria-hidden="true">
                    <defs>
                        <filter id="vault-flow-glow" x="-20%" y="-40%" width="140%" height="180%">
                            <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>
                    {ROW_Y.map((y) => (
                        <g key={`in-${y}`}>
                            <path d={`M ${LEFT_X + 28} ${y} H ${HUB_L}`} stroke="var(--primary)" strokeOpacity="0.16" strokeWidth="7" strokeLinecap="round" />
                            <path d={`M ${LEFT_X + 28} ${y} H ${HUB_L}`} stroke="var(--border-color)" strokeWidth="1.25" strokeLinecap="round" />
                            <circle cx={HUB_L} cy={y} r="3" fill="var(--card)" stroke="var(--primary)" strokeWidth="1.25" />
                        </g>
                    ))}
                    {ROW_Y.map((y) => (
                        <g key={`out-${y}`}>
                            <path d={`M ${HUB_R} ${y} H ${RIGHT_X - 28}`} stroke="var(--primary)" strokeOpacity="0.16" strokeWidth="7" strokeLinecap="round" />
                            <path d={`M ${HUB_R} ${y} H ${RIGHT_X - 28}`} stroke="var(--border-color)" strokeWidth="1.25" strokeLinecap="round" />
                            <circle cx={HUB_R} cy={y} r="3" fill="var(--card)" stroke="var(--primary)" strokeWidth="1.25" />
                        </g>
                    ))}
                    <g className="motion-reduce:hidden">
                        {ROW_Y.map((y) => (
                            <path key={`fi-${y}`} d={`M ${LEFT_X + 28} ${y} H ${HUB_L}`} stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" filter="url(#vault-flow-glow)" className="folio-flow" />
                        ))}
                        {ROW_Y.map((y) => (
                            <path key={`fo-${y}`} d={`M ${HUB_R} ${y} H ${RIGHT_X - 28}`} stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" filter="url(#vault-flow-glow)" className="folio-flow" />
                        ))}
                    </g>
                </svg>
                <span className="absolute z-10 inline-flex -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground" style={{ left: `${(LEFT_X / 1200) * 100}%`, top: "2%" }}>
                    Feeds in
                </span>
                <span className="absolute z-10 inline-flex -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground" style={{ left: `${(RIGHT_X / 1200) * 100}%`, top: "2%" }}>
                    Fills out
                </span>
                <p className="absolute -translate-x-1/2 text-[11px] whitespace-nowrap text-muted-foreground" style={{ left: `${(LEFT_X / 1200) * 100}%`, bottom: "0%" }}>
                    Live from the market
                </p>
                <p className="absolute -translate-x-1/2 text-[11px] whitespace-nowrap text-muted-foreground" style={{ left: `${(RIGHT_X / 1200) * 100}%`, bottom: "0%" }}>
                    Validated before it moves
                </p>
                <div className="absolute z-20 -translate-x-1/2 -translate-y-1/2" style={{ left: "50%", top: "50%" }}>
                    <HubMark />
                </div>
                {INPUTS.map((s, i) => (
                    <SpokeNode key={s.name} spoke={s} style={{ left: `${(LEFT_X / 1200) * 100}%`, top: `${(ROW_Y[i] / 400) * 100}%` }} />
                ))}
                {OUTPUTS.map((s, i) => (
                    <SpokeNode key={s.name} spoke={s} style={{ left: `${(RIGHT_X / 1200) * 100}%`, top: `${(ROW_Y[i] / 400) * 100}%` }} />
                ))}
            </div>
            <figcaption className="sr-only">
                TradingView, Pine Script, MQL5, and Telegram feed into AlgoVault. MetaTrader 5, MetaTrader 4, copy trading, and the live console carry validated execution out.
            </figcaption>
        </figure>
    );
}

function HubMark() {
    return (
        <span className="relative grid size-14 place-items-center sm:size-16">
            <span aria-hidden className="absolute inset-0 animate-ping rounded-2xl bg-primary/20 motion-reduce:animate-none" />
            <span className="relative grid size-14 place-items-center rounded-2xl border border-primary/40 bg-card shadow-lg sm:size-16">
                <SiteLogo size={30} />
            </span>
        </span>
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
                            Market data flows in from the left, validated execution
                            leaves on the right — hover any tool to see its role.
                        </p>
                    </div>
                </Reveal>

                <Reveal delay={100}>
                    <FlowMap />
                </Reveal>

                <Reveal delay={160}>
                    <div className="mx-auto mt-6 flex max-w-4xl flex-col items-center justify-between gap-3 border-t border-border pt-5 sm:flex-row">
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
