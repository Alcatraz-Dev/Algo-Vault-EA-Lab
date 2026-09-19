"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Loader2, Shield, ArrowLeft, ExternalLink, DollarSign, Package, TrendingUp,
    Plus, Trash2, AlertTriangle, Eye, Star, Crown, Send, CheckCircle2, Clock, XCircle,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { onDeveloperSubscriptionChange } from "@/lib/subscription";
import { ref, get } from "firebase/database";
import { database } from "@/lib/firebase";
import ProductMediaUpload from "@/components/products/ProductMediaUpload";

    type StripeStatus = { connected: boolean; chargesEnabled: boolean; payoutsEnabled: boolean };
    type Product = { id: string; name: string; slug: string; description: string; productType: string; pricing: { type: string; price: number; currency: string }; downloads: number; rating: { average: number; count: number }; status: string; createdAt: number; version: string; [key: string]: unknown };
    type Earnings = { stats: { totalRevenue: number; totalSales: number; avgSale: number }; recentSales: { id: string; product: string; amount: number; date: number; buyer: string }[] };
    type DevSubscription = { plan: string; status: string; hasSubscription: boolean };

    const DEVELOPER_PLAN_NAMES: Record<string, string> = {
        dev_starter: "Starter",
        dev_pro: "Developer Pro",
        dev_enterprise: "Enterprise",
    };

    function DeveloperRequestGate({ user }: { user: User }) {
        const [requestState, setRequestState] = useState<"loading" | "none" | "pending" | "approved" | "rejected">("loading");
        const [requestMessage, setRequestMessage] = useState("");
        const [requestNote, setRequestNote] = useState("");
        const [submitting, setSubmitting] = useState(false);

        useEffect(() => {
            let cancelled = false;
            (async () => {
                try {
                    const token = await user.getIdToken();
                    const res = await fetch("/api/developer/request", {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    const data = await res.json();
                    if (cancelled) return;
                    const req = data.request;
                    if (!req) setRequestState("none");
                    else if (req.status === "pending") setRequestState("pending");
                    else if (req.status === "approved") setRequestState("approved");
                    else setRequestState("rejected");
                    if (req?.message) setRequestNote(req.message);
                } catch {
                    if (!cancelled) setRequestState("none");
                }
            })();
            return () => { cancelled = true; };
        }, [user]);

        async function submitRequest() {
            setSubmitting(true);
            try {
                const token = await user.getIdToken();
                const res = await fetch("/api/developer/request", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ message: requestMessage }),
                });
                if (res.ok) setRequestState("pending");
            } catch {} finally { setSubmitting(false); }
        }

        return (
            <div className="min-h-screen bg-background text-foreground">
                <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                    <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                        <ArrowLeft size={12} /> Back to Account
                    </Link>

                    <div className="mx-auto max-w-lg mt-8">
                        <div className="rounded-2xl border border-border/30 bg-muted/50 p-8 text-center">
                            <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-violet-500/10">
                                <Shield size={24} className="text-violet-400" />
                            </div>
                            <h2 className="mt-5 text-xl font-bold text-foreground">Developer Access Required</h2>
                            <p className="mt-2 text-sm text-muted-foreground leading-6">
                                Request developer access from your admin. Once approved, you can create products, connect your Stripe account, and start selling.
                            </p>

                            {requestState === "loading" && (
                                <div className="mt-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" /></div>
                            )}

                            {requestState === "none" && (
                                <div className="mt-6 space-y-4 text-left">
                                    <div>
                                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Note to admin (optional)</label>
                                        <textarea
                                            rows={3}
                                            placeholder="Describe your use case or any details for the admin..."
                                            value={requestMessage}
                                            onChange={(e) => setRequestMessage(e.target.value)}
                                            className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none resize-none"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={submitRequest}
                                        disabled={submitting}
                                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50"
                                    >
                                        {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                                        {submitting ? "Submitting..." : "Request Developer Access"}
                                    </button>
                                </div>
                            )}

                            {requestState === "pending" && (
                                <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-5 text-left">
                                    <div className="flex items-center gap-3">
                                        <Clock size={18} className="text-amber-400 shrink-0" />
                                        <div>
                                            <p className="text-sm font-semibold text-amber-300">Request Pending</p>
                                            <p className="mt-1 text-xs text-muted-foreground leading-5">
                                                Your request has been submitted and is awaiting admin approval. You will be notified once a decision is made.
                                                {requestNote && <><br />Your note: <span className="text-muted-foreground">&ldquo;{requestNote}&rdquo;</span></>}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {requestState === "approved" && (
                                <div className="mt-6 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-5 text-left">
                                    <div className="flex items-center gap-3">
                                        <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                                        <div>
                                            <p className="text-sm font-semibold text-emerald-300">Approved!</p>
                                            <p className="mt-1 text-xs text-muted-foreground">Your developer access has been granted. Refresh this page to continue.</p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => window.location.reload()}
                                        className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-foreground hover:bg-emerald-500 transition"
                                    >
                                        Refresh Page
                                    </button>
                                </div>
                            )}

                            {requestState === "rejected" && (
                                <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/[0.06] p-5 text-left">
                                    <div className="flex items-center gap-3">
                                        <XCircle size={18} className="text-red-400 shrink-0" />
                                        <div>
                                            <p className="text-sm font-semibold text-red-300">Request Not Approved</p>
                                            <p className="mt-1 text-xs text-muted-foreground">Your developer access request was not approved at this time. You can submit a new request below.</p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setRequestState("none")}
                                        className="mt-4 rounded-xl border border-border/30 bg-muted px-4 py-2 text-xs font-semibold text-muted-foreground bg-muted/10 transition"
                                    >
                                        Submit New Request
                                    </button>
                                </div>
                            )}

                            <p className="mt-5 text-[11px] text-muted-foreground">
                                Or email <a href="mailto:support@algovault.io?subject=Developer%20Role%20Request" className="text-violet-400 hover:underline">support@algovault.io</a>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    export default function DeveloperDashboard() {
        const [user, setUser] = useState<User | null>(null);
        const [authLoading, setAuthLoading] = useState(true);
        const [stripe, setStripe] = useState<StripeStatus | null>(null);
        const [onboarding, setOnboarding] = useState(false);
        const [products, setProducts] = useState<Product[]>([]);
        const [earnings, setEarnings] = useState<Earnings | null>(null);
        const [loading, setLoading] = useState(true);
        const [tab, setTab] = useState<"overview" | "products" | "create">("overview");
        const [role, setRole] = useState("");
        const [devSub, setDevSub] = useState<DevSubscription | null>(null);

    const [formName, setFormName] = useState("");
    const [formDesc, setFormDesc] = useState("");
    const [formType, setFormType] = useState("ea");
    const [formPrice, setFormPrice] = useState("");
    const [formSymbol, setFormSymbol] = useState("EURUSD");
    const [formTimeframe, setFormTimeframe] = useState("H1");
    const [formImageUrl, setFormImageUrl] = useState("");
    const [formImages, setFormImages] = useState("");
    const [formVideoUrl, setFormVideoUrl] = useState("");
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchAll = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken(true);
            const headers = { Authorization: `Bearer ${token}` };

            const [stripeRes, productsRes, earningsRes, roleSnap, devSub] = await Promise.all([
                fetch("/api/developer/stripe", { headers }),
                fetch("/api/developer/products", { headers }),
                fetch("/api/developer/earnings", { headers }),
                get(ref(database, `users/${user.uid}/role`)),
                onDeveloperSubscriptionChange(user.uid),
            ]);

            const stripeData = await stripeRes.json();
            if (stripeData.success) setStripe(stripeData);

            const productsData = await productsRes.json();
            if (productsData.success) setProducts(productsData.products || []);

            const earningsData = await earningsRes.json();
            if (earningsData.success) setEarnings(earningsData);

            setRole(roleSnap.val() || "");
            setDevSub({
                plan: devSub.plan,
                status: devSub.status,
                hasSubscription: devSub.hasSubscription,
            });
        } catch (err) {
            console.error("Dashboard fetch error:", err);
        } finally { setLoading(false); }
    }, [user]);

    useEffect(() => {
        const load = async () => { if (user) await fetchAll(); };
        load();
    }, [user, fetchAll]);

    const startOnboarding = async () => {
        if (!user) return;
        setOnboarding(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/developer/stripe", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json();
            if (json.url) window.location.assign(json.url);
            else if (json.alreadyOnboarded) fetchAll();
            else if (json.error) alert(json.error);
        } catch {} finally { setOnboarding(false); }
    };

    const createProduct = async () => {
        if (!user || !formName.trim()) return;
        setCreating(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/developer/products", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: formName, description: formDesc, productType: formType,
                    price: formPrice ? Number(formPrice) : 0, symbol: formSymbol, timeframe: formTimeframe,
                    imageUrl: formImageUrl,
                    images: formImages.split("\n").map((s) => s.trim()).filter(Boolean),
                    videoUrl: formVideoUrl,
                }),
            });
            const json = await res.json();
            if (json.success) {
                setFormName(""); setFormDesc(""); setFormPrice(""); setFormImageUrl(""); setFormImages(""); setFormVideoUrl("");
                setTab("products");
                fetchAll();
            } else if (json.error) {
                alert(json.error);
            }
        } catch {} finally { setCreating(false); }
    };

    const deleteProduct = async (productId: string) => {
        if (!user || !confirm("Delete this product?")) return;
        const token = await user.getIdToken();
        await fetch("/api/developer/products", {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ productId }),
        });
        fetchAll();
    };

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Sign in required</h1><Link href="/login" className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-violet-500 transition">Sign In</Link></div></div>);
    }

    if (role && role !== "developer" && role !== "admin") {
        return (
            <DeveloperRequestGate user={user} />
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-amber-500/30">
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-blue-500/10 blur-[120px]" />
            </div>
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground transition">
                    <ArrowLeft size={12} /> Back to Account
                </Link>

                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Developer Dashboard</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">Manage your products, Stripe Connect, and earnings</p>
                    </div>
                    <Link href="/developer/subscription" className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-2.5 text-xs font-semibold text-violet-400 hover:bg-violet-500/20 transition">
                        Developer Plan
                    </Link>
                </div>

                {/* Stripe Connect Banner */}
                {stripe && !stripe.connected && (
                    <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
                                    <DollarSign size={20} className="text-amber-400" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">Connect Your Stripe Account</h3>
                                    <p className="text-[11px] text-muted-foreground">Link your Stripe account to receive payments from product sales</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={startOnboarding}
                                disabled={onboarding}
                                className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-amber-400 transition disabled:opacity-50"
                            >
                                {onboarding ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
                                {onboarding ? "Connecting..." : "Connect Stripe"}
                            </button>
                        </div>
                    </div>
                )}

                {stripe?.connected && !stripe.chargesEnabled && (
                    <div className="mb-6 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-5">
                        <div className="flex items-center gap-4">
                            <Loader2 size={18} className="animate-spin text-violet-400" />
                            <div>
                                <h3 className="text-sm font-semibold text-foreground">Stripe Onboarding In Progress</h3>
                                <p className="text-[11px] text-muted-foreground">Complete your Stripe setup to start selling. <button type="button" onClick={startOnboarding} className="text-violet-400 hover:underline">Resume onboarding</button></p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Developer Subscription Banner */}
                {devSub && (
                    <div className="mb-6 rounded-2xl border border-border/30 bg-muted/50 p-5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10">
                                    <Crown size={20} className="text-violet-400" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">Developer Plan</h3>
                                    <p className="text-[11px] text-muted-foreground">
                                        {devSub.hasSubscription && devSub.status === "active"
                                            ? `${DEVELOPER_PLAN_NAMES[devSub.plan] || "Starter"} — Active`
                                            : "Starter plan active"}
                                    </p>
                                </div>
                            </div>
                            <Link
                                href="/developer/subscription"
                                className="flex items-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-2.5 text-xs font-semibold text-violet-400 hover:bg-violet-500/20 transition"
                            >
                                <ExternalLink size={12} />
                                {devSub.hasSubscription && devSub.status === "active" && devSub.plan !== "dev_starter"
                                    ? "Upgrade Plan"
                                    : "View Plans"}
                            </Link>
                        </div>
                    </div>
                )}

                {/* Tabs */}
                <div className="mb-6 flex gap-2 rounded-xl border border-border/30 bg-muted/50 p-1">
                    {(["overview", "products", "create"] as const).map((t) => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => setTab(t)}
                            className={cn(
                                "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all",
                                tab === t ? "bg-violet-600 text-foreground shadow-lg shadow-violet-500/20" : "text-muted-foreground hover:text-muted-foreground hover:bg-muted"
                            )}
                        >
                            {t === "overview" && <TrendingUp size={15} />}
                            {t === "products" && <Package size={15} />}
                            {t === "create" && <Plus size={15} />}
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : (
                    <>
                        {tab === "overview" && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                                        <div className="flex items-center gap-2 mb-1"><DollarSign size={13} className="text-emerald-400" /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Revenue</span></div>
                                        <p className="text-2xl font-bold font-mono text-emerald-400">${earnings?.stats.totalRevenue || 0}</p>
                                    </div>
                                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                                        <div className="flex items-center gap-2 mb-1"><Package size={13} className="text-violet-400" /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Products</span></div>
                                        <p className="text-2xl font-bold font-mono text-foreground">{products.length}</p>
                                    </div>
                                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                                        <div className="flex items-center gap-2 mb-1"><TrendingUp size={13} className="text-amber-400" /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Sales</span></div>
                                        <p className="text-2xl font-bold font-mono text-foreground">{earnings?.stats.totalSales || 0}</p>
                                    </div>
                                </div>

                                {earnings?.recentSales && earnings.recentSales.length > 0 && (
                                    <div className="rounded-2xl border border-border/30 bg-muted/50 p-5">
                                        <h3 className="mb-4 text-sm font-semibold text-foreground">Recent Sales</h3>
                                        <div className="space-y-2">
                                            {earnings.recentSales.map((sale) => (
                                                <div key={sale.id} className="flex items-center justify-between rounded-xl border border-border/20 bg-muted/50 px-4 py-3">
                                                    <div>
                                                        <span className="text-sm font-medium text-foreground">{sale.product}</span>
                                                        <span className="ml-2 text-[10px] text-muted-foreground">{sale.buyer}</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="font-mono text-sm font-bold text-emerald-400">+${sale.amount}</span>
                                                        <p className="text-[9px] text-muted-foreground">{new Date(sale.date).toLocaleDateString()}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {tab === "products" && (
                            <div className="space-y-3">
                                {products.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-border/40 p-16 text-center">
                                        <Package size={32} className="mx-auto text-muted-foreground" />
                                        <p className="mt-3 text-sm text-muted-foreground">No products yet</p>
                                        <button type="button" onClick={() => setTab("create")} className="mt-3 text-xs text-violet-400 hover:underline">Create your first product</button>
                                    </div>
                                ) : products.map((p) => (
                                    <div key={p.id} className="group rounded-2xl border border-border/30 bg-muted/50 p-5 transition-all hover:bg-muted">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-sm font-bold text-violet-400">
                                                    {p.name.charAt(0)}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-semibold text-foreground">{p.name}</span>
                                                        <span className={cn("rounded-md px-2 py-0.5 text-[9px] font-medium", p.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/10 text-muted-foreground")}>{p.status}</span>
                                                        <span className="rounded-md bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">v{p.version}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                                                        <span>{p.productType.toUpperCase()}</span>
                                                        <span>{String(p.symbol || "")}</span>
                                                        <span className="font-mono font-bold text-emerald-400">{p.pricing?.type === "free" ? "Free" : `$${p.pricing?.price}`}</span>
                                                        <span>{p.downloads || 0} downloads</span>
                                                        {p.rating?.average > 0 && <span className="flex items-center gap-0.5"><Star size={9} className="text-amber-400" /> {p.rating.average}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Link href={`/marketplace/${p.slug}`} className="rounded-lg p-2 text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10 transition">
                                                    <Eye size={14} />
                                                </Link>
                                                <button type="button" onClick={() => deleteProduct(p.id)} className="rounded-lg p-2 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-rose-400 hover:bg-rose-500/10 transition-all">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {tab === "create" && (
                            <div className="mx-auto max-w-xl rounded-2xl border border-border/30 bg-muted/50 p-6">
                                <h2 className="mb-4 text-lg font-semibold text-foreground">Create Product</h2>
                                <div className="space-y-4">
                                    <div>
                                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Product Name</label>
                                        <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Trend scalper EA" className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Description</label>
                                        <textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} rows={3} placeholder="Describe your product..." className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none resize-none" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Type</label>
                                            <select value={formType} onChange={(e) => setFormType(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                                                <option value="ea">Expert Advisor</option>
                                                <option value="indicator">Indicator</option>
                                                <option value="setfile">Set File</option>
                                                <option value="strategy">Strategy</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Price (USD)</label>
                                            <input type="number" step="0.01" min="0" value={formPrice} onChange={(e) => setFormPrice(e.target.value)} placeholder="0 = Free" className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Symbol</label>
                                            <select value={formSymbol} onChange={(e) => setFormSymbol(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                                                {["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD", "US30", "NAS100"].map((s) => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Timeframe</label>
                                            <select value={formTimeframe} onChange={(e) => setFormTimeframe(e.target.value)} className="w-full rounded-xl border border-border/40 bg-muted px-4 py-3 text-sm text-foreground focus:border-violet-500 focus:outline-none">
                                                {["M5", "M15", "M30", "H1", "H4", "D1"].map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <ProductMediaUpload
                                        imageUrl={formImageUrl}
                                        videoUrl={formVideoUrl}
                                        images={formImages ? formImages.split("\n").filter(Boolean) : []}
                                        onImageUrlChange={setFormImageUrl}
                                        onVideoUrlChange={setFormVideoUrl}
                                        onImagesChange={(imgs) => setFormImages(imgs.join("\n"))}
                                    />
                                    {!stripe?.chargesEnabled && (
                                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 text-[11px] text-amber-400/80">
                                            <AlertTriangle size={12} className="mr-1 inline" />
                                            Connect your Stripe account first to sell paid products.
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={createProduct}
                                        disabled={!formName.trim() || creating}
                                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50"
                                    >
                                        {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create Product
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
