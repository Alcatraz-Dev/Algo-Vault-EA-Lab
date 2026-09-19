import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { recalculateProductRating } from "@/lib/reviews";
type Review = {
    id?: string;
    productId?: string;
    userId?: string;
    rating?: number;
    title?: string;
    comment?: string;
    verifiedPurchase?: boolean;
    status?: string;
    createdAt?: number;
    updatedAt?: number;
};

async function getAuthenticatedUser(
    request: NextRequest
) {
    const authorization =
        request.headers.get("authorization");

    if (
        !authorization ||
        !authorization.startsWith("Bearer ")
    ) {
        return null;
    }

    const token =
        authorization.substring(7).trim();

    if (!token) {
        return null;
    }

    try {
        return await adminAuth.verifyIdToken(token);
    } catch {
        return null;
    }
}

function getReviewId(
    context: { params: Promise<{ id: string }> }
) {
    return context.params.then(
        ({ id }) => id
    );
}

/*
|--------------------------------------------------------------------------
| PATCH
|--------------------------------------------------------------------------
| User can edit only their own review.
|--------------------------------------------------------------------------
*/

export async function PATCH(
    request: NextRequest,
    context: {
        params: Promise<{ id: string }>;
    }
) {
    try {
        const user =
            await getAuthenticatedUser(
                request
            );

        if (!user) {
            return NextResponse.json(
                {
                    error:
                        "Authentication required.",
                },
                { status: 401 }
            );
        }

        const reviewId =
            await getReviewId(context);

        if (!reviewId) {
            return NextResponse.json(
                {
                    error:
                        "Review ID is required.",
                },
                { status: 400 }
            );
        }

        const reviewRef =
            adminDatabase.ref(
                `reviews/${reviewId}`
            );

        const snapshot =
            await reviewRef.once("value");

        const review =
            snapshot.val() as Review | null;

        if (!review) {
            return NextResponse.json(
                {
                    error:
                        "Review not found.",
                },
                { status: 404 }
            );
        }

        if (review.userId !== user.uid) {
            return NextResponse.json(
                {
                    error:
                        "You can only edit your own review.",
                },
                { status: 403 }
            );
        }

        const body =
            await request.json();

        const rating = Number(
            body?.rating
        );

        const title =
            typeof body?.title === "string"
                ? body.title.trim()
                : "";

        const comment =
            typeof body?.comment === "string"
                ? body.comment.trim()
                : "";

        if (
            !Number.isInteger(rating) ||
            rating < 1 ||
            rating > 5
        ) {
            return NextResponse.json(
                {
                    error:
                        "Rating must be between 1 and 5.",
                },
                { status: 400 }
            );
        }

        if (!comment) {
            return NextResponse.json(
                {
                    error:
                        "Review comment is required.",
                },
                { status: 400 }
            );
        }

        if (title.length > 120) {
            return NextResponse.json(
                {
                    error:
                        "Review title is too long.",
                },
                { status: 400 }
            );
        }

        if (comment.length > 2000) {
            return NextResponse.json(
                {
                    error:
                        "Review comment is too long.",
                },
                { status: 400 }
            );
        }

        const updates = {
            rating,
            title,
            comment,

            // Keep the original verification
            // status. The user must never be
            // able to change this from the client.
            verifiedPurchase:
                Boolean(
                    review.verifiedPurchase
                ),

            updatedAt: Date.now(),
        };

        const productId = review.productId;

        if (!productId) {
            return NextResponse.json(
                {
                    error:
                        "Invalid review data.",
                },
                { status: 400 }
            );
        }

        await reviewRef.update(
            updates
        );
        const ratingSummary =
            await recalculateProductRating(
                productId
            );

        const updatedSnapshot =
            await reviewRef.once("value");

        return NextResponse.json({
            success: true,
            rating: ratingSummary,
            review: {
                id: reviewId,
                ...(
                    updatedSnapshot.val()
                ),
            },
        });
    } catch (error) {
        console.error(
            "REVIEW UPDATE ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    "Unable to update review.",
            },
            { status: 500 }
        );
    }
}

/*
|--------------------------------------------------------------------------
| DELETE
|--------------------------------------------------------------------------
| User can delete only their own review.
|--------------------------------------------------------------------------
*/

export async function DELETE(
    request: NextRequest,
    context: {
        params: Promise<{ id: string }>;
    }
) {
    try {
        const user =
            await getAuthenticatedUser(
                request
            );

        if (!user) {
            return NextResponse.json(
                {
                    error:
                        "Authentication required.",
                },
                { status: 401 }
            );
        }

        const reviewId =
            await getReviewId(context);

        if (!reviewId) {
            return NextResponse.json(
                {
                    error:
                        "Review ID is required.",
                },
                { status: 400 }
            );
        }

        const reviewRef =
            adminDatabase.ref(
                `reviews/${reviewId}`
            );

        const snapshot =
            await reviewRef.once("value");

        const review =
            snapshot.val() as Review | null;

        if (!review) {
            return NextResponse.json(
                {
                    error:
                        "Review not found.",
                },
                { status: 404 }
            );
        }

        if (review.userId !== user.uid) {
            return NextResponse.json(
                {
                    error:
                        "You can only delete your own review.",
                },
                { status: 403 }
            );
        }

        const productId = review.productId;

        await reviewRef.remove();

        if (productId) {
            await recalculateProductRating(
                productId
            );
        }

        return NextResponse.json({
            success: true,
            deletedReviewId:
                reviewId,
        });
    } catch (error) {
        console.error(
            "REVIEW DELETE ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    "Unable to delete review.",
            },
            { status: 500 }
        );
    }
}