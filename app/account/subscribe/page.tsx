"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import ProGate from "@/components/subscription/ProGate";
import { ProWidget } from "@/components/subscription/ProWidget";
import {
  ArrowLeft,
  Crown,
  Zap,
  Star,
  Check,
  Loader2,
  RefreshCw,
  ShieldCheck,
  CreditCard,
  LogOut,
  Sparkles,
  X,
  AlertTriangle,
  Gift,
} from "lucide-react";

type SubscriptionData = {
  plan: string;
  status: string;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
  currentPeriodEnd?: number;
  createdAt?: number;
  updatedAt?: number;
  cancelAtPeriodEnd?: boolean;
};

export default function SubscribePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlPlan = searchParams?.get("plan");
  const [user, setUser] = useState<User | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionData>({ plan: "free", status: "none" });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showProWidget, setShowProWidget] = useState(false);

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
    const check = async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/subscription-status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setSubscription({
          plan: data.plan || "free",
          status: data.status || "none",
          stripeSubscriptionId: data.stripeSubscriptionId,
          stripeCustomerId: data.stripeCustomerId,
          currentPeriodEnd: data.currentPeriodEnd,
          cancelAtPeriodEnd: data.cancelAtPeriodEnd,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
      } catch (err) {
        console.error("Failed to load subscription:", err);
      } finally {
        setLoading(false);
      }
    };
    check();
  }, [user]);

  useEffect(() => {
    if (!urlPlan) return;
    const id = `tier-${urlPlan.toLowerCase()}`;
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [urlPlan]);

  const handleUpgrade = async (plan: string) => {
    if (!user) return;
    setActionLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/checkout/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ orderId: `sub_${plan}_${Date.now()}` }),
      });
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err) {
      console.error("Upgrade failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleManageBilling = async () => {
    if (!user || !subscription.stripeCustomerId) return;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/billing/portal", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Billing portal failed:", err);
    }
  };

  const handleCancel = async () => {
    if (!user) return;
    setActionLoading(true);
    try {
      const idToken = await user.getIdToken();
      await fetch("/api/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ action: "cancel" }),
      });
      setSubscription((prev) => ({ ...prev, status: "canceled" }));
    } catch (err) {
      console.error("Cancel failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <Crown className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight mt-6">Sign in to manage your subscription</h1>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          You need to be signed in to view and manage your subscription.
        </p>
        <Link
          href="/login?redirect=/account/subscribe"
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-foreground px-6 py-3 text-sm font-semibold text-background transition hover:opacity-90"
        >
          Sign In
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <Link
          href="/account"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft size={16} />
          Back to Account
        </Link>

        <div className="mt-6" data-guide="page-header">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <Sparkles size={13} />
            Subscription Management
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-4">
            Your Subscription
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
            Manage your plan, billing, and Pro features.
          </p>
        </div>

        {/* Subscription Status Card */}
        <div className="mt-8 rounded-lg border border-border bg-card p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold">
                  {subscription.plan === "enterprise" ? "Enterprise" : subscription.plan === "pro" ? "Pro" : "Free"}
                </span>
                {subscription.status === "active" && (
                  <span className="flex items-center gap-1 rounded-full bg-positive/10 px-2.5 py-1 text-xs font-medium text-positive">
                    <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                    Active
                  </span>
                )}
                {subscription.cancelAtPeriodEnd && (
                  <span className="flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                    <AlertTriangle size={12} />
                    Canceling at period end
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {subscription.plan === "free"
                  ? "Upgrade to unlock advanced trading tools"
                  : `Plan active until ${subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString() : "N/A"}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {subscription.plan === "free" ? (
                <>
                  <button
                    onClick={() => handleUpgrade("pro")}
                    disabled={actionLoading}
                    className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-40"
                  >
                    {actionLoading ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
                    Upgrade to Pro
                  </button>
                  <button
                    onClick={() => handleUpgrade("enterprise")}
                    disabled={actionLoading}
                    className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-muted"
                  >
                    <Crown size={15} />
                    Enterprise
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleManageBilling}
                    className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-muted"
                  >
                    <CreditCard size={15} />
                    Manage Billing
                  </button>
                  {subscription.status === "active" && (
                    <button
                      onClick={handleCancel}
                      disabled={actionLoading}
                      className="flex items-center gap-2 rounded-lg border border-destructive/20 px-4 py-2.5 text-sm font-medium text-destructive transition hover:bg-destructive/10 disabled:opacity-40"
                    >
                      {actionLoading ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
                      Cancel
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Feature Comparison */}
        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              name: "Free",
              icon: Star,
              features: [
                "Marketplace browsing",
                "Basic backtest reports",
                "1 live account",
                "Community signals",
                "Basic risk calculator",
                "Notebook (50 entries)",
              ],
              current: subscription.plan === "free",
            },
            {
              name: "Pro",
              icon: Zap,
              price: "$29/mo",
              features: [
                "Everything in Free",
                "Unlimited backtest reports",
                "Advanced Analysis & Order Flow",
                "TradingView Pine Script Workspace",
                "TradingView Advanced Charts",
                "Bar Replay Engine",
                "AI Signals Engine",
                "Copy Trading (5 masters)",
                "Unlimited live accounts",
                "Live Trading",
                "Unlimited notebook",
                "Profit Split Calculator",
                "Swap Calculator",
                "Spread Analyzer",
                "Custom alerts",
                "Priority support",
                "Market Structure Analysis",
                "Email trade alerts",
              ],
              current: subscription.plan === "pro",
              highlighted: true,
            },
            {
              name: "Enterprise",
              icon: Crown,
              price: "$99/mo",
              features: [
                "Everything in Pro",
                "Unlimited live accounts",
                "Unlimited copy trading",
                "API access",
                "White-label options",
                "Dedicated account manager",
                "Custom integrations",
                "SLA guarantee",
                "Advanced security",
                "Team collaboration",
                "TradingView Enterprise",
              ],
              current: subscription.plan === "enterprise",
            },
          ].map((tier) => {
            const matchUrl =
              urlPlan &&
              tier.name.toLowerCase() === urlPlan.toLowerCase();
            return (
            <div
              key={tier.name}
              id={`tier-${tier.name.toLowerCase()}`}
              className={`relative rounded-lg border p-6 transition ${
                tier.highlighted
                  ? "border-foreground bg-card shadow-xl"
                  : tier.current
                  ? "border-positive/50 bg-positive/[0.03]"
                  : "border-border bg-card"
              }`}
            >
              {matchUrl && (
                <div className="absolute -top-3 right-4 rounded-full bg-primary px-3 py-1 text-micro font-bold text-primary-foreground">
                  Selected
                </div>
              )}
              {tier.highlighted && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1 text-micro font-semibold text-background">
                  <Zap size={11} />
                  Most Popular
                </span>
              </div>
              )}
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tier.highlighted ? "bg-foreground text-background" : "bg-muted"}`}>
                  <tier.icon size={20} />
                </div>
                <div>
                  <h3 className="font-semibold">{tier.name}</h3>
                  <p className="text-xs text-muted-foreground">{tier.price || "Free forever"}</p>
                </div>
              </div>
              {tier.current && (
                <div className="mt-3 rounded-lg bg-positive/10 px-3 py-1.5 text-xs font-medium text-positive">
                  Current Plan
                </div>
              )}
              <ul className="mt-4 space-y-2">
                {tier.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check size={15} className={`mt-0.5 shrink-0 ${tier.features.includes(feature) ? "text-positive" : "text-muted-foreground"}`} />
                    <span className={tier.features.includes(feature) ? "text-foreground" : "text-muted-foreground"}>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
          })}
        </div>

        {/* TradingView Benefits */}
        {subscription.plan !== "free" && (
          <div className="mt-8 rounded-lg border border-chart-3/30 bg-chart-3/10 p-6">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles size={20} className="text-primary" />
              TradingView Pro Charts
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              You have access to advanced TradingView charts with custom indicators, real-time data streaming, the Pine Script visual workspace, and full trading control.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-2 text-sm">
                <Check size={16} className="text-positive" />
                Custom chart types (Candle, Line, Area, Bar, Heikin-Ashi)
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check size={16} className="text-positive" />
                7 technical studies (MA, EMA, RSI, MACD, Bollinger, Volume, VWAP)
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check size={16} className="text-positive" />
                Real-time tick data and streaming
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check size={16} className="text-positive" />
                Full control over chart UI and interactions
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check size={16} className="text-positive" />
                Pine Script visual workspace with code export
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check size={16} className="text-positive" />
                Custom indicator and strategy support
              </div>
            </div>
          </div>
        )}

        {/* Pro Widget - show if not subscribed */}
        {subscription.plan === "free" && (
          <div className="mt-8">
            <ProWidget
              show={true}
              onDismiss={() => setShowProWidget(false)}
            />
          </div>
        )}

        {/* Trust signals */}
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <ShieldCheck size={18} className="text-positive shrink-0" />
            <div>
              <p className="text-sm font-medium">Secure Payment</p>
              <p className="text-xs text-muted-foreground">Powered by Stripe</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <RefreshCw size={18} className="text-info shrink-0" />
            <div>
              <p className="text-sm font-medium">Cancel Anytime</p>
              <p className="text-xs text-muted-foreground">No long-term commitment</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <Gift size={18} className="text-primary shrink-0" />
            <div>
              <p className="text-sm font-medium">14-Day Refund</p>
              <p className="text-xs text-muted-foreground">Full money-back guarantee</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}