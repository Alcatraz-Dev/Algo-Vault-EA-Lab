import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type AnyRecord = Record<string, unknown>;

/**
 * GET /api/admin/developer-requests
 *
 * Lists all pending developer requests for admin review.
 */
export async function GET(request: NextRequest) {
    const token = await requireAdmin(request);
    if (!token) {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const snap = await adminDatabase.ref("developer_requests").get();
    const requests = snap.val() || {};
    const rows: AnyRecord[] = [];

    for (const [uid, raw] of Object.entries(requests as Record<string, AnyRecord>)) {
        if (!raw || typeof raw !== "object") continue;

        let email = "";
        let displayName = "";
        try {
            const fbUser = await adminAuth.getUser(uid);
            email = fbUser.email || "";
            displayName = fbUser.displayName || "";
        } catch {
            // auth lookup can fail for deleted users
        }

        const userSnap = await adminDatabase.ref(`users/${uid}`).get();
        const userData = userSnap.val() || {};

        rows.push({
            uid,
            email: (raw.email as string) || (userData as AnyRecord).email as string || email || "",
            displayName: (raw.displayName as string) || (userData as AnyRecord).displayName as string || displayName || "",
            status: raw.status || "pending",
            message: raw.message || null,
            requestedAt: raw.requestedAt || null,
            resolvedAt: raw.resolvedAt || null,
            currentRole: (userData as AnyRecord).role || "",
        });
    }

    rows.sort((a, b) => Number(b.requestedAt || 0) - Number(a.requestedAt || 0));

    return NextResponse.json({
        success: true,
        requests: rows,
        pendingCount: rows.filter((r) => r.status === "pending").length,
    });
}

/**
 * POST /api/admin/developer-requests
 *
 * Approve or reject a developer request.
 * Body: { uid: string, action: "approve" | "reject" }
 */
export async function POST(request: NextRequest) {
    const token = await requireAdmin(request);
    if (!token) {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const uid = String(body.uid || "").trim();
    const action = String(body.action || "").trim();

    if (!uid || (action !== "approve" && action !== "reject")) {
        return NextResponse.json({ error: "uid and action (approve|reject) are required." }, { status: 400 });
    }

    const requestSnap = await adminDatabase.ref(`developer_requests/${uid}`).get();
    if (!requestSnap.exists()) {
        return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    const now = Date.now();

    if (action === "approve") {
        await adminDatabase.ref(`users/${uid}`).update({
            role: "developer",
            developerApproved: true,
            developerStatus: "approved",
            approvedAt: now,
        });
        await adminDatabase.ref(`developer_requests/${uid}`).update({
            status: "approved",
            resolvedAt: now,
            resolvedBy: token.uid,
            updatedAt: now,
        });

        // Notify the user
        const { notifyUser } = await import("@/lib/notifications");
        void notifyUser(uid, {
            title: "Developer Access Granted",
            message: "Your developer request has been approved. You can now access the Developer Dashboard and connect your Stripe account.",
            level: "success",
            link: `${process.env.NEXT_PUBLIC_APP_URL || ""}/developer/dashboard`,
        });

        return NextResponse.json({ success: true, status: "approved" });
    }

    // reject
    await adminDatabase.ref(`developer_requests/${uid}`).update({
        status: "rejected",
        resolvedAt: now,
        resolvedBy: token.uid,
        updatedAt: now,
    });

    const { notifyUser } = await import("@/lib/notifications");
    void notifyUser(uid, {
        title: "Developer Request Update",
        message: "Your developer access request was not approved at this time.",
        level: "warning",
    });

    return NextResponse.json({ success: true, status: "rejected" });
}
