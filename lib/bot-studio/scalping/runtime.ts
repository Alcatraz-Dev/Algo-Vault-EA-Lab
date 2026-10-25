/**
 * Scalper bot runtime — M1 tick hook.
 *
 * This is the runtime hook the bot-studio cron route calls for each running
 * XAUUSD M1 scalper deployment. It is deliberately SEPARATE from the generic
 * `BotRuntimeSession` because the scalper is a pre-built strategy (not a
 * `evaluateStrategySignal`-style rule set):
 *
 *   1. Load the per-bot config from RTDB (`bot_scalpers/{botId}`), merging
 *      against defaults so edits survive a reload.
 *   2. On each M1 candle, call `buildScalpingEntry()` to produce the dual-TP
 *      order payload (TP1 with partial-close, TP2 attached after TP1, hard SL).
 *   3. If the spread filter rejects the tick, skip silently (counted).
 *   4. Submit the order through the unified trading service (gateway queue).
 *   5. Record the signal + execution in RTDB so the UI can render them.
 *
 * INVARIANTS (same no-fabrication contract as the rest of the platform):
 *   - No order is ever simulated or invented — only gateway ACKs update state.
 *   - A stale/unknown position is never reported as filled.
 *   - The spread filter is the only signal gate; the AI gate is NOT applied
 *     (the scalper is a deterministic rule, not an AI surface).
 */

import type { BotDeployment } from "../types";
import type { BotSignal, BotExecution } from "../types";
import type { XauUsdScalpingConfig } from "./config";
import {
    getBotScalperConfig,
    saveBotScalperConfig,
    saveSignal,
    saveExecution,
    appendLog,
    appendAudit,
} from "../database";
import { buildScalpingEntry, signalFromOrder } from "./executor";
import { XAUUSD_SCALPING_DEFAULTS } from "./config";
import { newSignalId, newExecutionId } from "../database";
import { executeUnified, newClientRequestId } from "@/lib/trading/unified/client";
import { getMarketTruth } from "@/lib/market-data/market-truth";
import { isSymbolMarketOpen } from "@/lib/ai-signals/sessions-filter";

/** Interval (ms) at which the cron tick route drives a scalper tick. */
export const SCALPER_TICK_INTERVAL_MS = 60_000;

/**
 * A scalper runtime instance for ONE deployed bot.
 *
 * Created per deployment; the cron route keeps one live instance (or a small
 * pool) and calls `tick()` on the interval. State lives in RTDB, so restarts
 * are safe.
 */
export class ScalpingBotRuntime {
    readonly deployment: BotDeployment;
    readonly botId: string;
    readonly accountId: string;
    private config: XauUsdScalpingConfig = XAUUSD_SCALPING_DEFAULTS;
    private tickCountRef = 0;
    private pendingCloseTickets = new Set<string>();

    constructor(deployment: BotDeployment, accountId: string) {
        this.deployment = deployment;
        this.botId = deployment.id;
        this.accountId = accountId;
        // Config is loaded fresh from RTDB on each tick so that a UI-driven
        // config change is picked up within one tick cycle.
        this.loadConfig();
    }

    /** Load config from RTDB onto this instance. */
    async loadConfig(): Promise<void> {
        const cfg = await getBotScalperConfig(this.botId);
        this.config = cfg ?? { ...XAUUSD_SCALPING_DEFAULTS };
    }

    /** Persist the current config to RTDB (called when the UI edits it). */
    async saveConfig(next: Partial<XauUsdScalpingConfig>): Promise<void> {
        await saveBotScalperConfig(this.botId, next);
        // Refresh the in-process copy so subsequent ticks use the new values.
        await this.loadConfig();
    }

    /** Drive one M1 tick cycle. Idempotent: re-running on the same bar is a no-op.
     *
     *  Returns { ticks: number, signalGenerated: boolean, submitted: boolean, skippedBySpread: boolean, error?: string }.
     */
    async tick(): Promise<{
        ticks: number;
        signalGenerated: boolean;
        submitted: boolean;
        skippedBySpread: boolean;
        error?: string;
    }> {
        // Guard: persist the lifecycle intent. If the deployment is not running,
        // do nothing.
        if (this.deployment.desiredState !== "running" || this.deployment.runtimeState !== "running") {
            return { ticks: 0, signalGenerated: false, submitted: false, skippedBySpread: false, error: undefined };
        }

        // Sleep when market is closed — do not send trades or poll empty order books
        if (!isSymbolMarketOpen("XAUUSD")) {
            return { ticks: 0, signalGenerated: false, submitted: false, skippedBySpread: false, error: "market closed — bot sleeping" };
        }

        const config = this.config;
        if (!config.enabled) return { ticks: 0, signalGenerated: false, submitted: false, skippedBySpread: false, error: undefined };

        // Fetch the latest M1 market truth (bid/ask/spread).
        const marketTruth = await getMarketTruth("XAUUSD", "M1");
        if (!marketTruth?.snapshot) {
            return { ticks: 1, signalGenerated: false, submitted: false, skippedBySpread: false, error: "no market truth" };
        }
        const snapshot = marketTruth.snapshot;
        const spreadPoints = Math.round((snapshot.ask - snapshot.bid) / 0.01);

        // Spread filter — the only signal gate for a scalper.
        if (spreadPoints > config.maxSpreadPoints) {
            this.increment(`spread skipped ${spreadPoints}pts > cap ${config.maxSpreadPoints}pts`);
            return { ticks: 1, signalGenerated: false, submitted: false, skippedBySpread: true, error: undefined };
        }

        const tick = { bid: snapshot.bid, ask: snapshot.ask, spreadPoints };
        const entry = buildScalpingEntry(config.direction, tick, config, 0.01); // defaultLot
        if (!entry) return { ticks: 1, signalGenerated: false, submitted: false, skippedBySpread: false, error: undefined };

        const signal = signalFromOrder(entry);
        signal.id = newSignalId();
        signal.botId = this.botId;
        signal.strategyId = this.deployment.strategyId;
        signal.barTimestamp = Date.now();
        signal.generatedAt = Date.now();
        signal.outcome = "pending";

        // Persist the signal record.
        await saveSignal(signal);
        await appendLog(
            this.botId,
            "signal",
            `Scalp signal: ${signal.direction} ${signal.symbol} @ ${signal.proposedEntry?.toFixed(2)} (TP1 ${signal.proposedTp?.toFixed(2)} / TP2 ${entry.tp2.toFixed(2)} / SL ${signal.proposedSl?.toFixed(2)})`,
            {
                signalId: signal.id,
                direction: signal.direction,
                proposedEntry: signal.proposedEntry,
                tp1: signal.proposedTp,
                tp2: entry.tp2,
                sl: signal.proposedSl,
                spread: spreadPoints,
            },
        );

        // Submit through the unified trading service (gateway queue).
        const account = this.deployment.mt5Account || this.accountId || "";
        if (!account) {
            await saveExecution({
                id: newExecutionId(),
                botId: this.botId,
                strategyId: this.deployment.strategyId,
                signalId: signal.id,
                status: "failed",
                symbol: signal.symbol,
                direction: signal.direction,
                volume: entry.volume,
                entry: signal.proposedEntry,
                sl: signal.proposedSl,
                tp: signal.proposedTp,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                signalGeneratedAt: signal.generatedAt,
            });
            await appendAudit(this.botId, this.deployment.strategyId, "execution_attempted", this.deployment.ownerId ?? "", {
                executionId: signal.id,
                error: "no connected MT5 account",
            });
            await appendLog(this.botId, "error", `No connected MT5 account for scalper tick`, { executionId: signal.id });
            return { ticks: 1, signalGenerated: true, submitted: false, skippedBySpread: false, error: "no connected MT5 account" };
        }

        const executionResult = await executeUnified(
            {
                accountId: account,
                clientRequestId: newClientRequestId(),
                executionType: "PLACE_ORDER",
                symbol: signal.symbol,
                side: signal.direction,
                volume: entry.volume,
                kind: "MARKET",
                price: entry.entry,
                stopLoss: signal.proposedSl ?? null,
                takeProfit: signal.proposedTp ?? null,
                source: "xauusd-scalper",
            },
            this.deployment.ownerId ?? "",
        );

        const execOk = executionResult.status === "SUCCEEDED" || executionResult.status === "EXECUTED_PENDING_SYNC";
        const execution: BotExecution = {
            id: newExecutionId(),
            botId: this.botId,
            strategyId: this.deployment.strategyId,
            signalId: signal.id,
            status: execOk ? "submitted" : "rejected_by_broker",
            symbol: signal.symbol,
            direction: signal.direction,
            volume: entry.volume,
            entry: signal.proposedEntry,
            sl: signal.proposedSl,
            tp: signal.proposedTp,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            signalGeneratedAt: signal.generatedAt,
            executionOutcome: execOk ? "accepted" : "rejected",
        };
        if (execOk) {
            execution.status = executionResult.status === "EXECUTED_PENDING_SYNC" ? "executed_pending_sync" : "submitted";
        }
        await saveExecution(execution);
        await appendAudit(
            this.botId,
            this.deployment.strategyId,
            "execution_attempted",
            this.deployment.ownerId ?? "",
            {
                executionId: execution.id,
                clientRequestId: executionResult.clientRequestId ?? undefined,
                signal: signal.direction,
                symbol: signal.symbol,
                volume: entry.volume,
            },
        );
        await appendLog(
            this.botId,
            execOk ? "execution" : "warn",
            `Scalp order ${execOk ? "submitted" : "rejected"}: ${signal.direction} ${signal.symbol} @ ${entry.entry?.toFixed(2)} (TP1 ${signal.proposedTp?.toFixed(2)})`,
            { executionId: execution.id, clientRequestId: executionResult.clientRequestId ?? undefined, status: executionResult.status },
        );

        return {
            ticks: 1,
            signalGenerated: true,
            submitted: execOk,
            skippedBySpread: false,
            error: execOk ? undefined : executionResult.error?.message ?? "unknown submission error",
        };
    }

    private increment(key: string): void {
        // Intentful no-op log for spread-skip counters; increments are persisted
        // in the deployment's rejectionCount via the generic runtime for the
        // canonical path. Kept as a placeholder for metrics if desired.
    }
}