"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Activity,
    ArrowLeft,
    BarChart3,
    CheckCircle2,
    Clock,
    Lock,
    Radio,
    ShieldAlert,
    Sparkles,
    UserPlus,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";

import { RealtimeFeed } from "@/features/telegram-signals/components/RealtimeFeed";
import { ConflictBanner } from "@/features/telegram-signals/components/ConflictBanner";
import { AnalyticsView } from "@/features/telegram-signals/components/AnalyticsView";
import type { SignalAnalyticsSegment, SignalConflictSummary } from "@/features/telegram-signals/types";
import type { AISignal } from "@/lib/ai-signals/types";

export default function ProSignalsPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [hasPro, setHasPro] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(true);
    const [activeTab, setActiveTab] = useState<"live" | "analytics">("live");
    const [conflicts, setConflicts] = useState<SignalConflictSummary[]>([]);
    const [analytics, setAnalytics] = useState<SignalAnalyticsSegment | null>(null);
    const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());

    async function handleTrade(signal: AISignal) {
        try {
            const token = await user?.getIdToken();
            const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };
            const res = await fetch("/api/signals/execute", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    signalId: signal.id,
                    symbol: signal.symbol,
                    direction: signal.direction,
                    entryPrice: signal.entry,
                    stopLoss: signal.stopLoss,
                    takeProfit: signal.tp1,
                    mt5Account: "default",
                }),
            });
            const data = await res.json();
            if (!data.success) {
                console.error("Trade execution failed:", data.error);
            }
        } catch (err) {
            console.error("Trade execution error:", err);
        }
    }

    async function handleComplete(signal: AISignal) {
        if (!confirm(`Complete this signal on ${signal.symbol} (${signal.direction})?`)) return;
        try {
            const token = await user?.getIdToken();
            const headers = { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };
            const res = await fetch("/api/signals/complete", {
                method: "POST",
                headers,
                body: JSON.stringify({ signalId: signal.id }),
            });
            const data = await res.json();
            if (data.success) {
                // Firebase realtime listener will auto-update; no reload needed
            } else {
                console.error("Complete failed:", data.error);
            }
        } catch (err) {
            console.error("Complete error:", err);
        }
    }

    function handleFollow(signalId: string) {
        setFollowedIds((prev) => {
            const next = new Set(prev);
            if (next.has(signalId)) {
                next.delete(signalId);
            } else {
                next.add(signalId);
            }
            return next;
        });
    }

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (!u) {
                setLoading(false);
            }
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user) return;

        const checkAccess = async () => {
            try {
                const sub = await onSubscriptionChange(user.uid);
                setHasPro(sub.hasSubscription);

                if (sub.hasSubscription) {
                    const token = await user.getIdToken();
                    const headers = { Authorization: `Bearer ${token}` };

                    // Fetch conflicts & analytics asynchronously
                    fetch("/api/pro-signals/conflicts", { headers })
                        .then((res) => res.json())
                        .then((data) => {
                            if (data.conflicts) setConflicts(data.conflicts);
                        })
                        .catch(console.error);

                    fetch("/api/pro-signals/analytics", { headers })
                        .then((res) => res.json())
                        .then((data) => {
                            if (data.analytics) setAnalytics(data.analytics);
                        })
                        .catch(console.error);
                }
            } catch (err) {
                console.error("Pro subscription check error:", err);
                setHasPro(false);
            } finally {
                setLoading(false);
            }
        };

        checkAccess();
    }, [user]);

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
                <div className="flex items-center gap-3">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                    <span className="text-sm font-medium text-muted-foreground">Verifying Pro Entitlement...</span>
                </div>
            </div>
        );
    }

    if (!user || !hasPro) {
        return (
            <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
                <div className="max-w-md w-full rounded-2xl border border-amber-500/20 bg-card p-8 text-center backdrop-blur-xl shadow-2xl">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20">
                        <Lock className="h-7 w-7 text-amber-400" />
                    </div>
                    <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                        AlgoVault Pro Signals
                    </h1>
                    <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                        Access real-time institutional signals, instant SL/TP tracking, conflict detection, and MT5 execution. Requires an active Pro subscription.
                    </p>
                    <div className="mt-6 flex flex-col gap-3">
                        <Link
                            href="/pricing"
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-xs font-bold text-foreground transition-colors hover:bg-amber-400 shadow-lg shadow-amber-500/20"
                        >
                            <Zap className="h-4 w-4 fill-black" />
                            Upgrade to Pro
                        </Link>
                        <Link
                            href="/signals"
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back to AI Signals
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            {/* Ambient Lighting */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>

            <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
                    <div>
                        <Link
                            href="/signals"
                            className="mb-3 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Back to Signals Overview
                        </Link>
                        <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                            <Sparkles className="h-4 w-4" />
                            <span>Institutional Signal Intelligence</span>
                        </div>
                        <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">
                            AlgoVault Pro Signals
                        </h1>
                    </div>

                    <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-card p-1">
                        <button
                            type="button"
                            onClick={() => setActiveTab("live")}
                            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                                activeTab === "live"
                                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Radio className="h-3.5 w-3.5" />
                            Live Feed
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("analytics")}
                            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                                activeTab === "analytics"
                                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <BarChart3 className="h-3.5 w-3.5" />
                            Analytics
                        </button>
                    </div>
                </div>

                {/* Signal Conflict Warning Banner */}
                <ConflictBanner conflicts={conflicts} />

                {/* Active Tab View */}
                {activeTab === "live" ? (
                    <RealtimeFeed
                        uid={user.uid}
                        onTrade={handleTrade}
                        onComplete={handleComplete}
                        onView={(signal) => router.push(`/signals/pro?id=${signal.id}`)}
                        onFollow={handleFollow}
                        followedIds={followedIds}
                    />
                ) : (
                    analytics && <AnalyticsView analytics={analytics} />
                )}
            </div>
        </div>
    );
}
