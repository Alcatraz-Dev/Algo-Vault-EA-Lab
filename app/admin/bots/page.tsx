"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Bot,
    Plus,
    Pencil,
    Trash2,
    ExternalLink,
    RefreshCw,
    Image as ImageIcon,
    Layers3,
} from "lucide-react";
import { database } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import { onValue, ref, remove, update } from "firebase/database";

type BrandingItem = {
    type?: string;
    fileName?: string;
    originalFileName?: string;
    mimeType?: string;
    contentType?: string;
    size?: number;
    path?: string;
    storagePath?: string;
    updatedAt?: number;
    uploadedAt?: number;
};

type BotItem = {
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
    };

    status?: string;
    createdAt?: number;
};

type BrandingType =
    | "icon"
    | "logo"
    | "banner";

export default function AdminBotsPage() {
    const [bots, setBots] = useState<BotItem[]>([]);
    const [loading, setLoading] = useState(true);

    const router = useRouter();

    useEffect(() => {
        const botsRef = ref(database, "bots");

        const unsubscribe = onValue(
            botsRef,
            (snapshot) => {
                const data = snapshot.val();

                if (!data) {
                    setBots([]);
                    setLoading(false);
                    return;
                }

                const list: BotItem[] =
                    Object.entries(data).map(
                        ([id, value]) => ({
                            id,
                            ...(value as Omit<
                                BotItem,
                                "id"
                            >),
                        })
                    );

                list.sort(
                    (a, b) =>
                        (b.createdAt || 0) -
                        (a.createdAt || 0)
                );

                setBots(list);
                setLoading(false);
            },
            (error) => {
                console.error(
                    "Firebase bots error:",
                    error
                );

                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, []);

    async function deleteBot(bot: BotItem) {
        const confirmed =
            window.confirm(
                `Are you sure you want to delete "${bot.name}"?`
            );

        if (!confirmed) return;

        try {
            await remove(
                ref(
                    database,
                    `bots/${bot.id}`
                )
            );
        } catch (error) {
            console.error(
                "DELETE BOT ERROR:",
                error
            );

            alert(
                "Failed to delete bot."
            );
        }
    }

    async function toggleStatus(
        bot: BotItem
    ) {
        const newStatus =
            bot.status === "published"
                ? "draft"
                : "published";

        try {
            await update(
                ref(
                    database,
                    `bots/${bot.id}`
                ),
                {
                    status: newStatus,
                    updatedAt:
                        Date.now(),
                }
            );
        } catch (error) {
            console.error(
                "UPDATE STATUS ERROR:",
                error
            );

            alert(
                "Failed to update bot status."
            );
        }
    }

    function formatProductType(
        type?: string
    ) {
        if (!type) return "Unknown";

        if (
            type ===
            "expert_advisor"
        ) {
            return "Expert Advisor";
        }

        if (
            type === "indicator"
        ) {
            return "Indicator";
        }

        if (type === "pine_indicator") {
            return "Pine Indicator";
        }

        if (type === "pine_strategy") {
            return "Pine Strategy";
        }

        return type;
    }

    function formatPricing(
        bot: BotItem
    ) {
        const pricing =
            bot.pricing;

        if (!pricing)
            return "—";

        if (
            pricing.type ===
            "free"
        ) {
            return "Free";
        }

        if (
            pricing.type ===
            "subscription"
        ) {
            return `${pricing.price || 0
                } ${pricing.currency ||
                "USD"
                } / month`;
        }

        return `${pricing.price || 0
            } ${pricing.currency ||
            "USD"
            }`;
    }

    function getBrandingUrl(
        bot: BotItem,
        type: BrandingType
    ) {
        const branding =
            bot.branding?.[
            type
            ];

        if (!branding)
            return "";

        if (
            branding.path &&
            branding.path.startsWith(
                "/api/"
            )
        ) {
            return branding.path;
        }

        if (
            branding.path ||
            branding.fileName
        ) {
            return `/api/products/branding?productId=${encodeURIComponent(
                bot.id
            )}&type=${type}`;
        }

        return "";
    }

    function hasBranding(
        bot: BotItem,
        type: BrandingType
    ) {
        const item =
            bot.branding?.[
            type
            ];

        return Boolean(
            item?.path ||
            item?.fileName
        );
    }

    return (
        <AdminShell title="Bots & Products" subtitle="Manage trading products, EAs, and indicators">
            <div className="mb-6 flex items-center justify-end gap-3">
                <button
                    onClick={() => window.location.reload()}
                    className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                >
                    <RefreshCw size={16} />
                    Refresh
                </button>

                <Link
                    href="/admin/bots/new"
                    className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-background hover:bg-emerald-400"
                >
                    <Plus size={17} />
                    Add Product
                </Link>
            </div>

            {/* STATS */}
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

                <StatCard
                    title="Total Products"
                    value={
                        bots.length
                    }
                />

                <StatCard
                    title="Published"
                    value={
                        bots.filter(
                            (bot) =>
                                bot.status ===
                                "published"
                        ).length
                    }
                />

                <StatCard
                    title="Drafts"
                    value={
                        bots.filter(
                            (bot) =>
                                bot.status ===
                                "draft"
                        ).length
                    }
                />

                <StatCard
                    title="Free Products"
                    value={
                        bots.filter(
                            (bot) =>
                                bot.pricing
                                    ?.type ===
                                "free"
                        ).length
                    }
                />

            </div>

            {/* PRODUCTS */}
            <section className="overflow-hidden rounded-2xl border border-border bg-muted/30">

                {/* SECTION HEADER */}
                <div className="border-b border-border px-6 py-5">

                    <div className="flex items-center gap-3">

                        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-muted/50">
                            <Layers3
                                size={18}
                            />
                        </div>

                        <div>

                            <h2 className="font-medium">
                                Products
                            </h2>

                            <p className="mt-1 text-xs text-muted-foreground">
                                All products stored in
                                Firebase Realtime Database.
                            </p>

                        </div>

                    </div>

                </div>

                {/* LOADING */}
                {loading ? (

                    <div className="p-12 text-center text-sm text-muted-foreground">
                        Loading products...
                    </div>

                ) : bots.length === 0 ? (

                    <div className="p-12 text-center">

                        <Bot
                            size={35}
                            className="mx-auto text-muted-foreground"
                        />

                        <h3 className="mt-4 text-sm font-medium">
                            No products yet
                        </h3>

                        <p className="mt-2 text-xs text-muted-foreground">
                            Create your first EA or indicator.
                        </p>

                        <Link
                            href="/admin/bots/new"
                            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-medium text-background"
                        >
                            <Plus
                                size={16}
                            />

                            Add Product
                        </Link>

                    </div>

                ) : (

                    <div className="overflow-x-auto">

                        <table className="w-full text-left">

                            <thead className="border-b border-border text-xs text-muted-foreground">

                                <tr>

                                    <th className="px-6 py-4 font-medium">
                                        Product
                                    </th>

                                    <th className="px-6 py-4 font-medium">
                                        Type
                                    </th>

                                    <th className="px-6 py-4 font-medium">
                                        Platform
                                    </th>

                                    <th className="px-6 py-4 font-medium">
                                        Price
                                    </th>

                                    <th className="px-6 py-4 font-medium">
                                        Status
                                    </th>

                                    <th className="px-6 py-4 font-medium text-right">
                                        Actions
                                    </th>

                                </tr>

                            </thead>

                            <tbody>

                                {bots.map(
                                    (
                                        bot
                                    ) => {

                                        const iconUrl =
                                            getBrandingUrl(
                                                bot,
                                                "icon"
                                            );

                                        const logoUrl =
                                            getBrandingUrl(
                                                bot,
                                                "logo"
                                            );

                                        const bannerUrl =
                                            getBrandingUrl(
                                                bot,
                                                "banner"
                                            );

                                        const hasIcon =
                                            hasBranding(
                                                bot,
                                                "icon"
                                            );

                                        const hasLogo =
                                            hasBranding(
                                                bot,
                                                "logo"
                                            );

                                        const hasBanner =
                                            hasBranding(
                                                bot,
                                                "banner"
                                            );

                                        return (
                                            <tr
                                                key={
                                                    bot.id
                                                }
                                                className="group border-b border-border/60 last:border-0 hover:bg-muted/40"
                                            >

                                                {/* PRODUCT */}
                                                <td className="px-6 py-5">

                                                    <div className="flex min-w-[360px] items-center gap-4">

                                                        {/* VISUAL */}
                                                        <div className="relative h-[76px] w-[120px] shrink-0 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">

                                                            {/* BANNER */}
                                                            {hasBanner &&
                                                                bannerUrl ? (
                                                                <img
                                                                    src={
                                                                        bannerUrl
                                                                    }
                                                                    alt={`${bot.name} banner`}
                                                                    className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
                                                                    loading="lazy"
                                                                />
                                                            ) : (
                                                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_55%),linear-gradient(135deg,#18181b,#09090b)]">
                                                                    <div className="absolute inset-0 flex items-center justify-center opacity-20">
                                                                        <Bot
                                                                            size={
                                                                                32
                                                                            }
                                                                        />
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* OVERLAY */}
                                                            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-foreground/10" />

                                                            {/* ICON */}
                                                            <div className="absolute bottom-2 left-2 flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-foreground/30 bg-background/75 shadow-xl backdrop-blur-xl">

                                                                {hasIcon &&
                                                                    iconUrl ? (
                                                                    <img
                                                                        src={
                                                                            iconUrl
                                                                        }
                                                                        alt={`${bot.name} icon`}
                                                                        className="h-full w-full object-cover"
                                                                        loading="lazy"
                                                                    />
                                                                ) : (
                                                                    <Bot
                                                                        size={
                                                                            19
                                                                        }
                                                                        className="text-foreground"
                                                                    />
                                                                )}

                                                            </div>

                                                            {/* PLATFORM */}
                                                            <div className="absolute right-2 top-2 rounded-md border border-border bg-foreground/65 px-1.5 py-0.5 text-[9px] font-medium text-foreground backdrop-blur-md">
                                                                {bot.platform ||
                                                                    "—"}
                                                            </div>

                                                        </div>

                                                        {/* INFORMATION */}
                                                        <div className="min-w-0">

                                                            <div className="flex items-center gap-2">

                                                                <p className="truncate text-sm font-semibold">
                                                                    {
                                                                        bot.name
                                                                    }
                                                                </p>

                                                            </div>

                                                            <p className="mt-1 truncate text-xs text-muted-foreground">
                                                                {
                                                                    bot.slug
                                                                }
                                                            </p>

                                                            {/* LOGO */}
                                                            {hasLogo &&
                                                                logoUrl ? (
                                                                <div className="mt-2 inline-flex max-w-[150px] items-center rounded-md border border-border bg-foreground/[0.035] px-1.5 py-1">

                                                                    <img
                                                                        src={
                                                                            logoUrl
                                                                        }
                                                                        alt={`${bot.name} logo`}
                                                                        className="block max-h-6 max-w-[135px] object-contain"
                                                                        loading="lazy"
                                                                    />

                                                                </div>
                                                            ) : (
                                                                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                                                    <ImageIcon
                                                                        size={
                                                                            11
                                                                        }
                                                                    />
                                                                    No logo
                                                                </div>
                                                            )}

                                                        </div>

                                                    </div>

                                                </td>

                                                {/* TYPE */}
                                                <td className="px-6 py-5">

                                                    <div className="flex flex-col gap-1">

                                                        <p className="text-sm">
                                                            {formatProductType(
                                                                bot.productType
                                                            )}
                                                        </p>

                                                        {bot.version && (
                                                            <p className="text-[11px] text-muted-foreground">
                                                                v
                                                                {
                                                                    bot.version
                                                                }
                                                            </p>
                                                        )}

                                                    </div>

                                                </td>

                                                {/* PLATFORM */}
                                                <td className="px-6 py-5">

                                                    <div>

                                                        <span className="rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-xs">
                                                            {
                                                                bot.platform ||
                                                                "—"
                                                            }
                                                        </span>

                                                        {bot.symbol && (
                                                            <p className="mt-2 text-xs text-muted-foreground">
                                                                {
                                                                    bot.symbol
                                                                }

                                                                {" · "}

                                                                {
                                                                    bot.timeframe ||
                                                                    "—"
                                                                }
                                                            </p>
                                                        )}

                                                    </div>

                                                </td>

                                                {/* PRICE */}
                                                <td className="px-6 py-5">

                                                    <p className="text-sm font-medium">
                                                        {formatPricing(
                                                            bot
                                                        )}
                                                    </p>

                                                </td>

                                                {/* STATUS */}
                                                <td className="px-6 py-5">

                                                    <button
                                                        onClick={() =>
                                                            toggleStatus(
                                                                bot
                                                            )
                                                        }
                                                        className={`rounded-lg px-2.5 py-1 text-xs transition ${bot.status ===
                                                            "published"
                                                            ? "bg-muted text-foreground hover:bg-foreground/15"
                                                            : "bg-card text-muted-foreground hover:bg-border"
                                                            }`}
                                                    >
                                                        {
                                                            bot.status ||
                                                            "draft"
                                                        }
                                                    </button>

                                                </td>

                                                {/* ACTIONS */}
                                                <td className="px-6 py-5">

                                                    <div className="flex justify-end gap-2">

                                                        {bot.status ===
                                                            "published" && (
                                                                <Link
                                                                    href={`/marketplace/${bot.slug}`}
                                                                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border transition hover:bg-muted/70"
                                                                    title="View Product"
                                                                >
                                                                    <ExternalLink
                                                                        size={
                                                                            15
                                                                        }
                                                                    />
                                                                </Link>
                                                            )}

                                                        <button
                                                            onClick={() =>
                                                                router.push(
                                                                    `/admin/bots/${bot.id}/edit`
                                                                )
                                                            }
                                                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border transition hover:bg-muted/70"
                                                            title="Edit Product"
                                                        >
                                                            <Pencil
                                                                size={
                                                                    15
                                                                }
                                                            />
                                                        </button>

                                                        <button
                                                            onClick={() =>
                                                                deleteBot(
                                                                    bot
                                                                )
                                                            }
                                                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/10 text-red-500 transition hover:bg-red-500/10"
                                                            title="Delete Product"
                                                        >
                                                            <Trash2
                                                                size={
                                                                    15
                                                                }
                                                            />
                                                        </button>

                                                    </div>

                                                </td>

                                            </tr>
                                        );
                                    }
                                )}

                            </tbody>

                        </table>

                    </div>
                )}

            </section>

            {/* BRANDING SUMMARY */}
            <div className="mt-6 grid gap-4 md:grid-cols-3">

                <BrandingInfo
                    icon={
                        <Bot
                            size={16}
                        />
                    }
                    title="Product Icon"
                    description="Square visual used to identify the product."
                />

                <BrandingInfo
                    icon={
                        <ImageIcon
                            size={16}
                        />
                    }
                    title="Product Logo"
                    description="Brand identity displayed beside the product."
                />

                <BrandingInfo
                    icon={
                        <Layers3
                            size={16}
                        />
                    }
                    title="Product Banner"
                    description="Wide visual used across marketplace product surfaces."
                />

            </div>

            {/* RISK */}
            <div className="mt-6 rounded-2xl border border-border bg-muted/30 p-5">

                <p className="text-xs leading-6 text-muted-foreground">
                    Trading involves substantial risk.
                    Historical and backtested performance
                    does not guarantee future results.
                    Product statistics should only be
                    published when they can be verified.
                </p>
            </div>

        </AdminShell>
    );
}

function StatCard({
    title,
    value,
}: {
    title: string;
    value: number;
}) {
    return (
        <div className="rounded-2xl border border-border bg-muted/30 p-5">

            <p className="text-xs text-muted-foreground">
                {title}
            </p>

            <p className="mt-2 text-2xl font-semibold">
                {value}
            </p>

        </div>
    );
}

function BrandingInfo({
    icon,
    title,
    description,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
}) {
    return (
        <div className="rounded-2xl border border-border bg-muted/30 p-4">

            <div className="flex items-center gap-3">

                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/50">
                    {icon}
                </div>

                <div>

                    <p className="text-sm font-medium">
                        {title}
                    </p>

                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {description}
                    </p>

                </div>

            </div>

        </div>
    );
}
