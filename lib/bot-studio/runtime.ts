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
import { planDirectionalLanes, summarizeLanes, type LanePacing } from "./scalping/lanes";
import { loadScalpingPacingContext } from "./scalping/pacing";
import type { DirectionalScalpingEvaluation } from "./scalping/directional";
import type { ScalpingBotConfig } from "./scalping/profiles";
import {
    loadAccountPositionMode,
    type AccountPositionModeRecord,
} from "@/lib/trading/account-position-mode";
import type { TradingPositionMode } from "@/lib/trading/position-mode";

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
     * OPTIONAL directional evaluator seam.
     *
     * A direction-aware strategy (the scalping bots) supplies an evaluator that
     * resolves LONG/SHORT/WAIT per bar and returns the winning side. Unset
     * preserves the existing single-direction behaviour exactly
     * (`evaluateStrategySignal` + `strategy.direction`) for every other bot.
     *
     * The evaluator may only DECIDE a direction; it cannot approve execution —
     * the gate and the unified service still run on every signal.
     */
    signalEvaluator?: BotSignalEvaluator;
    /**
     * OPTIONAL strategy pacing filter, run after a signal is produced and
     * before the gate. It can only suppress an entry (trades/day, cooldown,
     * bot notional cap). It never approves one.
     */
    preSignalCheck?: (signal: BotSignal) => Promise<{
        ok: boolean;
        code?: string;
        reason?: string;
    }>;
    /**
     * OPTIONAL bidirectional lane evaluator.
     *
     * When present, `tick()` evaluates BOTH directions from one bar and plans
     * them through `planDirectionalLanes`. Each qualifying lane then runs the
     * full existing pipeline independently (signal record, pacing, gate,
     * unified service, idempotency). Unset preserves the single-direction path
     * verbatim for every other bot.
     */
    laneEvaluator?: (input: BotSignalEvaluatorInput) => DirectionalScalpingEvaluation;
    /** Configuration the lane planner enforces (per-direction limits/cooldown). */
    laneConfig?: ScalpingBotConfig;
    /** Test seam: authoritative account position-mode reader (defaults to RTDB). */
    positionModeLoader?: (userId: string, accountId: string) => Promise<AccountPositionModeRecord>;
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
    /** Resolved side of the evaluated bar, when the evaluator produced one. */
    direction?: "long" | "short";
    /** True when the evaluator explicitly decided to WAIT. */
    waited?: boolean;
    /** Wait reason code (no_setup, conflicting_signals, low_confidence, ...). */
    waitReason?: string;
}

/** One bar's directional decision, produced by a `BotSignalEvaluator`. */
export interface BotSignalEvaluation {
    fired: boolean;
    /** Winning side; null when the evaluator decided to WAIT. */
    direction: "long" | "short" | null;
    atr: number;
    regime: string;
    /** Wait reason code when `fired` is false. */
    waitReason?: string;
    waitDetail?: string;
    confidence?: number;
}

export interface BotSignalEvaluatorInput {
    strategy: Strategy;
    seriesByTF: Partial<Record<Timeframe, MarketCandle[]>>;
    timestamp: number;
}

export type BotSignalEvaluator = (input: BotSignalEvaluatorInput) => BotSignalEvaluation;

interface GateOutcome {
    approved: boolean;
    code: string;
    reason?: string;
    /** Gate-computed volume (lots) — authoritative, from the risk engine. */
    volume?: number;
}

/** Open position as the gateway reports it, with the side needed by lanes. */
export interface AccountOpenPosition {
    symbol: string;
    volume: number;
    ticket?: string;
    side: "long" | "short" | null;
    magic: number | null;
}

type LaneSignalOutcome = "skipped" | "pacing_rejected" | "gate_rejected" | "submitted" | "submit_failed";

export class BotRuntimeSession {
    private deployment: BotDeployment;
    private readonly strategy: Strategy;
    private readonly magicNumber: number;
    private readonly policy: Partial<AutomationPolicy>;
    private readonly marketTruth: typeof getMarketTruth;
    private readonly serviceFactory: () => UnifiedTradingService;
    private readonly signalEvaluator?: BotSignalEvaluator;
    private readonly preSignalCheck?: BotRuntimeOptions["preSignalCheck"];
    private readonly laneEvaluator?: BotRuntimeOptions["laneEvaluator"];
    private readonly laneConfig?: ScalpingBotConfig;
    private readonly positionModeLoader?: BotRuntimeOptions["positionModeLoader"];
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
        this.signalEvaluator = options.signalEvaluator;
        this.preSignalCheck = options.preSignalCheck;
        this.laneEvaluator = options.laneEvaluator;
        this.laneConfig = options.laneConfig;
        this.positionModeLoader = options.positionModeLoader;
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

        // Bidirectional bots: evaluate both lanes from this same closed bar.
        // The routing below is the ONLY difference; both lanes still pass
        // through the identical gate + unified-service pipeline.
        if (this.laneEvaluator) {
            return this.evaluateLaneTick(input, bar, botId, ownerId, strategyId);
        }

        let evaluation: BotSignalEvaluation;
        try {
            // Canonical live-signal evaluator: primary = setup timeframe (backtest
            // parity), rule timeframes resolved by timestamp from their own series.
            const seriesByTF = {
                ...(input.series ?? {}),
                [this.strategy.timeframes.setup]: candles,
            };
            evaluation = this.signalEvaluator
                ? this.signalEvaluator({
                      strategy: this.strategy,
                      seriesByTF,
                      timestamp: bar.timestamp,
                  })
                : evaluateSingleDirectionSignal(this.strategy, seriesByTF, bar.timestamp);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await appendLog(botId, "error", `Signal evaluation error on tick: ${msg}`, { error: msg });
            return { signalGenerated: false, error: msg };
        }

        // Persist the closed bar's decision — including WAIT — so the terminal
        // shows the bot's CURRENT state from recorded data, never an invented
        // signal. This is one small update per closed bar.
        await updateDeploymentState(botId, {
            lastEvaluation: {
                at: Date.now(),
                barTimestamp: bar.timestamp,
                decision: evaluation.fired
                    ? evaluation.direction === "long"
                        ? "LONG"
                        : "SHORT"
                    : "WAIT",
                direction: evaluation.fired ? evaluation.direction : null,
                reason: evaluation.fired ? null : evaluation.waitReason ?? null,
                detail: evaluation.fired ? null : evaluation.waitDetail ?? null,
                confidence: evaluation.confidence ?? null,
            },
        }).catch(() => {
            // A failed state write must not turn into a trade decision.
        });

        if (!evaluation.fired || !evaluation.direction) {
            return {
                signalGenerated: false,
                waited: true,
                waitReason: evaluation.waitReason ?? "no_setup",
            };
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

        const resolvedSide = evaluation.direction;
        const direction = resolvedSide === "long" ? "BUY" : "SELL";

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

        // Strategy pacing (trades/day, cooldown, bot notional cap). A pacing
        // rejection is recorded as a rejected signal and never reaches the gate
        // or the gateway. Pacing can only SUPPRESS entries.
        if (this.preSignalCheck) {
            let pacing: { ok: boolean; code?: string; reason?: string };
            try {
                pacing = await this.preSignalCheck(signal);
            } catch (e) {
                pacing = {
                    ok: false,
                    code: "PACING_UNAVAILABLE",
                    reason: e instanceof Error ? e.message : "Pacing state unavailable.",
                };
            }
            if (!pacing.ok) {
                await updateSignal(botId, signalId, {
                    outcome: "rejected",
                    rejectionCode: pacing.code ?? "PACING_REJECTED",
                    rejectionReason: pacing.reason,
                });
                await appendLog(
                    botId,
                    "warn",
                    `Signal held by bot pacing: ${pacing.code ?? "PACING_REJECTED"} — ${pacing.reason ?? "no reason given"}`,
                    { signalId, code: pacing.code },
                );
                await updateDeploymentState(botId, {
                    rejectionCount: (this.deployment.rejectionCount ?? 0) + 1,
                    lastSignalAt: Date.now(),
                });
                return {
                    signalGenerated: true,
                    signalId,
                    gateApproved: false,
                    gateCode: pacing.code,
                    gateReason: pacing.reason,
                    direction: resolvedSide,
                };
            }
        }

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
                direction: resolvedSide,
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
            direction: resolvedSide,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bidirectional lanes
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Evaluate both directions once, then execute each qualifying lane through
     * the existing pipeline.
     *
     * The account's position accounting mode and its live exposure are loaded
     * BEFORE planning: an unreported mode or unreadable positions block both
     * lanes rather than trading on an assumption. Both lanes share the same
     * account budget because they call the same gate + unified service, whose
     * notional ledger is account-scoped.
     */
    private async evaluateLaneTick(
        input: BotTickInput,
        bar: MarketCandle,
        botId: string,
        ownerId: string,
        strategyId: string,
    ): Promise<BotTickResult> {
        if (!this.laneEvaluator || !this.laneConfig) {
            await appendLog(botId, "error", "Bidirectional lane evaluation is not configured.");
            return { signalGenerated: false, error: "LANE_CONFIGURATION_MISSING" };
        }

        const seriesByTF = {
            ...(input.series ?? {}),
            [this.strategy.timeframes.setup]: input.candles,
        };

        let lanes: DirectionalScalpingEvaluation;
        try {
            lanes = this.laneEvaluator({ strategy: this.strategy, seriesByTF, timestamp: bar.timestamp });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await appendLog(botId, "error", `Lane evaluation error on tick: ${msg}`, { error: msg });
            return { signalGenerated: false, error: msg };
        }

        // Authoritative MT5 position accounting (never inferred).
        const account = accountKey(this.deployment.mt5Account);
        let positionMode: TradingPositionMode = "UNKNOWN";
        try {
            const record = this.positionModeLoader
                ? await this.positionModeLoader(ownerId, account)
                : await loadAccountPositionMode(ownerId, account);
            positionMode = record.mode;
        } catch {
            positionMode = "UNKNOWN";
        }

        let positions: AccountOpenPosition[];
        try {
            positions = account ? await this.loadOpenPositions(ownerId, account) : [];
        } catch {
            const now = Date.now();
            await updateDeploymentState(botId, {
                positionMode,
                lanes: {
                    long: { status: "BLOCKED", openPositions: 0, blockedReason: "positions_unavailable", confidence: 0, updatedAt: now },
                    short: { status: "BLOCKED", openPositions: 0, blockedReason: "positions_unavailable", confidence: 0, updatedAt: now },
                    updatedAt: now,
                },
            }).catch(() => {});
            await appendLog(botId, "error", "Open positions could not be read — both lanes blocked.");
            return { signalGenerated: false, error: "POSITIONS_UNAVAILABLE" };
        }

        const symbol = this.strategy.asset.toUpperCase();
        const open = { long: 0, short: 0 };
        for (const position of positions) {
            if (position.symbol.toUpperCase() !== symbol) continue;
            if (position.side === "long") open.long += 1;
            else if (position.side === "short") open.short += 1;
            // Exposure whose side is not reported counts in BOTH lanes: it must
            // never be treated as a free slot in the opposite direction.
            else {
                open.long += 1;
                open.short += 1;
            }
        }

        const plan = planDirectionalLanes({
            config: this.laneConfig,
            evaluation: lanes,
            positionMode,
            open,
            pacing: await this.loadLaneCooldowns(ownerId, account, botId),
            now: Date.now(),
            maxPositionsPerDirection: this.laneConfig.maxOpenPositions,
        });

        const outcomes: Array<{
            side: "long" | "short";
            outcome: LaneSignalOutcome;
            result: BotTickResult;
        }> = [];

        for (const side of ["long", "short"] as const) {
            if (!plan.intents[side].enter) continue;
            const outcome = await this.runLaneSignal({
                side,
                signalId: this.laneSignalIdFor(botId, strategyId, bar.timestamp, side),
                atr: lanes.atr,
                regime: lanes.regime,
                confidence: plan.intents[side].confidence,
                bar,
                botId,
                ownerId,
                strategyId,
            });
            outcomes.push({ side, ...outcome });
        }

        const submitted = outcomes.filter((o) => o.outcome === "submitted");
        const rejected = outcomes.filter(
            (o) => o.outcome === "pacing_rejected" || o.outcome === "gate_rejected" || o.outcome === "submit_failed",
        );
        const generated = outcomes.filter((o) => o.result.signalGenerated);
        const firstSide = outcomes[0]?.side ?? null;
        const now = Date.now();
        const summary = summarizeLanes(plan, open);

        await updateDeploymentState(botId, {
            signalCount: (this.deployment.signalCount ?? 0) + generated.length,
            executionCount: (this.deployment.executionCount ?? 0) + submitted.length,
            rejectionCount: (this.deployment.rejectionCount ?? 0) + rejected.length,
            lastSignalAt: generated.length ? now : this.deployment.lastSignalAt,
            lastExecutionAt: submitted.length ? now : this.deployment.lastExecutionAt,
            positionMode,
            lanes: {
                long: {
                    status: summary.long.status,
                    openPositions: summary.long.openPositions,
                    blockedReason: plan.intents.long.reason,
                    confidence: plan.intents.long.confidence,
                    updatedAt: now,
                },
                short: {
                    status: summary.short.status,
                    openPositions: summary.short.openPositions,
                    blockedReason: plan.intents.short.reason,
                    confidence: plan.intents.short.confidence,
                    updatedAt: now,
                },
                updatedAt: now,
            },
            lastEvaluation: {
                at: now,
                barTimestamp: bar.timestamp,
                decision: firstSide ? (firstSide === "long" ? "LONG" : "SHORT") : "WAIT",
                direction: firstSide,
                reason: outcomes.length ? null : plan.intents.long.reason ?? plan.intents.short.reason ?? "no_setup",
                detail: plan.detail,
                confidence: Math.max(plan.intents.long.confidence, plan.intents.short.confidence),
            },
        }).catch(() => {
            // A failed state write must not turn into a trade decision.
        });

        await appendLog(
            botId,
            submitted.length ? "execution" : "info",
            `Lanes [${positionMode}]: ${plan.detail}`,
            {
                positionMode,
                long: plan.intents.long.reason,
                short: plan.intents.short.reason,
                submitted: submitted.map((o) => o.side),
            },
        ).catch(() => {});

        return {
            signalGenerated: generated.length > 0,
            signalId: generated[0]?.result.signalId,
            gateApproved: submitted.length > 0,
            gateCode: rejected[0]?.result.gateCode,
            gateReason: rejected[0]?.result.gateReason,
            executionId: submitted[0]?.result.executionId,
            direction: firstSide ?? undefined,
            waited: outcomes.length === 0,
            waitReason:
                outcomes.length === 0
                    ? plan.intents.long.reason ?? plan.intents.short.reason ?? "no_setup"
                    : undefined,
            error: outcomes.find((o) => o.outcome === "submit_failed")?.result.error,
        };
    }

    /**
     * Direction-specific cooldowns. The daily caps and notional budget are NOT
     * duplicated here: pacing and the unified ledger enforce those account-wide
     * for both lanes (see `preSignalCheck` and the risk engine).
     */
    private async loadLaneCooldowns(
        userId: string,
        account: string,
        botId: string,
    ): Promise<LanePacing> {
        const cooldownMs = Math.max(0, this.laneConfig?.cooldownSeconds ?? 0) * 1000;
        if (cooldownMs <= 0) return { long: { lastEntryAt: null }, short: { lastEntryAt: null } };

        // Reuse the persisted pacing reader: it already tolerates an unreadable
        // execution log and reports the most recent submitted entry per
        // direction. The pacing check and the gate/notional ledger still run on
        // every entry, so a missing cooldown is never the only guard.
        let latest: { long: number | null; short: number | null } = { long: null, short: null };
        try {
            const context = await loadScalpingPacingContext(userId, account, botId, this.magicNumber);
            latest = {
                long: context.lastEntryAtBySide?.long ?? null,
                short: context.lastEntryAtBySide?.short ?? null,
            };
        } catch {
            // Cooldown state unavailable: no cooldown is invented.
        }

        return {
            long: {
                lastEntryAt: latest.long,
                cooldownUntil: latest.long ? latest.long + cooldownMs : undefined,
            },
            short: {
                lastEntryAt: latest.short,
                cooldownUntil: latest.short ? latest.short + cooldownMs : undefined,
            },
        };
    }

    /** Full existing pipeline for ONE lane (idempotency → gate → queue). */
    private async runLaneSignal(params: {
        side: "long" | "short";
        signalId: string;
        atr: number;
        regime: string;
        confidence?: number;
        bar: MarketCandle;
        botId: string;
        ownerId: string;
        strategyId: string;
    }): Promise<{ outcome: LaneSignalOutcome; result: BotTickResult }> {
        const { side, signalId, bar, botId, ownerId, strategyId } = params;
        const direction = side === "long" ? "BUY" : "SELL";
        const executionId = this.executionIdFor(signalId);

        const existing = await getExecution(botId, executionId).catch(() => null);
        if (existing && existing.status !== "failed") {
            return { outcome: "skipped", result: { signalGenerated: false, signalId, executionId } };
        }

        const spec = simSymbolSpec(this.strategy.asset);
        const stops = computeStops(
            this.strategy,
            bar.close,
            params.atr,
            direction === "BUY",
            spec.digits,
            spec.tickSize,
        );

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
        await appendLog(botId, "signal", `${side === "long" ? "LONG" : "SHORT"} lane signal: ${direction} ${this.strategy.asset}`, {
            signalId,
            direction,
            lane: side,
            confidence: params.confidence,
        });

        if (this.preSignalCheck) {
            let pacing: { ok: boolean; code?: string; reason?: string };
            try {
                pacing = await this.preSignalCheck(signal);
            } catch (e) {
                pacing = {
                    ok: false,
                    code: "PACING_UNAVAILABLE",
                    reason: e instanceof Error ? e.message : "Pacing state unavailable.",
                };
            }
            if (!pacing.ok) {
                await updateSignal(botId, signalId, {
                    outcome: "rejected",
                    rejectionCode: pacing.code ?? "PACING_REJECTED",
                    rejectionReason: pacing.reason,
                });
                await appendLog(
                    botId,
                    "warn",
                    `${side.toUpperCase()} lane held by pacing: ${pacing.code ?? "PACING_REJECTED"} — ${pacing.reason ?? "no reason given"}`,
                    { signalId, code: pacing.code, lane: side },
                );
                return {
                    outcome: "pacing_rejected",
                    result: {
                        signalGenerated: true,
                        signalId,
                        gateApproved: false,
                        gateCode: pacing.code,
                        gateReason: pacing.reason,
                        direction: side,
                    },
                };
            }
        }

        const gate = await this.runGate(signal, ownerId, stops.riskPrice, params.regime);
        if (!gate.approved) {
            await updateSignal(botId, signalId, {
                outcome: "rejected",
                rejectionCode: gate.code,
                rejectionReason: gate.reason,
            });
            await appendLog(
                botId,
                "warn",
                `${side.toUpperCase()} lane gate rejected: ${gate.code} — ${gate.reason ?? "no reason given"}`,
                { signalId, code: gate.code, lane: side },
            );
            return {
                outcome: "gate_rejected",
                result: {
                    signalGenerated: true,
                    signalId,
                    gateApproved: false,
                    gateCode: gate.code,
                    gateReason: gate.reason,
                    direction: side,
                },
            };
        }

        const execResult = await this.submitToGateway(signal, ownerId, gate.volume ?? 0);
        await updateSignal(botId, signalId, {
            outcome: execResult.ok ? "submitted" : "rejected",
            executionId: execResult.executionId,
            rejectionCode: execResult.ok ? undefined : execResult.error,
            rejectionReason: execResult.ok ? undefined : execResult.error,
        });

        return {
            outcome: execResult.ok ? "submitted" : "submit_failed",
            result: {
                signalGenerated: true,
                signalId,
                gateApproved: true,
                executionId: execResult.executionId,
                direction: side,
                error: execResult.error,
            },
        };
    }

    /** Deterministic lane signal id — includes the side so lanes never collide. */
    private laneSignalIdFor(
        botId: string,
        strategyId: string,
        barTimestamp: number,
        side: "long" | "short",
    ): string {
        return `SIG_${createHash("sha256")
            .update(`${botId}:${strategyId}:${barTimestamp}:${side}`)
            .digest("hex")
            .slice(0, 24)}`;
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
    ): Promise<AccountOpenPosition[]> {
        const snap = await adminDatabase.ref(`trading_positions/${userId}/${account}`).get();
        if (!snap.exists()) return [];
        const val = (snap.val() || {}) as Record<
            string,
            { symbol?: string; volume?: number; ticket?: string; type?: string; magic?: number | string }
        >;
        return Object.entries(val).map(([ticket, p]) => {
            const rawType = String(p?.type ?? "").trim().toUpperCase();
            const side: AccountOpenPosition["side"] =
                rawType === "BUY" || rawType === "0"
                    ? "long"
                    : rawType === "SELL" || rawType === "1"
                      ? "short"
                      : null;
            return {
                symbol: String(p?.symbol ?? "").toUpperCase(),
                volume: Number(p?.volume) || 0,
                ticket: p?.ticket ?? ticket,
                side,
                magic: Number.isFinite(Number(p?.magic)) ? Number(p?.magic) : null,
            };
        });
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

/**
 * Default evaluator: the canonical single-direction live-signal path.
 *
 * Kept identical to the previous inline call so every existing bot behaves
 * exactly as before. Directional bots supply `options.signalEvaluator`.
 */
function evaluateSingleDirectionSignal(
    strategy: Strategy,
    seriesByTF: Partial<Record<Timeframe, MarketCandle[]>>,
    timestamp: number,
): BotSignalEvaluation {
    const evaluation = evaluateStrategySignal(strategy, seriesByTF, timestamp);
    return {
        fired: evaluation.fired,
        direction: strategy.direction,
        atr: evaluation.atr,
        regime: evaluation.regime,
        waitReason: evaluation.fired ? undefined : "no_setup",
        waitDetail: evaluation.fired ? undefined : "Strategy entry conditions did not qualify on this bar.",
    };
}
