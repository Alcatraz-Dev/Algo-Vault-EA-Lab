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

        if (userSnapshot.val()?.role !== "admin") {
            return null;
        }

        return user;
    } catch {
        return null;
    }
}

export async function PATCH(
    request: NextRequest,
    context: {
        params: Promise<{ id: string }>;
    }
) {
    try {
        const admin = await requireAdmin(request);

        if (!admin) {
            return NextResponse.json(
                { error: "Admin access required." },
                { status: 403 }
            );
        }

        const { id } = await context.params;

        if (!id) {
            return NextResponse.json(
                { error: "Review ID is required." },
                { status: 400 }
            );
        }

        const body = await request.json();

        const status = body?.status;

        if (
            status !== "published" &&
            status !== "pending" &&
            status !== "rejected"
        ) {
            return NextResponse.json(
                { error: "Invalid review status." },
                { status: 400 }
            );
        }

        const reviewRef = adminDatabase.ref(
            `reviews/${id}`
        );

        const snapshot = await reviewRef.once("value");

        if (!snapshot.exists()) {
            return NextResponse.json(
                { error: "Review not found." },
                { status: 404 }
            );
        }

        await reviewRef.update({
            status,
            updatedAt: Date.now(),
            moderatedAt: Date.now(),
            moderatedBy: admin.uid,
        });

        return NextResponse.json({
            success: true,
            status,
        });
    } catch (error) {
        console.error(
            "ADMIN REVIEW UPDATE ERROR:",
            error
        );

        return NextResponse.json(
            { error: "Unable to update review." },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    context: {
        params: Promise<{ id: string }>;
    }
) {
    try {
        const admin = await requireAdmin(request);

        if (!admin) {
            return NextResponse.json(
                { error: "Admin access required." },
                { status: 403 }
            );
        }

        const { id } = await context.params;

        if (!id) {
            return NextResponse.json(
                { error: "Review ID is required." },
                { status: 400 }
            );
        }

        const reviewRef = adminDatabase.ref(
            `reviews/${id}`
        );

        const snapshot = await reviewRef.once("value");

        if (!snapshot.exists()) {
            return NextResponse.json(
                { error: "Review not found." },
                { status: 404 }
            );
        }

        await reviewRef.remove();

        return NextResponse.json({
            success: true,
        });
    } catch (error) {
        console.error(
            "ADMIN REVIEW DELETE ERROR:",
            error
        );

        return NextResponse.json(
            { error: "Unable to delete review." },
            { status: 500 }
        );
    }
}