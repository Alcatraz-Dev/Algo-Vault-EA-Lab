"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft, ArrowRight, Check, Crown, Sparkles, Star, Zap, Lock, CircleDot,
} from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ToolBadge } from "@/components/tools/tier-ui";
import { TOOL_CATALOG } from "@/lib/tools-catalog";

type Tier = {
    id: string;
    name: string;
    emoji: string;
    price: number;
    period: string;
    description: string;
    features: string[];
    highlighted?: boolean;
    cta: string;
    ctaHref: string;
    icon: React.ElementType;
};

const TIERS: Tier[] = [
    {
        id: "free",
        name: "Free / Lite",
        emoji: "🎯",
        price: 0,
        period: "forever",
        description: "The Lite versions of every public tool — useful on their own, free forever.",
        features: [
            "All 10 Lite trading tools (calculators, sessions, correlation…)",
            "AI Scalping Terminal (Free) — live radar + signals + engine feed",
            "Live performance for 1 account",
            "Basic risk calculator (Position size + Pip value)",
            "Free market signals",
            "Notebook (50 entries)",
            "Community Discord access",
        ],
        cta: "Get Started",
        ctaHref: "/register",
        icon: Star,
    },
    {
        id: "pro",
        name: "Pro",
        emoji: "⚡",
        price: 29,
        period: "month",
        description: "Unlock every Pro tool, the chart workspace, replay, persistence and AI explanations.",
        features: [
            "Everything in Free",
            "Pro unlocks on every tool — no more Lite",
            "AI Scalping Terminal (Free) → Pro (chart + overlays + replay + order flow + intelligence + journal)",
            "Advanced Analysis Terminal",
            "Market Intelligence workspace",
            "Strategy Lab, Backtest, Walk-Forward, Monte Carlo",
            "Copy Trading (5 verified masters)",
            "Trade Journal with persistence",
            "AI Copilot, AI Insights, Pro Signals",
            "Alert Center + Pro Alerts",
            "Priority support",
        ],
        cta: "Start Pro",
        ctaHref: "/account/subscribe?plan=pro",
        highlighted: true,
        icon: Zap,
    },
    {
        id: "enterprise",
        name: "Enterprise",
        emoji: "👑",
        price: 99,
        period: "month",
        description: "For teams and institutions managing multiple accounts at scale.",
        features: [
            "Everything in Pro",
            "Unlimited live accounts",
            "Copy Trading (unlimited)",
            "API access",
            "White-label options",
            "Dedicated account manager",
            "Custom integrations",
            "SLA guarantee",
            "Advanced security (2FA, IP whitelist)",
            "Team collaboration tools",
        ],
        cta: "Contact Sales",
        ctaHref: "/account/subscribe?plan=enterprise",
        icon: Crown,
    },
];

const COMPARISON_ROWS = [
    { section: "Calculators & Tools" },
    { feature: "Position Size Calculator", free: "Basic", pro: "Full", ent: "Full" },
    { feature: "Pip Value Calculator", free: true, pro: true, ent: true },
    { feature: "Margin Calculator", free: false, pro: true, ent: true },
    { feature: "Swap / Rollover", free: false, pro: true, ent: true },
    { feature: "Profit Split Calculator", free: false, pro: true, ent: true },
    { feature: "Spread Analyzer", free: false, pro: true, ent: true },
    { feature: "Drawdown Calculator", free: "Fixed %", pro: "Variable + Monte Carlo", ent: "Same as Pro" },
    { feature: "Risk of Ruin", free: "Ruin %", pro: "+ Kelly + EV + Monte Carlo", ent: "Same as Pro" },
    { feature: "Fibonacci", free: "Manual levels", pro: "Auto swing + extensions + saves", ent: "Same as Pro" },
    { feature: "Pip Reference", free: "Curated list", pro: "+ Custom pair calc + matrix", ent: "Same as Pro" },
    { feature: "Broker Fee Comparison", free: "Read-only table", pro: "+ Account-aware ranking + saves", ent: "Same as Pro" },

    { section: "Market Intelligence" },
    { feature: "Correlation Matrix", free: "30d daily only", pro: "+ 7d / 90d + saves + CSV", ent: "Same as Pro" },
    { feature: "Currency Strength", free: "Single TF", pro: "+ MTF + divergence + saves", ent: "Same as Pro" },
    { feature: "Sessions / Overlap", free: "Static grid", pro: "+ Live alerts + best-window pairs + saves", ent: "Same as Pro" },

    { section: "Terminals" },
    { feature: "AI Scalping Terminal", free: "Free: radar, signals, engine feed", pro: "Pro: chart + overlays + replay + order flow + intelligence + journal", ent: "Same as Pro" },
    { feature: "Advanced Analysis Terminal", free: false, pro: true, ent: true },
    { feature: "Market Intelligence workspace", free: false, pro: true, ent: true },

    { section: "Strategy & Backtesting" },
    { feature: "Strategy Lab", free: false, pro: true, ent: true },
    { feature: "Backtesting", free: "Basic reports", pro: "Unlimited", ent: "Unlimited" },
    { feature: "Walk-Forward Validation", free: false, pro: true, ent: true },
    { feature: "Monte Carlo", free: false, pro: true, ent: true },
    { feature: "Verified Performance", free: true, pro: true, ent: true },

    { section: "Trading & Automation" },
    { feature: "Live performance", free: "1 account", pro: "Unlimited", ent: "Unlimited" },
    { feature: "Copy Trading", free: false, pro: "5 masters", ent: "Unlimited" },
    { feature: "Workflow Automation", free: false, pro: true, ent: true },
    { feature: "MT5 Gateway", free: false, pro: true, ent: true },
    { feature: "Trade Replay", free: false, pro: true, ent: true },

    { section: "AI & Signals" },
    { feature: "AI Signals", free: "Basic", pro: "Pro tier", ent: "Pro tier" },
    { feature: "AI Copilot", free: false, pro: true, ent: true },
    { feature: "AI Insights", free: false, pro: true, ent: true },
    { feature: "Alert Center", free: "Basic", pro: "Pro alerts", ent: "Pro alerts" },

    { section: "Account" },
    { feature: "Notebook entries", free: "50", pro: "Unlimited", ent: "Unlimited" },
    { feature: "API access", free: false, pro: false, ent: true },
    { feature: "Priority support", free: false, pro: true, ent: true },
    { feature: "Dedicated account manager", free: false, pro: false, ent: true },
];

export default function PricingPage() {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const router = useRouter();

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
        });
        return () => unsub();
    }, []);

    const handleCta = (tier: Tier) => {
        if (!user) {
            router.push("/login?redirect=/pricing");
            return;
        }
        router.push(tier.ctaHref);
    };

    const freeTools = TOOL_CATALOG.filter((t) => t.tier === "free");
    const proTools = TOOL_CATALOG.filter((t) => t.tier === "pro");

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-7xl px-6 pt-4 pb-20">
                <Link
                    href="/account"
                    className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                >
                    <ArrowLeft size={16} />
                    Back to Account
                </Link>

                {/* Header */}
                <div className="text-center mt-4" data-guide="page-header">
                    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
                        <Sparkles size={13} />
                        Free / Lite vs Pro, side by side
                    </div>
                    <h1 className="mt-6 text-4xl font-semibold tracking-tight md:text-5xl">
                        Tools that earn the upgrade.
                    </h1>
                    <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
                        Every public tool has a real, useful Lite path that&apos;s free forever.
                        Pro unlocks the chart workspace, replay, persistence, AI explanations and exports on top.
                        You only subscribe when Pro gives you something you can use every day.
                    </p>
                </div>

                {/* Tiers */}
                <div className="mt-14 grid gap-6 md:grid-cols-3">
                    {TIERS.map((tier) => {
                        const Icon = tier.icon;
                        return (
                            <div
                                key={tier.id}
                                className={`relative flex flex-col rounded-lg border p-6 transition  ${
                                    tier.highlighted
                                        ? "border-primary bg-card "
                                        : "border-border bg-card"
                                }`}
                            >
                                {tier.highlighted && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-micro font-semibold text-primary-foreground">
                                            <Zap size={11} />
                                            Most Popular
                                        </span>
                                    </div>
                                )}

                                <div className="flex items-center gap-3">
                                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tier.highlighted ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                                        <Icon size={20} />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-semibold">{tier.name}</h2>
                                        <p className="text-xs text-muted-foreground">{tier.description}</p>
                                    </div>
                                </div>

                                <div className="mt-6">
                                    <span className="text-4xl font-bold tracking-tight">
                                        ${tier.price}
                                    </span>
                                    <span className="text-sm text-muted-foreground">/{tier.period}</span>
                                </div>

                                <div className="mt-6 space-y-2.5">
                                    {tier.features.map((feature, i) => (
                                        <div key={i} className="flex items-start gap-2.5">
                                            <Check size={15} className="mt-0.5 shrink-0 text-positive" />
                                            <span className="text-sm text-muted-foreground">{feature}</span>
                                        </div>
                                    ))}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => handleCta(tier)}
                                    className={`mt-8 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                                        tier.highlighted
                                            ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                            : "border border-border hover:bg-muted"
                                    }`}
                                >
                                    {tier.cta}
                                    <ArrowRight size={14} />
                                </button>
                            </div>
                        );
                    })}
                </div>

                {/* Free / Pro tool showcase */}
                <div className="mt-20">
                    <div className="text-center">
                        <h2 className="text-2xl font-semibold tracking-tight">See what Lite vs Pro actually means</h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Every tool we ship — and what you get for free vs with Pro.
                        </p>
                    </div>

                    <div className="mt-8 grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-border bg-card p-5">
                            <div className="mb-3 flex items-center justify-between">
                                <ToolBadge kind="lite" size="md" />
                                <span className="text-micro uppercase tracking-wider text-muted-foreground">{freeTools.length} tools</span>
                            </div>
                            <h3 className="text-sm font-semibold text-foreground">Lite (Free) — what works on day one</h3>
                            <ul className="mt-3 space-y-1.5">
                                {freeTools.map((tool) => (
                                    <li key={tool.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                                        <CircleDot size={11} className="mt-0.5 shrink-0 text-muted-foreground/60" />
                                        <span><span className="font-semibold text-foreground">{tool.title}</span> — {tool.liteFeatures[0]}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="rounded-lg border border-primary/30 bg-primary/5 p-5">
                            <div className="mb-3 flex items-center justify-between">
                                <ToolBadge kind="pro" size="md" />
                                <span className="text-micro uppercase tracking-wider text-muted-foreground">{proTools.length} tools</span>
                            </div>
                            <h3 className="text-sm font-semibold text-foreground">Pro — the deep workspace</h3>
                            <ul className="mt-3 space-y-1.5">
                                {proTools.map((tool) => (
                                    <li key={tool.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                                        <Lock size={10} className="mt-0.5 shrink-0 text-primary" />
                                        <span><span className="font-semibold text-foreground">{tool.title}</span> — {tool.proFeatures[0]}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    <div className="mt-4 text-center text-xs text-muted-foreground">
                        See the full library with live tier badges on{" "}
                        <Link href="/tools" className="text-primary underline-offset-2 hover:underline">
                            /tools
                        </Link>
                        .
                    </div>
                </div>

                {/* Comparison table */}
                <div className="mt-20">
                    <h2 className="text-center text-2xl font-semibold tracking-tight">Compare plans</h2>
                    <p className="mt-2 text-center text-sm text-muted-foreground">
                        Every feature, side by side.
                    </p>

                    <div className="mt-8 overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-border bg-muted/30">
                                <tr>
                                    <th className="px-5 py-4 font-medium text-muted-foreground">Feature</th>
                                    <th className="px-5 py-4 text-center font-medium text-muted-foreground">Free</th>
                                    <th className="px-5 py-4 text-center font-medium text-primary">Pro</th>
                                    <th className="px-5 py-4 text-center font-medium text-muted-foreground">Enterprise</th>
                                </tr>
                            </thead>
                            <tbody>
                                {COMPARISON_ROWS.map((row, i) => {
                                    if ("section" in row) {
                                        return (
                                            <tr key={`section-${i}`} className="border-b border-border bg-muted/40">
                                                <td colSpan={4} className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-foreground">
                                                    {row.section}
                                                </td>
                                            </tr>
                                        );
                                    }
                                    return (
                                        <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                                            <td className="px-5 py-3.5 font-medium">{row.feature}</td>
                                            <td className="px-5 py-3.5 text-center text-xs text-muted-foreground">{renderCell(row.free)}</td>
                                            <td className="px-5 py-3.5 text-center text-xs font-semibold text-primary">{renderCell(row.pro)}</td>
                                            <td className="px-5 py-3.5 text-center text-xs text-muted-foreground">{renderCell(row.ent)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* FAQ */}
                <div className="mt-20 grid gap-4 md:grid-cols-2">
                    {[
                        { q: "What's the difference between Free and Lite?", a: "On this site, 'Free' and 'Lite' are the same tier. Every free tool is the Lite path of a tool — useful, just less complete than Pro." },
                        { q: "What do I get on Free?", a: "All 10 Lite trading tools, the Free AI Scalping Terminal (live radar, qualifying signals, deterministic engine feed), 1 live performance account, basic signals and a 50-entry notebook. Free forever, no card required." },
                        { q: "What's specifically in Pro?", a: "The Pro Scalping Terminal (chart + overlays + replay + order flow + intelligence + journal), Advanced Analysis, Market Intelligence, Strategy Lab, Backtest, Walk-Forward, Monte Carlo, AI Copilot, AI Insights, Copy Trading (5 masters), Pro Signals, Alert Center, and persistence / exports on every tool." },
                        { q: "Can I downgrade later?", a: "Yes — downgrade from Pro to Free at any time. Your saved data is preserved." },
                        { q: "What payment methods do you accept?", a: "All major credit cards via Stripe. Enterprise plans support invoice billing." },
                        { q: "Do you offer refunds?", a: "Yes — within 14 days of purchase for monthly subscriptions, no questions asked." },
                    ].map((item, i) => (
                        <div key={i} className="rounded-xl border border-border bg-card p-5">
                            <h3 className="font-semibold">{item.q}</h3>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.a}</p>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}

function renderCell(value: boolean | string) {
    if (typeof value === "boolean") {
        if (value) return <span className="inline-flex justify-center text-positive"><Check size={16} /></span>;
        return <span className="text-muted-foreground/40">—</span>;
    }
    return <span>{value}</span>;
}