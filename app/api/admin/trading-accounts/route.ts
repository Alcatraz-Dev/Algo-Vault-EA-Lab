import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// ─── GET /api/admin/trading-accounts ────────────────────────────────────────

export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    try {
        const snapshot = await adminDatabase.ref("trading_accounts").get();
        const data = snapshot.val() || {};

        const accounts: Array<Record<string, unknown>> = [];

        for (const [userId, userAccounts] of Object.entries(data)) {
            if (!userAccounts || typeof userAccounts !== "object") continue;
            for (const [accountId, account] of Object.entries(
                userAccounts as Record<string, Record<string, unknown>>
            )) {
                if (!account || typeof account !== "object") continue;
                accounts.push({ ...account, accountId, userId });
            }
        }

        accounts.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

        return NextResponse.json({ accounts });
    } catch (error) {
        console.error("[admin/trading-accounts GET]", error);
        return NextResponse.json(
            { error: "Failed to load trading accounts." },
            { status: 500 }
        );
    }
}

// ─── PATCH /api/admin/trading-accounts ──────────────────────────────────────

export async function PATCH(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const userId = String(body.userId || "").trim();
        const accountId = String(body.accountId || "").trim();
        const status = String(body.status || "").trim();

        if (!userId || !accountId || !status) {
            return NextResponse.json({ error: "userId, accountId, and status are required." }, { status: 400 });
        }

        const allowedStatuses = ["disabled", "connected"];
        if (!allowedStatuses.includes(status)) {
            return NextResponse.json({ error: "Invalid status." }, { status: 400 });
        }

        await adminDatabase
            .ref(`trading_accounts/${userId}/${accountId}`)
            .update({ status, updatedAt: Date.now() });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[admin/trading-accounts PATCH]", error);
        return NextResponse.json(
            { error: "Failed to update trading account." },
            { status: 500 }
        );
    }
}

// ─── DELETE /api/admin/trading-accounts ─────────────────────────────────────

export async function DELETE(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const userId = String(body.userId || "").trim();
        const accountId = String(body.accountId || "").trim();

        if (!userId || !accountId) {
            return NextResponse.json({ error: "userId and accountId are required." }, { status: 400 });
        }

        await adminDatabase
            .ref(`trading_accounts/${userId}/${accountId}`)
            .update({ status: "unauthorized", updatedAt: Date.now() });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[admin/trading-accounts DELETE]", error);
        return NextResponse.json(
            { error: "Failed to revoke trading account." },
            { status: 500 }
        );
    }
}
