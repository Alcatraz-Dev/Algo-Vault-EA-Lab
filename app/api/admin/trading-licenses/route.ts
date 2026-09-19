import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { requireAdmin, errMessage } from "@/lib/admin-auth";

export const runtime = "nodejs";

// ─── GET /api/admin/trading-licenses ────────────────────────────────────────

export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    try {
        const snapshot = await adminDatabase.ref("trading_access").get();
        const data = snapshot.val() || {};

        const licenses: Array<Record<string, unknown>> = [];

        for (const [userId, userLicenses] of Object.entries(data)) {
            if (!userLicenses || typeof userLicenses !== "object") continue;
            for (const [licenseId, license] of Object.entries(
                userLicenses as Record<string, Record<string, unknown>>
            )) {
                if (!license || typeof license !== "object") continue;
                licenses.push({ ...license, id: licenseId, userId });
            }
        }

        licenses.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

        return NextResponse.json({ licenses });
    } catch (error) {
        console.error("[admin/trading-licenses GET]", error);
        return NextResponse.json(
            { error: errMessage(error, "Failed to load trading licenses.") },
            { status: 500 }
        );
    }
}

// ─── POST /api/admin/trading-licenses ───────────────────────────────────────

export async function POST(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const userEmail = String(body.userEmail || "").trim();
        const durationDays = Number(body.durationDays || 365);
        const maxAccounts = Number(body.maxAccounts || 1);

        if (!userEmail) {
            return NextResponse.json({ error: "userEmail is required." }, { status: 400 });
        }

        let user;
        try {
            user = await adminAuth.getUserByEmail(userEmail);
        } catch {
            return NextResponse.json(
                { error: "No account found with that email address." },
                { status: 404 }
            );
        }

        const userId = user.uid;
        const now = Date.now();
        const licenseId = `ta_${now}`;
        const durationMs = durationDays * 24 * 60 * 60 * 1000;

        const newLicense = {
            id: licenseId,
            userId,
            userEmail: user.email || userEmail,
            status: "active",
            plan: "trading",
            maxAccounts,
            startedAt: now,
            expiresAt: now + durationMs,
            createdAt: now,
            updatedAt: now,
        };

        await adminDatabase
            .ref(`trading_access/${userId}/${licenseId}`)
            .set(newLicense);

        return NextResponse.json({ success: true, license: newLicense });
    } catch (error) {
        console.error("[admin/trading-licenses POST]", error);
        return NextResponse.json(
            { error: errMessage(error, "Failed to create trading license.") },
            { status: 500 }
        );
    }
}

// ─── PATCH /api/admin/trading-licenses ──────────────────────────────────────

export async function PATCH(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const userId = String(body.userId || "").trim();
        const licenseId = String(body.licenseId || "").trim();
        const status = String(body.status || "").trim();
        const maxAccounts = body.maxAccounts !== undefined ? Number(body.maxAccounts) : undefined;

        if (!userId || !licenseId) {
            return NextResponse.json({ error: "userId and licenseId are required." }, { status: 400 });
        }

        const allowedStatuses = ["active", "expired", "revoked"];
        if (status && !allowedStatuses.includes(status)) {
            return NextResponse.json({ error: "Invalid status." }, { status: 400 });
        }

        const updates: Record<string, unknown> = { updatedAt: Date.now() };
        if (status) updates.status = status;
        if (maxAccounts !== undefined && maxAccounts >= 1) updates.maxAccounts = maxAccounts;

        await adminDatabase
            .ref(`trading_access/${userId}/${licenseId}`)
            .update(updates);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[admin/trading-licenses PATCH]", error);
        return NextResponse.json(
            { error: errMessage(error, "Failed to update trading license.") },
            { status: 500 }
        );
    }
}
