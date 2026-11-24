// ─────────────────────────────────────────────────────────────────────────────
// Execution-safety tests — drawdown breaker, notional budget, order identity,
// duplicate prevention, typed confirmation, trade permissions.
//
// Synthetic data only. No broker, no RTDB, no AI.
// Run: npm run test:risk
// ─────────────────────────────────────────────────────────────────────────────

import { evaluateOrder, orderNotional, type AccountRiskState, type OrderIntent, type RiskLimits } from "../risk-engine";
import {
    BREAKER_RESET_PHRASE,
    createDrawdownBreaker,
    evaluateDrawdownBreaker,
    resetDrawdownBreaker,
} from "../drawdown-breaker";
import {
    OrderFingerprintGuard,
    authorizeExecution,
    computeOrderIdentity,
    fingerprintScope,
    typedConfirmationPhrase,
    verifyTypedConfirmation,
} from "../order-fingerprint";
import { evaluatePolicy, STRUCTURALLY_BLOCKED, TRADE_TOOL_DECLARATIONS, type AgentPermission } from "@/lib/agent/policies/permission-engine";

let failures = 0;
function check(cond: boolean, label: string, detail?: unknown): void {
    if (cond) {
        console.log(`  PASS: ${label}`);
    } else {
        failures++;
        console.error(`  FAIL: ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
    }
}
function section(name: string): void {
    console.log(`\n${name}`);
}

const NOW = 1_780_000_000_000;

// ── Drawdown breaker ──────────────────────────────────────────────────────
section("drawdown breaker");
const limits = { maxDrawdownPercent: 10, warningFraction: 0.75 };
let breaker = createDrawdownBreaker(10_000, NOW);

const normal = evaluateDrawdownBreaker(breaker, limits, { equity: 9_500, now: NOW + 1 });
check(!normal.blocked && normal.record.state === "NORMAL", "5% drawdown stays NORMAL", normal);
breaker = normal.record;

const warning = evaluateDrawdownBreaker(breaker, limits, { equity: 9_200, now: NOW + 2 });
check(!warning.blocked && warning.record.state === "WARNING", "8% drawdown enters WARNING");
breaker = warning.record;

const tripped = evaluateDrawdownBreaker(breaker, limits, { equity: 8_900, now: NOW + 3 });
check(tripped.blocked && tripped.record.state === "TRIPPED", "11% drawdown trips the breaker");
breaker = tripped.record;
check(breaker.history.length === 2, "every transition is recorded", breaker.history);

const recovered = evaluateDrawdownBreaker(breaker, limits, { equity: 10_500, now: NOW + 4 });
check(recovered.blocked && recovered.record.state === "TRIPPED", "recovered equity does NOT clear a latched trip");

const resetWrong = resetDrawdownBreaker(breaker, { by: "ops", reason: "test", confirmation: "reset", now: NOW + 5 });
check(resetWrong.ok === false && resetWrong.code === "BAD_CONFIRMATION", "wrong reset phrase is rejected");
const resetNoActor = resetDrawdownBreaker(breaker, { by: " ", reason: "test", confirmation: BREAKER_RESET_PHRASE, now: NOW + 5 });
check(resetNoActor.ok === false && resetNoActor.code === "MISSING_ACTOR", "reset without an operator is rejected");
const resetNoReason = resetDrawdownBreaker(breaker, { by: "ops", reason: "", confirmation: BREAKER_RESET_PHRASE, now: NOW + 5 });
check(resetNoReason.ok === false && resetNoReason.code === "MISSING_REASON", "reset without a reason is rejected");
const resetOk = resetDrawdownBreaker(breaker, { by: "ops", reason: "post-mortem complete", confirmation: BREAKER_RESET_PHRASE, now: NOW + 6 });
check(resetOk.ok === true && resetOk.record.state === "NORMAL", "exact phrase + actor + reason resets");
if (resetOk.ok) {
    check(resetOk.record.resetBy === "ops" && resetOk.record.history.length === breaker.history.length + 1, "reset is audited");
}
const resetNotTripped = resetDrawdownBreaker(createDrawdownBreaker(10_000, NOW), { by: "ops", reason: "x", confirmation: BREAKER_RESET_PHRASE, now: NOW });
check(resetNotTripped.ok === false && resetNotTripped.code === "NOT_TRIPPED", "resetting a healthy breaker is rejected");

const unknown = evaluateDrawdownBreaker(createDrawdownBreaker(10_000, NOW), limits, { now: NOW + 1 });
check(unknown.blocked && unknown.code === "STATE_UNKNOWN", "unknown drawdown state fails closed when a limit is configured");
const noLimit = evaluateDrawdownBreaker(createDrawdownBreaker(0, NOW), { maxDrawdownPercent: 0 }, { now: NOW + 1 });
check(!noLimit.blocked, "no configured limit → breaker cannot trip");

// ── Risk engine: breaker + notional budget ────────────────────────────────
section("risk engine budgets");
const entry: OrderIntent = { symbol: "XAUUSD", direction: "BUY", entryKind: "MARKET", price: 4000, volume: 0.5, sl: 3950, tp: 4050 };
const baseLimits: RiskLimits = { minLot: 0.01, lotStep: 0.01, maxLot: 10 };

const latchedState: AccountRiskState = { drawdownBreakerActive: true };
const latched = evaluateOrder(entry, baseLimits, latchedState, NOW);
check(latched.code === "DRAWDOWN_BREAKER_ACTIVE", "latched breaker blocks new entries", latched);
check(
    evaluateOrder({ ...entry, protective: true }, baseLimits, latchedState, NOW).approved,
    "latched breaker never blocks protective actions",
);

const eurusd: OrderIntent = { symbol: "EURUSD", direction: "BUY", entryKind: "LIMIT", price: 1.08, volume: 1, sl: 1.07, tp: 1.09 };
check(Math.abs((orderNotional(eurusd, 1) ?? 0) - 108_000) < 1e-6, "notional = volume × contractSize × price", orderNotional(eurusd, 1));
check(orderNotional({ ...entry, price: 0 }, 0.5) === undefined, "market order without a reference price has no notional");

const budget: RiskLimits = { ...baseLimits, maxDailyNotional: 100_000 };
check(
    evaluateOrder(eurusd, budget, { dailyNotionalUsed: 50_000 }, NOW).code === "DAILY_NOTIONAL_BUDGET",
    "order that would exceed the daily notional budget is rejected",
);
check(
    evaluateOrder({ ...eurusd, volume: 0.1 }, budget, { dailyNotionalUsed: 50_000 }, NOW).approved,
    "order within the budget is approved",
);
check(
    evaluateOrder(eurusd, budget, {}, NOW).approved,
    "unknown notional usage passes through honestly (never treated as zero)",
);
check(
    evaluateOrder({ ...entry, price: 0 }, budget, { dailyNotionalUsed: 99_999 }, NOW).approved,
    "unknown order notional cannot be checked and is not fabricated",
);

// ── Order fingerprints ────────────────────────────────────────────────────
section("order fingerprints");
const order = { symbol: "xauusd", side: "BUY" as const, kind: "LIMIT" as const, volume: 0.5, price: 4000.1, stopLoss: 3950, takeProfit: 4050 };
const idA = computeOrderIdentity("tenant-a", "acct-1", order);
const idA2 = computeOrderIdentity("tenant-a", "acct-1", { ...order, symbol: "XAUUSD", volume: 0.5000000001, price: 4000.1000000001 });
check(idA.fingerprint === idA2.fingerprint, "float noise and symbol casing do not change the fingerprint");
check(idA.fingerprint !== computeOrderIdentity("tenant-a", "acct-1", { ...order, volume: 0.51 }).fingerprint, "different volume → different fingerprint");
check(idA.fingerprint !== computeOrderIdentity("tenant-a", "acct-2", order).fingerprint, "different account → different fingerprint");
check(idA.fingerprint !== computeOrderIdentity("tenant-b", "acct-1", order).fingerprint, "different tenant → different fingerprint");
check(idA.fingerprint !== computeOrderIdentity("tenant-a", "acct-1", { ...order, takeProfit: 4060 }).fingerprint, "different target → different fingerprint");
check(
    computeOrderIdentity("tenant-a", "acct-1", { symbol: "XAUUSD", side: "BUY", kind: "MARKET", volume: 0.5, price: 3999 }).canonical ===
        computeOrderIdentity("tenant-a", "acct-1", { symbol: "XAUUSD", side: "BUY", kind: "MARKET", volume: 0.5 }).canonical,
    "MARKET orders ignore a transient reference price",
);
let threw = false;
try {
    fingerprintScope("tenant-a", " ");
} catch {
    threw = true;
}
check(threw, "empty account scope is rejected, never merged with another tenant");

const guard = new OrderFingerprintGuard({ windowMs: 1_000 });
check(guard.claim(idA.scope, idA.fingerprint, NOW).accepted === true, "first claim accepted");
check(guard.claim(idA.scope, idA.fingerprint, NOW + 500).accepted === false, "duplicate inside the window rejected");
check(guard.claim(idA.scope, idA.fingerprint, NOW + 1_500).accepted === true, "same order after the window is allowed");
check(guard.claim(fingerprintScope("tenant-b", "acct-1"), idA.fingerprint, NOW + 1_600).accepted === true, "another tenant is unaffected");
const scopedGuard = new OrderFingerprintGuard({ windowMs: 1_000 });
scopedGuard.claim(idA.scope, idA.fingerprint, NOW);
scopedGuard.release(idA.scope, idA.fingerprint);
check(scopedGuard.claim(idA.scope, idA.fingerprint, NOW + 1).accepted === true, "released claim allows a legitimate retry");

// ── Typed confirmation ────────────────────────────────────────────────────
section("typed confirmation");
check(typedConfirmationPhrase({ symbol: "XAUUSD", side: "BUY", kind: "MARKET", volume: 0.5 }) === "BUY 0.50 XAUUSD", "phrase derived from the order");
check(
    typedConfirmationPhrase({ symbol: "XAUUSD", side: "SELL", kind: "LIMIT", volume: 0.25, price: 4010.5 }) === "SELL 0.25 XAUUSD @ 4010.5",
    "limit order phrase includes the price",
);
check(verifyTypedConfirmation({ symbol: "XAUUSD", side: "BUY", kind: "MARKET", volume: 0.5 }, "  buy   0.50   xauusd "), "case/whitespace normalisation");
check(!verifyTypedConfirmation({ symbol: "XAUUSD", side: "BUY", kind: "MARKET", volume: 0.5 }, "BUY 0.51 XAUUSD"), "different volume fails");
check(!verifyTypedConfirmation({ symbol: "XAUUSD", side: "BUY", kind: "MARKET", volume: 0.5 }, ""), "empty confirmation fails");

const riskOk = { approved: true, code: "APPROVED" };
const authBase = {
    tenantId: "tenant-a",
    accountId: "acct-1",
    order: { symbol: "XAUUSD", side: "BUY" as const, kind: "MARKET" as const, volume: 0.5 },
    risk: riskOk,
    now: NOW,
};
check(authorizeExecution({ ...authBase, tenantId: "" }).code === "MISSING_SCOPE", "missing tenant denies execution");
check(
    authorizeExecution({ ...authBase, policy: { allowed: false, code: "MODE_DENIED", reason: "nope" } }).code === "POLICY_DENIED",
    "policy denial propagates",
);
check(
    authorizeExecution({ ...authBase, risk: { approved: false, code: "MAX_DRAWDOWN", reason: "dd" } }).code === "RISK_REJECTED",
    "risk rejection propagates",
);
check(
    authorizeExecution({ ...authBase, requireTypedConfirmation: true }).code === "CONFIRMATION_REQUIRED",
    "missing typed confirmation denies",
);
check(
    authorizeExecution({ ...authBase, requireTypedConfirmation: true, typedConfirmation: "BUY 0.5 XAUUSD" }).code === "CONFIRMATION_REQUIRED",
    "near-miss phrase is not accepted",
);
const authorized = authorizeExecution({ ...authBase, requireTypedConfirmation: true, typedConfirmation: "BUY 0.50 XAUUSD" });
check(authorized.allowed && authorized.code === "AUTHORIZED" && authorized.confirmationVerified, "exact phrase authorizes");
check(authorized.audit.aiAuthorization === false, "authorization is explicitly not AI-based");
check(/^[0-9a-f]{16}$/.test(authorized.fingerprint ?? ""), "authorization carries a 64-bit fingerprint", authorized.fingerprint);

const guard2 = new OrderFingerprintGuard({ windowMs: 1_000 });
const first = authorizeExecution({ ...authBase, guard: guard2 });
const second = authorizeExecution({ ...authBase, guard: guard2, now: NOW + 100 });
check(first.allowed && second.code === "DUPLICATE_ORDER", "duplicate authorization blocked by the fingerprint guard");
check(second.audit.duplicateChecked === true, "duplicate check is recorded in the audit");

// ── Trade permissions ─────────────────────────────────────────────────────
section("trade permissions");
const policyState = (mode: "ask" | "assist" | "engineer" | "autonomous", overrides: ReadonlySet<AgentPermission> = new Set<AgentPermission>()) => ({
    mode,
    rootVerified: true,
    grantedConfirmations: new Set<string>(),
    permissionOverrides: overrides,
});

const engineerDenied = evaluatePolicy({
    toolId: "trade.authorize",
    declaration: TRADE_TOOL_DECLARATIONS["trade.authorize"],
    state: policyState("engineer"),
    args: {},
});
check(engineerDenied.allowed === false && engineerDenied.code === "mode_lacks_permission", "engineer mode cannot authorize trades without an explicit override");

const overridden = evaluatePolicy({
    toolId: "trade.authorize",
    declaration: TRADE_TOOL_DECLARATIONS["trade.authorize"],
    state: policyState("engineer", new Set<AgentPermission>(["trade_execute_demo"])),
    args: { typedConfirmation: "BUY 0.50 XAUUSD" },
});
check(overridden.allowed === true && overridden.needsConfirmation === true, "explicit override still requires confirmation", overridden);
if (overridden.allowed) {
    const code = "confirmCode" in overridden ? overridden.confirmCode : undefined;
    check(code === "trade.authorize:BUY 0.50 XAUUSD", "confirmation token binds to the typed phrase", code);
}

const live = evaluatePolicy({
    toolId: "trade.authorize",
    declaration: { requires: ["trade_execute_live"], requiresConfirmation: false, category: "context", mutating: false },
    state: policyState("autonomous", new Set<AgentPermission>(["trade_execute_live"])),
    args: {},
});
check(live.allowed === false && live.code === "structurally_blocked", "live execution is structurally blocked in every mode");
check(STRUCTURALLY_BLOCKED.includes("trade_execute_live"), "live execution permission is on the structural block list");

const disabled = evaluatePolicy({
    toolId: "trade.authorize",
    declaration: { ...TRADE_TOOL_DECLARATIONS["trade.authorize"], disabled: true },
    state: policyState("autonomous", new Set<AgentPermission>(["trade_execute_demo"])),
    args: {},
});
check(disabled.allowed === false && disabled.code === "tool_disabled", "disabled declaration denies before permissions are considered");

console.log(`\n${failures === 0 ? "🎉 ALL EXECUTION-SAFETY TESTS PASSED" : `❌ ${failures} EXECUTION-SAFETY TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
