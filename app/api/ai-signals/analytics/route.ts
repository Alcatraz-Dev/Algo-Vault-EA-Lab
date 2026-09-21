import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { calculateSignalAnalytics } from "@/lib/ai-signals/analytics";

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const analytics = await calculateSignalAnalytics();

        return NextResponse.json({ success: true, analytics, sentiments: analytics.sentiments });
    } catch (err) {
        console.error("AI Signals Analytics GET error:", err);
        return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
    }
}
