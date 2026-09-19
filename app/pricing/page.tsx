"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    ArrowRight,
    Check,
    Crown,
    Sparkles,
    Star,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";

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
        name: "Free",
        emoji: "🎯",
        price: 0,
        period: "forever",
        description: "Perfect for exploring the platform and testing strategies.",
        features: [
            "Marketplace browsing",
            "Basic backtest reports",
            "Live performance (1 account)",
            "Community signals",
            "Notebook (50 entries)",
            "Basic risk calculator",
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
        description: "For serious traders who need advanced analytics and automation.",
        features: [
            "Everything in Free",
            "Unlimited backtest reports",
            "Advanced Analysis & Order Flow",
            "Pine Script Workspace",
            "AI Signals Engine (pro)",
            "Copy Trading (5 masters)",
            "Unlimited notebook entries",
            "Profit Split Calculator",
            "Swap Calculator",
            "Spread Analyzer",
            "Priority support",
            "Custom alerts",
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
        description: "For teams and institutions managing multiple accounts.",
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
                        Simple, transparent pricing
                    </div>
                    <h1 className="mt-6 text-4xl font-semibold tracking-tight md:text-5xl">
                        Trading tools for every level
                    </h1>
                    <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
                        Start free. Upgrade when you need advanced analytics,
                        automation, and real-time intelligence.
                    </p>
                </div>

                {/* Tiers */}
                <div className="mt-14 grid gap-6 md:grid-cols-3">
                    {TIERS.map((tier) => {
                        const Icon = tier.icon;
                        return (
                            <div
                                key={tier.id}
                                className={`relative flex flex-col rounded-2xl border p-6 transition hover:shadow-lg ${
                                    tier.highlighted
                                        ? "border-foreground bg-card shadow-xl"
                                        : "border-border bg-card"
                                }`}
                            >
                                {tier.highlighted && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                        <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold text-background">
                                            <Zap size={11} />
                                            Most Popular
                                        </span>
                                    </div>
                                )}

                                <div className="flex items-center gap-3">
                                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tier.highlighted ? "bg-foreground text-background" : "bg-muted"}`}>
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

                                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                    {tier.description}
                                </p>

                                <div className="mt-6 space-y-2.5">
                                    {tier.features.map((feature, i) => (
                                        <div key={i} className="flex items-start gap-2.5">
                                            <Check size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                                            <span className="text-sm text-muted-foreground">{feature}</span>
                                        </div>
                                    ))}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => handleCta(tier)}
                                    className={`mt-8 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                                        tier.highlighted
                                            ? "bg-foreground text-background hover:opacity-90"
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

                {/* Feature comparison */}
                <div className="mt-20">
                    <h2 className="text-center text-2xl font-semibold tracking-tight">Compare plans</h2>
                    <p className="mt-2 text-center text-sm text-muted-foreground">
                        Every feature, side by side.
                    </p>

                    <div className="mt-8 overflow-x-auto rounded-2xl border border-border">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-border bg-muted/30">
                                <tr>
                                    <th className="px-5 py-4 font-medium text-muted-foreground">Feature</th>
                                    <th className="px-5 py-4 text-center font-medium text-muted-foreground">Free</th>
                                    <th className="px-5 py-4 text-center font-medium text-muted-foreground">Pro</th>
                                    <th className="px-5 py-4 text-center font-medium text-muted-foreground">Enterprise</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {[
                                    { feature: "Marketplace browsing", free: true, pro: true, ent: true },
                                    { feature: "Backtest reports", free: "Basic", pro: "Unlimited", ent: "Unlimited" },
                                    { feature: "Live performance", free: "1 account", pro: "Unlimited", ent: "Unlimited" },
                                    { feature: "Advanced Analysis", free: false, pro: true, ent: true },
                                    { feature: "Order Flow", free: false, pro: true, ent: true },
                                    { feature: "Pine Script Workspace", free: false, pro: true, ent: true },
                                    { feature: "AI Signals (pro)", free: "Basic", pro: true, ent: true },
                                    { feature: "Copy Trading", free: false, pro: "5 masters", ent: "Unlimited" },
                                    { feature: "Profit Split Calculator", free: false, pro: true, ent: true },
                                    { feature: "Swap Calculator", free: false, pro: true, ent: true },
                                    { feature: "Spread Analyzer", free: false, pro: true, ent: true },
                                    { feature: "API access", free: false, pro: false, ent: true },
                                    { feature: "Priority support", free: false, pro: true, ent: true },
                                ].map((row, i) => (
                                    <tr key={i} className="hover:bg-muted/20">
                                        <td className="px-5 py-3.5 font-medium">{row.feature}</td>
                                        <td className="px-5 py-3.5 text-center">{renderCell(row.free)}</td>
                                        <td className="px-5 py-3.5 text-center font-medium text-foreground">{renderCell(row.pro)}</td>
                                        <td className="px-5 py-3.5 text-center">{renderCell(row.ent)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* FAQ */}
                <div className="mt-20 grid gap-4 md:grid-cols-2">
                    {[
                        { q: "Can I downgrade later?", a: "Yes, you can downgrade from Pro to Free at any time from your account settings." },
                        { q: "What payment methods do you accept?", a: "We accept all major credit cards via Stripe. Enterprise plans support invoice billing." },
                        { q: "Is there a free trial?", a: "The Free plan is always free. Pro features are available with a subscription." },
                        { q: "Do I get a refund?", a: "We offer refunds within 14 days of purchase for monthly subscriptions." },
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
        if (value) return <span className="text-emerald-500"><Check size={16} /></span>;
        return <span className="text-muted-foreground">—</span>;
    }
    return <span className="text-sm">{value}</span>;
}
