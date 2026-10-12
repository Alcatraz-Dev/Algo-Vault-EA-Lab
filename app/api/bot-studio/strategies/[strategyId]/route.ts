import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import { getStrategy, deleteStrategy, appendAudit } from "@/lib/bot-studio/database";

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ strategyId: string }> }
) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { strategyId } = await context.params;
        const strategy = await getStrategy(strategyId);
        if (!strategy) {
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

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ strategyId: string }> }
) {
    const admin = await requireAdmin(request);
    if (!admin) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { strategyId } = await context.params;
        const strategy = await getStrategy(strategyId);
        if (!strategy) {
            return NextResponse.json({ ok: false, error: "Strategy not found" }, { status: 404 });
        }

        const success = await deleteStrategy(strategyId);
        if (success) {
            await appendAudit(
                strategyId,
                strategyId,
                "admin_override",
                admin.uid,
                { name: strategy.name, action: "strategy_deleted" }
            );
        }

        return NextResponse.json({ ok: true, deleted: success });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to delete strategy") },
            { status: 500 }
        );
    }
}
