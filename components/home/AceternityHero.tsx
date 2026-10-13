"use client";

import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { HomeData } from "@/lib/home-data";
import { BackgroundBeams } from "@/components/ui/background-beams";
import { Spotlight } from "@/components/ui/spotlight-new";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { Button as MovingButton } from "@/components/ui/moving-border";
import { Badge as ReUIBadge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import BrandLogo, { type BrandLogoName } from "./BrandLogos";
import HeroConsole from "./HeroConsole";

function formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(value);
}

const CLOUD: Array<{ name: BrandLogoName; label: string }> = [
    { name: "tradingview", label: "TradingView" },
    { name: "mt5", label: "MetaTrader 5" },
    { name: "mt4", label: "MetaTrader 4" },
    { name: "pine", label: "Pine Script v6" },
    { name: "mql5", label: "MQL5" },
    { name: "telegram", label: "Telegram" },
];

/**
 * Kestrel-rhythm hero: status pill, oversized two-line generated headline,
 * supporting copy, dual CTA, honest proof line, and a logo cloud of the
 * tools the platform plugs into — no product screenshot above the fold.
 */
export default function AceternityHero({ data, siteName }: { data: HomeData; siteName: string }) {
    const { stats } = data;
    const reduceMotion = useReducedMotion();
    const dataOnline = stats.strategies > 0 || stats.backtests > 0;
    const hasReviews = stats.reviewCount > 0;

    return (
        <section className="relative overflow-hidden border-b border-border bg-background">
            {!reduceMotion && <BackgroundBeams className="opacity-70" />}
            {!reduceMotion && <Spotlight duration={9} xOffset={120} />}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-background to-transparent"
            />

            <div className="page-container relative">
                <div className="mx-auto flex max-w-4xl flex-col items-center pb-14 pt-16 text-center md:pb-16 md:pt-24">
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
                            New
                        </ReUIBadge>
                        <span className="truncate text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                            {dataOnline
                                ? "Market infrastructure is live — open the console"
                                : "Risk-gated MT5 execution is live"}
                        </span>
                        <ArrowRight
                            size={13}
                            className="shrink-0 text-primary transition-transform duration-200 group-hover:translate-x-0.5"
                            aria-hidden
                        />
                    </Link>

                    <h1 className="mt-7 w-full text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.045em] text-balance sm:text-7xl xl:text-[5rem]">
                        <TextGenerateEffect
                            words="Trade with evidence,"
                            duration={0.45}
                            className="font-semibold"
                        />
                        <span className="text-primary">
                            <TextGenerateEffect
                                words="not opinions."
                                duration={0.45}
                                className="font-semibold"
                            />
                        </span>
                    </h1>

                    <p className="mt-5 max-w-2xl text-sm leading-7 text-pretty text-muted-foreground sm:text-base">
                        {siteName} unifies scanning, deterministic analysis, backtest
                        research, risk controls, and MT5 execution in one workspace.
                        Every run is recorded and auditable — never fabricated.
                    </p>

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
                            Open Strategy Lab
                        </Button>
                    </div>

                    <p className="mt-6 font-numeric text-xs tracking-wide text-muted-foreground">
                        {hasReviews ? (
                            <>
                                <span className="font-semibold text-foreground">{stats.averageRating.toFixed(1)} average</span>
                                {" "}from {formatNumber(stats.reviewCount)} verified review{stats.reviewCount === 1 ? "" : "s"}
                            </>
                        ) : (
                            <>
                                <span className="font-semibold text-foreground">{formatNumber(stats.strategies)} strategies</span>
                                {" · "}
                                <span className="font-semibold text-foreground">{formatNumber(stats.backtests)} recorded runs</span>
                                {" · Free workspace"}
                            </>
                        )}
                    </p>

                    <p className="mt-12 text-xs font-medium text-muted-foreground">
                        Plugs into the tools you already run
                    </p>
                    <ul className="mt-6 grid w-full max-w-2xl grid-cols-3 items-center justify-items-center gap-x-6 gap-y-5 sm:grid-cols-6" aria-label="Supported tools">
                        {CLOUD.map(({ name, label }) => (
                            <li
                                key={name}
                                title={label}
                                aria-label={label}
                                className="opacity-60 transition-opacity duration-200 hover:opacity-100 motion-reduce:transition-none"
                            >
                                <BrandLogo name={name} size={30} />
                            </li>
                        ))}
                    </ul>
                </div>

                <HeroConsole data={data} />

                <p className="mx-auto max-w-2xl pb-14 text-center text-[11px] leading-4 text-muted-foreground md:pb-16">
                    Workspace preview with sample charts — live figures appear inside the product.
                </p>
            </div>
        </section>
    );
}
