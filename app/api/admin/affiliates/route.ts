import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

async function verifyAdmin(request: NextRequest) {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
        throw new Error("Unauthorized");
    }

    const token = authorization.replace("Bearer ", "").trim();

    if (!token) {
        throw new Error("Unauthorized");
    }

    const decodedToken = await adminAuth.verifyIdToken(token);

    const userSnapshot = await adminDatabase
        .ref(`users/${decodedToken.uid}`)
        .get();

    if (!userSnapshot.exists()) {
        throw new Error("Admin access required");
    }

    const user = userSnapshot.val();

    if (user?.role !== "admin") {
        throw new Error("Admin access required");
    }

    return decodedToken;
}

function errorResponse(error: unknown) {
    const message =
        error instanceof Error
            ? error.message
            : "Internal server error";

    const status =
        message === "Unauthorized"
            ? 401
            : message === "Admin access required"
                ? 403
                : 500;

    return NextResponse.json(
        {
            success: false,
            error: message,
        },
        { status }
    );
}

/**
 * GET
 * Returns all affiliate offers.
 */
export async function GET(request: NextRequest) {
    try {
        await verifyAdmin(request);

        const snapshot = await adminDatabase
            .ref("affiliate_offers")
            .get();

        const data = snapshot.exists()
            ? snapshot.val()
            : {};

        const offers = Object.entries(data).map(
            ([id, value]) => {
                const offer = value as Record<string, unknown>;

                return {
                    id,
                    ...offer,
                };
            }
        );

        offers.sort((a: any, b: any) => {
            return (
                Number(b.updatedAt || b.createdAt || 0) -
                Number(a.updatedAt || a.createdAt || 0)
            );
        });

        return NextResponse.json(
            {
                success: true,
                offers,
            },
            {
                headers: {
                    "Cache-Control": "no-store",
                },
            }
        );
    } catch (error) {
        console.error("ADMIN AFFILIATES GET ERROR:", error);

        return errorResponse(error);
    }
}

/**
 * POST
 * Creates a new affiliate offer.
 */
export async function POST(request: NextRequest) {
    try {
        const decodedToken = await verifyAdmin(request);

        const body = await request.json();

        const {
            name,
            provider,
            description,
            affiliateUrl,
            category,
            status,
            commissionType,
            commissionValue,
            currency,
            featured,
        } = body;

        if (
            typeof name !== "string" ||
            !name.trim()
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Offer name is required.",
                },
                { status: 400 }
            );
        }

        if (
            typeof affiliateUrl !== "string" ||
            !affiliateUrl.trim()
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Affiliate URL is required.",
                },
                { status: 400 }
            );
        }

        let parsedUrl: URL;

        try {
            parsedUrl = new URL(affiliateUrl.trim());
        } catch {
            return NextResponse.json(
                {
                    success: false,
                    error: "Invalid affiliate URL.",
                },
                { status: 400 }
            );
        }

        if (parsedUrl.protocol !== "https:") {
            return NextResponse.json(
                {
                    success: false,
                    error: "Affiliate URL must use HTTPS.",
                },
                { status: 400 }
            );
        }

        const allowedCommissionTypes = [
            "percentage",
            "fixed",
        ];

        const finalCommissionType =
            allowedCommissionTypes.includes(
                commissionType
            )
                ? commissionType
                : "percentage";

        const parsedCommissionValue = Number(
            commissionValue ?? 0
        );

        if (
            !Number.isFinite(parsedCommissionValue) ||
            parsedCommissionValue < 0
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Invalid commission value.",
                },
                { status: 400 }
            );
        }

        if (
            finalCommissionType === "percentage" &&
            parsedCommissionValue > 100
        ) {
            return NextResponse.json(
                {
                    success: false,
                    error:
                        "Percentage commission cannot exceed 100.",
                },
                { status: 400 }
            );
        }

        const now = Date.now();

        const offerRef = adminDatabase
            .ref("affiliate_offers")
            .push();

        const offer = {
            name: name.trim(),
            provider:
                typeof provider === "string"
                    ? provider.trim()
                    : "",
            description:
                typeof description === "string"
                    ? description.trim()
                    : "",
            affiliateUrl:
                parsedUrl.toString(),
            category:
                typeof category === "string"
                    ? category.trim()
                    : "Other",
            status:
                status === "inactive"
                    ? "inactive"
                    : "active",
            commissionType:
                finalCommissionType,
            commissionValue:
                parsedCommissionValue,
            currency:
                typeof currency === "string" &&
                    currency.trim()
                    ? currency.trim().toUpperCase()
                    : "USD",
            featured: Boolean(featured),

            // Tracking counters are server controlled.
            clicks: 0,
            conversions: 0,

            createdAt: now,
            updatedAt: now,
            createdBy: decodedToken.uid,
        };

        await offerRef.set(offer);

        return NextResponse.json({
            success: true,
            offer: {
                id: offerRef.key,
                ...offer,
            },
        });
    } catch (error) {
        console.error("ADMIN AFFILIATES POST ERROR:", error);

        return errorResponse(error);
    }
}