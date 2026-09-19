import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

// ============================================
// GET: List notifications for user
// ============================================

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const unreadOnly = searchParams.get("unread") === "true";
        const limit = Number(searchParams.get("limit")) || 50;

        let ref = adminDatabase.ref(`notifications/${user.uid}`).limitToLast(limit * 2);

        const snapshot = await ref.get();
        if (!snapshot.exists()) return NextResponse.json({ success: true, notifications: [], unreadCount: 0 });

        const notifications: { id: string; [key: string]: unknown }[] = [];
        let unreadCount = 0;

        snapshot.forEach((child) => {
            const notif = child.val();
            const id = child.key!;

            if (unreadOnly && notif.read) return;

            if (!notif.read) unreadCount++;

            notifications.push({ id, ...notif });
        });

        // Sort newest first
        notifications.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

        return NextResponse.json({
            success: true,
            notifications: notifications.slice(0, limit),
            unreadCount,
        });
    } catch (err) {
        console.error("Notifications GET error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

// ============================================
// PUT: Mark notification(s) as read
// ============================================

export async function PUT(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { notificationId, markAll } = body;

        if (markAll) {
            const snapshot = await adminDatabase.ref(`notifications/${user.uid}`).get();
            if (snapshot.exists()) {
                const updates: Record<string, boolean> = {};
                snapshot.forEach((child) => {
                    if (!child.val().read) {
                        updates[`${child.key}/read`] = true;
                    }
                });
                if (Object.keys(updates).length > 0) {
                    await adminDatabase.ref(`notifications/${user.uid}`).update(updates);
                }
            }
            return NextResponse.json({ success: true });
        }

        if (notificationId) {
            await adminDatabase.ref(`notifications/${user.uid}/${notificationId}`).update({ read: true });
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "notificationId or markAll required" }, { status: 400 });
    } catch (err) {
        console.error("Notifications PUT error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

// ============================================
// DELETE: Remove notification
// ============================================

export async function DELETE(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const notificationId = searchParams.get("notificationId");
        const clearAll = searchParams.get("clearAll") === "true";

        if (clearAll) {
            await adminDatabase.ref(`notifications/${user.uid}`).remove();
            return NextResponse.json({ success: true });
        }

        if (!notificationId) return NextResponse.json({ error: "notificationId or clearAll required" }, { status: 400 });

        await adminDatabase.ref(`notifications/${user.uid}/${notificationId}`).remove();
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Notifications DELETE error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
