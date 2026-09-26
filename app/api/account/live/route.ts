import { NextRequest, NextResponse } from "next/server";
import { authenticate, errMessage } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

type LiveAccount = {
    id: string;
    productId: string;
    productName?: string;
    mt5Account: string;
    broker?: string;
    server?: string;
    currency?: string;
    balance?: number;
    equity?: number;
    floatingProfit?: number;
    peakEquity?: number;
    drawdown?: number;
    status?: string;
    lastHeartbeatAt?: number;
    userId?: string;
    licenseId?: string;
};

export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        const snapshot = await adminDatabase.ref("live_accounts").get();
        if (!snapshot.exists()) {
            return NextResponse.json({ success: true, accounts: [] });
        }

        const data = snapshot.val() as Record<string, Record<string, unknown>>;
        const list: LiveAccount[] = Object.entries(data)
            .map(([id, val]) => ({ id, ...val } as LiveAccount))
            .filter((acct) => acct.userId === token.uid);

        list.sort((a, b) => Number(b.lastHeartbeatAt ?? 0) - Number(a.lastHeartbeatAt ?? 0));

        return NextResponse.json({ success: true, accounts: list });
    } catch (error) {
        console.error("[account/live GET]", error);
        return NextResponse.json(
            { success: false, error: errMessage(error, "Failed to load live accounts.") },
            { status: 500 }
        );
    }
}