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
                    className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground disabled:opacity-50"
                >
                    <RefreshCw
                        size={16}
                        className={refreshing ? "animate-spin" : ""}
                    />
                    Refresh
                </button>

                <Link
                    href="/admin/bots/new"
                    className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-background hover:bg-emerald-400"
                >
                    <Plus size={17} />
                    Add Bot
                </Link>
            </div>

                        {/* Error */}
                        {error && (
                            <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600">
                                {error}
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
                                            className="rounded-2xl border border-border bg-muted/30 p-5 transition hover:border-border hover:bg-muted/50"
                                        >

                                            <div className="flex items-center justify-between">

                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50">
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

                                            <p className="mt-5 text-sm text-muted-foreground">
                                                {
                                                    stat.title
                                                }
                                            </p>

                                            <p className="mt-1 text-2xl font-semibold">

                                                {loading
                                                    ? "—"
                                                    : stat.value}

                                            </p>

                                            <p className="mt-2 text-xs text-muted-foreground">
                                                {
                                                    stat.change
                                                }
                                            </p>

                                        </Link>
                                    );
                                }
                            )}

                        </div>

                        {/* Quick Access */}
                        <div className="mt-6 grid gap-4 sm:grid-cols-3">
                            <Link href="/ai-copilot" className="flex items-center gap-4 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 transition hover:bg-violet-500/10">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/20"><Brain size={20} className="text-violet-400" /></div>
                                <div><p className="text-sm font-semibold text-foreground">AI Copilot</p><p className="text-xs text-muted-foreground">Market analysis & trading insights</p></div>
                            </Link>
                            <Link href="/scanner" className="flex items-center gap-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 transition hover:bg-emerald-500/10">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20"><Activity size={20} className="text-emerald-400" /></div>
                                <div><p className="text-sm font-semibold text-foreground">Market Scanner</p><p className="text-xs text-muted-foreground">Scan assets across markets</p></div>
                            </Link>
                             <Link href="/insights" className="flex items-center gap-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 transition hover:bg-sky-500/10">
                                 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/20"><Sparkles size={20} className="text-sky-400" /></div>
                                 <div><p className="text-sm font-semibold text-foreground">AI Insights</p><p className="text-xs text-muted-foreground">Intelligence & trend analysis</p></div>
                             </Link>
                             <Link href="/admin/workflows" className="flex items-center gap-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 transition hover:bg-amber-500/10">
                                 <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/20"><GitBranch size={20} className="text-amber-400" /></div>
                                 <div><p className="text-sm font-semibold text-foreground">Workflow Studio</p><p className="text-xs text-muted-foreground">Monitor runs, manage templates, kill switch</p></div>
                             </Link>
                         </div>

                        {/* Revenue + License overview */}
                        <div className="mt-6 grid gap-6 lg:grid-cols-2">

                            <div className="rounded-2xl border border-border bg-muted/30 p-6">

                                <div className="flex items-start justify-between">

                                    <div>
                                        <p className="text-sm text-muted-foreground">
                                            Revenue
                                        </p>

                                        <p className="mt-2 text-3xl font-semibold">
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

                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50">
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

                                    <span className="text-sm font-medium">
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
                                        <div className="h-[180px] animate-pulse rounded-xl bg-muted/40" />
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

                            <div className="rounded-2xl border border-border bg-muted/30 p-6">

                                <div className="flex items-start justify-between">

                                    <div>
                                        <p className="text-sm text-muted-foreground">
                                            Licenses
                                        </p>

                                        <p className="mt-2 text-3xl font-semibold">
                                            {loading
                                                ? "—"
                                                : stats?.activeLicenses ??
                                                0}
                                        </p>

                                        <p className="mt-2 text-xs text-muted-foreground">
                                            Active licenses
                                        </p>
                                    </div>

                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50">
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
                        <div className="mt-10 rounded-2xl border border-border bg-muted/30">

                            <div className="flex items-center justify-between border-b border-border p-5">

                                <div>
                                    <h2 className="font-medium">
                                        Recent Bots
                                    </h2>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Latest products in your marketplace
                                    </p>
                                </div>

                                <Link
                                    href="/admin/bots"
                                    className="text-sm text-muted-foreground hover:text-foreground"
                                >
                                    View all
                                </Link>

                            </div>

                            <div className="divide-y divide-border">

                                {loading ? (
                                    <div className="p-8 text-center text-sm text-muted-foreground">
                                        Loading bots...
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

                                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50">
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

                                                    <span className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
                                                        {
                                                            bot.type
                                                        }
                                                    </span>

                                                    <span
                                                        className={`rounded-lg px-3 py-1.5 text-xs ${bot.status ===
                                                            "published"
                                                            ? "bg-muted text-foreground"
                                                            : "bg-muted/50 text-muted-foreground"
                                                            }`}
                                                    >
                                                        {
                                                            bot.status
                                                        }
                                                    </span>

                                                    <Link
                                                        href={`/admin/bots`}
                                                        className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted/70"
                                                    >
                                                        Edit
                                                    </Link>

                                                </div>

                                            </div>
                                        )
                                    )
                                ) : (
                                    <div className="p-8 text-center text-sm text-muted-foreground">
                                        No bots found.
                                    </div>
                                )}

                            </div>

                        </div>

                        {/* Recent Orders */}
                        <div className="mt-6 rounded-2xl border border-border bg-muted/30">

                            <div className="flex items-center justify-between border-b border-border p-5">

                                <div>
                                    <h2 className="font-medium">
                                        Recent Sales
                                    </h2>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Latest completed purchases
                                    </p>
                                </div>

                                <Link
                                    href="/admin/orders"
                                    className="text-sm text-muted-foreground hover:text-foreground"
                                >
                                    View all
                                </Link>

                            </div>

                            <div className="divide-y divide-border">

                                {loading ? (
                                    <div className="p-8 text-center text-sm text-muted-foreground">
                                        Loading sales...
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

                                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50">
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
                                                        <p className="text-sm font-medium">
                                                            {formatCurrency(
                                                                order.amount,
                                                                order.currency
                                                            )}
                                                        </p>

                                                        <p className="mt-1 text-xs text-muted-foreground">
                                                            {formatDate(
                                                                order.paidAt
                                                            )}
                                                        </p>
                                                    </div>

                                                    <span className="rounded-lg bg-muted px-3 py-1.5 text-xs text-foreground">
                                                        Paid
                                                    </span>

                                                </div>

                                            </div>
                                        )
                                    )
                                ) : (
                                    <div className="p-8 text-center text-sm text-muted-foreground">
                                        No completed sales yet.
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
            <p className="text-xs text-muted-foreground">
                {label}
            </p>

            <p className="mt-1 text-sm font-medium">
                {value}
            </p>
        </div>
    );
}