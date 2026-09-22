"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    Check,
    ChevronLeft,
    Clock,
    Eye,
    Filter,
    Loader2,
    MessageSquare,
    Search,
    ShieldCheck,
    Star,
    Trash2,
    X,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";

type Review = {
    id: string;
    productId?: string;
    productName?: string;
    productSlug?: string;
    platform?: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    rating?: number;
    title?: string;
    comment?: string;
    verifiedPurchase?: boolean;
    status?: string;
    createdAt?: number;
};

type Summary = {
    total: number;
    published: number;
    pending: number;
    rejected: number;
};

export default function AdminReviewsPage() {
    const [reviews, setReviews] = useState<Review[]>([]);
    const [summary, setSummary] = useState<Summary>({
        total: 0,
        published: 0,
        pending: 0,
        rejected: 0,
    });

    const [loading, setLoading] = useState(true);
    const [actionId, setActionId] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");

    async function getToken() {
        const user = auth.currentUser;

        if (!user) {
            throw new Error("Authentication required.");
        }

        return user.getIdToken();
    }

    async function loadReviews() {
        try {
            setLoading(true);
            setError("");

            const token = await getToken();

            const response = await fetch(
                "/api/admin/reviews",
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    cache: "no-store",
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    "Unable to load reviews."
                );
            }

            setReviews(
                Array.isArray(data?.reviews)
                    ? data.reviews
                    : []
            );

            setSummary(
                data?.summary || {
                    total: 0,
                    published: 0,
                    pending: 0,
                    rejected: 0,
                }
            );
        } catch (err: unknown) {
            console.error(
                "ADMIN REVIEWS LOAD ERROR:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to load reviews."
            );
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        const unsubscribe =
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    loadReviews();
                } else {
                    setLoading(false);
                }
            });

        return unsubscribe;
    }, []);

    async function updateStatus(
        id: string,
        status: "published" | "pending" | "rejected"
    ) {
        try {
            setActionId(id);
            setError("");

            const token = await getToken();

            const response = await fetch(
                `/api/admin/reviews/${encodeURIComponent(id)}`,
                {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        status,
                    }),
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    "Unable to update review."
                );
            }

            await loadReviews();
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to update review."
            );
        } finally {
            setActionId(null);
        }
    }

    async function deleteReview(id: string) {
        const confirmed = window.confirm(
            "Delete this review permanently?"
        );

        if (!confirmed) {
            return;
        }

        try {
            setActionId(id);
            setError("");

            const token = await getToken();

            const response = await fetch(
                `/api/admin/reviews/${encodeURIComponent(id)}`,
                {
                    method: "DELETE",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    "Unable to delete review."
                );
            }

            await loadReviews();
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Unable to delete review."
            );
        } finally {
            setActionId(null);
        }
    }

    const filteredReviews = useMemo(() => {
        const query = search
            .trim()
            .toLowerCase();

        return reviews.filter((review) => {
            const matchesStatus =
                statusFilter === "all" ||
                review.status === statusFilter;

            if (!matchesStatus) {
                return false;
            }

            if (!query) {
                return true;
            }

            return [
                review.productName,
                review.productId,
                review.userName,
                review.userEmail,
                review.title,
                review.comment,
            ]
                .filter(Boolean)
                .some((value) =>
                    String(value)
                        .toLowerCase()
                        .includes(query)
                );
        });
    }, [reviews, search, statusFilter]);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-[1500px] px-6 py-8">
                <div data-guide="page-header" className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <Link
                            href="/admin"
                            className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                        >
                            <ChevronLeft className="h-4 w-4" />
                            Back to Admin
                        </Link>

                        <div className="flex items-center gap-3">
                            <div className="rounded-xl border border-border bg-muted/50 p-3">
                                <MessageSquare className="h-6 w-6" />
                            </div>

                            <div>
                                <h1 className="text-3xl font-bold">
                                    Reviews
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    Manage customer ratings and reviews.
                                </p>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={loadReviews}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm font-medium hover:bg-muted"
                    >
                        Refresh
                    </button>
                </div>

                {error && (
                    <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600">
                        {error}
                    </div>
                )}

                <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard
                        label="Total Reviews"
                        value={summary.total}
                        icon={
                            <MessageSquare className="h-5 w-5" />
                        }
                    />

                    <StatCard
                        label="Published"
                        value={summary.published}
                        icon={
                            <Check className="h-5 w-5" />
                        }
                    />

                    <StatCard
                        label="Pending"
                        value={summary.pending}
                        icon={
                            <Clock className="h-5 w-5" />
                        }
                    />

                    <StatCard
                        label="Rejected"
                        value={summary.rejected}
                        icon={
                            <X className="h-5 w-5" />
                        }
                    />
                </div>

                <div className="mb-6 flex flex-col gap-3 lg:flex-row">
                    <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                        <input
                            value={search}
                            onChange={(e) =>
                                setSearch(
                                    e.target.value
                                )
                            }
                            placeholder="Search product, customer, title or review..."
                            className="w-full rounded-xl border border-border bg-muted/50 py-3 pl-10 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-border"
                        />
                    </div>

                    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3">
                        <Filter className="h-4 w-4 text-muted-foreground" />

                        <select
                            value={statusFilter}
                            onChange={(e) =>
                                setStatusFilter(
                                    e.target.value
                                )
                            }
                            className="bg-transparent py-3 text-sm outline-none"
                        >
                            <option
                                value="all"
                                className="bg-card"
                            >
                                All Status
                            </option>
                            <option
                                value="published"
                                className="bg-card"
                            >
                                Published
                            </option>
                            <option
                                value="pending"
                                className="bg-card"
                            >
                                Pending
                            </option>
                            <option
                                value="rejected"
                                className="bg-card"
                            >
                                Rejected
                            </option>
                        </select>
                    </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-border bg-foreground/[0.025]">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1100px]">
                            <thead className="border-b border-border bg-muted/40">
                                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                                    <th className="px-5 py-4">
                                        Review
                                    </th>
                                    <th className="px-5 py-4">
                                        Product
                                    </th>
                                    <th className="px-5 py-4">
                                        Customer
                                    </th>
                                    <th className="px-5 py-4">
                                        Rating
                                    </th>
                                    <th className="px-5 py-4">
                                        Status
                                    </th>
                                    <th className="px-5 py-4">
                                        Date
                                    </th>
                                    <th className="px-5 py-4 text-right">
                                        Actions
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td
                                            colSpan={7}
                                            className="px-5 py-16 text-center"
                                        >
                                            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                                        </td>
                                    </tr>
                                ) : filteredReviews.length ===
                                    0 ? (
                                    <tr>
                                        <td
                                            colSpan={7}
                                            className="px-5 py-16 text-center text-sm text-muted-foreground"
                                        >
                                            No reviews found.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredReviews.map(
                                        (review) => (
                                            <tr
                                                key={
                                                    review.id
                                                }
                                                className="border-b border-border/60 last:border-0 hover:bg-muted/30"
                                            >
                                                <td className="max-w-[360px] px-5 py-4">
                                                    <div className="font-medium text-foreground">
                                                        {review.title ||
                                                            "Untitled review"}
                                                    </div>

                                                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                                                        {
                                                            review.comment
                                                        }
                                                    </p>

                                                    {review.verifiedPurchase && (
                                                        <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-600">
                                                            <ShieldCheck className="h-3 w-3" />
                                                            Verified Purchase
                                                        </div>
                                                    )}
                                                </td>

                                                <td className="px-5 py-4">
                                                    <div className="font-medium">
                                                        {
                                                            review.productName
                                                        }
                                                    </div>

                                                    <div className="mt-1 text-xs text-muted-foreground">
                                                        {
                                                            review.platform
                                                        }
                                                    </div>
                                                </td>

                                                <td className="px-5 py-4">
                                                    <div className="font-medium">
                                                        {
                                                            review.userName
                                                        }
                                                    </div>

                                                    <div className="mt-1 text-xs text-muted-foreground">
                                                        {
                                                            review.userEmail
                                                        }
                                                    </div>
                                                </td>

                                                <td className="px-5 py-4">
                                                    <div className="flex items-center gap-1">
                                                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-600" />
                                                        <span className="font-semibold">
                                                            {
                                                                review.rating
                                                            }
                                                        </span>
                                                    </div>
                                                </td>

                                                <td className="px-5 py-4">
                                                    <StatusBadge
                                                        status={
                                                            review.status
                                                        }
                                                    />
                                                </td>

                                                <td className="px-5 py-4 text-sm text-muted-foreground">
                                                    {review.createdAt
                                                        ? new Date(
                                                            review.createdAt
                                                        ).toLocaleDateString()
                                                        : "—"}
                                                </td>

                                                <td className="px-5 py-4">
                                                    <div className="flex justify-end gap-2">
                                                        {review.productSlug && (
                                                            <Link
                                                                href={`/marketplace/${review.productSlug}`}
                                                                target="_blank"
                                                                className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                                                                title="View product"
                                                            >
                                                                <Eye className="h-4 w-4" />
                                                            </Link>
                                                        )}

                                                        {review.status !==
                                                            "published" && (
                                                                <ActionButton
                                                                    title="Approve"
                                                                    disabled={
                                                                        actionId ===
                                                                        review.id
                                                                    }
                                                                    onClick={() =>
                                                                        updateStatus(
                                                                            review.id,
                                                                            "published"
                                                                        )
                                                                    }
                                                                >
                                                                    <Check className="h-4 w-4" />
                                                                </ActionButton>
                                                            )}

                                                        {review.status !==
                                                            "rejected" && (
                                                                <ActionButton
                                                                    title="Reject"
                                                                    disabled={
                                                                        actionId ===
                                                                        review.id
                                                                    }
                                                                    onClick={() =>
                                                                        updateStatus(
                                                                            review.id,
                                                                            "rejected"
                                                                        )
                                                                    }
                                                                >
                                                                    <X className="h-4 w-4" />
                                                                </ActionButton>
                                                            )}

                                                        <ActionButton
                                                            title="Delete"
                                                            disabled={
                                                                actionId ===
                                                                review.id
                                                            }
                                                            onClick={() =>
                                                                deleteReview(
                                                                    review.id
                                                                )
                                                            }
                                                        >
                                                            {actionId ===
                                                                review.id ? (
                                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                            ) : (
                                                                <Trash2 className="h-4 w-4 text-red-500" />
                                                            )}
                                                        </ActionButton>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    )
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="mt-6 rounded-xl border border-yellow-500/10 bg-yellow-500/5 px-4 py-3 text-xs leading-5 text-muted-foreground">
                    Reviews should be moderated before being treated as
                    public marketplace content. Verified Purchase is calculated
                    server-side and should never be trusted from the client.
                </div>
            </div>
        </div>
    );
}

function StatCard({
    label,
    value,
    icon,
}: {
    label: string;
    value: number;
    icon: React.ReactNode;
}) {
    return (
        <div className="rounded-2xl border border-border bg-foreground/[0.025] p-5">
            <div className="mb-4 flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                    {label}
                </div>

                <div className="rounded-lg border border-border bg-muted/50 p-2 text-muted-foreground">
                    {icon}
                </div>
            </div>

            <div className="text-3xl font-bold">
                {value}
            </div>
        </div>
    );
}

function StatusBadge({
    status,
}: {
    status?: string;
}) {
    const styles =
        status === "published"
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
            : status === "rejected"
                ? "border-red-500/20 bg-red-500/10 text-red-600"
                : "border-yellow-500/20 bg-yellow-500/10 text-yellow-600";

    return (
        <span
            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${styles}`}
        >
            {status || "pending"}
        </span>
    );
}

function ActionButton({
    children,
    title,
    onClick,
    disabled,
}: {
    children: React.ReactNode;
    title: string;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            onClick={onClick}
            className="rounded-lg border border-border bg-muted/50 p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
            {children}
        </button>
    );
}