"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    Activity,
    ArrowRight,
    BarChart3,
    Brain,
    CalendarDays,
    ChevronRight,
    CircleAlert,
    Copy,
    Database,
    Gauge,
    History,
    Play,
    Search,
    Send,
    ShieldAlert,
    ShieldCheck,
    Sliders,
    Sparkles,
    Terminal,
    Wallet,
    Zap,
} from "lucide-react";
import { database } from "@/lib/firebase";
import { onValue, ref } from "firebase/database";
import type { HomeData, HomeBacktest, HomeProduct } from "@/lib/home-data";
import SiteHeader from "./site-header";
import SiteFooter from "@/components/footer/SiteFooter";
import Reveal from "./Reveal";
import CountUp from "./CountUp";
import TickerStrip from "./TickerStrip";
import HeroConsoleChart from "./HeroConsoleChart";
import EvidenceAnalytics from "./EvidenceAnalytics";
import EcosystemSection from "./EcosystemSection";

function formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(value);
}

function formatPrice(value?: number, currency = "USD"): string {
    if (value === undefined || !Number.isFinite(value)) return "Unavailable";
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function ProductRow({ product }: { product: HomeProduct }) {
    return (
        <Link href={`/marketplace/${product.slug || product.id}`} className="group flex items-center justify-between border-t border-border px-4 py-3 transition-colors hover:bg-muted/60">
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{product.name || "Unnamed strategy"}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{[product.symbol, product.timeframe, product.platform].filter(Boolean).join(" · ") || "Marketplace listing"}</p>
            </div>
            <div className="ml-4 flex shrink-0 items-center gap-3 text-right">
                <span className="font-mono text-sm text-primary">{formatPrice(product.pricing?.price, product.pricing?.currency)}</span>
                <ChevronRight size={15} className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </div>
        </Link>
    );
}

const MODULES: { icon: typeof BarChart3; title: string; href: string; copy: string }[] = [
    { icon: BarChart3, title: "Strategy Lab", href: "/strategy-lab", copy: "Discover structural patterns, build visual strategies, and generate Pine Script v6 or MQL5 code." },
    { icon: Search, title: "Market Scanner", href: "/scanner", copy: "Regime, liquidity, volume and VWAP structure read consistently across timeframes." },
    { icon: History, title: "Backtest Studio", href: "/backtests", copy: "Deterministic simulations with real spread, slippage and commission models." },
    { icon: Play, title: "Trade Replay", href: "/trade-replay", copy: "Step real market history bar by bar with no look-ahead bias." },
    { icon: ShieldAlert, title: "Risk & Drawdown", href: "/risk", copy: "Pre-trade validation, daily loss limits and drawdown guards on every entry." },
    { icon: Zap, title: "Signal Center", href: "/signals", copy: "AI-normalized signals with a canonical, audited lifecycle from new to closed." },
    { icon: Copy, title: "Copy Trading", href: "/copy-trading", copy: "Risk-scaled mirroring between verified strategies and follower allocations." },
    { icon: Activity, title: "Live Monitoring", href: "/live", copy: "Equity, drawdown and gateway heartbeats surfaced in one operating console." },
    { icon: Brain, title: "AI Copilot", href: "/ai-copilot", copy: "Ask natural-language questions about structure, risk and your workspace." },
    { icon: CalendarDays, title: "Economic Calendar", href: "/economic-calendar", copy: "High-impact events mapped to your trading sessions and open setups." },
    { icon: Send, title: "Execution Gateway", href: "/account/trading-access", copy: "A risk-gated HTTP bridge to MetaTrader through a custom MQL5 Expert Advisor." },
    { icon: Wallet, title: "Marketplace", href: "/marketplace", copy: "Verified Expert Advisors, indicators and set files with license activation." },
];

const ENGINES = [
    { name: "Regime Classification", copy: "Trend, range, or momentum computed from real OHLC features." },
    { name: "Market Structure", copy: "Swing highs/lows, breaks and structural events detected bar by bar." },
    { name: "Institutional Zones", copy: "Order blocks and fair value gaps mapped from confirmed structure." },
    { name: "Liquidity Map", copy: "Session highs/lows and sweep targets tracked as reference levels." },
    { name: "VWAP Anchoring", copy: "Session-rolled volume-weighted anchor with price position." },
    { name: "Session Analytics", copy: "London / New York / Tokyo participation from real timestamps." },
    { name: "Volume & Volatility", copy: "Relative volume and ATR-based volatility regime." },
    { name: "Market Score", copy: "A weighted composite of the engines above, 0–100." },
];

const AI_CAPABILITIES = [
    { name: "Confluence Summary", copy: "States which deterministic edges agree and where they conflict, citing each engine." },
    { name: "Scenario Narrative", copy: "A conditional read of structure: what confirms the setup, what invalidates it." },
    { name: "Parameter Suggestion", copy: "Starting-value proposals derived from observed volatility." },
    { name: "Execution Recommendation", copy: "A controlled directional recommendation that must still pass the risk validator." },
];

const LIVE_PATH = ["NEW", "PENDING_ENTRY", "ENTRY_TRIGGERED", "TP_REACHED", "CLOSED"];
const TERMINAL_STATES = ["STOPPED_OUT", "EXPIRED", "CANCELLED", "INVALIDATED"];

export default function HomePage({ data }: { data: HomeData }) {
    const [siteName, setSiteName] = useState("AlgoVault");
    const { stats, featured, latestBacktests, backtestAnalytics, previewBacktests } = data;

    useEffect(() => {
        const unsubscribe = onValue(ref(database, "settings/siteName"), (snapshot) => {
            const value = snapshot.val();
            if (typeof value === "string" && value.trim()) setSiteName(value.trim());
        });
        return () => unsubscribe();
    }, []);

    const dataOnline = stats.strategies > 0 || stats.backtests > 0;

    return (
        <div className="min-h-screen overflow-x-clip bg-background font-mono text-foreground selection:bg-primary selection:text-primary-foreground">
            <SiteHeader />
            <main>
                <TickerStrip />

                {/* ── Hero ── */}
                <section className="relative overflow-hidden border-b border-border bg-background">
                    <div aria-hidden="true" className="absolute inset-0">
                        <div className="hero-radial -top-40 left-[-10%] h-[520px] w-[520px]" />
                        <div className="hero-radial-positive -bottom-48 right-[-8%] h-[460px] w-[460px]" />
                        <div className="absolute inset-0 bg-grid-pattern opacity-40" />
                    </div>
                    <div className="page-container relative grid gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-24">
                        <Reveal>
                            <div>
                                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />Real market infrastructure
                                </div>
                                <h1 className="max-w-4xl text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-foreground sm:text-6xl lg:text-7xl">Build conviction before you place the trade.</h1>
                                <p className="mt-6 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                                    {siteName} connects market data, deterministic analysis, strategy research, risk controls, and MT5 execution in one calm operating surface. What you see is what was recorded — no fabricated numbers.
                                </p>
                                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                                    <Link href="/register" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85">Start building <ArrowRight size={16} /></Link>
                                    <Link href="/strategy-lab" className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted">Open Strategy Lab</Link>
                                </div>
                                <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-2"><ShieldCheck size={14} className="text-positive" />Deterministic first</span>
                                    <span className="flex items-center gap-2"><Database size={14} className="text-info" />Provider-backed data</span>
                                    <span className="flex items-center gap-2"><CircleAlert size={14} className="text-warning" />Honest stale states</span>
                                </div>
                            </div>
                        </Reveal>

                        <Reveal delay={140}>
                            <div className="rounded-lg border border-border bg-card shadow-sm">
                                <div className="flex items-center justify-between border-b border-border px-4 py-3 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-2"><Terminal size={14} className="text-primary" />Operating console</span>
                                    <span className="flex items-center gap-2">
                                        <span className={`relative flex h-1.5 w-1.5`}>
                                            <span className={`absolute inline-flex h-full w-full rounded-full ${dataOnline ? "animate-ping bg-positive/60" : ""}`} />
                                            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dataOnline ? "bg-positive" : "bg-muted-foreground"}`} />
                                        </span>
                                        {dataOnline ? "Data feed online" : "Awaiting data"}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-px bg-border">
                                    <div className="bg-card p-5">
                                        <p className="text-xs text-muted-foreground">Strategies</p>
                                        <p className="mt-3 text-3xl font-semibold text-foreground"><CountUp value={stats.strategies} format={formatNumber} /></p>
                                        <p className="mt-2 text-xs text-muted-foreground">Marketplace records</p>
                                    </div>
                                    <div className="bg-card p-5">
                                        <p className="text-xs text-muted-foreground">Backtests</p>
                                        <p className="mt-3 text-3xl font-semibold text-foreground"><CountUp value={stats.backtests} format={formatNumber} /></p>
                                        <p className="mt-2 text-xs text-muted-foreground">Recorded runs</p>
                                    </div>
                                    <div className="bg-card p-5">
                                        <p className="text-xs text-muted-foreground">Deterministic engines</p>
                                        <p className="mt-3 text-3xl font-semibold text-foreground"><CountUp value={ENGINES.length} format={formatNumber} /></p>
                                        <p className="mt-2 text-xs text-muted-foreground">Computed from candles</p>
                                    </div>
                                    <div className="bg-card p-5">
                                        <p className="text-xs text-muted-foreground">Rated strategies</p>
                                        <p className="mt-3 text-3xl font-semibold text-foreground"><CountUp value={stats.reviewCount} format={formatNumber} /></p>
                                        <p className="mt-2 text-xs text-muted-foreground">Average {stats.averageRating > 0 ? `${stats.averageRating}/5` : "unavailable"}</p>
                                    </div>
                                </div>
                                <HeroConsoleChart />
                                <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Aggregate statistics only — no account numbers or user details on this page. {previewBacktests ? "Backtest figures shown are sample previews until recorded runs are published." : ""}</div>
                            </div>
                        </Reveal>
                    </div>
                </section>

                {/* ── One operating loop ── */}
                <section className="border-b border-border bg-muted/30">
                    <div className="page-container py-14 md:py-20">
                        <Reveal>
                            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">One operating loop</p>
                                    <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-5xl">From observation to execution.</h2>
                                </div>
                                <p className="max-w-md text-sm leading-6 text-muted-foreground">Every stage stays connected to the same symbol, timeframe, data age, and risk context.</p>
                            </div>
                        </Reveal>
                        <Reveal delay={100}>
                            <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
                                {[
                                    { icon: BarChart3, title: "Read", copy: "Normalize provider candles and market context." },
                                    { icon: Sparkles, title: "Explain", copy: "Use AI to interpret deterministic outputs." },
                                    { icon: Gauge, title: "Validate", copy: "Backtest, optimize, and inspect robustness." },
                                    { icon: Wallet, title: "Execute", copy: "Queue orders behind risk and gateway checks." },
                                ].map(({ icon: Icon, title, copy }, index) => (
                                    <div key={title} className="group bg-card p-5 transition-colors hover:bg-muted/40">
                                        <div className="flex items-center justify-between">
                                            <Icon size={18} className="text-primary transition-transform duration-300 group-hover:-translate-y-0.5" />
                                            <span className="text-xs text-muted-foreground">0{index + 1}</span>
                                        </div>
                                        <h3 className="mt-10 text-base font-semibold text-foreground">{title}</h3>
                                        <p className="mt-2 text-xs leading-5 text-muted-foreground">{copy}</p>
                                    </div>
                                ))}
                            </div>
                        </Reveal>
                    </div>
                </section>

                {/* ── Connected ecosystem (logos + flow) ── */}
                <EcosystemSection />

                {/* ── Platform map ── */}
                <section className="border-b border-border bg-background">
                    <div className="page-container py-14 md:py-20">
                        <Reveal>
                            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Platform map</p>
                                    <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-5xl">The whole workflow, in one place.</h2>
                                </div>
                                <p className="max-w-md text-sm leading-6 text-muted-foreground">Research, validation, signals, execution, and monitoring are separate modules sharing one vocabulary.</p>
                            </div>
                        </Reveal>
                        <Reveal delay={120}>
                            <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
                                {MODULES.map(({ icon: Icon, title, href, copy }) => (
                                    <Link key={href} href={href} className="group relative bg-card p-5 transition-colors hover:bg-muted/60">
                                        <div className="flex items-center justify-between">
                                            <Icon size={18} className="text-primary transition-transform duration-300 group-hover:-translate-y-0.5" />
                                            <ChevronRight size={15} className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                                        </div>
                                        <h3 className="mt-8 text-base font-semibold text-foreground">{title}</h3>
                                        <p className="mt-2 text-xs leading-5 text-muted-foreground">{copy}</p>
                                        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary/0 transition-colors duration-300 group-hover:bg-primary/50" />
                                    </Link>
                                ))}
                            </div>
                        </Reveal>
                    </div>
                </section>

                {/* ── Deterministic intelligence ── */}
                <section className="border-b border-border bg-muted/30">
                    <div className="page-container py-14 md:py-20">
                        <Reveal>
                            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Deterministic first</p>
                                    <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-5xl">Computed facts, then AI on top.</h2>
                                </div>
                                <p className="max-w-md text-sm leading-6 text-muted-foreground">The deterministic layer is reproducible from the same candles; the AI layer explains — it never fabricates what the engines did not produce.</p>
                            </div>
                        </Reveal>
                        <div className="mt-10 grid gap-6 lg:grid-cols-2">
                            <Reveal delay={80}>
                            <div className="rounded-lg border border-border bg-card">
                                <div className="border-b border-border px-5 py-4">
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Deterministic layer</p>
                                    <h3 className="mt-2 text-xl font-semibold text-foreground">Eight pure engines on the market feed</h3>
                                </div>
                                <ul className="divide-y divide-border">
                                    {ENGINES.map((engine) => (
                                        <li key={engine.name} className="flex items-start justify-between gap-4 px-5 py-3">
                                            <span className="text-sm font-semibold text-foreground">{engine.name}</span>
                                            <span className="max-w-[55%] text-right text-xs leading-5 text-muted-foreground">{engine.copy}</span>
                                        </li>
                                    ))}
                                </ul>
                                <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-2"><ShieldCheck size={14} className="text-positive" />Deterministic — same candles in, same result out</span>
                                </div>
                            </div>
                            </Reveal>
                            <Reveal delay={180}>
                            <div className="rounded-lg border border-border bg-card">
                                <div className="border-b border-border px-5 py-4">
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">AI interpretation layer</p>
                                    <h3 className="mt-2 text-xl font-semibold text-foreground">Applied on top, kept honest</h3>
                                </div>
                                <ul className="divide-y divide-border">
                                    {AI_CAPABILITIES.map((cap) => (
                                        <li key={cap.name} className="px-5 py-3">
                                            <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Brain size={14} className="shrink-0 text-primary" />{cap.name}</p>
                                            <p className="mt-1 pl-6 text-xs leading-5 text-muted-foreground">{cap.copy}</p>
                                        </li>
                                    ))}
                                </ul>
                                <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-2"><CircleAlert size={14} className="text-warning" />AI cannot override the deterministic risk validator</span>
                                </div>
                            </div>
                            </Reveal>
                        </div>
                    </div>
                </section>

                {/* ── Research record + execution pipeline ── */}
                <section className="border-b border-border bg-background">
                    <div className="page-container grid gap-6 py-14 md:py-20 lg:grid-cols-[1.2fr_0.8fr]">
                        <Reveal>
                        <div className="rounded-lg border border-border bg-card">
                            <div className="flex items-center justify-between border-b border-border px-5 py-4">
                                <div>
                                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                                        Verified workspace
                                        {previewBacktests && (
                                            <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 font-mono text-micro font-medium normal-case tracking-normal text-warning">Sample preview</span>
                                        )}
                                    </p>
                                    <h2 className="mt-2 text-2xl font-semibold text-foreground">Recent research</h2>
                                </div>
                                <Link href="/backtests" className="text-xs font-semibold text-primary hover:underline">View all</Link>
                            </div>
                            {latestBacktests.length > 0 ? latestBacktests.map((backtest: HomeBacktest) => (
                                <div key={backtest.id} className="grid gap-3 border-b border-border px-5 py-4 last:border-0 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                                    <div>
                                        <p className="text-sm font-semibold text-foreground">{backtest.title || "Untitled backtest"}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">{[backtest.pair, backtest.timeframe, backtest.period].filter(Boolean).join(" · ") || "Configuration unavailable"}</p>
                                    </div>
                                    <span className="text-xs text-muted-foreground">Net result <strong className="ml-1 font-mono text-foreground">{backtest.netProfit === undefined ? "Unavailable" : backtest.netProfit >= 0 ? `+${backtest.netProfit}` : backtest.netProfit}</strong></span>
                                    <ChevronRight size={15} className="hidden text-muted-foreground sm:block" />
                                </div>
                            )) : <div className="px-5 py-12 text-center text-sm text-muted-foreground">No backtest data available.</div>}
                            <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                                {previewBacktests
                                    ? "Sample preview runs — publish recorded backtests in the studio to replace them."
                                    : "Stored simulation runs — no live account numbers or user details."}
                            </div>
                        </div>
                        </Reveal>

                        <Reveal delay={140}>
                        <div className="rounded-lg border border-border bg-card">
                            <div className="border-b border-border px-5 py-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Execution pipeline</p>
                                <h2 className="mt-2 text-2xl font-semibold text-foreground">Risk-gated lifecycle</h2>
                            </div>
                            <div className="px-5 py-4">
                                <p className="text-xs font-semibold uppercase tracking-widest text-positive">Active path</p>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {LIVE_PATH.map((state, idx) => (
                                        <span key={state} className="inline-flex items-center gap-1 rounded-full border border-positive/30 bg-positive/10 px-2.5 py-0.5 text-xs font-medium text-positive">
                                            {idx < LIVE_PATH.length - 1 && <span className="text-positive/40">→</span>}
                                            {state}
                                        </span>
                                    ))}
                                </div>
                                <div className="flow-track mt-4">
                                    <span className="flow-dot" />
                                </div>
                                <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-warning">Terminal states</p>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {TERMINAL_STATES.map((state) => (
                                        <span key={state} className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">{state}</span>
                                    ))}
                                </div>
                                <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                                    <ShieldCheck size={14} className="mt-0.5 shrink-0 text-positive" />
                                    Every signal passes the risk validator before the gateway may act. Rejected intents carry a decision code — surfaced, not hidden.
                                </p>
                            </div>
                            <Link href="/signals" className="flex items-center justify-between border-t border-border px-5 py-4 text-xs font-semibold text-primary hover:bg-muted">Open signal console <ArrowRight size={14} /></Link>
                        </div>
                        </Reveal>
                    </div>
                </section>

                {/* ── Recorded evidence (backtest analytics) ── */}
                <EvidenceAnalytics analytics={backtestAnalytics} preview={previewBacktests} />

                {/* ── Marketplace ── */}
                <section className="border-b border-border bg-muted/30">
                    <div className="page-container py-14 md:py-20">
                        <Reveal>
                            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Marketplace</p>
                                    <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-5xl">Strategies with the evidence beside them.</h2>
                                </div>
                                <Link href="/marketplace" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">Browse marketplace <ArrowRight size={15} /></Link>
                            </div>
                        </Reveal>
                        <Reveal delay={100}>
                            <div className="mt-10 overflow-hidden rounded-lg border border-border bg-card">
                                {featured.length > 0 ? featured.slice(0, 5).map((product) => <ProductRow key={product.id} product={product} />) : <div className="px-5 py-12 text-center text-sm text-muted-foreground">No marketplace listings available.</div>}
                            </div>
                        </Reveal>
                    </div>
                </section>

                {/* ── Build & validate tooling ── */}
                <section className="border-b border-border bg-background">
                    <div className="page-container py-14 md:py-20">
                        <Reveal>
                            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Research depth</p>
                                    <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-foreground md:text-5xl">Validate before you risk anything.</h2>
                                </div>
                                <p className="max-w-md text-sm leading-6 text-muted-foreground">The platform ships the validation tooling that normally lives in three separate subscriptions.</p>
                            </div>
                        </Reveal>
                        <Reveal delay={120}>
                            <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
                                <div className="group bg-card p-5 transition-colors hover:bg-muted/40">
                                    <div className="flex items-center justify-between">
                                        <History size={18} className="text-primary transition-transform duration-300 group-hover:-translate-y-0.5" />
                                        <span className="text-xs text-muted-foreground">01</span>
                                    </div>
                                    <h3 className="mt-8 text-base font-semibold text-foreground">Backtest & replay</h3>
                                    <p className="mt-2 text-xs leading-5 text-muted-foreground">Single-pass historical simulations with realistic costs, plus bar-by-bar replay on real candles.</p>
                                    <Link href="/backtests" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open backtests <ArrowRight size={13} /></Link>
                                </div>
                                <div className="group bg-card p-5 transition-colors hover:bg-muted/40">
                                    <div className="flex items-center justify-between">
                                        <Sliders size={18} className="text-primary transition-transform duration-300 group-hover:-translate-y-0.5" />
                                        <span className="text-xs text-muted-foreground">02</span>
                                    </div>
                                    <h3 className="mt-8 text-base font-semibold text-foreground">Optimize & stress</h3>
                                    <p className="mt-2 text-xs leading-5 text-muted-foreground">Parameter grid search, walk-forward windows, and Monte Carlo robustness checks on recorded results.</p>
                                    <Link href="/monte-carlo" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open Monte Carlo <ArrowRight size={13} /></Link>
                                </div>
                                <div className="group bg-card p-5 transition-colors hover:bg-muted/40">
                                    <div className="flex items-center justify-between">
                                        <Send size={18} className="text-primary transition-transform duration-300 group-hover:-translate-y-0.5" />
                                        <span className="text-xs text-muted-foreground">03</span>
                                    </div>
                                    <h3 className="mt-8 text-base font-semibold text-foreground">Execute & monitor</h3>
                                    <p className="mt-2 text-xs leading-5 text-muted-foreground">Risk-validated order dispatch to MetaTrader, with heartbeats, drawdown telemetry, and alert history.</p>
                                    <Link href="/live" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open live console <ArrowRight size={13} /></Link>
                                </div>
                            </div>
                        </Reveal>
                    </div>
                </section>

                {/* ── Final CTA ── */}
                <section className="relative overflow-hidden bg-background">
                    <div aria-hidden="true" className="absolute inset-0">
                        <div className="hero-radial left-1/2 top-1/2 h-[560px] w-[700px] -translate-x-1/2 -translate-y-1/2" />
                        <div className="absolute inset-0 bg-grid-pattern opacity-30" />
                    </div>
                    <div className="page-container relative py-20 md:py-28">
                        <Reveal>
                            <div className="max-w-3xl">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Make the next decision legible.</p>
                                <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.04em] text-foreground md:text-6xl">A calmer terminal for serious research.</h2>
                                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                                    <Link href="/register" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85">Create workspace <ArrowRight size={16} /></Link>
                                    <Link href="/pricing" className="inline-flex h-11 items-center justify-center rounded-md border border-border px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted">See plans</Link>
                                </div>
                            </div>
                        </Reveal>
                    </div>
                </section>
            </main>
            <SiteFooter />
        </div>
    );
}