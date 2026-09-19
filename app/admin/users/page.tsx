"use client";

import {
    ArrowUpRight,
    Bot,
    ChevronDown,
    LayoutDashboard,
    Activity,
    Download,
    ShoppingCart,
    Users,
    DollarSign,
    Settings,
    RefreshCw,
    Search,
    ShieldCheck,
    Code2,
    UserRound,
} from "lucide-react";

import Link from "next/link";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";

type AdminUser = {
    id: string;
    email: string;
    displayName: string;
    role: string;
    photoURL: string;
    createdAt: number;
    totalOrders: number;
    paidOrders: number;
    totalSpent: number;
};

type UsersResponse = {
    users: AdminUser[];
    stats: {
        totalUsers: number;
        admins: number;
        developers: number;
        customers: number;
        totalRevenue: number;
    };
};

function formatCurrency(amount: number) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format(amount);
}

function formatDate(timestamp: number) {
    if (!timestamp) {
        return "—";
    }

    return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
    }).format(new Date(timestamp));
}

function roleLabel(role: string) {
    switch (role) {
        case "admin":
            return "Admin";

        case "developer":
            return "Developer";

        default:
            return "Customer";
    }
}

export default function AdminUsersPage() {
    const [data, setData] =
        useState<UsersResponse | null>(null);

    const [loading, setLoading] =
        useState(true);

    const [refreshing, setRefreshing] =
        useState(false);

    const [error, setError] =
        useState("");

    const [search, setSearch] =
        useState("");

    const [roleFilter, setRoleFilter] =
        useState("all");

    async function loadUsers(refresh = false) {
        try {
            if (refresh) {
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

            const response = await fetch(
                "/api/admin/users",
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
                    "Failed to load users."
                );
            }

            setData(result);
        } catch (err) {
            console.error(
                "USERS LOAD ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to load users."
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

                    loadUsers();
                }
            );

        return () =>
            unsubscribe();
    }, []);

    const filteredUsers =
        (data?.users || []).filter(
            (user) => {
                const searchValue =
                    search
                        .toLowerCase()
                        .trim();

                const matchesSearch =
                    !searchValue ||
                    user.email
                        .toLowerCase()
                        .includes(
                            searchValue
                        ) ||
                    user.displayName
                        .toLowerCase()
                        .includes(
                            searchValue
                        ) ||
                    user.id
                        .toLowerCase()
                        .includes(
                            searchValue
                        );

                const matchesRole =
                    roleFilter ===
                    "all" ||
                    user.role ===
                    roleFilter;

                return (
                    matchesSearch &&
                    matchesRole
                );
            }
        );

    return (
        <AdminShell title="Users & Customers" subtitle="Manage marketplace users, roles, and accounts">
            <div className="mb-6 flex items-center justify-end">
                <button
                    onClick={() => loadUsers(true)}
                    disabled={loading || refreshing}
                    className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground disabled:opacity-50"
                >
                    <RefreshCw
                        size={16}
                        className={refreshing ? "animate-spin" : ""}
                    />
                    Refresh
                </button>
            </div>

                        {/* Error */}
                        {error && (
                            <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600">
                                {error}
                            </div>
                        )}

                        {/* Stats */}
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

                            <StatCard
                                title="Total Users"
                                value={
                                    data?.stats
                                        .totalUsers ??
                                    0
                                }
                                icon={Users}
                                subtitle="Registered accounts"
                                loading={loading}
                            />

                            <StatCard
                                title="Customers"
                                value={
                                    data?.stats
                                        .customers ??
                                    0
                                }
                                icon={UserRound}
                                subtitle="Marketplace customers"
                                loading={loading}
                            />

                            <StatCard
                                title="Developers"
                                value={
                                    data?.stats
                                        .developers ??
                                    0
                                }
                                icon={Code2}
                                subtitle="Developer accounts"
                                loading={loading}
                            />

                            <StatCard
                                title="Customer Revenue"
                                value={formatCurrency(
                                    data?.stats
                                        .totalRevenue ??
                                    0
                                )}
                                icon={DollarSign}
                                subtitle="Paid orders"
                                loading={loading}
                            />

                        </div>

                        {/* Filters */}
                        <div className="mt-8 flex flex-col gap-3 md:flex-row">

                            <div className="relative flex-1">

                                <Search
                                    size={17}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                                />

                                <input
                                    value={search}
                                    onChange={(
                                        event
                                    ) =>
                                        setSearch(
                                            event.target
                                                .value
                                        )
                                    }
                                    placeholder="Search by name, email or user ID..."
                                    className="h-11 w-full rounded-xl border border-border bg-muted/30 pl-10 pr-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border"
                                />

                            </div>

                            <div className="relative">

                                <select
                                    value={
                                        roleFilter
                                    }
                                    onChange={(
                                        event
                                    ) =>
                                        setRoleFilter(
                                            event.target
                                                .value
                                        )
                                    }
                                    className="h-11 min-w-[160px] appearance-none rounded-xl border border-border bg-card px-4 pr-10 text-sm text-foreground outline-none"
                                >
                                    <option value="all">
                                        All Roles
                                    </option>

                                    <option value="customer">
                                        Customers
                                    </option>

                                    <option value="developer">
                                        Developers
                                    </option>

                                    <option value="admin">
                                        Admins
                                    </option>
                                </select>

                                <ChevronDown
                                    size={15}
                                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                                />

                            </div>

                        </div>

                        {/* Users table */}
                        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-muted/30">

                            <div className="overflow-x-auto">

                                <table className="w-full min-w-[1050px] text-left">

                                    <thead className="border-b border-border bg-muted/30">

                                        <tr>

                                            <th className="px-5 py-4 text-xs font-medium text-muted-foreground">
                                                User
                                            </th>

                                            <th className="px-5 py-4 text-xs font-medium text-muted-foreground">
                                                Role
                                            </th>

                                            <th className="px-5 py-4 text-xs font-medium text-muted-foreground">
                                                Orders
                                            </th>

                                            <th className="px-5 py-4 text-xs font-medium text-muted-foreground">
                                                Spent
                                            </th>

                                            <th className="px-5 py-4 text-xs font-medium text-muted-foreground">
                                                Registered
                                            </th>

                                            <th className="px-5 py-4 text-right text-xs font-medium text-muted-foreground">
                                                Actions
                                            </th>

                                        </tr>

                                    </thead>

                                    <tbody className="divide-y divide-border">

                                        {loading ? (
                                            <tr>
                                                <td
                                                    colSpan={6}
                                                    className="px-5 py-12 text-center text-sm text-muted-foreground"
                                                >
                                                    Loading users...
                                                </td>
                                            </tr>
                                        ) : filteredUsers.length ===
                                            0 ? (
                                            <tr>
                                                <td
                                                    colSpan={6}
                                                    className="px-5 py-12 text-center text-sm text-muted-foreground"
                                                >
                                                    No users found.
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredUsers.map(
                                                (user) => (
                                                    <tr
                                                        key={
                                                            user.id
                                                        }
                                                        className="hover:bg-muted/30"
                                                    >

                                                        {/* User */}
                                                        <td className="px-5 py-4">

                                                            <div className="flex items-center gap-3">

                                                                {user.photoURL ? (
                                                                    <img
                                                                        src={
                                                                            user.photoURL
                                                                        }
                                                                        alt=""
                                                                        className="h-10 w-10 rounded-full object-cover"
                                                                    />
                                                                ) : (
                                                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
                                                                        {user.displayName
                                                                            .charAt(
                                                                                0
                                                                            )
                                                                            .toUpperCase()}
                                                                    </div>
                                                                )}

                                                                <div className="min-w-0">

                                                                    <p className="truncate text-sm font-medium text-foreground">
                                                                        {
                                                                            user.displayName
                                                                        }
                                                                    </p>

                                                                    <p className="mt-1 truncate text-xs text-muted-foreground">
                                                                        {
                                                                            user.email
                                                                        }
                                                                    </p>

                                                                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                                                                        {
                                                                            user.id
                                                                        }
                                                                    </p>

                                                                </div>

                                                            </div>

                                                        </td>

                                                        {/* Role */}
                                                        <td className="px-5 py-4">

                                                            <span
                                                                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${user.role ===
                                                                        "admin"
                                                                        ? "bg-muted text-foreground"
                                                                        : user.role ===
                                                                            "developer"
                                                                            ? "bg-muted/50 text-foreground"
                                                                            : "bg-muted/40 text-muted-foreground"
                                                                    }`}
                                                            >

                                                                {user.role ===
                                                                    "admin" && (
                                                                        <ShieldCheck
                                                                            size={
                                                                                13
                                                                            }
                                                                        />
                                                                    )}

                                                                {roleLabel(
                                                                    user.role
                                                                )}

                                                            </span>

                                                        </td>

                                                        {/* Orders */}
                                                        <td className="px-5 py-4">

                                                            <div>

                                                                <p className="text-sm text-foreground">
                                                                    {
                                                                        user.paidOrders
                                                                    }
                                                                </p>

                                                                <p className="mt-1 text-xs text-muted-foreground">
                                                                    {
                                                                        user.totalOrders
                                                                    }{" "}
                                                                    total
                                                                </p>

                                                            </div>

                                                        </td>

                                                        {/* Spent */}
                                                        <td className="px-5 py-4">

                                                            <p className="text-sm font-medium text-foreground">
                                                                {formatCurrency(
                                                                    user.totalSpent
                                                                )}
                                                            </p>

                                                        </td>

                                                        {/* Date */}
                                                        <td className="px-5 py-4">

                                                            <p className="text-sm text-muted-foreground">
                                                                {formatDate(
                                                                    user.createdAt
                                                                )}
                                                            </p>

                                                        </td>

                                                        {/* Actions */}
                                                        <td className="px-5 py-4 text-right">

                                                            <Link
                                                                href={`/admin/users/${user.id}`}
                                                                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted/70 hover:text-foreground"
                                                            >
                                                                View
                                                                <ArrowUpRight
                                                                    size={
                                                                        13
                                                                    }
                                                                />
                                                            </Link>

                                                        </td>

                                                    </tr>
                                                )
                                            )
                                        )}

                                    </tbody>

                                </table>

                            </div>

                            {/* Footer */}
                            <div className="border-t border-border px-5 py-4">

                                <p className="text-xs text-muted-foreground">

                                    Showing{" "}
                                    <span className="text-muted-foreground">
                                        {
                                            filteredUsers.length
                                        }
                                    </span>{" "}
                                    of{" "}
                                    <span className="text-muted-foreground">
                                        {
                                            data?.users
                                                .length ??
                                            0
                                        }
                                    </span>{" "}
                                    users

                                </p>

                            </div>

                    </div>
        </AdminShell>
    );
}

function StatCard({
    title,
    value,
    icon: Icon,
    subtitle,
    loading,
}: {
    title: string;
    value: number | string;
    icon: React.ComponentType<{
        size?: number;
    }>;
    subtitle: string;
    loading: boolean;
}) {
    return (
        <div className="rounded-2xl border border-border bg-muted/30 p-5">

            <div className="flex items-center justify-between">

                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50">
                    <Icon size={18} />
                </div>

                <ArrowUpRight
                    size={16}
                    className="text-muted-foreground"
                />

            </div>

            <p className="mt-5 text-sm text-muted-foreground">
                {title}
            </p>

            <p className="mt-1 text-2xl font-semibold">
                {loading
                    ? "—"
                    : value}
            </p>

            <p className="mt-2 text-xs text-muted-foreground">
                {subtitle}
            </p>

        </div>
    );
}

function NavItem({
    icon,
    label,
    active = false,
    href,
}: {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    href: string;
}) {
    return (
        <Link
            href={href}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                }`}
        >
            {icon}
            {label}
        </Link>
    );
}