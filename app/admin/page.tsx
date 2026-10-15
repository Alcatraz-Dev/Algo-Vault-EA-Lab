"use client";

import {
    ArrowUpRight,
    Activity,
    BarChart3,
    Brain,
    Bot,
    DollarSign,
    GitBranch,
    KeyRound,
    Plus,
    RefreshCw,
    ShoppingCart,
    Sparkles,
    Users,
} from "lucide-react";

import Link from "next/link";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";
import BarCompareChart from "@/components/charts/BarCompareChart";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";

type DashboardStats = {
    totalBots: number;
    publishedBots: number;
    totalUsers: number;
    totalSales: number;
    totalLicenses: number;
    activeLicenses: number;
    expiredLicenses: number;
    revokedLicenses: number;
    revenueThisMonth: number;
    totalRevenue: number;
};

type RecentBot = {
    id: string;
    name: string;
    slug: string;
    market: string;
    timeframe: string;
    platform: string;
    productType: string;
    type: string;
    status: string;
    createdAt: number;
    updatedAt: number;
};

type RecentOrder = {
    id: string;
    userId: string;
    email: string;
    productId: string;
    productName: string;
    amount: number;
    currency: string;
    paidAt: number;
    licenseId: string;
};

type DashboardResponse = {
    stats: DashboardStats;
    recentBots: RecentBot[];
    recentOrders: RecentOrder[];
    revenueSeries: { label: string; value: number }[];
};

function formatCurrency(
    amount: number,
    currency = "USD"
) {
    return new Intl.NumberFormat(
        "en-US",
        {
            style: "currency",
            currency,
        }
    ).format(amount);
}

function formatDate(timestamp: number) {
    if (!timestamp) {
        return "—";
    }

    return new Intl.DateTimeFormat(
        "en-US",
        {
            dateStyle: "medium",
        }
    ).format(new Date(timestamp));
}

export default function AdminPage() {
    const [data, setData] =
        useState<DashboardResponse | null>(
            null
        );

    const [loading, setLoading] =
        useState(true);

    const [refreshing, setRefreshing] =
        useState(false);

    const [error, setError] =
        useState("");

    async function loadDashboard(
        showRefresh = false
    ) {
        try {
            if (showRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            setError("");

            const user = auth.currentUser;

            if (!user) {
                throw new Error(
                  "You must be logged in."
                );
            }

            const token =
                await user.getIdToken();

            const response =
                await fetch(
                    "/api/admin/dashboard",
                    {
                        method: "GET",
                        headers: {
                            Authorization:
                                `Bearer ${token}`,
                        },
                        cache: "no-store",
                    }
                );

            const result =
                await response.json();

            if (!response.ok) {
                throw new Error(
                    result.error ||
                    "Failed to load dashboard."
                );
            }

            setData(result);
        } catch (err) {
            console.error(
                "DASHBOARD LOAD ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to load dashboard."
            );
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    useEffect(() => {
        const unsubscribe =
            onAuthStateChanged(
                auth,
                (user) => {
                    if (!user) {
                        setLoading(false);
                        setError(
                          "You must be logged in."
                        );
                        return;
                    }

                    loadDashboard();
                }
            );

        return () =>
            unsubscribe();
    }, []);

    const stats = data?.stats;

    const statCards = [
        {
            title: "Total Bots",
            value:
                stats?.totalBots ?? 0,
            change:
                `${stats?.publishedBots ?? 0} published`,
            icon: Bot,
            href: "/admin/bots",
        },
        {
            title: "Users",
            value:
                stats?.totalUsers ?? 0,
            change:
                "Registered users",
            icon: Users,
            href: "/admin/users",
        },
        {
            title: "Sales",
            value:
                stats?.totalSales ?? 0,
            change:
                formatCurrency(
                    stats?.revenueThisMonth ??
                    0
                ) + " this month",
            icon: ShoppingCart,
            href: "/admin/orders",
        },
        {
            title: "Active Licenses",
            value:
                stats?.activeLicenses ?? 0,
            change:
                `${stats?.totalLicenses ?? 0} total licenses`,
            icon: KeyRound,
            href: "/admin/orders",
        },
    ];

    return (
        <AdminShell title="Dashboard" subtitle="Overview & System Analytics">
            <div className="mb-6 flex items-center justify-end gap-3">
                <button
                    onClick={() => loadDashboard(true)}
                    disabled={refreshing || loading}
                    className="flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-4 text-xs font-medium text-muted-foreground shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-colors hover:bg-muted/70 hover:text-foreground disabled:opacity-50"
                >
                    <RefreshCw
                        size={16}
                        className={refreshing ? "animate-spin" : ""}
                    />
                    Refresh
                </button>

                <Link
                    href="/admin/bots/new"
                    className="flex h-8 items-center gap-2 rounded-lg bg-black px-4 text-xs font-extrabold text-white shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-colors hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-100"
                >
                    <Plus size={17} />
                    Add Bot
                </Link>
            </div>

                        {/* Error */}
                        {error && (
                            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-negative/30 bg-negative-muted p-4 text-sm text-negative shadow-[0_1px_2px_rgb(0_0_0/0.05)]">
                                <span>{error}</span>
                                <button
                                    onClick={() => loadDashboard(true)}
                                    disabled={refreshing || loading}
                                    className="flex h-8 items-center gap-2 rounded-lg border border-negative/30 bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                                >
                                    <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                                    Retry
                                </button>
                            </div>
                        )}

                        {/* Stats */}
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

                            {statCards.map(
                                (stat) => {
                                    const Icon =
                                        stat.icon;

                                    return (
                                        <Link
                                            key={
                                                stat.title
                                            }
                                            href={
                                                stat.href
                                            }
                                            className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-colors hover:bg-muted/50"
                                        >

                                            <div className="flex items-center justify-between">

                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                                    <Icon
                                                        size={
                                                            18
                                                        }
                                                    />
                                                </div>

                                                <ArrowUpRight
                                                    size={
                                                        16
                                                    }
                                                    className="text-muted-foreground"
                                                />

                                            </div>

                                            <p className="mt-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                                                {
                                                    stat.title
                                                }
                                            </p>

                                            <p className="mt-1 font-numeric text-base font-semibold font-semibold text-foreground">

                                                {loading
                                                    ? "—"
                                                    : stat.value}

                                            </p>

                                            <div className="mt-2">
                                                <Badge variant="outline" className="font-numeric font-normal">
                                                    {
                                                        stat.change
                                                    }
                                                </Badge>
                                            </div>

                                        </Link>
                                    );
                                }
                            )}

                        </div>

                        {/* Quick Access */}
                        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <Link href="/ai-copilot" className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-colors hover:bg-muted/50">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Brain size={20} /></div>
                                <div><p className="text-sm font-semibold text-foreground">AI Copilot</p><p className="text-xs text-muted-foreground">Market analysis & trading insights</p></div>
                            </Link>
                            <Link href="/scanner" className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-colors hover:bg-muted/50">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Activity size={20} /></div>
                                <div><p className="text-sm font-semibold text-foreground">Market Scanner</p><p className="text-xs text-muted-foreground">Scan assets across markets</p></div>
                            </Link>
                             <Link href="/insights" className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-colors hover:bg-muted/50">
                                 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Sparkles size={20} /></div>
                                 <div><p className="text-sm font-semibold text-foreground">AI Insights</p><p className="text-xs text-muted-foreground">Intelligence & trend analysis</p></div>
                             </Link>
                             <Link href="/admin/workflows" className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-colors hover:bg-muted/50">
                                 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"><GitBranch size={20} /></div>
                                 <div><p className="text-sm font-semibold text-foreground">Workflow Studio</p><p className="text-xs text-muted-foreground">Monitor runs, manage templates, kill switch</p></div>
                             </Link>
                         </div>

                        {/* Revenue + License overview */}
                        <div className="mt-6 grid gap-6 lg:grid-cols-2">

                            <div className="rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_rgb(0_0_0/0.05)]">

                                <div className="flex items-start justify-between">

                                    <div>
                                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                                            Revenue
                                        </p>

                                        <p className="mt-2 font-numeric text-lg font-semibold font-semibold text-foreground">
                                            {loading
                                                ? "—"
                                                : formatCurrency(
                                                    stats?.revenueThisMonth ??
                                                    0
                                                )}
                                        </p>

                                        <p className="mt-2 text-xs text-muted-foreground">
                                            This month
                                        </p>
                                    </div>

                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                        <DollarSign
                                            size={
                                                18
                                            }
                                        />
                                    </div>

                                </div>

                                <div className="mt-6 flex items-center justify-between border-t border-border pt-4">

                                    <span className="text-xs text-muted-foreground">
                                        Total revenue
                                    </span>

                                    <span className="font-numeric text-sm font-medium text-foreground">
                                        {loading
                                            ? "—"
                                            : formatCurrency(
                                                stats?.totalRevenue ??
                                                0
                                            )}
                                    </span>

                                </div>

                                {/* Revenue trend */}
                                <div className="mt-6">
                                    {loading ? (
                                        <div className="h-[180px] animate-pulse rounded-lg bg-muted/40" />
                                    ) : (
                                        <BarCompareChart
                                            data={data?.revenueSeries ?? []}
                                            xKey="label"
                                            valueKey="value"
                                            height={180}
                                            colorVar="var(--chart-1)"
                                            formatValue={(value) =>
                                                formatCurrency(value)
                                            }
                                        />
                                    )}
                                </div>

                            </div>

                            <div className="rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_rgb(0_0_0/0.05)]">

                                <div className="flex items-start justify-between">

                                    <div>
                                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                                            Licenses
                                        </p>

                                        <p className="mt-2 font-numeric text-lg font-semibold font-semibold text-foreground">
                                            {loading
                                                ? "—"
                                                : stats?.activeLicenses ??
                                                0}
                                        </p>

                                        <p className="mt-2 text-xs text-muted-foreground">
                                            Active licenses
                                        </p>
                                    </div>

                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                        <KeyRound
                                            size={
                                                18
                                            }
                                        />
                                    </div>

                                </div>

                                <div className="mt-6 flex items-center gap-5 border-t border-border pt-4">

                                    <LicenseStat
                                        label="Total"
                                        value={
                                            stats?.totalLicenses ??
                                            0
                                        }
                                    />

                                    <LicenseStat
                                        label="Expired"
                                        value={
                                            stats?.expiredLicenses ??
                                            0
                                        }
                                    />

                                    <LicenseStat
                                        label="Revoked"
                                        value={
                                            stats?.revokedLicenses ??
                                            0
                                        }
                                    />

                                </div>

                            </div>

                        </div>

                        {/* Recent Bots */}
                        <div className="mt-10 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)]">

                            <div className="flex items-center justify-between border-b border-border p-5">

                                <div>
                                    <h2 className="text-sm font-semibold text-foreground">
                                        Recent Bots
                                    </h2>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Latest products in your marketplace
                                    </p>
                                </div>

                                <Link
                                    href="/admin/bots"
                                    className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    View all
                                </Link>

                            </div>

                            <div className="divide-y divide-border">

                                {loading ? (
                                    <div className="space-y-3 p-5" aria-label="Loading bots">
                                        {[0, 1, 2].map((i) => (
                                            <div key={i} className="flex items-center gap-4">
                                                <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
                                                <div className="flex-1 space-y-2">
                                                    <div className="h-3 w-1/3 animate-pulse rounded-full bg-muted" />
                                                    <div className="h-3 w-1/4 animate-pulse rounded-full bg-muted" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : data?.recentBots.length ? (
                                    data.recentBots.map(
                                        (bot) => (
                                            <div
                                                key={
                                                    bot.id
                                                }
                                                className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between"
                                            >

                                                <div className="flex items-center gap-4">

                                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                                        <Bot
                                                            size={
                                                                18
                                                            }
                                                        />
                                                    </div>

                                                    <div>
                                                        <p className="text-sm font-medium">
                                                            {
                                                                bot.name
                                                            }
                                                        </p>

                                                        <p className="mt-1 text-xs text-muted-foreground">
                                                            {
                                                                bot.market
                                                            }{" "}
                                                            ·{" "}
                                                            {
                                                                bot.timeframe
                                                            }{" "}
                                                            ·{" "}
                                                            {
                                                                bot.platform
                                                            }
                                                        </p>
                                                    </div>

                                                </div>

                                                <div className="flex items-center gap-3">

                                                    <Badge variant="outline">
                                                        {
                                                            bot.type
                                                        }
                                                    </Badge>

                                                    <StatusBadge
                                                        tone={
                                                            bot.status ===
                                                            "published"
                                                                ? "live"
                                                                : "neutral"
                                                        }
                                                        label={bot.status}
                                                    />

                                                    <Link
                                                        href={`/admin/bots`}
                                                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/70"
                                                    >
                                                        Edit
                                                    </Link>

                                                </div>

                                            </div>
                                        )
                                    )
                                ) : (
                                    <div className="p-8 text-center">
                                        <p className="text-sm text-muted-foreground">No bots found.</p>
                                        <Link
                                            href="/admin/bots/new"
                                            className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg bg-black px-4 text-xs font-semibold text-white transition-colors hover:bg-black/80"
                                        >
                                            <Plus size={14} />
                                            Add Bot
                                        </Link>
                                    </div>
                                )}

                            </div>

                        </div>

                        {/* Recent Orders */}
                        <div className="mt-6 rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)]">

                            <div className="flex items-center justify-between border-b border-border p-5">

                                <div>
                                    <h2 className="text-sm font-semibold text-foreground">
                                        Recent Sales
                                    </h2>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Latest completed purchases
                                    </p>
                                </div>

                                <Link
                                    href="/admin/orders"
                                    className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                                >
                                    View all
                                </Link>

                            </div>

                            <div className="divide-y divide-border">

                                {loading ? (
                                    <div className="space-y-3 p-5" aria-label="Loading sales">
                                        {[0, 1, 2].map((i) => (
                                            <div key={i} className="flex items-center gap-4">
                                                <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
                                                <div className="flex-1 space-y-2">
                                                    <div className="h-3 w-1/3 animate-pulse rounded-full bg-muted" />
                                                    <div className="h-3 w-1/4 animate-pulse rounded-full bg-muted" />
                                                </div>
                                                <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                                            </div>
                                        ))}
                                    </div>
                                ) : data?.recentOrders.length ? (
                                    data.recentOrders.map(
                                        (order) => (
                                            <div
                                                key={
                                                    order.id
                                                }
                                                className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between"
                                            >

                                                <div className="flex items-center gap-4">

                                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                                        <ShoppingCart
                                                            size={
                                                                17
                                                            }
                                                        />
                                                    </div>

                                                    <div>
                                                        <p className="text-sm font-medium">
                                                            {
                                                                order.productName
                                                            }
                                                        </p>

                                                        <p className="mt-1 text-xs text-muted-foreground">
                                                            {
                                                                order.email ||
                                                                order.userId
                                                            }
                                                        </p>
                                                    </div>

                                                </div>

                                                <div className="flex items-center gap-5">

                                                    <div className="text-right">
                                                        <p className="font-numeric text-sm font-medium text-foreground">
                                                            {formatCurrency(
                                                                order.amount,
                                                                order.currency
                                                            )}
                                                        </p>

                                                        <p className="mt-1 font-numeric text-xs text-muted-foreground">
                                                            {formatDate(
                                                                order.paidAt
                                                            )}
                                                        </p>
                                                    </div>

                                                    <StatusBadge tone="positive" label="Paid" />

                                                </div>

                                            </div>
                                        )
                                    )
                                ) : (
                                    <div className="p-8 text-center">
                                        <p className="text-sm text-muted-foreground">No completed sales yet.</p>
                                        <Link
                                            href="/admin/orders"
                                            className="mt-3 inline-flex h-8 items-center rounded-lg border border-border px-4 text-xs font-medium transition-colors hover:bg-muted/70"
                                        >
                                            View orders
                                        </Link>
                                    </div>
                                )}

                            </div>

                    </div>
        </AdminShell>
    );
}

function LicenseStat({
    label,
    value,
}: {
    label: string;
    value: number;
}) {
    return (
        <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {label}
            </p>

            <p className="mt-1 font-numeric text-sm font-medium text-foreground">
                {value}
            </p>
        </div>
    );
}