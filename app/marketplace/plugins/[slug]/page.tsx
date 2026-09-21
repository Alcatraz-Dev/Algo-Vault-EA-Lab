"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft,
    CheckCircle2,
    Clock,
    Download,
    Plug,
    Settings2,
    Shield,
    ShieldCheck,
    ShoppingCart,
    Sparkles,
    Star,
    Terminal,
    Zap,
} from "lucide-react";
import { onValue, ref, push, set } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import { PluginRecord } from "@/lib/plugins/types";
import {
    CATEGORY_LABELS,
    EXTENSION_TYPE_LABELS,
    formatPrice,
    grantedPermissions,
    permissionDescription,
    permissionLabel,
} from "@/lib/plugins/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

type PluginReview = {
    id: string;
    pluginId: string;
    userId?: string;
    userName?: string;
    rating?: number;
    comment?: string;
    status?: string;
    createdAt?: number;
    updatedAt?: number;
};

const LIFECYCLE = ["Draft", "Testing", "Published", "Installed", "Configured", "Active", "Paused", "Disabled", "Uninstalled"];

export default function PluginDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;

    const [plugin, setPlugin] = useState<PluginRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState("");
    const [reviews, setReviews] = useState<PluginReview[]>([]);

    const [reviewRating, setReviewRating] = useState(5);
    const [reviewComment, setReviewComment] = useState("");
    const [reviewBusy, setReviewBusy] = useState(false);

    useEffect(() => {
        if (!slug) return;
        const pluginsRef = ref(database, "plugins");
        const unsubscribe = onValue(
            pluginsRef,
            (snapshot) => {
                const data = snapshot.val() as Record<string, PluginRecord> | null;
                const found = data
                    ? Object.values(data).find((p) => p && (p.slug === slug || p.id === slug) && p.status === "published")
                    : undefined;
                setPlugin(found || null);
                setLoading(false);
            },
            () => setLoading(false)
        );
        return () => unsubscribe();
    }, [slug]);

    useEffect(() => {
        if (!plugin?.id) return;
        fetch(`/api/plugins/${plugin.id}/reviews`, { cache: "no-store" })
            .then((res) => res.json().catch(() => ({})))
            .then((data) => {
                if (Array.isArray((data as { reviews?: PluginReview[] }).reviews)) {
                    setReviews((data as { reviews: PluginReview[] }).reviews);
                }
            })
            .catch(() => setReviews([]));
    }, [plugin?.id]);

    async function handleFreeInstall() {
        if (!plugin) return;
        setBusy(true);
        setActionError("");
        try {
            const user = auth.currentUser;
            if (!user) {
                router.push(`/login?redirect=/marketplace/plugins/${plugin.slug || plugin.id}`);
                return;
            }
            const token = await user.getIdToken();
            const res = await fetch("/api/plugins/install", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ pluginId: plugin.id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Unable to install the plugin.");
            router.push(`/account/plugins/${plugin.id}`);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Unable to install the plugin.");
            setBusy(false);
        }
    }

    async function handleBuy() {
        if (!plugin) return;
        setBusy(true);
        setActionError("");
        try {
            const user = auth.currentUser;
            if (!user) {
                router.push(`/login?redirect=/marketplace/plugins/${plugin.slug || plugin.id}`);
                return;
            }
            const ordersRef = ref(database, `orders/${user.uid}`);
            const newOrderRef = push(ordersRef);
            const order = {
                id: newOrderRef.key,
                userId: user.uid,
                productId: plugin.id,
                productName: plugin.displayName,
                productSlug: plugin.slug || plugin.id,
                productType: "plugin",
                orderType: "plugin",
                pluginId: plugin.id,
                price: plugin.pricing?.price || 0,
                currency: (plugin.pricing?.currency || "usd").toUpperCase(),
                pricingType: plugin.pricing?.type || "one_time",
                status: "pending",
                paymentProvider: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            await set(newOrderRef, order);

            const token = await user.getIdToken();
            const res = await fetch("/api/checkout/create", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ orderId: newOrderRef.key }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Unable to start checkout.");
            if (!data.checkoutUrl) throw new Error("Stripe checkout URL was not returned.");
            window.location.href = data.checkoutUrl;
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Unable to start payment.");
            setBusy(false);
        }
    }

    async function handleReviewSubmit() {
        if (!plugin || !reviewComment.trim()) return;
        setReviewBusy(true);
        const user = auth.currentUser;
        if (!user) {
            router.push(`/login?redirect=/marketplace/plugins/${plugin.slug || plugin.id}`);
            return;
        }
        try {
            const token = await user.getIdToken();
            const res = await fetch(`/api/plugins/${plugin.id}/reviews`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ rating: reviewRating, comment: reviewComment }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Unable to submit the review.");
            setReviewComment("");
            setReviews((prev) => {
                const existing = prev.find((r) => r.id === data.review?.id);
                if (existing) return prev.map((r) => (r.id === data.review?.id ? data.review : r));
                return [data.review, ...prev];
            });
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Unable to submit the review.");
        } finally {
            setReviewBusy(false);
        }
    }

    if (loading) {
        return (
            <main className="min-h-screen bg-background text-foreground">
                <div className="mx-auto max-w-7xl px-6 py-12">
                    <div className="h-8 w-32 animate-pulse rounded bg-muted/5" />
                    <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_360px]">
                        <div className="h-[500px] animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                        <div className="h-[400px] animate-pulse rounded-2xl border border-border/30 bg-muted/50" />
                    </div>
                </div>
            </main>
        );
    }

    if (!plugin) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
                <div className="text-center">
                    <Plug size={45} className="mx-auto text-muted-foreground" />
                    <h1 className="mt-5 text-2xl font-semibold">Plugin not found</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        This plugin may have been removed or is no longer published.
                    </p>
                    <Link
                        href="/marketplace/plugins"
                        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-background px-5 py-3 text-sm font-medium text-foreground"
                    >
                        <ArrowLeft size={16} />
                        Back to Plugins
                    </Link>
                </div>
            </main>
        );
    }

    const isFree = plugin.pricing?.type === "free";
    const perms = grantedPermissions(plugin.permissions);
    const isExtension = plugin.type === "extension";
    const extensionType = (plugin as PluginRecord & { extensionType?: string }).extensionType || "browser";

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="border-b border-border/30">
                <div className="mx-auto max-w-7xl px-6 py-5">
                    <div className="flex items-center gap-3">
                        <Link href="/marketplace/plugins" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                            <ArrowLeft size={14} />
                            Plugins
                        </Link>
                        <span className="text-muted-foreground/30">•</span>
                        <Link href="/marketplace/extensions" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground">
                            Extensions
                        </Link>
                    </div>
                </div>
            </div>

            <div className="mx-auto max-w-7xl px-6 py-10">
                <div className="overflow-hidden rounded-3xl border border-border/30 bg-muted/50">
                    {/* Hero */}
                    <div className="relative h-56 overflow-hidden bg-gradient-to-br from-violet-500/15 via-background to-foreground md:h-64">
                        <div className="absolute left-20 top-10 h-48 w-48 rounded-full bg-muted/10 blur-3xl" />
                        <div className="absolute right-20 bottom-0 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl" />
                        <div className="absolute inset-0 bg-gradient-to-t from-muted via-transparent to-transparent" />
                        <div className="absolute inset-x-0 bottom-0">
                            <div className="flex flex-col gap-5 p-6 md:p-9 lg:flex-row lg:items-end lg:justify-between">
                                <div className="flex items-end gap-5">
                                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-border/30 bg-card/60 shadow-2xl backdrop-blur-xl">
                                        {isExtension ? <Zap size={32} className="text-emerald-300" /> : <Plug size={32} className="text-violet-300" />}
                                    </div>
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-lg border border-border/30 bg-background/950 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-md">
                                                {isExtension
                                                    ? EXTENSION_TYPE_LABELS[extensionType]
                                                    : "Plugin"}
                                            </span>
                                            <span className="rounded-lg border border-border/30 bg-background/950 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-md">
                                                {CATEGORY_LABELS[plugin.category]}
                                            </span>
                                        </div>
                                        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground drop-shadow-xl md:text-4xl">
                                            {plugin.displayName}
                                        </h1>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                            <span>by {plugin.creator?.name || "AlgoVault Team"}</span>
                                            <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                                                <ShieldCheck size={11} />
                                                Platform Official
                                            </span>
                                            {plugin.isAIGenerated && (
                                                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
                                                    <Sparkles size={11} />
                                                    AI-generated
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-7 md:p-9">
                        <div>
                            <h2 className="text-sm font-medium">About this plugin</h2>
                            <p className="mt-3 max-w-4xl text-sm leading-7 text-muted-foreground">{plugin.description}</p>
                        </div>

                        {plugin.capabilities?.length > 0 && (
                            <div className="mt-8">
                                <h2 className="text-sm font-medium">Capabilities</h2>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    {plugin.capabilities.map((cap) => (
                                        <div key={cap} className="flex items-center gap-3 rounded-xl border border-border/30 bg-muted/20 p-3">
                                            <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
                                            <span className="text-sm text-muted-foreground">{cap}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {plugin.permissions && (
                            <div className="mt-8">
                                <h2 className="text-sm font-medium">Permissions this plugin requests</h2>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    The plugin can only access data and services explicitly granted here — never more.
                                </p>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {perms.map((permission) => (
                                        <div key={permission} className="rounded-xl border border-border/30 bg-muted/20 p-4">
                                            <p className="text-sm font-medium">{permissionLabel(permission)}</p>
                                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{permissionDescription(permission)}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <InfoCard icon={<Clock size={16} />} label="Runtime interval" value={plugin.manifest?.runtime?.interval || "manual"} />
                            <InfoCard icon={<Terminal size={16} />} label="Handler" value={plugin.manifest?.runtime?.handler || "Declarative conditions"} />
                            <InfoCard icon={<Zap size={16} />} label="Category" value={CATEGORY_LABELS[plugin.category]} />
                            <InfoCard icon={<Shield size={16} />} label="Version" value={`v${plugin.version}`} />
                        </div>

                        {plugin.documentation && (
                            <div className="mt-8">
                                <h2 className="text-sm font-medium">Documentation</h2>
                                <div className="mt-3 max-w-3xl rounded-2xl border border-border/30 bg-muted/20 p-5">
                                    {plugin.documentation.split("\n").map((line, i) => {
                                        if (line.startsWith("## ")) {
                                            return (
                                                <h3 key={i} className="mt-4 text-sm font-semibold text-foreground first:mt-0">
                                                    {line.replace(/^##\s+/, "")}
                                                </h3>
                                            );
                                        }
                                        if (line.startsWith("- ")) {
                                            return (
                                                <p key={i} className="mt-1 text-xs leading-6 text-muted-foreground">
                                                    • {line.replace(/^-\s+/, "")}
                                                </p>
                                            );
                                        }
                                        if (!line.trim()) return <div key={i} className="h-2" />;
                                        return (
                                            <p key={i} className="mt-1 text-xs leading-6 text-muted-foreground">
                                                {line}
                                            </p>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
                    <div className="space-y-6">
                        {/* Lifecycle */}
                        <section className="rounded-3xl border border-border/30 bg-muted/50 p-7 md:p-9">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                                    <Settings2 size={18} />
                                </div>
                                <div>
                                    <h2 className="font-medium">Plugin lifecycle</h2>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        From catalog to running intelligence agent.
                                    </p>
                                </div>
                            </div>
                            <div className="mt-6 flex flex-wrap items-center gap-2">
                                {LIFECYCLE.map((step, i) => (
                                    <div key={step} className="flex items-center gap-2">
                                        <span className="rounded-lg border border-border/30 bg-muted/20 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                                            {step}
                                        </span>
                                        {i < LIFECYCLE.length - 1 && <span className="text-muted-foreground/40">→</span>}
                                    </div>
                                ))}
                            </div>
                            <p className="mt-5 text-xs leading-6 text-muted-foreground">
                                After installing, the plugin appears under{" "}
                                <Link href="/account/plugins" className="text-foreground underline underline-offset-2">
                                    My Plugins
                                </Link>{" "}
                                where you configure symbols, intervals and notification channels before activating it.
                            </p>
                        </section>

                        {/* Reviews */}
                        <section className="rounded-3xl border border-border/30 bg-muted/50 p-7 md:p-9">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/30 bg-muted/5">
                                    <Star size={18} />
                                </div>
                                <div>
                                    <h2 className="font-medium">Reviews</h2>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {plugin.rating?.count || 0} reviews · {Number(plugin.rating?.average || 0).toFixed(1)} average
                                    </p>
                                </div>
                            </div>

                            <div className="mt-6 rounded-2xl border border-border/30 bg-muted/20 p-5">
                                <p className="text-xs font-medium">Share your experience</p>
                                <div className="mt-3 flex items-center gap-1">
                                    {[1, 2, 3, 4, 5].map((n) => (
                                        <button
                                            key={n}
                                            type="button"
                                            onClick={() => setReviewRating(n)}
                                            className="rounded p-1 transition hover:scale-110"
                                            aria-label={`Rate ${n} stars`}
                                        >
                                            <Star size={20} className={n <= reviewRating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"} />
                                        </button>
                                    ))}
                                </div>
                                <textarea
                                    value={reviewComment}
                                    onChange={(e) => setReviewComment(e.target.value)}
                                    placeholder="What did this plugin help you with? (optional)"
                                    rows={2}
                                    className="mt-3 w-full rounded-xl border border-border/30 bg-muted/50 p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                                />
                                <button
                                    type="button"
                                    onClick={handleReviewSubmit}
                                    disabled={reviewBusy || !reviewComment.trim()}
                                    className="mt-3 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {reviewBusy ? "Submitting..." : "Submit review"}
                                </button>
                            </div>

                            {reviews.length === 0 && (
                                <div className="mt-6">
                                    <EmptyState
                                        compact
                                        icon={<Star size={18} />}
                                        title="No reviews yet"
                                        description="Be the first to review this plugin after using it."
                                    />
                                </div>
                            )}
                            {reviews.length > 0 && (
                                <div className="mt-6 space-y-3">
                                    {reviews.slice(0, 10).map((review) => (
                                        <div key={review.id} className="rounded-2xl border border-border/30 bg-muted/20 p-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted/5 text-[11px] font-semibold uppercase">
                                                        {String(review.userName || "U").slice(0, 1)}
                                                    </div>
                                                    <span className="text-sm font-medium">{review.userName || "AlgoVault user"}</span>
                                                    <span className="flex items-center gap-0.5">
                                                        {[1, 2, 3, 4, 5].map((n) => (
                                                            <Star key={n} size={11} className={n <= (review.rating || 0) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40"} />
                                                        ))}
                                                    </span>
                                                </div>
                                                {review.status === "pending" && (
                                                    <StatusBadge tone="pending" label="Pending moderation" />
                                                )}
                                            </div>
                                            {review.comment && <p className="mt-2 text-sm leading-6 text-muted-foreground">{review.comment}</p>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>

                    {/* Purchase card */}
                    <aside className="lg:sticky lg:top-6 lg:self-start">
                        <div className="rounded-3xl border border-border/30 bg-muted p-6">
                            <p className="text-xs text-muted-foreground">Access</p>
                            <div className="mt-2 flex items-end justify-between">
                                <span className="text-3xl font-semibold">
                                    {isFree ? "Free" : formatPrice(plugin.pricing?.price, plugin.pricing?.currency)}
                                </span>
                                {!isFree && plugin.pricing?.type === "subscription" && (
                                    <span className="mb-1 text-xs text-muted-foreground">
                                        / month
                                    </span>
                                )}
                            </div>
                            {!isFree && plugin.pricing?.type === "subscription" && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Billed monthly · {plugin.pricing?.intervalMonths || 1} month{plugin.pricing?.intervalMonths !== 1 ? "s" : ""} per cycle
                                </p>
                            )}

                            <div className="my-6 h-px bg-muted/10" />

                            <div className="space-y-4">
                                <Feature text={`${CATEGORY_LABELS[plugin.category]} category`} />
                                <Feature text={`Runs on ${plugin.manifest?.runtime?.interval || "manual"} schedule`} />
                                <Feature text={`${plugin.capabilities?.length || 0} capabilities`} />
                                <Feature text="Sandboxed runtime — declarative only" />
                                <Feature text="Alerts via in-app, email, Telegram & Discord" />
                            </div>

                            <button
                                type="button"
                                onClick={isFree ? handleFreeInstall : handleBuy}
                                disabled={busy}
                                className="mt-10 flex w-full items-center justify-center gap-2 rounded-xl bg-background px-5 py-3.5 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isFree ? (
                                    <>
                                        <Download size={17} />
                                        {busy ? "Installing..." : "Install Plugin"}
                                    </>
                                ) : (
                                    <>
                                        <ShoppingCart size={17} />
                                        {busy ? "Opening Checkout..." : "Buy Now"}
                                    </>
                                )}
                            </button>

                            {actionError && <p className="mt-3 text-sm text-red-400">{actionError}</p>}

                            <p className="mt-4 text-center text-[11px] leading-5 text-muted-foreground">
                                {isFree
                                    ? "Free plugins install instantly into My Plugins."
                                    : "Secure checkout and licensing (Stripe) are used for paid plugins. After payment the plugin unlocks instantly."}
                            </p>
                        </div>

                        <div className="mt-4 rounded-2xl border border-border/30 bg-muted/50 p-5">
                            <div className="flex gap-3">
                                <Shield size={17} className="mt-0.5 shrink-0 text-muted-foreground" />
                                <p className="text-[11px] leading-5 text-muted-foreground">
                                    Plugins perform analysis on your own trading data and market data.
                                    They do not place trades, move funds, or access any service beyond
                                    the permissions explicitly granted above.
                                </p>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </main>
    );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div className="rounded-xl border border-border/30 bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
                {icon}
                <span className="text-[11px]">{label}</span>
            </div>
            <p className="mt-2 text-sm font-medium">{value}</p>
        </div>
    );
}

function Feature({ text }: { text: string }) {
    return (
        <div className="flex items-center gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/5">
                <CheckCircle2 size={14} />
            </div>
            <span className="text-sm text-muted-foreground">{text}</span>
        </div>
    );
}