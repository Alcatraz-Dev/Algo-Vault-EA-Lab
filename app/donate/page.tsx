"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Bot,
    CheckCircle2,
    ChevronRight,
    Crown,
    Gift,
    Heart,
    Loader2,
    MessageSquare,
    Sparkles,
    Star,
    TrendingUp,
    User,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { ref as dbRef, onValue } from "firebase/database";
import { auth, database } from "@/lib/firebase";

const TIERS = [
    {
        id: "supporter",
        label: "Supporter",
        emoji: "☕",
        amount: 500,
        display: "$5",
        color: "from-blue-500/20 to-blue-600/5",
        border: "border-blue-500/30",
        accent: "text-blue-400",
        badgeBg: "bg-blue-500/10 border-blue-500/20 text-blue-300",
        rewards: ["1 Free Premium Indicator (any)"],
        icon: Star,

    },
    {
        id: "contributor",
        label: "Contributor",
        emoji: "🚀",
        amount: 1000,
        display: "$10",
        color: "from-violet-500/20 to-violet-600/5",
        border: "border-violet-500/30",
        accent: "text-violet-400",
        badgeBg: "bg-violet-500/10 border-violet-500/20 text-violet-300",
        rewards: ["1 Free Premium Indicator", "1 Free Scalper EA"],
        icon: Zap,
        popular: true,
    },
    {
        id: "champion",
        label: "Champion",
        emoji: "👑",
        amount: 2500,
        display: "$25",
        color: "from-amber-500/20 to-amber-600/5",
        border: "border-amber-500/30",
        accent: "text-amber-400",
        badgeBg: "bg-amber-500/10 border-amber-500/20 text-amber-300",
        rewards: ["All Free Indicators", "All Free EAs Bundle", "Priority Discord Support"],
        icon: Crown,
    },
];

const FREE_RESOURCES = [
    {
        icon: TrendingUp,
        name: "Gold Trend Indicator",
        type: "Indicator",
        description: "Advanced XAUUSD trend detection with dynamic levels",
        color: "text-amber-400",
        bg: "bg-amber-500/10",
        border: "border-amber-500/20",
    },
    {
        icon: Zap,
        name: "Scalper EA Lite",
        type: "Expert Advisor",
        description: "Entry-level scalping EA with built-in risk management",
        color: "text-violet-400",
        bg: "bg-violet-500/10",
        border: "border-violet-500/20",
    },
    {
        icon: Bot,
        name: "Session Filter EA",
        type: "Expert Advisor",
        description: "Automatically pause trading during low-liquidity sessions",
        color: "text-blue-400",
        bg: "bg-blue-500/10",
        border: "border-blue-500/20",
    },
];

export default function DonatePage() {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [siteName, setSiteName] = useState("AlgoVault");

    const [selectedTier, setSelectedTier] = useState<typeof TIERS[0] | null>(TIERS[1]);
    const [customAmount, setCustomAmount] = useState("");
    const [useCustom, setUseCustom] = useState(false);
    const [donorName, setDonorName] = useState("");
    const [donorMessage, setDonorMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthLoading(false);
            if (u?.displayName) setDonorName(u.displayName);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        return onValue(dbRef(database, "settings/siteName"), (snap) => {
            if (snap.exists()) setSiteName(snap.val());
        });
    }, []);

    const effectiveAmount = useCustom
        ? Math.round(Number(customAmount || "0") * 100)
        : selectedTier?.amount || 0;

    const effectiveTier = useCustom
        ? TIERS.find((t) => effectiveAmount >= t.amount) || null
        : selectedTier;

    async function handleDonate() {
        setError(null);

        if (!effectiveAmount || effectiveAmount < 100) {
            setError("Minimum donation is $1.00.");
            return;
        }

        setLoading(true);

        try {
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            };

            if (user) {
                const idToken = await user.getIdToken();
                headers["Authorization"] = `Bearer ${idToken}`;
            }

            const res = await fetch("/api/donate/create", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    amount: effectiveAmount,
                    currency: "usd",
                    donorName: donorName || undefined,
                    donorMessage: donorMessage || undefined,
                }),
            });

            const data = await res.json();

            if (data.checkoutUrl) {
                window.location.href = data.checkoutUrl;
            } else {
                setError(data.error || "Failed to create checkout session.");
            }
        } catch (err: any) {
            setError(err?.message || "Something went wrong.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="min-h-screen bg-background text-foreground overflow-x-hidden">
            {/* Background */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute left-1/2 top-[-300px] h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-pink-600/[0.07] blur-[140px]" />
                <div className="absolute bottom-[-200px] right-[-150px] h-[500px] w-[500px] rounded-full bg-violet-600/[0.07] blur-[140px]" />
                <div className="absolute bottom-[-100px] left-[-150px] h-[400px] w-[400px] rounded-full bg-amber-600/[0.05] blur-[130px]" />
            </div>

            <div className="relative mx-auto max-w-5xl px-5 py-10">
                {/* Back */}
                <Link
                    href="/"
                    className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                >
                    <ArrowLeft size={16} />
                    Back to Home
                </Link>

                {/* Hero */}
                <div className="text-center mb-14" data-guide="page-header">
                    <div className="inline-flex items-center gap-2 rounded-full border border-pink-500/20 bg-pink-500/10 px-4 py-1.5 text-xs font-medium text-pink-300 mb-5">
                        <Heart size={13} className="fill-pink-400 text-pink-400" />
                        Support {siteName}
                    </div>

                    <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
                        Fuel the Algo.
                        <span className="block mt-1 bg-gradient-to-r from-pink-400 via-violet-400 to-amber-400 bg-clip-text text-transparent">
                            Get Free Tools.
                        </span>
                    </h1>

                    <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto leading-7">
                        Every donation goes directly into building better EAs, indicators, and tools for the community.
                        As a thank you, you unlock premium free resources instantly.
                    </p>
                </div>

                {/* Free Resources Preview */}
                <div className="mb-12">
                    <div className="flex items-center gap-2 mb-5">
                        <Gift size={16} className="text-pink-400" />
                        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            What you unlock
                        </h2>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                        {FREE_RESOURCES.map((resource, idx) => (
                            <div
                                key={idx}
                                className={`rounded-2xl border ${resource.border} bg-muted p-4 backdrop-blur-sm`}
                            >
                                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${resource.bg}`}>
                                    <resource.icon size={18} className={resource.color} />
                                </div>
                                <div className="mt-3">
                                    <span className={`text-[11px] font-semibold uppercase tracking-wider ${resource.color}`}>
                                        {resource.type}
                                    </span>
                                    <h3 className="mt-0.5 text-sm font-bold text-foreground">
                                        {resource.name}
                                    </h3>
                                    <p className="mt-1 text-xs text-muted-foreground leading-5">
                                        {resource.description}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Tiers + Form */}
                <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
                    {/* Tiers */}
                    <div className="space-y-4">
                        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                            Choose your tier
                        </h2>

                        {TIERS.map((tier) => {
                            const TierIcon = tier.icon;
                            const isSelected = !useCustom && selectedTier?.id === tier.id;

                            return (
                                <button
                                    key={tier.id}
                                    type="button"
                                    onClick={() => {
                                        setSelectedTier(tier);
                                        setUseCustom(false);
                                        setError(null);
                                    }}
                                    className={`w-full rounded-2xl border p-5 text-left transition-all ${isSelected
                                            ? `${tier.border} bg-gradient-to-br ${tier.color}`
                                            : "border-border/30 bg-muted hover:border-border/50 hover:bg-muted/20"
                                        }`}
                                >
                                    <div className="flex items-start gap-4">
                                        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg ${isSelected ? tier.color : "bg-muted/5"
                                            }`}>
                                            {tier.emoji}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-bold text-foreground text-sm">
                                                    {tier.label}
                                                </span>
                                                {tier.popular && (
                                                    <span className="rounded-full bg-violet-500/20 border border-violet-500/30 px-2 py-0.5 text-[11px] font-semibold text-violet-300">
                                                        ⚡ Most Popular
                                                    </span>
                                                )}
                                                <span className={`ml-auto text-lg font-black ${isSelected ? tier.accent : "text-muted-foreground"}`}>
                                                    {tier.display}
                                                </span>
                                            </div>

                                            <ul className="mt-2.5 space-y-1">
                                                {tier.rewards.map((reward, i) => (
                                                    <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <CheckCircle2 size={12} className={isSelected ? tier.accent : "text-muted-foreground"} />
                                                        {reward}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}

                        {/* Custom Amount */}
                        <div
                            className={`rounded-2xl border p-5 transition-all ${useCustom
                                    ? "border-emerald-500/30 bg-emerald-500/[0.08]"
                                    : "border-border/30 bg-muted"
                                }`}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    setUseCustom(true);
                                    setSelectedTier(null);
                                    setError(null);
                                }}
                                className="w-full text-left"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold text-foreground">Custom Amount</span>
                                    {useCustom && effectiveTier && (
                                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${effectiveTier.badgeBg}`}>
                                            {effectiveTier.label} Tier Rewards
                                        </span>
                                    )}
                                </div>
                            </button>

                            {useCustom && (
                                <div className="mt-3 relative">
                                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        placeholder="0.00"
                                        value={customAmount}
                                        onChange={(e) => setCustomAmount(e.target.value)}
                                        className="w-full rounded-xl border border-border/30 bg-background/950 pl-8 pr-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:border-emerald-500 focus:outline-none"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Checkout Panel */}
                    <div className="rounded-2xl border border-border/30 bg-muted p-6 backdrop-blur-xl h-fit sticky top-8">
                        <div className="flex items-center gap-2 mb-5 border-b border-border/30 pb-5">
                            <Sparkles size={16} className="text-pink-400" />
                            <h3 className="font-bold text-foreground">Your Donation</h3>
                        </div>

                        {/* Summary */}
                        <div className="space-y-3 text-sm mb-5">
                            <div className="flex justify-between text-muted-foreground">
                                <span>Tier</span>
                                <span className="font-semibold text-foreground">
                                    {useCustom && effectiveTier
                                        ? effectiveTier.label
                                        : selectedTier?.label || "—"}
                                </span>
                            </div>
                            <div className="flex justify-between text-muted-foreground">
                                <span>Amount</span>
                                <span className="font-bold text-xl text-foreground">
                                    {effectiveAmount >= 100
                                        ? `$${(effectiveAmount / 100).toFixed(2)}`
                                        : "—"}
                                </span>
                            </div>
                        </div>

                        {/* Rewards unlocked */}
                        {effectiveTier && (
                            <div className="mb-5 rounded-xl border border-border/30 bg-background/70 p-4">
                                <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                                    🎁 Rewards Unlocked
                                </p>
                                <ul className="space-y-1.5">
                                    {effectiveTier.rewards.map((r, i) => (
                                        <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                                            {r}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Donor Name */}
                        <div className="space-y-3 mb-5">
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                    <span className="flex items-center gap-1.5">
                                        <User size={12} />
                                        Your name (optional)
                                    </span>
                                </label>
                                <input
                                    type="text"
                                    placeholder="Anonymous"
                                    value={donorName}
                                    onChange={(e) => setDonorName(e.target.value)}
                                    className="w-full rounded-xl border border-border/30 bg-background/950 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-pink-500 focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                    <span className="flex items-center gap-1.5">
                                        <MessageSquare size={12} />
                                        Message (optional)
                                    </span>
                                </label>
                                <textarea
                                    placeholder="Say something kind..."
                                    value={donorMessage}
                                    onChange={(e) => setDonorMessage(e.target.value)}
                                    rows={2}
                                    className="w-full resize-none rounded-xl border border-border/30 bg-background/950 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-pink-500 focus:outline-none"
                                />
                            </div>
                        </div>

                        {!user && !authLoading && (
                            <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.08] p-3 text-xs text-amber-300 leading-5">
                                <strong>Tip:</strong> Sign in to automatically receive your free rewards after donation.
                                <Link href="/login" className="ml-1.5 underline hover:text-amber-200">
                                    Sign in →
                                </Link>
                            </div>
                        )}

                        {error && (
                            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/[0.08] p-3 text-xs text-red-300">
                                {error}
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={handleDonate}
                            disabled={loading || (!effectiveAmount || effectiveAmount < 100)}
                            className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-violet-600 px-5 py-3 text-sm font-bold text-foreground shadow-lg shadow-pink-500/20 transition hover:from-pink-400 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Redirecting to Stripe...
                                </>
                            ) : (
                                <>
                                    <Heart size={16} className="fill-white" />
                                    Donate {effectiveAmount >= 100 ? `$${(effectiveAmount / 100).toFixed(2)}` : ""}
                                </>
                            )}
                        </button>

                        <p className="mt-3 text-center text-[11px] text-muted-foreground">
                            Secured by Stripe · SSL encrypted
                        </p>
                    </div>
                </div>
            </div>
        </main>
    );
}
