import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { requireBotStudioAccess, canAccessStrategy } from "@/lib/bot-studio/auth";
import { getStrategy, saveStrategy, newStrategyId, deleteStrategy, appendAudit } from "@/lib/bot-studio/database";
import crypto from "crypto";

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ strategyId: string }> }
) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
        const { strategyId } = await context.params;
        const strategy = await getStrategy(strategyId);
        if (!strategy) {
            return NextResponse.json({ ok: false, error: "Strategy not found" }, { status: 404 });
        }
        if (!canAccessStrategy(access, strategy)) {
            return NextResponse.json({ ok: false, error: "Strategy not found" }, { status: 404 });
        }
        return NextResponse.json({ ok: true, strategy });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to load strategy") },
            { status: 500 }
        );
    }
}

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ strategyId: string }> }
) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
        const { strategyId } = await context.params;
        const strategy = await getStrategy(strategyId);
        if (!strategy) {
            return NextResponse.json({ ok: false, error: "Strategy not found" }, { status: 404 });
        }
        if (!canAccessStrategy(access, strategy)) {
            return NextResponse.json({ ok: false, error: "Strategy not found" }, { status: 404 });
        }
        const body = await request.json().catch(() => ({}));
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        if (!name) {
            return NextResponse.json({ ok: false, error: "Strategy name is required" }, { status: 400 });
        }
        if (name.length > 120) {
            return NextResponse.json({ ok: false, error: "Strategy name is too long" }, { status: 400 });
        }
        const updated = { ...strategy, name, updatedAt: Date.now() };
        await saveStrategy(updated);
        await appendAudit(strategyId, strategyId, "strategy_updated", access.uid, { name });
        return NextResponse.json({ ok: true, strategy: updated });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to rename strategy") },
            { status: 500 }
        );
    }
}

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ strategyId: string }> }
) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
        const { strategyId } = await context.params;
        const strategy = await getStrategy(strategyId);
        if (!strategy) {
            return NextResponse.json({ ok: false, error: "Strategy not found" }, { status: 404 });
        }
        if (!canAccessStrategy(access, strategy)) {
            return NextResponse.json({ ok: false, error: "Strategy not found" }, { status: 404 });
        }
        const body = await request.json().catch(() => ({}));
        const name = typeof body?.name === "string" && body.name.trim()
            ? body.name.trim()
            : `${strategy.name} (copy)`;
        const now = Date.now();
        const newId = newStrategyId();
        const fingerprint = crypto.createHash("sha256").update(JSON.stringify(strategy.definition)).digest("hex").slice(0, 16);
        const { deriveMagicNumber } = await import("@/lib/bot-studio/magic-numbers");
        const copy = {
            ...strategy,
            id: newId,
            name,
            authorId: access.uid,
            state: "valid" as const,
            validationErrors: [],
            validationWarnings: [],
            fingerprint,
            magicNumber: deriveMagicNumber(newId),
            createdAt: now,
            updatedAt: now,
            lastBacktestAt: undefined,
            lastBacktestPassed: undefined,
            lastBacktestNetPnl: undefined,
            lastBacktestWinRate: undefined,
            lastBacktestTrades: undefined,
        };
        await saveStrategy(copy);
        await appendAudit(newId, strategyId, "strategy_created", access.uid, { name, duplicatedFrom: strategyId });
        return NextResponse.json({ ok: true, strategy: copy });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to duplicate strategy") },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ strategyId: string }> }
) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
        const { strategyId } = await context.params;
        const strategy = await getStrategy(strategyId);
        if (!strategy) {
            return NextResponse.json({ ok: false, error: "Strategy not found" }, { status: 404 });
        }
        if (!canAccessStrategy(access, strategy)) {
            return NextResponse.json({ ok: false, error: "Strategy not found" }, { status: 404 });
        }
        const success = await deleteStrategy(strategyId);
        if (success) {
            await appendAudit(strategyId, strategyId, "admin_override", access.uid, { name: strategy.name, action: "strategy_deleted" });
        }
        return NextResponse.json({ ok: true, deleted: success });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to delete strategy") },
            { status: 500 }
        );
    }
}