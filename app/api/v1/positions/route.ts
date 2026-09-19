import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { validateApiKey } from "@/lib/api-key-auth";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
        const userId = await validateApiKey(token);
        if (!userId) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

        const accountId = request.nextUrl.searchParams.get("accountId");
        if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });

        const posSnap = await adminDatabase.ref(`trading_positions/${userId}/${accountId}`).get();
        const positions: Record<string, unknown>[] = [];

        if (posSnap.exists()) {
            const data = posSnap.val();
            for (const [, pos] of Object.entries(data)) {
                const p = pos as Record<string, unknown>;
                positions.push({
                    ticket: p.ticket,
                    symbol: String(p.symbol || ""),
                    type: String(p.type || ""),
                    volume: Number(p.volume || 0),
                    openPrice: Number(p.openPrice || 0),
                    currentPrice: Number(p.currentPrice || 0),
                    profit: Number(p.profit || 0),
                    sl: Number(p.sl || 0),
                    tp: Number(p.tp || 0),
                    openTime: Number(p.openTime || 0),
                });
            }
        }

        return NextResponse.json({ success: true, positions });
    } catch (err) {
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
