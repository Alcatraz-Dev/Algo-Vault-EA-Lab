import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { requireBotStudioAccess, canAccessDeployment } from "@/lib/bot-studio/auth";
import { getDeployment, getStrategy, updateDeploymentState } from "@/lib/bot-studio/database";
import { BotRuntimeSession } from "@/lib/bot-studio/runtime";
import { loadBotStrategySeries } from "@/lib/bot-studio/market-series";
import type { SupportedSymbol } from "@/lib/market-data/types";

// In-memory cache of runtime sessions so sequential engine bars are preserved
const sessions = new Map<string, BotRuntimeSession>();

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

        const strategy = await getStrategy(deployment.strategyId);
        if (!strategy) {
            return NextResponse.json({ ok: false, error: "Strategy definition not found" }, { status: 404 });
        }

        // Candles are always loaded server-side on the strategy's OWN
        // setup timeframe (the canonical evaluation series). A request body
        // cannot inject prices into the decision path.
        const symbol = strategy.definition.asset as SupportedSymbol;
        const { candles, timeframe, series } = await loadBotStrategySeries(strategy.definition, symbol);

        if (candles.length === 0) {
            return NextResponse.json(
                { ok: false, error: `No market candles available for ${symbol} ${timeframe}` },
                { status: 400 }
            );
        }

        let session = sessions.get(botId);
        if (!session) {
            session = new BotRuntimeSession({
                deployment,
                strategy: strategy.definition,
                magicNumber: strategy.magicNumber,
            });
            await session.initialize();
            sessions.set(botId, session);
        } else {
            // Cached sessions must observe pausing/stopping immediately.
            session.refreshDeployment(deployment);
        }

        const tickResult = await session.tick({ candles, timeframe, series });

        await updateDeploymentState(botId, {
            lastTickAt: Date.now(),
        });

        return NextResponse.json({
            ok: true,
            tickResult,
            candlesProcessed: candles.length,
            symbol,
            timeframe,
        });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to execute tick on bot") },
            { status: 500 }
        );
    }
}
