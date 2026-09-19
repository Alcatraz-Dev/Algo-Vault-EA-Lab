import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { validateApiKey } from "@/lib/api-key-auth";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
        const userId = await validateApiKey(token);
        if (!userId) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

        const accountsSnap = await adminDatabase.ref(`trading_accounts/${userId}`).get();
        const accounts: Record<string, unknown>[] = [];

        if (accountsSnap.exists()) {
            const data = accountsSnap.val();
            for (const [id, val] of Object.entries(data)) {
                const acc = val as Record<string, unknown>;
                accounts.push({
                    id,
                    mt5Account: String(acc.mt5Account || ""),
                    broker: String(acc.broker || ""),
                    balance: Number(acc.balance || 0),
                    equity: Number(acc.equity || 0),
                    margin: Number(acc.margin || 0),
                    freeMargin: Number(acc.freeMargin || 0),
                    marginLevel: Number(acc.marginLevel || 0),
                    status: String(acc.status || ""),
                });
            }
        }

        return NextResponse.json({ success: true, accounts });
    } catch (err) {
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
