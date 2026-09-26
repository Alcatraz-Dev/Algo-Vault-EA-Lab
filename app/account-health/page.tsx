"use client";

/**
 * Self-service account health.
 *
 * Renders the shared `AccountHealthReportView`, so the numbers here are produced
 * by exactly the same scorer the admin console uses and can never disagree.
 *
 * A failed request is shown as a failure. The previous version swallowed it with
 * `catch {}` and rendered an all-zero dashboard, which made a rejected session
 * look identical to a real reading of a blown account.
 */

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { RefreshCw, Shield } from "lucide-react";
import { auth } from "@/lib/firebase";
import { pluginFetch } from "@/lib/plugins/ui";
import AccountShell from "@/components/account/AccountShell";
import { AccountHealthReportView } from "@/components/account-health/report-view";
import type { AccountHealthReport } from "@/lib/account-health/types";

export default function AccountHealthPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [health, setHealth] = useState<AccountHealthReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchHealth = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setError(null);
        try {
            const res = await pluginFetch("/api/account-health", { method: "GET" });
            const data = (await res.json().catch(() => null)) as
                ({ success: boolean; health: AccountHealthReport } & { error?: string }) | null;

            if (!res.ok) {
                // A 401 here means the ID token was rejected, not that the
                // account is unhealthy. Say so instead of drawing zeroes.
                setError(
                    res.status === 401 || res.status === 403
                        ? "Your session was rejected. Sign in again to load your health report."
                        : data?.error || `Could not load account health (${res.status}).`,
                );
                setHealth(null);
                return;
            }
            if (data?.success && data.health) setHealth(data.health);
            else setError("The server returned an unexpected response.");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not load account health.");
            setHealth(null);
        } finally { setLoading(false); }
    }, [user]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!authLoading && user) fetchHealth();
    }, [authLoading, user, fetchHealth]);

    const shell = (children: React.ReactNode) => (
        <div className="min-h-screen bg-background text-foreground" data-guide="account-health">
            <AccountShell title="Account Health" subtitle="Real-time risk assessment and account monitoring">
                <div data-guide="content">{children}</div>
            </AccountShell>
        </div>
    );

    if (authLoading) {
        return (
            <div className="flex min-h-screen flex-col bg-background text-foreground">
                <AccountShell title="Account Health">
                    <div className="flex flex-1 items-center justify-center">
                        <RefreshCw size={20} className="animate-spin text-muted-foreground" />
                    </div>
                </AccountShell>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex min-h-screen flex-col bg-background text-foreground">
                <AccountShell title="Account Health">
                    <div className="flex flex-1 flex-col items-center justify-center gap-3">
                        <Shield size={32} className="text-muted-foreground" />
                        <h1 className="text-sm font-semibold text-foreground">Sign in required</h1>
                        <p className="text-[11px] text-muted-foreground">Your health report is tied to your account.</p>
                    </div>
                </AccountShell>
            </div>
        );
    }

    // Never render the score ring off a missing payload: an all-zero reading is
    // indistinguishable from a real "your account is blown" verdict.
    if (error || !health) {
        return shell(
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border/30 bg-muted/50 px-6 py-12 text-center" data-guide="score-ring">
                <Shield size={28} className={error ? "text-rose-400" : "text-muted-foreground"} />
                <h2 className="text-sm font-semibold text-foreground">
                    {error ? "Health report unavailable" : "No trading activity yet"}
                </h2>
                <p className="max-w-sm text-[11px] leading-5 text-muted-foreground">
                    {error || "Once you have a balance or an open position, your risk score, drawdown and exposure appear here."}
                </p>
                <button
                    type="button"
                    onClick={fetchHealth}
                    disabled={loading}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted/50 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                >
                    <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Retry
                </button>
            </div>,
        );
    }

    return shell(
        <>
            <div className="mb-3 flex items-center justify-end">
                <button
                    type="button"
                    onClick={fetchHealth}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted/50 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                >
                    <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
                </button>
            </div>
            <AccountHealthReportView health={health} />
        </>,
    );
}
