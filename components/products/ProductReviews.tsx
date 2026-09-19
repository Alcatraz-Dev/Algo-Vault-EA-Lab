"use client";

import {
    useEffect,
    useState,
} from "react";
import { auth } from "@/lib/firebase";
import {
    CheckCircle2,
    MessageSquare,
    Pencil,
    Send,
    Star,
    Trash2,
    User,
    X,
} from "lucide-react";

type Review = {
    id: string;
    productId: string;
    userId: string;
    rating: number;
    title?: string;
    comment: string;
    verifiedPurchase?: boolean;
    status?: string;
    createdAt?: number;
    updatedAt?: number;
};

type ProductReviewsProps = {
    productId: string;
};

function formatDate(
    timestamp?: number
) {
    if (!timestamp) return "";

    return new Date(
        timestamp
    ).toLocaleDateString(
        "en-US",
        {
            year: "numeric",
            month: "short",
            day: "numeric",
        }
    );
}

function StarRating({
    rating,
    interactive = false,
    onChange,
}: {
    rating: number;
    interactive?: boolean;
    onChange?: (
        value: number
    ) => void;
}) {
    return (
        <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map(
                (star) => (
                    <button
                        key={star}
                        type={
                            interactive
                                ? "button"
                                : undefined
                        }
                        onClick={() =>
                            interactive &&
                            onChange?.(
                                star
                            )
                        }
                        disabled={
                            !interactive
                        }
                        className={
                            interactive
                                ? "transition hover:scale-110"
                                : ""
                        }
                        aria-label={
                            interactive
                                ? `Rate ${star} stars`
                                : undefined
                        }
                    >
                        <Star
                            size={16}
                            className={
                                star <=
                                    rating
                                    ? "fill-yellow-400 text-yellow-400"
                                    : "text-foreground/50"
                            }
                        />
                    </button>
                )
            )}
        </div>
    );
}

export default function ProductReviews({
    productId,
}: ProductReviewsProps) {
    const [reviews, setReviews] =
        useState<Review[]>([]);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState("");

    const [showForm, setShowForm] =
        useState(false);

    const [editingReview, setEditingReview] =
        useState<Review | null>(null);

    const [rating, setRating] =
        useState(5);

    const [title, setTitle] =
        useState("");

    const [comment, setComment] =
        useState("");

    const [submitting, setSubmitting] =
        useState(false);

    const [deletingId, setDeletingId] =
        useState("");

    async function loadReviews() {
        if (!productId) return;

        try {
            setLoading(true);
            setError("");

            const response = await fetch(
                `/api/reviews?productId=${encodeURIComponent(
                    productId
                )}`,
                {
                    cache: "no-store",
                }
            );

            const responseText =
                await response.text();

            let data: any = {};

            if (responseText.trim()) {
                try {
                    data = JSON.parse(
                        responseText
                    );
                } catch (parseError) {
                    console.error(
                        "REVIEWS API INVALID JSON:",
                        responseText
                    );

                    throw new Error(
                        "Reviews API returned an invalid response."
                    );
                }
            }

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    `Unable to load reviews. HTTP ${response.status}`
                );
            }

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    `Unable to load reviews. HTTP ${response.status}`
                );
            }

            setReviews(
                Array.isArray(data?.reviews)
                    ? data.reviews
                    : []
            );
        } catch (err: any) {
            console.error(
                "REVIEWS LOAD ERROR:",
                err
            );

            setError(
                err?.message ||
                "Unable to load reviews."
            );
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadReviews();
    }, [productId]);

    function resetForm() {
        setRating(5);
        setTitle("");
        setComment("");
        setEditingReview(null);
        setShowForm(false);
    }

    function startEdit(
        review: Review
    ) {
        setEditingReview(review);
        setRating(review.rating);
        setTitle(
            review.title || ""
        );
        setComment(review.comment);
        setShowForm(true);
    }

    async function handleSubmit() {
        if (!comment.trim()) {
            setError(
                "Please write a review."
            );
            return;
        }

        const user =
            auth.currentUser;

        if (!user) {
            setError(
                "Please sign in to leave a review."
            );
            return;
        }

        try {
            setSubmitting(true);
            setError("");

            const token =
                await user.getIdToken();

            const isEditing =
                Boolean(
                    editingReview
                );

            const url = isEditing
                ? `/api/reviews/${editingReview?.id}`
                : "/api/reviews";

            const method = isEditing
                ? "PATCH"
                : "POST";

            const response =
                await fetch(url, {
                    method,
                    headers: {
                        Authorization:
                            `Bearer ${token}`,
                        "Content-Type":
                            "application/json",
                    },
                    body: JSON.stringify({
                        productId,
                        rating,
                        title:
                            title.trim(),
                        comment:
                            comment.trim(),
                    }),
                });

            const data =
                await response.json();

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    "Unable to save review."
                );
            }

            resetForm();

            await loadReviews();
        } catch (err: any) {
            console.error(
                "REVIEW SAVE ERROR:",
                err
            );

            setError(
                err?.message ||
                "Unable to save review."
            );
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete(
        reviewId: string
    ) {
        const confirmed =
            window.confirm(
                "Delete this review?"
            );

        if (!confirmed) return;

        const user =
            auth.currentUser;

        if (!user) {
            setError(
                "Please sign in."
            );
            return;
        }

        try {
            setDeletingId(reviewId);
            setError("");

            const token =
                await user.getIdToken();

            const response =
                await fetch(
                    `/api/reviews/${reviewId}`,
                    {
                        method: "DELETE",
                        headers: {
                            Authorization:
                                `Bearer ${token}`,
                        },
                    }
                );

            const data =
                await response.json();

            if (!response.ok) {
                throw new Error(
                    data?.error ||
                    "Unable to delete review."
                );
            }

            await loadReviews();
        } catch (err: any) {
            console.error(
                "REVIEW DELETE ERROR:",
                err
            );

            setError(
                err?.message ||
                "Unable to delete review."
            );
        } finally {
            setDeletingId("");
        }
    }

    const totalReviews =
        reviews.length;

    const averageRating =
        totalReviews > 0
            ? reviews.reduce(
                (
                    total,
                    review
                ) =>
                    total +
                    Number(
                        review.rating ||
                        0
                    ),
                0
            ) /
            totalReviews
            : 0;

    const user =
        auth.currentUser;

    const userReview =
        user
            ? reviews.find(
                (review) =>
                    review.userId ===
                    user.uid
            )
            : null;

    return (
        <section className="rounded-3xl border border-border/20 bg-foreground/4 p-7 md:p-9">
            {/* Header */}
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/20 bg-foreground/10">
                        <MessageSquare
                            size={18}
                        />
                    </div>

                    <div>
                        <h2 className="font-medium">
                            Reviews & Ratings
                        </h2>

                        <p className="mt-1 text-xs text-foreground/50">
                            Feedback from users of this product.
                        </p>
                    </div>
                </div>

                {user && !userReview && (
                    <button
                        type="button"
                        onClick={() => {
                            setShowForm(
                                true
                            );
                            setError("");
                        }}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-background px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
                    >
                        <Star
                            size={15}
                        />
                        Write a Review
                    </button>
                )}
            </div>

            {/* Rating Summary */}
            <div className="mt-7 grid gap-4 md:grid-cols-[180px_1fr]">
                <div className="rounded-2xl border border-border/20 bg-background/20 p-5 text-center">
                    <div className="text-4xl font-semibold">
                        {averageRating
                            ? averageRating.toFixed(
                                1
                            )
                            : "—"}
                    </div>

                    <div className="mt-2 flex justify-center">
                        <StarRating
                            rating={Math.round(
                                averageRating
                            )}
                        />
                    </div>

                    <p className="mt-2 text-xs text-foreground/50">
                        {totalReviews}{" "}
                        {totalReviews ===
                            1
                            ? "review"
                            : "reviews"}
                    </p>
                </div>

                <div className="rounded-2xl border border-border/20 bg-background/20 p-5">
                    <RatingBar
                        rating={5}
                        reviews={reviews}
                    />

                    <RatingBar
                        rating={4}
                        reviews={reviews}
                    />

                    <RatingBar
                        rating={3}
                        reviews={reviews}
                    />

                    <RatingBar
                        rating={2}
                        reviews={reviews}
                    />

                    <RatingBar
                        rating={1}
                        reviews={reviews}
                    />
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
                    {error}
                </div>
            )}

            {/* Review Form */}
            {showForm && (
                <div className="mt-6 rounded-2xl border border-border/20 bg-background/20 p-5">
                    <div className="flex items-center justify-between">
                        <h3 className="font-medium">
                            {editingReview
                                ? "Edit your review"
                                : "Write a review"}
                        </h3>

                        <button
                            type="button"
                            onClick={
                                resetForm
                            }
                            className="rounded-lg p-2 text-foreground/70 transition hover:bg-foreground/10 hover:text-foreground"
                        >
                            <X
                                size={17}
                            />
                        </button>
                    </div>

                    <div className="mt-5">
                        <p className="text-xs text-foreground/70">
                            Your rating
                        </p>

                        <div className="mt-2">
                            <StarRating
                                rating={
                                    rating
                                }
                                interactive
                                onChange={
                                    setRating
                                }
                            />
                        </div>
                    </div>

                    <div className="mt-5">
                        <label className="text-xs text-foreground/70">
                            Title
                        </label>

                        <input
                            value={title}
                            onChange={(
                                event
                            ) =>
                                setTitle(
                                    event
                                        .target
                                        .value
                                )
                            }
                            maxLength={120}
                            placeholder="Summarize your experience"
                            className="mt-2 w-full rounded-xl border border-border/20 bg-foreground/6 px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/50 focus:border-border/40"
                        />
                    </div>

                    <div className="mt-4">
                        <label className="text-xs text-foreground/70">
                            Review
                        </label>

                        <textarea
                            value={
                                comment
                            }
                            onChange={(
                                event
                            ) =>
                                setComment(
                                    event
                                        .target
                                        .value
                                )
                            }
                            maxLength={2000}
                            rows={5}
                            placeholder="Tell other traders about your experience..."
                            className="mt-2 w-full resize-none rounded-xl border border-border/20 bg-foreground/6 px-4 py-3 text-sm leading-6 text-foreground outline-none placeholder:text-foreground/50 focus:border-border/40"
                        />

                        <div className="mt-1 text-right text-[10px] text-foreground/50">
                            {
                                comment.length
                            }
                            /2000
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={
                            handleSubmit
                        }
                        disabled={
                            submitting
                        }
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-background px-5 py-3 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Send
                            size={15}
                        />

                        {submitting
                            ? "Saving..."
                            : editingReview
                                ? "Update Review"
                                : "Publish Review"}
                    </button>
                </div>
            )}

            {/* Reviews List */}
            <div className="mt-7">
                {loading ? (
                    <div className="space-y-4">
                        <ReviewSkeleton />
                        <ReviewSkeleton />
                    </div>
                ) : reviews.length ===
                    0 ? (
                    <div className="rounded-2xl border border-dashed border-border/20 bg-foreground/10 px-6 py-10 text-center">
                        <MessageSquare
                            size={28}
                            className="mx-auto text-foreground/50"
                        />

                        <p className="mt-3 text-sm text-foreground/70">
                            No reviews yet.
                        </p>

                        <p className="mt-1 text-xs text-foreground/50">
                            Be the first to review this product.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {reviews.map(
                            (review) => {
                                const isOwner =
                                    user?.uid ===
                                    review.userId;

                                return (
                                    <article
                                        key={
                                            review.id
                                        }
                                        className="rounded-2xl border border-border/20 bg-background/20 p-5"
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex min-w-0 items-start gap-3">
                                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/20 bg-foreground/10">
                                                    <User
                                                        size={
                                                            16
                                                        }
                                                        className="text-foreground/70"
                                                    />
                                                </div>

                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="text-sm font-medium">
                                                            {isOwner
                                                                ? "You"
                                                                : "Verified Trader"}
                                                        </span>

                                                        {review.verifiedPurchase && (
                                                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[10px] text-emerald-400">
                                                                <CheckCircle2
                                                                    size={
                                                                        10
                                                                    }
                                                                />
                                                                Verified Purchase
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="mt-1 flex flex-wrap items-center gap-3">
                                                        <StarRating
                                                            rating={
                                                                review.rating
                                                            }
                                                        />

                                                        <span className="text-[11px] text-foreground/50">
                                                            {formatDate(
                                                                review.updatedAt ||
                                                                review.createdAt
                                                            )}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {isOwner && (
                                                <div className="flex shrink-0 items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            startEdit(
                                                                review
                                                            )
                                                        }
                                                        className="rounded-lg p-2 text-foreground/50 transition hover:bg-foreground/10 hover:text-foreground"
                                                        aria-label="Edit review"
                                                    >
                                                        <Pencil
                                                            size={
                                                                14
                                                            }
                                                        />
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            handleDelete(
                                                                review.id
                                                            )
                                                        }
                                                        disabled={
                                                            deletingId ===
                                                            review.id
                                                        }
                                                        className="rounded-lg p-2 text-foreground/50 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                                                        aria-label="Delete review"
                                                    >
                                                        <Trash2
                                                            size={
                                                                14
                                                            }
                                                        />
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {review.title && (
                                            <h3 className="mt-5 text-sm font-medium">
                                                {
                                                    review.title
                                                }
                                            </h3>
                                        )}

                                        <p className="mt-2 text-sm leading-6 text-foreground/70">
                                            {
                                                review.comment
                                            }
                                        </p>
                                    </article>
                                );
                            }
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}

function RatingBar({
    rating,
    reviews,
}: {
    rating: number;
    reviews: Review[];
}) {
    const count =
        reviews.filter(
            (review) =>
                Number(
                    review.rating
                ) === rating
        ).length;

    const percentage =
        reviews.length > 0
            ? (count /
                reviews.length) *
            100
            : 0;

    return (
        <div className="flex items-center gap-3">
            <span className="w-8 text-xs text-foreground/70">
                {rating}★
            </span>

            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                <div
                    className="h-full rounded-full bg-yellow-400/70 transition-all"
                    style={{
                        width: `${percentage}%`,
                    }}
                />
            </div>

            <span className="w-6 text-right text-[10px] text-foreground/50">
                {count}
            </span>
        </div>
    );
}

function ReviewSkeleton() {
    return (
        <div className="animate-pulse rounded-2xl border border-border/20 bg-background/20 p-5">
            <div className="flex gap-3">
                <div className="h-10 w-10 rounded-full bg-foreground/10" />

                <div className="flex-1">
                    <div className="h-3 w-24 rounded bg-foreground/10" />

                    <div className="mt-3 h-2 w-32 rounded bg-foreground/10" />
                </div>
            </div>

            <div className="mt-5 h-3 w-1/3 rounded bg-foreground/10" />

            <div className="mt-3 h-3 w-full rounded bg-foreground/10" />

            <div className="mt-2 h-3 w-4/5 rounded bg-foreground/10" />
        </div>
    );
}