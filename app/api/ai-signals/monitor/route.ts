import { NextRequest, NextResponse } from "next/server";
import { monitorAllActiveSignals } from "@/lib/ai-signals/monitor";
import { isCronRequest } from "@/lib/security/cron-auth";

/**
 * AI Signal Monitor — invoked by Vercel Cron or an operator.
 *
 * Auth: CRON_SECRET presented as `Authorization: Bearer` (Vercel Cron) or
 * `x-cron-secret`. Fails closed when CRON_SECRET is unset. User-Agent and
 * query-string values are never trusted.
 */
export async function GET(request: NextRequest) {
    if (!isCronRequest(request)) {
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