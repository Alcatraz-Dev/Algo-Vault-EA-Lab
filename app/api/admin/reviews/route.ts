import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

async function requireAdmin(request: NextRequest) {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
        return null;
    }

    const token = authorization.substring(7).trim();

    if (!token) {
        return null;
    }

    try {
        const user = await adminAuth.verifyIdToken(token);

        const userSnapshot = await adminDatabase
            .ref(`users/${user.uid}`)
            .once("value");

        const profile = userSnapshot.val();

        if (profile?.role !== "admin") {
            return null;
        }

        return user;
    } catch {
        return null;
    }
}

/** A product review record stored under productReviews/{id} (or similar). */
interface ReviewRecord {
    productId?: string;
    userId?: string;
    createdAt?: number | string;
    status?: string;
    rating?: number;
    text?: string;
    updatedAt?: number | string;
}

export async function GET(request: NextRequest) {
    try {
        const admin = await requireAdmin(request);

        if (!admin) {
            return NextResponse.json(
                { error: "Admin access required." },
                { status: 403 }
            );
        }

        const [reviewsSnapshot, botsSnapshot, usersSnapshot] =
            await Promise.all([
                adminDatabase.ref("reviews").once("value"),
                adminDatabase.ref("bots").once("value"),
                adminDatabase.ref("users").once("value"),
            ]);

        const reviewsData = (reviewsSnapshot.val() ?? {}) as Record<string, ReviewRecord>;
        const botsData = (botsSnapshot.val() ?? {}) as Record<string, { name?: string; slug?: string; platform?: string }>;
        const usersData = (usersSnapshot.val() ?? {}) as Record<string, { displayName?: string; email?: string }>;

        const reviews = Object.entries(reviewsData)
            .map(([id, value]) => {
                const product = botsData[value.productId ?? ""];
                const user = usersData[value.userId ?? ""];

                return {
                    id,
                    ...value,
                    productName:
                        product?.name ||
                        value.productId ||
                        "Unknown Product",
                    productSlug: product?.slug || "",
                    platform: product?.platform || "",
                    userName:
                        user?.displayName ||
                        "Trader",
                    userEmail:
                        user?.email || "",
                };
            })
            .sort(
                (a, b) =>
                    Number(b.createdAt || 0) -
                    Number(a.createdAt || 0)
            );

        const summary = {
            total: reviews.length,
            published: reviews.filter(
                (r) => r.status === "published"
            ).length,
            pending: reviews.filter(
                (r) => r.status === "pending"
            ).length,
            rejected: reviews.filter(
                (r) => r.status === "rejected"
            ).length,
        };

        return NextResponse.json(
            {
                reviews,
                summary,
            },
            {
                status: 200,
                headers: {
                    "Cache-Control": "no-store",
                },
            }
        );
    } catch (error) {
        console.error("ADMIN REVIEWS GET ERROR:", error);

        return NextResponse.json(
            { error: "Unable to load reviews." },
            { status: 500 }
        );
    }
}