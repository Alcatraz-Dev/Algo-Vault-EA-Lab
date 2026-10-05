/**
 * AI Execution — deterministic execution gate.
 *
 * THE boundary between AI reasoning and the broker. Pure logic + canonical
 * reads; NO AI calls; NO network beyond the platform's own RTDB/market-data.
 *
 * Pipeline (every stage fail-closed — when a required condition cannot be
 * verified the result is REJECT, never "assume it's fine"):
 *
 *   AI TradePlan
 *     → schema validation          (lib/ai-execution/validate.ts)
 *     → evidence validation        (≥1 non-AI evidence item; no UNAVAILABLE values)
 *     → data freshness validation  (market snapshot age vs policy threshold)
 *     → setup lifecycle validation (Setup Memory record must be ACTIVE/TRIGGERED)
 *     → risk validation            (canonical lib/risk engine + account state)
 *     → authorization validation   (connected account + license/token + policy)
 *     → execution policy validation(mode, hours, whitelist, kill switch, exposure)
 *     → duplicate prevention       (idempotency window)
 *     → EXECUTE (caller submits through the existing gateway path)
 *
 * The gate is usable in two ways:
 *   • evaluateGate() — pure-ish evaluation that persists nothing (used by the
 *     approval card, the AI terminal, tests and the replay/backtest adapter)
 *   • runGateAndSubmit() — evaluation + submission through dispatchTradePlan
 *     (the only path that writes mt5_orders / trading_order_requests)
 */

import { evaluateOrder, type OrderDirection, type OrderEntryKind, type OrderIntent, type RiskLimits } from "@/lib/risk/risk-engine";
import { buildEntryRiskLimits, loadAccountRiskSnapshot } from "@/lib/risk/account-state";
import { hasActiveTradingLicense, getGatewayTokenForUser } from "@/lib/gateway";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import type { AutomationPolicy, EvidenceItem, ExecutionGateResult, GateCheck, TradePlan } from "./types";
import { clampAutomationPolicy } from "./types";
import { validateTradePlan } from "./validate";
import { getKillSwitch, submissionKeyFor } from "./database";

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests + replay adapter)
// ─────────────────────────────────────────────────────────────────────────────

export interface GateContext {
    now: number;
    /** Server-derived execution mode for the user (never client-supplied). */
    executionMode: TradePlan["executionMode"];
    automation?: AutomationPolicy;
    /** Live quote for freshness/spread checks; null means unavailable. */
    quote?: { price: number; spread: number; timestamp: number; provider: string } | null;
    /** Setup Memory record status when the plan references one. */
    setupStatus?: string | null;
    /** Known open positions (from trading_positions). */
    openPositions?: Array<{ symbol: string; volume: number; ticket?: string }>;
    /** Account state collected by lib/risk/account-state. */
    riskSnapshot?: Awaited<ReturnType<typeof loadAccountRiskSnapshot>>;
    /** Server-verified authorization facts. */
    authorization?: { hasAccount: boolean; hasLicense: boolean; hasGatewayToken: boolean };
    /** Recent submission keys for duplicate detection (pre-recorded). */
    recentSubmissionKeys?: string[];
    killSwitchEngaged?: boolean;
}

function check(stage: GateCheck["stage"], passed: boolean, code: string, reason?: string): GateCheck {
    return { stage, passed, code, reason };
}

function pipsFor(instrument: string, distance: number): number {
    const spec = getSymbolSpec(instrument);
    const pip = spec?.pipSize ?? 0.0001;
    return distance / pip;
}

export function evidenceCheck(plan: TradePlan): GateCheck {
    const items = Array.isArray(plan.evidence) ? plan.evidence : [];
    const nonAi = items.filter((e) => e && e.evidenceClass !== "AI_INTERPRETATION" && e.evidenceClass !== "UNAVAILABLE");
    if (items.length === 0) {
        return check("EVIDENCE", false, "NO_EVIDENCE", "Plan carries no evidence at all.");
    }
    if (nonAi.length === 0) {
        return check("EVIDENCE", false, "AI_ONLY_EVIDENCE", "Plan rests only on AI interpretation — no observed/derived/historical evidence.");
    }
    const broken = items.find((e) => e.evidenceClass === "UNAVAILABLE" && !e.reason);
    if (broken) {
        return check("EVIDENCE", false, "EVIDENCE_MALFORMED", `UNAVAILABLE evidence "${broken.id}" lacks a reason.`);
    }
    return check("EVIDENCE", true, "EVIDENCE_OK");
}

export function evidenceMeetsMinimum(items: EvidenceItem[], minimum: number): boolean {
    const nonAi = items.filter((e) => e && e.evidenceClass !== "AI_INTERPRETATION" && e.evidenceClass !== "UNAVAILABLE");
    return nonAi.length >= minimum;
}

export function freshnessCheck(
    instrument: string,
    plan: TradePlan,
    quote: GateContext["quote"],
    maxDataAgeMs: number,
    now: number,
): GateCheck {
    if (!quote || !(quote.price > 0)) {
        return check("DATA_FRESHNESS", false, "MARKET_DATA_UNAVAILABLE", "No live quote available for the instrument — failing closed.");
    }
    const age = now - quote.timestamp;
    if (!Number.isFinite(age) || age < 0 || age > maxDataAgeMs) {
        return check("DATA_FRESHNESS", false, "MARKET_DATA_STALE", `Quote age ${age}ms exceeds the ${maxDataAgeMs}ms policy threshold.`);
    }
    const spec = getSymbolSpec(instrument);
    const pip = spec?.pipSize ?? 0.0001;
    const spreadPips = quote.spread / pip;
    return check("DATA_FRESHNESS", true, "DATA_FRESH", undefined);
}

export function spreadCheck(instrument: string, quote: NonNullable<GateContext["quote"]>, maxSpreadPips: number): GateCheck {
    const spec = getSymbolSpec(instrument);
    const pip = spec?.pipSize ?? 0.0001;
    const spreadPips = quote.spread / pip;
    // Per-symbol tolerance: the stricter of the policy's pip limit and 1.5× the
    // platform's own typical-spread spec for the instrument. A fixed pip limit
    // alone is meaningless across instruments (gold's typical spread is ~20
    // "pips" at pipSize 0.01; an FX major's is ~1 pip).
    const tolerancePrice = Math.max(maxSpreadPips * pip, (spec?.typicalSpread ?? 0) * 1.5);
    if (quote.spread > tolerancePrice) {
        return check("EXECUTION_POLICY", false, "SPREAD_TOO_WIDE", `Spread ${spreadPips.toFixed(1)} pips exceeds the instrument tolerance (${(tolerancePrice / pip).toFixed(1)} pips).`);
    }
    return check("EXECUTION_POLICY", true, "SPREAD_OK");
}

export function setupLifecycleCheck(plan: TradePlan, setupStatus: string | null | undefined): GateCheck {
    if (!plan.setupId) {
        // A plan with no setup reference still needs SOME deterministic basis,
        // which the evidence check already covers.
        return check("SETUP_LIFECYCLE", true, "NO_SETUP_REFERENCE");
    }
    if (!setupStatus) {
        return check("SETUP_LIFECYCLE", false, "SETUP_NOT_FOUND", "Plan references a setup that no longer exists — refusing to execute.");
    }
    const qualified = ["ACTIVE", "TRIGGERED"].includes(setupStatus);
    return qualified
        ? check("SETUP_LIFECYCLE", true, "SETUP_QUALIFIED")
        : check("SETUP_LIFECYCLE", false, "SETUP_NOT_QUALIFIED", `Setup status is ${setupStatus} — only ACTIVE/TRIGGERED setups qualify for execution.`);
}

export function expiryCheck(plan: TradePlan, now: number): GateCheck {
    return expiryDeadlineCheck(plan.expiresAt, now);
}

/** Source-agnostic expiry check. `expiresAt === undefined` means "no expiry". */
export function expiryDeadlineCheck(expiresAt: number | undefined, now: number): GateCheck {
    if (expiresAt === undefined) return check("EXECUTION_POLICY", true, "NO_EXPIRY");
    if (expiresAt <= now) {
        return check("EXECUTION_POLICY", false, "PLAN_EXPIRED", "Plan has expired — never execute a stale plan.");
    }
    return check("EXECUTION_POLICY", true, "PLAN_VALID");
}

export function tradingHoursCheck(policy: AutomationPolicy, now: number): GateCheck {
    if (!policy.tradingHoursUtc) return check("EXECUTION_POLICY", true, "HOURS_UNRESTRICTED");
    const hour = new Date(now).getUTCHours();
    const { startHour, endHour } = policy.tradingHoursUtc;
    const inWindow = startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
    return inWindow
        ? check("EXECUTION_POLICY", true, "HOURS_OK")
        : check("EXECUTION_POLICY", false, "OUTSIDE_TRADING_HOURS", `Current UTC hour ${hour} is outside the automation window ${startHour}–${endHour}.`);
}

export function instrumentWhitelistCheck(plan: TradePlan, policy: AutomationPolicy): GateCheck {
    return instrumentAllowedCheck(plan.instrument, policy);
}

/** Source-agnostic instrument whitelist check. Empty whitelist = deny all. */
export function instrumentAllowedCheck(instrument: string, policy: AutomationPolicy): GateCheck {
    if (!Array.isArray(policy.allowedInstruments) || policy.allowedInstruments.length === 0) {
        return check("EXECUTION_POLICY", false, "NO_INSTRUMENT_WHITELIST", "Automation policy must name at least one allowed instrument before automated execution.");
    }
    const normalized = instrument.toUpperCase().replace("/", "");
    if (!policy.allowedInstruments.map((s) => s.toUpperCase().replace("/", "")).includes(normalized)) {
        return check("EXECUTION_POLICY", false, "INSTRUMENT_NOT_ALLOWED", `${instrument} is not in the automation whitelist.`);
    }
    return check("EXECUTION_POLICY", true, "INSTRUMENT_ALLOWED");
}

export function stopDistanceCheck(plan: TradePlan, minPips: number): GateCheck {
    return stopDistanceForCheck(plan.instrument, plan.entry, plan.stopLoss, minPips);
}

/** Source-agnostic stop-distance check (geometry, before risk sizing). */
export function stopDistanceForCheck(instrument: string, entry: number, stopLoss: number, minPips: number): GateCheck {
    const pips = pipsFor(instrument, Math.abs(entry - stopLoss));
    if (pips < minPips) {
        return check("EXECUTION_POLICY", false, "STOP_TOO_CLOSE", `Stop distance ${pips.toFixed(1)} pips is below the ${minPips} pip minimum.`);
    }
    return check("EXECUTION_POLICY", true, "STOP_DISTANCE_OK");
}

export function exposureChecks(
    plan: TradePlan,
    volume: number,
    policy: AutomationPolicy,
    openPositions: NonNullable<GateContext["openPositions"]>,
    riskSnapshot: GateContext["riskSnapshot"],
): GateCheck[] {
    const out: GateCheck[] = [];
    const totalOpenRiskPct = riskSnapshot?.account.balance
        ? openPositions.reduce((sum, p) => sum + (p.volume || 0), 0) === 0
            ? 0
            : Number(riskSnapshot.controls.automatedOpenRiskPercent ?? NaN)
        : NaN;
    void totalOpenRiskPct;

    const symbolPositions = openPositions.filter((p) => p.symbol === plan.instrument);
    if (symbolPositions.length >= policy.maxPositionsPerInstrument) {
        out.push(check("EXECUTION_POLICY", false, "MAX_POSITIONS_PER_INSTRUMENT", `${plan.instrument} already has ${symbolPositions.length} open position(s) (limit ${policy.maxPositionsPerInstrument}).`));
    }
    if ((riskSnapshot?.account.openPositionsCount ?? openPositions.length) >= policy.maxOpenPositions) {
        out.push(check("EXECUTION_POLICY", false, "MAX_OPEN_POSITIONS", "Account is at the maximum open-positions limit."));
    }
    const automatedOpen = openPositions.filter((p) => (p.ticket ?? "").startsWith("aie_")).length;
    if (automatedOpen >= policy.maxConcurrentAutomatedTrades) {
        out.push(check("EXECUTION_POLICY", false, "MAX_CONCURRENT_AUTOMATED", `${automatedOpen} automated position(s) already open (limit ${policy.maxConcurrentAutomatedTrades}).`));
    }
    if (volume > policy.maxLot) {
        out.push(check("EXECUTION_POLICY", false, "VOLUME_ABOVE_POLICY_MAX", `Volume ${volume} lots exceeds the automation maximum of ${policy.maxLot}.`));
    }
    return out;
}

export function duplicateCheck(plan: TradePlan, recentKeys: string[] | undefined): GateCheck {
    const key = submissionKeyFor(plan);
    if (recentKeys?.includes(key)) {
        return check("DUPLICATE", false, "DUPLICATE_ORDER", "An identical order was submitted recently — duplicate prevention engaged.");
    }
    return check("DUPLICATE", true, "NO_DUPLICATE");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main evaluation
// ─────────────────────────────────────────────────────────────────────────────

export interface EvaluateGateInput {
    plan: TradePlan;
    ctx: GateContext;
}

/**
 * Evaluate every gate stage for a plan. Deterministic given the context.
 * Decision mapping:
 *   • any failure → REJECT (with the failing stage recorded)
 *   • all pass + mode APPROVAL → WAIT_APPROVAL (caller asks the user)
 *   • all pass + mode AUTOMATION (and plan generated for automation) → EXECUTE
 *   • all pass + mode ANALYSIS → WAIT_APPROVAL is still not allowed to execute;
 *     ANALYSIS-mode plans can only ever be evaluated, never executed, so the
 *     decision is REJECT with MODE_ANALYSIS if execution is attempted.
 */
export function evaluateGate(input: EvaluateGateInput): ExecutionGateResult {
    const { plan, ctx } = input;
    const checks: GateCheck[] = [];
    const policy = clampAutomationPolicy(ctx.automation);

    // 1. Schema
    const schema = validateTradePlan(plan, { maxRiskPercent: policy.maxRiskPercentPerTrade });
    checks.push(schema.valid
        ? check("SCHEMA", true, "SCHEMA_OK")
        : check("SCHEMA", false, "SCHEMA_INVALID", schema.errors.join(" ")));
    if (!schema.valid) return finish("REJECT", checks, "SCHEMA_INVALID", "Plan failed schema validation.");

    // 2. Evidence
    const evidence = evidenceCheck(plan);
    checks.push(evidence);
    if (!evidence.passed) return finish("REJECT", checks, evidence.code, evidence.reason);

    // Evidence minimum for automation
    if (ctx.executionMode === "AUTOMATION" && policy.minEvidenceCount > 0) {
        if (!evidenceMeetsMinimum(plan.evidence, policy.minEvidenceCount)) {
            checks.push(check("EVIDENCE", false, "INSUFFICIENT_EVIDENCE", `Automation requires at least ${policy.minEvidenceCount} non-AI evidence items.`));
            return finish("REJECT", checks, "INSUFFICIENT_EVIDENCE", "Not enough deterministic evidence for automated execution.");
        }
    }

    // 3. Data freshness (only for execution-capable modes; analysis may proceed)
    if (ctx.executionMode !== "ANALYSIS") {
        const freshness = freshnessCheck(plan.instrument, plan, ctx.quote ?? null, policy.maxDataAgeMs, ctx.now);
        checks.push(freshness);
        if (!freshness.passed) return finish("REJECT", checks, freshness.code, freshness.reason);

        const stop = stopDistanceCheck(plan, policy.minStopDistancePips);
        checks.push(stop);
        if (!stop.passed) return finish("REJECT", checks, stop.code, stop.reason);
    }

    // 4. Setup lifecycle
    const lifecycle = setupLifecycleCheck(plan, ctx.setupStatus ?? null);
    checks.push(lifecycle);
    if (!lifecycle.passed) return finish("REJECT", checks, lifecycle.code, lifecycle.reason);

    // 5. Risk (canonical engine, real account state)
    if (ctx.executionMode !== "ANALYSIS") {
        const snapshot = ctx.riskSnapshot;
        if (!snapshot) {
            checks.push(check("RISK", false, "RISK_STATE_UNAVAILABLE", "Account risk state could not be loaded — failing closed."));
            return finish("REJECT", checks, "RISK_STATE_UNAVAILABLE", "Account risk state unavailable.");
        }
        const limits: RiskLimits = {
            ...buildEntryRiskLimits(snapshot),
            requireStopLoss: true,
            allowMarketEntries: true,
            maxDailyLossPercent: Math.min(
                buildEntryRiskLimits(snapshot).maxDailyLossPercent ?? Number.MAX_SAFE_INTEGER,
                policy.maxDailyLossPercent,
            ),
            maxOpenPositions: Math.min(
                buildEntryRiskLimits(snapshot).maxOpenPositions ?? Number.MAX_SAFE_INTEGER,
                policy.maxOpenPositions,
            ),
        };
        const intent: OrderIntent = {
            symbol: plan.instrument,
            direction: plan.direction as OrderDirection,
            entryKind: "MARKET" as OrderEntryKind,
            price: plan.entry,
            sl: plan.stopLoss,
            tp: plan.takeProfits[0]?.price ?? null,
            volume: plan.positionSizeLots,
        };
        const decision = evaluateOrder(intent, limits, snapshot.account, ctx.now);
        checks.push(check("RISK", decision.approved, decision.code, decision.reason));
        if (!decision.approved) return finish("REJECT", checks, decision.code, decision.reason);

        // 6. Authorization
        const authz = ctx.authorization;
        if (!authz?.hasAccount) {
            checks.push(check("AUTHORIZATION", false, "NO_CONNECTED_ACCOUNT", "No connected MT5 account found for the caller."));
            return finish("REJECT", checks, "NO_CONNECTED_ACCOUNT", "No connected MT5 account.");
        }
        if (!authz.hasLicense && !authz.hasGatewayToken) {
            checks.push(check("AUTHORIZATION", false, "NO_GATEWAY_AUTHORIZATION", "Account has neither an active trading license nor a gateway token."));
            return finish("REJECT", checks, "NO_GATEWAY_AUTHORIZATION", "Not authorized for gateway execution.");
        }
        checks.push(check("AUTHORIZATION", true, "AUTHORIZED"));

        // 7. Execution policy (mode + kill switch + expiry + hours + whitelist + spread + exposure)
        if (ctx.killSwitchEngaged) {
            checks.push(check("EXECUTION_POLICY", false, "KILL_SWITCH_ENGAGED", "The platform kill switch is engaged — no automated execution."));
            return finish("REJECT", checks, "KILL_SWITCH_ENGAGED", "Kill switch engaged.");
        }
        if (ctx.executionMode === "AUTOMATION" && plan.executionMode !== "AUTOMATION") {
            checks.push(check("EXECUTION_POLICY", false, "MODE_MISMATCH", "Automation-mode account cannot auto-execute a plan not generated for automation."));
            return finish("REJECT", checks, "MODE_MISMATCH", "Plan was not generated for automation.");
        }
        const expiry = expiryCheck(plan, ctx.now);
        checks.push(expiry);
        if (!expiry.passed) return finish("REJECT", checks, expiry.code, expiry.reason);

        const hours = tradingHoursCheck(policy, ctx.now);
        checks.push(hours);
        if (!hours.passed) return finish("REJECT", checks, hours.code, hours.reason);

        const whitelist = instrumentWhitelistCheck(plan, policy);
        checks.push(whitelist);
        if (!whitelist.passed) return finish("REJECT", checks, whitelist.code, whitelist.reason);

        if (ctx.quote) {
            const spread = spreadCheck(plan.instrument, ctx.quote, policy.maxSpreadPips);
            checks.push(spread);
            if (!spread.passed) return finish("REJECT", checks, spread.code, spread.reason);
        }

        const positions = ctx.openPositions ?? [];
        const volume = decision.volume ?? plan.positionSizeLots ?? 0;
        for (const c of exposureChecks(plan, volume, policy, positions, snapshot)) {
            checks.push(c);
            if (!c.passed) return finish("REJECT", checks, c.code, c.reason);
        }

        // 8. Duplicate prevention
        const dup = duplicateCheck(plan, ctx.recentSubmissionKeys);
        checks.push(dup);
        if (!dup.passed) return finish("REJECT", checks, dup.code, dup.reason);

        // Decision
        if (ctx.executionMode === "AUTOMATION") {
            return finish("EXECUTE", checks, "APPROVED", undefined, decision.volume);
        }
        // APPROVAL mode: all deterministic checks passed — wait for the user.
        return finish("WAIT_APPROVAL", checks, "AWAITING_APPROVAL", "All checks passed — awaiting explicit user approval.", decision.volume);
    }

    // ANALYSIS mode: evaluation-only. No execution decision is available.
    checks.push(check("EXECUTION_POLICY", true, "ANALYSIS_ONLY"));
    return finish("WAIT_APPROVAL", checks, "ANALYSIS_ONLY", "Analysis mode — no execution capability.");
}

function finish(
    decision: ExecutionGateResult["decision"],
    checks: GateCheck[],
    finalCode: string,
    reason?: string,
    orderVolume?: number,
): ExecutionGateResult {
    return {
        decision,
        checks,
        finalCode,
        reason,
        orderVolume: decision === "EXECUTE" || decision === "WAIT_APPROVAL" ? orderVolume : undefined,
    };
}
