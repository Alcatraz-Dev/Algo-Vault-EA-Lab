"use client";

import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { ArrowRight, Play } from "lucide-react";
import type { HomeData } from "@/lib/home-data";
import { BackgroundBeams } from "@/components/ui/background-beams";
import { Spotlight } from "@/components/ui/spotlight-new";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { FlipWords } from "@/components/ui/flip-words";
import { Button as MovingButton } from "@/components/ui/moving-border";
import { CardSpotlight } from "@/components/ui/card-spotlight";
import { Badge as ReUIBadge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import CountUp from "./CountUp";
import HeroConsoleVisual from "./HeroConsoleVisual";

function formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Aceternity-powered hero. Composition (new — replaces the previous
 * split editorial hero):
 *
 * - `BackgroundBeams` — full-bleed animated beam field (ember-retinted).
 * - `Spotlight` (new) — slow lateral light drift above the copy.
 * - `TextGenerateEffect` — word-by-word headline reveal.
 * - `FlipWords` — rotating workflow verb inside the supporting line.
 * - Moving-border `Button` — travelling ember border on the primary CTA.
 * - `CardSpotlight` — pointer-tracked highlight framing the console.
 *
 * Reduced motion: beams + spotlight are decorative and unmount; FlipWords
 * renders its first word statically (handled inside the component); the
 * travelling border dot hides via `motion-reduce:hidden`.
 */
export default function AceternityHero({ data, siteName }: { data: HomeData; siteName: string }) {
    const { stats, previewBacktests } = data;
    const reduceMotion = useReducedMotion();
    const dataOnline = stats.strategies > 0 || stats.backtests > 0;
    const hasReviews = stats.reviewCount > 0;

    return (
        <section className="relative overflow-hidden border-b border-border bg-background">
            {/* Backdrop stack — beams + spotlight + grid, all decorative. */}
            {!reduceMotion && <BackgroundBeams className="opacity-80" />}
            {!reduceMotion && <Spotlight duration={9} xOffset={120} />}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border-color)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-color)_1px,transparent_1px)] bg-[size:56px_56px] opacity-[0.22] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black_30%,transparent_100%)] motion-reduce:hidden"
            />
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent"
            />

            <div className="page-container relative">
                <div className="mx-auto flex max-w-4xl flex-col items-center pb-12 pt-16 text-center md:pb-16 md:pt-24">
                    <Link
                        href="/live"
                        className="group inline-flex max-w-full items-center gap-2.5 rounded-full border border-border bg-card/90 py-1.5 pl-2.5 pr-3 shadow-xs backdrop-blur-sm transition-colors hover:border-primary/40"
                    >
                        <ReUIBadge variant="primary-light" size="sm" className="gap-1.5 font-semibold">
                            <span className="relative flex h-1.5 w-1.5">
                                <span
                                    className={`absolute inline-flex h-full w-full rounded-full ${dataOnline ? "animate-ping bg-positive/60 motion-reduce:animate-none" : ""}`}
                                />
                                <span
                                    className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dataOnline ? "bg-positive" : "bg-muted-foreground"}`}
                                />
                            </span>
                            {dataOnline ? "Live" : "Ready"}
                        </ReUIBadge>
                        <span className="truncate text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                            {dataOnline
                                ? "Market infrastructure active — open the live console"
                                : "Workspace ready — open the live console"}
                        </span>
                        <ArrowRight
                            size={13}
                            className="shrink-0 text-primary transition-transform duration-200 group-hover:translate-x-0.5"
                            aria-hidden
                        />
                    </Link>

                    <h1 className="mt-7 w-full text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-balance sm:text-6xl xl:text-[4.25rem]">
                        <TextGenerateEffect
                            words="Trade with evidence, not opinions."
                            duration={0.6}
                            className="font-semibold"
                        />
                    </h1>

                    {/* div, not p: FlipWords renders a motion.div (invalid inside <p>). */}
                    <div className="mt-5 flex max-w-2xl flex-wrap items-baseline justify-center gap-x-2 text-sm leading-7 text-pretty text-muted-foreground sm:text-base">
                        <span>The workspace to</span>
                        <FlipWords
                            words={["scan", "validate", "execute", "monitor"]}
                            duration={2600}
                            className="px-0 font-semibold text-primary"
                        />
                        <span>every setup — {siteName} ties market data, deterministic analysis, and risk-gated MT5 execution together.</span>
                    </div>

                    <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
                        <MovingButton
                            as={Link}
                            href="/register"
                            borderRadius="0.625rem"
                            duration={3200}
                            containerClassName="h-11 w-full sm:w-auto"
                            borderClassName="motion-reduce:hidden"
                            className="gap-1.5 px-6 text-sm font-semibold"
                        >
                            Start free workspace
                            <ArrowRight size={15} aria-hidden />
                        </MovingButton>
                        <Button
                            render={<Link href="/strategy-lab" />}
                            variant="outline"
                            size="lg"
                            className="h-11 w-full bg-card/80 px-5 backdrop-blur-sm sm:w-auto"
                        >
                            <Play data-icon="inline-start" className="fill-primary text-primary" />
                            Explore Strategy Lab
                        </Button>
                    </div>

                    <dl className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
                        <div className="flex flex-col items-center gap-0.5">
                            <dd className="font-numeric text-xl font-semibold tracking-tight text-foreground">
                                <CountUp value={stats.strategies} format={formatNumber} />
                            </dd>
                            <dt className="text-xs text-muted-foreground">Strategies listed</dt>
                        </div>
                        <span aria-hidden className="hidden h-9 w-px bg-border sm:block" />
                        <div className="flex flex-col items-center gap-0.5">
                            <dd className="font-numeric text-xl font-semibold tracking-tight text-foreground">
                                <CountUp value={stats.backtests} format={formatNumber} />
                                {previewBacktests ? (
                                    <span className="ml-2 align-middle font-sans text-[11px] font-medium text-muted-foreground">
                                        sample preview
                                    </span>
                                ) : null}
                            </dd>
                            <dt className="mt-0.5 text-xs text-muted-foreground">Recorded backtest runs</dt>
                        </div>
                        <span aria-hidden className="hidden h-9 w-px bg-border sm:block" />
                        <div className="flex flex-col items-center gap-0.5">
                            <dd className="font-numeric text-xl font-semibold tracking-tight text-foreground">
                                {hasReviews ? `${stats.averageRating.toFixed(1)}/5` : "Free"}
                            </dd>
                            <dt className="text-xs text-muted-foreground">
                                {hasReviews
                                    ? `${stats.reviewCount} verified review${stats.reviewCount === 1 ? "" : "s"}`
                                    : "No credit card required"}
                            </dt>
                        </div>
                    </dl>
                </div>

                {/* Console preview in a pointer-spotlight frame. */}
                <div className="mx-auto max-w-5xl pb-16 md:pb-24">
                    <CardSpotlight className="shadow-lg" radius={420}>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-xs">
                                <span className="flex min-w-0 items-center gap-2 font-semibold text-foreground">
                                    <span className="flex items-center gap-1.5" aria-hidden>
                                        <span className="h-2.5 w-2.5 rounded-full bg-negative/80" />
                                        <span className="h-2.5 w-2.5 rounded-full bg-warning/80" />
                                        <span className="h-2.5 w-2.5 rounded-full bg-positive/80" />
                                    </span>
                                    <span className="truncate">Operating console</span>
                                </span>
                                <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                                    <span className="relative flex h-1.5 w-1.5">
                                        <span
                                            className={`absolute inline-flex h-full w-full rounded-full ${dataOnline ? "animate-ping bg-positive/60 motion-reduce:animate-none" : ""}`}
                                        />
                                        <span
                                            className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dataOnline ? "bg-positive" : "bg-muted-foreground"}`}
                                        />
                                    </span>
                                    {dataOnline ? "Data feed online" : "Awaiting data"}
                                </span>
                            </div>
                            <HeroConsoleVisual />
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                                <span>Illustrative preview — figures shown are samples, not live account data.</span>
                                <Link
                                    href="/signals"
                                    className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                                >
                                    Open signal console <ArrowRight size={13} aria-hidden />
                                </Link>
                            </div>
                        </div>
                    </CardSpotlight>
                </div>
            </div>
        </section>
    );
}
