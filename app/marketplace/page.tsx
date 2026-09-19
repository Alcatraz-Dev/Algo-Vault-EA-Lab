"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    ArrowRight,
    BarChart3,
    Bot,
    CheckCircle2,
    Filter,
    Search,
    Shield,
    Sparkles,
    Star,
} from "lucide-react";
import { onValue, ref } from "firebase/database";
import { database } from "@/lib/firebase";
import ProductBranding from "@/components/products/ProductBranding";

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
        profit?: number;
        winRate?: number;
        profitFactor?: number;
        totalTrades?: number;
        initialDeposit?: number;
        finalBalance?: number;
        backtestPeriod?: string;
    };
    rating?: {
        average?: number;
        count?: number;
    };

    status?: string;

    createdAt?: number;
};

type Filter =
    | "all"
    | "expert_advisor"
    | "indicator"
    | "pine_strategy"
    | "MT5"
    | "MT4"
    | "TradingView"
    | "free"
    | "paid";

export default function MarketplacePage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] =
        useState<Filter>("all");
    const [search, setSearch] = useState("");

    useEffect(() => {
        const productsRef = ref(database, "bots");

        const unsubscribe = onValue(
            productsRef,
            (snapshot) => {
                const data = snapshot.val();

                if (!data) {
                    setProducts([]);
                    setLoading(false);
                    return;
                }

                const list: Product[] =
                    Object.entries(data)
                        .map(([id, value]) => ({
                            id,
                            ...(value as Omit<
                                Product,
                                "id"
                            >),
                        }))
                        .filter(
                            (product) =>
                                product.status ===
                                "published"
                        )
                        .sort(
                            (a, b) =>
                                (b.createdAt || 0) -
                                (a.createdAt || 0)
                        );

                setProducts(list);
                setLoading(false);
            },
            (error) => {
                console.error(
                    "MARKETPLACE FIREBASE ERROR:",
                    error
                );

                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, []);

    const filteredProducts = useMemo(() => {
        const query = search
            .trim()
            .toLowerCase();

        return products.filter((product) => {
            const matchesSearch =
                !query ||
                product.name
                    ?.toLowerCase()
                    .includes(query) ||
                product.description
                    ?.toLowerCase()
                    .includes(query) ||
                product.symbol
                    ?.toLowerCase()
                    .includes(query) ||
                product.platform
                    ?.toLowerCase()
                    .includes(query);

            if (!matchesSearch) {
                return false;
            }

            switch (activeFilter) {
                case "expert_advisor":
                    return (
                        product.productType ===
                        "expert_advisor"
                    );

                case "indicator":
                    return (
                        product.productType ===
                            "indicator" ||
                        product.productType ===
                            "pine_indicator"
                    );

                case "pine_strategy":
                    return product.productType === "pine_strategy";

                case "MT5":
                    return (
                        product.platform ===
                        "MT5"
                    );

                case "MT4":
                    return (
                        product.platform ===
                        "MT4"
                    );

                case "TradingView":
                    return (
                        product.platform ===
                        "TradingView"
                    );

                case "free":
                    return (
                        product.pricing?.type ===
                        "free"
                    );

                case "paid":
                    return (
                        product.pricing?.type !==
                        "free"
                    );

                default:
                    return true;
            }
        });
    }, [
        products,
        activeFilter,
        search,
    ]);

    const filters: {
        label: string;
        value: Filter;
    }[] = [
            {
                label: "All Products",
                value: "all",
            },
            {
                label: "Expert Advisors",
                value: "expert_advisor",
            },
            {
                label: "Indicators",
                value: "indicator",
            },
            {
                label: "Pine Strategies",
                value: "pine_strategy",
            },
            {
                label: "MT5",
                value: "MT5",
            },
            {
                label: "MT4",
                value: "MT4",
            },
            {
                label: "TradingView",
                value: "TradingView",
            },
            {
                label: "Free",
                value: "free",
            },
            {
                label: "Paid",
                value: "paid",
            },
        ];

    return (
        <main className="min-h-screen bg-background text-foreground">

            {/* Header */}
            <section className="border-b border-border/30" data-guide="page-header">

                <div className="mx-auto max-w-7xl px-6 py-10">

                    <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">

                        <div className="max-w-2xl">

                            <Link
                                href="/account"
                                className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
                            >
                                <ArrowLeft size={16} />
                                Back to Account
                            </Link>

                            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                                Trading tools built
                                <br />
                                for serious traders.
                            </h1>

                            <p className="mt-5 max-w-xl text-sm leading-7 text-muted-foreground">
                                Explore Expert Advisors,
                                indicators and automated
                                trading tools for MT5, MT4
                                and TradingView.
                            </p>

                        </div>

                        <div className="grid grid-cols-3 gap-3">

                            <MiniStat
                                icon={
                                    <Bot size={15} />
                                }
                                value={
                                    products.length
                                }
                                label="Products"
                            />

                            <MiniStat
                                icon={
                                    <CheckCircle2
                                        size={15}
                                    />
                                }
                                value={
                                    products.filter(
                                        (p) =>
                                            p.pricing
                                                ?.type ===
                                            "free"
                                    ).length
                                }
                                label="Free"
                            />

                            <MiniStat
                                icon={
                                    <BarChart3
                                        size={15}
                                    />
                                }
                                value={
                                    products.filter(
                                        (p) =>
                                            p.productType ===
                                            "expert_advisor"
                                    ).length
                                }
                                label="EAs"
                            />

                        </div>

                    </div>

                </div>

            </section>

            {/* Marketplace */}
            <section className="mx-auto max-w-7xl px-6 py-8">

                {/* Search */}
                <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between" data-guide="search">

                    <div className="relative w-full max-w-md">

                        <Search
                            size={17}
                            className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />

                        <input
                            value={search}
                            onChange={(e) =>
                                setSearch(
                                    e.target.value
                                )
                            }
                            placeholder="Search products, symbols..."
                            className="w-full rounded-xl border border-border/30 bg-muted py-3 pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-border/50"
                        />

                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">

                        <Filter size={14} />

                        {filteredProducts.length}{" "}
                        products

                    </div>

                </div>

                {/* Filters */}
                <div className="mb-8 flex gap-2 overflow-x-auto pb-2" data-guide="filters">

                    {filters.map((filter) => (

                        <button
                            key={filter.value}
                            onClick={() =>
                                setActiveFilter(
                                    filter.value
                                )
                            }
                            className={`whitespace-nowrap rounded-xl border px-4 py-2.5 text-xs transition ${activeFilter ===
                                filter.value
                                ? "border-border/50 bg-background text-foreground"
                                : "border-border/30 bg-muted/50 text-muted-foreground hover:bg-muted/5"
                                }`}
                        >
                            {filter.label}
                        </button>

                    ))}

                </div>

                {/* Loading */}
                {loading && (
                    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">

                        {[1, 2, 3].map(
                            (item) => (
                                <div
                                    key={item}
                                    className="h-80 animate-pulse rounded-2xl border border-border/30 bg-muted/50"
                                />
                            )
                        )}

                    </div>
                )}

                {/* Empty */}
                {!loading &&
                    filteredProducts.length ===
                    0 && (
                        <div className="rounded-2xl border border-dashed border-border/30 bg-muted/50 px-6 py-20 text-center">

                            <Bot
                                size={40}
                                className="mx-auto text-muted-foreground"
                            />

                            <h2 className="mt-5 text-lg font-medium">
                                No products found
                            </h2>

                            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                                Try another search or
                                filter. Published
                                products will appear
                                here automatically.
                            </p>

                        </div>
                    )}

                {/* Products */}
                    {!loading &&
                    filteredProducts.length >
                    0 && (
                        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" data-guide="products">

                            {filteredProducts.map(
                                (product) => (
                                    <ProductCard
                                        key={
                                            product.id
                                        }
                                        product={
                                            product
                                        }
                                    />
                                )
                            )}

                        </div>
                    )}

                {/* Risk */}
                <div className="mt-10 rounded-2xl border border-border/30 bg-muted/50 p-5">

                    <div className="flex gap-3">

                        <Shield
                            size={18}
                            className="mt-0.5 shrink-0 text-muted-foreground"
                        />

                        <p className="text-xs leading-6 text-muted-foreground">
                            Trading involves substantial
                            risk of loss. Backtested,
                            historical or simulated
                            performance is not a guarantee
                            of future results. Results may
                            differ because of spreads,
                            slippage, execution, leverage,
                            market conditions and other
                            factors. Only trade with capital
                            you can afford to lose.
                        </p>

                    </div>

                </div>

            </section>

        </main>
    );
}

function hasBrandingItem(item?: any): boolean {
    if (!item) return false;
    if (typeof item === "string") return item.trim().length > 0;
    return Boolean(item.path || item.fileName || item.url || item.src);
}

function ProductCard({
    product,
}: {
    product: Product;
}) {
    const pricing = product.pricing;

    const isFree =
        pricing?.type === "free";

    const productType = getProductTypeLabel(product.productType);

    const hasBanner = hasBrandingItem(product.branding?.banner);
    const hasIcon = hasBrandingItem(product.branding?.icon);
    const hasLogo = hasBrandingItem(product.branding?.logo);

    return (
        <article className="group flex flex-col overflow-hidden rounded-2xl border border-border/30 bg-muted/50 transition hover:border-border/50 hover:bg-foreground/8">

            {/* Banner / Product Visual Header */}
            <div className="relative h-52 overflow-hidden border-b border-border/30 bg-gradient-to-br from-background via-muted to-foreground">

                {hasBanner ? (
                    <>
                        <ProductBranding
                            product={product}
                            type="banner"
                            className="absolute inset-0 h-full w-full rounded-none border-0"
                        />

                        {/* Gradient overlay for readability */}
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-muted via-muted/40 to-foreground/30" />
                    </>
                ) : (
                    <div className="absolute inset-0">
                        <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl" />
                        <div className="absolute right-0 bottom-0 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl" />
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_40%)]" />
                    </div>
                )}

                {/* Card Header Foreground */}
                <div className="relative z-10 flex h-full flex-col justify-between p-5">

                    {/* Top Row: Icon + Logo (Left) and Platform Pill (Right) */}
                    <div className="flex items-start justify-between gap-3">

                        {/* Logo & Sub-Icon Badge Container */}
                        <div className="relative inline-flex shrink-0">

                            {/* Primary Logo (Bigger) or Main Icon if no logo */}
                            {hasLogo ? (
                                <ProductBranding
                                    product={product}
                                    type="logo"
                                    size="md"
                                    className="rounded-2xl border border-border/50 bg-background/75 shadow-2xl backdrop-blur-xl transition group-hover:border-border/60"
                                />
                            ) : (
                                <ProductBranding
                                    product={product}
                                    type="icon"
                                    size="md"
                                    className="rounded-2xl border border-border/50 bg-background/75 shadow-2xl backdrop-blur-xl transition group-hover:border-border/60"
                                />
                            )}

                            {/* Smaller Sub-Icon Badge on the Bottom-Right Corner of the Logo */}
                            {hasLogo && hasIcon && (
                                <div className="absolute -bottom-28 -right-72 flex h-6 w-6 items-center justify-center rounded-lg border border-border/50 bg-background shadow-xl backdrop-blur-md">
                                    <ProductBranding
                                        product={product}
                                        type="icon"
                                        size="xs"
                                        className="h-4 w-4 border-0 bg-transparent"
                                    />
                                </div>
                            )}

                        </div>

                        {/* Platform Badge */}
                        {product.platform && (
                            <span className="rounded-lg border border-border/30 bg-background/70 px-2.5 py-1 text-[11px] font-medium tracking-wide text-foreground shadow-lg backdrop-blur-md">
                                {product.platform}
                            </span>
                        )}

                    </div>

                    {/* Bottom Row: Category Tag & Product Name */}
                    <div>
                        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                            {productType}
                        </span>

                        <h2 className="mt-0.5 line-clamp-1 text-lg font-semibold text-foreground drop-shadow-md transition group-hover:text-emerald-300">
                            {product.name}
                        </h2>
                        {(product.rating?.count ?? 0) > 0 && (
                            <div className="mt-3 flex items-center gap-2 text-sm">
                                <div className="flex items-center gap-1">
                                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                                    <span className="font-semibold text-foreground">
                                        {(product.rating?.average ?? 0).toFixed(1)}
                                    </span>
                                </div>

                                <span className="text-muted-foreground">
                                    ·
                                </span>

                                <span className="text-muted-foreground">
                                    {product.rating?.count}{" "}
                                    {product.rating?.count === 1
                                        ? "review"
                                        : "reviews"}
                                </span>
                            </div>
                        )}
                    </div>

                </div>

            </div>

            {/* Body */}
            <div className="flex flex-1 flex-col p-5">

                <p className="min-h-[48px] text-sm leading-6 text-muted-foreground">
                    {product.description ||
                        "Trading tool available on AlgoVault."}
                </p>

                {/* Tags */}
                <div className="mt-5 flex flex-wrap gap-2">

                    {product.symbol && (
                        <span className="rounded-lg bg-muted/5 px-2.5 py-1 text-[11px] text-muted-foreground">
                            {product.symbol}
                        </span>
                    )}

                    {product.timeframe && (
                        <span className="rounded-lg bg-muted/5 px-2.5 py-1 text-[11px] text-muted-foreground">
                            {product.timeframe}
                        </span>
                    )}

                    {product.risk?.level && (
                        <span className="rounded-lg bg-muted/5 px-2.5 py-1 text-[11px] text-muted-foreground">
                            Risk:{" "}
                            {product.risk.level}
                        </span>
                    )}

                </div>

                {/* Stats */}
                <div className="mt-6 grid grid-cols-3 gap-2">

                    <Stat
                        label="Win Rate"
                        value={
                            product.performance
                                ?.winRate !=
                                null
                                ? `${product.performance.winRate}%`
                                : "—"
                        }
                    />

                    <Stat
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
                    />

                    <Stat
                        label="Max DD"
                        value={
                            product.risk
                                ?.maxDrawdown !=
                                null
                                ? `${product.risk.maxDrawdown}%`
                                : "—"
                        }
                    />


                </div>

                {/* Bottom */}
                <div className="mt-6 flex items-center justify-between border-t border-border/30 pt-5">

                    <div>

                        <p className="text-[11px] text-muted-foreground">
                            Price
                        </p>

                        <p className="mt-1 text-lg font-semibold">
                            {isFree
                                ? "Free"
                                : `${pricing?.price || 0} ${pricing?.currency ||
                                "USD"
                                }`}
                        </p>

                    </div>

                    <Link
                        href={`/marketplace/${product.slug}`}
                        className="flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-xs font-medium text-foreground transition hover:bg-muted"
                    >
                        View Product

                        <ArrowRight
                            size={14}
                        />
                    </Link>

                </div>

            </div>

        </article>
    );
}

function getProductTypeLabel(productType?: string) {
    if (productType === "indicator") return "Indicator";
    if (productType === "pine_indicator") return "Pine Indicator";
    if (productType === "pine_strategy") return "Pine Strategy";
    return "Expert Advisor";
}

function Stat({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-xl border border-border/30 bg-muted/30 p-3">

            <p className="text-[10px] text-muted-foreground">
                {label}
            </p>

            <p className="mt-1 text-sm font-medium">
                {value}
            </p>

        </div>
    );
}

function MiniStat({
    icon,
    value,
    label,
}: {
    icon: React.ReactNode;
    value: number;
    label: string;
}) {
    return (
        <div className="min-w-[90px] rounded-xl border border-border/30 bg-muted/50 p-3">

            <div className="flex items-center gap-2 text-muted-foreground">

                {icon}

                <span className="text-xs">
                    {label}
                </span>

            </div>

            <p className="mt-2 text-lg font-semibold">
                {value}
            </p>

        </div>
    );
}
