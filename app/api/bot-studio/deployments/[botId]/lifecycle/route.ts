import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import {
    getDeployment,
    updateDeploymentState,
    appendLog,
    appendAudit,
} from "@/lib/bot-studio/database";
import { validateTransition } from "@/lib/bot-studio/lifecycle";
import { isLiveTradingEnabled } from "@/lib/trading/feature-flags";
import type { BotLifecycleState, BotDesiredState } from "@/lib/bot-studio/types";

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ botId: string }> }
) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { botId } = await context.params;
        const deployment = await getDeployment(botId);
        if (!deployment) {
            return NextResponse.json({ ok: false, error: "Bot deployment not found" }, { status: 404 });
        }

        const body = await request.json();
        const targetState: BotLifecycleState = body?.targetState;

        if (!targetState) {
            return NextResponse.json({ ok: false, error: "targetState is required" }, { status: 400 });
        }

        // Live safety check
        if (
            deployment.accountMode === "live" &&
            (targetState === "starting" || targetState === "running") &&
            !isLiveTradingEnabled()
        ) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "Live trading is currently disabled via feature flags (LIVE_TRADING_ENABLED). Cannot start live bot.",
                },
                { status: 403 }
            );
        }

        // Validate state machine transition (throws if invalid)
        try {
            validateTransition(botId, deployment.runtimeState, targetState);
        } catch (transErr) {
            return NextResponse.json(
                { ok: false, error: errMessage(transErr) },
                { status: 400 }
            );
        }

        const now = Date.now();
        let desiredState: BotDesiredState = deployment.desiredState;
        if (targetState === "running" || targetState === "starting") desiredState = "running";
        else if (targetState === "paused" || targetState === "pausing") desiredState = "paused";
        else if (targetState === "stopped" || targetState === "stopping") desiredState = "stopped";
        else if (targetState === "paper") desiredState = "paper";

        const patch: Partial<typeof deployment> = {
            runtimeState: targetState,
            desiredState,
            updatedAt: now,
        };

        if (targetState === "running" && !deployment.startedAt) {
            patch.startedAt = now;
        } else if (targetState === "stopped") {
            patch.stoppedAt = now;
        }

        await updateDeploymentState(botId, patch);

        await appendLog(
            botId,
            "info",
            `Lifecycle transition: ${deployment.runtimeState} → ${targetState}`,
            { previous: deployment.runtimeState, next: targetState }
        );

        const auditAction = targetState === "running" ? "bot_started"
            : targetState === "paused" ? "bot_paused"
            : targetState === "stopped" ? "bot_stopped"
            : "admin_override";

        await appendAudit(
            botId,
            deployment.strategyId,
            auditAction,
            admin.uid,
            { from: deployment.runtimeState, to: targetState }
        );

        const updated = await getDeployment(botId);
        return NextResponse.json({ ok: true, deployment: updated });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to transition bot state") },
            { status: 500 }
        );
    }
}
