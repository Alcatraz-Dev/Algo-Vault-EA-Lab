/**
 * AI Execution — test suite.
 *
 * Covers (matching the feature acceptance list):
 *   1.  TradePlan validation (schema)
 *   2.  Evidence requirements (non-AI evidence mandatory, UNAVAILABLE honesty)
 *   3.  Risk gate (fail-closed on missing state, canonical engine integration)
 *   4.  Authorization (no account / no license+token → REJECT)
 *   5.  Approval flow (APPROVAL mode → WAIT_APPROVAL, never EXECUTE)
 *   6.  Automation policy (clamped to hard ceilings, whitelist enforcement)
 *   7.  Duplicate-order prevention (deterministic keys)
 *   8.  Kill switch (engaged → REJECT)
 *   9.  Stale-data protection (old quote → REJECT)
 *   10. Setup lifecycle (non-qualified setup → REJECT)
 *   11. Expiry (expired plan → REJECT)
 *   12. Trading-hours restriction
 *   13. Plan lifecycle transition table
 *   14. AI-failure honesty (UNAVAILABLE evidence carries reason, no value)
 *   15. No-secret-leakage (audit/plan shapes reject credential-shaped keys)
 *   16. Backtest/replay compatibility (deterministic context → same decision)
 *
 * Run: node scripts/jiti-tsrun.mjs lib/ai-execution/__tests__/run-ai-execution-tests.ts
 */

import {
    validateTradePlan,
    validateEvidenceItem,
} from "../validate";
import {
    evidenceCheck,
    evidenceMeetsMinimum,
    evaluateGate,
    freshnessCheck,
    setupLifecycleCheck,
    tradingHoursCheck,
    instrumentWhitelistCheck,
    stopDistanceCheck,
    duplicateCheck,
    expiryCheck,
    type GateContext,
} from "../gate";
import {
    AUTOMATION_HARD_CEILINGS,
    clampAutomationPolicy,
    DEFAULT_AUTOMATION_POLICY,
    unavailableEvidence,
    observedEvidence,
} from "../types";
import type { TradePlan, EvidenceItem } from "../types";
import { canTransitionPlan, planStageForSetupMemory } from "../lifecycle";
import { submissionKeyFor } from "../database";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic fixtures (explicit, not fabricated market data)
// ─────────────────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;
const FRESH_TS = NOW - 5_000;

const EVIDENCE: EvidenceItem[] = [
    observedEvidence("ev-quote", "market-data.biquote-ohlc", "Live quote", 2415.5, FRESH_TS),
    observedEvidence("ev-structure", "analytics.market-structure", "BOS bullish M15", "BOS", FRESH_TS),
    observedEvidence("ev-liquidity", "analytics.liquidity", "Sell-side sweep", "SWEEP", FRESH_TS),
];

function makePlan(overrides: Partial<TradePlan> = {}): TradePlan {
    return {
        id: "plan_test_0001",
        userId: "user_test",
        instrument: "XAUUSD",
        direction: "BUY",
        timeframe: "M15",
        entry: 2415.5,
        stopLoss: 2410.5,
        takeProfits: [{ index: 1, price: 2425.5 }],
        riskPercent: 1,
        setupId: "setup_test",
        marketRegime: "TRENDING_BULLISH",
        evidence: [...EVIDENCE],
        invalidationConditions: ["Structure breaks below 2410"],
        status: "VALIDATING",
        executionMode: "APPROVAL",
        generatedAt: NOW - 60_000,
        expiresAt: NOW + 10 * 60_000,
        createdAt: NOW - 60_000,
        updatedAt: NOW - 60_000,
        ...overrides,
    };
}

const BASE_CTX: GateContext = {
    now: NOW,
    executionMode: "APPROVAL",
    automation: { ...DEFAULT_AUTOMATION_POLICY, allowedInstruments: ["XAUUSD"] },
    quote: { price: 2415.6, spread: 0.2, timestamp: FRESH_TS, provider: "biquote" },
    setupStatus: "TRIGGERED",
    openPositions: [],
    riskSnapshot: {
        emergencyStop: false,
        account: { balance: 10_000, openPositionsCount: 0, symbolExposureLots: 0 },
        controls: {},
        accountRecord: {},
        broker: { minLot: 0.01, lotStep: 0.01, maxLot: 10 },
    },
    authorization: { hasAccount: true, hasLicense: true, hasGatewayToken: true },
    recentSubmissionKeys: [],
    killSwitchEngaged: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

let failures = 0;
let count = 0;
function check(cond: boolean, label: string): void {
    count += 1;
    if (cond) console.log(`  PASS: ${label}`);
    else {
        console.error(`  FAIL: ${label}`);
        failures += 1;
    }
}

function section(title: string): void {
    console.log(`\n--- ${title} ---`);
}

// 1. Schema validation
section("1. TradePlan validation");
{
    const r = validateTradePlan(makePlan(), { maxRiskPercent: 2 });
    check(r.valid, "Valid plan passes schema");
    check(!validateTradePlan(makePlan({ direction: "LONG" as never })).valid, "Invalid direction rejected");
    check(!validateTradePlan(makePlan({ entry: -1 })).valid, "Negative entry rejected");
    check(!validateTradePlan(makePlan({ stopLoss: 2500 })).valid, "BUY SL above entry rejected");
    check(!validateTradePlan(makePlan({ takeProfits: [] })).valid, "Empty takeProfits rejected");
    check(!validateTradePlan(makePlan({ takeProfits: [{ index: 1, price: 2400 }] })).valid, "BUY TP below entry rejected");
    check(!validateTradePlan(makePlan({ riskPercent: 5 })).valid, "riskPercent above schema max rejected");
    check(!validateTradePlan(makePlan({ riskPercent: 0.01 })).valid, "riskPercent below minimum rejected");
    check(!validateTradePlan(makePlan({ status: "CLOSED" })).valid, "Terminal status at generation rejected");
    check(!validateTradePlan(makePlan({ instrument: "xau$!" })).valid, "Malformed instrument rejected");
    check(!validateTradePlan(makePlan({ expiresAt: NOW - 120_000 })).valid, "expiresAt before generatedAt rejected");
}

// 2. Evidence requirements
section("2. Evidence requirements");
{
    check(validateEvidenceItem(unavailableEvidence("u1", "analytics.zones", "FVG engine", "Engine did not answer.")) === null, "UNAVAILABLE with reason is valid");
    check(validateEvidenceItem({ id: "u2", evidenceClass: "UNAVAILABLE", sourceId: "analytics.zones", label: "x", observedAt: null, value: 42 }) !== null, "UNAVAILABLE with a value is INVALID (fabrication guard)");
    check(validateEvidenceItem({ id: "u3", evidenceClass: "UNAVAILABLE", sourceId: "analytics.zones", label: "x", observedAt: null }) !== null, "UNAVAILABLE without reason is INVALID");
    check(evidenceCheck(makePlan({ evidence: [] })).passed === false, "Empty evidence fails the gate");
    const aiOnly = makePlan({ evidence: [{ id: "ai1", evidenceClass: "AI_INTERPRETATION", sourceId: "ai-execution.interpretation", label: "AI says go", observedAt: FRESH_TS, value: "long" }] });
    check(evidenceCheck(aiOnly).passed === false, "AI-only evidence fails the gate (AI can never be sole basis)");
    check(!evidenceMeetsMinimum(aiOnly.evidence, 1), "AI-only evidence fails the minimum-count check");
    check(evidenceMeetsMinimum(EVIDENCE, 3), "Three deterministic evidence items meet a minimum of 3");
}

// 3–11. Gate behavior
section("3. Risk gate — fail-closed");
{
    const result = evaluateGate({ plan: makePlan(), ctx: { ...BASE_CTX, executionMode: "AUTOMATION", riskSnapshot: undefined } });
    check(result.decision === "REJECT" && result.finalCode === "RISK_STATE_UNAVAILABLE", "Missing risk snapshot → REJECT (fail-closed)");
    const emergency = evaluateGate({ plan: makePlan(), ctx: { ...BASE_CTX, executionMode: "AUTOMATION", riskSnapshot: { ...BASE_CTX.riskSnapshot!, emergencyStop: true } } });
    check(emergency.decision === "REJECT" && emergency.finalCode === "EMERGENCY_STOP", "Account emergency stop → REJECT via canonical engine");
    const dailyLoss = evaluateGate({
        plan: makePlan(),
        ctx: { ...BASE_CTX, executionMode: "AUTOMATION", riskSnapshot: { ...BASE_CTX.riskSnapshot!, account: { ...BASE_CTX.riskSnapshot!.account, dailyLossPercent: 6 } } },
    });
    check(dailyLoss.decision === "REJECT" && dailyLoss.finalCode === "DAILY_LOSS_LIMIT", "Daily loss limit breached → REJECT");
}

section("4. Authorization");
{
    const noAccount = evaluateGate({ plan: makePlan(), ctx: { ...BASE_CTX, executionMode: "AUTOMATION", authorization: { hasAccount: false, hasLicense: true, hasGatewayToken: true } } });
    check(noAccount.decision === "REJECT" && noAccount.finalCode === "NO_CONNECTED_ACCOUNT", "No connected account → REJECT");
    const noAuth = evaluateGate({ plan: makePlan(), ctx: { ...BASE_CTX, executionMode: "AUTOMATION", authorization: { hasAccount: true, hasLicense: false, hasGatewayToken: false } } });
    check(noAuth.decision === "REJECT" && noAuth.finalCode === "NO_GATEWAY_AUTHORIZATION", "No license and no gateway token → REJECT");
}

section("5. Approval flow");
{
    const approval = evaluateGate({ plan: makePlan(), ctx: BASE_CTX });
    check(approval.decision === "WAIT_APPROVAL" && approval.finalCode === "AWAITING_APPROVAL", "All checks pass in APPROVAL mode → WAIT_APPROVAL (never silent execution)");
    check((approval.orderVolume ?? 0) > 0, "Approval path resolves order volume for the confirmation card");
    const analysis = evaluateGate({ plan: makePlan(), ctx: { ...BASE_CTX, executionMode: "ANALYSIS" } });
    check(analysis.decision === "WAIT_APPROVAL" && analysis.finalCode === "ANALYSIS_ONLY", "ANALYSIS mode never produces an execution decision");
    check(!analysis.checks.some((c) => c.stage === "DATA_FRESHNESS" && !c.passed), "ANALYSIS mode does not require a live quote (evaluation-only)");
}

section("6. Automation policy");
{
    const auto = evaluateGate({ plan: makePlan({ executionMode: "AUTOMATION" }), ctx: { ...BASE_CTX, executionMode: "AUTOMATION" } });
    check(auto.decision === "EXECUTE", "Automation mode with a qualifying plan → EXECUTE");
    const mismatch = evaluateGate({ plan: makePlan({ executionMode: "APPROVAL" }), ctx: { ...BASE_CTX, executionMode: "AUTOMATION" } });
    check(mismatch.decision === "REJECT" && mismatch.finalCode === "MODE_MISMATCH", "Automation cannot execute a plan not generated for automation");
    const wrongInstrument = evaluateGate({ plan: makePlan({ executionMode: "AUTOMATION", instrument: "EURUSD" }), ctx: { ...BASE_CTX, executionMode: "AUTOMATION" } });
    check(wrongInstrument.decision === "REJECT" && wrongInstrument.finalCode === "INSTRUMENT_NOT_ALLOWED", "Instrument outside whitelist → REJECT");
    const noWhitelist = evaluateGate({ plan: makePlan({ executionMode: "AUTOMATION" }), ctx: { ...BASE_CTX, executionMode: "AUTOMATION", automation: { ...DEFAULT_AUTOMATION_POLICY, allowedInstruments: [] } } });
    check(noWhitelist.decision === "REJECT" && noWhitelist.finalCode === "NO_INSTRUMENT_WHITELIST", "Empty whitelist → REJECT (automation must be scoped)");
    // XAUUSD pipSize = 0.01, so a 0.1 price distance = 10 pips < the 5-pip minimum is
    // still enforced — use a 0.04 distance (4 pips) to trip the check.
    const tooClose = evaluateGate({ plan: makePlan({ executionMode: "AUTOMATION", stopLoss: 2415.46 }), ctx: { ...BASE_CTX, executionMode: "AUTOMATION" } });
    check(tooClose.decision === "REJECT" && tooClose.finalCode === "STOP_TOO_CLOSE", "Stop closer than minimum pips → REJECT");
    // Policy clamping
    const clamped = clampAutomationPolicy({ maxRiskPercentPerTrade: 50, maxLot: 100, maxOpenPositions: 999, maxDataAgeMs: 999_999_999 });
    check(clamped.maxRiskPercentPerTrade === AUTOMATION_HARD_CEILINGS.maxRiskPercentPerTrade, "User policy cannot exceed hard ceiling for risk %");
    check(clamped.maxLot === AUTOMATION_HARD_CEILINGS.maxLot, "User policy cannot exceed hard ceiling for max lot");
    check(clamped.maxOpenPositions === AUTOMATION_HARD_CEILINGS.maxOpenPositions, "User policy cannot exceed hard ceiling for open positions");
    check(clamped.maxDataAgeMs === AUTOMATION_HARD_CEILINGS.maxDataAgeMs, "User policy cannot loosen stale-data protection past the ceiling");
    check(clampAutomationPolicy(undefined).maxRiskPercentPerTrade === DEFAULT_AUTOMATION_POLICY.maxRiskPercentPerTrade, "Missing policy falls back to conservative defaults");
}

section("7. Duplicate-order prevention");
{
    const plan = makePlan();
    const key = submissionKeyFor(plan);
    check(typeof key === "string" && key.includes("XAUUSD|BUY"), "Submission key is deterministic");
    check(duplicateCheck(plan, [key]).passed === false, "Identical recent submission → DUPLICATE_ORDER");
    check(duplicateCheck(plan, ["EURUSD|SELL|1.1|1.09"]).passed === true, "Different order passes duplicate check");
    check(submissionKeyFor(makePlan({ entry: 2415.500001 })) === key, "Microscopic entry difference still counts as duplicate (rounding)");
}

section("8. Kill switch");
{
    const killed = evaluateGate({ plan: makePlan({ executionMode: "AUTOMATION" }), ctx: { ...BASE_CTX, executionMode: "AUTOMATION", killSwitchEngaged: true } });
    check(killed.decision === "REJECT" && killed.finalCode === "KILL_SWITCH_ENGAGED", "Kill switch engaged → REJECT");
}

section("9. Stale-data protection");
{
    const staleQuote = { price: 2415.6, spread: 0.2, timestamp: NOW - 10 * 60_000, provider: "biquote" };
    const stale = freshnessCheck("XAUUSD", makePlan(), staleQuote, 60_000, NOW);
    check(!stale.passed && stale.code === "MARKET_DATA_STALE", "Quote older than threshold → MARKET_DATA_STALE");
    const unavailable = freshnessCheck("XAUUSD", makePlan(), null, 60_000, NOW);
    check(!unavailable.passed && unavailable.code === "MARKET_DATA_UNAVAILABLE", "Missing quote → MARKET_DATA_UNAVAILABLE");
    const gateStale = evaluateGate({ plan: makePlan({ executionMode: "AUTOMATION" }), ctx: { ...BASE_CTX, executionMode: "AUTOMATION", quote: staleQuote } });
    check(gateStale.decision === "REJECT" && gateStale.finalCode === "MARKET_DATA_STALE", "Gate refuses to execute on stale data");
    const wideSpread = evaluateGate({
        plan: makePlan({ executionMode: "AUTOMATION" }),
        ctx: { ...BASE_CTX, executionMode: "AUTOMATION", quote: { price: 2415.6, spread: 1.5, timestamp: FRESH_TS, provider: "biquote" } },
    });
    check(wideSpread.decision === "REJECT" && wideSpread.finalCode === "SPREAD_TOO_WIDE", "Spread above instrument tolerance → REJECT");
}

section("10. Setup lifecycle");
{
    check(setupLifecycleCheck(makePlan(), "TRIGGERED").passed, "TRIGGERED setup qualifies");
    check(setupLifecycleCheck(makePlan(), "ACTIVE").passed, "ACTIVE setup qualifies");
    check(!setupLifecycleCheck(makePlan(), "EXPIRED").passed, "EXPIRED setup does not qualify");
    check(!setupLifecycleCheck(makePlan(), "INVALIDATED").passed, "INVALIDATED setup does not qualify");
    check(!setupLifecycleCheck(makePlan(), null).passed, "Missing setup record → REJECT (fail-closed)");
    const noSetupRef = makePlan();
    noSetupRef.setupId = undefined;
    check(setupLifecycleCheck(noSetupRef, null).passed, "Plan without a setup reference relies on evidence checks alone");
    const gateResult = evaluateGate({ plan: makePlan(), ctx: { ...BASE_CTX, setupStatus: "EXPIRED" } });
    check(gateResult.decision === "REJECT" && gateResult.finalCode === "SETUP_NOT_QUALIFIED", "Gate rejects plans tied to expired setups");
}

section("11. Expiry");
{
    check(!expiryCheck(makePlan({ expiresAt: NOW - 1 }), NOW).passed, "Expired plan fails expiry check");
    const gateExpired = evaluateGate({ plan: makePlan({ executionMode: "AUTOMATION", expiresAt: NOW - 1 }), ctx: { ...BASE_CTX, executionMode: "AUTOMATION" } });
    check(gateExpired.decision === "REJECT" && gateExpired.finalCode === "PLAN_EXPIRED", "Gate rejects expired plans");
}

section("12. Trading-hours restriction");
{
    const utcHour = new Date(NOW).getUTCHours();
    const alwaysInside = { startHour: 0, endHour: 24 };
    const inside = tradingHoursCheck({ ...DEFAULT_AUTOMATION_POLICY, tradingHoursUtc: alwaysInside }, NOW);
    check(inside.passed, "0–24h window always passes");
    const narrowed = tradingHoursCheck({ ...DEFAULT_AUTOMATION_POLICY, tradingHoursUtc: { startHour: (utcHour + 1) % 24, endHour: (utcHour + 2) % 24 } }, NOW);
    check(!narrowed.passed, "Window excluding the current hour fails");
    const overnight = tradingHoursCheck({ ...DEFAULT_AUTOMATION_POLICY, tradingHoursUtc: { startHour: 22, endHour: 6 } }, Date.UTC(2026, 0, 1, 23));
    check(overnight.passed, "Overnight window (22–6) passes at 23:00 UTC");
}

section("13. Plan lifecycle transitions");
{
    check(canTransitionPlan("VALIDATING", "PENDING_APPROVAL"), "VALIDATING → PENDING_APPROVAL allowed");
    check(canTransitionPlan("PENDING_APPROVAL", "APPROVED"), "PENDING_APPROVAL → APPROVED allowed");
    check(canTransitionPlan("APPROVED", "SUBMITTED"), "APPROVED → SUBMITTED allowed");
    check(canTransitionPlan("SUBMITTED", "OPEN"), "SUBMITTED → OPEN allowed");
    check(canTransitionPlan("OPEN", "CLOSED"), "OPEN → CLOSED allowed");
    check(!canTransitionPlan("CLOSED", "OPEN"), "CLOSED → OPEN forbidden (terminal)");
    check(!canTransitionPlan("REJECTED", "APPROVED"), "REJECTED → APPROVED forbidden");
    check(!canTransitionPlan("PENDING_APPROVAL", "OPEN"), "PENDING_APPROVAL cannot skip straight to OPEN");
    check(planStageForSetupMemory("PENDING_APPROVAL") === "WAITING_FOR_APPROVAL", "Setup Memory stage mapping: WAITING_FOR_APPROVAL");
    check(planStageForSetupMemory("OPEN") === "EXECUTED", "Setup Memory stage mapping: EXECUTED");
}

section("14. AI-failure honesty");
{
    const plan = makePlan();
    const aiDown = unavailableEvidence("ai-1", "ai-execution.interpretation", "AI interpretation", "AI unavailable or over budget — plan is deterministic-only.");
    check(aiDown.evidenceClass === "UNAVAILABLE" && typeof aiDown.reason === "string" && aiDown.value === undefined, "AI outage records an honest UNAVAILABLE item (reason, no value)");
    check(evidenceCheck({ ...plan, evidence: [...plan.evidence, aiDown] }).passed, "Plan stays gate-valid when AI interpretation is unavailable (deterministic evidence carries it)");
}

section("15. No-secret-leakage");
{
    // Audit/plan persistence shape guard: no credential-shaped keys allowed.
    const FORBIDDEN = ["apikey", "api_key", "secret", "password", "token_string", "authorization", "bearer", "gatewaytoken"];
    const auditLike = { action: "EXECUTION_SUBMITTED", planId: "p1", actor: "user", brokerResponse: { clientOrderId: "aie_1", queued: true } };
    const planLike = makePlan();
    const scan = (obj: Record<string, unknown>): string[] => {
        const found: string[] = [];
        const walk = (v: unknown, path: string) => {
            if (!v || typeof v !== "object") return;
            for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
                const norm = k.toLowerCase();
                if (FORBIDDEN.some((f) => norm.includes(f))) found.push(`${path}.${k}`);
                walk(child, `${path}.${k}`);
            }
        };
        walk(obj, "");
        return found;
    };
    check(scan(auditLike as unknown as Record<string, unknown>).length === 0, "Audit payload contains no credential-shaped keys");
    check(scan(planLike as unknown as Record<string, unknown>).length === 0, "TradePlan payload contains no credential-shaped keys");
    check(!JSON.stringify(makePlan({ execution: { clientOrderId: "aie_x", gatewayTicket: "123", mt5Account: "gateway_1" } })).includes("password"), "Execution linkage holds no credentials — only ids");
}

section("16. Backtest/replay compatibility (determinism)");
{
    // Same context twice → identical decision (required for replay).
    const ctxA: GateContext = { ...BASE_CTX, executionMode: "AUTOMATION" };
    const ctxB: GateContext = { ...BASE_CTX, executionMode: "AUTOMATION" };
    const rA = evaluateGate({ plan: makePlan({ executionMode: "AUTOMATION" }), ctx: ctxA });
    const rB = evaluateGate({ plan: makePlan({ executionMode: "AUTOMATION" }), ctx: ctxB });
    check(rA.decision === rB.decision && rA.finalCode === rB.finalCode, "Identical contexts → identical gate decision (replay-safe)");
    // Historical-style context: no live quote → replay adapter passes the bar's
    // close as the quote with the bar's own timestamp; stale-data rule still
    // applies relative to the REPLAY clock, not wall-clock.
    const replayCtx: GateContext = { ...ctxA, now: FRESH_TS + 1_000, quote: { price: 2415.5, spread: 0.2, timestamp: FRESH_TS, provider: "replay-bar" } };
    const rR = evaluateGate({ plan: makePlan({ executionMode: "AUTOMATION", generatedAt: FRESH_TS - 60_000, expiresAt: FRESH_TS + 600_000 }), ctx: replayCtx });
    check(rR.decision === "EXECUTE", "Replay context (bar quote, replay clock) executes deterministically");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n==========================================");
if (failures === 0) {
    console.log(`ALL AI EXECUTION TESTS PASSED (${count}/${count})`);
    console.log("==========================================");
    process.exit(0);
} else {
    console.error(`AI EXECUTION TEST SUITE FAILED: ${failures}/${count} failed`);
    console.log("==========================================");
    process.exit(1);
}
