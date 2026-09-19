import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const accountsRef = adminDatabase.ref(`trading_accounts/${user.uid}`);
        const snapshot = await accountsRef.get();

        if (!snapshot.exists()) {
            return NextResponse.json({ success: true, accounts: [] });
        }

        const accountsData = snapshot.val();
        const accounts = Object.entries(accountsData).map(([key, val]) => {
            const account = val as Record<string, unknown>;
            return {
                id: key,
                accountId: account.accountId || key,
                mt5Account: account.mt5Account || "",
                broker: account.broker || "",
                server: account.server || "",
                currency: account.currency || "USD",
                leverage: account.leverage || "100",
                balance: account.balance || 0,
                equity: account.equity || 0,
                margin: account.margin || 0,
                freeMargin: account.freeMargin || 0,
                marginLevel: account.marginLevel || 0,
                positionsCount: account.positionsCount || 0,
                pendingOrdersCount: account.pendingOrdersCount || 0,
                status: account.status || "offline",
                lastHeartbeatAt: account.lastHeartbeatAt || 0,
                connectedAt: account.connectedAt || 0,
            };
        });

        return NextResponse.json({ success: true, accounts });
    } catch (err) {
        console.error("Accounts API error:", err);
        return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
    }
}
