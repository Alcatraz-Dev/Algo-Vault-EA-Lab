"use client";

import Link from "next/link";
import { ArrowRight, Play } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import HomeAurora from "./HomeAurora";

import HomeScrollAnimations from "./HomeScrollAnimations";
import MaskedWordReveal from "./MaskedWordReveal";

type Props = {
    siteName: string;
    dataOnline: boolean;
    stats: {
        strategies: number;
        backtests: number;
        averageRating: number;
        reviewCount: number;
    };
};

/**
 * The landing hero — "Mission Control" (DESIGN.md §21).
 *
 * A tight proposition band, not a full-viewport scene. The copy, the two calls
 * to action and one row of real aggregates sit inside the fold, and the product
 * console below starts immediately — so the visitor sees the tool before they
 * scroll. Nothing is boxed: the proof row is inline figures on hairlines, which
 * keeps the hero from competing with the console's own panels.
 *
 * Every figure is read from `getHomeData`. There is deliberately no fallback
 * rating: with no published reviews the row shows a reassurance instead of a
 * fabricated score (§17).
 */
export default function HomeHero({ siteName, dataOnline, stats }: Props) {
    const hasReviews = stats.reviewCount > 0;

    const proof: Array<{ value: string; label: string }> = [
        { value: stats.strategies.toLocaleString(), label: "Strategies listed" },
        { value: stats.backtests.toLocaleString(), label: "Recorded runs" },
        hasReviews
            ? {
                  value: `${stats.averageRating.toFixed(1)}/5`,
                  label: `${stats.reviewCount} verified review${stats.reviewCount === 1 ? "" : "s"}`,
              }
            : { value: "Free", label: "No credit card required" },
    ];

    return (
        <header className="home-hero">
            <HomeAurora
                className="opacity-60"
                aClassName="right-[2%] top-[-10rem] h-[32rem] w-[32rem]"
                bClassName="left-[-4%] bottom-[-12rem] h-[28rem] w-[28rem]"
            />
            <div aria-hidden className="home-hero-glow" />
            <div aria-hidden className="home-hero-grid" />
            <div aria-hidden className="home-hero-rule" />

            <div className="page-container relative z-1 pb-14 pt-14 md:pb-20 md:pt-20">
                <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
                    <Link
                        href="/live"
                        className="group inline-flex items-center gap-2.5 rounded-full border border-border bg-card/80 py-1.5 pl-2.5 pr-3 shadow-xs backdrop-blur-sm transition-colors hover:border-primary/40"
                    >
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                            <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                    dataOnline ? "bg-positive" : "bg-muted-foreground"
                                }`}
                            />
                            {dataOnline ? "Live" : "Ready"}
                        </span>
                        <span className="text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                            {dataOnline
                                ? "Market infrastructure active — explore telemetry"
                                : "Institutional workspace ready — explore telemetry"}
                        </span>
                        <ArrowRight
                            size={13}
                            className="text-primary transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5"
                            aria-hidden
                        />
                    </Link>

                    {/* Two deliberate lines on desktop. `balance` would split the
                        sentence into three even lines and land the awkward
                        "…for research you can" break, so the hero headline opts
                        out of it and takes an explicit break instead; below md it
                        wraps naturally. */}
                    <h1 className="home-title-lg mt-7 max-w-5xl [text-wrap:wrap]">
                        <MaskedWordReveal
                            text="The trading platform for research you can"
                            accentWord="defend with data."
                            accentClassName="home-title-em"
                            delay={100}
                        />
                    </h1>

                    <p className="home-lede mt-5 max-w-[62ch]">
                        {siteName} unifies scanning, quant research, risk controls and MT5
                        execution in one workspace. Every run is recorded and auditable —
                        never fabricated.
                    </p>

                    <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
                        <Button render={<Link href="/register" />} size="lg" className="w-full sm:w-auto">
                            Start free workspace <ArrowRight data-icon="inline-end" />
                        </Button>
                        <Button
                            render={<Link href="/strategy-lab" />}
                            variant="outline"
                            size="lg"
                            className="w-full sm:w-auto"
                        >
                            <Play data-icon="inline-start" weight="fill" className="text-primary" />
                            Explore strategy lab
                        </Button>
                    </div>

                    {/* Proof sits with the proposition — real aggregates on hairlines,
                        never a decorative restatement of the copy. */}
                    <dl className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
                        {proof.map((item, i) => (
                            <div key={item.label} className="flex items-center gap-x-8 gap-y-4">
                                {i > 0 && (
                                    <span
                                        aria-hidden
                                        className="hidden h-8 w-px bg-border sm:block"
                                    />
                                )}
                                <div className="flex flex-col items-center gap-0.5">
                                    <dd className="font-numeric text-xl font-semibold tracking-tight text-foreground">
                                        {item.value}
                                    </dd>
                                    <dt className="text-xs text-muted-foreground">{item.label}</dt>
                                </div>
                            </div>
                        ))}
                    </dl>
                </div>
            </div>
        </header>
    );
}
