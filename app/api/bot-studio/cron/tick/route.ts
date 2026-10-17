import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import { listAllDeployments, getStrategy, updateDeploymentState } from "@/lib/bot-studio/database";
import { BotRuntimeSession, type BotTickResult } from "@/lib/bot-studio/runtime";
import { fetchCandles } from "@/lib/market-data/normalizer";
import type { MarketCandle, SupportedSymbol } from "@/lib/market-data/types";
import { isCronRequest } from "@/lib/security/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory cache of sessions across recurring ticks
const sessions = new Map<string, BotRuntimeSession>();

async function isAuthorized(request: NextRequest): Promise<boolean> {
    // CRON_SECRET (bearer or x-cron-secret) or an admin Firebase session.
    if (isCronRequest(request)) {
        return true;
    }

    const admin = await requireAdmin(request);
    return Boolean(admin);
}

export async function GET(request: NextRequest) {
    if (!(await isAuthorized(request))) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        const deployments = await listAllDeployments();
        const runningBots = deployments.filter(
            (d) => d.runtimeState === "running" && d.desiredState === "running"
        );

        if (runningBots.length === 0) {
            return NextResponse.json({
                ok: true,
                message: "No active running bots to evaluate",
                evaluatedCount: 0,
                results: [],
            });
        }

        const results: Array<{
            botId: string;
            strategyId: string;
            symbol: string;
            timeframe: string;
            tickResult?: BotTickResult;
            error?: string;
        }> = [];

        for (const bot of runningBots) {
            try {
                const strategy = await getStrategy(bot.strategyId);
                if (!strategy) {
                    results.push({
                        botId: bot.id,
                        strategyId: bot.strategyId,
                        symbol: "UNKNOWN",
                        timeframe: "UNKNOWN",
                        error: "Strategy not found",
                    });
                    continue;
                }

                const symbol = strategy.definition.asset as SupportedSymbol;
                const timeframe = strategy.definition.timeframes.entry;

                // Load latest candle
                const candles = await fetchCandles(symbol, timeframe, { to: Date.now() });
                if (!Array.isArray(candles) || candles.length === 0) {
                    results.push({
                        botId: bot.id,
                        strategyId: bot.strategyId,
                        symbol,
                        timeframe,
                        error: "No market candles available",
                    });
                    continue;
                }

                let session = sessions.get(bot.id);
                if (!session) {
                    session = new BotRuntimeSession({
                        deployment: bot,
                        strategy: strategy.definition,
                        magicNumber: strategy.magicNumber,
                    });
                    await session.initialize();
                    sessions.set(bot.id, session);
                }

                const tickResult = await session.tick({ candles, timeframe });

                await updateDeploymentState(bot.id, {
                    lastTickAt: Date.now(),
                });

                results.push({
                    botId: bot.id,
                    strategyId: bot.strategyId,
                    symbol,
                    timeframe,
                    tickResult,
                });
            } catch (botErr) {
                results.push({
                    botId: bot.id,
                    strategyId: bot.strategyId,
                    symbol: "ERROR",
                    timeframe: "ERROR",
                    error: botErr instanceof Error ? botErr.message : String(botErr),
                });
            }
        }

        return NextResponse.json({
            ok: true,
            evaluatedCount: runningBots.length,
            timestamp: Date.now(),
            results,
        });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Cron tick runner failed") },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    return GET(request);
}
