import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";

/**
 * POST /api/developer/request
 *
 * Authenticated user submits a request to become a developer.
 * Stored in developer_requests/{uid}. Overwrites any prior pending request.
 */
export async function POST(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const uid = token.uid;

    const userSnap = await adminDatabase.ref(`users/${uid}`).get();
    const userData = userSnap.val() || {};

    if (userData.role === "developer" || userData.role === "admin") {
        return NextResponse.json({ error: "You already have developer access." }, { status: 409 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const message = String(body.message || "").trim().slice(0, 2000);

    const now = Date.now();
    const record = {
        uid,
        status: "pending",
        message: message || null,
        requestedAt: now,
        updatedAt: now,
    };

    await adminDatabase.ref(`developer_requests/${uid}`).set(record);

    // Notify admins (find all admin users)
    try {
        const usersSnap = await adminDatabase.ref("users").get();
        const users = usersSnap.val() || {};
        for (const [adminUid, raw] of Object.entries(users as Record<string, Record<string, unknown>>)) {
            if (raw && raw.role === "admin" && adminUid !== uid) {
                void (await import("@/lib/notifications")).notifyUser(adminUid, {
                    title: "Developer Access Request",
                    message: `${userData.displayName || userData.email || uid} requested developer access.`,
                    level: "info",
                    link: `${process.env.NEXT_PUBLIC_APP_URL || ""}/admin/developers`,
                });
            }
        }
    } catch {
        // non-critical
    }

    return NextResponse.json({ success: true, request: record });
}

/**
 * GET /api/developer/request
 *
 * Returns the current user's developer request status.
 */
export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const snap = await adminDatabase.ref(`developer_requests/${token.uid}`).get();
    const requestRecord = snap.val() || null;

    const userSnap = await adminDatabase.ref(`users/${token.uid}`).get();
    const role = (userSnap.val() || {}).role || "";

    return NextResponse.json({
        success: true,
        role,
        request: requestRecord,
    });
}
