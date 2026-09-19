"use client";

import { useEffect, useState } from "react";
import {
    Check,
    Copy,
    Gift,
    Globe,
    Loader2,
    MousePointerClick,
    Share2,
    TrendingUp,
    UserPlus,
    Users,
    DollarSign,
    ShoppingBag,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { ref as dbRef, onValue } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";

type ReferralEvent = {
    id?: string;
    type?: string;
    page?: string;
    createdAt?: number;
};

type PurchaseEvent = {
    id?: string;
    type?: "purchase";
    productName?: string;
    commissionCents?: number;
    createdAt?: number;
};

type ReferralSummary = {
    code: string;
    clicks: number;
    signups: number;
    referredBy: string;
    recentEvents: ReferralEvent[];
    totalEarningsUsd: number;
    completedEarningsUsd: number;
    recentPurchases: PurchaseEvent[];
};

export default function AffiliatePage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [summary, setSummary] = useState<ReferralSummary | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const [siteName, setSiteName] = useState("AlgoVault");
    const [commissionRate, setCommissionRate] = useState(15);

    useEffect(() => {
        // Subscribe to siteName from admin settings
        const unsub = onValue(dbRef(database, "settings/siteName"), (snap) => {
            if (snap.exists()) setSiteName(snap.val());
        });
        // Subscribe to commission rate
        const unsubRate = onValue(dbRef(database, "settings/commissionRate"), (snap) => {
            if (snap.exists()) setCommissionRate(Number(snap.val()));
        });
        return () => { unsub(); unsubRate(); };
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthLoading(false);
            if (!u) return;

            (async () => {
                try {
                    const token = await u.getIdToken();
                    const res = await fetch("/api/referrals", {
                        headers: { Authorization: `Bearer ${token}` },
                        cache: "no-store",
                    });
                    if (!res.ok) throw new Error((await res.json())?.error ?? "Failed to load.");
                    const data = await res.json();
                    setSummary({
                        code: data.code,
                        clicks: data.clicks ?? 0,
                        signups: data.signups ?? 0,
                        referredBy: data.referredBy ?? "",
                        recentEvents: Array.isArray(data.recentEvents) ? data.recentEvents : [],
                        totalEarningsUsd: data.totalEarningsUsd ?? 0,
                        completedEarningsUsd: data.completedEarningsUsd ?? 0,
                        recentPurchases: Array.isArray(data.recentPurchases) ? data.recentPurchases : [],
                    });
                } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to load referral summary.");
                } finally {
                    setLoading(false);
                }
            })();
        });
        return () => unsubscribe();
    }, []);

    const baseUrl =
        typeof window !== "undefined" ? window.location.origin : "";
    const shareLink = summary ? `${baseUrl}/r/${summary.code}` : "";
    const telegramShare = summary
        ? `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent(`Join me on ${siteName} and get verified trading EAs.`)}`
        : "";

    const copyText = async (key: string, text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(key);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            /* clipboard unavailable */
        }
    };

    const timeAgo = (ms?: number) => {
        if (!ms) return "—";
        return new Date(ms).toLocaleString();
    };

    if (authLoading) {
        return (
            <AccountShell title="Affiliates" subtitle="Refer traders and earn">
                <div className="flex min-h-[50vh] items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </AccountShell>
        );
    }

    if (!user) {
        return (
            <AccountShell title="Affiliates" subtitle="Refer traders and earn">
                <div className="rounded-2xl border border-border bg-card p-12 text-center">
                    <p className="text-sm text-muted-foreground">Please sign in to view your referral program.</p>
                </div>
            </AccountShell>
        );
    }

    return (
        <AccountShell title="Affiliates" subtitle="Refer traders, grow the community, and earn">
            {/* Background blurs */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute left-1/2 top-[-300px] h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-violet-600/10 blur-[130px]" />
                <div className="absolute bottom-[-200px] right-[-100px] h-[450px] w-[450px] rounded-full bg-blue-600/10 blur-[130px]" />
            </div>

            <div className="relative mx-auto max-w-5xl" data-guide="page-header">
                {error && (
                    <div className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.05] p-4 text-sm text-rose-300 mb-6">
                        {error}
                    </div>
                )}

                {loading && !summary ? (
                    <div className="rounded-2xl border border-border bg-card p-16 text-center">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">Loading your referral link...</p>
                    </div>
                ) : summary ? (
                    <div className="space-y-6">
                        {/* Stats */}
                        <div className="grid gap-4 sm:grid-cols-4">
                            <div className="rounded-2xl border border-border bg-card p-5">
                                <p className="text-xs text-muted-foreground">Link Clicks</p>
                                <p className="mt-2 text-3xl font-bold text-foreground">{summary.clicks}</p>
                                <p className="mt-1 text-xs text-muted-foreground">People who opened your link</p>
                            </div>
                            <div className="rounded-2xl border border-border bg-card p-5">
                                <p className="text-xs text-muted-foreground">New Signups</p>
                                <p className="mt-2 text-3xl font-bold text-foreground">{summary.signups}</p>
                                <p className="mt-1 text-xs text-muted-foreground">Accounts created through you</p>
                            </div>
                            <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-5">
                                <p className="text-xs text-muted-foreground">Commission</p>
                                <p className="mt-2 text-3xl font-bold text-violet-400">{commissionRate}%</p>
                                <p className="mt-1 text-xs text-muted-foreground">On every referred purchase</p>
                            </div>
                            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-5">
                                <p className="text-xs text-muted-foreground">Total Earnings</p>
                                <p className="mt-2 text-3xl font-bold text-emerald-400">${summary.totalEarningsUsd.toFixed(2)}</p>
                                <p className="mt-1 text-xs text-muted-foreground">${summary.completedEarningsUsd.toFixed(2)} confirmed</p>
                            </div>
                        </div>

                        {/* Referral code + link */}
                        <div className="rounded-2xl border border-border bg-card p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="font-bold text-foreground">Your Referral Link</h2>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Share this link — anyone who signs up is credited to you.
                                    </p>
                                </div>
                                <Gift className="h-6 w-6 text-violet-400" />
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                <div className="rounded-xl border border-border bg-muted p-4">
                                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Code</p>
                                    <div className="mt-2 flex items-center justify-between gap-3">
                                        <span className="font-mono text-lg font-bold text-foreground">{summary.code}</span>
                                        <button
                                            type="button"
                                            onClick={() => copyText("code", summary.code)}
                                            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                                        >
                                            {copied === "code" ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                                            {copied === "code" ? "Copied" : "Copy"}
                                        </button>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-border bg-muted p-4">
                                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Share Link</p>
                                    <div className="mt-2 flex items-center justify-between gap-3">
                                        <span className="truncate text-sm font-mono text-foreground">{shareLink}</span>
                                        <button
                                            type="button"
                                            onClick={() => copyText("link", shareLink)}
                                            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                                        >
                                            {copied === "link" ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                                            {copied === "link" ? "Copied" : "Copy"}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 flex flex-wrap items-center gap-3">
                                <a
                                    href={shareLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-violet-500"
                                >
                                    <Globe size={14} /> Preview Link
                                </a>
                                <a
                                    href={telegramShare}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted/70"
                                >
                                    <Share2 size={14} /> Share on Telegram
                                </a>
                            </div>
                        </div>

                        {/* Recent events */}
                        <div className="rounded-2xl border border-border bg-card p-6">
                            <h3 className="font-bold text-foreground">Recent Activity</h3>
                            {summary.recentEvents.length === 0 && summary.recentPurchases.length === 0 ? (
                                <p className="mt-3 text-sm text-muted-foreground">
                                    No activity yet. Share your link to start earning.
                                </p>
                            ) : (
                                <ul className="mt-4 space-y-3">
                                    {[
                                        ...summary.recentPurchases.map(p => ({
                                            key: p.id || `purchase-${p.createdAt}`,
                                            icon: <DollarSign size={14} className="text-emerald-500" />,
                                            text: `Purchase: ${p.productName} — $${((p.commissionCents || 0) / 100).toFixed(2)} earned`,
                                            createdAt: p.createdAt,
                                        })),
                                        ...summary.recentEvents.map(e => ({
                                            key: e.id || `${e.type}-${e.createdAt}`,
                                            icon: e.type === "signup"
                                                ? <UserPlus size={14} className="text-emerald-500" />
                                                : <MousePointerClick size={14} className="text-violet-400" />,
                                            text: e.type === "signup" ? "New signup via your link" : "Someone clicked your link",
                                            createdAt: e.createdAt,
                                        })),
                                    ]
                                        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
                                        .slice(0, 15)
                                        .map((item) => (
                                            <li key={item.key} className="flex items-center gap-3">
                                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                                                    {item.icon}
                                                </span>
                                                <div className="flex-1">
                                                    <p className="text-sm text-foreground">{item.text}</p>
                                                </div>
                                                <span className="text-xs text-muted-foreground">{timeAgo(item.createdAt)}</span>
                                            </li>
                                        ))
                                    }
                                </ul>
                            )}
                        </div>

                        {/* How it works */}
                        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-6">
                            <h3 className="font-bold text-foreground flex items-center gap-2">
                                <TrendingUp size={16} className="text-violet-400" /> How it works
                            </h3>
                            <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                                <li>1. Copy your referral link above.</li>
                                <li>2. Share it in your trading communities, Telegram groups, or with friends.</li>
                                <li>3. When someone signs up, every purchase they make earns you <span className="font-semibold text-violet-400">{commissionRate}% commission</span>.</li>
                            </ol>
                            {summary.referredBy && (
                                <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-xs text-muted-foreground">
                                    You were referred by code <span className="font-mono text-foreground">{summary.referredBy}</span>.
                                </p>
                            )}
                        </div>
                    </div>
                ) : null}

                {/* Signed out fallback note */}
                {!loading && !error && !summary && (
                    <div className="rounded-2xl border border-border bg-card p-12 text-center">
                        <Users className="mx-auto h-10 w-10 text-muted-foreground" />
                        <p className="mt-3 text-sm text-muted-foreground">No referral data available.</p>
                    </div>
                )}
            </div>
        </AccountShell>
    );
}