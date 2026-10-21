import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { verifyGatewayToken, resolveGatewayToken } from "@/lib/gateway";

export const runtime = "nodejs";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * Called by the EA on shutdown. Marks the account offline so the terminal
 * stops showing it as live. It never touches trade commands: anything still
 * executing stays claimed and is settled by the normal claim-expiry recovery.
 */
export async function POST(request: NextRequest) {
    try {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const gatewayToken = resolveGatewayToken(request.headers.get("authorization"), body);
        const accountNumber = String(body.accountNumber || "").trim();

        if (!gatewayToken || !accountNumber) {
            return NextResponse.json(
                { success: false, error: "gatewayToken and accountNumber are required." },
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

        const now = Date.now();
        const accountId = `gateway_${accountNumber}`;
        const liveRef = adminDatabase.ref(`live_accounts/${accountId}`);
        const existing = (await liveRef.get()).val();

        // Only an account this user owns may be marked offline.
        if (existing && typeof existing === "object" && (existing as { userId?: unknown }).userId !== gatewayUser.userId) {
            return NextResponse.json(
                { success: false, error: "Account is not registered to this gateway." },
                { status: 403, headers: corsHeaders }
            );
        }

        if (existing) {
            await liveRef.update({ status: "offline", disconnectedAt: now, updatedAt: now });
        }

        return NextResponse.json({ success: true }, { status: 200, headers: corsHeaders });
    } catch (error) {
        console.error("[trading/gateway/disconnect POST]", error);
        return NextResponse.json(
            { success: false, error: "Disconnect failed." },
            { status: 500, headers: corsHeaders }
        );
    }
}
