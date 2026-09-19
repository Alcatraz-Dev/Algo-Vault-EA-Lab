import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

async function verifyAdmin(request: NextRequest) {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
        throw new Error("Unauthorized");
    }

    const token = authorization.replace("Bearer ", "").trim();

    const decodedToken =
        await adminAuth.verifyIdToken(token);

    const userSnapshot = await adminDatabase
        .ref(`users/${decodedToken.uid}`)
        .get();

    if (
        !userSnapshot.exists() ||
        userSnapshot.val()?.role !== "admin"
    ) {
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

type Params = {
    params: Promise<{
        id: string;
    }>;
};

/**
 * PATCH
 * Updates an affiliate offer.
 */
export async function PATCH(
    request: NextRequest,
    { params }: Params
) {
    try {
        await verifyAdmin(request);

        const { id } = await params;

        if (!id) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Offer ID is required.",
                },
                { status: 400 }
            );
        }

        const offerRef = adminDatabase.ref(
            `affiliate_offers/${id}`
        );

        const snapshot = await offerRef.get();

        if (!snapshot.exists()) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Affiliate offer not found.",
                },
                { status: 404 }
            );
        }

        const existing =
            snapshot.val() as Record<string, unknown>;

        const body = await request.json();

        const updates: Record<string, unknown> = {};

        if (body.name !== undefined) {
            if (
                typeof body.name !== "string" ||
                !body.name.trim()
            ) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "Offer name cannot be empty.",
                    },
                    { status: 400 }
                );
            }

            updates.name = body.name.trim();
        }

        if (body.provider !== undefined) {
            updates.provider =
                typeof body.provider === "string"
                    ? body.provider.trim()
                    : "";
        }

        if (body.description !== undefined) {
            updates.description =
                typeof body.description === "string"
                    ? body.description.trim()
                    : "";
        }

        if (body.category !== undefined) {
            updates.category =
                typeof body.category === "string"
                    ? body.category.trim()
                    : "Other";
        }

        if (body.status !== undefined) {
            if (
                body.status !== "active" &&
                body.status !== "inactive"
            ) {
                return NextResponse.json(
                    {
                        success: false,
                        error: "Invalid status.",
                    },
                    { status: 400 }
                );
            }

            updates.status = body.status;
        }

        if (body.featured !== undefined) {
            updates.featured = Boolean(body.featured);
        }

        if (body.affiliateUrl !== undefined) {
            if (
                typeof body.affiliateUrl !== "string" ||
                !body.affiliateUrl.trim()
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
                parsedUrl = new URL(
                    body.affiliateUrl.trim()
                );
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
                        error:
                            "Affiliate URL must use HTTPS.",
                    },
                    { status: 400 }
                );
            }

            updates.affiliateUrl =
                parsedUrl.toString();
        }

        if (body.commissionType !== undefined) {
            if (
                body.commissionType !== "percentage" &&
                body.commissionType !== "fixed"
            ) {
                return NextResponse.json(
                    {
                        success: false,
                        error:
                            "Invalid commission type.",
                    },
                    { status: 400 }
                );
            }

            updates.commissionType =
                body.commissionType;
        }

        if (body.commissionValue !== undefined) {
            const value = Number(
                body.commissionValue
            );

            if (
                !Number.isFinite(value) ||
                value < 0
            ) {
                return NextResponse.json(
                    {
                        success: false,
                        error:
                            "Invalid commission value.",
                    },
                    { status: 400 }
                );
            }

            const type =
                body.commissionType ??
                existing.commissionType ??
                "percentage";

            if (
                type === "percentage" &&
                value > 100
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

            updates.commissionValue = value;
        }

        if (body.currency !== undefined) {
            updates.currency =
                typeof body.currency === "string" &&
                    body.currency.trim()
                    ? body.currency
                        .trim()
                        .toUpperCase()
                    : "USD";
        }

        updates.updatedAt = Date.now();

        await offerRef.update(updates);

        const updatedSnapshot =
            await offerRef.get();

        return NextResponse.json({
            success: true,
            offer: {
                id,
                ...updatedSnapshot.val(),
            },
        });
    } catch (error) {
        console.error(
            "ADMIN AFFILIATES PATCH ERROR:",
            error
        );

        return errorResponse(error);
    }
}

/**
 * DELETE
 * Deletes an affiliate offer.
 */
export async function DELETE(
    request: NextRequest,
    { params }: Params
) {
    try {
        await verifyAdmin(request);

        const { id } = await params;

        if (!id) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Offer ID is required.",
                },
                { status: 400 }
            );
        }

        const offerRef = adminDatabase.ref(
            `affiliate_offers/${id}`
        );

        const snapshot = await offerRef.get();

        if (!snapshot.exists()) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Affiliate offer not found.",
                },
                { status: 404 }
            );
        }

        await offerRef.remove();

        return NextResponse.json({
            success: true,
            deletedId: id,
        });
    } catch (error) {
        console.error(
            "ADMIN AFFILIATES DELETE ERROR:",
            error
        );

        return errorResponse(error);
    }
}