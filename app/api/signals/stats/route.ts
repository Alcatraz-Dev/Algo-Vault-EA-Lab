import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { isProUser } from "@/lib/ai-signals/access";
import { getCachedStats } from "@/lib/ai-signals/statistics";

const VALID_PERIODS = ["today", "week", "month", "last7", "last30", "last90", "all"];
const VALID_TIERS = ["FREE", "PRO", "all"];
const VALID_DIRECTIONS = ["BUY", "SELL"];

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { searchParams } = new URL(request.url);

        const period = searchParams.get("period") || "all";
        const tier = searchParams.get("tier") || "all";
        const symbol = searchParams.get("symbol")?.toUpperCase() || undefined;
        const timeframe = searchParams.get("timeframe") || undefined;
        const direction = searchParams.get("direction") || undefined;

        if (!VALID_PERIODS.includes(period)) {
            return NextResponse.json({ error: `Invalid period. Use one of: ${VALID_PERIODS.join(", ")}` }, { status: 400 });
        }
        if (!VALID_TIERS.includes(tier)) {
            return NextResponse.json({ error: `Invalid tier. Use one of: ${VALID_TIERS.join(", ")}` }, { status: 400 });
        }
        if (direction && !VALID_DIRECTIONS.includes(direction)) {
            return NextResponse.json({ error: "Invalid direction. Use BUY or SELL" }, { status: 400 });
        }

        const isPro = await isProUser(user.uid);
        const stats = await getCachedStats({
            period: period as "today" | "week" | "month" | "last7" | "last30" | "last90" | "all",
            tier: tier as "FREE" | "PRO" | "all",
            symbol,
            timeframe,
            direction: direction as "BUY" | "SELL" | undefined,
            entitlement: isPro ? "all" : "free",
        });

        return NextResponse.json({ success: true, stats });
    } catch (err) {
        console.error("Signals stats GET error:", err);
        return NextResponse.json({ error: "Failed to load signal statistics" }, { status: 500 });
    }
}