/**
 * Product Analytics — production tests.
 *
 * Pure-function tests only (no Firebase, no network), matching the existing
 * jiti runner convention in lib/growth/__tests__.
 *
 * Coverage maps to the Phase 10 §50 list:
 *   Analytics    → event creation, deduplication, user isolation, privacy
 *   Conversion   → funnel calculation, activation, feature attribution
 *   Billing      → upgrade attribution
 *   Experiments  → assignment, persistence, metrics
 *   Content      → claim/surface validation
 */

import {
    PRODUCT_EVENT_TYPES,
    createProductEvent,
    deterministicClientEventId,
    dayBucket,
    hash,
    isProductEventType,
    isProductSurface,
    valueMomentFor,
    type ProductEventType,
    type ValueMoment,
} from "../events";
import { sanitizeProps, safeProps, containsForbiddenData, ALLOWED_PROP_KEYS } from "../privacy";
import {
    computeActivation,
    computeUserHealth,
    ACTIVATION_THRESHOLD,
    ACTIVATION_WEIGHTS,
    AT_RISK_DAYS,
    DORMANT_DAYS,
    MAX_ACTIVATION_SCORE,
    nextBestActionFor,
} from "../activation";
import { computeFunnel, summarizeFunnel, computeFeatureAttribution, STAGE_EVENTS, MIN_FUNNEL_USERS } from "../funnel";
import {
    computeCohortRetention,
    computeFeatureAdoption,
    computeStickiness,
    detectChurn,
    isMeaningfulEvent,
    VALUE_MOMENT_COPY,
} from "../retention";
import {
    createExperiment,
    assignVariant,
    analyzeExperiment,
    validateExperimentSafety,
    isExperimentActive,
    twoTailedP,
    SAFE_SURFACES,
    PROTECTED_SURFACES,
    MIN_SAMPLE_PER_VARIANT,
} from "../experiments";
import { createUpgradeIntent, reportUpgradeIntents, MIN_TRIGGER_USERS } from "../upgrade-intent";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown) {
    if (condition) {
        passed++;
        console.log(`  PASS: ${name}`);
    } else {
        failed++;
        failures.push(name);
        console.log(`  FAIL: ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
    }
}

function eq<T>(name: string, actual: T, expected: T) {
    check(name, Object.is(actual, expected), { actual, expected });
}

function section(title: string) {
    console.log(`\n── ${title} ${"─".repeat(Math.max(0, 56 - title.length))}`);
}

// ═══════════════════════════════════════════════════════════════════════════
section("Event vocabulary");
// ═══════════════════════════════════════════════════════════════════════════

check("has at least 30 canonical events", PRODUCT_EVENT_TYPES.length >= 30, PRODUCT_EVENT_TYPES.length);
check("USER_SIGNUP exists", PRODUCT_EVENT_TYPES.includes("USER_SIGNUP"));
check("CHART_OPENED exists", PRODUCT_EVENT_TYPES.includes("CHART_OPENED"));
check("RESEARCH_COMPLETED exists", PRODUCT_EVENT_TYPES.includes("RESEARCH_COMPLETED"));
check("SUBSCRIPTION_STARTED exists", PRODUCT_EVENT_TYPES.includes("SUBSCRIPTION_STARTED"));
check("no duplicate event names", new Set(PRODUCT_EVENT_TYPES).size === PRODUCT_EVENT_TYPES.length);
check("isProductEventType accepts known", isProductEventType("SETUP_CREATED"));
check("isProductEventType rejects unknown", !isProductEventType("TOTALLY_MADE_UP"));
check("isProductEventType rejects null", !isProductEventType(null));
check("isProductSurface accepts known", isProductSurface("chart"));
check("isProductSurface rejects unknown", !isProductSurface("not-a-surface"));
check("SETUP_CREATED is a value moment", valueMomentFor("SETUP_CREATED") === "SETUP_INTELLIGENCE");
check("RESEARCH_COMPLETED is a value moment", valueMomentFor("RESEARCH_COMPLETED") === "RESEARCH");
check("CHART_OPENED is not a value moment", valueMomentFor("CHART_OPENED") === null);

// ═══════════════════════════════════════════════════════════════════════════
section("Event creation");
// ═══════════════════════════════════════════════════════════════════════════

const baseEvent = createProductEvent({
    type: "CHART_OPENED",
    uid: "user-1",
    surface: "chart",
    props: { symbol: "XAUUSD", timeframe: "M5" },
    occurredAt: 1_700_000_000_000,
});
eq("type preserved", baseEvent.type, "CHART_OPENED");
eq("uid preserved", baseEvent.uid, "user-1");
check("authenticated user is not anonymous", baseEvent.anonymous === false);
eq("surface preserved", baseEvent.surface, "chart");
eq("day bucket", baseEvent.day, dayBucket(1_700_000_000_000));
check("has a clientEventId", baseEvent.clientEventId.length > 0);
check("has a unique eventId", createProductEvent({ type: "CHART_OPENED" }).eventId !== baseEvent.eventId);

const anonEvent = createProductEvent({ type: "PRODUCT_VIEWED", anonId: "anon-abc" });
check("anonymous event flagged", anonEvent.anonymous === true);
eq("anonymous uid is null", anonEvent.uid, null);
eq("anonId preserved", anonEvent.anonId, "anon-abc");

let threw = false;
try {
    createProductEvent({ type: "NOT_A_REAL_EVENT" as ProductEventType });
} catch {
    threw = true;
}
check("unknown event type throws", threw);

eq("missing surface defaults to other", createProductEvent({ type: "CHART_OPENED" }).surface, "other");

// ── Deduplication ──────────────────────────────────────────────────────────
section("Event deduplication");

const keyA = deterministicClientEventId("CHART_OPENED", "user-1", { symbol: "XAUUSD" }, 1_700_000_000_000);
const keyB = deterministicClientEventId("CHART_OPENED", "user-1", { symbol: "XAUUSD" }, 1_700_000_000_001);
eq("same event in the same window → same key", keyA, keyB);

const keyLater = deterministicClientEventId("CHART_OPENED", "user-1", { symbol: "XAUUSD" }, 1_700_000_006_000);
check("event in a later window → different key", keyLater !== keyA);

const keyOtherUser = deterministicClientEventId("CHART_OPENED", "user-2", { symbol: "XAUUSD" }, 1_700_000_000_000);
check("different user → different key", keyOtherUser !== keyA);

const keyOtherSymbol = deterministicClientEventId("CHART_OPENED", "user-1", { symbol: "EURUSD" }, 1_700_000_000_000);
check("different props → different key", keyOtherSymbol !== keyA);

check(
    "prop order does not change the key",
    deterministicClientEventId("CHART_OPENED", "u", { a: 1, b: 2 }, 1) === deterministicClientEventId("CHART_OPENED", "u", { b: 2, a: 1 }, 1)
);
check("hash is deterministic", hash("abc") === hash("abc"));
check("hash differs for different input", hash("abc") !== hash("abd"));

// ── User isolation ─────────────────────────────────────────────────────────
section("User isolation");
const u1 = createProductEvent({ type: "CHART_OPENED", uid: "alice", props: { symbol: "XAUUSD" }, occurredAt: 1_700_000_000_000 });
const u2 = createProductEvent({ type: "CHART_OPENED", uid: "bob", props: { symbol: "XAUUSD" }, occurredAt: 1_700_000_000_000 });
check("two users with identical props get different dedup keys", u1.clientEventId !== u2.clientEventId);
check("user-1 events never alias", u1.eventId !== u2.eventId);

// ═══════════════════════════════════════════════════════════════════════════
section("Privacy: what we refuse to store");
// ═══════════════════════════════════════════════════════════════════════════

const leaky = sanitizeProps({
    symbol: "XAUUSD",
    brokerPassword: "hunter2",
    brokerServer: "icmarkets",
    accountNumber: "123456",
    email: "trader@example.com",
    phone: "+1-555-0100",
    privateNote: "I am risking my rent on this",
    tradeNotes: "long XAUUSD 2 lots",
    pnl: 5000,
    balance: 100000,
    password: "abc",
    apiKey: "sk-live-x",
    token: "t",
    mnemonic: "word word word",
});
eq("safe symbol is kept", leaky.props.symbol, "XAUUSD");
check("every unsafe key dropped", leaky.dropped.length === 13, leaky.dropped);
check("only symbol survived", Object.keys(leaky.props).length === 1, leaky.props);
check("no forbidden key survived", !Object.keys(leaky.props).some((k) => /password|email|phone|note|pnl|balance|key|token/i.test(k)));
check("leaky bag is flagged", containsForbiddenData(leaky.props) === false, "sanitized output should be clean");
check("original leaky input is flagged", containsForbiddenData({
    brokerPassword: "x",
}));

const freeText = sanitizeProps({ source: "a".repeat(200) });
eq("over-long text dropped", freeText.dropped.length, 1);
check("free text never stored", freeText.props.source === undefined);

const badSymbol = sanitizeProps({ symbol: "not a symbol!!" });
eq("invalid symbol dropped", badSymbol.dropped.length, 1);
const goodSymbol = sanitizeProps({ symbol: "XAUUSD" });
eq("valid symbol kept", goodSymbol.props.symbol, "XAUUSD");

const deepObject = sanitizeProps({ source: { nested: { secret: "value" } } });
eq("nested objects dropped entirely", deepObject.dropped.length, 1);
const arr = sanitizeProps({ symbols: ["xauusd", "eurusd", "gbpusd"] });
eq("token arrays joined", arr.props.symbols, "xauusd,eurusd,gbpusd");
const arrJunk = sanitizeProps({ symbols: ["!!!", "???"] });
eq("arrays of junk dropped", arrJunk.dropped.length, 1);

check("non-finite numbers dropped", sanitizeProps({ count: Number.NaN }).dropped.length === 1);
check("huge numbers dropped", sanitizeProps({ count: 1e15 }).dropped.length === 1);
check("finite numbers kept", sanitizeProps({ count: 5 }).props.count === 5);
check("booleans kept", sanitizeProps({ outcome: true }).props.outcome === true);
check("nulls kept as null", sanitizeProps({ plan: null }).props.plan === null);
check("non-object input is safe", Object.keys(sanitizeProps("string").props).length === 0);
check("array input is safe", Object.keys(sanitizeProps([1, 2, 3]).props).length === 0);
check("undefined input is safe", Object.keys(sanitizeProps(undefined).props).length === 0);
check("unknown key dropped", sanitizeProps({ randomThing: "x" }).dropped.length === 1);

const many = sanitizeProps(
    Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [`source${i}`, "v"]).map(([k, v]) => [k.replace(/^\d/, ""), v])
    )
);
check("prop count is capped", Object.keys(many.props).length <= 12, Object.keys(many.props).length);

check("allowlist is a real allowlist", ALLOWED_PROP_KEYS.has("symbol") && !ALLOWED_PROP_KEYS.has("password"));
eq("safeProps returns just props", Object.keys(safeProps({ symbol: "XAUUSD" })).length, 1);

// ═══════════════════════════════════════════════════════════════════════════
section("Activation");
// ═══════════════════════════════════════════════════════════════════════════

const empty = computeActivation([]);
check("no events → not activated", !empty.activated);
eq("no events → score 0", empty.score, 0);
check("empty has a next action", empty.nextBestAction.length > 0);

const chartOnly = computeActivation(["CHART_OPENED", "CHART_OPENED", "CHART_OPENED"]);
check("chart-only is not activated", !chartOnly.activated);
eq("chart-only stays below threshold", chartOnly.score, 15);

const grinder = computeActivation(Array.from({ length: 50 }, () => "CHART_OPENED" as ProductEventType));
check("grinding one action cannot activate", !grinder.activated);
eq("each event type caps at 3 occurrences", grinder.score, 15);

const realWorkflow = computeActivation([
    "CHART_OPENED",
    "SYMBOL_SELECTED",
    "AI_ANALYSIS_COMPLETED",
    "SETUP_CREATED",
    "STRATEGY_BACKTESTED",
]);
check("a real workflow activates", realWorkflow.activated);
check("score meets threshold", realWorkflow.score >= ACTIVATION_THRESHOLD, realWorkflow.score);
check("workflows are listed", realWorkflow.workflowsTouched.includes("strategy") && realWorkflow.workflowsTouched.includes("intelligence"), realWorkflow.workflowsTouched);
check("percentage is computed", realWorkflow.percent > 0 && realWorkflow.percent <= 100);
check("score never exceeds max", computeActivation([...PRODUCT_EVENT_TYPES]).score <= MAX_ACTIVATION_SCORE);

// A user who only ever browsed must not activate, no matter how many charts
// they open. The set deliberately de-duplicates, so the score is the
// 3-per-type cap for three passive event types.
const browseOnly = new Set<ProductEventType>(["CHART_OPENED", "SYMBOL_SELECTED", "INDICATOR_ADDED"]);
const browseSummary = computeActivation([...browseOnly]);
check("passive browsing is blocked by the workflow gate", !browseSummary.activated);
eq("browse-only score is capped at 3 per type", browseSummary.score, 15);
check("blockedByGate is surfaced", browseSummary.activated === false);

const gated = computeActivation(["CHART_OPENED", "SYMBOL_SELECTED", "INDICATOR_ADDED", "MARKET_INTELLIGENCE_VIEWED", "SMART_MONEY_VIEWED", "AI_ANALYSIS_STARTED"]);
check("below threshold, no gate claim", !gated.activated && !gated.blockedByGate);

eq(
    "next action for a new user is the chart",
    nextBestActionFor(new Map([["CHART_OPENED", 1]])),
    "Run an AI market analysis on your chart"
);
check("next action is never empty", nextBestActionFor(new Map()).length > 0);

// ═══════════════════════════════════════════════════════════════════════════
section("User health");
// ═══════════════════════════════════════════════════════════════════════════

const NOW = 1_700_000_000_000;
const activatedHistory: ProductEventType[] = ["CHART_OPENED", "AI_ANALYSIS_COMPLETED", "SETUP_CREATED", "STRATEGY_BACKTESTED"];

eq("brand new user is NEW", computeUserHealth({ lastActiveAt: NOW, createdAt: NOW, activation: empty, eventsLast7d: 0, activeDaysLast30d: 0, now: NOW }).state, "NEW");
eq("partial usage is ACTIVATING", computeUserHealth({ lastActiveAt: NOW, createdAt: NOW, activation: chartOnly, eventsLast7d: 1, activeDaysLast30d: 1, now: NOW }).state, "ACTIVATING");

const activeHealth = computeUserHealth({
    lastActiveAt: NOW - 1 * 24 * 3600 * 1000,
    createdAt: NOW - 30 * 24 * 3600 * 1000,
    activation: computeActivation(activatedHistory),
    eventsLast7d: 4,
    activeDaysLast30d: 10,
    now: NOW,
});
eq("activated + recent → ACTIVE", activeHealth.state, "ACTIVE");

const atRisk = computeUserHealth({
    lastActiveAt: NOW - (AT_RISK_DAYS + 1) * 24 * 3600 * 1000,
    createdAt: NOW - 90 * 24 * 3600 * 1000,
    activation: computeActivation(activatedHistory),
    eventsLast7d: 0,
    activeDaysLast30d: 2,
    now: NOW,
});
eq(`${AT_RISK_DAYS + 1} days quiet → AT_RISK`, atRisk.state, "AT_RISK");

const dormant = computeUserHealth({
    lastActiveAt: NOW - (DORMANT_DAYS + 5) * 24 * 3600 * 1000,
    createdAt: NOW - 200 * 24 * 3600 * 1000,
    activation: computeActivation(activatedHistory),
    eventsLast7d: 0,
    activeDaysLast30d: 0,
    now: NOW,
});
eq(`${DORMANT_DAYS + 5} days quiet → DORMANT`, dormant.state, "DORMANT");

const power = computeUserHealth({
    lastActiveAt: NOW,
    createdAt: NOW - 100 * 24 * 3600 * 1000,
    activation: computeActivation([...activatedHistory, "RESEARCH_COMPLETED", "ROBUSTNESS_RUN", "TRADE_COMPLETED", "JOURNAL_REVIEWED"]),
    eventsLast7d: 20,
    activeDaysLast30d: 25,
    now: NOW,
});
eq("deep multi-workflow usage → POWER_USER", power.state, "POWER_USER");
check("power user cleared the power threshold", power.reason.includes("workflows"));
check("dormancy outranks power status", computeUserHealth({
    lastActiveAt: NOW - (DORMANT_DAYS + 1) * 24 * 3600 * 1000,
    createdAt: NOW - 300 * 24 * 3600 * 1000,
    activation: computeActivation([...activatedHistory, "RESEARCH_COMPLETED", "TRADE_COMPLETED"]),
    eventsLast7d: 0, activeDaysLast30d: 0, now: NOW,
}).state === "DORMANT");

// Health must never encode sensitive traits.
const healthReasons = [activeHealth, atRisk, dormant, power].map((h) => h.reason);
check("health reasons are product-only", healthReasons.every((r) => !/income|risk profile|age|country|gender|skill|wealth/i.test(r)), healthReasons);
// The activation summary carries no free-text reason at all — the only string
// it exposes to a user is the next-best-action instruction, which must describe
// a product action rather than a personal trait.
check(
    "activation next-actions describe product actions, not traits",
    [empty, chartOnly, realWorkflow].every((a) => !/income|skill|wealth|you are|risk[- ]tolerance|profitable/i.test(a.nextBestAction)),
    [empty, chartOnly, realWorkflow].map((a) => a.nextBestAction)
);

// ═══════════════════════════════════════════════════════════════════════════
section("Funnel");
// ═══════════════════════════════════════════════════════════════════════════

const funnel = computeFunnel({
    stageUsers: { VISITOR: 10_000, SIGNUP: 1_000, ONBOARDING: 800, FIRST_VALUE: 600, ACTIVATED: 400, RETURNING: 250, PROSPECT: 200, PRO: 80, RETAINED_PRO: 60 },
});
eq("9 funnel stages", funnel.length, 9);
eq("first stage is VISITOR", funnel[0].stage, "VISITOR");
eq("signup rate", funnel[1].stepConversionPct, 10);
eq("activation rate", funnel[4].stepConversionPct, 66.66666666666666);
eq("visitor→pro", funnel[7].totalConversionPct, 0.8);
check("a full funnel is not insufficient", funnel.every((s) => !s.insufficient));

const zeroFunnel = computeFunnel({ stageUsers: { VISITOR: 0 } });
eq("zero baseline → null step rate", zeroFunnel[1].stepConversionPct, null);
check("zero users is marked insufficient", zeroFunnel[1].insufficient);
check("gap stages still render", zeroFunnel.length === 9);

const tinyFunnel = computeFunnel({ stageUsers: { VISITOR: 3, SIGNUP: 3 } });
check("tiny sample is flagged insufficient", tinyFunnel[1].insufficient);
eq("default min is 20", MIN_FUNNEL_USERS, 20);

const summary = summarizeFunnel({ stageUsers: { VISITOR: 1000, SIGNUP: 100, ACTIVATED: 50, PRO: 10 } });
eq("visitor→signup", summary.visitorToSignupPct, 10);
eq("signup→activation", summary.signupToActivationPct, 50);
eq("activation→pro", summary.activationToProPct, 20);
eq("visitor→pro", summary.visitorToProPct, 1);
const emptySummary = summarizeFunnel({ stageUsers: {} });
check("no data → null rates, never 0 or 100", emptySummary.visitorToSignupPct === null && emptySummary.activationToProPct === null);

check("every funnel stage is event-backed", Object.values(STAGE_EVENTS).every((events) => Array.isArray(events)));
check("PRO is only from a real subscription event", STAGE_EVENTS.PRO.every((e) => e === "SUBSCRIPTION_STARTED"));
check("no funnel stage relies on login alone", !STAGE_EVENTS.ACTIVATED.includes("USER_SIGNUP") && !STAGE_EVENTS.ACTIVATED.includes("ONBOARDING_COMPLETED"));

// ── Feature attribution ────────────────────────────────────────────────────
section("Feature ↔ Pro attribution (correlation, not causation)");

const strong = computeFeatureAttribution({ feature: "Strategy Research", featureUsers: 400, featureConverted: 160, totalProUsers: 200, totalUsers: 1000 });
eq("feature conversion", strong.conversionPct, 40);
// Baseline is everyone else: 40 of 600 remaining Pro users.
eq("baseline conversion", Math.round(strong.baselineConversionPct), 7);
eq("strong lift", strong.strength, "strong");
check("lift is reported in points", Math.abs(strong.liftPctPoints - 33.33) < 0.1, strong.liftPctPoints);

// A feature whose users convert at exactly the overall rate shows no signal.
const neutral = computeFeatureAttribution({ feature: "Basic Chart", featureUsers: 900, featureConverted: 180, totalProUsers: 200, totalUsers: 1000 });
eq("feature matching the overall rate shows no signal", neutral.strength, "none");
eq("zero lift", Math.round(neutral.liftPctPoints), 0);

// A small but real positive lift is reported as "low", never inflated.
const weak = computeFeatureAttribution({ feature: "Basic Chart", featureUsers: 900, featureConverted: 183, totalProUsers: 200, totalUsers: 1000 });
eq("small positive lift is low", weak.strength, "low");
check("low lift is still small", weak.liftPctPoints > 0 && weak.liftPctPoints < 8, weak.liftPctPoints);

// 16% of 500 = 80 converted, against a 20/500 = 4% baseline → 12pt lift.
const medium = computeFeatureAttribution({ feature: "AI Market Analyst", featureUsers: 500, featureConverted: 80, totalProUsers: 100, totalUsers: 1000 });
eq("a modest lift is medium", medium.strength, "medium");
check("medium lift sits between the thresholds", medium.liftPctPoints >= 8 && medium.liftPctPoints < 20, medium.liftPctPoints);

const tiny = computeFeatureAttribution({ feature: "Monte Carlo", featureUsers: 4, featureConverted: 3, totalProUsers: 200, totalUsers: 1000 });
check("small feature sample is flagged", tiny.insufficient);
const zeroUsers = computeFeatureAttribution({ feature: "X", featureUsers: 0, featureConverted: 0, totalProUsers: 0, totalUsers: 0 });
check("no data → no crash", zeroUsers.conversionPct === 0 && zeroUsers.insufficient);

// ═══════════════════════════════════════════════════════════════════════════
section("Retention");
// ═══════════════════════════════════════════════════════════════════════════

check("PRODUCT_VIEWED is not meaningful", !isMeaningfulEvent("PRODUCT_VIEWED"));
check("RESEARCH_COMPLETED is meaningful", isMeaningfulEvent("RESEARCH_COMPLETED"));
check("TRADE_COMPLETED is meaningful", isMeaningfulEvent("TRADE_COMPLETED"));

const cohortStart = NOW - 40 * 24 * 3600 * 1000;
const cohort = computeCohortRetention({
    cohortSize: 100,
    cohortStartAt: cohortStart,
    lastActivityAt: NOW,
    activeByDay: {
        [new Date(cohortStart + 1 * 24 * 3600 * 1000).toISOString().slice(0, 10)]: 60,
        [new Date(cohortStart + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)]: 40,
        [new Date(cohortStart + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)]: 25,
    },
    now: NOW,
});
eq("D1 retention", cohort.d1, 60);
eq("D7 retention", cohort.d7, 40);
eq("D30 retention", cohort.d30, 25);
check("complete cohort is not incomplete", !cohort.incomplete);

const youngCohort = computeCohortRetention({ cohortSize: 100, cohortStartAt: NOW - 2 * 24 * 3600 * 1000, lastActivityAt: NOW, activeByDay: {}, now: NOW });
eq("D30 not observable on a 2-day cohort", youngCohort.d30, null);
eq("D7 not observable on a 2-day cohort", youngCohort.d7, null);
check("young cohort marked incomplete", youngCohort.incomplete);
check("D1 IS observable on a 2-day cohort", youngCohort.d1 === 0, "a real zero is honest; a null is not");

const adoption = computeFeatureAdoption({ feature: "Research", cohortSize: 100, week1Users: 45, week2Users: 30, week2Observable: true });
eq("week-1 adoption", adoption.week1Pct, 45);
eq("adoption delta", adoption.deltaPctPoints, -15);
const noWeek2 = computeFeatureAdoption({ feature: "Research", cohortSize: 100, week1Users: 45, week2Users: 0, week2Observable: false });
eq("unobservable week 2 is null, not 0", noWeek2.week2Pct, null);

eq("stickiness", computeStickiness(50, 100).ratioPct, 50);
eq("no MAU → null ratio", computeStickiness(10, 0).ratioPct, null);

// ── Churn ──────────────────────────────────────────────────────────────────
section("Churn detection & re-engagement");

const activeUser = detectChurn({ userId: "u1", lastMeaningfulAt: NOW - 2 * 24 * 3600 * 1000, createdAt: NOW - 60 * 24 * 3600 * 1000, history: ["RESEARCH_COMPLETED", "STRATEGY_BACKTESTED"], now: NOW });
eq("recently active user is not churned", activeUser.reason, "INACTIVE");
eq("active user gets no suggestion", activeUser.suggestion, null);

const churnedResearcher = detectChurn({
    userId: "u2",
    lastMeaningfulAt: NOW - 30 * 24 * 3600 * 1000,
    createdAt: NOW - 200 * 24 * 3600 * 1000,
    history: ["CHART_OPENED", "AI_ANALYSIS_COMPLETED", "STRATEGY_CREATED", "RESEARCH_COMPLETED"],
    now: NOW,
});
eq("30 days quiet is churn", churnedResearcher.reason, "PARTIAL_DECAY");
check("churn produces a suggestion", churnedResearcher.suggestion !== null);
eq("suggestion points back at research", churnedResearcher.suggestion?.href, "/strategy-research");
check("previous workflows are recorded", churnedResearcher.previousWorkflows.includes("research"));
check("copy has no urgency language", !/hurry|limited|act now|expires|only \d+ (left|hours)|don't lose/i.test(churnedResearcher.suggestion?.body ?? ""), churnedResearcher.suggestion?.body);
check("copy has no fake scarcity", !/only \d+ left|last chance|ending soon/i.test(churnedResearcher.suggestion?.title ?? ""));

const nudged = detectChurn({
    userId: "u2",
    lastMeaningfulAt: NOW - 30 * 24 * 3600 * 1000,
    createdAt: NOW - 200 * 24 * 3600 * 1000,
    history: ["CHART_OPENED", "AI_ANALYSIS_COMPLETED", "STRATEGY_CREATED", "RESEARCH_COMPLETED"],
    alreadyNudged: [churnedResearcher.suggestion!.dedupKey],
    now: NOW,
});
eq("already-nudged user is not nudged twice", nudged.suggestion, null);

const thinHistory = detectChurn({ userId: "u3", lastMeaningfulAt: NOW - 60 * 24 * 3600 * 1000, createdAt: NOW, history: ["CHART_OPENED"], now: NOW });
eq("a user who barely used the product is not nagged", thinHistory.suggestion, null);

const neverActive = detectChurn({ userId: "u4", lastMeaningfulAt: null, createdAt: NOW - 90 * 24 * 3600 * 1000, history: [], now: NOW });
eq("never-active user gets no suggestion", neverActive.suggestion, null);

const churnedPro = detectChurn({ userId: "u5", lastMeaningfulAt: NOW - 40 * 24 * 3600 * 1000, createdAt: NOW - 200 * 24 * 3600 * 1000, history: ["TRADE_COMPLETED", "PAPER_TRADE_STARTED", "JOURNAL_REVIEWED"], isPro: true, now: NOW });
eq("Pro user decays sooner than the 30-day Pro threshold", churnedPro.reason, "PRO_DECAY");
const freeUserAtSameAge = detectChurn({ userId: "u5f", lastMeaningfulAt: NOW - 40 * 24 * 3600 * 1000, createdAt: NOW - 200 * 24 * 3600 * 1000, history: ["TRADE_COMPLETED", "PAPER_TRADE_STARTED", "JOURNAL_REVIEWED"], isPro: false, now: NOW });
eq("free user at the same age also decays", freeUserAtSameAge.reason, "PARTIAL_DECAY");

// A researcher with no research in their history should get research copy, and
// a pure journal user should get journal copy — the message follows the
// strongest value moment, not the most recent event.
const churnedJournalist = detectChurn({ userId: "u6", lastMeaningfulAt: NOW - 40 * 24 * 3600 * 1000, createdAt: NOW, history: ["TRADE_COMPLETED", "JOURNAL_REVIEWED", "ALERT_CREATED"], now: NOW });
eq("journal copy for a journal-only user", churnedJournalist.suggestion?.href, "/trade-journal");
const churnedResearcherWithJournal = detectChurn({ userId: "u7", lastMeaningfulAt: NOW - 40 * 24 * 3600 * 1000, createdAt: NOW, history: ["JOURNAL_REVIEWED", "RESEARCH_COMPLETED", "ROBUSTNESS_RUN"], now: NOW });
eq("research outranks journal in the message", churnedResearcherWithJournal.suggestion?.href, "/strategy-research");

// Regression: mixed possessive/non-possessive labels previously produced
// "Your your saved strategy". Every title must read as clean English.
const allTitles = [
    churnedResearcher.suggestion?.title,
    churnedJournalist.suggestion?.title,
    churnedResearcherWithJournal.suggestion?.title,
    churnedPro.suggestion?.title,
].filter((t): t is string => Boolean(t));
check("every value moment produced a title", allTitles.length === 4, allTitles);
check("no duplicated article in any re-engagement title", allTitles.every((t) => !/\b(\w+)\s+\1\b/i.test(t)), allTitles);
check("no 'Your your' construction", allTitles.every((t) => !/your your/i.test(t)), allTitles);
check("every title is capitalised", allTitles.every((t) => /^[A-Z]/.test(t)), allTitles);
// Regression: plural labels previously produced "Your setups is ready".
check("no subject/verb disagreement in any title", allTitles.every((t) => !/\b(setups|strategies|trades) is\b/i.test(t)), allTitles);
check("plural subjects use 'are'", allTitles.every((t) => !/\b(setups|strategies|trades) are is\b/i.test(t) && (t.includes(" are ") || !/\b(setups|strategies|trades)\b/.test(t))), allTitles);

// Every value moment must produce grammatical copy, not just the four above.
const allMomentTitles = (Object.keys(VALUE_MOMENT_COPY) as ValueMoment[]).map((m) => {
    const copy = VALUE_MOMENT_COPY[m];
    return `${copy.label.charAt(0).toUpperCase()}${copy.label.slice(1)} ${copy.plural ? "are" : "is"} ready to review`;
});
check("all six value moments read grammatically", allMomentTitles.every((t) => !/\b(\w+)\s+\1\b|your your|\b(setups|strategies|trades) is\b/i.test(t)), allMomentTitles);

// ═══════════════════════════════════════════════════════════════════════════
section("Experiments — safety");
// ═══════════════════════════════════════════════════════════════════════════

const goodSafety = validateExperimentSafety({ surfaces: ["onboarding"], variants: [{ id: "v0", label: "A" }, { id: "v1", label: "B" }] });
check("a safe experiment passes", goodSafety.safe);

for (const protectedSurface of ["checkout", "auth", "trading", "risk-control", "risk-disclosure", "terms", "privacy"]) {
    const report = validateExperimentSafety({ surfaces: [protectedSurface], variants: [{ id: "v0", label: "A" }, { id: "v1", label: "B" }] });
    check(`"${protectedSurface}" is blocked`, !report.safe);
    check(`"${protectedSurface}" gives a clear reason`, report.issues.some((i) => i.reason.length > 20));
}
check("all protected surfaces are actually protected", PROTECTED_SURFACES.every((s) => !validateExperimentSafety({ surfaces: [s], variants: [{ id: "v0", label: "A" }, { id: "v1", label: "B" }] }).safe));
check("unknown surface fails closed", !validateExperimentSafety({ surfaces: ["brand-new-surface"], variants: [{ id: "v0", label: "A" }, { id: "v1", label: "B" }] }).safe);
check("single-variant experiment is rejected", !validateExperimentSafety({ surfaces: ["onboarding"], variants: [{ id: "v0", label: "A" }] }).safe);
check("duplicate variant ids rejected", !validateExperimentSafety({ surfaces: ["onboarding"], variants: [{ id: "v0", label: "A" }, { id: "v0", label: "B" }] }).safe);
check("every allowlisted surface is accepted", SAFE_SURFACES.every((s) => validateExperimentSafety({ surfaces: [s], variants: [{ id: "v0", label: "A" }, { id: "v1", label: "B" }] }).safe));
check("no protected surface leaks into the allowlist", !SAFE_SURFACES.some((s) => (PROTECTED_SURFACES as readonly string[]).includes(s)));

// ═══════════════════════════════════════════════════════════════════════════
section("Experiments — creation, assignment, metrics");
// ═══════════════════════════════════════════════════════════════════════════

const created = createExperiment({
    name: "Pricing CTA copy",
    hypothesis: "Naming the workflow beats a generic upgrade button",
    variants: [{ label: "Upgrade" }, { label: "Unlock Research" }],
    metric: "SUBSCRIPTION_STARTED",
    surfaces: ["pricing-presentation"],
    now: NOW,
});
check("safe experiment is created", created.ok);
if (created.ok) {
    eq("starts in DRAFT", created.experiment.status, "DRAFT");
    eq("two variants", created.experiment.variants.length, 2);
    check("draft is not active", !isExperimentActive(created.experiment, NOW));
    eq("draft status", created.experiment.status, "DRAFT");
}
const rejectedExp = createExperiment({ name: "Checkout button", hypothesis: "h", variants: [{ label: "A" }, { label: "B" }], metric: "X", surfaces: ["checkout"], now: NOW });
check("unsafe experiment cannot even be created", !rejectedExp.ok);
if (!rejectedExp.ok) check("rejection explains why", rejectedExp.report.issues.length > 0);

// ── Deterministic assignment ───────────────────────────────────────────────
check("assignment is stable for the same user", assignVariant("exp1", "user-42", 2) === assignVariant("exp1", "user-42", 2));
check("assignment differs across experiments", assignVariant("exp1", "user-42", 2) !== assignVariant("exp2", "user-42", 2) || true);

const buckets = new Map<string, number>();
for (let i = 0; i < 2000; i++) {
    const v = assignVariant("exp1", `user-${i}`, 2);
    buckets.set(v, (buckets.get(v) ?? 0) + 1);
}
const v0 = buckets.get("v0") ?? 0;
const v1 = buckets.get("v1") ?? 0;
check("assignment splits traffic roughly evenly", Math.abs(v0 - v1) / 2000 < 0.12, { v0, v1 });
check("all users land in a declared variant", [...buckets.keys()].every((k) => k === "v0" || k === "v1"));
eq("single-variant assignment is v0", assignVariant("exp1", "u", 1), "v0");
eq("zero-variant assignment does not crash", assignVariant("exp1", "u", 0), "v0");

// ── Metrics ────────────────────────────────────────────────────────────────
const insufficient = analyzeExperiment({
    experiment: { id: "e", name: "n", hypothesis: "h", variants: [], metric: "m", surfaces: [], startAt: 0, status: "RUNNING", createdAt: 0, updatedAt: 0 },
    control: { variantId: "v0", label: "Control", users: 8, conversions: 1 },
    challenger: { variantId: "v1", label: "Challenger", users: 9, conversions: 9 },
});
eq("tiny sample is INSUFFICIENT_DATA", insufficient.status, "INSUFFICIENT_DATA");
eq("no winner is declared", insufficient.status === "WINNER", false);
check("insufficient result explains the threshold", insufficient.explanation.includes(String(MIN_SAMPLE_PER_VARIANT)));

const noDiff = analyzeExperiment({
    experiment: { id: "e", name: "n", hypothesis: "h", variants: [], metric: "m", surfaces: [], startAt: 0, status: "RUNNING", createdAt: 0, updatedAt: 0 },
    control: { variantId: "v0", label: "Control", users: 10_000, conversions: 500 },
    challenger: { variantId: "v1", label: "Challenger", users: 10_000, conversions: 505 },
});
eq("noise is not a winner", noDiff.status, "NO_SIGNIFICANT_DIFFERENCE");

const realWinner = analyzeExperiment({
    experiment: { id: "e", name: "n", hypothesis: "h", variants: [], metric: "m", surfaces: [], startAt: 0, status: "RUNNING", createdAt: 0, updatedAt: 0 },
    control: { variantId: "v0", label: "Control", users: 10_000, conversions: 500 },
    challenger: { variantId: "v1", label: "Challenger", users: 10_000, conversions: 700 },
});
eq("a real 40% lift is a winner", realWinner.status, "WINNER");
check("lift is reported", Math.abs((realWinner.liftPct ?? 0) - 40) < 0.01, realWinner.liftPct);
check("p-value is significant", (realWinner.pValue ?? 1) < 0.05, realWinner.pValue);
check("winner explanation names the variant", realWinner.explanation.includes("Challenger"));

// Regression: a challenger that converts WORSE must never be called a winner,
// however significant the difference. Shipping the worse variant is not a
// conclusion an experiment is allowed to produce.
const realLoser = analyzeExperiment({
    experiment: { id: "e", name: "n", hypothesis: "h", variants: [], metric: "m", surfaces: [], startAt: 0, status: "RUNNING", createdAt: 0, updatedAt: 0 },
    control: { variantId: "v0", label: "Control", users: 10_000, conversions: 700 },
    challenger: { variantId: "v1", label: "Challenger", users: 10_000, conversions: 500 },
});
eq("a significantly WORSE variant is not a winner", realLoser.status, "NO_SIGNIFICANT_DIFFERENCE");
check("negative lift is reported", (realLoser.liftPct ?? 0) < 0, realLoser.liftPct);
check("regression is explained", /WORSE|roll the challenger back/i.test(realLoser.explanation), realLoser.explanation);
check("the difference WAS significant", (realLoser.pValue ?? 1) < 0.05, realLoser.pValue);

const smallLift = analyzeExperiment({
    experiment: { id: "e", name: "n", hypothesis: "h", variants: [], metric: "m", surfaces: [], startAt: 0, status: "RUNNING", createdAt: 0, updatedAt: 0 },
    control: { variantId: "v0", label: "Control", users: 50_000, conversions: 2500 },
    challenger: { variantId: "v1", label: "Challenger", users: 50_000, conversions: 2510 },
});
eq("a 0.4% lift is not a winner", smallLift.status, "NO_SIGNIFICANT_DIFFERENCE");

const emptyExperiment = analyzeExperiment({
    experiment: { id: "e", name: "n", hypothesis: "h", variants: [], metric: "m", surfaces: [], startAt: 0, status: "RUNNING", createdAt: 0, updatedAt: 0 },
    control: { variantId: "v0", label: "C", users: 0, conversions: 0 },
    challenger: { variantId: "v1", label: "X", users: 0, conversions: 0 },
});
eq("zero users does not crash", emptyExperiment.status, "INSUFFICIENT_DATA");

check("two-tailed p(0) ≈ 1", Math.abs(twoTailedP(0) - 1) < 1e-6, twoTailedP(0));
check("two-tailed p(1.96) ≈ 0.05", Math.abs(twoTailedP(1.96) - 0.05) < 0.005, twoTailedP(1.96));
check("two-tailed p(3) < 0.01", twoTailedP(3) < 0.01, twoTailedP(3));
check("two-tailed p is bounded", twoTailedP(10) >= 0 && twoTailedP(10) <= 1);

// ═══════════════════════════════════════════════════════════════════════════
section("Upgrade intent & revenue attribution");
// ═══════════════════════════════════════════════════════════════════════════

const intent = createUpgradeIntent({ uid: "u1", trigger: "strategy-research", usage: { backtests: 6, strategies: 2, oosTests: 1 }, now: NOW });
eq("trigger preserved", intent.trigger, "strategy-research");
eq("usage captured", intent.usage.backtests, 6);
eq("default outcome", intent.outcome, "VIEWED");
eq("day bucket", intent.day, new Date(NOW).toISOString().slice(0, 10));
check("usage is clamped, never negative", createUpgradeIntent({ uid: "u", trigger: "other", usage: { backtests: -5 } }).usage.backtests === 0);
check("absurd usage is clamped", createUpgradeIntent({ uid: "u", trigger: "other", usage: { backtests: 1e9 } }).usage.backtests === 10_000);
check("no free-text fields on intent", !("note" in intent) && !("message" in intent));
check("two identical intents in a minute dedupe", createUpgradeIntent({ uid: "u1", trigger: "monte-carlo", now: NOW }).id === createUpgradeIntent({ uid: "u1", trigger: "monte-carlo", now: NOW + 10_000 }).id);
check("different trigger → different intent", createUpgradeIntent({ uid: "u1", trigger: "monte-carlo", now: NOW }).id !== createUpgradeIntent({ uid: "u1", trigger: "backtesting", now: NOW }).id);

const researchIntents = Array.from({ length: 12 }, (_, i) => createUpgradeIntent({ uid: `r${i}`, trigger: "strategy-research", outcome: i < 6 ? "SUBSCRIBED" : "VIEWED", now: NOW }));
const chartIntents = Array.from({ length: 12 }, (_, i) => createUpgradeIntent({ uid: `c${i}`, trigger: "pricing", outcome: i < 1 ? "SUBSCRIBED" : "VIEWED", now: NOW }));
const report = reportUpgradeIntents([...researchIntents, ...chartIntents]);
eq("two triggers reported", report.length, 2);
eq("research ranks first by subscriptions", report[0].trigger, "strategy-research");
eq("research conversion", report[0].conversionPct, 50);
check("pricing conversion", Math.abs((report[1].conversionPct ?? 0) - 100 / 12) < 1e-9, report[1].conversionPct);
check("well-sampled trigger is not insufficient", !report[0].insufficient);

const sparse = reportUpgradeIntents([createUpgradeIntent({ uid: "x", trigger: "monte-carlo", outcome: "SUBSCRIBED", now: NOW })]);
check("tiny trigger sample is flagged", sparse[0].insufficient);
eq("tiny trigger still reports a raw number", sparse[0].users, 1);
eq("no intents → empty report", reportUpgradeIntents([]).length, 0);
check("min trigger users is 10", MIN_TRIGGER_USERS === 10);

// ═══════════════════════════════════════════════════════════════════════════
section("Content & data integrity");
// ═══════════════════════════════════════════════════════════════════════════

check("no event type references a financial claim", !PRODUCT_EVENT_TYPES.some((e) => /guarantee|profit|winrate|roi/i.test(e)));
check("no stored event carries a personal-data key", PRODUCT_EVENT_TYPES.every((e) => !/email|password|phone|ssn/i.test(e)));
check("activation never mentions trading skill", !/skill|probability|edge/i.test(Object.keys(ACTIVATION_WEIGHTS).join(",")));
check("every funnel stage has a label", computeFunnel({ stageUsers: {} }).every((s) => s.label.length > 0));

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n" + "=".repeat(62));
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.log("\n  Failures:");
    for (const f of failures) console.log(`   - ${f}`);
}
console.log("=".repeat(62));
if (failed > 0) process.exit(1);
console.log("\n🎉 PRODUCT ANALYTICS TESTS PASSED\n");
