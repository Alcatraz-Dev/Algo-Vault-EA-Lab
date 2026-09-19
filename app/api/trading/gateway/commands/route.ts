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

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const query: Record<string, unknown> = {
            gatewayToken: url.searchParams.get("gatewayToken") || "",
            accountNumber: url.searchParams.get("accountNumber") || "",
        };
        const gatewayToken = resolveGatewayToken(request.headers.get("authorization"), query);
        const accountNumber = String(query.accountNumber || "").trim();

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

        const userId = gatewayUser.userId;
        const accountId = `gateway_${accountNumber}`;

        const commandsSnap = await adminDatabase
            .ref(`trading_order_requests/${userId}`)
            .get();

        const commandsData = commandsSnap.val() || {};
        const now = Date.now();
        const pendingCommands: Array<Record<string, unknown>> = [];

        for (const [commandId, raw] of Object.entries(commandsData)) {
            if (!raw || typeof raw !== "object") continue;
            const cmd = raw as Record<string, unknown>;
            if (cmd.status === "queued" && String(cmd.accountId || "") === accountId) {
                pendingCommands.push({ ...cmd, id: commandId });

                await adminDatabase
                    .ref(`trading_order_requests/${userId}/${commandId}`)
                    .update({ status: "executing", executingAt: now });
            }
        }

        return NextResponse.json(
            { success: true, commands: pendingCommands },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error("[trading/gateway/commands GET]", error);
        return NextResponse.json(
            { success: false, error: "Failed to fetch commands." },
            { status: 500, headers: corsHeaders }
        );
    }
}
