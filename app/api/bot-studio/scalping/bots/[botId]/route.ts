import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { canAccessDeployment, requireBotStudioAccess } from "@/lib/bot-studio/auth";
import {
    appendAudit,
    appendLog,
    getDeployment,
    getStrategy,
    saveStrategy,
    updateDeploymentState,
} from "@/lib/bot-studio/database";
import {
    buildScalpingStrategy,
    normalizeScalpingConfig,
} from "@/lib/bot-studio/scalping/profiles";
import { scalpingConfigFingerprint } from "@/lib/bot-studio/scalping/session";
import { buildScalpingBotReport } from "@/lib/bot-studio/scalping/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** States in which the configuration is actively driving entries. */
const CONFIG_LOCKED_STATES = new Set(["starting", "running", "pausing", "stopping"]);

async function loadOwnedBot(request: NextRequest, botId: string) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
    }
    const deployment = await getDeployment(botId);
    if (!deployment || !canAccessDeployment(access, deployment)) {
        // 404 — never confirm the existence of another owner's bot.
        return { error: NextResponse.json({ ok: false, error: "Bot not found" }, { status: 404 }) } as const;
    }
    const strategy = await getStrategy(deployment.strategyId);
    if (!strategy?.scalpingConfig) {
        return { error: NextResponse.json({ ok: false, error: "Bot not found" }, { status: 404 }) } as const;
    }
    return { access, deployment, strategy } as const;
}

/**
 * GET /api/bot-studio/scalping/bots/{botId}
 *
 * Full persisted report: status, current signal, counters, signals,
 * executions, risk decisions, demo performance, notional usage, methodology
 * trace. Nothing is computed from anything but recorded data.
 */
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ botId: string }> },
) {
    const { botId } = await context.params;
    const loaded = await loadOwnedBot(request, botId);
    if ("error" in loaded) return loaded.error;

    try {
        const report = await buildScalpingBotReport(loaded.deployment, loaded.strategy);
        return NextResponse.json({ ok: true, report });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to build bot report") },
            { status: 500 },
        );
    }
}

/**
 * PATCH /api/bot-studio/scalping/bots/{botId}
 *
 * Reconfigures a stopped/paused bot. A running bot must be stopped first —
 * silently swapping rules under open positions is exactly the kind of change
 * that must never happen.
 */
export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ botId: string }> },
) {
    const { botId } = await context.params;
    const loaded = await loadOwnedBot(request, botId);
    if ("error" in loaded) return loaded.error;
    const { access, deployment, strategy } = loaded;

    if (CONFIG_LOCKED_STATES.has(deployment.runtimeState)) {
        return NextResponse.json(
            {
                ok: false,
                error: `Stop the bot before changing its configuration (current state: ${deployment.runtimeState}).`,
            },
            { status: 409 },
        );
    }

    try {
        const body = await request.json().catch(() => ({}));
        const normalized = normalizeScalpingConfig({
            ...strategy.scalpingConfig,
            ...(body?.config ?? body),
        });
        if (normalized.errors.length > 0) {
            return NextResponse.json(
                { ok: false, error: normalized.errors.join(" "), errors: normalized.errors },
                { status: 400 },
            );
        }
        const config = normalized.config;
        const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : strategy.name;
        const referenceDirection = config.direction === "short_only" ? "short" : "long";

        const updated = {
            ...strategy,
            name,
            description: buildScalpingStrategy(config, referenceDirection).description,
            definition: buildScalpingStrategy(config, referenceDirection, {
                id: strategy.id,
                name,
            }),
            scalpingConfig: config,
            fingerprint: `scalping-${scalpingConfigFingerprint(config)}`,
            validationWarnings: normalized.warnings,
            state: "valid" as const,
            updatedAt: Date.now(),
        };
        await saveStrategy(updated);
        await updateDeploymentState(botId, { deployedFingerprint: updated.fingerprint });
        await appendLog(botId, "info", "Scalping configuration updated.", { config });
        await appendAudit(botId, strategy.id, "strategy_updated", access.uid, { config });

        const report = await buildScalpingBotReport(
            { ...deployment, deployedFingerprint: updated.fingerprint },
            updated,
        );
        return NextResponse.json({ ok: true, report, warnings: normalized.warnings });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to update bot configuration") },
            { status: 500 },
        );
    }
}
