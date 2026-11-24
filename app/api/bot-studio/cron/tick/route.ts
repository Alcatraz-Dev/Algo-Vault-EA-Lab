import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import { listAllDeployments, getStrategy, updateDeploymentState } from "@/lib/bot-studio/database";
import { BotRuntimeSession, type BotTickResult } from "@/lib/bot-studio/runtime";
import { loadBotStrategySeries } from "@/lib/bot-studio/market-series";
import type { SupportedSymbol } from "@/lib/market-data/types";
import { isCronRequest } from "@/lib/security/cron-auth";
import { buildScalpingSessionOptions, scalpingConfigFingerprint } from "@/lib/bot-studio/scalping/session";

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
                // Server-side candles on the strategy's setup timeframe plus any
                // rule-referenced timeframes — the same decision inputs the
                // backtest uses.
                const { candles, timeframe, series } = await loadBotStrategySeries(strategy.definition, symbol);
                if (candles.length === 0) {
                    results.push({
                        botId: bot.id,
                        strategyId: bot.strategyId,
                        symbol,
                        timeframe,
                        error: "No market candles available",
                    });
                    continue;
                }

                // A scalping bot runs the SAME runtime with two optional seams:
                // a directional evaluator and a strategy pacing filter. The
                // cache key carries the configuration fingerprint so a
                // reconfigured bot never resumes on a stale session.
                const scalping = strategy.scalpingConfig;
                const cacheKey = scalping
                    ? `${bot.id}:${scalpingConfigFingerprint(scalping)}`
                    : bot.id;

                let session = sessions.get(cacheKey);
                if (!session) {
                    const scalpingOptions = scalping
                        ? buildScalpingSessionOptions({
                              deployment: bot,
                              config: scalping,
                              magicNumber: strategy.magicNumber,
                          })
                        : {};
                    session = new BotRuntimeSession({
                        deployment: bot,
                        strategy: strategy.definition,
                        magicNumber: strategy.magicNumber,
                        ...scalpingOptions,
                    });
                    await session.initialize();
                    // Drop a previous configuration's session for this bot.
                    for (const key of sessions.keys()) {
                        if (key === bot.id || key.startsWith(`${bot.id}:`)) sessions.delete(key);
                    }
                    sessions.set(cacheKey, session);
                } else {
                    // Lifecycle intent changed since this session was cached.
                    session.refreshDeployment(bot);
                }

                const tickResult = await session.tick({ candles, timeframe, series });

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
