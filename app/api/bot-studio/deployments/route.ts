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
        return NextResponse.json({ ok: true, deployments });
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
        let targetAccount = mt5Account?.trim() || "";
        if (!targetAccount || targetAccount === "default") {
            try {
                const { adminDatabase } = await import("@/lib/firebase-admin");
                const accSnap = await adminDatabase.ref(`trading_accounts/${access.uid}`).get();
                if (accSnap.exists()) {
                    const keys = Object.keys(accSnap.val() || {});
                    const match = keys.find((k) => k.startsWith("gateway_")) || keys[0];
                    if (match) targetAccount = match;
                }
            } catch {
                // Ignore fallback error
            }
        }
        const deployment: BotDeployment = {
            id: botId,
            strategyId,
            deployedFingerprint: strategy.fingerprint,
            ownerId: access.uid,
            mt5Account: targetAccount,
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
