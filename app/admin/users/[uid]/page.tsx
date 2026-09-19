"use client";

import {
    ArrowLeft,
    CalendarDays,
    CheckCircle2,
    DollarSign,
    KeyRound,
    Mail,
    RefreshCw,
    ShieldCheck,
    ShoppingCart,
    UserRound,
} from "lucide-react";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";

type Order = {
    id: string;
    productName?: string;
    productId?: string;
    status?: string;
    paymentStatus?: string;
    amount?: number;
    price?: number;
    currency?: string;
    createdAt?: number;
    paidAt?: number;
    licenseId?: string;
};

type License = {
    id: string;
    licenseKey?: string;
    productId?: string;
    status?: string;
    startedAt?: number;
    expiresAt?: number;
    mt5Account?: string | number;
    maxAccounts?: number;
};

type UserData = {
    id: string;
    email: string;
    displayName: string;
    role: string;
    photoURL: string;
    createdAt: number;
};

type UserResponse = {
    user: UserData;
    stats: {
        totalOrders: number;
        paidOrders: number;
        totalSpent: number;
        totalLicenses: number;
        activeLicenses: number;
    };
    orders: Order[];
    licenses: License[];
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

function formatDate(
    timestamp?: number
) {
    if (!timestamp) {
        return "—";
    }

    return new Intl.DateTimeFormat(
        "en-US",
        {
            dateStyle: "medium",
        }
    ).format(
        new Date(timestamp)
    );
}

export default function AdminUserDetailsPage() {
    const params =
        useParams();

    const uid =
        params.uid as string;

    const [data, setData] =
        useState<UserResponse | null>(
            null
        );

    const [loading, setLoading] =
        useState(true);

    const [refreshing, setRefreshing] =
        useState(false);

    const [savingRole, setSavingRole] =
        useState(false);

    const [role, setRole] =
        useState("customer");

    const [error, setError] =
        useState("");

    const [success, setSuccess] =
        useState("");

    async function loadUser(
        refresh = false
    ) {
        try {
            if (refresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            setError("");

            const user =
                auth.currentUser;

            if (!user) {
                throw new Error(
                    "You must be logged in."
                );
            }

            const token =
                await user.getIdToken();

            const response =
                await fetch(
                    `/api/admin/users/${uid}`,
                    {
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
                    "Failed to load user."
                );
            }

            setData(result);
            setRole(
                result.user.role
            );
        } catch (err) {
            console.error(
                "USER DETAILS ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to load user."
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

                    loadUser();
                }
            );

        return () =>
            unsubscribe();
    }, [uid]);

    async function updateRole() {
        try {
            setSavingRole(true);
            setError("");
            setSuccess("");

            const user =
                auth.currentUser;

            if (!user) {
                throw new Error(
                    "You must be logged in."
                );
            }

            const token =
                await user.getIdToken();

            const response =
                await fetch(
                    `/api/admin/users/${uid}`,
                    {
                        method: "PATCH",
                        headers: {
                            Authorization:
                                `Bearer ${token}`,
                            "Content-Type":
                                "application/json",
                        },
                        body: JSON.stringify({
                            role,
                        }),
                    }
                );

            const result =
                await response.json();

            if (!response.ok) {
                throw new Error(
                    result.error ||
                    "Failed to update role."
                );
            }

            setSuccess(
                "User role updated successfully."
            );

            await loadUser(true);
        } catch (err) {
            console.error(
                "ROLE UPDATE ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to update role."
            );
        } finally {
            setSavingRole(false);
        }
    }

    if (loading) {
        return (
            <main className="min-h-screen bg-background text-foreground">
                <div className="flex min-h-screen items-center justify-center">
                    <div className="text-sm text-muted-foreground">
                        Loading user...
                    </div>
                </div>
            </main>
        );
    }

    if (!data) {
        return (
            <AdminShell title="User Details">
                <div className="mx-auto max-w-4xl">
                    <Link
                        href="/admin/users"
                        className="text-sm text-muted-foreground hover:text-foreground"
                    >
                        ← Back to Users
                    </Link>

                    <div className="mt-8 rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-red-600">
                        {error ||
                            "User not found."}
                    </div>
                </div>
            </AdminShell>
        );
    }

    return (
        <AdminShell title="User Details" subtitle={data.user.email}>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <Link
                    href="/admin/users"
                    className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft size={15} />
                    Users
                </Link>

                <button
                    onClick={() =>
                        loadUser(
                            true
                        )
                    }
                    disabled={
                        refreshing
                    }
                    className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                >
                    <RefreshCw
                        size={15}
                        className={
                            refreshing
                                ? "animate-spin"
                                : ""
                        }
                    />
                    Refresh
                </button>
            </div>

            <div className="space-y-8">

                        {error && (
                            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600">
                                {error}
                            </div>
                        )}

                        {success && (
                            <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground">
                                <CheckCircle2
                                    size={17}
                                />
                                {success}
                            </div>
                        )}

                        {/* Profile */}
                        <div className="rounded-2xl border border-border bg-muted/30 p-6">

                            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">

                                <div className="flex items-center gap-4">

                                    {data.user.photoURL ? (
                                        <img
                                            src={
                                                data
                                                    .user
                                                    .photoURL
                                            }
                                            alt=""
                                            className="h-16 w-16 rounded-full object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-xl font-semibold">
                                            {data.user.displayName
                                                .charAt(
                                                    0
                                                )
                                                .toUpperCase()}
                                        </div>
                                    )}

                                    <div>

                                        <h2 className="text-xl font-semibold">
                                            {
                                                data.user
                                                    .displayName
                                            }
                                        </h2>

                                        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                                            <Mail
                                                size={
                                                    14
                                                }
                                            />
                                            {
                                                data.user
                                                    .email
                                            }
                                        </div>

                                    </div>

                                </div>

                                {/* Role */}
                                <div className="flex flex-col gap-2">

                                    <label className="text-xs text-muted-foreground">
                                        User Role
                                    </label>

                                    <div className="flex gap-2">

                                        <select
                                            value={
                                                role
                                            }
                                            onChange={(
                                                event
                                            ) =>
                                                setRole(
                                                    event
                                                        .target
                                                        .value
                                                )
                                            }
                                            className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground outline-none"
                                        >
                                            <option value="customer">
                                                Customer
                                            </option>

                                            <option value="developer">
                                                Developer
                                            </option>

                                            <option value="admin">
                                                Admin
                                            </option>
                                        </select>

                                        <button
                                            onClick={
                                                updateRole
                                            }
                                            disabled={
                                                savingRole ||
                                                role ===
                                                data
                                                    .user
                                                    .role
                                            }
                                            className="rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            {savingRole
                                                ? "Saving..."
                                                : "Save"}
                                        </button>

                                    </div>

                                </div>

                            </div>

                            <div className="mt-6 grid gap-4 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-4">

                                <InfoItem
                                    icon={
                                        <UserRound
                                            size={
                                                16
                                            }
                                        />
                                    }
                                    label="User ID"
                                    value={
                                        data.user
                                            .id
                                    }
                                    mono
                                />

                                <InfoItem
                                    icon={
                                        <CalendarDays
                                            size={
                                                16
                                            }
                                        />
                                    }
                                    label="Registered"
                                    value={formatDate(
                                        data.user
                                            .createdAt
                                    )}
                                />

                                <InfoItem
                                    icon={
                                        <ShieldCheck
                                            size={
                                                16
                                            }
                                        />
                                    }
                                    label="Role"
                                    value={
                                        data.user
                                            .role
                                    }
                                />

                                <InfoItem
                                    icon={
                                        <KeyRound
                                            size={
                                                16
                                            }
                                        />
                                    }
                                    label="Active Licenses"
                                    value={String(
                                        data
                                            .stats
                                            .activeLicenses
                                    )}
                                />

                            </div>

                        </div>

                        {/* Stats */}
                        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

                            <Metric
                                icon={
                                    <ShoppingCart
                                        size={
                                            18
                                        }
                                    />
                                }
                                label="Total Orders"
                                value={
                                    data.stats
                                        .totalOrders
                                }
                            />

                            <Metric
                                icon={
                                    <CheckCircle2
                                        size={
                                            18
                                        }
                                    />
                                }
                                label="Paid Orders"
                                value={
                                    data.stats
                                        .paidOrders
                                }
                            />

                            <Metric
                                icon={
                                    <DollarSign
                                        size={
                                            18
                                        }
                                    />
                                }
                                label="Total Spent"
                                value={formatCurrency(
                                    data.stats
                                        .totalSpent
                                )}
                            />

                            <Metric
                                icon={
                                    <KeyRound
                                        size={
                                            18
                                        }
                                    />
                                }
                                label="Licenses"
                                value={
                                    data.stats
                                        .totalLicenses
                                }
                            />

                        </div>

                        {/* Orders */}
                        <div className="mt-8 rounded-2xl border border-border bg-muted/30">

                            <div className="border-b border-border p-5">

                                <h2 className="font-medium">
                                    Purchase History
                                </h2>

                                <p className="mt-1 text-xs text-muted-foreground">
                                    Orders associated with this account
                                </p>

                            </div>

                            <div className="overflow-x-auto">

                                <table className="w-full min-w-[700px] text-left">

                                    <thead className="border-b border-border">

                                        <tr>
                                            <th className="px-5 py-4 text-xs text-muted-foreground">
                                                Product
                                            </th>

                                            <th className="px-5 py-4 text-xs text-muted-foreground">
                                                Amount
                                            </th>

                                            <th className="px-5 py-4 text-xs text-muted-foreground">
                                                Status
                                            </th>

                                            <th className="px-5 py-4 text-xs text-muted-foreground">
                                                Date
                                            </th>
                                        </tr>

                                    </thead>

                                    <tbody className="divide-y divide-border">

                                        {data.orders.length ===
                                            0 ? (
                                            <tr>
                                                <td
                                                    colSpan={4}
                                                    className="px-5 py-10 text-center text-sm text-muted-foreground"
                                                >
                                                    No orders found.
                                                </td>
                                            </tr>
                                        ) : (
                                            data.orders.map(
                                                (
                                                    order
                                                ) => {
                                                    const isPaid =
                                                        order.status ===
                                                        "paid" ||
                                                        order.paymentStatus ===
                                                        "paid";

                                                    const amount =
                                                        typeof order.amount ===
                                                            "number"
                                                            ? order.amount
                                                            : order.price ||
                                                            0;

                                                    return (
                                                        <tr
                                                            key={
                                                                order.id
                                                            }
                                                        >

                                                            <td className="px-5 py-4">

                                                                <p className="text-sm font-medium">
                                                                    {
                                                                        order.productName ||
                                                                        "Unknown Product"
                                                                    }
                                                                </p>

                                                                <p className="mt-1 font-mono text-xs text-muted-foreground">
                                                                    {
                                                                        order.id
                                                                    }
                                                                </p>

                                                            </td>

                                                            <td className="px-5 py-4 text-sm">
                                                                {formatCurrency(
                                                                    amount,
                                                                    order.currency ||
                                                                    "USD"
                                                                )}
                                                            </td>

                                                            <td className="px-5 py-4">

                                                                <span
                                                                    className={`rounded-lg px-2.5 py-1.5 text-xs ${isPaid
                                                                            ? "bg-muted text-foreground"
                                                                            : "bg-muted/50 text-muted-foreground"
                                                                        }`}
                                                                >
                                                                    {isPaid
                                                                        ? "Paid"
                                                                        : order.status ||
                                                                        "Pending"}
                                                                </span>

                                                            </td>

                                                            <td className="px-5 py-4 text-sm text-muted-foreground">
                                                                {formatDate(
                                                                    order.paidAt ||
                                                                    order.createdAt
                                                                )}
                                                            </td>

                                                        </tr>
                                                    );
                                                }
                                            )
                                        )}

                                    </tbody>

                                </table>

                            </div>

                        </div>

                        {/* Licenses */}
                        <div className="mt-6 rounded-2xl border border-border bg-muted/30">

                            <div className="border-b border-border p-5">

                                <h2 className="font-medium">
                                    Licenses
                                </h2>

                                <p className="mt-1 text-xs text-muted-foreground">
                                    Products licensed to this user
                                </p>

                            </div>

                            <div className="divide-y divide-border">

                                {data.licenses.length ===
                                    0 ? (
                                    <div className="p-10 text-center text-sm text-muted-foreground">
                                        No licenses found.
                                    </div>
                                ) : (
                                    data.licenses.map(
                                        (
                                            license
                                        ) => {
                                            const expired =
                                                license.expiresAt &&
                                                license.expiresAt <
                                                Date.now();

                                            const active =
                                                license.status ===
                                                "active" &&
                                                !expired;

                                            return (
                                                <div
                                                    key={
                                                        license.id
                                                    }
                                                    className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between"
                                                >

                                                    <div className="flex items-center gap-4">

                                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50">
                                                            <KeyRound
                                                                size={
                                                                    17
                                                                }
                                                            />
                                                        </div>

                                                        <div>

                                                            <p className="font-mono text-sm">
                                                                {
                                                                    license.licenseKey ||
                                                                    license.id
                                                                }
                                                            </p>

                                                            <p className="mt-1 text-xs text-muted-foreground">
                                                                MT5:{" "}
                                                                {
                                                                    license.mt5Account ||
                                                                    "Not bound"
                                                                }
                                                            </p>

                                                        </div>

                                                    </div>

                                                    <div className="flex items-center gap-4">

                                                        <div className="text-right">

                                                            <p className="text-xs text-muted-foreground">
                                                                Expires
                                                            </p>

                                                            <p className="mt-1 text-sm text-muted-foreground">
                                                                {formatDate(
                                                                    license.expiresAt
                                                                )}
                                                            </p>

                                                        </div>

                                                        <span
                                                            className={`rounded-lg px-3 py-1.5 text-xs ${active
                                                                    ? "bg-muted text-foreground"
                                                                    : "bg-muted/50 text-muted-foreground"
                                                                }`}
                                                        >
                                                            {active
                                                                ? "Active"
                                                                : license.status ||
                                                                "Expired"}
                                                        </span>

                                                    </div>

                                                </div>
                                            );
                                        }
                                    )
                                )}

                            </div>

                        </div>

                    </div>

                </AdminShell>
    );
}

function Metric({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: string | number;
}) {
    return (
        <div className="rounded-2xl border border-border bg-muted/30 p-5">

            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50">
                {icon}
            </div>

            <p className="mt-4 text-sm text-muted-foreground">
                {label}
            </p>

            <p className="mt-1 text-2xl font-semibold">
                {value}
            </p>

        </div>
    );
}

function InfoItem({
    icon,
    label,
    value,
    mono = false,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {icon}
                {label}
            </div>

            <p
                className={`mt-2 truncate text-sm text-foreground ${mono
                        ? "font-mono text-xs"
                        : ""
                    }`}
            >
                {value || "—"}
            </p>

        </div>
    );
}