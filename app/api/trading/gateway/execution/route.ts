import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { verifyGatewayToken, resolveGatewayToken } from "@/lib/gateway";
import { attachCopiedMt5Ticket } from "@/lib/copy-trading";

export const runtime = "nodejs";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const gatewayToken = resolveGatewayToken(request.headers.get("authorization"), body);
        const clientOrderId = String(body.clientOrderId || body.commandId || "").trim();
        const mt5Ticket = String(body.mt5Ticket || body.order || "").trim();
        const executionPrice = Number(body.executionPrice || body.price || 0);
        const volume = Number(body.volume || 0);
        const symbol = String(body.symbol || "").trim();
        const retcode = Number(body.errorCode || body.retcode || 0);
        const errorMessage = String(body.errorMessage || body.retcodeText || body.comment || "").trim();
        const timestamp = Number(body.timestamp || Date.now());

        if (!gatewayToken || !clientOrderId) {
            return NextResponse.json(
                { success: false, error: "gatewayToken and clientOrderId are required." },
                { status: 400, headers: corsHeaders }
            );
        }

        const gatewayUser = await verifyGatewayToken(gatewayToken);
        if (!gatewayUser) {
            return NextResponse.json(
                { success: false, error: "Invalid gateway token." },
                { status: 403, headers: corsHeaders }
            );
        }

        const userId = gatewayUser.userId;
        const now = Date.now();

        // The EA sends `success` + `retcode`; newer clients may send `status`.
        // MT5 success retcodes start at 10009 (TRADE_RETCODE_DONE).
        const validStatuses = ["filled", "partially_filled", "rejected", "failed"];
        const explicitStatus = String(body.status || "").trim();
        const status = validStatuses.includes(explicitStatus)
            ? explicitStatus
            : body.success === false || (retcode > 0 && retcode < 10009)
            ? "rejected"
            : "filled";

        await adminDatabase
            .ref(`trading_order_requests/${userId}/${clientOrderId}`)
            .update({
                status,
                mt5Ticket,
                executionPrice,
                volume,
                symbol,
                errorCode: retcode,
                errorMessage,
                executedAt: timestamp || now,
                updatedAt: now,
            });

        if (status === "filled" || status === "partially_filled") {
            await adminDatabase
                .ref(`trading_execution_logs/${userId}/${clientOrderId}`)
                .set({
                    clientOrderId,
                    mt5Ticket,
                    status,
                    executionPrice,
                    volume,
                    symbol,
                    errorCode: retcode,
                    errorMessage,
                    executedAt: timestamp || now,
                    createdAt: now,
                });

            // Reconcile copy-trading: if this was a copied order, record
            // the real MT5 ticket and update the mt5_orders ledger too.
            const orderSnap = await adminDatabase
                .ref(`trading_order_requests/${userId}/${clientOrderId}`)
                .get();
            const orderData = orderSnap.val() || {};
            if (orderData.source === "copy_follower") {
                const followerMt5 = String(orderData.followerMt5Account || "").trim();
                if (followerMt5) {
                    // Update mt5_orders for backward compat with performance endpoints
                    const mt5Ref = adminDatabase.ref(`mt5_orders/${followerMt5}/${clientOrderId}`);
                    const mt5Existing = (await mt5Ref.get()).val();
                    if (mt5Existing) {
                        await mt5Ref.update({
                            status: "EXECUTED",
                            mt5Ticket,
                            executedAt: timestamp || now,
                            updatedAt: now,
                        });
                    }
                    // Record real MT5 ticket on the copied trade ledger
                    await attachCopiedMt5Ticket({
                        mt5Account: followerMt5,
                        ticket: clientOrderId,
                        mt5Ticket,
                    });
                }
            }
        }

        return NextResponse.json(
            { success: true },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error("[trading/gateway/execution POST]", error);
        return NextResponse.json(
            { success: false, error: "Execution report failed." },
            { status: 500, headers: corsHeaders }
        );
    }
}
