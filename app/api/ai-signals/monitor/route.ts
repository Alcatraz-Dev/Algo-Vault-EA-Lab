import { NextRequest, NextResponse } from "next/server";
import { monitorAllActiveSignals } from "@/lib/ai-signals/monitor";

export async function GET(_request: NextRequest) {
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
