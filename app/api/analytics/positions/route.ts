import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const accountId = request.nextUrl.searchParams.get("accountId");
        if (!accountId) {
            return NextResponse.json({ error: "accountId required" }, { status: 400 });
        }

        const positionsRef = adminDatabase.ref(`trading_positions/${user.uid}/${accountId}`);
        const snapshot = await positionsRef.get();

        if (!snapshot.exists()) {
            return NextResponse.json({ success: true, positions: [] });
        }

        const positionsData = snapshot.val();
        const positions = Object.entries(positionsData).map(([key, val]) => {
            const pos = val as Record<string, unknown>;
            return {
                ticket: pos.ticket || key,
                symbol: pos.symbol || "",
                type: pos.type || "",
                volume: pos.volume || 0,
                openPrice: pos.openPrice || 0,
                currentPrice: pos.currentPrice || 0,
                sl: pos.sl || 0,
                tp: pos.tp || 0,
                profit: pos.profit || 0,
                swap: pos.swap || 0,
                magic: pos.magic || 0,
                openedAt: pos.openedAt || 0,
                updatedAt: pos.updatedAt || 0,
            };
        });

        return NextResponse.json({ success: true, positions });
    } catch (err) {
        console.error("Positions API error:", err);
        return NextResponse.json({ error: "Failed to fetch positions" }, { status: 500 });
    }
}
