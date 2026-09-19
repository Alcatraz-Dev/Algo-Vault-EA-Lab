"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft,
    BarChart3,
    Bot,
    CheckCircle2,
    Clock,
    Download,
    Gauge,
    LineChart,
    RefreshCcwDot,
    Shield,
    ShieldCheck,
    ShoppingCart,
    Target,
    TrendingDown,
    TrendingUp,
    Users,
    Video,
    Play,
    Image as ImageIcon,
    BadgeCheck,
} from "lucide-react";
import { onValue, ref, push, set } from "firebase/database";
import { database, auth } from "@/lib/firebase";
import ProductBranding from "@/components/products/ProductBranding";
import ProductReviews from "@/components/products/ProductReviews";

type BrandingItem = {
    type?: string;
    fileName?: string;
    originalFileName?: string;
    mimeType?: string;
    size?: number;
    path?: string;
    updatedAt?: number;
};

type Product = {
    id: string;
    name: string;
    slug: string;
    description?: string;
    developer?: string;
    developerUid?: string;
    sellerType?: "admin" | "developer";
    imageUrl?: string;
    images?: string[];
    videoUrl?: string;
    version?: string;

    productType?: string;
    platform?: string;

    symbol?: string;
    timeframe?: string;

    branding?: {
        icon?: BrandingItem;
        logo?: BrandingItem;
        banner?: BrandingItem;
    };

    pricing?: {
        type?: string;
        price?: number;
        currency?: string;
    };

    risk?: {
        level?: string;
        maxDrawdown?: number;
    };

    performance?: {
        initialDeposit?: number;
        finalBalance?: number;
        profit?: number;
        winRate?: number;
        profitFactor?: number;
        totalTrades?: number;
        backtestPeriod?: string;
    };

    affiliate?: {
        enabled?: boolean;
        url?: string;
    };

    license?: {
        required?: boolean;
        durationDays?: number;
        maxAccounts?: number;
    };

    status?: string;

    createdAt?: number;
};

function getEmbedVideoUrl(url?: string): { isEmbed: boolean; src: string; isMp4: boolean } | null {
    if (!url) return null;
    const trimmed = url.trim();
    if (!trimmed) return null;

    const ytMatch = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (ytMatch && ytMatch[1]) {
        return { isEmbed: true, src: `https://www.youtube.com/embed/${ytMatch[1]}`, isMp4: false };
    }

    const vimeoMatch = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vimeoMatch && vimeoMatch[1]) {
        return { isEmbed: true, src: `https://player.vimeo.com/video/${vimeoMatch[1]}`, isMp4: false };
    }

    return { isEmbed: false, src: trimmed, isMp4: true };
}

function hasBrandingItem(item?: BrandingItem): boolean {
    return Boolean(item && (item.path || item.fileName));
}

function MediaGallery({ imageUrl, images, videoUrl }: { imageUrl?: string; images?: string[]; videoUrl?: string }) {
    const allImages = [imageUrl, ...(images || [])].filter((url): url is string => Boolean(url && url.trim()));
    const video = getEmbedVideoUrl(videoUrl);

    if (allImages.length === 0 && !video) return null;

    return (
        <div className="mt-8 rounded-3xl border border-border/30 bg-muted/50 p-6 space-y-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Video size={16} className="text-violet-400" /> Media Demonstration & Previews
            </h3>

            {video && (
                <div className="overflow-hidden rounded-2xl border border-border/30 bg-black aspect-video relative">
                    {video.isEmbed ? (
                        <iframe
                            src={video.src}
                            title="Product Demonstration Video"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            className="h-full w-full border-0"
                        />
                    ) : (
                        <video src={video.src} controls className="h-full w-full object-contain" />
                    )}
                </div>
            )}

            {allImages.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {allImages.map((img, idx) => (
                        <div key={idx} className="group overflow-hidden rounded-2xl border border-border/20 bg-muted aspect-video relative">
                            {/* eslint-disable-next-html-element-is-necessary */}
                            <img src={img} alt={`Preview ${idx + 1}`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function ProductDetailsPage() {
    const router = useRouter();
    const params = useParams();

    const [creatingOrder, setCreatingOrder] =
        useState(false);

    const [orderError, setOrderError] =
        useState("");

    const slug = Array.isArray(params.slug)
        ? params.slug[0]
        : params.slug;

    const [product, setProduct] =
        useState<Product | null>(null);

    const [loading, setLoading] =
        useState(true);

    useEffect(() => {
        if (!slug) return;

        const productsRef =
            ref(database, "bots");

        const unsubscribe = onValue(
            productsRef,
            (snapshot) => {
                const data = snapshot.val();

                if (!data) {
                    setProduct(null);
                    setLoading(false);
                    return;
                }

                const found =
                    Object.entries(data)
                        .map(
                            ([id, value]) => ({
                                id,
                                ...(value as Omit<
                                    Product,
                                    "id"
                                >),
                            })
                        )
                        .find(
                            (item) =>
                                item.slug ===
                                slug &&
                                item.status ===
                                "published"
                        );

                setProduct(
                    found || null
                );

                setLoading(false);
            },
            (error) => {
                console.error(
                    "PRODUCT DETAILS ERROR:",
                    error
                );

                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [slug]);

    async function handleBuyNow() {
        if (!product) {
            setOrderError(
                "Product information is not available."
            );
            return;
        }

        setOrderError("");

        const currentUser =
            auth.currentUser;

        if (!currentUser) {
            router.push(
                `/login?redirect=/marketplace/${product.slug}`
            );
            return;
        }

        try {
            setCreatingOrder(true);

            // 1. Create pending order
            const ordersRef = ref(
                database,
                `orders/${currentUser.uid}`
            );

            const newOrderRef =
                push(ordersRef);

            const order = {
                id: newOrderRef.key,

                userId:
                    currentUser.uid,

                productId:
                    product.id,

                productName:
                    product.name,

                productSlug:
                    product.slug,

                productType:
                    product.productType ||
                    "expert_advisor",

                platform:
                    product.platform ||
                    "MT5",

                symbol:
                    product.symbol || "",

                timeframe:
                    product.timeframe || "",

                price:
                    product.pricing?.price ||
                    0,

                currency:
                    product.pricing?.currency ||
                    "USD",

                pricingType:
                    product.pricing?.type ||
                    "free",

                status:
                    "pending",

                paymentProvider:
                    null,

                createdAt:
                    Date.now(),

                updatedAt:
                    Date.now(),
            };

            await set(
                newOrderRef,
                order
            );

            // 2. Get Firebase ID token
            const token =
                await currentUser.getIdToken();

            // 3. Secure Checkout API
            const response =
                await fetch(
                    "/api/checkout/create",
                    {
                        method: "POST",

                        headers: {
                            Authorization:
                                `Bearer ${token}`,

                            "Content-Type":
                                "application/json",
                        },

                        body: JSON.stringify({
                            orderId:
                                newOrderRef.key,
                        }),
                    }
                );

            const data =
                await response.json();

            console.log(
                "CHECKOUT API STATUS:",
                response.status
            );

            console.log(
                "CHECKOUT API RESPONSE:",
                data
            );

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    "Unable to create checkout session."
                );
            }

            // 4. Redirect to Stripe Checkout
            if (!data.checkoutUrl) {
                throw new Error(
                    "Stripe checkout URL was not returned."
                );
            }

            window.location.href =
                data.checkoutUrl;

        } catch (error: any) {
            console.error(
                "CHECKOUT ERROR:",
                error
            );

            setOrderError(
                error?.message ||
                "Unable to start payment. Please try again."
            );

            setCreatingOrder(false);
        }
    }

    if (loading) {
        return (
            <main className="min-h-screen bg-background text-foreground">

                <div className="mx-auto max-w-7xl px-6 py-12">

                    <div className="h-8 w-32 animate-pulse rounded bg-muted/5" />

                    <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_380px]">

                        <div className="h-[600px] animate-pulse rounded-2xl border border-border/30 bg-muted/50" />

                        <div className="h-[400px] animate-pulse rounded-2xl border border-border/30 bg-muted/50" />

                    </div>

                </div>

            </main>
        );
    }

    if (!product) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">

                <div className="text-center">

                    <Bot
                        size={45}
                        className="mx-auto text-muted-foreground"
                    />

                    <h1 className="mt-5 text-2xl font-semibold">
                        Product not found
                    </h1>

                    <p className="mt-2 text-sm text-muted-foreground">
                        This product may have been
                        removed or is no longer
                        published.
                    </p>

                    <Link
                        href="/marketplace"
                        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-background px-5 py-3 text-sm font-medium text-foreground"
                    >
                        <ArrowLeft size={16} />
                        Back to Marketplace
                    </Link>

                </div>

            </main>
        );
    }

    const isIndicator =
        product.productType === "indicator" ||
        product.productType === "pine_indicator";
    const isPineStrategy = product.productType === "pine_strategy";
    const productTypeLabel = isPineStrategy
        ? "Pine Strategy"
        : isIndicator
          ? product.productType === "pine_indicator"
              ? "Pine Indicator"
              : "Indicator"
          : "Expert Advisor";

    const isFree =
        product.pricing?.type ===
        "free";

    const hasBanner = hasBrandingItem(product.branding?.banner);
    const hasLogo = hasBrandingItem(product.branding?.logo);
    const hasIcon = hasBrandingItem(product.branding?.icon);

    return (
        <main className="min-h-screen bg-background text-foreground">

            {/* Header */}
            <div className="border-b border-border/30">

                <div className="mx-auto max-w-7xl px-6 py-5">

                    <div className="flex items-center gap-3">
                        <Link
                            href="/marketplace"
                            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
                        >
                            <ArrowLeft size={14} />
                            Marketplace
                        </Link>
                        <span className="text-muted-foreground/30">•</span>
                        <Link
                            href="/account"
                            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
                        >
                            Back to Account
                        </Link>
                    </div>

                </div>

            </div>

            <div className="mx-auto max-w-7xl px-6 py-10">

                {/* Product Hero */}
                <div className="overflow-hidden rounded-3xl border border-border/30 bg-muted/50" data-guide="page-header">

                    {/* Banner */}
                    <div className="relative h-64 overflow-hidden bg-gradient-to-br from-white/[0.08] via-background to-foreground md:h-80">

                        {hasBanner ? (
                            <>
                                <ProductBranding
                                    product={product}
                                    type="banner"
                                    className="absolute inset-0 h-full w-full rounded-none border-0"
                                />

                                {/* Banner overlay */}
                                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/30 to-foreground/10" />
                            </>
                        ) : (
                            <>
                                <div className="absolute inset-0">

                                    <div className="absolute left-20 top-10 h-48 w-48 rounded-full bg-muted/10 blur-3xl" />

                                    <div className="absolute right-20 bottom-0 h-56 w-56 rounded-full bg-muted/10 blur-3xl" />

                                </div>

                                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                            </>
                        )}

                        {/* Banner Content */}
                        <div className="absolute inset-x-0 bottom-0">

                            <div className="flex flex-col gap-5 p-6 md:p-9 lg:flex-row lg:items-end lg:justify-between">

                                {/* Identity */}
                                <div className="flex items-end gap-5">

                                    {/* Icon */}
                                    {hasIcon ? (
                                        <ProductBranding
                                            product={product}
                                            type="icon"
                                            size="lg"
                                            className="shrink-0 border-border/50 bg-card/60 shadow-2xl backdrop-blur-xl"
                                        />
                                    ) : (
                                        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-border/30 bg-card/60 shadow-2xl backdrop-blur-xl">

                                            {isIndicator || isPineStrategy ? (
                                                <LineChart
                                                    size={32}
                                                />
                                            ) : (
                                                <Bot
                                                    size={32}
                                                />
                                            )}

                                        </div>
                                    )}

                                    <div>

                                        <div className="flex flex-wrap items-center gap-2">

                                            <span className="rounded-lg border border-border/30 bg-background/950 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-md">
                                                {productTypeLabel}
                                            </span>

                                            {product.platform && (
                                                <span className="rounded-lg border border-border/30 bg-background/950 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-md">
                                                    {
                                                        product.platform
                                                    }
                                                </span>
                                            )}

                                        </div>

                                        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground drop-shadow-xl md:text-4xl">
                                            {
                                                product.name
                                            }
                                        </h1>

                                        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                                            <span>by {product.developer || "AlgoVault Team"}</span>
                                            {product.sellerType === "admin" || !product.developerUid ? (
                                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                                                    <ShieldCheck size={11} />
                                                    Platform Official
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                                                    <CheckCircle2 size={11} />
                                                    Verified Developer
                                                </span>
                                            )}
                                        </div>

                                    </div>

                                </div>

                            </div>

                        </div>

                    </div>

                    {/* Main Content */}
                    <div className="p-7 md:p-9">

                        {/* Description */}
                        <div>

                            <h2 className="text-sm font-medium">
                                About this product
                            </h2>

                            <p className="mt-3 max-w-4xl text-sm leading-7 text-muted-foreground">
                                {product.description ||
                                    "Detailed product information will be available here."}
                            </p>

                        </div>

                        {/* Media Demonstration & Previews */}
                        <MediaGallery imageUrl={product.imageUrl} images={product.images} videoUrl={product.videoUrl} />

                        {/* Configuration */}
                        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">

                            <InfoCard
                                icon={
                                    <Gauge
                                        size={16}
                                    />
                                }
                                label="Platform"
                                value={
                                    product.platform ||
                                    "—"
                                }
                            />

                            <InfoCard
                                icon={
                                    <Target
                                        size={16}
                                    />
                                }
                                label="Symbol"
                                value={
                                    product.symbol ||
                                    "Multiple"
                                }
                            />

                            <InfoCard
                                icon={
                                    <Clock
                                        size={16}
                                    />
                                }
                                label="Timeframe"
                                value={
                                    product.timeframe ||
                                    "—"
                                }
                            />

                            <InfoCard
                                icon={
                                    <Shield
                                        size={16}
                                    />
                                }
                                label="Risk"
                                value={
                                    product.risk
                                        ?.level ||
                                    "Not rated"
                                }
                            />
                            <InfoCard
                                icon={
                                    <RefreshCcwDot
                                        size={16}
                                    />
                                }
                                label="Version"
                                value={
                                    product.version ||
                                    "—"
                                }
                            />

                        </div>

                    </div>

                </div>

                {/* Lower Content */}
                <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">

                    {/* Left */}
                    <div>

                        {/* Performance */}
                        <section className="rounded-3xl border border-border/30 bg-muted/50 p-7 md:p-9">

                            <div className="flex items-center gap-3">

                                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/30 bg-muted/5">

                                    <BarChart3
                                        size={18}
                                    />

                                </div>

                                <div>

                                    <h2 className="font-medium">
                                        Backtest Performance
                                    </h2>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Historical or simulated
                                        results provided by
                                        the developer.
                                    </p>

                                </div>

                            </div>

                            <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">

                                <PerformanceCard
                                    label="Return"
                                    value={
                                        product.performance
                                            ?.profit !=
                                            null
                                            ? `${product.performance.profit}%`
                                            : "—"
                                    }
                                    icon={
                                        <TrendingUp
                                            size={16}
                                        />
                                    }
                                />

                                <PerformanceCard
                                    label="Win Rate"
                                    value={
                                        product.performance
                                            ?.winRate !=
                                            null
                                            ? `${product.performance.winRate}%`
                                            : "—"
                                    }
                                    icon={
                                        <Target
                                            size={16}
                                        />
                                    }
                                />

                                <PerformanceCard
                                    label="Profit Factor"
                                    value={
                                        product.performance
                                            ?.profitFactor !=
                                            null
                                            ? String(
                                                product
                                                    .performance
                                                    .profitFactor
                                            )
                                            : "—"
                                    }
                                    icon={
                                        <BarChart3
                                            size={16}
                                        />
                                    }
                                />

                                <PerformanceCard
                                    label="Max Drawdown"
                                    value={
                                        product.risk
                                            ?.maxDrawdown !=
                                            null
                                            ? `${product.risk.maxDrawdown}%`
                                            : "—"
                                    }
                                    icon={
                                        <TrendingDown
                                            size={16}
                                        />
                                    }
                                />

                                <PerformanceCard
                                    label="Total Trades"
                                    value={
                                        product.performance
                                            ?.totalTrades !=
                                            null
                                            ? String(
                                                product
                                                    .performance
                                                    .totalTrades
                                            )
                                            : "—"
                                    }
                                    icon={
                                        <Users
                                            size={16}
                                        />
                                    }
                                />

                                <PerformanceCard
                                    label="Backtest Period"
                                    value={
                                        product.performance
                                            ?.backtestPeriod ||
                                        "—"
                                    }
                                    icon={
                                        <Clock
                                            size={16}
                                        />
                                    }
                                />

                            </div>

                            <div className="mt-6 rounded-xl border border-border/30 bg-muted/20 p-4">

                                <p className="text-xs leading-6 text-muted-foreground">
                                    Performance figures shown
                                    here are historical,
                                    backtested or simulated
                                    results and should not be
                                    interpreted as a promise of
                                    future performance.
                                </p>

                            </div>

                        </section>
                        <div className="mt-6">

                            <ProductReviews

                                productId={product.id}

                            />

                        </div>

                        {/* License */}
                        {product.license
                            ?.required && (
                                <section className="mt-6 rounded-3xl border border-border/30 bg-muted/50 p-7 md:p-9">

                                    <div className="flex items-center gap-3">

                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/30 bg-muted/5">

                                            <CheckCircle2
                                                size={18}
                                            />

                                        </div>

                                        <div>

                                            <h2 className="font-medium">
                                                License
                                            </h2>

                                            <p className="mt-1 text-xs text-muted-foreground">
                                                Product activation
                                                requirements.
                                            </p>

                                        </div>

                                    </div>

                                    <div className="mt-6 grid gap-3 sm:grid-cols-2">

                                        <InfoCard
                                            label="Duration"
                                            value={`${product.license.durationDays || 30} days`}
                                        />

                                        <InfoCard
                                            label="Maximum Accounts"
                                            value={String(
                                                product
                                                    .license
                                                    .maxAccounts ||
                                                1
                                            )}
                                        />

                                    </div>

                                </section>
                            )}

                    </div>

                    {/* Purchase Card */}
                    <aside className="lg:sticky lg:top-6 lg:self-start">

                        <div className="rounded-3xl border border-border/30 bg-muted p-6">

                            <p className="text-xs text-muted-foreground">
                                Access
                            </p>

                            <div className="mt-2 flex items-end justify-between">

                                <div>

                                    <span className="text-3xl font-semibold">

                                        {isFree
                                            ? "Free"
                                            : `${product.pricing?.price || 0} ${product
                                                .pricing
                                                ?.currency ||
                                            "USD"
                                            }`}

                                    </span>

                                    {!isFree &&
                                        product
                                            .pricing
                                            ?.type ===
                                        "subscription" && (
                                            <span className="ml-2 text-xs text-muted-foreground">
                                                recurring
                                            </span>
                                        )}

                                </div>

                            </div>

                            <div className="my-6 h-px bg-muted/10" />

                            <div className="space-y-4">

                                <Feature
                                    text={`${product.platform || "Platform"} compatible`}
                                />

                                <Feature
                                    text={
                                        `${productTypeLabel} access`
                                    }
                                />

                                {product.license
                                    ?.required && (
                                        <Feature
                                            text={`License for ${product
                                                .license
                                                .durationDays ||
                                                30
                                                } days`}
                                        />
                                    )}

                                <Feature
                                    text="Product updates"
                                />

                                <Feature
                                    text="Secure product delivery"
                                />

                            </div>

                            <button
                                onClick={
                                    handleBuyNow
                                }
                                disabled={
                                    creatingOrder
                                }
                                className="mt-10 flex w-full items-center justify-center gap-2 rounded-xl bg-background px-5 py-3.5 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                            >

                                {isFree ? (
                                    <>
                                        <Download
                                            size={17}
                                        />

                                        {creatingOrder
                                            ? "Opening..."
                                            : "Get Free"}
                                    </>
                                ) : (
                                    <>
                                        <ShoppingCart
                                            size={17}
                                        />

                                        {creatingOrder
                                            ? "Opening Checkout..."
                                            : "Buy Now"}
                                    </>
                                )}

                            </button>

                            {orderError && (
                                <p className="mt-3 text-sm text-red-400">
                                    {orderError}
                                </p>
                            )}

                            <p className="mt-4 text-center text-[11px] leading-5 text-muted-foreground">
                                Secure checkout,
                                licensing and protected
                                product delivery are used
                                for eligible purchases.
                            </p>

                        </div>

                        {/* Risk */}
                        <div className="mt-4 rounded-2xl border border-border/30 bg-muted/50 p-5">

                            <div className="flex gap-3">

                                <Shield
                                    size={17}
                                    className="mt-0.5 shrink-0 text-muted-foreground"
                                />

                                <p className="text-[11px] leading-5 text-muted-foreground">
                                    Trading involves
                                    substantial risk. Past
                                    performance does not
                                    guarantee future results.
                                </p>

                            </div>

                        </div>

                    </aside>

                </div>

            </div>

        </main>
    );
}

function InfoCard({
    icon,
    label,
    value,
}: {
    icon?: React.ReactNode;
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-xl border border-border/30 bg-muted/20 p-4">

            <div className="flex items-center gap-2 text-muted-foreground">

                {icon}

                <span className="text-[11px]">
                    {label}
                </span>

            </div>

            <p className="mt-2 text-sm font-medium">
                {value}
            </p>

        </div>
    );
}

function PerformanceCard({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-xl border border-border/30 bg-muted/20 p-5">

            <div className="flex items-center gap-2 text-muted-foreground">

                {icon}

                <span className="text-xs">
                    {label}
                </span>

            </div>

            <p className="mt-3 text-xl font-semibold">
                {value}
            </p>

        </div>
    );
}

function Feature({
    text,
}: {
    text: string;
}) {
    return (
        <div className="flex items-center gap-3">

            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/5">

                <CheckCircle2
                    size={14}
                />

            </div>

            <span className="text-sm text-muted-foreground">
                {text}
            </span>

        </div>
    );
}
