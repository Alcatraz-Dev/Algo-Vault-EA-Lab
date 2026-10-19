import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { requireBotStudioAccess } from "@/lib/bot-studio/auth";
import {
    getDeployment,
    getStrategy,
    updateDeploymentState,
    getRecentLogs,
    getRecentSignals,
    getRecentExecutions,
    appendAudit,
} from "@/lib/bot-studio/database";

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
        const deployment = await getDeployment(botId);
        if (!deployment) {
            return NextResponse.json({ ok: false, error: "Bot deployment not found" }, { status: 404 });
        }

        const [strategy, logs, signals, executions] = await Promise.all([
            getStrategy(deployment.strategyId),
            getRecentLogs(botId, 50),
            getRecentSignals(botId, 30),
            getRecentExecutions(botId, 30),
        ]);

        return NextResponse.json({
            ok: true,
            deployment,
            strategy,
            logs,
            signals,
            executions,
        });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to load bot deployment") },
            { status: 500 }
        );
    }
}

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ botId: string }> }
) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { botId } = await context.params;
        const deployment = await getDeployment(botId);
        if (!deployment) {
            return NextResponse.json({ ok: false, error: "Bot deployment not found" }, { status: 404 });
        }

        const body = await request.json();
        const patch: Record<string, unknown> = {};

        if (body.mt5Account !== undefined) patch.mt5Account = String(body.mt5Account).trim();
        if (body.accountMode === "demo" || body.accountMode === "live") {
            patch.accountMode = body.accountMode;
        }

        await updateDeploymentState(botId, patch);

        await appendAudit(
            botId,
            deployment.strategyId,
            "admin_override",
            access.uid,
            patch
        );

        const updated = await getDeployment(botId);
        return NextResponse.json({ ok: true, deployment: updated });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to update bot deployment") },
            { status: 500 }
        );
    }
}
