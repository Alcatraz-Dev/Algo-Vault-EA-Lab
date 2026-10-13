"use client";

import { useState } from "react";
import Link from "next/link";
import {
    Activity,
    BarChart3,
    Bell,
    Brain,
    ChevronLeft,
    Copy,
    FlaskConical,
    History,
    LayoutDashboard,
    ScrollText,
    Search,
    Settings,
    ShieldCheck,
    Wallet,
    Zap,
} from "lucide-react";
import type { HomeData, HomeProduct } from "@/lib/home-data";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import HomeCandleChart from "./HomeCandleChart";
import { ReturnsHistogram, RiskMini, SignalLifecycle, TelemetryMini } from "./home-visuals";
import Reveal from "./Reveal";

/**
 * Hero console — an honest take on the reference's perspective dashboard:
 * app sidebar with real routes, topbar, workspace banner, view tabs with
 * genuinely different panels, session rows, featured strategies, and real
 * aggregate stats. Samples are labeled; everything links somewhere real.
 */

const NAV = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
    { icon: Brain, label: "Copilot", href: "/ai-copilot" },
    { icon: Search, label: "Scanner", href: "/scanner" },
    { icon: FlaskConical, label: "Strategy Lab", href: "/strategy-lab", active: true },
    { icon: History, label: "Backtests", href: "/backtests" },
    { icon: Zap, label: "Signals", href: "/signals" },
    { icon: Activity, label: "Live", href: "/live" },
    { icon: Copy, label: "Copy Trading", href: "/copy-trading" },
    { icon: Wallet, label: "Marketplace", href: "/marketplace" },
] as const;

const VIEWS = [
    { id: "overview", label: "Overview" },
    { id: "signals", label: "Signals" },
    { id: "backtests", label: "Backtests" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

function formatPrice(value?: number, currency = "USD"): string {
    if (value === undefined || !Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
    }).format(value);
}

function StrategyMini({ product }: { product: HomeProduct }) {
    return (
        <Link
            href={`/marketplace/${product.slug || product.id}`}
            className="group flex flex-col rounded-xl border border-border bg-card p-3 shadow-sm transition-colors hover:border-primary/40"
        >
            <p className="truncate text-xs font-semibold text-foreground">{product.name || "Unnamed strategy"}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {[product.symbol, product.timeframe].filter(Boolean).join(" · ") || "Marketplace listing"}
            </p>
            <p className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[11px]">
                <span className="font-numeric font-semibold text-primary">
                    {formatPrice(product.pricing?.price, product.pricing?.currency)}
                </span>
                <span className="font-medium text-muted-foreground transition-colors group-hover:text-primary">Open</span>
            </p>
        </Link>
    );
}

export default function HeroConsole({ data }: { data: HomeData }) {
    const { stats, featured, backtestAnalytics } = data;
    const [view, setView] = useState<ViewId>("overview");

    return (
        <Reveal delay={150}>
            <div className="relative mx-auto mt-14 max-w-6xl sm:mt-16" style={{ perspective: "1800px" }}>
                <div
                    role="img"
                    aria-label="AlgoVault workspace preview: strategy lab with sample charts, session rows, featured strategies, and recorded aggregates"
                    className="overflow-hidden rounded-2xl border border-border bg-card text-[13px] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.75)]"
                >
                    <div className="flex">
                        {/* Sidebar */}
                        <div className="hidden w-52 shrink-0 flex-col border-r border-border bg-muted/40 p-3 md:flex">
                            <div className="flex items-center gap-2 px-1">
                                <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground font-numeric text-xs font-bold">
                                    AV
                                </span>
                                <span>
                                    <span className="block text-xs font-semibold leading-tight text-foreground">AlgoVault</span>
                                    <span className="block text-[11px] text-muted-foreground">Workspace</span>
                                </span>
                            </div>
                            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-muted-foreground">
                                <Search size={13} aria-hidden />
                                <span className="text-xs">Search</span>
                                <span className="ml-auto rounded bg-muted px-1 font-numeric text-[10px]">⌘K</span>
                            </div>
                            <p className="mt-3 px-2 text-[11px] text-muted-foreground">Main</p>
                            <ul className="mt-1 space-y-0.5">
                                {NAV.map(({ icon: Icon, label, href, ...rest }) => (
                                    <li key={href}>
                                        <Link
                                            href={href}
                                            aria-current={"active" in rest ? "page" : undefined}
                                            className={cn(
                                                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors",
                                                "active" in rest
                                                    ? "bg-primary font-semibold text-primary-foreground"
                                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                            )}
                                        >
                                            <Icon size={14} className="shrink-0" aria-hidden />
                                            {label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-auto border-t border-border pt-2 text-muted-foreground">
                                <Link href="/account/settings" className="flex items-center gap-2 px-2 py-1.5 text-xs hover:text-foreground">
                                    <Settings size={14} aria-hidden /> Settings
                                </Link>
                            </div>
                        </div>

                        {/* Main */}
                        <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4">
                            <div className="flex shrink-0 items-center justify-between">
                                <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
                                    <ChevronLeft size={13} aria-hidden /> Strategy Lab
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <Link
                                        href="/alert-center"
                                        aria-label="Open alerts"
                                        className="grid size-7 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                        <Bell size={14} aria-hidden />
                                    </Link>
                                    <Link
                                        href="/register"
                                        className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                                    >
                                        New backtest
                                    </Link>
                                </div>
                            </div>

                            {/* Banner */}
                            <div className="relative shrink-0 overflow-hidden rounded-xl border border-border bg-muted/50 p-4 sm:p-5">
                                <div
                                    aria-hidden
                                    className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border-color)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-color)_1px,transparent_1px)] bg-[size:36px_36px] opacity-40 [mask-image:radial-gradient(ellipse_70%_90%_at_80%_20%,black_20%,transparent_100%)] motion-reduce:hidden"
                                />
                                <p className="relative text-[11px] font-semibold uppercase tracking-widest text-primary">
                                    Sample workspace
                                </p>
                                <p className="relative mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                                    From scan to validated system
                                </p>
                                <p className="relative mt-1 max-w-[52ch] text-xs text-muted-foreground">
                                    Eight engines read the feed, backtests prove the idea, risk gates the order.
                                </p>
                                <div className="relative mt-3 flex flex-wrap gap-2">
                                    <Link
                                        href="/strategy-lab"
                                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                                    >
                                        Open Strategy Lab
                                    </Link>
                                    <Link
                                        href="/backtests"
                                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40"
                                    >
                                        Browse runs
                                    </Link>
                                </div>
                            </div>

                            {/* View tabs */}
                            <div className="flex shrink-0 gap-1 rounded-xl bg-muted/60 p-1" role="tablist" aria-label="Console views">
                                {VIEWS.map((v) => (
                                    <button
                                        key={v.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={view === v.id}
                                        onClick={() => setView(v.id)}
                                        className={cn(
                                            "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                                            view === v.id
                                                ? "bg-card text-foreground shadow-xs"
                                                : "text-muted-foreground hover:text-foreground",
                                        )}
                                    >
                                        {v.label}
                                    </button>
                                ))}
                            </div>

                            {/* Panels */}
                            {view === "overview" && (
                                <div className="grid min-h-0 gap-3 lg:grid-cols-[1.5fr_1fr]">
                                    <div className="min-w-0">
                                        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                            <BarChart3 size={13} className="text-primary" aria-hidden /> XAUUSD · H1 sample
                                        </p>
                                        <div className="mt-2 overflow-hidden rounded-xl border border-border">
                                            <HomeCandleChart seed={11} basePrice={2650} precision={2} count={56} stepSeconds={3600} height={190} label="Hero console illustrative sample" />
                                        </div>
                                    </div>
                                    <div className="hidden min-w-0 flex-col gap-3 lg:flex">
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground">Sessions</p>
                                            <ul className="mt-2 space-y-1.5">
                                                {[
                                                    ["Tokyo", "Range structure"],
                                                    ["London", "Liquidity sweeps"],
                                                    ["New York", "Trend continuation"],
                                                ].map(([name, desc]) => (
                                                    <li key={name} className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-xs">
                                                        <span className="flex items-center gap-1.5 font-medium text-foreground">
                                                            <span className="h-1.5 w-1.5 rounded-full bg-positive" aria-hidden />
                                                            {name}
                                                        </span>
                                                        <span className="text-[11px] text-muted-foreground">{desc}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground">Recorded</p>
                                            <div className="mt-2 grid grid-cols-2 gap-1.5">
                                                {[
                                                    [String(stats.strategies), "Strategies"],
                                                    [String(stats.backtests), "Backtests"],
                                                ].map(([v, l]) => (
                                                    <div key={l} className="rounded-lg border border-border px-2.5 py-2">
                                                        <p className="font-numeric text-base font-semibold text-foreground">{v}</p>
                                                        <p className="text-[11px] text-muted-foreground">{l}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {view === "signals" && (
                                <div className="grid min-h-0 gap-3 lg:grid-cols-[1.5fr_1fr]">
                                    <SignalLifecycle />
                                    <div className="flex flex-col gap-3">
                                        <RiskMini />
                                        <Link href="/signals" className="text-xs font-semibold text-primary hover:underline">
                                            Open Signal Center →
                                        </Link>
                                    </div>
                                </div>
                            )}

                            {view === "backtests" && (
                                <div className="grid min-h-0 gap-3 lg:grid-cols-[1.5fr_1fr]">
                                    <ReturnsHistogram />
                                    <div className="flex flex-col gap-3">
                                        <TelemetryMini />
                                        <div className="grid grid-cols-2 gap-1.5">
                                            <div className="rounded-lg border border-border px-2.5 py-2">
                                                <p className="font-numeric text-base font-semibold text-foreground">{backtestAnalytics.total}</p>
                                                <p className="text-[11px] text-muted-foreground">Recorded runs</p>
                                            </div>
                                            <div className="rounded-lg border border-border px-2.5 py-2">
                                                <p className="font-numeric text-base font-semibold text-foreground">
                                                    {backtestAnalytics.analyzableCount > 0
                                                        ? `${backtestAnalytics.avgWinRate.toFixed(1)}%`
                                                        : "—"}
                                                </p>
                                                <p className="text-[11px] text-muted-foreground">Avg win rate</p>
                                            </div>
                                        </div>
                                        <Link href="/backtests" className="text-xs font-semibold text-primary hover:underline">
                                            Open Backtest Studio →
                                        </Link>
                                    </div>
                                </div>
                            )}

                            {/* Featured */}
                            <div className="max-sm:hidden">
                                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                    <ScrollText size={13} className="text-primary" aria-hidden /> Featured strategies
                                </p>
                                <div className="mt-2 grid grid-cols-3 gap-2">
                                    {featured.slice(0, 3).map((p) => (
                                        <StrategyMini key={p.id} product={p} />
                                    ))}
                                    {featured.length === 0 && (
                                        <p className="col-span-3 rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                                            No marketplace listings yet — new systems appear here when published.
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Status */}
                            <div className="flex shrink-0 items-center gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                                <ShieldCheck size={13} className="shrink-0 text-positive" aria-hidden />
                                <span className="font-numeric">Deterministic engines · risk-gated gateway · audited runs</span>
                                <Badge variant="outline" className="ml-auto shrink-0 font-numeric text-[10px] normal-case">
                                    Sample preview
                                </Badge>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Reveal>
    );
}
