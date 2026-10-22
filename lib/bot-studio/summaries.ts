/**
 * Bot Studio — terminal-facing deployment summaries.
 *
 * The terminal needs one compact, owner-scoped view per bot: what it runs, how
 * it is doing, and whether it can actually trade right now. Composing that in
 * the browser would mean N requests per render and a second copy of the
 * eligibility rule, so it is built here, server-side, from the SAME records the
 * runtime writes:
 *
 *   bot_deployments/{botId}          deployment + lifecycle
 *   bot_strategies/{strategyId}      definition (symbol / timeframe / drift)
 *   bot_positions/{botId}            open positions (gateway snapshot)
 *   bot_trades/{botId}               closed trades (gateway snapshot)
 *   bot_executions/{botId}           execution attempts (latest outcome)
 *   trading_accounts/{uid}           gateway heartbeat (reachability)
 *
 * Every number is real recorded data. When a record is missing the field stays
 * null / zero and the UI says "unavailable" rather than inventing a value.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { getGatewayTokenForUser } from "@/lib/gateway";
import { isLiveTradingEnabled } from "@/lib/trading/feature-flags";
import { isGatewayConnected } from "@/lib/trading/gateway/health";
import { accountKey } from "@/lib/risk/account-state";
import { evaluateBotEligibility } from "./eligibility";
import { computeBotStats, loadBotPositions, loadBotTrades } from "@/lib/bots";
import { getRecentExecutions, getStrategy } from "./database";
import type {
    BotDeployment,
    BotDeploymentSummary,
    BotOpenPosition,
} from "./types";

/**
 * Bounds the per-request fan-out. A terminal lists a user's own bots (a handful
 * in practice); beyond this the deployment still appears, just without the
 * expensive detail.
 */
export const MAX_SUMMARISED_BOTS = 25;

function toOpenPositions(raw: Record<string, unknown>[]): BotOpenPosition[] {
    return raw
        .map((p) => {
            const type = String(p.type ?? "").trim().toUpperCase();
            return {
                ticket: String(p.ticket ?? p.id ?? ""),
                symbol: String(p.symbol ?? "").toUpperCase(),
                type: (type === "SELL" || type === "OP_SELL" || type === "1" ? "SELL" : "BUY") as
                    | "BUY"
                    | "SELL",
                volume: Number(p.volume) || 0,
                openPrice: Number(p.openPrice) || 0,
                currentPrice: Number(p.currentPrice) || Number(p.openPrice) || 0,
                profit: Number(p.profit) || 0,
                sl: Number(p.sl) || 0,
                tp: Number(p.tp) || 0,
                openedAt: Number(p.openTime ?? p.openedAt) || 0,
            };
        })
        .filter((p) => p.ticket !== "");
}

/** One bot's open positions, exactly as the gateway snapshot indexed them. */
export async function loadBotOpenPositions(botId: string): Promise<BotOpenPosition[]> {
    const positions = await loadBotPositions(botId);
    return toOpenPositions(positions as unknown as Record<string, unknown>[]);
}

/**
 * Reads the gateway facts ONCE per user: whether a token exists and whether any
 * of the user's accounts is currently reporting a fresh heartbeat.
 *
 * Returns a per-account-key lookup so a deployment bound to a particular MT5
 * account is judged against THAT account, not against whichever account the
 * browser happens to display.
 */
async function loadGatewayFacts(
    userId: string,
    now: number
): Promise<{ hasToken: boolean; connectedAccounts: Set<string> }> {
    const [token, accountsSnap] = await Promise.all([
        getGatewayTokenForUser(userId).catch(() => null),
        adminDatabase.ref(`trading_accounts/${userId}`).get(),
    ]);
    const accounts = (accountsSnap.val() || {}) as Record<string, Record<string, unknown>>;
    const connectedAccounts = new Set<string>();
    for (const [key, record] of Object.entries(accounts)) {
        if (isGatewayConnected(record, now)) connectedAccounts.add(key);
    }
    return { hasToken: Boolean(token), connectedAccounts };
}

/**
 * Builds the summary map for the deployments a caller is allowed to see.
 *
 * `now` is injected so tests can reason about heartbeat freshness without
 * waiting on the clock.
 */
export async function buildDeploymentSummaries(
    userId: string,
    deployments: BotDeployment[],
    now: number = Date.now()
): Promise<Record<string, BotDeploymentSummary>> {
    if (deployments.length === 0) return {};

    const [{ hasToken, connectedAccounts }, liveTradingEnabled] = await Promise.all([
        loadGatewayFacts(userId, now),
        Promise.resolve(isLiveTradingEnabled()),
    ]);

    const targets = deployments.slice(0, MAX_SUMMARISED_BOTS);

    const rows = await Promise.all(
        targets.map(async (deployment) => {
            const [strategy, positions, trades, recentExecutions] = await Promise.all([
                getStrategy(deployment.strategyId).catch(() => null),
                loadBotOpenPositions(deployment.id).catch(() => []),
                loadBotTrades(deployment.id).catch(() => []),
                getRecentExecutions(deployment.id, 1).catch(() => []),
            ]);

            const stats = computeBotStats(trades, positions.map((p) => ({ ...p })));
            const symbol = strategy ? String(strategy.definition?.asset ?? "") : "";
            const timeframe = strategy?.definition?.timeframes?.setup
                ? String(strategy.definition.timeframes.setup)
                : "";
            const accountId = accountKey(deployment.mt5Account);
            const eligibility = evaluateBotEligibility({
                runtimeState: deployment.runtimeState,
                accountMode: deployment.accountMode,
                strategyPresent: Boolean(strategy),
                // A missing fingerprint cannot be verified, so it never counts
                // as a match — an unverifiable deployment must be re-deployed.
                fingerprintMatches: Boolean(
                    strategy && deployment.deployedFingerprint === strategy.fingerprint
                ),
                gatewayConnected: hasToken && connectedAccounts.has(accountId),
                liveTradingEnabled,
            });

            const lastExecution = recentExecutions[0] ?? null;

            const summary: BotDeploymentSummary = {
                botId: deployment.id,
                strategyName: strategy?.name ?? null,
                strategyPresent: Boolean(strategy),
                fingerprintMatches: Boolean(
                    strategy && deployment.deployedFingerprint === strategy.fingerprint
                ),
                symbol: symbol || null,
                timeframe: timeframe || null,
                openPositions: positions.length,
                floatingPnl: positions.reduce((sum, p) => sum + p.profit, 0),
                performance: {
                    totalPnl: stats.totalPnl,
                    todayPnl: stats.todayPnl,
                    winRate: stats.winRate,
                    totalTrades: stats.totalTrades,
                    openTrades: positions.length,
                },
                lastExecutionAt: lastExecution ? lastExecution.createdAt : null,
                lastExecutionStatus: lastExecution ? lastExecution.status : null,
                eligibility,
            };
            return [deployment.id, summary] as const;
        })
    );

    return Object.fromEntries(rows);
}
