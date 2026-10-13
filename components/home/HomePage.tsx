"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
    Activity,
    ArrowRight,
    ArrowUpRight,
    BarChart3,
    Brain,
    CalendarDays,
    Check,
    ChevronRight,
    Copy,
    Database,
    Gauge,
    History,
    Play,
    ScanSearch,
    Search,
    Send,
    ShieldAlert,
    ShieldCheck,
    Sliders,
    Terminal,
    Zap,
} from "lucide-react";
import { database } from "@/lib/firebase";
import { onValue, ref } from "firebase/database";
import type { HomeBacktest, HomeData, HomeProduct } from "@/lib/home-data";
import SiteHeader from "./site-header";
import SiteFooter from "@/components/footer/SiteFooter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Frame, FrameFooter, FrameHeader } from "@/components/reui/frame";
import { IconTile } from "@/components/reui/icon-tile";
import { Badge as ReUIBadge } from "@/components/reui/badge";
import Reveal from "./Reveal";
import CountUp from "./CountUp";
import TickerStrip from "./TickerStrip";
import EcosystemSection from "./EcosystemSection";
import HeroConsoleVisual from "./HeroConsoleVisual";

const EASE = [0.22, 1, 0.36, 1] as const;

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

/* ── Eyebrow ─────────────────────────────────────────────────────────── */

function Eyebrow({ children }: { children: React.ReactNode }) {
    return (
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <span aria-hidden className="h-px w-6 bg-primary/60" />
            {children}
        </p>
    );
}

function SectionHeading({
    eyebrow,
    title,
    copy,
    align = "left",
}: {
    eyebrow: string;
    title: string;
    copy?: string;
    align?: "left" | "center";
}) {
    const centered = align === "center";
    return (
        <div className={centered ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
            <div className={centered ? "flex justify-center" : ""}>
                <Eyebrow>{eyebrow}</Eyebrow>
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance text-foreground md:text-[2.75rem] md:leading-[1.08]">
                {title}
            </h2>
            {copy ? (
                <p className="mt-4 text-sm leading-6 text-pretty text-muted-foreground sm:text-[0.9375rem]">
                    {copy}
                </p>
            ) : null}
        </div>
    );
}

/* ── Hero ────────────────────────────────────────────────────────────── */

const HERO_PROOF = [
    { icon: ShieldCheck, tone: "text-positive", label: "Deterministic first — same candles, same result" },
    { icon: Database, tone: "text-info", label: "Provider-backed market data" },
    { icon: ShieldAlert, tone: "text-warning", label: "Honest stale / offline states" },
] as const;

function Hero({ data, siteName }: { data: HomeData; siteName: string }) {
    const { stats, previewBacktests } = data;
    const dataOnline = stats.strategies > 0 || stats.backtests > 0;
    const hasReviews = stats.reviewCount > 0;

    return (
        <section className="relative overflow-hidden border-b border-border bg-background">
            {/* Aceternity-inspired backdrop: grid + spotlight, token-driven, static under reduced motion */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border-color)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-color)_1px,transparent_1px)] bg-[size:56px_56px] opacity-[0.28] [mask-image:radial-gradient(ellipse_75%_65%_at_50%_0%,black_35%,transparent_100%)] motion-reduce:hidden" />
                <div className="av-aurora av-aurora-a left-1/2 top-[-340px] h-[480px] w-[760px] -translate-x-1/2" />
                <div className="absolute left-1/2 top-[-1px] h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
            </div>

            <div className="page-container relative">
                <div className="grid items-center gap-12 pb-14 pt-14 md:pt-20 lg:grid-cols-[1.02fr_0.98fr] lg:gap-10 lg:pb-20">
                    {/* Copy column */}
                    <div>
                        <motion.div
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, ease: EASE }}
                        >
                            <Link
                                href="/live"
                                className="group inline-flex max-w-full items-center gap-2.5 rounded-full border border-border bg-card py-1.5 pl-2.5 pr-3 shadow-xs transition-colors hover:border-primary/40"
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
                        </motion.div>

                        <motion.h1
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.65, ease: EASE, delay: 0.08 }}
                            className="mt-6 max-w-xl text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-balance text-foreground sm:text-5xl xl:text-[3.9rem]"
                        >
                            Know why you&rsquo;re in the trade.
                        </motion.h1>

                        <motion.p
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.65, ease: EASE, delay: 0.16 }}
                            className="mt-5 max-w-xl text-sm leading-7 text-pretty text-muted-foreground sm:text-base"
                        >
                            {siteName} unifies scanning, deterministic analysis, backtest
                            research, risk controls, and MT5 execution in one workspace.
                            Every run is recorded and auditable — never fabricated.
                        </motion.p>

                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.65, ease: EASE, delay: 0.24 }}
                            className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
                        >
                            <Button render={<Link href="/register" />} size="lg" className="h-11 px-5">
                                Start free workspace <ArrowRight data-icon="inline-end" />
                            </Button>
                            <Button
                                render={<Link href="/strategy-lab" />}
                                variant="outline"
                                size="lg"
                                className="h-11 px-5"
                            >
                                <Play data-icon="inline-start" className="fill-primary text-primary" />
                                Explore Strategy Lab
                            </Button>
                        </motion.div>

                        {/* Proof row: real aggregates on hairlines */}
                        <motion.dl
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.7, delay: 0.34 }}
                            className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4 border-t border-border pt-6"
                        >
                            <div>
                                <dd className="font-numeric text-xl font-semibold tracking-tight text-foreground">
                                    <CountUp value={stats.strategies} format={formatNumber} />
                                </dd>
                                <dt className="mt-0.5 text-xs text-muted-foreground">Strategies listed</dt>
                            </div>
                            <span aria-hidden className="hidden h-9 w-px bg-border sm:block" />
                            <div>
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
                            <div>
                                <dd className="font-numeric text-xl font-semibold tracking-tight text-foreground">
                                    {hasReviews ? `${stats.averageRating.toFixed(1)}/5` : "Free"}
                                </dd>
                                <dt className="mt-0.5 text-xs text-muted-foreground">
                                    {hasReviews
                                        ? `${stats.reviewCount} verified review${stats.reviewCount === 1 ? "" : "s"}`
                                        : "No credit card required"}
                                </dt>
                            </div>
                        </motion.dl>

                        <motion.ul
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.7, delay: 0.42 }}
                            className="mt-5 flex flex-wrap gap-x-5 gap-y-2"
                        >
                            {HERO_PROOF.map(({ icon: Icon, tone, label }) => (
                                <li key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Icon size={13} className={tone} aria-hidden />
                                    {label}
                                </li>
                            ))}
                        </motion.ul>
                    </div>

                    {/* Console column */}
                    <motion.div
                        initial={{ opacity: 0, y: 28 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.75, ease: EASE, delay: 0.22 }}
                    >
                        <Frame spacing="sm" className="av-edge shadow-lg">
                            <FrameHeader className="border-b border-border px-4 py-3">
                                <div className="flex items-center justify-between gap-2 text-xs">
                                    <span className="flex min-w-0 items-center gap-2 font-semibold text-foreground">
                                        <Terminal size={14} className="shrink-0 text-primary" aria-hidden />
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
                            </FrameHeader>
                            <HeroConsoleVisual />
                            <FrameFooter className="border-t border-border px-4 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1.5">
                                        <ShieldCheck size={13} className="text-positive" aria-hidden />
                                        Risk validator armed
                                    </span>
                                    <Link
                                        href="/signals"
                                        className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                                    >
                                        Open signal console <ArrowRight size={13} aria-hidden />
                                    </Link>
                                </div>
                            </FrameFooter>
                        </Frame>
                        <p className="mt-3 text-center text-xs text-muted-foreground">
                            Illustrative preview of the workspace layout — figures shown are
                            samples, not live account data.
                        </p>
                    </motion.div>
                </div>
            </div>
        </section>
    );
}

/* ── Capability bento ────────────────────────────────────────────────── */

const CAPABILITIES = [
    {
        icon: BarChart3,
        title: "Strategy Lab",
        href: "/strategy-lab",
        copy: "Discover structural patterns, assemble visual strategies, and generate Pine Script v6 or MQL5 code for the terminal.",
        span: "lg:col-span-2",
        points: ["Pattern discovery", "Visual builder", "Pine v6 + MQL5 export"],
    },
    {
        icon: History,
        title: "Backtest Studio",
        href: "/backtests",
        copy: "Deterministic single-pass simulations with real spread, slippage, and commission models.",
        span: "",
        points: ["Walk-forward", "Monte Carlo"],
    },
    {
        icon: ScanSearch,
        title: "Market Scanner",
        href: "/scanner",
        copy: "Regime, liquidity, volume, and VWAP structure read consistently across every timeframe.",
        span: "",
        points: ["8 deterministic engines"],
    },
    {
        icon: ShieldAlert,
        title: "Risk Engine",
        href: "/risk",
        copy: "Pre-trade validation, daily loss limits, and drawdown guards sit in front of every order — rejections carry a decision code.",
        span: "",
        points: ["Pre-trade checks", "Drawdown guards"],
    },
    {
        icon: Zap,
        title: "Signal Center",
        href: "/signals",
        copy: "AI-normalized signals with a canonical, audited lifecycle from new to closed.",
        span: "",
        points: ["Full lifecycle audit"],
    },
    {
        icon: Copy,
        title: "Copy Trading",
        href: "/copy-trading",
        copy: "Risk-scaled mirroring between verified strategies and follower allocations.",
        span: "lg:col-span-2",
        points: ["Verified strategies", "Risk-scaled sizing", "Allocation control"],
    },
] as const;

function CapabilityBento() {
    return (
        <section className="border-b border-border bg-background">
            <div className="page-container py-14 md:py-20">
                <Reveal>
                    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
                        <SectionHeading
                            eyebrow="Platform map"
                            title="One workspace, every stage of the trade."
                            copy="Research, validation, signals, execution, and monitoring are separate modules sharing one vocabulary — symbol, timeframe, data age, and risk context travel with you."
                        />
                        <Link
                            href="/dashboard"
                            className="group inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                        >
                            Open the dashboard
                            <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                        </Link>
                    </div>
                </Reveal>
                <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {CAPABILITIES.map(({ icon: Icon, title, href, copy, span, points }, i) => (
                        <Reveal key={href} delay={Math.min(i, 5) * 70} className={span}>
                            <Link
                                href={href}
                                className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-colors duration-200 hover:border-primary/40 hover:shadow-md"
                            >
                                <span
                                    aria-hidden
                                    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary/0 transition-colors duration-300 group-hover:bg-primary/60"
                                />
                                <div className="flex items-center justify-between">
                                    <IconTile variant="soft" size="sm" aria-hidden>
                                        <Icon size={16} />
                                    </IconTile>
                                    <ArrowUpRight
                                        size={15}
                                        className="text-muted-foreground transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-primary"
                                        aria-hidden
                                    />
                                </div>
                                <h3 className="mt-5 text-base font-semibold tracking-tight text-foreground">{title}</h3>
                                <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{copy}</p>
                                <ul className="mt-4 flex flex-wrap gap-1.5">
                                    {points.map((point) => (
                                        <li key={point}>
                                            <ReUIBadge variant="invert-light" size="sm" className="font-medium">
                                                {point}
                                            </ReUIBadge>
                                        </li>
                                    ))}
                                </ul>
                            </Link>
                        </Reveal>
                    ))}
                </div>
                {/* Secondary module strip */}
                <Reveal delay={120}>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {[
                            { icon: Brain, title: "AI Copilot", href: "/ai-copilot", copy: "Natural-language answers about structure, risk, and your workspace." },
                            { icon: CalendarDays, title: "Economic Calendar", href: "/economic-calendar", copy: "High-impact events mapped to sessions and open setups." },
                            { icon: Send, title: "Execution Gateway", href: "/account/trading-access", copy: "Risk-gated HTTP bridge to MetaTrader via a custom MQL5 EA." },
                            { icon: Activity, title: "Live Monitoring", href: "/live", copy: "Equity, drawdown, and gateway heartbeats in one console." },
                        ].map(({ icon: Icon, title, href, copy }) => (
                            <Link
                                key={href}
                                href={href}
                                className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm transition-colors duration-200 hover:border-primary/40"
                            >
                                <IconTile variant="outline" size="xs" className="text-primary" aria-hidden>
                                    <Icon size={14} />
                                </IconTile>
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
                                    <span className="block truncate text-xs text-muted-foreground">{copy}</span>
                                </span>
                                <ChevronRight size={14} className="ml-auto shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
                            </Link>
                        ))}
                    </div>
                </Reveal>
            </div>
        </section>
    );
}

/* ── Showcase tabs ─────────────────────────────────────────────────── */

const SHOWCASE = [
    {
        value: "discover",
        label: "Discover",
        icon: Search,
        title: "Find the setup worth researching",
        copy: "Scan regimes, liquidity maps, and session structure from one screener, then open any symbol straight into analysis.",
        bullets: ["Regime + liquidity + VWAP in one view", "Session-aware London / New York / Tokyo", "Opens directly into Strategy Lab"],
        cta: { label: "Open the scanner", href: "/scanner" },
        stat: { value: "8", label: "deterministic engines on every symbol" },
    },
    {
        value: "validate",
        label: "Validate",
        icon: Gauge,
        title: "Prove it before you risk it",
        copy: "Run deterministic backtests with real costs, stress parameters with walk-forward and Monte Carlo, and replay history bar by bar.",
        bullets: ["Spread, slippage & commission modeled", "Walk-forward + Monte Carlo robustness", "Bar-by-bar replay with no look-ahead"],
        cta: { label: "Open Backtest Studio", href: "/backtests" },
        stat: { value: "1", label: "recorded run beats ten opinions" },
    },
    {
        value: "execute",
        label: "Execute",
        icon: Send,
        title: "Send orders through a risk gate",
        copy: "Approved intents travel to MetaTrader through a custom MQL5 Expert Advisor. Anything that fails limits is rejected with a decision code.",
        bullets: ["Pre-trade risk validation", "Custom MQL5 execution EA", "Every rejection explained, surfaced, logged"],
        cta: { label: "Set up trading access", href: "/account/trading-access" },
        stat: { value: "0", label: "orders bypass the risk validator" },
    },
    {
        value: "monitor",
        label: "Monitor",
        icon: Activity,
        title: "Watch the loop stay honest",
        copy: "Track equity, drawdown, signal lifecycle, and gateway heartbeats from the live console — stale feeds are labeled stale, never live.",
        bullets: ["Equity & drawdown telemetry", "Signal lifecycle audit trail", "Gateway heartbeat honesty"],
        cta: { label: "Open live console", href: "/live" },
        stat: { value: "24/7", label: "visibility into what the system sees" },
    },
] as const;

function Showcase() {
    return (
        <section className="relative overflow-hidden border-b border-border bg-muted/30">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border-color)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-color)_1px,transparent_1px)] bg-[size:56px_56px] opacity-[0.18] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,black_30%,transparent_100%)] motion-reduce:hidden"
            />
            <div className="page-container relative py-14 md:py-20">
                <Reveal>
                    <SectionHeading
                        align="center"
                        eyebrow="Product tour"
                        title="From first scan to filled order."
                        copy="Four stages, one shared context. Switch tabs to walk the loop the platform actually supports."
                    />
                </Reveal>
                <Reveal delay={100}>
                    <Tabs defaultValue="discover" className="mt-10 items-center">
                        <TabsList className="h-10 rounded-full border border-border bg-card p-1 shadow-sm">
                            {SHOWCASE.map(({ value, label, icon: Icon }) => (
                                <TabsTrigger
                                    key={value}
                                    value={value}
                                    className="rounded-full px-4 text-[13px] data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm dark:data-active:bg-primary dark:data-active:text-primary-foreground"
                                >
                                    <Icon size={14} aria-hidden />
                                    {label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        {SHOWCASE.map(({ value, title, copy, bullets, cta, stat }) => (
                            <TabsContent key={value} value={value} className="w-full">
                                <Card className="mx-auto mt-6 max-w-4xl gap-0 overflow-hidden py-0 shadow-md">
                                    <div className="grid md:grid-cols-[1.2fr_0.8fr]">
                                        <div className="p-6 md:p-8">
                                            <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
                                                {title}
                                            </h3>
                                            <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy}</p>
                                            <ul className="mt-5 space-y-2.5">
                                                {bullets.map((bullet) => (
                                                    <li key={bullet} className="flex items-start gap-2.5 text-[13px] leading-5 text-foreground">
                                                        <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-positive/12 text-positive">
                                                            <Check size={11} strokeWidth={3} aria-hidden />
                                                        </span>
                                                        {bullet}
                                                    </li>
                                                ))}
                                            </ul>
                                            <Button render={<Link href={cta.href} />} className="mt-6">
                                                {cta.label} <ArrowRight data-icon="inline-end" />
                                            </Button>
                                        </div>
                                        <div className="flex flex-col justify-center gap-3 border-t border-border bg-muted/50 p-6 md:border-l md:border-t-0 md:p-8">
                                            <p className="font-numeric text-5xl font-semibold tracking-tight text-foreground">
                                                {stat.value}
                                            </p>
                                            <p className="text-[13px] leading-5 text-muted-foreground">{stat.label}</p>
                                            <div className="mt-2 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
                                                <ShieldCheck size={13} className="shrink-0 text-positive" aria-hidden />
                                                Every step reads from the same recorded data.
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            </TabsContent>
                        ))}
                    </Tabs>
                </Reveal>
            </div>
        </section>
    );
}

/* ── Workflow ──────────────────────────────────────────────────────── */

const WORKFLOW = [
    {
        step: "01",
        title: "Discover",
        copy: "Browse the marketplace or scan the market for structural setups worth your time.",
        href: "/marketplace",
        link: "Browse marketplace",
    },
    {
        step: "02",
        title: "Evaluate",
        copy: "Read deterministic engine output and AI interpretation side by side — with conflicts shown, not hidden.",
        href: "/market-intelligence",
        link: "Open intelligence",
    },
    {
        step: "03",
        title: "Validate",
        copy: "Backtest, walk-forward, and stress the idea on recorded history before committing capital.",
        href: "/backtests",
        link: "Run a backtest",
    },
    {
        step: "04",
        title: "Deploy",
        copy: "Route approved orders through the risk validator to MT5, then monitor fills and drawdown live.",
        href: "/account/trading-access",
        link: "Connect execution",
    },
] as const;

function Workflow() {
    return (
        <section className="border-b border-border bg-background">
            <div className="page-container py-14 md:py-20">
                <Reveal>
                    <SectionHeading
                        eyebrow="How it works"
                        title="A straight line from idea to audited execution."
                        copy="The platform's spine, in the order traders actually use it. Each step hands its context to the next."
                    />
                </Reveal>
                <ol className="relative mt-10 grid gap-4 md:grid-cols-4">
                    <span
                        aria-hidden
                        className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block"
                    />
                    {WORKFLOW.map(({ step, title, copy, href, link }, i) => (
                        <Reveal key={step} delay={i * 80}>
                            <li className="group relative rounded-xl border border-border bg-card p-5 shadow-sm transition-colors duration-200 hover:border-primary/40">
                                <div className="flex items-center justify-between">
                                    <span className="font-numeric text-xs font-semibold tracking-widest text-primary">
                                        {step}
                                    </span>
                                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background font-numeric text-xs font-semibold text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
                                        {i + 1}
                                    </span>
                                </div>
                                <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">{title}</h3>
                                <p className="mt-2 min-h-15 text-[13px] leading-5 text-muted-foreground">{copy}</p>
                                <Link
                                    href={href}
                                    className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
                                >
                                    {link} <ArrowRight size={13} aria-hidden />
                                </Link>
                            </li>
                        </Reveal>
                    ))}
                </ol>
            </div>
        </section>
    );
}

/* ── Evidence + marketplace ────────────────────────────────────────── */

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
                    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
                        <SectionHeading
                            eyebrow="Recorded evidence"
                            title="Numbers you can check, listings you can open."
                            copy="Backtests are stored simulation runs with their metrics attached — anonymous and aggregate on this page. Marketplace listings carry their evidence beside them."
                        />
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
                        <Card className="gap-0 overflow-hidden py-0">
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
                            <div>
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
                        </Card>
                    </Reveal>
                </div>
            </div>
        </section>
    );
}

/* ── Final CTA ─────────────────────────────────────────────────────── */

function FinalCTA() {
    return (
        <section className="relative overflow-hidden bg-background">
            <div className="page-container py-16 md:py-24">
                <Reveal>
                    <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
                        <div aria-hidden className="pointer-events-none absolute inset-0">
                            <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border-color)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-color)_1px,transparent_1px)] bg-[size:48px_48px] opacity-25 [mask-image:radial-gradient(ellipse_65%_80%_at_50%_100%,black_30%,transparent_100%)] motion-reduce:hidden" />
                            <div className="av-aurora av-aurora-a left-1/2 top-[-260px] h-[360px] w-[640px] -translate-x-1/2 opacity-80" />
                            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
                        </div>
                        <div className="relative mx-auto max-w-2xl px-6 py-14 text-center md:py-18">
                            <ReUIBadge variant="primary-light" size="lg" className="font-semibold">
                                Free workspace · No credit card
                            </ReUIBadge>
                            <h2 className="mt-5 text-3xl font-semibold leading-[1.08] tracking-[-0.035em] text-balance text-foreground md:text-5xl">
                                Make your next decision legible.
                            </h2>
                            <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-pretty text-muted-foreground sm:text-base">
                                Create a workspace, scan your first symbol, and run a
                                deterministic backtest in minutes — with every number accounted for.
                            </p>
                            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                                <Button render={<Link href="/register" />} size="lg" className="h-11 w-full px-6 sm:w-auto">
                                    Create workspace <ArrowRight data-icon="inline-end" />
                                </Button>
                                <Button
                                    render={<Link href="/pricing" />}
                                    variant="outline"
                                    size="lg"
                                    className="h-11 w-full bg-background px-6 sm:w-auto"
                                >
                                    Compare plans
                                </Button>
                            </div>
                            <p className="mt-6 text-xs leading-5 text-muted-foreground">
                                Trading involves risk. AlgoVault provides research tooling — not
                                financial advice, and never a promise of profit.
                            </p>
                        </div>
                    </div>
                </Reveal>
            </div>
        </section>
    );
}

/* ── Page ──────────────────────────────────────────────────────────── */

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
                <Hero data={data} siteName={siteName} />
                <CapabilityBento />
                <Showcase />
                <Workflow />
                <EvidenceMarketplace data={data} />
                <EcosystemSection />
                <FinalCTA />
            </main>
            <SiteFooter />
        </div>
    );
}
