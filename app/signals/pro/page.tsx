"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    AlertCircle,
    ArrowLeft,
    BarChart3,
    Loader2,
    Lock,
    Radio,
    ShieldAlert,
    Sparkles,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";
import { RealtimeFeed, type CompleteActionResult, type FollowActionResult, type TradeActionResult } from "@/features/telegram-signals/components/RealtimeFeed";
import { ConflictBanner } from "@/features/telegram-signals/components/ConflictBanner";
import { AnalyticsView } from "@/features/telegram-signals/components/AnalyticsView";
import type { AISignal } from "@/lib/ai-signals/types";
import type { SignalAnalyticsSegment, SignalConflictSummary } from "@/features/telegram-signals/types";

type Notice = {
    tone: "success" | "error";
    message: string;
};

export default function ProSignalsPage() {
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [hasPro, setHasPro] = useState(false);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<"live" | "analytics">("live");
    const [conflicts, setConflicts] = useState<SignalConflictSummary[]>([]);
    const [analytics, setAnalytics] = useState<SignalAnalyticsSegment | null>(null);
    const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
    const [followLoadingIds, setFollowLoadingIds] = useState<Set<string>>(new Set());
    const [tradeLoadingIds, setTradeLoadingIds] = useState<Set<string>>(new Set());
    const [completeLoadingIds, setCompleteLoadingIds] = useState<Set<string>>(new Set());
    const [notice, setNotice] = useState<Notice | null>(null);
    const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            if (!currentUser) setLoading(false);
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!user) return;

        let cancelled = false;
        const loadWorkspace = async () => {
            try {
                const subscription = await onSubscriptionChange(user.uid);
                if (cancelled) return;
                setHasPro(subscription.hasSubscription);

                const token = await user.getIdToken();
                const headers = { Authorization: `Bearer ${token}` };

                const [conflictsResponse, analyticsResponse, followedResponse] = await Promise.all([
                    fetch("/api/pro-signals/conflicts", { headers }),
                    fetch("/api/pro-signals/analytics", { headers }),
                    fetch("/api/pro-signals/follow", { headers }),
                ]);

                const [conflictsData, analyticsData, followedData] = await Promise.all([
                    conflictsResponse.json(),
                    analyticsResponse.json(),
                    followedResponse.json(),
                ]);

                if (cancelled) return;
                if (conflictsData.conflicts) setConflicts(conflictsData.conflicts);
                if (analyticsData.analytics) setAnalytics(analyticsData.analytics);
                if (followedData.followedIds) {
                    setFollowedIds(new Set(followedData.followedIds.filter((id: string) => typeof id === "string")));
                }
            } catch (err) {
                if (!cancelled) {
                    setHasPro(false);
                    setNotice({ tone: "error", message: "Unable to load your Pro Signals workspace." });
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void loadWorkspace();
        return () => {
            cancelled = true;
        };
    }, [user]);

    useEffect(() => {
        return () => {
            if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
        };
    }, []);

    function showNotice(tone: Notice["tone"], message: string) {
        if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
        setNotice({ tone, message });
        noticeTimeoutRef.current = setTimeout(() => setNotice(null), 5000);
    }

    async function handleFollow(signalId: string): Promise<FollowActionResult> {
        const willFollow = !followedIds.has(signalId);
        setFollowLoadingIds((current) => new Set(current).add(signalId));
        setFollowedIds((current) => {
            const next = new Set(current);
            if (willFollow) next.add(signalId);
            else next.delete(signalId);
            return next;
        });

        try {
            const token = await user?.getIdToken();
            const response = await fetch("/api/pro-signals/follow", {
                method: "POST",
                headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
                body: JSON.stringify({ signalId, action: willFollow ? "follow" : "unfollow" }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || "Unable to update follow state.");
            }

            const followed = Boolean(data.followed ?? willFollow);
            setFollowedIds((current) => {
                const next = new Set(current);
                if (followed) next.add(signalId);
                else next.delete(signalId);
                return next;
            });
            showNotice("success", followed ? "Signal added to your followed list." : "Signal removed from your followed list.");
            return { signalId, followed, followCount: data.followCount };
        } catch (err) {
            setFollowedIds((current) => {
                const next = new Set(current);
                if (willFollow) next.delete(signalId);
                else next.add(signalId);
                return next;
            });
            showNotice("error", err instanceof Error ? err.message : "Unable to update follow state.");
            return { signalId, followed: !willFollow };
        } finally {
            setFollowLoadingIds((current) => {
                const next = new Set(current);
                next.delete(signalId);
                return next;
            });
        }
    }

    async function handleTrade(signal: AISignal): Promise<TradeActionResult> {
        setTradeLoadingIds((current) => new Set(current).add(signal.id));
        try {
            const token = await user?.getIdToken();
            const response = await fetch("/api/pro-signals/execute", {
                method: "POST",
                headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
                body: JSON.stringify({ signalId: signal.id, mt5Account: "default" }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || "Trade command could not be queued.");
            }

            showNotice("success", data.message || "Trade command queued for MT5.");
            return { signalId: signal.id, tradeCount: data.signal?.tradeCount };
        } catch (err) {
            showNotice("error", err instanceof Error ? err.message : "Trade command could not be queued.");
            return { signalId: signal.id };
        } finally {
            setTradeLoadingIds((current) => {
                const next = new Set(current);
                next.delete(signal.id);
                return next;
            });
        }
    }

    async function handleComplete(signal: AISignal): Promise<CompleteActionResult> {
        if (!confirm(`Close this Pro signal on ${signal.symbol} (${signal.direction})?`)) {
            return { signalId: signal.id, status: signal.status };
        }

        setCompleteLoadingIds((current) => new Set(current).add(signal.id));
        try {
            const token = await user?.getIdToken();
            const response = await fetch(`/api/pro-signals/${encodeURIComponent(signal.id)}`, {
                method: "PATCH",
                headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
                body: JSON.stringify({ action: "close" }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || "Signal could not be closed.");
            }

            showNotice("success", "Pro signal closed.");
            return { signalId: signal.id, status: "COMPLETED" };
        } catch (err) {
            showNotice("error", err instanceof Error ? err.message : "Signal could not be closed.");
            return { signalId: signal.id, status: signal.status };
        } finally {
            setCompleteLoadingIds((current) => {
                const next = new Set(current);
                next.delete(signal.id);
                return next;
            });
        }
    }

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
                <div className="flex items-center gap-3">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="text-sm font-medium text-muted-foreground">Verifying Pro entitlement...</span>
                </div>
            </div>
        );
    }

    if (!user || !hasPro) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
                <div className="w-full max-w-md rounded-card border border-warning/20 bg-card p-8 text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-button border border-warning/20 bg-warning/10">
                        <Lock className="h-6 w-6 text-warning" />
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground">AlgoVault Pro Signals</h1>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Live institutional signals, SL/TP tracking, conflict detection, and MT5 execution require an active Pro subscription.
                    </p>
                    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                        <Link
                            href="/pricing"
                            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-button bg-warning px-4 py-2.5 text-sm font-semibold text-warning-foreground transition-colors hover:bg-warning/90"
                        >
                            <Zap className="h-4 w-4 fill-current" />
                            Upgrade to Pro
                        </Link>
                        <Link
                            href="/signals"
                            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-button border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
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
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
                <Link
                    href="/signals"
                    className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                    <ArrowLeft size={16} />
                    Signals overview
                </Link>

                <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between" data-guide="page-header">
                    <div className="max-w-2xl">
                        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                            <Sparkles size={16} />
                            Institutional signal intelligence
                        </div>
                        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">AlgoVault Pro Signals</h1>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Monitor live setups, review exact levels, follow the signals that matter, and send approved orders to MT5.
                        </p>
                    </div>

                    <div className="flex w-full max-w-sm items-center gap-1 rounded-button border border-border bg-card p-1" role="tablist" aria-label="Pro Signals sections">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === "live"}
                            onClick={() => setActiveTab("live")}
                            className={cnTab(activeTab === "live")}
                        >
                            <Radio size={15} />
                            Live Feed
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === "analytics"}
                            onClick={() => setActiveTab("analytics")}
                            className={cnTab(activeTab === "analytics")}
                        >
                            <BarChart3 size={15} />
                            Analytics
                        </button>
                    </div>
                </div>

                {notice && (
                    <div
                        role="status"
                        aria-live="polite"
                        className={cnNotice(notice.tone)}
                    >
                        {notice.tone === "error" ? <AlertCircle size={16} /> : <ShieldAlert size={16} />}
                        <span className="flex-1">{notice.message}</span>
                    </div>
                )}

                <div className="mt-6">
                    <ConflictBanner conflicts={conflicts} />
                </div>

                {activeTab === "live" ? (
                    <RealtimeFeed
                        uid={user.uid}
                        onTrade={handleTrade}
                        onComplete={handleComplete}
                        onView={(signal) => router.push(`/signals/pro/${signal.id}`)}
                        onFollow={handleFollow}
                        followedIds={followedIds}
                        followLoadingIds={followLoadingIds}
                        tradeLoadingIds={tradeLoadingIds}
                        completeLoadingIds={completeLoadingIds}
                    />
                ) : analytics ? (
                    <AnalyticsView analytics={analytics} />
                ) : (
                    <div className="flex min-h-72 flex-col items-center justify-center rounded-card border border-border bg-card p-8 text-center">
                        <Loader2 className="h-7 w-7 animate-spin text-primary" />
                        <p className="mt-3 text-sm font-medium text-foreground">Loading analytics...</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function cnTab(active: boolean) {
    return `flex flex-1 min-h-9 items-center justify-center gap-2 rounded-button px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
    }`;
}

function cnNotice(tone: Notice["tone"]) {
    return `mt-6 flex items-center gap-2 rounded-button border p-3 text-sm ${
        tone === "success"
            ? "border-positive/20 bg-positive/10 text-positive"
            : "border-negative/20 bg-negative/10 text-negative"
    }`;
}
