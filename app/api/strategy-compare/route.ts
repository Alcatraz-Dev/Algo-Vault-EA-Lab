import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { computeMetrics } from "@/lib/strategy-lab/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json() as { strategyIds: string[] };
        const { strategyIds } = body;

        if (!strategyIds || strategyIds.length < 2) {
            return NextResponse.json({ error: "Provide at least 2 strategy IDs" }, { status: 400 });
        }

        const comparisons: any[] = [];
        for (const sid of strategyIds) {
            const btSnap = await adminDatabase.ref(`strategyLab/${user.uid}/backtests`).get();
            const all: any[] = [];
            if (btSnap.exists()) {
                const allBt = Object.values(btSnap.val()) as any[];
                allBt.filter((b) => b.strategyId === sid).forEach((b) => { if (b?.metrics) all.push(b); });
            }
            if (all.length > 0) {
                all.sort((a, b) => (b.metrics?.netProfit || 0) - (a.metrics?.netProfit || 0));
                comparisons.push({ strategyId: sid, strategyName: all[0].strategyName, metrics: all[0].metrics });
            }
        }
        return NextResponse.json({ success: true, comparisons }, { status: 200 });
    } catch (err: unknown) {
        console.error("[strategy-compare]", err);
        return NextResponse.json({ error: "Comparison failed" }, { status: 500 });
    }
}
