import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getProSignals } from "@/features/telegram-signals/signals/signal-engine";
import { computeSignalAnalytics } from "@/features/telegram-signals/analytics/signal-analytics";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        const { searchParams } = new URL(request.url);
        const symbol = searchParams.get("symbol") || undefined;
        const style = searchParams.get("style") || undefined;
        const timeframe = searchParams.get("timeframe") || undefined;

        const signals = await getProSignals(uid);
        const analytics = computeSignalAnalytics(signals, { symbol, style, timeframe });

        return NextResponse.json({
            success: true,
            analytics,
        });
    } catch (err: unknown) {
        console.error("[GET /api/pro-signals/analytics]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal server error" },
            { status: 500 }
        );
    }
}
