import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { authenticate } from "@/lib/admin-auth";
import { getGatewayTokenForUser } from "@/lib/gateway";

export const runtime = "nodejs";

/**
 * Server-side gateway status for the authenticated user.
 *
 * The browser client cannot always read `trading_accounts/{uid}` directly if
 * the RTDB security rules block that path, so this endpoint provides a
 * definitive (admin-SDK-backed) view of the connected accounts plus a
 * diagnostic of whether the user's gateway token actually maps to them.
 */
export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
        const uid = token.uid;

        const accountsSnap = await adminDatabase.ref(`trading_accounts/${uid}`).get();
        const accountsData = accountsSnap.exists() ? accountsSnap.val() : {};

        const accounts: Array<Record<string, unknown>> = [];
        for (const [accountId, raw] of Object.entries(accountsData)) {
            if (!raw || typeof raw !== "object") continue;
            const acc = raw as Record<string, unknown>;
            accounts.push({
                accountId,
                mt5Account: acc.mt5Account || acc.mt5Account_,
                broker: acc.broker || acc.company || "",
                server: acc.server || "",
                currency: acc.currency || "",
                status: acc.status || "unknown",
                balance: Number(acc.balance || 0),
                equity: Number(acc.equity || 0),
                margin: Number(acc.margin || 0),
                freeMargin: Number(acc.freeMargin || 0),
                marginLevel: Number(acc.marginLevel || 0),
                positionsCount: Number(acc.positionsCount || 0),
                pendingOrdersCount: Number(acc.pendingOrdersCount || 0),
                gatewayVersion: acc.gatewayVersion || "",
                lastHeartbeatAt: Number(acc.lastHeartbeatAt || 0),
                connectedAt: Number(acc.connectedAt || 0),
            });
        }

        const gatewayToken = await getGatewayTokenForUser(uid);

        return NextResponse.json({
            success: true,
            accounts,
            accountsCount: accounts.length,
            license: { pathExists: true },
            token: gatewayToken ? { exists: true } : { exists: false },
        });
    } catch (error) {
        console.error("[trading/gateway/status GET]", error);
        return NextResponse.json(
            { error: "Failed to load gateway status." },
            { status: 500 }
        );
    }
}