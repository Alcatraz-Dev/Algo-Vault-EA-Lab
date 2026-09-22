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

type ReviewRecord = {
    productId?: string;
    userId?: string;
    status?: string;
};

type OrderRecord = {
    productId?: string;
    status?: string;
    paymentStatus?: string;
};

type LicenseRecord = {
    productId?: string;
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
        return await adminAuth.verifyIdToken(
            token
        );
    } catch {
        return null;
    }
}

/*
|--------------------------------------------------------------------------
| GET /api/reviews?productId=PRODUCT_ID
|--------------------------------------------------------------------------
*/

export async function GET(
    request: NextRequest
) {
    try {
        const { searchParams } =
            new URL(request.url);

        const productId =
            searchParams.get(
                "productId"
            );

        if (!productId) {
            return NextResponse.json(
                {
                    error:
                        "Product ID is required.",
                },
                { status: 400 }
            );
        }

        const reviewsSnapshot =
            await adminDatabase
                .ref("reviews")
                .once("value");

        const data =
            reviewsSnapshot.val();

        if (!data) {
            return NextResponse.json(
                {
                    reviews: [],
                    averageRating: 0,
                    reviewCount: 0,
                },
                {
                    status: 200,
                    headers: {
                        "Cache-Control":
                            "no-store",
                    },
                }
            );
        }

        const reviews: Review[] =
            Object.entries(data)
                .map(
                    ([id, value]) => ({
                        id,
                        ...(value as Review),
                    })
                )
                .filter(
                    (review) =>
                        review.productId === productId &&
                        review.status === "published"
                )
                .sort(
                    (a, b) =>
                        Number(
                            b.createdAt ||
                            0
                        ) -
                        Number(
                            a.createdAt ||
                            0
                        )
                );

        const reviewCount =
            reviews.length;

        const averageRating =
            reviewCount > 0
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
                reviewCount
                : 0;

        return NextResponse.json(
            {
                reviews,
                averageRating:
                    Number(
                        averageRating.toFixed(
                            1
                        )
                    ),
                reviewCount,
            },
            {
                status: 200,
                headers: {
                    "Cache-Control":
                        "no-store",
                },
            }
        );
    } catch (error) {
        console.error(
            "REVIEWS GET ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    "Unable to load reviews.",
            },
            { status: 500 }
        );
    }
}

/*
|--------------------------------------------------------------------------
| POST /api/reviews
|--------------------------------------------------------------------------
*/

export async function POST(
    request: NextRequest
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

        const body =
            await request.json();

        const productId =
            typeof body?.productId ===
                "string"
                ? body.productId.trim()
                : "";

        const rating = Number(
            body?.rating
        );

        const title =
            typeof body?.title ===
                "string"
                ? body.title.trim()
                : "";

        const comment =
            typeof body?.comment ===
                "string"
                ? body.comment.trim()
                : "";

        if (!productId) {
            return NextResponse.json(
                {
                    error:
                        "Product ID is required.",
                },
                { status: 400 }
            );
        }

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

        /*
        |--------------------------------------------------------------------------
        | Verify product exists and is published
        |--------------------------------------------------------------------------
        */

        const productSnapshot =
            await adminDatabase
                .ref(
                    `bots/${productId}`
                )
                .once("value");

        const product =
            productSnapshot.val();

        if (
            !product ||
            product.status !==
            "published"
        ) {
            return NextResponse.json(
                {
                    error:
                        "Product not found.",
                },
                { status: 404 }
            );
        }

        /*
        |--------------------------------------------------------------------------
        | Prevent duplicate reviews
        |--------------------------------------------------------------------------
        */

        const reviewsSnapshot =
            await adminDatabase
                .ref("reviews")
                .once("value");

        const reviewsData =
            reviewsSnapshot.val() as Record<string, ReviewRecord> | null;

        if (reviewsData) {
            const existingReview =
                Object.values(
                    reviewsData
                ).find(
                    (value) =>
                        value?.productId ===
                        productId &&
                        value?.userId ===
                        user.uid &&
                        value?.status !==
                        "rejected"
                );

            if (existingReview) {
                return NextResponse.json(
                    {
                        error:
                            "You have already reviewed this product.",
                    },
                    { status: 409 }
                );
            }
        }

        /*
        |--------------------------------------------------------------------------
        | Verify purchase
        |--------------------------------------------------------------------------
        */

        let verifiedPurchase =
            false;

        const ordersSnapshot =
            await adminDatabase
                .ref(
                    `orders/${user.uid}`
                )
                .once("value");

        const orders =
            ordersSnapshot.val() as Record<string, OrderRecord> | null;

        if (orders) {
            verifiedPurchase =
                Object.values(
                    orders
                ).some(
                    (order) =>
                        order?.productId ===
                        productId &&
                        (
                            order?.status ===
                            "paid" ||
                            order?.paymentStatus ===
                            "paid"
                        )
                );
        }

        /*
        |--------------------------------------------------------------------------
        | License also counts as verified purchase
        |--------------------------------------------------------------------------
        */

        if (!verifiedPurchase) {
            const licensesSnapshot =
                await adminDatabase
                    .ref(
                        `licenses/${user.uid}`
                    )
                    .once("value");

            const licenses =
                licensesSnapshot.val() as Record<string, LicenseRecord> | null;

            if (licenses) {
                verifiedPurchase =
                    Object.values(
                        licenses
                    ).some(
                        (license) =>
                            license?.productId ===
                            productId
                    );
            }
        }

        /*
        |--------------------------------------------------------------------------
        | Create review
        |--------------------------------------------------------------------------
        */

        const reviewRef =
            adminDatabase
                .ref("reviews")
                .push();

        const now =
            Date.now();

        const review: Review = {
            id: reviewRef.key || "",
            productId,
            userId: user.uid,
            rating,
            title,
            comment,
            verifiedPurchase,
            status: "published",
            createdAt: now,
            updatedAt: now,
        };

        await reviewRef.set(
            review
        );
        const ratingSummary =
            await recalculateProductRating(
                productId
            );

        return NextResponse.json(
            {
                success: true,
                review,
                rating: ratingSummary,
            },
            { status: 201 }
        );
    } catch (error) {
        console.error(
            "REVIEW CREATE ERROR:",
            error
        );

        return NextResponse.json(
            {
                error:
                    "Unable to create review.",
            },
            { status: 500 }
        );
    }
}