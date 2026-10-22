/**
 * Terminal Bots panel — pure view-model tests.
 *
 * Run with:
 *     npm run test:terminal-bots
 *
 * The Bots panel is a projection of records the server owns. Every decision it
 * makes — which body to render, which lifecycle action is legal, whether a
 * start may be offered at all, how a number is written — is a pure function
 * in `lib/terminal/bots.ts`. These tests pin that behaviour without React,
 * network, Firebase or a broker:
 *
 *   · panel states (signed out / no access / loading / error / empty /
 *     no account / ready) never lie about what the user can see
 *   · lifecycle actions come from the canonical state machine, and a running
 *     bot is never offered a second "start"
 *   · an ineligible bot can never show an enabled Start, but it can ALWAYS be
 *     paused or stopped
 *   · pausing/stopping never implies closing positions
 *   · an execution is only "confirmed" when the broker filled it
 *   · the gateway is offline unless a FRESH heartbeat says otherwise
 */

import {
    botActions,
    botActionTargetState,
    botModeLabel,
    botPositionRows,
    botRowView,
    botStateLabel,
    botStateTone,
    executionStatusLabel,
    executionStatusTone,
    formatSignedUsd,
    gatewayConnected,
    GATEWAY_FRESH_MS,
    relativeAgeLabel,
    resolveBotsPanelState,
    summariseBots,
} from "../bots";
import type { BotDeployment, BotDeploymentSummary } from "@/lib/bot-studio/types";

/* ── harness ─────────────────────────────────────────────────────────────── */

let passed = 0;
const failures: string[] = [];

function section(title: string): void {
    console.log(`\n${title}`);
}

function check(condition: boolean, message: string): void {
    if (condition) {
        passed += 1;
        console.log(`  ✓ ${message}`);
    } else {
        failures.push(message);
        console.log(`  ✗ ${message}`);
    }
}

/* ── fixtures ────────────────────────────────────────────────────────────── */

function deployment(overrides: Partial<BotDeployment> = {}): BotDeployment {
    return {
        id: "BOT_1",
        strategyId: "STRAT_1",
        deployedFingerprint: "fp_1",
        ownerId: "user_1",
        mt5Account: "50123456",
        accountMode: "demo",
        runtimeState: "ready",
        desiredState: "paper",
        signalCount: 0,
        executionCount: 0,
        rejectionCount: 0,
        openPositions: [],
        createdAt: 1_000,
        updatedAt: 1_000,
        ...overrides,
    };
}

function summary(overrides: Partial<BotDeploymentSummary> = {}): BotDeploymentSummary {
    return {
        botId: "BOT_1",
        strategyName: "Momentum",
        strategyPresent: true,
        fingerprintMatches: true,
        symbol: "EURUSD",
        timeframe: "M5",
        openPositions: 0,
        floatingPnl: 0,
        performance: null,
        lastExecutionAt: null,
        lastExecutionStatus: null,
        eligibility: { eligible: true, code: "eligible", reason: null, warning: false },
        ...overrides,
    };
}

/* ── 1. panel states ─────────────────────────────────────────────────────── */

section("Bots panel — which body is rendered");

check(
    resolveBotsPanelState({
        hasSession: false,
        accessDenied: false,
        hasAccount: true,
        loading: true,
        error: null,
        count: 3,
    }) === "signed-out",
    "a signed-out session never sees bot data",
);

check(
    resolveBotsPanelState({
        hasSession: true,
        accessDenied: true,
        hasAccount: true,
        loading: false,
        error: null,
        count: 0,
    }) === "no-access",
    "an entitled-but-refused session is told Bot Studio is required",
);

check(
    resolveBotsPanelState({
        hasSession: true,
        accessDenied: false,
        hasAccount: true,
        loading: true,
        error: null,
        count: 0,
    }) === "loading",
    "the first load renders a skeleton, not an empty state",
);

check(
    resolveBotsPanelState({
        hasSession: true,
        accessDenied: false,
        hasAccount: true,
        loading: false,
        error: "boom",
        count: 0,
    }) === "error",
    "a failed load renders the error, not \"no bots\"",
);

check(
    resolveBotsPanelState({
        hasSession: true,
        accessDenied: false,
        hasAccount: true,
        loading: false,
        error: null,
        count: 0,
    }) === "empty",
    "no bots on a connected account renders the empty state",
);

check(
    resolveBotsPanelState({
        hasSession: true,
        accessDenied: false,
        hasAccount: false,
        loading: false,
        error: null,
        count: 0,
    }) === "no-account",
    "no bots and no MT5 account is NOT the same message as \"no bots\"",
);

check(
    resolveBotsPanelState({
        hasSession: true,
        accessDenied: false,
        hasAccount: false,
        loading: true,
        error: "boom",
        count: 2,
    }) === "ready",
    "existing bots stay listed while a refresh fails or the account is gone",
);

/* ── 2. lifecycle actions ────────────────────────────────────────────────── */

section("Bots panel — lifecycle actions follow the state machine");

const actionCases: Array<[BotDeployment["runtimeState"], boolean, boolean, boolean]> = [
    // state,          start, pause, stop
    ["running", false, true, true],
    ["paused", true, false, true],
    ["stopped", true, false, false],
    ["error", true, false, true],
    ["ready", true, false, false],
    ["draft", false, false, false],
    ["starting", false, false, true],
    ["pausing", false, false, true],
    ["stopping", false, false, false],
    ["paper", false, false, true],
];

for (const [state, start, pause, stop] of actionCases) {
    const actions = botActions(state);
    check(
        actions.start === start && actions.pause === pause && actions.stop === stop,
        `from "${state}" the panel offers start=${start}, pause=${pause}, stop=${stop}`,
    );
}

check(
    botActions("running").start === false,
    "a running bot is never offered a second Start (no duplicate submissions)",
);
check(
    botActions("starting").start === false && botActions("starting").pause === false,
    "a bot that is already starting is not offered a competing Start or Pause",
);
check(
    botActions("ready").stop === false,
    "a bot that never ran is not offered Stop (it would only mislabel it as errored)",
);
check(
    botActionTargetState("start") === "running" &&
        botActionTargetState("pause") === "paused" &&
        botActionTargetState("stop") === "stopped",
    "the three panel intents map to the three user intents the route accepts",
);

/* ── 3. rows ─────────────────────────────────────────────────────────────── */

section("Bots panel — rows");

const readyRow = botRowView(deployment({ runtimeState: "ready" }), summary());
check(readyRow.name === "Momentum", "the row is named after the strategy it runs");
check(readyRow.symbol === "EURUSD" && readyRow.timeframe === "M5", "the row shows the traded symbol and timeframe");
check(readyRow.mode === "DEMO", "a demo deployment is labelled DEMO");
check(botRowView(deployment({ accountMode: "live" }), summary()).mode === "LIVE", "a live deployment is labelled LIVE");
check(
    botRowView(deployment(), undefined).name === "STRAT_1",
    "without a summary the row falls back to the strategy id instead of showing nothing",
);
check(
    botRowView(deployment(), undefined).symbol === null && botRowView(deployment(), undefined).timeframe === null,
    "a missing strategy yields null symbol/timeframe — the panel prints a dash, never a guess",
);

const ineligible = summary({
    eligibility: {
        eligible: false,
        code: "gateway_offline",
        reason: "MT5 gateway is offline — connect it before starting.",
        warning: false,
    },
});
const offlineRow = botRowView(deployment({ runtimeState: "ready" }), ineligible);
check(offlineRow.actions.start === false, "an ineligible bot never shows an enabled Start");
check(
    offlineRow.startAvailable,
    "a legal-but-blocked start stays visible, so the panel can explain the refusal",
);
check(
    offlineRow.startBlockedReason === "MT5 gateway is offline — connect it before starting.",
    "the blocked Start explains itself with the server's reason",
);
check(
    offlineRow.actions.pause === false && offlineRow.actions.stop === false,
    "a bot that never ran stays free of pause/stop actions",
);

const runningIneligible = botRowView(deployment({ runtimeState: "running" }), ineligible);
check(
    runningIneligible.actions.pause === true && runningIneligible.actions.stop === true,
    "a bot that cannot trade can still be paused and stopped",
);

const warningRow = botRowView(
    deployment({ runtimeState: "error" }),
    summary({
        eligibility: {
            eligible: true,
            code: "runtime_error",
            reason: "Runtime error — starting restarts the bot.",
            warning: true,
        },
    })
);
check(warningRow.actions.start === true, "a runtime error is a warning: restarting is still allowed");
check(
    warningRow.startBlockedReason === null,
    "a warning never blocks the Start button",
);

check(botStateLabel("paused") === "Paused", "states carry a human label");
check(botStateTone("running") === "live", "a running bot reads as live");
check(botStateTone("paused") === "warning", "a paused bot reads as a warning");
check(botStateTone("stopped") === "offline", "a stopped bot reads as offline");
check(botStateTone("error") === "negative", "an errored bot reads as negative");
check(botModeLabel("live") === "LIVE", "the mode label is never inferred");
check(botModeLabel("demo") === "DEMO", "the mode label is never inferred");

/* ── 4. totals ───────────────────────────────────────────────────────────── */

section("Bots panel — header totals");

const totals = summariseBots([
    botRowView(deployment({ id: "A", runtimeState: "running" }), summary({ openPositions: 2, floatingPnl: 12.5 })),
    botRowView(deployment({ id: "B", runtimeState: "paused" }), summary({ openPositions: 1, floatingPnl: -3.25 })),
    botRowView(deployment({ id: "C", runtimeState: "stopped" }), summary()),
]);
check(totals.total === 3, "every bot is counted");
check(totals.running === 1 && totals.paused === 1, "running and paused are counted separately");
check(totals.openPositions === 3, "open positions are summed across bots");
check(totals.floatingPnl === 9.25, "floating P/L is summed across bots");
check(
    summariseBots([]).total === 0 && summariseBots([]).floatingPnl === 0,
    "an empty list totals to zero instead of NaN",
);

/* ── 5. formatting ───────────────────────────────────────────────────────── */

section("Bots panel — number and time formatting");

check(formatSignedUsd(12.5) === "+$12.50", "a positive amount is signed");
check(formatSignedUsd(-12.5) === "−$12.50", "a negative amount keeps its sign");
check(formatSignedUsd(0) === "+$0.00", "zero is written explicitly");
check(formatSignedUsd(Number.NaN) === "—", "a missing amount is a dash, not NaN");
check(formatSignedUsd(null) === "—", "a missing amount is a dash, not $0");
check(formatSignedUsd(undefined) === "—", "a missing amount is a dash, not $0");

const now = 1_700_000_000_000;
check(relativeAgeLabel(now, null) === "never", "a missing timestamp reads as \"never\"");
check(relativeAgeLabel(now, now - 1_000) === "just now", "a fresh timestamp reads as \"just now\"");
check(relativeAgeLabel(now, now - 30_000) === "30s ago", "seconds are shown in seconds");
check(relativeAgeLabel(now, now - 120_000) === "2m ago", "minutes are shown in minutes");
check(relativeAgeLabel(now, now - 7_200_000) === "2h ago", "hours are shown in hours");
check(relativeAgeLabel(now, now - 172_800_000) === "2d ago", "days are shown in days");
check(relativeAgeLabel(now, now + 60_000) === "just now", "a future timestamp never renders a negative age");

check(executionStatusTone("filled") === "positive", "a filled execution is the only confirmed success");
check(
    executionStatusTone("uncertain") === "warning",
    "an uncertain execution is NOT a success — it needs reconciliation",
);
check(executionStatusTone("rejected_by_broker") === "negative", "a broker rejection is negative");
check(executionStatusTone("failed") === "negative", "a failure is negative");
check(executionStatusTone("submitted") === "pending", "a submitted execution is still pending");
check(executionStatusTone(undefined) === "neutral", "an unknown execution status stays neutral");
check(executionStatusLabel("rejected_by_broker") === "rejected by broker", "execution labels are readable");
check(executionStatusLabel(null) === "—", "a missing execution status is a dash");

/* ── 6. positions ────────────────────────────────────────────────────────── */

section("Bots panel — open positions");

const positionRows = botPositionRows([
    { ticket: "12", symbol: "EURUSD", type: "SELL", volume: 0.1, openPrice: 1.1, currentPrice: 1.09, profit: -2 },
    { ticket: "13", symbol: "GBPUSD", type: "buy", volume: 0.2, openPrice: 1.2, currentPrice: 1.21, profit: 3 },
    { ticket: "", symbol: "X", type: "BUY", volume: 1, openPrice: 1, currentPrice: 1, profit: 0 },
] as unknown as Parameters<typeof botPositionRows>[0]);
check(positionRows.length === 2, "a position without a ticket is dropped");
check(positionRows[0].side === "SELL", "the side is normalised to BUY/SELL");
check(positionRows[1].side === "BUY", "a lowercase side is still a BUY");
check(positionRows[0].volume === 0.1 && positionRows[0].profit === -2, "position numbers survive unchanged");
check(botPositionRows(null).length === 0, "a bot without positions renders no rows");
check(botPositionRows(undefined).length === 0, "an unloaded detail renders no rows");

/* ── 7. gateway reachability ─────────────────────────────────────────────── */

section("Bots panel — gateway reachability");

check(
    gatewayConnected({ status: "connected", lastHeartbeatAt: now - 1_000 }, now) === true,
    "a fresh heartbeat means the gateway can execute",
);
check(
    gatewayConnected({ status: "connected", lastHeartbeatAt: now - (GATEWAY_FRESH_MS + 1) }, now) === false,
    "a stale heartbeat means the gateway cannot execute",
);
check(gatewayConnected({ status: "disconnected", lastHeartbeatAt: now }, now) === false, "a disconnected account is offline");
check(gatewayConnected(null, now) === false, "a missing account is offline, never optimistic");
check(
    gatewayConnected({ status: "connected", lastHeartbeatAt: undefined }, now) === false,
    "a connected account without a heartbeat is offline",
);

/* ── summary ─────────────────────────────────────────────────────────────── */

console.log(`\n${"─".repeat(50)}`);
console.log(`terminal bots tests: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
}
console.log("ALL TERMINAL BOTS TESTS PASSED");
