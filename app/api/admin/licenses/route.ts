import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { errMessage } from "@/lib/admin-auth";

// ─── helpers ────────────────────────────────────────────────────────────────

async function verifyAdmin(request: NextRequest) {
    const auth = request.headers.get("authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return null;

    try {
        const token = await adminAuth.verifyIdToken(auth.slice(7));
        const userSnapshot = await adminDatabase.ref(`users/${token.uid}`).get();
        if (userSnapshot.val()?.role !== "admin") return null;
        return token;
    } catch {
        return null;
    }
}

function unauthorized() {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function randHex() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// ─── GET /api/admin/licenses — all licenses across all users ────────────────

export async function GET(request: NextRequest) {
    const token = await verifyAdmin(request);
    if (!token) return unauthorized();

    try {
        const [licensesSnap, usersSnap, botsSnap] = await Promise.all([
            adminDatabase.ref("licenses").get(),
            adminDatabase.ref("users").get(),
            adminDatabase.ref("bots").get(),
        ]);

        const data = licensesSnap.val() as
            | Record<string, Record<string, Record<string, unknown>>>
            | undefined;
        const usersData = (usersSnap.val() || {}) as Record<string, { email?: string }>;
        const botsData = (botsSnap.val() || {}) as Record<string, { name?: string }>;

        const licenses: Array<Record<string, unknown>> = [];

        for (const [ownerKey, value] of Object.entries(data || {})) {
            if (!value || typeof value !== "object") continue;

            // Legacy flat licenses were written at licenses/{licId} (no userId).
            const isFlatLicense = "licenseKey" in value;

            if (isFlatLicense) {
                const lic = value as Record<string, unknown>;
                const productId = String(lic.productId || "");
                const ownerId = String(lic.userId || "");
                licenses.push({
                    id: ownerKey,
                    userId: ownerId,
                    userEmail:
                        lic.userEmail ||
                        (ownerId ? usersData[ownerId]?.email : "") ||
                        "—",
                    productName:
                        botsData[productId]?.name ||
                        lic.productName ||
                        "Unknown Product",
                    ...lic,
                });
                continue;
            }

            // Real structure: licenses/{userId}/{licenseId}
            for (const [licenseId, lic] of Object.entries(value)) {
                if (!lic || typeof lic !== "object") continue;
                const productId = String((lic as Record<string, unknown>).productId || "");
                licenses.push({
                    id: licenseId,
                    userId: ownerKey,
                    userEmail: usersData[ownerKey]?.email || "—",
                    productName:
                        botsData[productId]?.name ||
                        (lic as Record<string, unknown>).productName ||
                        "Unknown Product",
                    ...lic,
                });
            }
        }

        licenses.sort(
            (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0)
        );

        return NextResponse.json({ licenses });
    } catch (error) {
        console.error("[admin/licenses GET]", error);
        return NextResponse.json(
            { error: errMessage(error, "Failed to load licenses") },
            { status: 500 }
        );
    }
}

// ─── POST /api/admin/licenses — generate a manual license ───────────────────

export async function POST(request: NextRequest) {
    const token = await verifyAdmin(request);
    if (!token) return unauthorized();

    try {
        const body = await request.json();
        const { userEmail, productName, productId, durationDays } = body as {
            userEmail?: string;
            productName?: string;
            productId?: string;
            durationDays?: number;
        };

        if (!userEmail || !productName || !productId) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Resolve the account by email so the license is stored in the
        // user's own branch: licenses/{userId}/{licenseId}
        let user;
        try {
            user = await adminAuth.getUserByEmail(userEmail.trim());
        } catch {
            return NextResponse.json(
                { error: "No account found with that email address." },
                { status: 404 }
            );
        }

        const userId = user.uid;
        const newId = `lic_${Date.now()}`;
        const licenseKey = `ALG-${randHex()}${randHex()}-${randHex()}`;
        const days = Number(durationDays ?? 365);
        const expiresAt = days > 0 ? Date.now() + days * 86_400_000 : null;

        const newLicense = {
            id: newId,
            licenseKey,
            userEmail: user.email || userEmail.trim(),
            productName,
            productId,
            status: "active",
            startedAt: Date.now(),
            createdAt: Date.now(),
            expiresAt,
            maxAccounts: 2,
        };

        await adminDatabase.ref(`licenses/${userId}/${newId}`).set(newLicense);

        return NextResponse.json({ id: newId, licenseKey, success: true });
    } catch (error) {
        console.error("[admin/licenses POST]", error);
        return NextResponse.json(
            { error: errMessage(error, "Failed to generate license") },
            { status: 500 }
        );
    }
}

// ─── PATCH /api/admin/licenses — revoke / update a license ──────────────────

export async function PATCH(request: NextRequest) {
    const token = await verifyAdmin(request);
    if (!token) return unauthorized();

    try {
        const body = await request.json();
        const { id, userId, status } = body as {
            id?: string;
            userId?: string;
            status?: string;
        };

        if (!id || !status) {
            return NextResponse.json({ error: "Missing id or status" }, { status: 400 });
        }

        const allowed = ["active", "revoked", "expired"];
        if (!allowed.includes(status)) {
            return NextResponse.json({ error: "Invalid status" }, { status: 400 });
        }

        const ref = userId
            ? `licenses/${userId}/${id}`
            : `licenses/${id}`;

        await adminDatabase.ref(ref).update({ status, updatedAt: Date.now() });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[admin/licenses PATCH]", error);
        return NextResponse.json(
            { error: errMessage(error, "Failed to update license") },
            { status: 500 }
        );
    }
}