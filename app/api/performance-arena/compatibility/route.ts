import { NextRequest } from "next/server";
import { arenaAuth, arenaError, arenaJson, arenaOPTIONS } from "../_shared";
import { assessStrategyCompatibility, type StrategyMetricsInput } from "@/lib/performance-arena/compatibility";
import { getDefinition } from "@/lib/performance-arena/store";
import { getAttempt } from "@/lib/performance-arena/store";
import type { ChallengePolicy } from "@/lib/performance-arena/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
    return arenaOPTIONS();
}

interface CompatBody {
    definitionId?: unknown;
    attemptId?: unknown;
    strategy?: Partial<StrategyMetricsInput> & { strategyName?: unknown };
}

const asNumber = (value: unknown, fallback = 0): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

// Auth: bearer token. Deterministic comparison of backtest metrics (from the
// existing Strategy Lab / Research engines) against challenge rules. The
// response ALWAYS carries the no-guarantee disclaimer — backtests do not
// predict challenge or live results.
export async function POST(request: NextRequest) {
    try {
        const auth = await arenaAuth(request);
        if ("response" in auth) return auth.response;

        const body = (await request.json().catch(() => null)) as CompatBody | null;
        if (!body || !body.strategy) {
            return arenaJson({ error: "strategy metrics are required.", code: "INVALID_BODY" }, 400);
        }

        let policy: ChallengePolicy | null = null;
        if (typeof body.attemptId === "string" && body.attemptId) {
            const attempt = await getAttempt(auth.uid, body.attemptId);
            policy = attempt?.policy ?? null;
        }
        if (!policy && typeof body.definitionId === "string" && body.definitionId) {
            const definition = await getDefinition(body.definitionId);
            policy = definition?.policy ?? null;
        }
        if (!policy) {
            return arenaJson({ error: "Provide a definitionId or attemptId to evaluate against.", code: "INVALID_BODY" }, 400);
        }

        const strategy: StrategyMetricsInput = {
            strategyName: typeof body.strategy.strategyName === "string" ? body.strategy.strategyName.slice(0, 80) : "Strategy",
            backtestReturnPct: asNumber(body.strategy.backtestReturnPct),
            maxDrawdownPct: asNumber(body.strategy.maxDrawdownPct),
            worstDayLossPct: asNumber(body.strategy.worstDayLossPct),
            tradeCount: Math.max(0, Math.round(asNumber(body.strategy.tradeCount))),
            avgTradesPerDay: asNumber(body.strategy.avgTradesPerDay),
            bestDaySharePct: body.strategy.bestDaySharePct !== undefined ? asNumber(body.strategy.bestDaySharePct) : undefined,
            profitableDayRatio: body.strategy.profitableDayRatio !== undefined ? asNumber(body.strategy.profitableDayRatio) : undefined,
            markets: Array.isArray(body.strategy.markets) ? body.strategy.markets.slice(0, 12) : undefined,
        };

        const compatibility = assessStrategyCompatibility({ strategy, policy });
        return arenaJson({ compatibility });
    } catch (error) {
        return arenaError(error, "Failed to assess strategy compatibility.");
    }
}
