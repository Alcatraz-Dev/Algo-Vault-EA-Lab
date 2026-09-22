import { NextRequest, NextResponse } from "next/server";
import { monitorAllActiveSignals } from "@/lib/ai-signals/monitor";

/**
 * AI Signal Monitor — invoked by a cron/worker (or admin-triggered on-demand).
 *
 * Auth: requires `x-cron-secret` to match CRON_SECRET (same convention as
 * /api/alerts/check and /api/trade-management/monitor), OR the request must
 * come from Vercel's cron runner (user-agent "vercel-cron"). If CRON_SECRET is
 * unset the endpoint refuses to run instead of running unauthenticated.
 */
export async function GET(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    const headerSecret = request.headers.get("x-cron-secret") || "";
    const querySecret = new URL(request.url).searchParams.get("secret") || "";
    const isVercelCron = (request.headers.get("user-agent") || "").toLowerCase().includes("vercel-cron");

    const authorized = isVercelCron || Boolean(secret && (headerSecret === secret || querySecret === secret));
    if (!authorized) {
        return NextResponse.json(
            { error: "Unauthorized. Set CRON_SECRET and send it as x-cron-secret." },
            { status: 401 }
        );
    }

    try {
        const result = await monitorAllActiveSignals();

        return NextResponse.json({
            success: true,
            checked: result.checked,
            statusChanges: result.statusChanges,
            events: result.events,
            timestamp: Date.now(),
        });
    } catch (err) {
        console.error("AI Signal Monitor error:", err);
        return NextResponse.json({ error: "Monitoring failed" }, { status: 500 });
    }
}