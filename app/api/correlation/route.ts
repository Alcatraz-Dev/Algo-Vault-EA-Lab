import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const accountId = request.nextUrl.searchParams.get("accountId") || "default";
        const positionSnap = await adminDatabase.ref(`trading_positions/${user.uid}/${accountId}`).get();
        const positions = positionSnap.exists() ? positionSnap.val() : {};
        const positionList = Object.values(positions).map((p: any) => ({
            symbol: p.symbol, type: p.type, volume: Number(p.volume || 0),
            currentPrice: Number(p.currentPrice || 0), sl: Number(p.sl || 0), profit: Number(p.profit || 0),
        })).filter((p: any) => p.symbol && p.volume > 0);

        const SYMBOL_GROUPS: Record<string, string[]> = {
            precious_metals: ["XAUUSD", "XAGUSD"], major_forex: ["EURUSD", "GBPUSD", "USDJPY"],
            indices: ["US30", "NAS100"], crypto: ["BTCUSD", "ETHUSD"],
        };
        const correlations: any[] = [];
        for (const [group, gs] of Object.entries(SYMBOL_GROUPS)) {
            const gp = positionList.filter((p: any) => gs.includes(p.symbol));
            if (gp.length >= 2) {
                const tv = gp.reduce((s, p) => s + p.volume, 0);
                const bv = gp.filter((p) => p.type === "BUY").reduce((s, p) => s + p.volume, 0);
                const sv = gp.filter((p) => p.type === "SELL").reduce((s, p) => s + p.volume, 0);
                correlations.push({ group, symbols: gp.map((p) => p.symbol), totalVolume: tv, netVolume: Math.abs(bv - sv), concentration: tv > 0 ? Math.round((Math.abs(bv - sv) / tv) * 100) : 0 });
            }
        }
        const totalRisk = positionList.reduce((s, p) => s + Math.abs(p.currentPrice - p.sl) * p.volume, 0);
        return NextResponse.json({
            success: true,
            positions: positionList,
            correlations,
            portfolio: { totalPositions: positionList.length, totalRisk: Math.round(totalRisk * 100) / 100 },
        }, { status: 200 });
    } catch (err: unknown) {
        console.error("[correlation]", err);
        return NextResponse.json({ error: "Correlation failed" }, { status: 500 });
    }
}
