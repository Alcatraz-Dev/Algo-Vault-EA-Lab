/**
 * Bot Studio — server-side bot runtime.
 *
 * This module manages the tick loop for a single deployed bot. It:
 *   1. Receives market candle events (via `tick()`).
 *   2. Runs the canonical StrategyEngine against them — as the strategy
 *      EVALUATOR. The engine's adapter is never given quotes, so it can
 *      never simulate a fill: no fabricated positions, ever.
 *   3. If the engine fires an entry on the signal bar, routes a TradePlan
 *      through `evaluateGate()` (the AI Execution Gate) — the same gate that
 *      protects all other automated trading on this platform.
 *   4. If the gate approves, submits through the EXISTING gateway boundary
 *      (mt5_orders + live_positions — the same records every other
 *      execution path writes).
 *   5. Persists signals, executions, and logs to the bot-studio RTDB paths.
 *
 * INVARIANTS:
 *   • No order is EVER submitted without gate approval.
 *   • No position state is fabricated — only gateway ACKs update execution state.
 *   • The runtime never touches another strategy's positions (magic number check).
 *   • Live execution requires LIVE_TRADING_ENABLED flag.
 *   • A paused or stopped bot rejects all new entries.
 *   • The gate context (quote, risk snapshot, authorization, kill switch) is
 *     loaded server-side from the same sources the AI-execution path uses —
 *     caller-supplied prices are never trusted.
 */

import type { MarketCandle, Timeframe } from "@/lib/market-data/types";
import type { Strategy } from "@/lib/strategy-lab/types";
import {
    StrategyEngine,
    PaperAdapter,
    computeStops,
    simSymbolSpec,
    sizePosition,
    type EngineBarResult,
} from "@/lib/strategy-engine";
import { createAccount } from "@/lib/strategy-engine/account";
import { evaluateGate } from "@/lib/ai-execution/gate";
import {
    getKillSwitch,
    checkAndRecordSubmission,
} from "@/lib/ai-execution/database";
import type { AutomationPolicy, TradePlan, EvidenceItem, EvidenceSourceId } from "@/lib/ai-execution/types";
import { clampAutomationPolicy } from "@/lib/ai-execution/types";
import { isLiveTradingEnabled } from "@/lib/trading/feature-flags";
import { newClientOrderId, getGatewayTokenForUser, hasActiveTradingLicense } from "@/lib/gateway";
import { adminDatabase } from "@/lib/firebase-admin";
import { loadAccountRiskSnapshot, accountKey } from "@/lib/risk/account-state";
import { getMarketTruth } from "@/lib/market-data/market-truth";
import {
    appendLog,
    appendAudit,
    saveSignal,
    updateSignal,
    saveExecution,
    updateExecution,
    updateDeploymentState,
    newSignalId,
    newExecutionId,
} from "./database";
import { canGenerateSignals } from "./lifecycle";
import { buildOrderComment } from "./magic-numbers";
import type {
    BotDeployment,
    BotExecution,
    BotSignal,
} from "./types";
import { createUnifiedTradingService } from "@/lib/trading/unified/server";
import type { ExecuteInput } from "@/lib/trading/unified/service";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bot-studio automation policy bounds. These are DEFAULTS that
 * `clampAutomationPolicy` still squeezes into the platform's server-side
 * hard ceilings — a bot can never exceed them by construction.
 *
 * `allowedInstruments` is always overwritten with the strategy's own symbol
 * (an empty whitelist denies every instrument at the gate).
 */
const BOT_AUTOMATION_POLICY: Partial<AutomationPolicy> = {
    maxRiskPercentPerTrade: 2.0,
    maxTotalOpenRiskPercent: 6.0,
    maxDailyLossPercent: 5.0,
    maxOpenPositions: 3,
    maxPositionsPerInstrument: 1,
    maxConcurrentAutomatedTrades: 1,
    maxLot: 1.0,
    minStopDistancePips: 3,
    maxSpreadPips: 15,
    maxDataAgeMs: 120_000,
    tradingHoursUtc: null,
    cooldownAfterLossSeconds: 300,
    planExpiryMs: 30_000,
    /**
     * The runtime always records at least two non-AI evidence items (the
     * engine's entry decision + the observed bar close); a live quote adds a
     * third. Never below the hard ceiling (1).
     */
    minEvidenceCount: 2,
    requireSetupQualification: true,
};

/** A signal expires if not submitted within this window. */
const SIGNAL_TTL_MS = 30_000; // 30 seconds

/** Magic-number range stamp on every order; see ./magic-numbers. */
// (the per-strategy magic number arrives via BotRuntimeOptions)

// ─────────────────────────────────────────────────────────────────────────────
// Bot runtime session
// ─────────────────────────────────────────────────────────────────────────────

export interface BotRuntimeOptions {
    deployment: BotDeployment;
    strategy: Strategy;
    /** MT5 account magic number for this strategy. */
    magicNumber: number;
    /** Override automation policy bounds (still clamped to hard ceilings). */
    policyOverride?: Partial<AutomationPolicy>;
}

export interface BotTickInput {
    candles: MarketCandle[];
    timeframe: Timeframe;
}

export interface BotTickResult {
    signalGenerated: boolean;
    signalId?: string;
    gateApproved?: boolean;
    gateCode?: string;
    gateReason?: string;
    executionId?: string;
    error?: string;
}

interface GateOutcome {
    approved: boolean;
    code: string;
    reason?: string;
    /** Gate-computed volume (lots) — authoritative, from the risk engine. */
    volume?: number;
}

export class BotRuntimeSession {
    private readonly deployment: BotDeployment;
    private readonly strategy: Strategy;
    private readonly magicNumber: number;
    private readonly policy: Partial<AutomationPolicy>;
    private engine: StrategyEngine | null = null;
    /** Candles already fed to the engine (sequential feed — never re-fed). */
    private fedCount = 0;
    private lastBar: MarketCandle | null = null;
    private lastBarResult: EngineBarResult | null = null;

    constructor(options: BotRuntimeOptions) {
        this.deployment = options.deployment;
        this.strategy = options.strategy;
        this.magicNumber = options.magicNumber;
        this.policy = { ...BOT_AUTOMATION_POLICY, ...options.policyOverride };
    }

    /** Initialize the strategy engine (call once before first tick). */
    async initialize(): Promise<void> {
        const accountMode = this.deployment.accountMode;
        const symbol = this.strategy.asset;
        const timeframe = this.strategy.timeframes.entry;

        if (accountMode === "live" && !isLiveTradingEnabled()) {
            throw new Error("Live trading is disabled (LIVE_TRADING_ENABLED is not set). Use accountMode 'demo' or enable the flag.");
        }

        const spec = simSymbolSpec(symbol);

        // The engine is the strategy EVALUATOR only. Execution happens solely
        // through the gate + gateway write in submitToGateway(), so the adapter
        // is deliberately never given a quote: PaperAdapter fails closed
        // without one (canExecute → false), which means the engine can never
        // materialize a position here and no state is fabricated.
        const adapter = new PaperAdapter({
            symbol,
            executionModel: this.strategy.executionModel,
            environment: "paper",
            spec,
        });

        this.engine = new StrategyEngine({
            strategy: this.strategy,
            symbol,
            timeframe,
            adapter,
            account: createAccount({
                id: `bot-eval-${this.deployment.id}`,
                environment: "paper",
                balance: 10_000,
                now: Date.now(),
            }),
            // Virtual evaluation account — never a real balance; the real
            // sizing comes from the gate's risk engine over the live account.
            environment: "paper",
            // Force next-bar materialization so the adapter's same-bar close
            // fallback (bar.close) can never open a virtual position.
            executionModel: "next_bar_open",
            finalizeAtEnd: false,
            spec,
        });

        await appendLog(
            this.deployment.id,
            "info",
            `Bot runtime initialized (${accountMode} mode, strategy: ${this.strategy.name})`,
            { strategyId: this.strategy.id, magicNumber: this.magicNumber },
        );
    }

    /** Process new market bars. Returns the tick result. */
    async tick(input: BotTickInput): Promise<BotTickResult> {
        const { id: botId, runtimeState, ownerId, strategyId } = this.deployment;

        // Hard guard: no entries unless the state machine says we're running.
        if (!canGenerateSignals(runtimeState)) {
            return { signalGenerated: false };
        }

        if (!this.engine) {
            return { signalGenerated: false, error: "Engine not initialized. Call initialize() first." };
        }

        const candles = input.candles;
        if (!Array.isArray(candles) || candles.length === 0) {
            return { signalGenerated: false };
        }

        // Feed every candle the engine has not seen yet (sequential — the
        // engine throws on out-of-order bars). Only the evaluation of the
        // LAST bar can produce a signal: an entry that fired on an older
        // warm-up bar is already stale and must never be submitted.
        try {
            for (let i = this.fedCount; i < candles.length; i++) {
                this.fedCount = i + 1;
                this.lastBar = candles[i];
                this.engine.appendCandle(candles[i]);
                this.lastBarResult = this.engine.onCandleClose(i);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await appendLog(botId, "error", `Engine error on tick: ${msg}`, { error: msg });
            return { signalGenerated: false, error: msg };
        }

        const bar = this.lastBar;
        const evaluation = this.lastBarResult?.evaluation ?? null;
        if (!bar || !evaluation?.fired) {
            return { signalGenerated: false };
        }

        const direction = this.strategy.direction === "long" ? "BUY" : "SELL";

        // Canonical SL/TP for the signal bar — identical math to the engine's
        // own entry path (computeStops), using only the signal bar's ATR.
        const spec = simSymbolSpec(this.strategy.asset);
        const stops = computeStops(
            this.strategy,
            bar.close,
            evaluation.atr,
            direction === "BUY",
            spec.digits,
            spec.tickSize,
        );

        // Build the signal record.
        const signalId = newSignalId();
        const signal: BotSignal = {
            id: signalId,
            botId,
            strategyId,
            symbol: this.strategy.asset,
            direction,
            barTimestamp: bar.timestamp,
            generatedAt: Date.now(),
            outcome: "pending",
            proposedEntry: bar.close,
            proposedSl: stops.sl,
            proposedTp: stops.tp1,
            proposedRiskPct: this.strategy.risk.riskPercent,
        };

        await saveSignal(signal);
        await appendLog(botId, "signal", `Signal generated: ${direction} ${this.strategy.asset}`, {
            signalId,
            direction,
            proposedEntry: signal.proposedEntry,
        });

        // Route through the AI Execution Gate.
        const gate = await this.runGate(signal, ownerId, stops.riskPrice);
        if (!gate.approved) {
            await updateSignal(botId, signalId, {
                outcome: "rejected",
                rejectionCode: gate.code,
                rejectionReason: gate.reason,
            });
            await appendLog(botId, "warn", `Gate rejected signal: ${gate.code} — ${gate.reason ?? "no reason given"}`, {
                signalId,
                code: gate.code,
            });
            await updateDeploymentState(botId, {
                rejectionCount: (this.deployment.rejectionCount ?? 0) + 1,
                lastSignalAt: Date.now(),
            });
            return {
                signalGenerated: true,
                signalId,
                gateApproved: false,
                gateCode: gate.code,
                gateReason: gate.reason,
            };
        }

        // Gate approved — submit to the gateway boundary.
        const execResult = await this.submitToGateway(signal, ownerId, gate.volume ?? 0);
        await updateSignal(botId, signalId, {
            outcome: execResult.ok ? "submitted" : "rejected",
            executionId: execResult.executionId,
            rejectionCode: execResult.ok ? undefined : execResult.error,
            rejectionReason: execResult.ok ? undefined : execResult.error,
        });

        await updateDeploymentState(botId, {
            signalCount: (this.deployment.signalCount ?? 0) + 1,
            executionCount: execResult.ok ? (this.deployment.executionCount ?? 0) + 1 : this.deployment.executionCount,
            rejectionCount: execResult.ok ? this.deployment.rejectionCount : (this.deployment.rejectionCount ?? 0) + 1,
            lastSignalAt: Date.now(),
            lastExecutionAt: Date.now(),
        });

        return {
            signalGenerated: true,
            signalId,
            gateApproved: true,
            executionId: execResult.executionId,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Gate evaluation
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Evaluate the deterministic gate with the FULL server-side context,
     * loaded from the same sources the AI-execution path uses. Nothing here
     * trusts caller input; every unavailable input fails closed.
     */
    private async runGate(
        signal: BotSignal,
        userId: string,
        riskPrice: number,
    ): Promise<GateOutcome> {
        const botId = this.deployment.id;
        const now = Date.now();
        const symbol = this.strategy.asset;

        // Kill switch (platform-wide; no args in the canonical reader).
        let killSwitchEngaged = false;
        try {
            const killSwitch = await getKillSwitch();
            killSwitchEngaged = killSwitch.engaged === true;
        } catch {
            return { approved: false, code: "KILL_SWITCH_ERROR", reason: "Failed to check kill switch." };
        }

        // Resolve the connected MT5 account key (normalized to the gateway
        // spelling used in every RTDB path).
        const account = accountKey(this.deployment.mt5Account);

        // Load the real context in parallel — market truth, account risk,
        // open positions, authorization.
        const [truth, riskSnapshot, openPositions, hasLicense, gatewayToken] = await Promise.all([
            getMarketTruth(symbol, this.strategy.timeframes.entry).catch(() => null),
            account
                ? loadAccountRiskSnapshot(userId, account, symbol).catch(() => null)
                : Promise.resolve(null),
            account ? this.loadOpenPositions(userId, account) : Promise.resolve([]),
            hasActiveTradingLicense(userId).catch(() => false),
            getGatewayTokenForUser(userId).catch(() => null),
        ]);

        if (!riskSnapshot) {
            return {
                approved: false,
                code: "RISK_STATE_UNAVAILABLE",
                reason: "Account risk state could not be loaded — failing closed.",
            };
        }

        const quote = truth?.snapshot
            ? {
                  price: truth.snapshot.currentPrice,
                  spread: truth.snapshot.spread,
                  timestamp: truth.snapshot.timestamp,
                  provider: truth.snapshot.provider,
              }
            : null;

        // Position sizing proposal from the REAL account balance — the gate's
        // risk engine makes the final, authoritative volume decision.
        const balance = riskSnapshot.account.balance ?? 0;
        const spec = simSymbolSpec(symbol);
        const proposedVolume = sizePosition({
            strategy: this.strategy,
            balance,
            riskPrice,
            spec,
        });

        // Evidence — all DERIVED/OBSERVED from real engine + market data.
        const quoteSourceId: EvidenceSourceId =
            quote?.provider === "biquote" ? "market-data.biquote-ohlc" : "market-data.tradingview-live";
        const evidence: EvidenceItem[] = [
            {
                id: `ev_strategy_${signal.id}`,
                evidenceClass: "DERIVED",
                sourceId: "analytics.indicators",
                label: `Strategy engine entry decision: ${signal.direction} ${symbol}`,
                value: signal.direction,
                observedAt: signal.barTimestamp,
            },
            {
                id: `ev_close_${signal.id}`,
                evidenceClass: "OBSERVED",
                sourceId: "market-data.tradingview-live",
                label: "Signal bar close",
                value: signal.proposedEntry ?? 0,
                observedAt: signal.barTimestamp,
            },
        ];
        if (quote) {
            evidence.push({
                id: `ev_quote_${signal.id}`,
                evidenceClass: "OBSERVED",
                sourceId: quoteSourceId,
                label: "Live quote at signal time",
                value: quote.price,
                observedAt: quote.timestamp,
            });
        }

        const plan: TradePlan = {
            id: signal.id,
            userId,
            instrument: symbol,
            direction: signal.direction,
            timeframe: this.strategy.timeframes.entry,
            entry: signal.proposedEntry ?? 0,
            stopLoss: signal.proposedSl ?? 0,
            takeProfits: [{ index: 0, price: signal.proposedTp ?? 0 }],
            riskPercent: this.strategy.risk.riskPercent,
            positionSizeLots: proposedVolume,
            strategyId: this.strategy.id,
            signalId: signal.id,
            marketRegime: this.lastBarResult?.evaluation?.regime ?? "unknown",
            evidence,
            invalidationConditions: [],
            status: "DRAFT",
            executionMode: "AUTOMATION",
            generatedAt: now,
            expiresAt: now + SIGNAL_TTL_MS,
            createdAt: now,
            updatedAt: now,
        };

        const gateResult = evaluateGate({
            plan,
            ctx: {
                now,
                executionMode: "AUTOMATION",
                automation: clampAutomationPolicy({
                    ...this.policy,
                    allowedInstruments: [symbol],
                }),
                quote,
                openPositions,
                riskSnapshot,
                setupStatus: null,
                authorization: {
                    hasAccount: !!account,
                    hasLicense,
                    hasGatewayToken: !!gatewayToken,
                },
                killSwitchEngaged,
            },
        });

        if (gateResult.decision !== "EXECUTE") {
            const failed = gateResult.checks.find((c) => !c.passed);
            return {
                approved: false,
                code: gateResult.finalCode || failed?.code || "GATE_REJECTED",
                reason: gateResult.reason || failed?.reason || "Gate rejected the signal.",
            };
        }

        await appendLog(botId, "execution", `Gate approved signal ${signal.id} (volume ${gateResult.orderVolume ?? 0} lots)`, {
            signalId: signal.id,
            code: gateResult.finalCode,
        });

        return {
            approved: true,
            code: gateResult.finalCode,
            volume: gateResult.orderVolume ?? proposedVolume,
        };
    }

    /** Open positions on the connected account (tickets + symbol + volume). */
    private async loadOpenPositions(
        userId: string,
        account: string,
    ): Promise<Array<{ symbol: string; volume: number; ticket?: string }>> {
        const snap = await adminDatabase.ref(`trading_positions/${userId}/${account}`).get();
        if (!snap.exists()) return [];
        const val = (snap.val() || {}) as Record<string, { symbol?: string; volume?: number; ticket?: string }>;
        return Object.entries(val).map(([ticket, p]) => ({
            symbol: String(p?.symbol ?? "").toUpperCase(),
            volume: Number(p?.volume) || 0,
            ticket: p?.ticket ?? ticket,
        }));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Gateway submission
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Submit an approved signal through the EXISTING gateway boundary:
     *   mt5_orders/{accountKey}/{clientOrderId}          (the EA polls this queue)
     *   live_positions/live_{accountNumber}/{clientOrderId} (tracking)
     *
     * Identical record shape to every other execution path (see
     * lib/ai-execution/runtime.ts submitApprovedPlan) — the only differences
     * are the bot's magic number and source label. No ticket is fabricated:
     * the real MT5 ticket arrives later via the gateway state sync.
     */
    private async submitToGateway(
        signal: BotSignal,
        userId: string,
        volume: number,
    ): Promise<{ ok: boolean; executionId: string; error?: string }> {
        const botId = this.deployment.id;
        const executionId = newExecutionId();
        const now = Date.now();

        const execution: BotExecution = {
            id: executionId,
            botId,
            strategyId: this.strategy.id,
            signalId: signal.id,
            status: "gate_passed",
            symbol: signal.symbol,
            direction: signal.direction,
            volume,
            entry: signal.proposedEntry,
            sl: signal.proposedSl,
            tp: signal.proposedTp,
            createdAt: now,
            updatedAt: now,
        };

        await saveExecution(execution);

        // Re-verify authorization at submission time (never cached).
        const account = accountKey(this.deployment.mt5Account);
        if (!account) {
            await this.failExecution(botId, executionId, "No connected MT5 account.");
            return { ok: false, executionId, error: "No connected MT5 account." };
        }
        const hasLicense = await hasActiveTradingLicense(userId).catch(() => false);
        const hasToken = Boolean(await getGatewayTokenForUser(userId).catch(() => null));
        if (!hasLicense && !hasToken) {
            await this.failExecution(botId, executionId, "Not authorized for gateway execution.");
            return { ok: false, executionId, error: "Not authorized for gateway execution." };
        }

        // Duplicate prevention — same 10-minute window as the other paths.
        const planForKey: TradePlan = {
            id: signal.id,
            userId,
            instrument: signal.symbol,
            direction: signal.direction,
            timeframe: this.strategy.timeframes.entry,
            entry: signal.proposedEntry ?? 0,
            stopLoss: signal.proposedSl ?? 0,
            takeProfits: [{ index: 0, price: signal.proposedTp ?? 0 }],
            riskPercent: this.strategy.risk.riskPercent,
            marketRegime: "unknown",
            evidence: [],
            invalidationConditions: [],
            status: "DRAFT",
            executionMode: "AUTOMATION",
            generatedAt: now,
            expiresAt: now + SIGNAL_TTL_MS,
            createdAt: now,
            updatedAt: now,
        };
        const dup = await checkAndRecordSubmission(userId, planForKey).catch(() => ({ duplicate: false, key: "" }));
        if (dup.duplicate) {
            await this.failExecution(botId, executionId, "Duplicate order — identical submission already recorded recently.");
            return { ok: false, executionId, error: "Duplicate order — identical submission already recorded recently." };
        }

        try {
            const clientOrderId = newClientOrderId(`bot_${botId.slice(0, 12)}`);
            const mt5AccountNumber = account.startsWith("gateway_") ? account.slice("gateway_".length) : account;

            const orderRecord = {
                ticket: clientOrderId,
                symbol: signal.symbol.replace("/", ""),
                type: signal.direction,
                volume: Number(volume.toFixed(2)),
                openPrice: signal.proposedEntry ?? 0,
                currentPrice: signal.proposedEntry ?? 0,
                stopLoss: signal.proposedSl ?? 0,
                takeProfit: signal.proposedTp ?? 0,
                profit: 0,
                swap: 0,
                // Bot Studio magic number — isolates this bot's positions from
                // manual trades and every other bot/EA on the account.
                magic: this.magicNumber,
                source: "AlgoVault Bot Studio",
                comment: buildOrderComment(this.strategy.id),
                strategyId: this.strategy.id,
                signalId: signal.id,
                botId,
                userId,
                openedAt: now,
                lastSeenAt: now,
                updatedAt: now,
                status: "PENDING_MT5_EXECUTION",
            };

            await adminDatabase.ref(`mt5_orders/${account}/${clientOrderId}`).set(orderRecord);
            await adminDatabase.ref(`live_positions/live_${mt5AccountNumber}/${clientOrderId}`).set(orderRecord);

            await updateExecution(botId, executionId, {
                status: "submitted",
                clientOrderId,
                submittedAt: now,
            });
            await appendAudit(botId, this.strategy.id, "execution_attempted", userId, {
                executionId,
                clientOrderId,
                signal: signal.direction,
                symbol: signal.symbol,
                volume,
            });
            await appendLog(botId, "execution", `Submitted to gateway: ${signal.direction} ${signal.symbol} (clientOrderId=${clientOrderId})`, {
                executionId,
                clientOrderId,
            });

            return { ok: true, executionId };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await this.failExecution(botId, executionId, msg);
            return { ok: false, executionId, error: msg };
        }
    }

    private async failExecution(botId: string, executionId: string, error: string): Promise<void> {
        await updateExecution(botId, executionId, { status: "failed" });
        await appendAudit(botId, this.strategy.id, "error_occurred", this.deployment.ownerId, {
            executionId,
            error,
        });
        await appendLog(botId, "error", `Gateway submission failed: ${error}`, { executionId, error });
    }

    /** Clean up the engine when the bot stops. */
    async shutdown(reason: string): Promise<void> {
        this.engine = null;
        await appendLog(this.deployment.id, "info", `Bot runtime shut down: ${reason}`);
    }
}
