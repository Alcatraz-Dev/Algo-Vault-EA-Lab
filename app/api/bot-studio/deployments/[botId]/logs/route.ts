import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import { getRecentLogs, getRecentAudit } from "@/lib/bot-studio/database";

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ botId: string }> }
) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { botId } = await context.params;
        const searchParams = request.nextUrl.searchParams;
        const limit = Number(searchParams.get("limit") || "100");

        const [logs, audit] = await Promise.all([
            getRecentLogs(botId, limit),
            getRecentAudit(botId, limit),
        ]);

        return NextResponse.json({ ok: true, logs, audit });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to load bot logs") },
            { status: 500 }
        );
    }
}
