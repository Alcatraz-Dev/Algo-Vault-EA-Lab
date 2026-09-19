import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { authenticate, requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";

type TradingAccessLicense = {
    id: string;
    userId: string;
    userEmail: string;
    status: "active" | "expired" | "revoked";
    plan: string;
    maxAccounts: number;
    startedAt: number;
    expiresAt: number;
    createdAt: number;
    updatedAt: number;
};

// ─── GET /api/trading/access ────────────────────────────────────────────────

export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
        const admin = await requireAdmin(request);

        if (admin) {
            const snapshot = await adminDatabase.ref("trading_access").get();
            const data = snapshot.val() || {};

            const licenses: TradingAccessLicense[] = [];

            for (const [userId, userLicenses] of Object.entries(data)) {
                if (!userLicenses || typeof userLicenses !== "object") continue;
                for (const [licenseId, license] of Object.entries(
                    userLicenses as Record<string, TradingAccessLicense>
                )) {
                    if (!license || typeof license !== "object") continue;
                    licenses.push({
                        ...license,
                        id: licenseId,
                        userId,
                    });
                }
            }

            licenses.sort((a, b) => b.createdAt - a.createdAt);

            return NextResponse.json({ licenses });
        }

        const snapshot = await adminDatabase
            .ref(`trading_access/${token.uid}`)
            .get();

        const data = snapshot.val() || {};
        const licenses: TradingAccessLicense[] = [];

        for (const [licenseId, license] of Object.entries(data)) {
            if (!license || typeof license !== "object") continue;
            licenses.push({
                ...(license as TradingAccessLicense),
                id: licenseId,
                userId: token.uid,
            });
        }

        licenses.sort((a, b) => b.createdAt - a.createdAt);

        return NextResponse.json({ licenses });
    } catch (error) {
        console.error("[trading/access GET]", error);
        return NextResponse.json(
            { error: "Failed to load trading access licenses." },
            { status: 500 }
        );
    }
}

// ─── POST /api/trading/access ───────────────────────────────────────────────

export async function POST(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
        const now = Date.now();
        const licenseId = `ta_${now}`;
        const durationMs = 365 * 24 * 60 * 60 * 1000;

        const newLicense: Omit<TradingAccessLicense, "id" | "userId"> & {
            id: string;
            userId: string;
        } = {
            id: licenseId,
            userId: token.uid,
            userEmail: token.email || "",
            status: "active",
            plan: "trading",
            maxAccounts: 1,
            startedAt: now,
            expiresAt: now + durationMs,
            createdAt: now,
            updatedAt: now,
        };

        await adminDatabase
            .ref(`trading_access/${token.uid}/${licenseId}`)
            .set(newLicense);

        return NextResponse.json({ success: true, license: newLicense });
    } catch (error) {
        console.error("[trading/access POST]", error);
        return NextResponse.json(
            { error: "Failed to create trading access license." },
            { status: 500 }
        );
    }
}

// ─── PATCH /api/trading/access ──────────────────────────────────────────────

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
        console.error("[trading/access PATCH]", error);
        return NextResponse.json(
            { error: "Failed to update trading access license." },
            { status: 500 }
        );
    }
}
