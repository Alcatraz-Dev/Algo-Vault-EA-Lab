import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { requireBotStudioAccess, canAccessDeployment } from "@/lib/bot-studio/auth";
import { getDeployment, updateDeploymentState } from "@/lib/bot-studio/database";
import { ScalpingBotRuntime } from "@/lib/bot-studio/scalping";

// In-memory cache of scalper runtime sessions (one per deployment).
const sessions = new Map<string, ScalpingBotRuntime>();

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

        // Scalper bots are pre-built strategies; the generic strategy runtime
        // is NOT used for them. The scalping runtime drives the M1 tick loop
        // and calls buildScalpingEntry directly.
        let session = sessions.get(botId);
        if (!session) {
            session = new ScalpingBotRuntime(deployment, deployment.mt5Account || "");
            sessions.set(botId, session);
        } else {
            // Cached sessions must observe pausing/stopping immediately.
            await session.loadConfig();
        }

        const tickResult = await session.tick();

        await updateDeploymentState(botId, {
            lastTickAt: Date.now(),
        });

        return NextResponse.json({
            ok: true,
            tickResult,
            botId,
            symbol: "XAUUSD",
            timeframe: "M1",
        });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to execute scalper tick") },
            { status: 500 }
        );
    }
}
