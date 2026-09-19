import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { attachCopiedMt5Ticket } from "@/lib/copy-trading";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: corsHeaders,
    });
}

// GET: MT5 EA polls pending signal orders for an account
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const mt5Account = String(searchParams.get("mt5Account") || searchParams.get("account") || "").trim();

        if (!mt5Account) {
            return NextResponse.json(
                { success: false, error: "mt5Account is required" },
                { status: 400, headers: corsHeaders }
            );
        }

        const snapshot = await adminDatabase
            .ref(`mt5_orders/${mt5Account}`)
            .get();

        const data = snapshot.val() || {};
        const pendingOrders: any[] = [];

        for (const ticket of Object.keys(data)) {
            const item = data[ticket];
            if (item && (item.status === "PENDING_MT5_EXECUTION" || item.status === "SENT_TO_MT5")) {
                pendingOrders.push(item);
            }
        }

        return NextResponse.json(
            {
                success: true,
                mt5Account,
                count: pendingOrders.length,
                orders: pendingOrders,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: any) {
        console.error("GET ORDERS ERROR:", err);
        return NextResponse.json(
            { success: false, error: err?.message || "Failed to fetch orders" },
            { status: 500, headers: corsHeaders }
        );
    }
}

// POST: MT5 EA acknowledges or updates order execution status (e.g. EXECUTED / FAILED)
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { mt5Account, ticket, status = "EXECUTED", mt5Ticket, error } = body;

        if (!mt5Account || !ticket) {
            return NextResponse.json(
                { success: false, error: "mt5Account and ticket are required" },
                { status: 400, headers: corsHeaders }
            );
        }

        const orderRef = adminDatabase.ref(`mt5_orders/${mt5Account}/${ticket}`);
        const existing = (await orderRef.get()).val();

        if (!existing) {
            return NextResponse.json(
                { success: false, error: "Order not found" },
                { status: 404, headers: corsHeaders }
            );
        }

        const now = Date.now();
        const updateData = {
            status: String(status).toUpperCase(),
            mt5Ticket: mt5Ticket ? String(mt5Ticket) : existing.ticket,
            executedAt: now,
            updatedAt: now,
            error: error || null,
        };

        await orderRef.update(updateData);

        if (String(status).toUpperCase() === "EXECUTED" && existing.source === "copy_follower") {
            await attachCopiedMt5Ticket({
                mt5Account: String(mt5Account),
                ticket: String(ticket),
                mt5Ticket: String(updateData.mt5Ticket),
            });
        }

        return NextResponse.json(
            {
                success: true,
                ticket,
                status: updateData.status,
                message: `Order #${ticket} status updated to ${updateData.status}`,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (err: any) {
        console.error("UPDATE ORDER ERROR:", err);
        return NextResponse.json(
            { success: false, error: err?.message || "Failed to update order" },
            { status: 500, headers: corsHeaders }
        );
    }
}
