import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { requireBotStudioAccess } from "@/lib/bot-studio/auth";
import {
    appendAudit,
    appendLog,
    listDeploymentsForOwner,
    newBotId,
    newStrategyId,
    saveDeployment,
    saveStrategy,
    getStrategy,
} from "@/lib/bot-studio/database";
import { deriveMagicNumber } from "@/lib/bot-studio/magic-numbers";
import type { BotDeployment, BotStrategy } from "@/lib/bot-studio/types";
import {
    buildScalpingStrategy,
    describeScalpingConfig,
    normalizeScalpingConfig,
} from "@/lib/bot-studio/scalping/profiles";
import { scalpingConfigFingerprint } from "@/lib/bot-studio/scalping/session";
import { accountKey } from "@/lib/risk/account-state";
import { deriveAccountMode } from "@/lib/terminal/account";
import { adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ScalpingBotSummary {
    deployment: BotDeployment;
    strategy: {
        id: string;
        name: string;
        symbol: string;
        timeframe: string;
        direction: string | null;
        preset: string | null;
        magicNumber: number;
    };
}

/**
 * GET /api/bot-studio/scalping/bots
 *
 * Lists the caller's scalping bots. Owner-scoped exactly like the existing
 * deployments route (Admin SDK reads bypass RTDB rules, so ownership is
 * enforced here).
 */
export async function GET(request: NextRequest) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const deployments = await listDeploymentsForOwner(access.uid);
        const bots: ScalpingBotSummary[] = [];
        for (const deployment of deployments) {
            const strategy = await getStrategy(deployment.strategyId);
            if (!strategy?.scalpingConfig) continue;
            bots.push({
                deployment,
                strategy: {
                    id: strategy.id,
                    name: strategy.name,
                    symbol: strategy.definition.asset,
                    timeframe: strategy.definition.timeframes.setup,
                    direction: strategy.scalpingConfig.direction,
                    preset: strategy.scalpingConfig.preset,
                    magicNumber: strategy.magicNumber,
                },
            });
        }
        bots.sort((a, b) => b.deployment.updatedAt - a.deployment.updatedAt);
        return NextResponse.json({ ok: true, bots });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to load scalping bots") },
            { status: 500 },
        );
    }
}

/**
 * POST /api/bot-studio/scalping/bots
 *
 * Creates a scalping strategy + DEMO deployment in one step.
 *
 * Demo-only by construction: `accountMode` is never taken from the body, a
 * `live` request is rejected, and the target MT5 account must resolve to the
 * platform's PAPER mode (lib/terminal/account). The bot cannot be pointed at a
 * live account through this route.
 */
export async function POST(request: NextRequest) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json().catch(() => ({}));

        // Live is structurally refused — not silently downgraded, so a caller
        // that asked for live never believes it got a live bot.
        if (String(body?.accountMode ?? "demo").toLowerCase() === "live") {
            return NextResponse.json(
                { ok: false, error: "Scalping bots are restricted to DEMO/PAPER execution." },
                { status: 403 },
            );
        }

        const mt5Account = String(body?.mt5Account ?? "").trim();
        if (!mt5Account) {
            return NextResponse.json(
                { ok: false, error: "mt5Account is required — select a connected demo account." },
                { status: 400 },
            );
        }

        const account = accountKey(mt5Account);
        const accountSnap = await adminDatabase.ref(`trading_accounts/${access.uid}/${account}`).get();
        if (!accountSnap.exists()) {
            return NextResponse.json(
                { ok: false, error: "That MT5 account is not connected to this account." },
                { status: 400 },
            );
        }
        const accountRecord = (accountSnap.val() || {}) as Record<string, unknown>;
        if (deriveAccountMode(accountRecord) !== "paper") {
            return NextResponse.json(
                {
                    ok: false,
                    error:
                        "This account is not a verified demo/paper account. Scalping bots cannot run on a live account.",
                },
                { status: 403 },
            );
        }

        const normalized = normalizeScalpingConfig(body?.config ?? body);
        if (normalized.errors.length > 0) {
            return NextResponse.json(
                { ok: false, error: normalized.errors.join(" "), errors: normalized.errors },
                { status: 400 },
            );
        }
        const config = normalized.config;

        const strategyId = newStrategyId();
        const magicNumber = deriveMagicNumber(strategyId);
        // Both mode stores the long-side reference definition; the runtime
        // evaluates BOTH side variants from `scalpingConfig.direction`.
        const referenceDirection = config.direction === "short_only" ? "short" : "long";
        const definition = buildScalpingStrategy(config, referenceDirection, {
            id: strategyId,
            name: typeof body?.name === "string" && body.name.trim() ? body.name.trim() : undefined,
        });

        const now = Date.now();
        const strategy: BotStrategy = {
            id: strategyId,
            authorId: access.uid,
            name: definition.name,
            description: definition.description,
            state: "valid",
            validationErrors: [],
            validationWarnings: normalized.warnings,
            source: { kind: "imported", originalFormat: "scalping-profile-v1" },
            definition,
            fingerprint: `scalping-${scalpingConfigFingerprint(config)}`,
            magicNumber,
            scalpingConfig: config,
            createdAt: now,
            updatedAt: now,
        };
        await saveStrategy(strategy);

        const botId = newBotId();
        const deployment: BotDeployment = {
            id: botId,
            strategyId,
            deployedFingerprint: strategy.fingerprint,
            ownerId: access.uid,
            mt5Account: account,
            // Never taken from the request.
            accountMode: "demo",
            runtimeState: "ready",
            desiredState: "stopped",
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
            `Scalping bot created (DEMO only): ${describeScalpingConfig(config)}`,
            { strategyId, warnings: normalized.warnings },
        );
        await appendAudit(botId, strategyId, "strategy_created", access.uid, {
            config,
            warnings: normalized.warnings,
            accountMode: "demo",
            mt5Account: account,
        });

        return NextResponse.json({
            ok: true,
            deployment,
            strategy,
            warnings: normalized.warnings,
        });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to create scalping bot") },
            { status: 500 },
        );
    }
}
