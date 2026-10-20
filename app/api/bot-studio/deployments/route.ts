import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { requireBotStudioAccess, canAccessStrategy } from "@/lib/bot-studio/auth";
import {
    listAllDeployments,
    getStrategy,
    saveDeployment,
    newBotId,
    appendAudit,
    appendLog,
} from "@/lib/bot-studio/database";
import { buildDeploymentSummaries } from "@/lib/bot-studio/summaries";
import type { BotDeployment } from "@/lib/bot-studio/types";

export async function GET(request: NextRequest) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const all = await listAllDeployments();
        // Non-admin callers only ever see their OWN deployments. These records
        // carry the owner's MT5 account, runtime state and live counters, so
        // listing every deployment for any authenticated Pro user would leak
        // another user's private trading data.
        const deployments = access.isAdmin
            ? all
            : all.filter((d: BotDeployment) => d.ownerId === access.uid);

        // Compact execution summaries for the CALLER'S OWN bots. They carry
        // strategy, live performance and eligibility so execution surfaces
        // (Terminal Trading → Bots) need one request, not one per bot. An
        // admin's view of somebody else's deployment deliberately carries no
        // summary: eligibility depends on that owner's gateway, not the
        // admin's, so computing it here would be a guess.
        const own = deployments.filter((d: BotDeployment) => d.ownerId === access.uid);
        const summaries = own.length > 0 ? await buildDeploymentSummaries(access.uid, own) : {};

        return NextResponse.json({ ok: true, deployments, summaries });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to load bot deployments") },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
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
        // A deployment may only be created from a strategy the caller owns
        // (admins may deploy any strategy). Without this check a Pro user
        // could deploy somebody else's strategy against their own MT5
        // account.
        if (!canAccessStrategy(access, strategy)) {
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
            ownerId: access.uid,
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
            access.uid,
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
