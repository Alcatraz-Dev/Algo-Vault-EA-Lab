"use client";

/**
 * Pro Trading Extension — the user-facing landing page for the premium
 * AlgoVault Pro TradingView companion Chrome Extension.
 *
 * Routing contract:
 *   • Subscribed Pro users  → install / connect / manage screen (the actual
 *     product surface, with deep-link to the Chrome Web Store listing, live
 *     TradingView MCP connection status, install detection, and feature
 *     shortcuts).
 *   • Non-Pro users        → premium feature showcase and pricing CTA. No
 *     privileged endpoint is callable from here without server-side Pro
 *     enforcement.
 *
 * Server-side entitlement is the source of truth (`/api/extension/pro-access`).
 * Nothing on this page is allowed to claim "you have Pro" — it only renders
 * what the server answered.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    BadgeCheck,
    Bell,
    Brain,
    ChartLine,
    CheckCircle2,
    CircuitBoard,
    Cpu,
    Download,
    ExternalLink,
    Eye,
    Gauge,
    Globe,
    Loader2,
    Lock,
    Radar,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Star,
    Target,
    TrendingUp,
    Workflow,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import { cn } from "@/lib/utils";

/* ── Pro status payload (server answer) ───────────────────────────────── */

interface ProAccessResponse {
    success: boolean;
    access: "granted" | "denied";
    subscription?: {
        plan?: string;
        status?: string;
        currentPeriodEnd?: number | null;
    };
    reason?: string;
    upgrade?: boolean;
    message?: string;
    userId?: string;
    timestamp?: number;
}

interface ExtensionHealthResponse {
    success: boolean;
    flags: Record<string, boolean>;
    timestamp: number;
}

/* ── feature grid (drives the UI; mirrors /api/extension/pro-feature-flag keys) ── */

interface FeatureSpec {
    id: string;
    title: string;
    description: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
}

const PRO_FEATURES: FeatureSpec[] = [
    {
        id: "tradingViewProExtension",
        title: "AI Chart Copilot",
        description:
            "Ask the copilot anything about the current chart. It reads your TradingView context, the AlgoVault Market Intelligence layer, and replies with traceable reasoning.",
        icon: Brain,
    },
    {
        id: "aiChartCopilot",
        title: "Evidence-based Analysis",
        description:
            "Every conclusion comes with the underlying evidence — market structure, liquidity sweeps, indicator confluences and the conflicting signals — so the AI never behaves like a black box.",
        icon: BadgeCheck,
    },
    {
        id: "setupRadar",
        title: "AI Setup Radar",
        description:
            "Continuously monitors your active TradingView chart and the connected strategies for forming, confirmed and invalidated setups. Uses the existing AlgoVault Setup Memory lifecycle.",
        icon: Radar,
    },
    {
        id: "smartAlerts",
        title: "Smart Alerts",
        description:
            "Deterministic alerts from your real indicator conditions — liquidity sweeps, EMA alignment, FVG confirmation, HTF conflicts. AI explains and prioritises; it never invents market events.",
        icon: Bell,
    },
    {
        id: "aiIndicatorGenerator",
        title: "AI Indicator Generator",
        description:
            "Describe the indicator you want in natural language. The extension drafts a Pine Script specification, generates compatible code, validates the syntax and lets you save it to your AlgoVault library.",
        icon: CircuitBoard,
    },
    {
        id: "aiStrategyGenerator",
        title: "AI Strategy Generator",
        description:
            "Generate complete strategies from a description, then hand them straight to the existing AlgoVault backtesting engine. No duplicate infrastructure — the strategy lives in your existing library.",
        icon: Workflow,
    },
];

/* ── chrome-extension install helpers ──────────────────────────────────── */

const EXTENSION_INSTALL_ID = "algovault-trading-intelligence";
const CHROME_WEB_STORE_SEARCH =
    "https://chromewebstore.google.com/search/algovault%20trading%20intelligence";

function chromeRuntimeAvailable(): boolean {
    return typeof window !== "undefined" && typeof (window as unknown as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id === "string";
}

export default function ProTradingExtensionPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [proStatus, setProStatus] = useState<ProAccessResponse | null>(null);
    const [statusLoading, setStatusLoading] = useState(true);
    const [extensionConnected, setExtensionConnected] = useState(false);
    const [healthFlags, setHealthFlags] = useState<Record<string, boolean>>({});
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /* ── auth state ─────────────────────────────────────────────────────── */
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setAuthLoading(false);
        });
        return () => unsub();
    }, []);

    const fetchProStatus = useCallback(async (uid: string) => {
        setStatusLoading(true);
        setError(null);
        try {
            const token = await user?.getIdToken?.();
            const res = await fetch("/api/extension/pro-access", {
                method: "GET",
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                cache: "no-store",
            });
            const data = (await res.json().catch(() => ({}))) as ProAccessResponse;
            setProStatus(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load Pro status");
        } finally {
            setStatusLoading(false);
        }
    }, [user]);

    const fetchHealth = useCallback(async () => {
        try {
            const token = await user?.getIdToken?.();
            const res = await fetch("/api/extension/pro-feature-flag", {
                method: "GET",
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                cache: "no-store",
            });
            const data = (await res.json().catch(() => ({}))) as ExtensionHealthResponse;
            if (data?.flags && typeof data.flags === "object") {
                setHealthFlags(data.flags);
            }
        } catch {
            /* health is optional */
        }
    }, [user]);

    useEffect(() => {
        if (!user) {
            setStatusLoading(false);
            return;
        }
        void fetchProStatus(user.uid);
        void fetchHealth();
    }, [user, fetchProStatus, fetchHealth]);

    useEffect(() => {
        setExtensionConnected(chromeRuntimeAvailable());
    }, []);

    const refresh = useCallback(async () => {
        if (!user) return;
        setRefreshing(true);
        await fetchProStatus(user.uid);
        await fetchHealth();
        setRefreshing(false);
    }, [user, fetchProStatus, fetchHealth]);

    const isPro = proStatus?.access === "granted";
    const subscription = proStatus?.subscription;
    const isExpired = subscription?.status === "expired" || subscription?.status === "cancelled" || subscription?.status === "past_due";

    const activeFeatureCount = useMemo(
        () => Object.values(healthFlags).filter(Boolean).length,
        [healthFlags]
    );

    return (
        <AccountShell
            title="Pro Trading Extension"
            subtitle="The premium AlgoVault TradingView companion — an AI-powered intelligence terminal that lives directly beside your chart."
            eyebrow={
                <span
                    className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-semibold uppercase tracking-wider",
                        isPro
                            ? "border-brand-500/30 bg-brand-500/10 text-brand-300"
                            : "border-edge bg-card text-ink-mute"
                    )}
                >
                    <Lock size={10} />
                    {isPro ? "Pro Active" : "Pro Gated"}
                </span>
            }
        >
            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                {/* main column */}
                <div className="space-y-6">
                    {/* Hero */}
                    <section
                        className={cn(
                            "relative overflow-hidden rounded-lg border border-edge p-8",
                            "bg-gradient-to-br from-brand-500/10 via-surface to-surface",
                            "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
                        )}
                    >
                        <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-brand-500/15 blur-3xl" aria-hidden />
                        <div className="absolute -left-32 -bottom-32 h-72 w-72 rounded-full bg-brand-500/10 blur-3xl" aria-hidden />
                        <div className="relative">
                            <div className="flex items-center gap-2 text-brand-300">
                                <Sparkles size={16} />
                                <span className="text-xs font-semibold uppercase tracking-widest">AlgoVault Pro</span>
                            </div>
                            <h1 className="mt-3 text-3xl font-bold tracking-tight">AlgoVault Pro Trading Intelligence</h1>
                            <p className="mt-3 max-w-2xl text-sm text-ink-mute">
                                TradingView + TradingView MCP + AlgoVault Market Intelligence + AI — one professional Pro trading
                                intelligence environment that lives directly beside your chart.
                            </p>

                            <div className="mt-6 flex flex-wrap gap-3">
                                {isPro ? (
                                    <>
                                            <a
                                                href={CHROME_WEB_STORE_SEARCH}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold  text-ink shadow-[0_8px_24px_-12px_rgba(255,77,0,0.6)] transition hover:bg-brand-400"
                                            >
                                                <Download size={14} /> Get the Extension
                                                <ExternalLink size={11} className="opacity-80" />
                                            </a>
                                            <Link
                                                href="/strategy-lab"
                                                className="inline-flex items-center gap-2 rounded-lg border border-edge bg-card px-4 py-2 text-xs font-medium text-ink transition hover:border-brand-500/40"
                                            >
                                                <ChartLine size={14} /> Open Strategy Lab
                                            </Link>
                                        </>
                                ) : (
                                    <>
                                        <Link
                                            href="/pricing"
                                            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white shadow-[0_8px_24px_-12px_rgba(255,77,0,0.6)] transition hover:bg-brand-400"
                                        >
                                            <Star size={14} /> Upgrade to Pro
                                            <ArrowRight size={11} className="opacity-80" />
                                        </Link>
                                        <Link
                                            href="/ai-copilot"
                                            className="inline-flex items-center gap-2 rounded-lg border border-edge bg-card px-4 py-2 text-xs font-medium text-ink transition hover:border-brand-500/40"
                                        >
                                            <Eye size={14} /> Preview the AI Copilot
                                        </Link>
                                    </>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Feature grid */}
                    <section>
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-base font-semibold tracking-tight">Pro extension features</h2>
                            <span className="text-micro uppercase tracking-wider text-ink-faint">
                                {activeFeatureCount}/{PRO_FEATURES.length} live in your build
                            </span>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {PRO_FEATURES.map((f) => {
                                const live = healthFlags[f.id] ?? false;
                                const Icon = f.icon;
                                return (
                                    <article
                                        key={f.id}
                                        className={cn(
                                            "group relative overflow-hidden rounded-xl border border-edge bg-card p-4 transition-all",
                                            "hover:border-brand-500/30 hover:bg-card/80",
                                            live && "ring-1 ring-brand-500/10"
                                        )}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex h-9 w-11 items-center justify-center rounded-lg bg-brand-500/10 text-brand-300">
                                                <Icon size={18} />
                                            </div>
                                            <span
                                                className={cn(
                                                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider",
                                                    live
                                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                                        : "border-edge bg-raised text-ink-faint"
                                                )}
                                            >
                                                <span className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-emerald-400 animate-pulse-dot" : "bg-ink-faint")} />
                                                {live ? "Live" : "Soon"}
                                            </span>
                                        </div>
                                        <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
                                        <p className="mt-1 text-xs leading-relaxed text-ink-mute">{f.description}</p>
                                    </article>
                                );
                            })}
                        </div>
                    </section>

                    {/* How it works */}
                    <section className="rounded-xl border border-edge bg-card p-6">
                        <h2 className="text-base font-semibold tracking-tight">How it works</h2>
                        <p className="mt-1 text-xs text-ink-mute">
                            The extension connects your TradingView context to the AlgoVault intelligence stack. Nothing is invented —
                            every conclusion is traceable to a real data point.
                        </p>
                        <ol className="mt-5 grid gap-3 sm:grid-cols-2">
                            {[
                                { icon: Globe, title: "TradingView detection", body: "Symbol, exchange and timeframe are read live from the active chart." },
                                { icon: Cpu, title: "TradingView MCP", body: "Optional connection enriches with screener, news, watchlists and technicals." },
                                { icon: Gauge, title: "Market Intelligence", body: "Reuses the existing AlgoVault engine: structure, liquidity, regime, MTF." },
                                { icon: Sparkles, title: "AI layer", body: "Structured analysis with explicit evidence and conflicting signals — never a black box." },
                            ].map((step, idx) => (
                                <li key={step.title} className="flex gap-3 rounded-lg border border-edge bg-base/60 p-3">
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-500/10 text-micro font-semibold text-brand-300">
                                        {idx + 1}
                                    </span>
                                    <div>
                                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                                            <step.icon size={12} className="text-brand-300" />
                                            {step.title}
                                        </div>
                                        <p className="mt-1 text-micro leading-relaxed text-ink-mute">{step.body}</p>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </section>
                </div>

                {/* sidebar */}
                <aside className="space-y-4">
                    {/* entitlement card */}
                    <section className="rounded-xl border border-edge bg-card p-5">
                        <header className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Entitlement</h3>
                            <button
                                onClick={refresh}
                                disabled={refreshing || !user}
                                className="rounded p-1 text-ink-mute transition hover:bg-raised hover:text-ink disabled:opacity-30"
                                title="Refresh"
                            >
                                <RefreshCw size={12} className={cn(refreshing && "animate-spin")} />
                            </button>
                        </header>

                        {authLoading || statusLoading ? (
                            <div className="mt-4 flex items-center gap-2 text-xs text-ink-mute">
                                <Loader2 size={12} className="animate-spin" /> Checking your subscription…
                            </div>
                        ) : !user ? (
                            <div className="mt-4 space-y-3">
                                <p className="text-xs text-ink-mute">Sign in to view your Pro entitlement.</p>
                                <Link
                                    href="/login"
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-edge bg-base px-3 py-2 text-xs font-medium transition hover:border-brand-500/40"
                                >
                                    Sign in
                                </Link>
                            </div>
                        ) : error ? (
                            <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-400">
                                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                                <span>{error}</span>
                            </div>
                        ) : (
                            <div className="mt-4 space-y-3">
                                <div
                                    className={cn(
                                        "flex items-start gap-3 rounded-lg border p-3",
                                        isPro && !isExpired
                                            ? "border-brand-500/30 bg-brand-500/5"
                                            : "border-edge bg-raised"
                                    )}
                                >
                                    <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", isPro && !isExpired ? "bg-brand-500/20 text-brand-300" : "bg-raised text-ink-mute")}>
                                        {isPro && !isExpired ? <ShieldCheck size={14} /> : <Lock size={14} />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-semibold">
                                                {isPro && !isExpired
                                                    ? "Pro access granted"
                                                    : isPro && isExpired
                                                    ? "Pro expired"
                                                    : "No Pro subscription"}
                                            </p>
                                            {isPro && !isExpired ? (
                                                <CheckCircle2 size={12} className="text-emerald-400" />
                                            ) : null}
                                        </div>
                                        <p className="mt-0.5 text-micro text-ink-mute">
                                            {isPro && !isExpired && subscription?.plan
                                                ? `Plan: ${subscription.plan} · status: ${subscription.status ?? "active"}`
                                                : isPro && isExpired
                                                ? "Your subscription has lapsed. Renew to restore extension access."
                                                : "Upgrade to Pro to unlock the extension features."}
                                        </p>
                                    </div>
                                </div>

                                {!isPro || isExpired ? (
                                    <Link
                                        href="/pricing"
                                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-400"
                                    >
                                        {isExpired ? "Renew Pro" : "Upgrade to Pro"}
                                        <ArrowRight size={11} />
                                    </Link>
                                ) : null}
                            </div>
                        )}

                        <p className="mt-4 text-micro leading-relaxed text-ink-faint">
                            Entitlement is verified server-side. Disabling scripts or replaying requests cannot unlock Pro features.
                        </p>
                    </section>

                    {/* extension install card */}
                    <section className="rounded-xl border border-edge bg-card p-5">
                        <header className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">Browser extension</h3>
                            <span
                                className={cn(
                                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider",
                                    extensionConnected
                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                        : "border-edge bg-raised text-ink-faint"
                                )}
                            >
                                <span className={cn("h-1.5 w-1.5 rounded-full", extensionConnected ? "bg-emerald-400 animate-pulse-dot" : "bg-ink-faint")} />
                                {extensionConnected ? "Detected" : "Not installed"}
                            </span>
                        </header>
                        <p className="mt-3 text-xs leading-relaxed text-ink-mute">
                            {extensionConnected
                                ? "AlgoVault extension is installed and connected on this browser. Open TradingView to start."
                                : "Install the Chrome extension to dock AlgoVault Pro Trading Intelligence next to TradingView."}
                        </p>
                        <div className="mt-4 space-y-2">
                            <a
                                href={CHROME_WEB_STORE_SEARCH}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-edge bg-base px-3 py-2 text-xs font-medium transition hover:border-brand-500/40"
                            >
                                <Download size={12} /> Open in Chrome Web Store
                                <ExternalLink size={10} className="opacity-60" />
                            </a>
                            {extensionConnected ? (
                                <Link
                                    href="/account/pro-trading-extension/install"
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-raised px-3 py-2 text-xs font-medium text-ink transition hover:bg-[#2a2a2a]"
                                >
                                    <Activity size={12} /> Manage installation
                                </Link>
                            ) : null}
                        </div>
                    </section>

                    {/* usage card */}
                    <section className="rounded-xl border border-edge bg-card p-5">
                        <h3 className="text-sm font-semibold">Extension requirements</h3>
                        <ul className="mt-3 space-y-2 text-xs text-ink-mute">
                            <li className="flex items-center gap-2">
                                <CheckCircle2 size={11} className="text-emerald-400" /> Chrome, Edge, Brave or any Chromium 116+
                            </li>
                            <li className="flex items-center gap-2">
                                <CheckCircle2 size={11} className="text-emerald-400" /> Active AlgoVault Pro subscription
                            </li>
                            <li className="flex items-center gap-2">
                                <CheckCircle2 size={11} className="text-emerald-400" /> TradingView account (free or paid)
                            </li>
                            <li className="flex items-center gap-2">
                                <CheckCircle2 size={11} className="text-emerald-400" /> Optional: TradingView MCP for richer context
                            </li>
                        </ul>
                    </section>
                </aside>
            </div>
        </AccountShell>
    );
}

/* Avoid unused-icon lint if future edits drop usage */
void [TrendingUp, Target];