import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import { requireBotStudioAccess } from "@/lib/bot-studio/auth";
import { getStrategy, saveStrategy, appendAudit } from "@/lib/bot-studio/database";
import { loadDataBundle } from "@/lib/strategy-lab/market-data";
import { backtestStrategy, defaultBacktestConfig } from "@/lib/strategy-lab/backtest";
import type { SupportedSymbol, Timeframe, MarketCandle } from "@/lib/market-data/types";
import {
    DEFAULT_HIERARCHY,
    type BacktestConfig,
    type AnalysisPeriod,
    type TimeframeHierarchy,
} from "@/lib/strategy-lab/types";
import type { BotStrategy } from "@/lib/bot-studio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ strategyId: string }> }
) {
    const access = await requireBotStudioAccess(request);
    if (!access) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { strategyId } = await context.params;
        const strategy = await getStrategy(strategyId);
        if (!strategy) {
            return NextResponse.json({ ok: false, error: "Strategy not found" }, { status: 404 });
        }

        const body = await request.json().catch(() => ({}));
        const symbol = (body.symbol || strategy.definition.asset || "XAUUSD") as SupportedSymbol;
        const period = (body.period || "1Y") as AnalysisPeriod;

        const hierarchy: TimeframeHierarchy = {
            ...DEFAULT_HIERARCHY,
            ...(strategy.definition.timeframes ?? {}),
        };

        const config: BacktestConfig = {
            ...defaultBacktestConfig(),
            ...(body.config ?? {}),
        };

        // Load real historical data bundle
        const bundle = await loadDataBundle(symbol, period, hierarchy);
        const candlesByTF: Partial<Record<Timeframe, MarketCandle[]>> = {};
        for (const tf of [hierarchy.macro, hierarchy.structure, hierarchy.setup, hierarchy.entry]) {
            const data = bundle.candles[tf];
            if (Array.isArray(data) && data.length > 0) {
                candlesByTF[tf] = data;
            }
        }

        const from = body.from ?? config.from ?? 0;
        const to = body.to ?? config.to ?? Number.MAX_SAFE_INTEGER;

        // Run canonical backtest
        const result = backtestStrategy(strategy.definition, symbol, candlesByTF, config, from, to);

        const netProfit = result.metrics.netProfit;
        const winRate = result.metrics.winRate;
        const tradesCount = result.trades.length;
        const passed = tradesCount > 0 && netProfit > 0;

        const updatedStrategy: BotStrategy = {
            ...strategy,
            updatedAt: Date.now(),
            lastBacktestAt: Date.now(),
            lastBacktestPassed: passed,
            lastBacktestNetPnl: netProfit,
            lastBacktestWinRate: winRate,
            lastBacktestTrades: tradesCount,
        };

        await saveStrategy(updatedStrategy);

        await appendAudit(
            strategy.id,
            strategy.id,
            "strategy_backtested",
            access.uid,
            {
                symbol,
                period,
                netProfit,
                winRate,
                tradesCount,
                passed,
                profitFactor: result.metrics.profitFactor,
                maxDrawdownPct: result.metrics.maxDrawdownPct,
            }
        );

        return NextResponse.json({
            ok: true,
            backtest: result,
            strategy: updatedStrategy,
        });
    } catch (error) {
        return NextResponse.json(
            { ok: false, error: errMessage(error, "Failed to run backtest") },
            { status: 500 }
        );
    }
}
