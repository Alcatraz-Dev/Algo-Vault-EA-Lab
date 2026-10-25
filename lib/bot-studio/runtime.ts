/**
 * Bot Studio — server-side bot runtime.
 *
 * This module manages the tick loop for a single deployed bot. It:
 *   1. Receives the primary (setup-timeframe) candle page (via `tick()`).
 *   2. Runs the canonical live-signal evaluator (`evaluateStrategySignal`) —
 *      the SAME decision core as the Strategy Lab backtest — over the
 *      strategy's own timeframes. No simulation state exists here, so no
 *      position or fill can ever be fabricated.
 *   3. If the evaluator fires an entry on the newly closed signal bar, routes a TradePlan
 *      through `evaluateGate()` (the AI Execution Gate) — the same gate that
 *      protects all other automated trading on this platform.
 *   4. If the gate approves, submits through the Unified Trading Service
 *      (trading_order_requests), which is consumed by the existing MT5 Gateway.
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
import { computeStops, simSymbolSpec, sizePosition } from "@/lib/strategy-engine";
import { evaluateStrategySignal } from "@/lib/strategy-lab/backtest";
import { evaluateGate } from "@/lib/ai-execution/gate";
import { getKillSwitch } from "@/lib/ai-execution/database";
import type { AutomationPolicy, TradePlan, EvidenceItem, EvidenceSourceId } from "@/lib/ai-execution/types";
import { clampAutomationPolicy } from "@/lib/ai-execution/types";
import { isLiveTradingEnabled } from "@/lib/trading/feature-flags";
import { getGatewayTokenForUser, hasActiveTradingLicense } from "@/lib/gateway";
import { adminDatabase } from "@/lib/firebase-admin";
import { loadAccountRiskSnapshot, accountKey } from "@/lib/risk/account-state";
import { getMarketTruth } from "@/lib/market-data/market-truth";
import { isSymbolMarketOpen } from "@/lib/ai-signals/sessions-filter";
import {
    appendLog,
    appendAudit,
    saveSignal,
    updateSignal,
    saveExecution,
    updateExecution,
    getExecution,
    updateDeploymentState,
} from "./database";
import { canGenerateSignals } from "./lifecycle";
import { buildOrderComment } from "./magic-numbers";
import { createHash } from "node:crypto";
import type {
    BotDeployment,
    BotExecution,
    BotSignal,
} from "./types";
import { createUnifiedTradingService } from "@/lib/trading/unified/server";
import type { ExecuteInput, UnifiedTradingService } from "@/lib/trading/unified/service";

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
    /**
     * Test-only seams. Production callers never pass these: the defaults are
     * the real market-truth reader and the real unified-trading composition.
     */
    marketTruth?: typeof getMarketTruth;
    serviceFactory?: () => UnifiedTradingService;
}

export interface BotTickInput {
    /** Primary (setup-timeframe) candles — the canonical evaluation series. */
    candles: MarketCandle[];
    timeframe: Timeframe;
    /**
     * Additional strategy timeframes referenced by rule.timeframe. Rules are
     * resolved by timestamp at or before the signal bar, exactly like the
     * backtest, so live signals and backtests share rule semantics.
     */
    series?: Partial<Record<Timeframe, MarketCandle[]>>;
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
    private deployment: BotDeployment;
    private readonly strategy: Strategy;
    private readonly magicNumber: number;
    private readonly policy: Partial<AutomationPolicy>;
    private readonly marketTruth: typeof getMarketTruth;
    private readonly serviceFactory: () => UnifiedTradingService;
    /** Latest closed bar already evaluated (pages roll forward, length is fixed). */
    private lastEvaluatedTimestamp: number | null = null;
    /** A single in-process tick per deployment prevents concurrent duplicate evaluation. */
    private tickInFlight = false;
    /** The bar that already produced a signal; one attempt per closed bar. */
    private lastSignaledBarTimestamp: number | null = null;

    constructor(options: BotRuntimeOptions) {
        this.deployment = options.deployment;
        this.strategy = options.strategy;
        this.magicNumber = options.magicNumber;
        this.policy = { ...BOT_AUTOMATION_POLICY, ...options.policyOverride };
        this.marketTruth = options.marketTruth ?? getMarketTruth;
        this.serviceFactory = options.serviceFactory ?? createUnifiedTradingService;
    }

    /** Refresh persisted lifecycle intent on every request; workers may cache sessions. */
    refreshDeployment(deployment: BotDeployment): void {
        this.deployment = deployment;
    }

    /**
     * Validate the deployment (call once before the first tick).
     *
     * There is deliberately NO simulation engine here: bot decisions use the
     * canonical live-signal evaluator (`evaluateStrategySignal`), so a
     * backtest-only construct can never stand in for broker state.
     */
    async initialize(): Promise<void> {
        const accountMode = this.deployment.accountMode;

        if (accountMode === "live" && !isLiveTradingEnabled()) {
            throw new Error("Live trading is disabled (LIVE_TRADING_ENABLED is not set). Use accountMode 'demo' or enable the flag.");
        }

        await appendLog(
            this.deployment.id,
            "info",
            `Bot runtime initialized (${accountMode} mode, strategy: ${this.strategy.name})`,
            { strategyId: this.strategy.id, magicNumber: this.magicNumber },
        );
    }

    /** Process new market bars. Returns the tick result. */
    async tick(input: BotTickInput): Promise<BotTickResult> {
        const { id: botId, runtimeState, desiredState, ownerId, strategyId } = this.deployment;

        // Hard guard: persisted desired/runtime state is authoritative. Pausing,
        // stopping, disabled bots, and stale cached sessions must not add entries.
        if (!canGenerateSignals(runtimeState) || desiredState !== "running") {
            return { signalGenerated: false };
        }
        // Market closed check: sleep when market is closed, never submit orders
        if (!isSymbolMarketOpen(this.strategy.asset)) {
            return {
                signalGenerated: false,
                gateApproved: false,
                gateCode: "MARKET_CLOSED",
                gateReason: `Market is closed for ${this.strategy.asset} — bot sleeping`,
            };
        }
        if (this.tickInFlight) return { signalGenerated: false };
        this.tickInFlight = true;
        try {
            return await this.evaluateTick(input, botId, ownerId, strategyId);
        } finally {
            this.tickInFlight = false;
        }
    }

    private async evaluateTick(
        input: BotTickInput,
        botId: string,
        ownerId: string,
        strategyId: string,
    ): Promise<BotTickResult> {
        const candles = input.candles;
        if (!Array.isArray(candles) || candles.length === 0) {
            return { signalGenerated: false };
        }

        // Candle fetches are rolling pages with a fixed limit; page length does
        // not grow when new bars arrive. Track the newest CLOSED bar so each
        // bar is evaluated once, including after a worker restart.
        const unseen = candles.filter(
            (candle) => this.lastEvaluatedTimestamp === null || candle.timestamp > this.lastEvaluatedTimestamp,
        );
        if (unseen.length === 0) {
            // Same page polled again (or a roll-forward with no new close):
            // reusing the previous evaluation would re-enter on a stale bar.
            return { signalGenerated: false };
        }
        const bar = unseen[unseen.length - 1];
        this.lastEvaluatedTimestamp = bar.timestamp;

        // One signal attempt per closed bar, even if the tick is retried.
        if (this.lastSignaledBarTimestamp !== null && bar.timestamp <= this.lastSignaledBarTimestamp) {
            return { signalGenerated: false };
        }

        let evaluation;
        try {
            // Canonical live-signal evaluator: primary = setup timeframe (backtest
            // parity), rule timeframes resolved by timestamp from their own series.
            const seriesByTF = {
                ...(input.series ?? {}),
                [this.strategy.timeframes.setup]: candles,
            };
            evaluation = evaluateStrategySignal(this.strategy, seriesByTF, bar.timestamp);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await appendLog(botId, "error", `Signal evaluation error on tick: ${msg}`, { error: msg });
            return { signalGenerated: false, error: msg };
        }

        if (!evaluation.fired) {
            return { signalGenerated: false };
        }
        this.lastSignaledBarTimestamp = bar.timestamp;

        // Exactly one execution attempt per closed bar across worker restarts:
        // the deterministic execution id is checked against durable state
        // before any gate work or queue write happens.
        const signalId = this.signalIdFor(botId, this.strategy.id, bar.timestamp);
        const existingExecution = await getExecution(botId, this.executionIdFor(signalId)).catch(() => null);
        if (existingExecution && existingExecution.status !== "failed") {
            return { signalGenerated: false, signalId, executionId: existingExecution.id };
        }

        const direction = this.strategy.direction === "long" ? "BUY" : "SELL";

        // ATR and regime come from the same evaluation the rules were decided
        // on; no adapter position or simulated fill is authoritative here.
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
        const gate = await this.runGate(signal, ownerId, stops.riskPrice, evaluation.regime);
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
        regime: string,
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
            this.marketTruth(symbol, this.strategy.timeframes.entry).catch(() => null),
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
            takeProfits: [{ index: 1, price: signal.proposedTp ?? 0 }],
            riskPercent: this.strategy.risk.riskPercent,
            positionSizeLots: proposedVolume,
            strategyId: this.strategy.id,
            signalId: signal.id,
            marketRegime: regime || "unknown",
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

    /** Stable signal id for a (bot, strategy, bar) — never a random one. */
    private signalIdFor(botId: string, strategyId: string, barTimestamp: number): string {
        return `SIG_${createHash("sha256").update(`${botId}:${strategyId}:${barTimestamp}`).digest("hex").slice(0, 24)}`;
    }

    /** Deterministic execution id for a signal: retries resolve to the same record. */
    private executionIdFor(signalId: string): string {
        return `BEXEC_${createHash("sha256")
            .update(`${this.deployment.id}:${this.strategy.id}:${signalId}`)
            .digest("hex")
            .slice(0, 24)
            .toUpperCase()}`;
    }

    /**
     * Submit an approved signal through the gateway.
     *
     * Routes through the unified trading service (trading_order_requests) which
     * is the queue consumed by the AlgoVaultTradeGateway EA via
     * /api/trading/gateway/commands. No longer writes directly to mt5_orders
     * to avoid queue mismatches.
     */
    private async submitToGateway(
        signal: BotSignal,
        userId: string,
        volume: number,
    ): Promise<{ ok: boolean; executionId: string; error?: string }> {
        const botId = this.deployment.id;
        // Deterministic per (bot, strategy, signal): a worker restart, a duplicate
        // cron delivery and a tick retry all resolve to the SAME execution and
        // clientRequestId, so no second command can reach the gateway.
        const executionId = this.executionIdFor(signal.id);
        const now = Date.now();

        // Never overwrite or resubmit a signal that already has a durable
        // execution record (queued, confirmed, uncertain or broker-rejected).
        const existing = await getExecution(botId, executionId).catch(() => null);
        if (existing && existing.status !== "failed") {
            return { ok: true, executionId };
        }

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
            signalGeneratedAt: signal.generatedAt,
        };

        await saveExecution(execution);

        // Re-verify authorization at submission time (never cached).
        const account = accountKey(this.deployment.mt5Account);
        if (!account) {
            await this.failExecution(botId, executionId, "No connected MT5 account.");
            return { ok: false, executionId, error: "No connected MT5 account." };
        }
        const [hasLicense, gatewayToken] = await Promise.all([
            hasActiveTradingLicense(userId).catch(() => false),
            getGatewayTokenForUser(userId).catch(() => null),
        ]);
        const hasToken = Boolean(gatewayToken);
        if (!hasLicense && !hasToken) {
            await this.failExecution(botId, executionId, "Not authorized for gateway execution.");
            return { ok: false, executionId, error: "Not authorized for gateway execution." };
        }

        // Transaction-backed Unified Trading idempotency is the single
        // duplicate protection boundary; do not prefilter retries here.

        try {
            // Stable key per bot + strategy + signal: retries, duplicate cron
            // deliveries, and worker restarts replay the same service request.
            const clientRequestId = `bot_${createHash("sha256").update(`${botId}:${this.strategy.id}:${signal.id}`).digest("hex").slice(0, 48)}`;
            const correlationId = `corr_${createHash("sha256").update(`${botId}:${this.strategy.id}:${signal.id}`).digest("hex").slice(0, 40)}`;
            const authorizationStartedAt = Date.now();
            const service = this.serviceFactory();
            const input: ExecuteInput = {
                userId,
                accountId: account,
                clientRequestId,
                executionType: "PLACE_ORDER",
                symbol: signal.symbol,
                side: signal.direction,
                volume: volume,
                kind: "MARKET",
                price: null,
                stopLoss: signal.proposedSl ?? null,
                takeProfit: signal.proposedTp ?? null,
                source: "bot-studio",
                botAttribution: {
                    botId,
                    strategyId: this.strategy.id,
                    executionId,
                    magicNumber: this.magicNumber,
                    comment: buildOrderComment(this.strategy.id),
                    signalGeneratedAt: signal.generatedAt,
                },
                correlationId,
                // The command queue write is the contract with the EA. The bot
                // path must not hold the tick open for a report: the authenticated
                // execution-report endpoint confirms this execution asynchronously.
                waitForReport: false,
            };

            const outcome = await service.execute(input);
            if (!outcome.result) {
                await this.failExecution(botId, executionId, "Gateway submission failed.");
                return { ok: false, executionId, error: "Gateway submission failed." };
            }
            if (outcome.result.status === "REJECTED" || outcome.result.status === "FAILED") {
                const isUncertain = outcome.result.error?.code === "EXECUTION_TIMEOUT"
                    || outcome.result.error?.code === "DUPLICATE_REQUEST";
                if (!isUncertain) {
                    const msg = outcome.result.error?.message || "Gateway submission failed.";
                    await this.failExecution(botId, executionId, msg);
                    return { ok: false, executionId, error: msg };
                }
                await updateExecution(botId, executionId, {
                    status: "uncertain",
                    clientOrderId: clientRequestId,
                    correlationId,
                    authorizationStartedAt,
                    executionOutcome: "uncertain",
                    submittedAt: now,
                });
                return { ok: true, executionId };
            }

            const confirmed = outcome.result.status === "SUCCEEDED";
            const pendingSync = outcome.result.status === "EXECUTED_PENDING_SYNC";
            // ACCEPTED without an error is the normal queued response: durable in
            // the EA queue, broker outcome still owned by the execution report.
            const queued = outcome.result.status === "ACCEPTED" && !outcome.result.error;
            const resolvedAt = Date.now();
            await updateExecution(botId, executionId, {
                status: confirmed
                    ? "filled"
                    : pendingSync
                      ? "executed_pending_sync"
                      : queued
                        ? "submitted"
                        : "uncertain",
                clientOrderId: clientRequestId,
                correlationId,
                authorizationStartedAt,
                queuedAt: queued || confirmed || pendingSync ? resolvedAt : undefined,
                submittedAt: resolvedAt,
                filledAt: confirmed ? resolvedAt : undefined,
                mt5Ticket: outcome.result.providerRef ? Number(outcome.result.providerRef) || undefined : undefined,
                fillPrice: outcome.result.filledPrice ?? undefined,
                fillVolume: outcome.result.filledVolume ?? undefined,
                executionOutcome: confirmed
                    ? "confirmed"
                    : queued || pendingSync
                      ? "accepted"
                      : "uncertain",
                latencyMs: {
                    authorization: Math.max(0, resolvedAt - authorizationStartedAt),
                },
            });
            await appendAudit(botId, this.strategy.id, "execution_attempted", userId, {
                executionId,
                clientOrderId: clientRequestId,
                signal: signal.direction,
                symbol: signal.symbol,
                volume,
            });
            await appendLog(botId, "execution", `Submitted to gateway: ${signal.direction} ${signal.symbol} (clientRequestId=${clientRequestId})`, {
                executionId,
                clientRequestId,
            });

            return { ok: true, executionId };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await this.failExecution(botId, executionId, msg);
            return { ok: false, executionId, error: msg };
        }
    }

    private async failExecution(botId: string, executionId: string, error: string): Promise<void> {
        await updateExecution(botId, executionId, { status: "failed", executionOutcome: "rejected", failedAt: Date.now() });
        await appendAudit(botId, this.strategy.id, "error_occurred", this.deployment.ownerId, {
            executionId,
            error,
        });
        await appendLog(botId, "error", `Gateway submission failed: ${error}`, { executionId, error });
    }

    /** Release the session when the bot stops. */
    async shutdown(reason: string): Promise<void> {
        this.tickInFlight = false;
        await appendLog(this.deployment.id, "info", `Bot runtime shut down: ${reason}`);
    }
}
