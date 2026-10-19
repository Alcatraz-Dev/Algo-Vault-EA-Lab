import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { requireBotStudioAccess } from "@/lib/bot-studio/auth";
import { getRecentLogs, getRecentAudit, getDeployment } from "@/lib/bot-studio/database";

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ botId: string }> }
) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { botId } = await context.params;
        const searchParams = request.nextUrl.searchParams;
        const limit = Number(searchParams.get("limit") || "100");

        const deployment = await getDeployment(botId);
        if (!deployment) {
            return NextResponse.json({ ok: false, error: "Bot deployment not found" }, { status: 404 });
        }
        if (!access.isAdmin && deployment.ownerId !== access.uid) {
            return NextResponse.json({ ok: false, error: "Bot deployment not found" }, { status: 404 });
        }
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
