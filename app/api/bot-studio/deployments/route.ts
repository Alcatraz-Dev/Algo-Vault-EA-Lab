import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import {
    listAllDeployments,
    getStrategy,
    saveDeployment,
    newBotId,
    appendAudit,
    appendLog,
} from "@/lib/bot-studio/database";
import type { BotDeployment } from "@/lib/bot-studio/types";

export async function GET(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const deployments = await listAllDeployments();
        return NextResponse.json({ ok: true, deployments });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to load bot deployments") },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { strategyId, mt5Account, accountMode } = body;

        if (!strategyId || typeof strategyId !== "string") {
            return NextResponse.json({ ok: false, error: "strategyId is required" }, { status: 400 });
        }

        const strategy = await getStrategy(strategyId);
        if (!strategy) {
            return NextResponse.json(
                { ok: false, error: `Strategy ${strategyId} does not exist` },
                { status: 404 }
            );
        }

        const now = Date.now();
        const botId = newBotId();
        const deployment: BotDeployment = {
            id: botId,
            strategyId,
            deployedFingerprint: strategy.fingerprint,
            ownerId: admin.uid,
            mt5Account: mt5Account?.trim() || "default",
            accountMode: accountMode === "live" ? "live" : "demo",
            runtimeState: "ready",
            desiredState: accountMode === "live" ? "stopped" : "paper",
            signalCount: 0,
            executionCount: 0,
            rejectionCount: 0,
            openPositions: [],
            createdAt: now,
            updatedAt: now,
        };

        await saveDeployment(deployment);

        await appendLog(
            botId,
            "info",
            `Bot created for strategy "${strategy.name}" (${deployment.accountMode} mode)`
        );

        await appendAudit(
            botId,
            strategyId,
            "strategy_deployed",
            admin.uid,
            {
                strategyName: strategy.name,
                accountMode: deployment.accountMode,
                mt5Account: deployment.mt5Account,
            }
        );

        return NextResponse.json({ ok: true, deployment });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to create bot deployment") },
            { status: 500 }
        );
    }
}
