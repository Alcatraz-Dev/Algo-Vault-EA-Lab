"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    ArrowRight,
    CheckCircle2,
    Clock3,
    DollarSign,
    ExternalLink,
    Filter,
    Loader2,
    PackageCheck,
    RefreshCw,
    Search,
    ShieldCheck,
    ShoppingCart,
    User,
    XCircle,
} from "lucide-react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";

type Product = {
    id: string;
    name?: string;
    slug?: string;
    version?: string;
    productType?: string;
    platform?: string;
    status?: string;
};

type Order = {
    id: string;
    userId?: string;

    productId?: string;
    productName?: string;

    status?: string;
    paymentStatus?: string;

    price?: number;
    currency?: string;

    createdAt?: number;
    paidAt?: number;

    stripeSessionId?: string;
    stripePaymentIntentId?: string;

    paymentProvider?: string;

    licenseId?: string;

    email?: string;

    metadata?: Record<string, unknown>;

    product?: Product | null;
};

type OrderFilter =
    | "all"
    | "paid"
    | "pending"
    | "failed"
    | "cancelled";

export default function AdminOrdersPage() {
    const [currentUser, setCurrentUser] =
        useState<FirebaseUser | null>(null);

    const [orders, setOrders] =
        useState<Order[]>([]);

    const [loading, setLoading] =
        useState(true);

    const [refreshing, setRefreshing] =
        useState(false);

    const [search, setSearch] =
        useState("");

    const [filter, setFilter] =
        useState<OrderFilter>("all");

    const [error, setError] =
        useState("");

    /*
     * ---------------------------------------------------------
     * AUTH
     * ---------------------------------------------------------
     */

    useEffect(() => {
        const unsubscribe =
            onAuthStateChanged(
                auth,
                (user) => {
                    setCurrentUser(user);

                    if (!user) {
                        setLoading(false);
                    }
                }
            );

        return () => unsubscribe();
    }, []);

    /*
     * ---------------------------------------------------------
     * LOAD ORDERS
     * ---------------------------------------------------------
     *
     * IMPORTANT:
     *
     * We no longer read:
     *
     * ref(database, "orders")
     *
     * from the browser.
     *
     * Instead:
     *
     * Browser
     *    ↓ Firebase ID Token
     * /api/admin/orders
     *    ↓
     * Firebase Admin SDK
     *    ↓
     * /orders
     *
     */

    const loadOrders = useCallback(
        async () => {
            if (!currentUser) {
                return;
            }

            setError("");

            try {
                const token =
                    await currentUser.getIdToken();

                const response =
                    await fetch(
                        "/api/admin/orders",
                        {
                            method: "GET",
                            headers: {
                                Authorization:
                                    `Bearer ${token}`,
                                "Content-Type":
                                    "application/json",
                            },
                            cache: "no-store",
                        }
                    );

                const data =
                    await response.json();

                if (!response.ok) {
                    throw new Error(
                        data?.error ||
                        "Failed to load orders."
                    );
                }

                setOrders(
                    Array.isArray(
                        data?.orders
                    )
                        ? data.orders
                        : []
                );
            } catch (err) {
                console.error(
                    "ADMIN ORDERS LOAD ERROR:",
                    err
                );

                setError(
                    err instanceof Error
                        ? err.message
                        : "Unable to load orders."
                );

                setOrders([]);
            } finally {
                setLoading(false);
            }
        },
        [currentUser]
    );

    /*
     * ---------------------------------------------------------
     * INITIAL LOAD
     * ---------------------------------------------------------
     */

    useEffect(() => {
        if (!currentUser) {
            return;
        }

        loadOrders();
    }, [
        currentUser,
        loadOrders,
    ]);

    /*
     * ---------------------------------------------------------
     * REFRESH
     * ---------------------------------------------------------
     */

    const refresh = async () => {
        setRefreshing(true);

        try {
            await loadOrders();
        } finally {
            setRefreshing(false);
        }
    };

    /*
     * ---------------------------------------------------------
     * FILTERED ORDERS
     * ---------------------------------------------------------
     */

    const filteredOrders =
        useMemo(() => {
            const query =
                search
                    .trim()
                    .toLowerCase();

            return orders.filter(
                (order) => {
                    const productName =
                        order.product
                            ?.name ||
                        order.productName ||
                        "";

                    const status =
                        getOrderStatus(
                            order
                        );

                    const matchesSearch =
                        !query ||
                        order.id
                            .toLowerCase()
                            .includes(
                                query
                            ) ||
                        order.userId
                            ?.toLowerCase()
                            .includes(
                                query
                            ) ||
                        order.email
                            ?.toLowerCase()
                            .includes(
                                query
                            ) ||
                        productName
                            .toLowerCase()
                            .includes(
                                query
                            ) ||
                        order.stripeSessionId
                            ?.toLowerCase()
                            .includes(
                                query
                            );

                    if (
                        !matchesSearch
                    ) {
                        return false;
                    }

                    if (
                        filter ===
                        "all"
                    ) {
                        return true;
                    }

                    return (
                        status ===
                        filter
                    );
                }
            );
        }, [
            orders,
            search,
            filter,
        ]);

    /*
     * ---------------------------------------------------------
     * STATS
     * ---------------------------------------------------------
     */

    const stats = useMemo(() => {
        let paid = 0;
        let pending = 0;
        let failed = 0;
        let cancelled = 0;

        let revenue = 0;

        orders.forEach(
            (order) => {
                const status =
                    getOrderStatus(
                        order
                    );

                if (
                    status ===
                    "paid"
                ) {
                    paid++;

                    revenue +=
                        Number(
                            order.price ||
                            0
                        );
                }

                if (
                    status ===
                    "pending"
                ) {
                    pending++;
                }

                if (
                    status ===
                    "failed"
                ) {
                    failed++;
                }

                if (
                    status ===
                    "cancelled"
                ) {
                    cancelled++;
                }
            }
        );

        return {
            total: orders.length,
            paid,
            pending,
            failed,
            cancelled,
            revenue,
        };
    }, [orders]);

    /*
     * ---------------------------------------------------------
     * AUTH SCREEN
     * ---------------------------------------------------------
     */

    if (
        !loading &&
        !currentUser
    ) {
        return (
            <main className="min-h-screen bg-background text-foreground">

                <div className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6">

                    <div className="w-full rounded-2xl border border-border bg-muted/30 p-8 text-center">

                        <ShieldCheck
                            size={42}
                            className="mx-auto text-muted-foreground"
                        />

                        <h1 className="mt-5 text-xl font-semibold">
                            Authentication required
                        </h1>

                        <p className="mt-3 text-sm text-muted-foreground">
                            Please sign in to access
                            the admin dashboard.
                        </p>

                        <Link
                            href="/login"
                            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-3 text-xs font-medium text-background"
                        >
                            Sign In

                            <ArrowRight
                                size={14}
                            />
                        </Link>

                    </div>

                </div>

            </main>
        );
    }

    return (
        <AdminShell title="Orders & Transactions" subtitle="Monitor purchases, payment status, and license fulfillment">
            <div className="mb-6 flex items-center justify-end">
                <button
                    type="button"
                    onClick={refresh}
                    disabled={refreshing || loading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted/60 disabled:opacity-50"
                >
                    {refreshing ? (
                        <Loader2 size={14} className="animate-spin" />
                    ) : (
                        <RefreshCw size={14} />
                    )}
                    Refresh
                </button>
            </div>

            {/* Stats */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">

                <AdminStat
                    icon={
                        <ShoppingCart
                            size={17}
                        />
                    }
                    label="Total Orders"
                    value={
                        stats.total
                    }
                />

                <AdminStat
                    icon={
                        <CheckCircle2
                            size={17}
                        />
                    }
                    label="Paid"
                    value={
                        stats.paid
                    }
                />

                <AdminStat
                    icon={
                        <Clock3
                            size={17}
                        />
                    }
                    label="Pending"
                    value={
                        stats.pending
                    }
                />

                <AdminStat
                    icon={
                        <XCircle
                            size={17}
                        />
                    }
                    label="Failed"
                    value={
                        stats.failed
                    }
                />

                <AdminStat
                    icon={
                        <DollarSign
                            size={17}
                        />
                    }
                    label="Revenue"
                    value={formatMoney(
                        stats.revenue,
                        getRevenueCurrency(
                            orders
                        )
                    )}
                />

            </div>

            {/* Error */}
            {error && (
                <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600">

                    <div className="flex items-start gap-3">

                        <XCircle
                            size={17}
                            className="mt-0.5 shrink-0"
                        />

                        <div>
                            <p className="font-medium">
                                Unable to load orders
                            </p>

                            <p className="mt-1 text-xs text-red-600/70">
                                {error}
                            </p>
                        </div>

                    </div>

                </div>
            )}

            {/* Search + Filters */}
            <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

                <div className="relative w-full max-w-lg">

                    <Search
                        size={16}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />

                    <input
                        value={
                            search
                        }
                        onChange={(
                            event
                        ) =>
                            setSearch(
                                event
                                    .target
                                    .value
                            )
                        }
                        placeholder="Search order, customer, product or Stripe session..."
                        className="w-full rounded-xl border border-border bg-muted/40 py-3 pl-11 pr-4 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-border"
                    />

                </div>

                <div className="flex items-center gap-2 overflow-x-auto">

                    <Filter
                        size={14}
                        className="shrink-0 text-muted-foreground"
                    />

                    {(
                        [
                            [
                                "all",
                                "All",
                            ],
                            [
                                "paid",
                                "Paid",
                            ],
                            [
                                "pending",
                                "Pending",
                            ],
                            [
                                "failed",
                                "Failed",
                            ],
                            [
                                "cancelled",
                                "Cancelled",
                            ],
                        ] as [
                            OrderFilter,
                            string
                        ][]
                    ).map(
                        ([
                            value,
                            label,
                        ]) => (
                            <button
                                key={
                                    value
                                }
                                type="button"
                                onClick={() =>
                                    setFilter(
                                        value
                                    )
                                }
                                className={`whitespace-nowrap rounded-xl border px-3.5 py-2.5 text-[11px] transition ${filter ===
                                    value
                                    ? "border-border bg-foreground text-background"
                                    : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
                                    }`}
                            >
                                {
                                    label
                                }
                            </button>
                        )
                    )}

                </div>

            </div>

            {/* Result count */}
            <div className="mt-5 flex items-center justify-between">

                <p className="text-xs text-muted-foreground">

                    Showing{" "}
                    <span className="text-muted-foreground">
                        {
                            filteredOrders.length
                        }
                    </span>{" "}
                    of{" "}
                    <span className="text-muted-foreground">
                        {
                            orders.length
                        }
                    </span>{" "}
                    orders

                </p>

            </div>

            {/* Loading */}
            {loading && (
                <div className="mt-5 overflow-hidden rounded-2xl border border-border">

                    <div className="animate-pulse space-y-3 p-5">

                        {[
                            1,
                            2,
                            3,
                            4,
                        ].map(
                            (
                                item
                            ) => (
                                <div
                                    key={
                                        item
                                    }
                                    className="h-16 rounded-xl bg-muted/50"
                                />
                            )
                        )}

                    </div>

                </div>
            )}

            {/* Empty */}
            {!loading &&
                !error &&
                filteredOrders.length ===
                0 && (
                    <div className="mt-5 rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-20 text-center">

                        <PackageCheck
                            size={40}
                            className="mx-auto text-muted-foreground"
                        />

                        <h2 className="mt-5 text-lg font-medium">
                            No orders found
                        </h2>

                        <p className="mt-2 text-sm text-muted-foreground">
                            Try another search or
                            filter.
                        </p>

                    </div>
                )}

            {/* Table */}
            {!loading &&
                filteredOrders.length >
                0 && (
                    <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-muted/30">

                        <div className="overflow-x-auto">

                            <table className="w-full min-w-[1050px]">

                                <thead>
                                    <tr className="border-b border-border bg-muted/30">

                                        <th className="px-5 py-4 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                                            Order
                                        </th>

                                        <th className="px-5 py-4 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                                            Customer
                                        </th>

                                        <th className="px-5 py-4 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                                            Product
                                        </th>

                                        <th className="px-5 py-4 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                                            Amount
                                        </th>

                                        <th className="px-5 py-4 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                                            Payment
                                        </th>

                                        <th className="px-5 py-4 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                                            License
                                        </th>

                                        <th className="px-5 py-4 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                                            Date
                                        </th>

                                        <th className="px-5 py-4 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                                            Action
                                        </th>

                                    </tr>
                                </thead>

                                <tbody>

                                    {filteredOrders.map(
                                        (
                                            order
                                        ) => (
                                            <OrderRow
                                                key={`${order.userId}-${order.id}`}
                                                order={
                                                    order
                                                }
                                            />
                                        )
                                    )}

                                </tbody>

                            </table>

                        </div>

                    </div>
                )}

            {/* Bottom note */}
            {!loading &&
                orders.length >
                0 && (
                    <div className="mt-6 flex gap-3 rounded-2xl border border-border bg-muted/30 p-5">

                        <ShieldCheck
                            size={18}
                            className="mt-0.5 shrink-0 text-muted-foreground"
                        />

                        <p className="text-xs leading-6 text-muted-foreground">
                            Order data is loaded through a
                            protected server-side Admin API.
                            Customer order data is not exposed
                            directly to the browser.
                        </p>

                    </div>
                )}

        </AdminShell>
    );
}

/*
 * ============================================================
 * ORDER ROW
 * ============================================================
 */

function OrderRow({
    order,
}: {
    order: Order;
}) {
    const status =
        getOrderStatus(order);

    const productName =
        order.product?.name ||
        order.productName ||
        "Unknown Product";

    const productSlug =
        order.product?.slug;

    const licenseExists =
        Boolean(
            order.licenseId
        );

    return (
        <tr className="border-b border-border/60 transition hover:bg-muted/40">

            {/* Order */}
            <td className="px-5 py-4">

                <div>

                    <p className="font-mono text-[11px] text-foreground">
                        {shortId(
                            order.id
                        )}
                    </p>

                    <p className="mt-1 text-[10px] text-muted-foreground">
                        {order.id}
                    </p>

                </div>

            </td>

            {/* Customer */}
            <td className="px-5 py-4">

                <div className="flex items-center gap-2.5">

                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">

                        <User
                            size={13}
                            className="text-muted-foreground"
                        />

                    </div>

                    <div className="min-w-0">

                        <p className="max-w-[180px] truncate text-xs text-foreground">
                            {order.email ||
                                order.userId ||
                                "Unknown"}
                        </p>

                        {order.userId && (
                            <p className="mt-1 max-w-[180px] truncate font-mono text-[9px] text-muted-foreground">
                                {
                                    order.userId
                                }
                            </p>
                        )}

                    </div>

                </div>

            </td>

            {/* Product */}
            <td className="px-5 py-4">

                <div className="flex items-center gap-2.5">

                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card">

                        <ShoppingCart
                            size={14}
                            className="text-muted-foreground"
                        />

                    </div>

                    <div className="min-w-0">

                        {productSlug ? (
                            <Link
                                href={`/marketplace/${productSlug}`}
                                className="block max-w-[190px] truncate text-xs font-medium text-foreground hover:text-foreground"
                            >
                                {
                                    productName
                                }
                            </Link>
                        ) : (
                            <p className="max-w-[190px] truncate text-xs font-medium text-foreground">
                                {
                                    productName
                                }
                            </p>
                        )}

                        <p className="mt-1 text-[10px] text-muted-foreground">
                            {
                                order.product
                                    ?.platform ||
                                "—"
                            }
                        </p>

                    </div>

                </div>

            </td>

            {/* Amount */}
            <td className="px-5 py-4">

                <div>

                    <p className="text-xs font-medium text-foreground">
                        {formatMoney(
                            order.price ||
                            0,
                            order.currency ||
                            "USD"
                        )}
                    </p>

                    <p className="mt-1 text-[10px] text-muted-foreground">
                        {
                            order.paymentProvider ||
                            "Stripe"
                        }
                    </p>

                </div>

            </td>

            {/* Payment */}
            <td className="px-5 py-4">

                <StatusBadge
                    status={
                        status
                    }
                />

            </td>

            {/* License */}
            <td className="px-5 py-4">

                {licenseExists ? (
                    <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 text-[10px] text-emerald-600">

                        <CheckCircle2
                            size={11}
                        />

                        Created

                    </div>
                ) : status ===
                    "paid" ? (
                    <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[10px] text-amber-400">

                        <Clock3
                            size={11}
                        />

                        Missing

                    </div>
                ) : (
                    <span className="text-[10px] text-muted-foreground">
                        —
                    </span>
                )}

            </td>

            {/* Date */}
            <td className="px-5 py-4">

                <div>

                    <p className="text-xs text-muted-foreground">
                        {formatDate(
                            order.createdAt
                        )}
                    </p>

                    {order.paidAt && (
                        <p className="mt-1 text-[10px] text-emerald-500/60">
                            Paid{" "}
                            {formatDate(
                                order.paidAt
                            )}
                        </p>
                    )}

                </div>

            </td>

            {/* Action */}
            <td className="px-5 py-4 text-right">

                <div className="flex justify-end gap-2">

                    {order.stripeSessionId && (
                        <button
                            type="button"
                            title="Copy Stripe Session ID"
                            onClick={() =>
                                navigator.clipboard?.writeText(
                                    order.stripeSessionId ||
                                    ""
                                )
                            }
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground transition hover:text-foreground"
                        >
                            <ExternalLink
                                size={13}
                            />
                        </button>
                    )}

                    {productSlug && (
                        <Link
                            href={`/marketplace/${productSlug}`}
                            title="View Product"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground transition hover:text-foreground"
                        >
                            <ArrowRight
                                size={13}
                            />
                        </Link>
                    )}

                </div>

            </td>

        </tr>
    );
}

/*
 * ============================================================
 * ADMIN STAT
 * ============================================================
 */

function AdminStat({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: number | string;
}) {
    return (
        <div className="rounded-2xl border border-border bg-muted/30 p-5">

            <div className="flex items-center gap-2 text-muted-foreground">

                {icon}

                <span className="text-xs">
                    {label}
                </span>

            </div>

            <p className="mt-3 text-2xl font-semibold">
                {value}
            </p>

        </div>
    );
}

/*
 * ============================================================
 * STATUS
 * ============================================================
 */

function getOrderStatus(
    order: Order
) {
    const paymentStatus =
        order.paymentStatus
            ?.toLowerCase()
            .trim();

    const status =
        order.status
            ?.toLowerCase()
            .trim();

    if (
        paymentStatus ===
        "paid" ||
        status === "paid"
    ) {
        return "paid";
    }

    if (
        status ===
        "cancelled" ||
        status ===
        "canceled" ||
        paymentStatus ===
        "cancelled" ||
        paymentStatus ===
        "canceled"
    ) {
        return "cancelled";
    }

    if (
        status === "failed" ||
        paymentStatus === "failed"
    ) {
        return "failed";
    }

    return "pending";
}

/*
 * ============================================================
 * STATUS BADGE
 * ============================================================
 */

function StatusBadge({
    status,
}: {
    status: string;
}) {
    switch (status) {
        case "paid":
            return (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 text-[10px] text-emerald-600">

                    <CheckCircle2
                        size={11}
                    />

                    Paid

                </span>
            );

        case "failed":
            return (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-[10px] text-red-500">

                    <XCircle
                        size={11}
                    />

                    Failed

                </span>
            );

        case "cancelled":
            return (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted/5 px-2.5 py-1.5 text-[10px] text-muted-foreground">

                    <XCircle
                        size={11}
                    />

                    Cancelled

                </span>
            );

        default:
            return (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[10px] text-amber-400">

                    <Clock3
                        size={11}
                    />

                    Pending

                </span>
            );
    }
}

/*
 * ============================================================
 * MONEY
 * ============================================================
 */

function formatMoney(
    amount: number,
    currency: string
) {
    try {
        return new Intl.NumberFormat(
            "en-US",
            {
                style: "currency",
                currency:
                    currency.toUpperCase(),
                maximumFractionDigits: 2,
            }
        ).format(amount);
    } catch {
        return `${amount} ${currency}`;
    }
}

/*
 * ============================================================
 * REVENUE CURRENCY
 * ============================================================
 */

function getRevenueCurrency(
    orders: Order[]
) {
    const paidOrder =
        orders.find(
            (order) =>
                getOrderStatus(
                    order
                ) === "paid"
        );

    return (
        paidOrder?.currency ||
        "USD"
    );
}

/*
 * ============================================================
 * SHORT ID
 * ============================================================
 */

function shortId(
    id: string
) {
    if (id.length <= 14) {
        return id;
    }

    return `${id.slice(
        0,
        6
    )}...${id.slice(-5)}`;
}

/*
 * ============================================================
 * DATE
 * ============================================================
 */

function formatDate(
    timestamp?: number
) {
    if (!timestamp) {
        return "—";
    }

    try {
        return new Intl.DateTimeFormat(
            "en-US",
            {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            }
        ).format(
            new Date(timestamp)
        );
    } catch {
        return "—";
    }
}