import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { authenticate } from "@/lib/admin-auth";

export const runtime = "nodejs";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// ─── POST /api/trading/orders ───────────────────────────────────────────────

export async function POST(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json(
            { success: false, error: "Unauthorized." },
            { status: 401, headers: corsHeaders }
        );
    }

    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const accountId = String(body.accountId || "").trim();
        const clientOrderId = String(body.clientOrderId || "").trim();
        const symbol = String(body.symbol || "").trim();
        const action = String(body.action || "").trim().toUpperCase();
        const volume = Number(body.volume || 0);
        const price = body.price !== undefined ? Number(body.price) : undefined;
        const sl = body.sl !== undefined ? Number(body.sl) : undefined;
        const tp = body.tp !== undefined ? Number(body.tp) : undefined;
        const closeTicket = body.closeTicket !== undefined ? Number(body.closeTicket) : undefined;
        const closeVolume = body.closeVolume !== undefined ? Number(body.closeVolume) : undefined;

        if (!accountId || !clientOrderId || !symbol || !action) {
            return NextResponse.json(
                { success: false, error: "accountId, clientOrderId, symbol, and action are required." },
                { status: 400, headers: corsHeaders }
            );
        }

        const validActions = ["BUY", "SELL", "BUY_LIMIT", "SELL_LIMIT", "BUY_STOP", "SELL_STOP", "MODIFY", "CLOSE", "CLOSE_PARTIAL", "CANCEL"];
        if (!validActions.includes(action)) {
            return NextResponse.json(
                { success: false, error: "Invalid action." },
                { status: 400, headers: corsHeaders }
            );
        }

        const accountSnap = await adminDatabase
            .ref(`trading_accounts/${token.uid}/${accountId}`)
            .get();

        if (!accountSnap.exists()) {
            return NextResponse.json(
                { success: false, error: "Account not found or not owned by you." },
                { status: 404, headers: corsHeaders }
            );
        }

        const licensesSnap = await adminDatabase
            .ref(`trading_access/${token.uid}`)
            .get();

        const licenses = licensesSnap.val() || {};
        const now = Date.now();
        let hasActiveLicense = false;

        for (const [, raw] of Object.entries(licenses)) {
            if (!raw || typeof raw !== "object") continue;
            const license = raw as Record<string, unknown>;
            if (license.status === "active" && Number(license.expiresAt || 0) > now) {
                hasActiveLicense = true;
                break;
            }
        }

        if (!hasActiveLicense) {
            return NextResponse.json(
                { success: false, error: "No active trading access license." },
                { status: 403, headers: corsHeaders }
            );
        }

        const controlsSnap = await adminDatabase
            .ref(`trading_controls/${token.uid}/${accountId}`)
            .get();

        const controls = controlsSnap.val();
        if (controls?.emergencyStop === true && (action === "BUY" || action === "SELL")) {
            return NextResponse.json(
                { success: false, error: "Emergency stop is active. Cannot place new orders." },
                { status: 403, headers: corsHeaders }
            );
        }

        const existingSnap = await adminDatabase
            .ref(`trading_order_requests/${token.uid}/${clientOrderId}`)
            .get();

        if (existingSnap.exists()) {
            return NextResponse.json(
                { success: true, order: existingSnap.val(), duplicate: true },
                { status: 200, headers: corsHeaders }
            );
        }

        const orderRequest = {
            clientOrderId,
            accountId,
            symbol,
            action,
            volume,
            price: price ?? null,
            sl: sl ?? null,
            tp: tp ?? null,
            closeTicket: closeTicket ?? null,
            closeVolume: closeVolume ?? null,
            status: "queued",
            userId: token.uid,
            createdAt: now,
            updatedAt: now,
        };

        await adminDatabase
            .ref(`trading_order_requests/${token.uid}/${clientOrderId}`)
            .set(orderRequest);

        return NextResponse.json(
            { success: true, order: orderRequest },
            { status: 201, headers: corsHeaders }
        );
    } catch (error) {
        console.error("[trading/orders POST]", error);
        return NextResponse.json(
            { success: false, error: "Failed to place order." },
            { status: 500, headers: corsHeaders }
        );
    }
}

// ─── GET /api/trading/orders ────────────────────────────────────────────────

export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json(
            { success: false, error: "Unauthorized." },
            { status: 401, headers: corsHeaders }
        );
    }

    try {
        const url = new URL(request.url);
        const accountId = url.searchParams.get("accountId") || "";

        const ordersSnap = await adminDatabase
            .ref(`trading_order_requests/${token.uid}`)
            .get();

        const data = ordersSnap.val() || {};
        const orders: Array<Record<string, unknown>> = [];

        for (const [orderId, raw] of Object.entries(data)) {
            if (!raw || typeof raw !== "object") continue;
            const order = raw as Record<string, unknown>;
            if (accountId && String(order.accountId || "") !== accountId) continue;
            orders.push({ ...order, id: orderId });
        }

        orders.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

        return NextResponse.json({ orders }, { status: 200, headers: corsHeaders });
    } catch (error) {
        console.error("[trading/orders GET]", error);
        return NextResponse.json(
            { success: false, error: "Failed to load orders." },
            { status: 500, headers: corsHeaders }
        );
    }
}
