/**
 * AlgoVault — persisted scalping bot report.
 *
 * Everything the terminal shows about a scalping bot is read from RTDB:
 * deployment state, recorded signals, execution attempts and MT5 closed deals
 * attributed by the bot's magic number. Missing data is reported as
 * unavailable — never filled with a plausible number.
 *
 * Result sources are kept EXPLICITLY separate:
 *   • `backtest`  — a real Strategy Lab backtest the user ran (if any)
 *   • `paper`     — this platform has no paper fill engine for bots, so it is
 *                   always null, not zero
 *   • `demo`      — closed deals from the MT5 demo account via the gateway
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { accountKey, loadAccountRiskSnapshot } from "@/lib/risk/account-state";
import type { BotDeployment, BotExecution, BotSignal, BotStrategy } from "../types";
import { getRecentExecutions, getRecentSignals, getStrategy } from "../database";
import type { ScalpingBotConfig } from "./profiles";
import { scalpingMethodologyTrace, type MethodologyTrace } from "./methodologies";
import { loadAccountPositionMode } from "@/lib/trading/account-position-mode";
import type { TradingPositionMode } from "@/lib/trading/position-mode";
import { resolveBrokerSizingSpec, type BrokerSizingSpec } from "./broker-sizing";
import { directionAllows } from "./presentation";

export interface ClosedTradeRow {
    ticket: string;
    symbol: string;
    type: string;
    volume: number;
    profit: number;
    swap: number;
    openedAt: number;
    closedAt: number;
    magic: string;
}

export interface DemoPerformance {
    available: boolean;
    reason?: string;
    closedTrades: number;
    wins: number;
    losses: number;
    breakeven: number;
    winRate: number | null;
    realizedPnl: number;
    /** Peak-to-trough on the closed-trade equity curve, in account currency. */
    maxClosedDrawdown: number;
    openPositions: number;
    unrealizedPnl: number;
    lastClosedAt: number | null;
}

export interface DailyNotionalUsage {
    used: number | null;
    budget: number | null;
    /** Where each number came from — never merged into one optimistic figure. */
    source: "account_ledger" | "unknown";
    incomplete: boolean;
}

export interface ScalpingRiskDecision {
    id: string;
    at: number;
    outcome: "rejected" | "approved";
    code: string;
    reason: string;
    symbol?: string;
    direction?: string;
    volume?: number;
}

export interface BotPositionRow {
    ticket: string;
    symbol: string;
    side: "long" | "short" | null;
    volume: number;
    entryPrice: number | null;
    currentPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    unrealizedPnl: number | null;
    openedAt: number | null;
}

/** One direction's persisted state. Never merged with the opposite side. */
export interface LaneReport {
    side: "long" | "short";
    enabled: boolean;
    status: "POSITION_OPEN" | "SIGNAL_READY" | "WAITING" | "BLOCKED" | "NOT_EVALUATED";
    openPositions: number;
    blockedReason: string | null;
    confidence: number | null;
    lastSignalAt: number | null;
    positions: BotPositionRow[];
}

export interface BotAccountSummary {
    key: string;
    mode: BotDeployment["accountMode"];
    brokerName: string | null;
    serverName: string | null;
    currency: string | null;
    balance: number | null;
    equity: number | null;
    positionMode: TradingPositionMode;
    positionModeReportedAt: number | null;
}

export interface BotSizingReport {
    /** Only risk-based sizing is enforced by the runtime today. */
    mode: "risk_based";
    riskPerTradePercent: number | null;
    /** The canonical server risk engine computes and validates final volume. */
    engine: "server_risk_engine";
    fixedLotAvailable: false;
    brokerSpec: BrokerSizingSpec;
    note: string;
}

export interface ScalpingBotReport {
    botId: string;
    strategyId: string;
    name: string;
    symbol: string;
    timeframe: string;
    direction: ScalpingBotConfig["direction"] | null;
    preset: ScalpingBotConfig["preset"] | null;
    config: ScalpingBotConfig | null;
    accountMode: BotDeployment["accountMode"];
    runtimeState: BotDeployment["runtimeState"];
    desiredState: BotDeployment["desiredState"];
    errorReason: string | null;
    startedAt: number | null;
    stoppedAt: number | null;
    lastTickAt: number | null;
    lastSignalAt: number | null;
    lastExecutionAt: number | null;
    lastEvaluation: BotDeployment["lastEvaluation"] | null;
    counters: { signals: number; executions: number; rejections: number };
    recentSignals: BotSignal[];
    recentExecutions: BotExecution[];
    riskDecisions: ScalpingRiskDecision[];
    performance: {
        demo: DemoPerformance;
        /** Always null: the platform has no bot paper-fill engine. */
        paper: null;
        backtest: {
            available: boolean;
            ranAt: number | null;
            passed: boolean | null;
            netPnl: number | null;
            winRate: number | null;
            trades: number | null;
            note: string;
        };
    };
    dailyNotional: DailyNotionalUsage;
    account: BotAccountSummary;
    positionMode: TradingPositionMode;
    lanes: { long: LaneReport; short: LaneReport };
    sizing: BotSizingReport;
    methodologies: MethodologyTrace[];
    generatedAt: number;
}

function emptyDemoPerformance(reason: string): DemoPerformance {
    return {
        available: false,
        reason,
        closedTrades: 0,
        wins: 0,
        losses: 0,
        breakeven: 0,
        winRate: null,
        realizedPnl: 0,
        maxClosedDrawdown: 0,
        openPositions: 0,
        unrealizedPnl: 0,
        lastClosedAt: null,
    };
}

async function loadClosedDeals(
    userId: string,
    account: string,
): Promise<ClosedTradeRow[]> {
    const snap = await adminDatabase.ref(`trading_history/${userId}/${account}`).get();
    if (!snap.exists()) return [];
    const val = (snap.val() || {}) as Record<string, Record<string, unknown>>;
    return Object.entries(val).map(([ticket, raw]) => ({
        ticket,
        symbol: String(raw?.symbol ?? ""),
        type: String(raw?.type ?? ""),
        volume: Number(raw?.volume ?? 0),
        profit: Number(raw?.profit ?? 0),
        swap: Number(raw?.swap ?? 0),
        openedAt: Number(raw?.openedAt ?? 0),
        closedAt: Number(raw?.closedAt ?? 0),
        magic: String(raw?.magic ?? ""),
    }));
}

function numberOrNull(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

async function loadOpenPositions(
    userId: string,
    account: string,
    magicNumber: number,
): Promise<{ count: number; unrealizedPnl: number; rows: BotPositionRow[] }> {
    const snap = await adminDatabase.ref(`trading_positions/${userId}/${account}`).get();
    if (!snap.exists()) return { count: 0, unrealizedPnl: 0, rows: [] };
    const val = (snap.val() || {}) as Record<string, Record<string, unknown>>;
    let count = 0;
    let unrealizedPnl = 0;
    const rows: BotPositionRow[] = [];

    for (const [ticket, position] of Object.entries(val)) {
        if (!position || typeof position !== "object") continue;
        if (Number(position.magic) !== magicNumber) continue;
        count += 1;
        const profit = Number(position.profit ?? 0);
        unrealizedPnl += Number.isFinite(profit) ? profit : 0;
        const type = String(position.type ?? "").trim().toUpperCase();
        rows.push({
            ticket: String(position.ticket ?? ticket),
            symbol: String(position.symbol ?? ""),
            side: type === "BUY" || type === "0" ? "long" : type === "SELL" || type === "1" ? "short" : null,
            volume: Number(position.volume ?? 0) || 0,
            entryPrice: numberOrNull(position.openPrice),
            currentPrice: numberOrNull(position.currentPrice),
            stopLoss: numberOrNull(position.sl),
            takeProfit: numberOrNull(position.tp),
            unrealizedPnl: Number.isFinite(profit) ? profit : null,
            openedAt: numberOrNull(position.openedAt),
        });
    }
    return { count, unrealizedPnl, rows };
}

/**
 * Compute demo performance strictly from persisted closed deals that belong to
 * this bot (magic match) and were opened after the bot started.
 */
export function summarizeDemoPerformance(
    deals: ClosedTradeRow[],
    magicNumber: number,
    startedAt: number | null,
    openPositions: { count: number; unrealizedPnl: number },
): DemoPerformance {
    const owned = deals
        .filter((d) => d.magic === String(magicNumber))
        .filter((d) => startedAt === null || d.openedAt >= startedAt)
        .sort((a, b) => a.closedAt - b.closedAt);

    if (owned.length === 0) {
        return {
            ...emptyDemoPerformance(
                startedAt === null
                    ? "The bot has not started yet — no closed deals to report."
                    : "No closed deals for this bot have been reported by the gateway yet.",
            ),
            openPositions: openPositions.count,
            unrealizedPnl: openPositions.unrealizedPnl,
        };
    }

    let wins = 0;
    let losses = 0;
    let breakeven = 0;
    let realizedPnl = 0;
    let peak = 0;
    let maxClosedDrawdown = 0;
    let lastClosedAt: number | null = null;

    for (const deal of owned) {
        const net = deal.profit + deal.swap;
        realizedPnl += net;
        if (net > 0) wins += 1;
        else if (net < 0) losses += 1;
        else breakeven += 1;
        peak = Math.max(peak, realizedPnl);
        maxClosedDrawdown = Math.max(maxClosedDrawdown, peak - realizedPnl);
        lastClosedAt = lastClosedAt === null ? deal.closedAt : Math.max(lastClosedAt, deal.closedAt);
    }

    return {
        available: true,
        closedTrades: owned.length,
        wins,
        losses,
        breakeven,
        winRate: owned.length > 0 ? wins / owned.length : null,
        realizedPnl,
        maxClosedDrawdown,
        openPositions: openPositions.count,
        unrealizedPnl: openPositions.unrealizedPnl,
        lastClosedAt,
    };
}

/** Risk decisions derived from recorded rejections (signals + executions). */
export function buildRiskDecisions(
    signals: BotSignal[],
    executions: BotExecution[],
    limit = 25,
): ScalpingRiskDecision[] {
    const fromSignals: ScalpingRiskDecision[] = signals
        .filter((s) => s.outcome === "rejected" && (s.rejectionCode || s.rejectionReason))
        .map((s) => ({
            id: s.id,
            at: s.generatedAt,
            outcome: "rejected",
            code: s.rejectionCode ?? "REJECTED",
            reason: s.rejectionReason ?? "Rejected without a recorded reason.",
            symbol: s.symbol,
            direction: s.direction,
        }));

    const fromExecutions: ScalpingRiskDecision[] = executions
        .filter((e) => e.status === "failed" || e.status === "gate_rejected")
        .map((e) => ({
            id: e.id,
            at: e.createdAt,
            outcome: "rejected",
            code: e.executionOutcome === "rejected" ? "EXECUTION_REJECTED" : e.status.toUpperCase(),
            reason:
                (Array.isArray(e.gateChecks) && e.gateChecks.find((c) => !c.passed)?.reason) ||
                `Execution ended in status ${e.status}.`,
            symbol: e.symbol,
            direction: e.direction,
            volume: e.volume,
        }));

    return [...fromSignals, ...fromExecutions].sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Assemble the full persisted report for one scalping deployment. */
export async function buildScalpingBotReport(
    deployment: BotDeployment,
    strategy: BotStrategy,
): Promise<ScalpingBotReport> {
    const config = strategy.scalpingConfig ?? null;
    const account = accountKey(deployment.mt5Account);

    const [signals, executions, deals, positions, riskSnapshot, positionModeRecord] = await Promise.all([
        getRecentSignals(deployment.id, 25).catch(() => []),
        getRecentExecutions(deployment.id, 25).catch(() => []),
        loadClosedDeals(deployment.ownerId, account).catch(() => []),
        loadOpenPositions(deployment.ownerId, account, strategy.magicNumber).catch(() => ({
            count: 0,
            unrealizedPnl: 0,
            rows: [],
        })),
        loadAccountRiskSnapshot(deployment.ownerId, account).catch(() => null),
        loadAccountPositionMode(deployment.ownerId, account).catch(() => null),
    ]);

    const controls = (riskSnapshot?.controls ?? {}) as Record<string, unknown>;
    const accountBudget = Number(controls.maxDailyNotional);
    const botBudget = config?.dailyNotionalBudget ?? null;
    const budgetCandidates = [accountBudget, botBudget].filter(
        (n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0,
    );

    const used = riskSnapshot?.account.dailyNotionalUsed ?? null;
    const accountRecord = (riskSnapshot?.accountRecord ?? {}) as Record<string, unknown>;
    const positionMode: TradingPositionMode = positionModeRecord?.mode ?? "UNKNOWN";
    const brokerSpec = resolveBrokerSizingSpec(accountRecord);
    const directionMode = config?.direction ?? null;

    const lane = (side: "long" | "short"): LaneReport => {
        const rows = positions.rows.filter((row) => row.side === side);
        const persisted = deployment.lanes?.[side];
        const enabled = directionAllows(directionMode, side);
        const status: LaneReport["status"] = !enabled
            ? "NOT_EVALUATED"
            : rows.length > 0
              ? "POSITION_OPEN"
              : persisted?.status ?? (deployment.lastEvaluation?.direction === side ? "SIGNAL_READY" : "WAITING");
        const lastSignalAt =
            signals.find((s) => (side === "long" ? s.direction === "BUY" : s.direction === "SELL"))?.generatedAt ?? null;
        return {
            side,
            enabled,
            status,
            openPositions: rows.length,
            blockedReason: persisted?.blockedReason ?? null,
            confidence: persisted?.confidence ?? null,
            lastSignalAt,
            positions: rows,
        };
    };

    return {
        botId: deployment.id,
        strategyId: deployment.strategyId,
        name: strategy.name,
        symbol: strategy.definition.asset,
        timeframe: strategy.definition.timeframes.setup,
        direction: config?.direction ?? null,
        preset: config?.preset ?? null,
        config,
        accountMode: deployment.accountMode,
        runtimeState: deployment.runtimeState,
        desiredState: deployment.desiredState,
        errorReason: deployment.errorReason ?? null,
        startedAt: deployment.startedAt ?? null,
        stoppedAt: deployment.stoppedAt ?? null,
        lastTickAt: deployment.lastTickAt ?? null,
        lastSignalAt: deployment.lastSignalAt ?? null,
        lastExecutionAt: deployment.lastExecutionAt ?? null,
        lastEvaluation: deployment.lastEvaluation ?? null,
        counters: {
            signals: deployment.signalCount ?? 0,
            executions: deployment.executionCount ?? 0,
            rejections: deployment.rejectionCount ?? 0,
        },
        recentSignals: signals,
        recentExecutions: executions,
        riskDecisions: buildRiskDecisions(signals, executions),
        performance: {
            demo: summarizeDemoPerformance(deals, strategy.magicNumber, deployment.startedAt ?? null, positions),
            paper: null,
            backtest: {
                available: strategy.lastBacktestAt !== undefined,
                ranAt: strategy.lastBacktestAt ?? null,
                passed: strategy.lastBacktestPassed ?? null,
                netPnl: strategy.lastBacktestNetPnl ?? null,
                winRate: strategy.lastBacktestWinRate ?? null,
                trades: strategy.lastBacktestTrades ?? null,
                note: strategy.lastBacktestAt
                    ? "Strategy Lab backtest — historical simulation, not live results."
                    : "No Strategy Lab backtest has been run for this strategy.",
            },
        },
        dailyNotional: {
            used,
            budget: budgetCandidates.length > 0 ? Math.min(...budgetCandidates) : null,
            source: used === null ? "unknown" : "account_ledger",
            incomplete: riskSnapshot?.account.dailyNotionalIncomplete === true,
        },
        account: {
            key: account,
            mode: deployment.accountMode,
            brokerName: typeof accountRecord.broker === "string" ? accountRecord.broker : null,
            serverName: typeof accountRecord.server === "string" ? accountRecord.server : null,
            currency: typeof accountRecord.currency === "string" ? accountRecord.currency : null,
            balance: numberOrNull(accountRecord.balance),
            equity: numberOrNull(accountRecord.equity),
            positionMode,
            positionModeReportedAt: positionModeRecord?.reportedAt ?? null,
        },
        positionMode,
        lanes: { long: lane("long"), short: lane("short") },
        sizing: {
            mode: "risk_based",
            riskPerTradePercent: config?.riskPerTradePercent ?? null,
            engine: "server_risk_engine",
            fixedLotAvailable: false,
            brokerSpec,
            note: brokerSpec.available
                ? "Final volume is computed and validated server-side by the canonical risk engine at execution, using the broker's minimum, maximum and step."
                : "The broker's minimum volume and step have not been reported, so lot presets and monetary risk estimates are unavailable. Final volume is still computed and validated server-side at execution.",
        },
        methodologies: scalpingMethodologyTrace(),
        generatedAt: Date.now(),
    };
}

/** Resolve deployment + strategy with ownership applied by the caller. */
export async function loadScalpingReport(
    deployment: BotDeployment,
): Promise<ScalpingBotReport | null> {
    const strategy = await getStrategy(deployment.strategyId);
    if (!strategy) return null;
    return buildScalpingBotReport(deployment, strategy);
}
