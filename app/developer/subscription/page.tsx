"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, database } from "@/lib/firebase";
import { ref, get, set } from "firebase/database";
import { onDeveloperSubscriptionChange } from "@/lib/subscription";
import {
    Loader2, Shield, ArrowLeft, Check, Crown, Code,
    CreditCard, LogOut,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const getTimestamp = (): number => Date.now();

type DeveloperPlan = {
    id: string; name: string; price: number; period: string;
    features: string[]; highlighted?: boolean;
};

const PLANS: DeveloperPlan[] = [
    {
        id: "dev_starter",
        name: "Starter",
        price: 0,
        period: "forever",
        features: [
            "List up to 3 products",
            "5% platform fee per sale",
            "Basic analytics",
            "Community support",
            "Standard marketplace listing",
        ],
    },
    {
        id: "dev_pro",
        name: "Developer Pro",
        price: 19,
        period: "month",
        highlighted: true,
        features: [
            "Unlimited products",
            "2% platform fee per sale",
            "Advanced analytics & earnings dashboard",
            "Priority support",
            "Featured marketplace placement",
            "Custom branding on listings",
            "Early access to new features",
        ],
    },
    {
        id: "dev_enterprise",
        name: "Enterprise",
        price: 49,
        period: "month",
        features: [
            "Everything in Developer Pro",
            "0% platform fee (keep 100%)",
            "Dedicated account manager",
            "Custom storefront page",
            "API access for product management",
            "Bulk product upload",
            "White-label options",
            "Custom payment splitting",
        ],
    },
];

type SubscriptionData = {
    plan: string;
    status: string;
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
    cancelAtPeriodEnd?: boolean;
};

export default function DeveloperSubscription() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [currentPlan, setCurrentPlan] = useState<string | null>(null);
    const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
    const [subLoading, setSubLoading] = useState(true);
    const [subscribing, setSubscribing] = useState<string | null>(null);
    const [role, setRole] = useState<string>("");
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchSubscription = useCallback(async () => {
        if (!user) return;
        setSubLoading(true);
        try {
            const { hasSubscription, plan, status, stripeSubscriptionId, stripeCustomerId } =
                await onDeveloperSubscriptionChange(user.uid);

            setSubscription({
                plan: hasSubscription ? plan : "dev_starter",
                status: hasSubscription ? status : "none",
                stripeSubscriptionId,
                stripeCustomerId,
            });
            setCurrentPlan(hasSubscription ? plan : "dev_starter");

            if (!hasSubscription) {
                const snap = await get(ref(database, `users/${user.uid}/developerPlan`));
                const devPlan = snap.val();
                if (devPlan) {
                    setCurrentPlan(devPlan);
                    setSubscription((prev) => ({ ...(prev || { plan: devPlan, status: "none" }), plan: devPlan }));
                }
            }
        } catch (err) {
            console.error("Failed to load developer subscription:", err);
        } finally {
            setSubLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const loadRole = async () => {
            try {
                const snap = await get(ref(database, `users/${user.uid}/role`));
                setRole(snap.val() || "");
            } catch {
                setRole("");
            }
        };
        const init = async () => {
            await loadRole();
            await fetchSubscription();
        };
        init();
    }, [user, fetchSubscription]);

    const subscribe = async (planId: string) => {
        if (!user || subscribing) return;

        const plan = PLANS.find((p) => p.id === planId);
        if (!plan) return;

        if (plan.price === 0) {
            setSubscribing(planId);
            try {
                const now = getTimestamp();
                await set(ref(database, `users/${user.uid}/developerPlan`), planId);
                await set(ref(database, `users/${user.uid}/developerSubscription`), {
                    plan: planId,
                    status: "active",
                    orderId: `sub_dev_${planId}_${now}`,
                    stripeSessionId: null,
                    stripeSubscriptionId: null,
                    stripeCustomerId: null,
                    createdAt: now,
                    updatedAt: now,
                });
                setCurrentPlan(planId);
                setSubscription({ plan: planId, status: "active" });
            } catch (err) {
                console.error("Failed to set free plan:", err);
            } finally {
                setSubscribing(null);
            }
            return;
        }

        setSubscribing(planId);
        try {
            const token = await user.getIdToken(true);
            const orderId = `sub_dev_${planId}_${getTimestamp()}`;
            const res = await fetch("/api/checkout/create", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ orderId }),
            });
            const json = await res.json();
            if (json.checkoutUrl) {
                window.location.assign(json.checkoutUrl);
            }
        } catch (err) {
            console.error("Subscribe failed:", err);
        } finally {
            setSubscribing(null);
        }
    };

    const handleManageBilling = async () => {
        if (!user) return;
        setActionLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`/api/billing/portal?subscriber=dev`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.url) {
                window.location.assign(data.url);
            }
        } catch (err) {
            console.error("Billing portal failed:", err);
        } finally {
            setActionLoading(false);
        }
    };

    const handleCancel = async () => {
        if (!user || !subscription?.stripeSubscriptionId) return;
        setActionLoading(true);
        try {
            const token = await user.getIdToken();
            await fetch("/api/billing", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ action: "cancel", subscriber: "dev" }),
            });
            setCurrentPlan("dev_starter");
            setSubscription((prev) => prev ? { ...prev, plan: "dev_starter", status: "canceled" } : null);
        } catch (err) {
            console.error("Cancel failed:", err);
        } finally {
            setActionLoading(false);
        }
    };

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><Link href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</Link></div></div>);
    }

    if (role && role !== "developer" && role !== "admin") {
        return (
            <div className="flex min-h-screen flex-col bg-background">
                <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                    <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition"><ArrowLeft size={12} /> Back to Account</Link>
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-8 text-center">
                        <Code size={40} className="mx-auto text-amber-400" />
                        <h2 className="mt-4 text-xl font-bold text-foreground">Become a Developer</h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            You need a developer account to subscribe to developer plans.{" "}
                            <a
                                href="mailto:support@algovault.io?subject=Developer%20Role%20Request"
                                className="text-violet-400 hover:text-violet-300 underline"
                            >
                                Contact admin
                            </a>{" "}
                            to upgrade your role.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    const isCurrentActive = (planId: string) => currentPlan === planId && subscription?.status === "active";

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/developer/dashboard" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Dashboard
                </Link>

                {/* Current Plan Status */}
                {subscription && (
                    <div className="mb-6 rounded-2xl border border-border/30 bg-muted/50 p-5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                                    <Crown size={20} className="text-violet-400" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">Current Developer Plan</h3>
                                    <p className="text-xs text-muted-foreground">
                                        {subscription.status === "active"
                                            ? `${PLANS.find((p) => p.id === currentPlan)?.name || "Starter"} — Active`
                                            : subscription.status === "canceled"
                                                ? "Subscription canceled"
                                                : "No active plan"}
                                    </p>
                                </div>
                            </div>
                            {subscription.status === "active" && currentPlan && currentPlan !== "dev_starter" && (
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={handleManageBilling}
                                        disabled={actionLoading}
                                        className="flex items-center gap-2 rounded-xl border border-border/30 bg-muted/5 px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/10"
                                    >
                                        <CreditCard size={12} /> Manage Billing
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCancel}
                                        disabled={actionLoading}
                                        className="flex items-center gap-2 rounded-xl border border-rose-500/20 px-4 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10"
                                    >
                                        <LogOut size={12} /> Cancel
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="mb-8 text-center">
                    <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Developer Plans</h1>
                    <p className="mt-2 text-sm text-muted-foreground">Choose the right plan for your selling needs</p>
                </div>

                <div className="grid gap-6 lg:grid-cols-3">
                    {PLANS.map((plan) => {
                        const isActive = isCurrentActive(plan.id);
                        return (
                            <div
                                key={plan.id}
                                className={cn(
                                    "relative rounded-2xl border p-6 transition-all",
                                    plan.highlighted
                                        ? "border-violet-500/40 bg-violet-500/[0.04] shadow-lg shadow-violet-500/10"
                                        : "border-border/30 bg-muted/50",
                                    isActive && "ring-2 ring-emerald-500/40"
                                )}
                            >
                                {plan.highlighted && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-3 py-1 text-[10px] font-bold text-foreground">
                                        MOST POPULAR
                                    </div>
                                )}
                                {isActive && (
                                    <div className="absolute -top-3 right-4 rounded-full bg-emerald-500 px-3 py-1 text-[10px] font-bold text-foreground">
                                        CURRENT
                                    </div>
                                )}

                                <div className="mb-4">
                                    <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
                                    <div className="mt-2 flex items-baseline gap-1">
                                        <span className="text-3xl font-bold text-foreground">${plan.price}</span>
                                        <span className="text-sm text-muted-foreground">/{plan.period}</span>
                                    </div>
                                </div>

                                <ul className="mb-6 space-y-2.5">
                                    {plan.features.map((f, i) => (
                                        <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                                            <Check size={14} className="mt-0.5 flex-shrink-0 text-emerald-400" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>

                                <button
                                    type="button"
                                    onClick={() => subscribe(plan.id)}
                                    disabled={isActive || subscribing === plan.id || (subLoading)}
                                    className={cn(
                                        "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition disabled:opacity-50",
                                        plan.highlighted
                                            ? "bg-violet-600 text-foreground hover:bg-violet-500"
                                            : "bg-muted/30 text-foreground hover:bg-muted/20"
                                    )}
                                >
                                    {subscribing === plan.id ? (
                                        <Loader2 size={15} className="animate-spin" />
                                    ) : isActive ? (
                                        <Check size={15} />
                                    ) : null}
                                    {isActive ? "Current Plan" : plan.price === 0 ? "Get Started" : "Subscribe"}
                                </button>
                            </div>
                        );
                    })}
                </div>

                <div className="mt-8 rounded-2xl border border-border/30 bg-muted/50 p-6">
                    <h3 className="mb-4 text-sm font-semibold text-foreground">What are platform fees?</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        Platform fees are charged on each sale you make. For example, with the Starter plan at 5% fee, if you sell a product for $100, you receive $95 and the platform keeps $5. Higher-tier plans reduce or eliminate this fee.
                    </p>
                </div>
            </div>
        </div>
    );
}
