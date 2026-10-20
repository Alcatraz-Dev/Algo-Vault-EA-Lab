import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { requireBotStudioAccess, canAccessDeployment } from "@/lib/bot-studio/auth";
import {
    getDeployment,
    updateDeploymentState,
    appendLog,
    appendAudit,
} from "@/lib/bot-studio/database";
import { transitionPath } from "@/lib/bot-studio/lifecycle";
import { isLiveTradingEnabled } from "@/lib/trading/feature-flags";
import type { BotLifecycleState, BotDesiredState } from "@/lib/bot-studio/types";

export async function POST(
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
        if (!canAccessDeployment(access, deployment)) {
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

        // The UI sends user intent ("running"/"paused"/"stopped") while the
        // state machine requires intermediate states. Resolve the shortest
        // LEGAL path and reject anything unreachable — never bypass the machine.
        const path = transitionPath(deployment.runtimeState, targetState);
        if (!path) {
            return NextResponse.json(
                {
                    ok: false,
                    error: `Bot ${botId}: invalid lifecycle transition ${deployment.runtimeState} → ${targetState}.`,
                },
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
            `Lifecycle transition: ${[deployment.runtimeState, ...path].join(" → ")}`,
            { previous: deployment.runtimeState, next: targetState, path }
        );

        const auditAction = targetState === "running" ? "bot_started"
            : targetState === "paused" ? "bot_paused"
            : targetState === "stopped" ? "bot_stopped"
            : "admin_override";

        await appendAudit(
            botId,
            deployment.strategyId,
            auditAction,
            access.uid,
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
