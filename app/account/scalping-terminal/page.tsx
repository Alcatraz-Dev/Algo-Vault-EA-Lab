"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
    ArrowRight,
    ChartCandlestick,
    Check,
    Lock,
    Sparkles,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";
import { ProScalpingTerminal } from "@/components/pro-scalping-terminal/ProScalpingTerminal";
import AccountShell from "@/components/account/AccountShell";

// ── Feature list shown in the paywall card ──────────────────────────────────
const PRO_FEATURES = [
    "Full chart with Smart Money overlays",
    "Live order flow & liquidity heatmap",
    "Trade replay on real historical candles",
    "AI intelligence fabric + regime detection",
    "Multi-timeframe confluence scanner",
    "Trade journal tied to every signal",
];

export default function ScalpTerminalPage() {
    const router = useRouter();
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [subLoading, setSubLoading] = useState(false);
    const [hasPro, setHasPro] = useState(false);

    // ── Auth listener ────────────────────────────────────────────────────────
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthLoading(false);
        });
        return () => unsub();
    }, []);

    // ── Subscription check ───────────────────────────────────────────────────
    useEffect(() => {
        if (!user) return;
        setSubLoading(true);
        (async () => {
            try {
                const { hasSubscription } = await onSubscriptionChange(user.uid);
                setHasPro(hasSubscription);
            } catch {
                setHasPro(false);
            } finally {
                setSubLoading(false);
            }
        })();
    }, [user]);

    // ── Safety timeout: never block forever ─────────────────────────────────
    useEffect(() => {
        if (subLoading && user) {
            const timer = setTimeout(() => setSubLoading(false), 6000);
            return () => clearTimeout(timer);
        }
    }, [subLoading, user]);

    const loading = authLoading || subLoading;

    // ────────────────────────────────────────────────────────────────────────
    // Loading
    // ────────────────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
                <div className="flex flex-col items-center gap-6">
                    {/* Animated chart icon */}
                    <div className="relative grid size-16 place-items-center">
                        <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
                        <span className="relative grid size-16 place-items-center rounded-full border border-primary/30 bg-primary/10">
                            <ChartCandlestick className="size-7 text-primary" />
                        </span>
                    </div>
                    {/* Skeleton bars */}
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex items-end gap-1">
                            {[3, 5, 2, 6, 4, 7, 3, 5, 4, 6, 5, 3].map((h, i) => (
                                <span
                                    key={i}
                                    className="w-1.5 animate-pulse rounded-sm bg-muted-foreground/20"
                                    style={{
                                        height: `${h * 4}px`,
                                        animationDelay: `${i * 60}ms`,
                                    }}
                                />
                            ))}
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Verifying Pro access&hellip;
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // ────────────────────────────────────────────────────────────────────────
    // Auth gate (not signed in)
    // ────────────────────────────────────────────────────────────────────────
    if (!user) {
        return (
            <AccountShell
                title="Pro Scalping Terminal"
                subtitle="Full chart · overlays · replay · order flow · intelligence · journal"
                onBack={() => void router.push("/account")}
            >
                <div className="flex min-h-[60vh] items-center justify-center px-4">
                    <div className="w-full max-w-md">
                        {/* Card */}
                        <div className="rounded-2xl border border-border bg-card shadow-lg">
                            {/* Top accent bar */}
                            <div className="h-px w-full rounded-t-2xl bg-gradient-to-r from-transparent via-border to-transparent" />

                            <div className="flex flex-col items-center gap-6 px-8 py-10 text-center">
                                {/* Icon */}
                                <div className="grid size-14 place-items-center rounded-xl border border-border bg-muted/50">
                                    <Lock className="size-6 text-muted-foreground" />
                                </div>

                                {/* Copy */}
                                <div className="space-y-2">
                                    <h2 className="text-lg font-semibold tracking-tight text-foreground">
                                        Sign in to continue
                                    </h2>
                                    <p className="text-sm leading-relaxed text-muted-foreground">
                                        The Pro Scalping Terminal requires an account.
                                        Sign in to verify your access.
                                    </p>
                                </div>

                                {/* CTA */}
                                <a
                                    href="/login?redirect=/account/scalping-terminal"
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90"
                                >
                                    Sign in
                                    <ArrowRight className="size-4" />
                                </a>

                                <p className="text-xs text-muted-foreground">
                                    No account?{" "}
                                    <a
                                        href="/register"
                                        className="font-medium text-foreground underline-offset-2 hover:underline"
                                    >
                                        Create one free
                                    </a>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </AccountShell>
        );
    }

    // ────────────────────────────────────────────────────────────────────────
    // Paywall (signed in, no Pro)
    // ────────────────────────────────────────────────────────────────────────
    if (!hasPro) {
        return (
            <AccountShell
                title="Pro Scalping Terminal"
                subtitle="Full chart · overlays · replay · order flow · intelligence · journal"
                onBack={() => void router.push("/account")}
            >
                <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
                    <div className="w-full max-w-lg">
                        {/* Main paywall card */}
                        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
                            {/* Ember accent stripe */}
                            <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

                            <div className="flex flex-col gap-8 px-8 py-10">
                                {/* Header row */}
                                <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:gap-5 sm:text-left">
                                    {/* Icon badge */}
                                    <div className="relative shrink-0">
                                        <span className="absolute -inset-px rounded-xl bg-primary/10" />
                                        <div className="relative grid size-14 place-items-center rounded-xl border border-primary/30 bg-primary/10">
                                            <Sparkles className="size-6 text-primary" />
                                        </div>
                                    </div>

                                    <div>
                                        <div className="mb-1 flex items-center justify-center gap-2 sm:justify-start">
                                            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold tracking-wide text-primary uppercase">
                                                Pro
                                            </span>
                                        </div>
                                        <h2 className="text-xl font-semibold tracking-tight text-foreground">
                                            Pro Scalping Terminal
                                        </h2>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            The complete professional trading workspace — reserved for paid subscribers.
                                        </p>
                                    </div>
                                </div>

                                {/* Feature checklist */}
                                <div className="grid gap-2.5 sm:grid-cols-2">
                                    {PRO_FEATURES.map((feat) => (
                                        <div
                                            key={feat}
                                            className="flex items-start gap-2.5"
                                        >
                                            <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-positive/15">
                                                <Check className="size-2.5 text-positive" strokeWidth={3} />
                                            </span>
                                            <span className="text-sm text-foreground/80">
                                                {feat}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                {/* Divider */}
                                <div className="h-px bg-border" />

                                {/* CTAs */}
                                <div className="flex flex-col gap-3 sm:flex-row">
                                    <a
                                        href="/account/subscribe"
                                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                                    >
                                        <Zap className="size-4" />
                                        Upgrade to Pro
                                    </a>
                                    <a
                                        href="/pricing"
                                        className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                                    >
                                        View pricing
                                    </a>
                                </div>
                            </div>
                        </div>

                        {/* Subtle footer note */}
                        <p className="mt-4 text-center text-xs text-muted-foreground">
                            Already upgraded?{" "}
                            <button
                                onClick={() => void router.refresh()}
                                className="font-medium text-foreground underline-offset-2 hover:underline"
                            >
                                Refresh to sync access
                            </button>
                        </p>
                    </div>
                </div>
            </AccountShell>
        );
    }

    // ────────────────────────────────────────────────────────────────────────
    // Terminal (pro access confirmed)
    // ────────────────────────────────────────────────────────────────────────
    return (
        <AccountShell
            title="Pro Scalping Terminal"
            subtitle="Smart Money · Order Flow · AI Intelligence"
            onBack={() => void router.push("/account")}
            hideSidebar
            fullscreen
        >
            <ProScalpingTerminal />
        </AccountShell>
    );
}

export { ProScalpingTerminal };
