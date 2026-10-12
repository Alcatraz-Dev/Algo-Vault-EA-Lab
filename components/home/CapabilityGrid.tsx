"use client";

import { Fragment } from "react";
import Link from "next/link";
import {
    ArrowRight,
    ChartLineUp,
    GitBranch,
    Globe,
    Lightning,
    Scan,
    ShieldCheck,
} from "@phosphor-icons/react";
import Reveal from "./Reveal";
import TacticalCard from "./TacticalCard";
import HomeAurora from "./HomeAurora";
import HomeSectionHeader from "./HomeSectionHeader";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";

type Capability = {
    icon: typeof ChartLineUp;
    title: string;
    href: string;
    copy: string;
    tag: string;
};

const CAPABILITIES: Capability[] = [
    {
        icon: GitBranch,
        title: "Strategy research",
        href: "/strategy-lab",
        copy: "Branch, gate and reuse conditions into Pine Script v6 or MQL5 from one source of truth, so the research you wrote is the strategy you ship.",
        tag: "Build",
    },
    {
        icon: Scan,
        title: "Market scanner",
        href: "/scanner",
        copy: "Regime, volume and VWAP structure ranked by confluence.",
        tag: "Scan",
    },
    {
        icon: ChartLineUp,
        title: "Live analytics",
        href: "/insights",
        copy: "Zones, liquidity and a 0–100 market score from real candles.",
        tag: "Analyze",
    },
    {
        icon: Lightning,
        title: "Signal center",
        href: "/signals",
        copy: "One audited lifecycle per signal, new through closed.",
        tag: "Signals",
    },
    {
        icon: ShieldCheck,
        title: "Risk & drawdown",
        href: "/risk",
        copy: "Daily loss limits and drawdown guards on every entry.",
        tag: "Protect",
    },
    {
        icon: Globe,
        title: "Execution gateway",
        href: "/account/trading-access",
        copy: "Risk-gated bridge to MetaTrader with a full audit trail.",
        tag: "Execute",
    },
];

/** The flagship tile's second row: the pipeline a strategy actually runs. */
const PIPELINE = ["Research", "Backtest", "Risk", "Deploy"];

/**
 * 01 · Platform — the six-module bento.
 *
 * Glass tiles over the page canvas (DESIGN.md §21.2): each module is a real
 * route, the flagship tile spans 2×2 and carries the pipeline it runs as a
 * chips row. The tiles are marketing surfaces, so glass reads correctly here;
 * the data screens they point to stay solid.
 */
export default function CapabilityGrid() {
    return (
        <section id="platform" className="home-section py-20 md:py-28">
            <HomeAurora
                className="opacity-50"
                aClassName="right-[4%] top-[-6rem] h-[28rem] w-[28rem]"
                bClassName="left-[-8%] bottom-[-8rem] h-[26rem] w-[26rem]"
            />
            <div className="page-container">
                <Reveal>
                    <HomeSectionHeader
                        eyebrow="01 · Platform"
                        title="One workspace, from observation to execution"
                        description="Six modules share one symbol context, one vocabulary and one risk model. No tab-hopping, no copy-paste, no drift."
                    />
                </Reveal>

                <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {CAPABILITIES.map(({ icon: Icon, title, href, copy, tag }, index) => {
                        const featured = index === 0;
                        const dir: -1 | 1 | 0 = index % 2 === 0 ? -1 : 1;
                        return (
                            <TacticalCard
                                key={href}
                                dir={featured ? 0 : dir}
                                delay={Math.min(index, 5) * 60}
                                spotlight={true}
                                className={featured ? "md:col-span-2 lg:row-span-2" : "h-full"}
                            >
                                <Link href={href} className="group block h-full" aria-label={`Open ${title}`}>
                                    <div className="glass-panel glass-panel--lift flex h-full flex-col gap-3 p-6 transition-colors duration-200 group-hover:border-primary/50">
                                        <div className="flex items-start justify-between gap-3">
                                            <IconTile
                                                variant="soft"
                                                size={featured ? "xl" : "lg"}
                                                radius="full"
                                                aria-hidden
                                            >
                                                <Icon weight="bold" />
                                            </IconTile>
                                            <Badge variant="outline" size="xs" radius="full">
                                                {tag}
                                            </Badge>
                                        </div>

                                        <h3
                                            className={`mt-1 font-semibold tracking-tight text-foreground transition-colors duration-200 group-hover:text-primary ${
                                                featured ? "text-xl" : "text-base"
                                            }`}
                                        >
                                            {title}
                                        </h3>
                                        <p
                                            className={`text-sm leading-6 text-muted-foreground ${
                                                featured ? "max-w-lg" : ""
                                            }`}
                                        >
                                            {copy}
                                        </p>

                                        {featured && (
                                            <div className="mt-auto pt-2">
                                                <p className="text-xs font-medium text-muted-foreground">
                                                    What ships when you publish
                                                </p>
                                                <ol className="mt-2 flex flex-wrap items-center gap-1.5">
                                                    {PIPELINE.map((step, i) => (
                                                        <Fragment key={step}>
                                                            {i > 0 && (
                                                                <ArrowRight
                                                                    size={12}
                                                                    className="text-primary/50"
                                                                    aria-hidden
                                                                />
                                                            )}
                                                            <li className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                                                                {step}
                                                            </li>
                                                        </Fragment>
                                                    ))}
                                                </ol>
                                            </div>
                                        )}

                                        <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                                            Explore module
                                            <ArrowRight
                                                size={13}
                                                className="transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-1"
                                                aria-hidden
                                            />
                                        </span>
                                    </div>
                                </Link>
                            </TacticalCard>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}