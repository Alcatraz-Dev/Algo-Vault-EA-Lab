"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, Copy, ShieldCheck, Sliders } from "lucide-react";
import { database } from "@/lib/firebase";
import { onValue, ref } from "firebase/database";
import type { HomeBacktest, HomeData, HomeProduct } from "@/lib/home-data";
import SiteHeader from "./site-header";
import SiteFooter from "@/components/footer/SiteFooter";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CardSpotlight } from "@/components/ui/card-spotlight";
import Reveal from "./Reveal";
import TickerStrip from "./TickerStrip";
import EcosystemSection from "./EcosystemSection";
import AceternityHero from "./AceternityHero";
import MarketMarquee from "./MarketMarquee";
import CapabilityBento from "./CapabilityBento";
import StickyShowcase from "./StickyShowcase";
import WorkflowBeam from "./WorkflowBeam";
import CtaHighlight from "./CtaHighlight";

function formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(value);
}

function formatPrice(value?: number, currency = "USD"): string {
    if (value === undefined || !Number.isFinite(value)) return "Unavailable";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
    }).format(value);
}

function ProductRow({ product }: { product: HomeProduct }) {
    return (
        <Link
            href={`/marketplace/${product.slug || product.id}`}
            className="group flex items-center justify-between gap-4 border-t border-border px-4 py-3.5 transition-colors first:border-t-0 hover:bg-muted/60 sm:px-5"
        >
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{product.name || "Unnamed strategy"}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                    {[product.symbol, product.timeframe, product.platform].filter(Boolean).join(" · ") ||
                        "Marketplace listing"}
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-right">
                <span className="font-numeric text-sm font-semibold text-primary">
                    {formatPrice(product.pricing?.price, product.pricing?.currency)}
                </span>
                <ChevronRight
                    size={15}
                    className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                    aria-hidden
                />
            </div>
        </Link>
    );
}

/**
 * Homepage composition (Aceternity-led rebuild).
 *
 * Rendered Aceternity integrations, in order:
 *  1. Hero — BackgroundBeams, Spotlight, TextGenerateEffect, FlipWords,
 *     moving-border Button, CardSpotlight (`AceternityHero`).
 *  2. Module marquee — InfiniteMovingCards over real modules (`MarketMarquee`).
 *  3. Capabilities — BentoGrid + BentoGridItem (`CapabilityBento`).
 *  4. Product tour — StickyScroll, page-scroll variant (`StickyShowcase`).
 *  5. Workflow — TracingBeam (`WorkflowBeam`).
 *  6. Marketplace card — CardSpotlight frame (below).
 *  7. Final CTA — HeroHighlight + Highlight + moving-border (`CtaHighlight`).
 *
 * shadcn/ui primitives (Button/Badge/Card) and ReUI (Badge, IconTile in
 * sections) play supporting roles. All numbers come from `getHomeData`;
 * illustrative visuals are labeled; every link targets an existing route.
 */
function EvidenceMarketplace({ data }: { data: HomeData }) {
    const { featured, latestBacktests, backtestAnalytics, previewBacktests } = data;
    const tiles = [
        { label: "Recorded runs", value: String(backtestAnalytics.total), tone: "text-foreground" },
        {
            label: "Avg win rate",
            value: backtestAnalytics.analyzableCount > 0 ? `${backtestAnalytics.avgWinRate.toFixed(1)}%` : "Unavailable",
            tone: "text-positive",
        },
        {
            label: "Avg max drawdown",
            value: backtestAnalytics.analyzableCount > 0 ? `${backtestAnalytics.avgMaxDrawdown.toFixed(1)}%` : "Unavailable",
            tone: "text-negative",
        },
        {
            label: "Positive runs",
            value:
                backtestAnalytics.analyzableCount > 0
                    ? `${backtestAnalytics.positiveCount}/${backtestAnalytics.analyzableCount}`
                    : "Unavailable",
            tone: "text-positive",
        },
    ];

    return (
        <section className="border-b border-border bg-muted/30">
            <div className="page-container py-14 md:py-20">
                <Reveal>
                    <div className="max-w-2xl">
                        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            <span aria-hidden className="h-px w-6 bg-primary/60" />
                            Recorded evidence
                        </p>
                        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                            Numbers you can check, listings you can open.
                        </h2>
                        <p className="mt-4 text-sm leading-6 text-pretty text-muted-foreground sm:text-[0.9375rem]">
                            Backtests are stored simulation runs with their metrics attached —
                            anonymous and aggregate on this page. Marketplace listings carry
                            their evidence beside them.
                        </p>
                    </div>
                </Reveal>
                <div className="mt-10 grid gap-4 lg:grid-cols-[1fr_1fr]">
                    <Reveal>
                        <Card className="gap-0 overflow-hidden py-0">
                            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                                <div>
                                    <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                                        Backtest record
                                        {previewBacktests ? (
                                            <Badge variant="warning" className="normal-case tracking-normal">
                                                Sample preview
                                            </Badge>
                                        ) : null}
                                    </p>
                                    <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-foreground">
                                        Recent research runs
                                    </h3>
                                </div>
                                <Link href="/backtests" className="shrink-0 text-xs font-semibold text-primary hover:underline">
                                    View all
                                </Link>
                            </div>
                            <div className="grid grid-cols-2 gap-px bg-border">
                                {tiles.map((tile) => (
                                    <div key={tile.label} className="bg-card px-4 py-4">
                                        <p className="text-xs text-muted-foreground">{tile.label}</p>
                                        <p className={`mt-1.5 font-numeric text-xl font-semibold tracking-tight ${tile.tone}`}>
                                            {tile.value}
                                        </p>
                                    </div>
                                ))}
                            </div>
                            <div>
                                {latestBacktests.length > 0 ? (
                                    latestBacktests.map((backtest: HomeBacktest) => (
                                        <div
                                            key={backtest.id}
                                            className="grid gap-1.5 border-t border-border px-5 py-3.5 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-3"
                                        >
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold text-foreground">
                                                    {backtest.title || "Untitled backtest"}
                                                </p>
                                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                    {[backtest.pair, backtest.timeframe, backtest.period]
                                                        .filter(Boolean)
                                                        .join(" · ") || "Configuration unavailable"}
                                                </p>
                                            </div>
                                            <span className="text-xs text-muted-foreground">
                                                Net result{" "}
                                                <strong className="ml-1 font-numeric text-foreground">
                                                    {backtest.netProfit === undefined
                                                        ? "Unavailable"
                                                        : backtest.netProfit >= 0
                                                          ? `+${formatNumber(backtest.netProfit)}`
                                                          : formatNumber(backtest.netProfit)}
                                                </strong>
                                            </span>
                                        </div>
                                    ))
                                ) : (
                                    <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                                        No backtest data available.
                                    </p>
                                )}
                            </div>
                            <p className="border-t border-border px-5 py-3 text-xs leading-5 text-muted-foreground">
                                {previewBacktests
                                    ? "Sample preview runs — publish recorded backtests in the studio to replace them."
                                    : "Stored simulation runs — no live account numbers or user details."}{" "}
                                <Link href="/backtests" className="font-semibold text-primary hover:underline">
                                    Open Backtest Studio
                                </Link>
                            </p>
                        </Card>
                    </Reveal>
                    <Reveal delay={120}>
                        <CardSpotlight className="h-full shadow-sm" radius={420}>
                            <div className="relative z-10 flex h-full flex-col">
                                <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                                            Marketplace
                                        </p>
                                        <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-foreground">
                                            Strategies with evidence beside them
                                        </h3>
                                    </div>
                                    <Link href="/marketplace" className="shrink-0 text-xs font-semibold text-primary hover:underline">
                                        Browse all
                                    </Link>
                                </div>
                                <div className="flex-1">
                                    {featured.length > 0 ? (
                                        featured
                                            .slice(0, 5)
                                            .map((product) => <ProductRow key={product.id} product={product} />)
                                    ) : (
                                        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                                            No marketplace listings available.
                                        </p>
                                    )}
                                </div>
                                <div className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
                                    {[
                                        { icon: ShieldCheck, label: "Licensed activation" },
                                        { icon: Copy, label: "Copy-trading ready" },
                                        { icon: Sliders, label: "Set files included" },
                                    ].map(({ icon: Icon, label }) => (
                                        <span
                                            key={label}
                                            className="flex items-center justify-center gap-1.5 bg-card px-3 py-3 text-xs text-muted-foreground"
                                        >
                                            <Icon size={13} className="text-primary" aria-hidden />
                                            {label}
                                        </span>
                                    ))}
                                </div>
                                <Link
                                    href="/copy-trading"
                                    className="flex items-center justify-between border-t border-border px-5 py-3.5 text-[13px] font-semibold text-primary transition-colors hover:bg-muted/60"
                                >
                                    Mirror verified strategies with copy trading
                                    <ArrowRight size={14} aria-hidden />
                                </Link>
                            </div>
                        </CardSpotlight>
                    </Reveal>
                </div>
            </div>
        </section>
    );
}

export default function HomePage({ data }: { data: HomeData }) {
    const [siteName, setSiteName] = useState("AlgoVault");

    useEffect(() => {
        const unsubscribe = onValue(ref(database, "settings/siteName"), (snapshot) => {
            const value = snapshot.val();
            if (typeof value === "string" && value.trim()) setSiteName(value.trim());
        });
        return () => unsubscribe();
    }, []);

    return (
        <div className="min-h-screen overflow-x-clip bg-background font-sans text-foreground selection:bg-primary selection:text-primary-foreground">
            <SiteHeader />
            <main>
                <TickerStrip />
                <AceternityHero data={data} siteName={siteName} />
                <MarketMarquee />
                <CapabilityBento />
                <StickyShowcase />
                <WorkflowBeam />
                <EvidenceMarketplace data={data} />
                <EcosystemSection />
                <CtaHighlight />
            </main>
            <SiteFooter />
        </div>
    );
}
