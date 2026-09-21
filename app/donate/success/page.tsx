"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    AlertTriangle,
    ArrowRight,
    Bot,
    CheckCircle2,
    Download,
    Gift,
    Heart,
    Loader2,
    RefreshCw,
    Sparkles,
    TrendingUp,
    Zap,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Suspense } from "react";

const REWARD_CATALOG: Record<
    string,
    { name: string; type: string; description: string; icon: typeof Bot; color: string; bg: string; border: string }
> = {
    free_indicator_1: {
        name: "Gold Trend Indicator",
        type: "Indicator",
        description: "Advanced XAUUSD trend detection with dynamic support/resistance levels",
        icon: TrendingUp,
        color: "text-warning",
        bg: "bg-warning/10",
        border: "border-warning/20",
    },
    free_ea_basic: {
        name: "Scalper EA Lite",
        type: "Expert Advisor",
        description: "Entry-level scalping EA with built-in risk management",
        icon: Zap,
        color: "text-primary",
        bg: "bg-primary/10",
        border: "border-primary/20",
    },
    free_ea_premium: {
        name: "Session Filter EA",
        type: "Expert Advisor",
        description: "Automatically pause trading during low-liquidity sessions",
        icon: Bot,
        color: "text-info",
        bg: "bg-info/10",
        border: "border-info/20",
    },
};

type DonationRecord = {
    donorName?: string;
    amount?: number;
    tierLabel?: string;
    rewardIds?: string[];
    status?: string;
};

function SuccessContent() {
    const searchParams = useSearchParams();
    const donationId = searchParams.get("donation") || "";
    const uid = searchParams.get("uid") || "";

    const [user, setUser] = useState<User | null>(null);
    const [donation, setDonation] = useState<DonationRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [tries, setTries] = useState(0);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => {
            setUser(u);
        });
        return () => unsubscribe();
    }, []);

    // Verify the donation server-side (± Stripe sync). Direct DB reads are
    // blocked by rules, so we go through /api/donate/verify with the user token.
    useEffect(() => {
        if (!donationId || !uid) {
            const t = setTimeout(() => setLoading(false), 0);
            return () => clearTimeout(t);
        }
        // Non-guest donations require a signed-in user to verify
        if (uid !== "guest" && !user) {
            return;
        }

        let cancelled = false;
        let timeout: ReturnType<typeof setTimeout> | null = null;

        const verify = async () => {
            try {
                const params = new URLSearchParams({ donation: donationId, uid });
                const headers: Record<string, string> = {};

                if (user) {
                    const token = await user.getIdToken();
                    headers.Authorization = `Bearer ${token}`;
                }

                const res = await fetch(`/api/donate/verify?${params.toString()}`, { headers });
                const data = await res.json().catch(() => ({}));

                if (cancelled) return;

                if (!res.ok) {
                    setError(data.error || "Unable to confirm your donation.");
                    setLoading(false);
                    return;
                }

                setDonation(data.donation);
                if (data.status === "completed") {
                    setLoading(false);
                    return;
                }

                // Still pending — poll until the Stripe session is confirmed
                if (tries >= 10) {
                    setError(
                        "Your payment is still being confirmed. It usually takes a few seconds — please refresh or try again in a minute."
                    );
                    setLoading(false);
                    return;
                }
                timeout = setTimeout(() => setTries((t) => t + 1), 5000);
            } catch (err: unknown) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : "Unable to confirm your donation.");
                setLoading(false);
            }
        };

        verify();

        return () => {
            cancelled = true;
            if (timeout) clearTimeout(timeout);
        };
    }, [donationId, uid, user, tries]);

    async function handleDownloadReward(productId: string) {
        if (!user) return;

        setDownloadingId(productId);
        try {
            const idToken = await user.getIdToken();
            const res = await fetch("/api/download/product", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ productId }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(err.error || "Download failed. Your reward may still be processing.");
                return;
            }

            const blob = await res.blob();
            const disposition = res.headers.get("Content-Disposition") || "";
            const match = disposition.match(/filename="([^"]+)"/);
            const fileName = match?.[1] || `${productId}.ex5`;

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : "Download error.");
        } finally {
            setDownloadingId(null);
        }
    }

    const rewardIds = donation?.rewardIds || [];

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="relative mx-auto max-w-2xl px-5 py-20 text-center" data-guide="page-header">
                {loading ? (
                    <div>
                        <Loader2 className="mx-auto h-10 w-10 animate-spin text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">Confirming your donation...</p>
                        <p className="mt-2 text-xs text-muted-foreground">Verifying payment with Stripe. This takes a few seconds.</p>
                    </div>
                ) : error ? (
                    <div className="mx-auto max-w-md rounded-xl border border-warning/20 bg-warning/[0.07] p-8">
                        <AlertTriangle className="mx-auto h-9 w-9 text-warning" />
                        <h1 className="mt-4 text-xl font-bold">Still Confirming</h1>
                        <p className="mt-2 text-sm text-muted-foreground leading-6">{error}</p>
                        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setError("");
                                        setLoading(true);
                                        setTries((t) => t + 1);
                                    }}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-5 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                                >
                                    <RefreshCw size={14} />
                                    Check Again
                                </button>
                                <Link
                                    href="/donate"
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-background px-5 py-2.5 text-sm font-bold text-foreground transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                                >
                                    Back to Donate
                                    <ArrowRight size={14} />
                                </Link>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Success Icon */}
                        <div className="relative mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-positive/10 border border-positive/30">
                            <Heart
                                size={40}
                                className="fill-primary text-primary"
                            />
                            <div className="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-positive">
                                <CheckCircle2 size={16} className="text-foreground" />
                            </div>
                        </div>

                        <div className="inline-flex items-center gap-2 rounded-full border border-positive/20 bg-positive/10 px-4 py-1.5 text-xs font-medium text-positive mb-5">
                            <Sparkles size={13} />
                            Donation Confirmed
                        </div>

                        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
                            Thank You{" "}
                            {donation?.donorName ? (
                                <span className="text-primary">
                                    {donation.donorName}!
                                </span>
                            ) : (
                                "🙏"
                            )}
                        </h1>

                        <p className="mt-4 text-muted-foreground leading-7 max-w-md mx-auto">
                            Your{" "}
                            <span className="font-bold text-foreground">
                                ${donation ? ((donation.amount || 0) / 100).toFixed(2) : ""}
                            </span>{" "}
                            donation helps us build better trading tools for everyone.
                            {donation?.tierLabel && (
                                <>
                                    {" "}You&apos;ve joined as a{" "}
                                    <span className="font-bold text-primary">
                                        {donation.tierLabel}
                                    </span>.
                                </>
                            )}
                        </p>

                        {/* Rewards */}
                        {rewardIds.length > 0 && user ? (
                            <div className="mt-10 rounded-xl border border-border/30 bg-muted p-6 text-left">
                                <div className="flex items-center gap-2 mb-5">
                                    <Gift size={16} className="text-primary" />
                                    <h2 className="font-bold text-foreground">Your Free Rewards</h2>
                                    <span className="ml-auto text-xs text-muted-foreground">
                                        Available for download
                                    </span>
                                </div>

                                <div className="space-y-3">
                                    {rewardIds.map((rewardId) => {
                                        const resource = REWARD_CATALOG[rewardId];
                                        if (!resource) return null;
                                        const ResourceIcon = resource.icon;

                                        return (
                                            <div
                                                key={rewardId}
                                                className={`flex items-center gap-4 rounded-xl border ${resource.border} bg-muted p-4`}
                                            >
                                                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${resource.bg}`}>
                                                    <ResourceIcon size={18} className={resource.color} />
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-bold text-foreground">
                                                        {resource.name}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                        {resource.type} · {resource.description}
                                                    </p>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => handleDownloadReward(rewardId)}
                                                    disabled={downloadingId === rewardId}
                                                    className={`flex shrink-0 items-center gap-2 rounded-xl border ${resource.border} ${resource.bg} px-4 py-2 text-xs font-semibold ${resource.color} transition hover:opacity-80 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none`}
                                                >
                                                    {downloadingId === rewardId ? (
                                                        <Loader2 size={13} className="animate-spin" />
                                                    ) : (
                                                        <Download size={13} />
                                                    )}
                                                    Download
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>

                                <p className="mt-4 text-xs text-muted-foreground text-center">
                                    Your rewards are permanently linked to your account and can be re-downloaded at any time.
                                </p>
                            </div>
                        ) : rewardIds.length > 0 && !user ? (
                            <div className="mt-10 rounded-xl border border-warning/20 bg-warning/[0.07] p-6 text-center">
                                <Gift size={24} className="mx-auto mb-3 text-warning" />
                                <h3 className="font-bold text-foreground">Rewards Waiting!</h3>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    Sign in to claim your free resources.
                                </p>
                                <Link
                                    href="/login"
                                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-warning px-5 py-2.5 text-sm font-bold text-foreground transition hover:bg-warning/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                                >
                                    Sign In to Claim
                                    <ArrowRight size={14} />
                                </Link>
                            </div>
                        ) : (
                            <div className="mt-10 rounded-xl border border-border/30 bg-muted p-6 text-center">
                                <p className="text-muted-foreground text-sm">
                                    Thank you for your kind donation! Every contribution helps.
                                </p>
                            </div>
                        )}

                        {/* CTA Links */}
                        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                                <Link
                                    href="/marketplace"
                                    className="inline-flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-5 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                                >
                                    <Bot size={16} />
                                    Browse All EAs
                                </Link>
                                <Link
                                    href="/account"
                                    className="inline-flex items-center gap-2 rounded-xl bg-background px-5 py-2.5 text-sm font-bold text-foreground transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                                >
                                Go to Dashboard
                                <ArrowRight size={14} />
                            </Link>
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}

export default function DonateSuccessPage() {
    return (
        <Suspense fallback={
            <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </main>
        }>
            <SuccessContent />
        </Suspense>
    );
}