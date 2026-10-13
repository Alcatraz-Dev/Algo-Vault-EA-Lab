"use client";

import Link from "next/link";
import {
    Activity,
    Brain,
    ChevronDown,
    ChevronRight,
    Copy,
    FlaskConical,
    Gauge,
    ShieldCheck,
} from "lucide-react";
import { CardSpotlight } from "@/components/ui/card-spotlight";
import { Button as MovingButton } from "@/components/ui/moving-border";
import { Button } from "@/components/ui/button";
import Reveal from "./Reveal";
import BrandLogo, { type BrandLogoName } from "./BrandLogos";

/**
 * Pipeline console — a complete recomposition of "The tools you already
 * use, connected as one pipeline."
 *
 * Instead of five standalone cards under an SVG arc overlay, the ecosystem
 * is drawn as one connected console: stage nodes joined by directional,
 * gently animated flow links that follow the platform's real spine
 * (market data → intelligence → strategy → risk gate → MT5 execution).
 * The risk gate is the visual hub (moving ember border); every other node
 * is a CardSpotlight link with a hover/focus tooltip. Integration chips
 * below plug the same console into the tools traders already run.
 *
 * Aceternity: CardSpotlight (nodes) + moving-border Button (hub).
 * Copy stays honest about what the connections are: the feed, engine,
 * validation, and gateway stages the platform actually implements.
 */

type Node = {
    logo?: BrandLogoName;
    icon?: typeof Brain;
    step: string;
    name: string;
    sub: string;
    href: string;
    detail: string;
};

const ENTRY_NODES: Node[] = [
    {
        logo: "tradingview",
        step: "01",
        name: "Market data",
        sub: "TradingView quotes in",
        href: "/account/tradingview",
        detail: "Watchlist quotes stream into the ticker and feed every engine.",
    },
    {
        icon: Brain,
        step: "02",
        name: "Intelligence",
        sub: "Deterministic + AI read",
        href: "/market-intelligence",
        detail: "Eight pure engines read the feed; AI explains, never overrides.",
    },
    {
        icon: FlaskConical,
        step: "03",
        name: "Strategy Lab",
        sub: "Build & validate",
        href: "/strategy-lab",
        detail: "Visual strategies, backtests, Pine v6 and MQL5 export.",
    },
];

const HUB: Node = {
    icon: ShieldCheck,
    step: "04",
    name: "Risk gate",
    sub: "Pre-trade check",
    href: "/risk",
    detail: "Limits and drawdown guards approve or reject — with a decision code.",
};

const EXIT_NODE: Node = {
    logo: "mt5",
    step: "05",
    name: "MT5 execution",
    sub: "Orders out to terminal",
    href: "/account/trading-access",
    detail: "Approved orders reach your terminal through a custom EA.",
};

const FLOW_LABELS = ["streams quotes", "reads edges", "validates plans", "routes orders"];

function NodeBody({ node }: { node: Node }) {
    const Icon = node.icon;
    return (
        <>
            <span className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
                    {node.logo ? (
                        <BrandLogo name={node.logo} size={36} />
                    ) : (
                        Icon && <Icon size={17} className="text-primary" aria-hidden />
                    )}
                </span>
                <span className="font-numeric text-[11px] font-semibold tracking-widest text-muted-foreground">
                    {node.step}
                </span>
            </span>
            <span className="mt-4 block text-sm font-semibold tracking-tight text-foreground">{node.name}</span>
            <span className="mt-0.5 block text-xs font-medium text-primary">{node.sub}</span>
            <span
                role="tooltip"
                className="pointer-events-none absolute -top-2 left-1/2 z-30 w-52 max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs leading-5 text-muted-foreground opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
            >
                {node.detail}
            </span>
        </>
    );
}

function StageNode({ node }: { node: Node }) {
    return (
        <CardSpotlight radius={260} className="group w-full flex-1 shadow-sm">
            <Link
                href={node.href}
                aria-label={`${node.name} — ${node.sub}`}
                className="relative z-10 block rounded-xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <NodeBody node={node} />
            </Link>
        </CardSpotlight>
    );
}

function HubNode({ node }: { node: Node }) {
    const Icon = node.icon;
    return (
        <div className="group relative w-full flex-1">
            <MovingButton
                as={Link}
                href={node.href}
                aria-label={`${node.name} — ${node.sub}`}
                borderRadius="0.75rem"
                duration={2800}
                containerClassName="h-full min-h-28 w-full"
                borderClassName="motion-reduce:hidden"
                className="flex-col items-start gap-0 px-4 py-4 text-left"
            >
                <span className="flex w-full items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-primary/30 bg-primary/10">
                        {Icon && <Icon size={17} className="text-primary" aria-hidden />}
                    </span>
                    <span className="font-numeric text-[11px] font-semibold tracking-widest text-primary">
                        {node.step}
                    </span>
                </span>
                <span className="mt-4 block text-sm font-semibold tracking-tight text-foreground">{node.name}</span>
                <span className="mt-0.5 block text-xs font-medium text-primary">{node.sub}</span>
            </MovingButton>
            <span
                role="tooltip"
                className="pointer-events-none absolute -top-2 left-1/2 z-30 w-52 max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs leading-5 text-muted-foreground opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
            >
                {node.detail}
            </span>
        </div>
    );
}

function FlowLink({ label }: { label: string }) {
    return (
        <div aria-hidden className="flex shrink-0 flex-col items-stretch justify-center gap-1.5 px-1 py-1 lg:w-28 lg:px-2">
            <span className="hidden text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground lg:block">
                {label}
            </span>
            {/* Mobile: vertical drop */}
            <span className="relative mx-auto block h-7 w-px bg-border lg:hidden">
                <span className="pipeline-dash-vert absolute inset-0" />
                <ChevronDown size={13} className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 bg-card text-primary" />
            </span>
            {/* Desktop: horizontal run */}
            <span className="relative hidden h-px flex-1 bg-border lg:block">
                <span className="pipeline-dash absolute inset-0" />
                <ChevronRight size={14} className="absolute -right-1 top-1/2 -translate-y-1/2 bg-card text-primary" />
            </span>
            <span className="sr-only">{label}</span>
        </div>
    );
}

type Integration = {
    logo?: BrandLogoName;
    icon?: typeof Copy;
    name: string;
    note: string;
};

const INTEGRATIONS: Integration[] = [
    { logo: "tradingview", name: "TradingView", note: "Live quotes from your watchlists stream into the ticker and the analysis engines." },
    { logo: "mt5", name: "MetaTrader 5", note: "Approved orders execute through a custom MQL5 Expert Advisor in your terminal." },
    { logo: "mt4", name: "MetaTrader 4", note: "The same risk-gated gateway for legacy MT4 terminals." },
    { logo: "pine", name: "Pine Script v6", note: "Your Pine strategies are read directly — signals, not screenshots." },
    { logo: "mql5", name: "MQL5", note: "Custom EAs and indicators plug straight into the execution pipeline." },
    { logo: "telegram", name: "Telegram", note: "Signal previews and alerts are mirrored to your channels." },
    { icon: Copy, name: "Copy Trading", note: "Mirror verified strategies to your own account in one click." },
    { icon: Activity, name: "Live Console", note: "See every fill, rejection and risk check as it happens." },
];

export default function EcosystemSection() {
    return (
        <section className="relative overflow-hidden border-b border-border bg-background">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border-color)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-color)_1px,transparent_1px)] bg-[size:56px_56px] opacity-[0.16] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,black_25%,transparent_100%)] motion-reduce:hidden"
            />
            <div className="page-container relative py-14 md:py-20">
                <Reveal>
                    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
                        <div>
                            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                                <span aria-hidden className="h-px w-6 bg-primary/60" />
                                Connected ecosystem
                            </p>
                            <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                                The tools you already use, connected as one pipeline.
                            </h2>
                        </div>
                        <p className="max-w-md text-sm leading-6 text-muted-foreground">
                            One console, five stages: quotes flow in, edges are read,
                            strategies are validated, risk decides, and MetaTrader executes.
                        </p>
                    </div>
                </Reveal>

                <Reveal delay={100}>
                    <div className="mt-10 rounded-2xl border border-border bg-card/60 p-4 shadow-sm sm:p-6">
                        <div className="flex flex-col items-stretch lg:flex-row">
                            {ENTRY_NODES.map((node, i) => (
                                <div key={node.name} className="flex flex-col items-stretch lg:flex-1 lg:flex-row">
                                    <StageNode node={node} />
                                    <FlowLink label={FLOW_LABELS[i]} />
                                </div>
                            ))}
                            <div className="flex flex-col items-stretch lg:flex-1 lg:flex-row">
                                <HubNode node={HUB} />
                                <FlowLink label={FLOW_LABELS[3]} />
                            </div>
                            <div className="flex flex-col items-stretch lg:flex-1">
                                <StageNode node={EXIT_NODE} />
                            </div>
                        </div>
                        <div className="mt-4 flex flex-col items-start justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
                            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                                <Gauge size={14} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                                Follow the flow end to end in the live console — fills, rejections, and heartbeats included.
                            </p>
                            <Button render={<Link href="/live" />} size="sm" variant="outline" className="shrink-0">
                                Open live console
                            </Button>
                        </div>
                    </div>
                </Reveal>

                <Reveal delay={180}>
                    <p className="mt-8 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Plugs into what you already run
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        {INTEGRATIONS.map(({ logo, icon: Icon, name, note }) => (
                            <div
                                key={name}
                                className="group/tip relative flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:border-primary/40 hover:text-foreground"
                            >
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                                    {logo ? (
                                        <BrandLogo name={logo} size={22} />
                                    ) : (
                                        Icon && <Icon size={13} className="text-primary" aria-hidden />
                                    )}
                                </span>
                                {name}
                                <span
                                    role="tooltip"
                                    className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-56 max-w-[calc(100vw-3rem)] -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs leading-5 text-muted-foreground opacity-0 shadow-lg transition-opacity duration-200 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
                                >
                                    {note}
                                </span>
                            </div>
                        ))}
                        <Link
                            href="/compare"
                            className="px-1 text-xs font-semibold text-primary hover:underline"
                        >
                            Compare brokers →
                        </Link>
                    </div>
                </Reveal>
            </div>
        </section>
    );
}
