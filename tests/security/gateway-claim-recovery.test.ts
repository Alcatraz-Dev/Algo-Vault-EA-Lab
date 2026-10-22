/**
 * MT5 gateway command lifecycle — atomic claims and safe recovery.
 *
 * Drives the REAL route handlers against the in-memory firebase-admin seam
 * (whose `transaction()` mirrors RTDB claim semantics). No broker order, no
 * network, no credentials.
 *
 * Covered:
 *   1. Two concurrent consumers cannot both claim one command.
 *   2. Unauthorized / cross-account polling claims nothing.
 *   3. Claim expiry with no broker evidence → explicit `uncertain`, never re-queued.
 *   4. EA disconnect after claim with broker evidence → recovered as confirmed.
 *   5. Lost execution report recovered from the broker snapshot (single match only).
 *   6. Duplicate / out-of-order reports cannot downgrade a confirmed fill.
 *   7. Reconciliation endpoint authorization.
 */

import { GET as pollCommands } from "@/app/api/trading/gateway/commands/route";
import { GET as reconcileGateway, POST as reconcileGatewayPost } from "@/app/api/trading/gateway/reconcile/route";
import { POST as postExecutionReport } from "@/app/api/trading/gateway/execution/route";
import { POST as postSnapshot } from "@/app/api/trading/gateway/snapshot/route";
import { POST as postDisconnect } from "@/app/api/trading/gateway/disconnect/route";
import { deriveMagicNumber, buildOrderComment } from "@/lib/bot-studio/magic-numbers";
import type { NextRequest } from "next/server";
import { rtDbStore } from "./firebase-admin-stub";

const UID = "claimUser";
const OTHER_UID = "otherClaimUser";
const ACCOUNT_NUMBER = "700700";
const ACCOUNT_KEY = `gateway_${ACCOUNT_NUMBER}`;
const GATEWAY_TOKEN = "gw_claim_token";
const BOT_ID = "BOT_CLAIM";
const STRATEGY_ID = "STRAT_CLAIM";
const MAGIC = deriveMagicNumber(STRATEGY_ID);
const CRON_SECRET = "test-cron-secret";

function assert(condition: boolean, msg: string): void {
    if (!condition) throw new Error(`FAIL: ${msg}`);
}

function entriesUnder(path: string): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of rtDbStore.entries()) {
        if (!key.startsWith(path + "/")) continue;
        const rest = key.slice(path.length + 1);
        if (rest.includes("/")) continue;
        out[rest] = value as Record<string, unknown>;
    }
    return out;
}

function pollRequest(token = GATEWAY_TOKEN, accountNumber = ACCOUNT_NUMBER): NextRequest {
    return {
        url: `https://algovault.test/api/trading/gateway/commands?accountNumber=${accountNumber}`,
        headers: {
            get: (name: string) => (name === "authorization" ? `Bearer ${token}` : null),
        },
    } as unknown as NextRequest;
}

function cronRequest(): NextRequest {
    return {
        url: "https://algovault.test/api/trading/gateway/reconcile",
        headers: {
            get: (name: string) => (name === "x-cron-secret" ? CRON_SECRET : null),
        },
    } as unknown as NextRequest;
}

function anonymousRequest(): NextRequest {
    return {
        url: "https://algovault.test/api/trading/gateway/reconcile",
        headers: { get: () => null },
    } as unknown as NextRequest;
}

function executionBody(commandId: string, overrides: Record<string, unknown> = {}) {
    return {
        commandId,
        accountNumber: ACCOUNT_NUMBER,
        status: "filled",
        retcode: 10009,
        order: "880001",
        volume: 0.1,
        price: 1.1,
        timestamp: Math.floor(Date.now() / 1000),
        ...overrides,
    };
}

function gatewayRequest(body: Record<string, unknown>, token = GATEWAY_TOKEN) {
    return {
        headers: { get: (name: string) => (name === "authorization" ? `Bearer ${token}` : null) },
        json: async () => body,
    } as unknown as Parameters<typeof postExecutionReport>[0];
}

function seed(): void {
    const now = Date.now();
    process.env.CRON_SECRET = CRON_SECRET;
    rtDbStore.clear();
    rtDbStore.set(`gateway_users/${GATEWAY_TOKEN}`, { userId: UID, userEmail: "claim@example.com" });
    rtDbStore.set(`trading_accounts/${UID}/${ACCOUNT_KEY}`, {
        mt5Account: ACCOUNT_NUMBER,
        environment: "DEMO",
        demo: true,
        server: "MetaQuotes-Demo",
        balance: 10_000,
        equity: 10_000,
        positionsCount: 0,
        lastHeartbeatAt: now,
    });
    rtDbStore.set(`trading_accounts/${OTHER_UID}/${ACCOUNT_KEY}`, {
        mt5Account: ACCOUNT_NUMBER,
        environment: "DEMO",
        demo: true,
        balance: 10_000,
        equity: 10_000,
        lastHeartbeatAt: now,
    });
    rtDbStore.set(`trading_positions/${UID}/${ACCOUNT_KEY}`, {});
    rtDbStore.set("bot_strategies", {
        [STRATEGY_ID]: {
            id: STRATEGY_ID,
            authorId: UID,
            magicNumber: MAGIC,
            definition: { asset: "EURUSD", id: STRATEGY_ID, name: "Claim test", timeframes: { setup: "M5" } },
        },
    });
    rtDbStore.set(`bot_deployments_index/${UID}`, { [BOT_ID]: true });
    rtDbStore.set(`bot_deployments/${BOT_ID}`, {
        id: BOT_ID,
        strategyId: STRATEGY_ID,
        ownerId: UID,
        mt5Account: ACCOUNT_NUMBER,
        accountMode: "demo",
        runtimeState: "running",
        desiredState: "running",
        signalCount: 0,
        executionCount: 0,
        rejectionCount: 0,
        openPositions: [],
        createdAt: now,
        updatedAt: now,
    });
}

function seedCommand(commandId: string, overrides: Record<string, unknown> = {}): void {
    const now = Date.now();
    rtDbStore.set(`trading_order_requests/${UID}/${commandId}`, {
        clientRequestId: commandId,
        accountId: ACCOUNT_KEY,
        symbol: "EURUSD",
        side: "BUY",
        action: "BUY",
        volume: 0.1,
        magicNumber: MAGIC,
        comment: buildOrderComment(STRATEGY_ID),
        botId: BOT_ID,
        strategyId: STRATEGY_ID,
        executionId: `BEXEC_${commandId}`,
        source: "bot-studio",
        status: "queued",
        createdAt: now,
        updatedAt: now,
        ...overrides,
    });
}

function seedExecution(commandId: string, overrides: Record<string, unknown> = {}): void {
    const now = Date.now();
    rtDbStore.set(`bot_executions/${BOT_ID}/BEXEC_${commandId}`, {
        id: `BEXEC_${commandId}`,
        botId: BOT_ID,
        strategyId: STRATEGY_ID,
        signalId: `SIG_${commandId}`,
        status: "submitted",
        executionOutcome: "accepted",
        clientOrderId: commandId,
        symbol: "EURUSD",
        direction: "BUY",
        volume: 0.1,
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    });
}

export async function runGatewayClaimRecoveryTests(): Promise<void> {
    console.log("Running gateway claim/recovery tests...\n");

    // ── 1. Concurrent consumers: exactly one claim ──────────────────────────
    seed();
    seedCommand("cmd_concurrent");
    const [first, second] = await Promise.all([
        pollCommands(pollRequest()),
        pollCommands(pollRequest()),
    ]);
    assert(first.status === 200 && second.status === 200, "both polls must be authorized");
    const firstBody = (await first.json()) as { commands: Array<Record<string, unknown>> };
    const secondBody = (await second.json()) as { commands: Array<Record<string, unknown>> };
    const delivered = [...firstBody.commands, ...secondBody.commands].filter(
        (command) => command.id === "cmd_concurrent",
    );
    assert(delivered.length === 1, `the same command must be delivered to exactly one consumer (got ${delivered.length})`);

    const claimed = entriesUnder(`trading_order_requests/${UID}`).cmd_concurrent;
    assert(claimed.status === "executing", "the winner must persist an executing claim");
    assert(typeof claimed.claimId === "string" && claimed.claimId !== "", "the claim must carry a unique claim id");
    assert(Number(claimed.claimExpiresAt) > Date.now(), "the claim must carry an expiry");
    assert(Number(claimed.claimAttempts) === 1, "the claim attempt must be recorded once");

    // Stress the same invariant with several exporters of work in flight.
    seed();
    for (const id of ["cmd_multi_a", "cmd_multi_b", "cmd_multi_c"]) seedCommand(id);
    const polls = await Promise.all(Array.from({ length: 5 }, () => pollCommands(pollRequest())));
    const deliveries: Array<Record<string, unknown>> = [];
    for (const response of polls) {
        const body = (await response.json()) as { commands: Array<Record<string, unknown>> };
        deliveries.push(...body.commands);
    }
    assert(
        deliveries.length === 3,
        `three queued commands must be delivered exactly three times in total (got ${deliveries.length})`,
    );
    const deliveredIds = deliveries.map((command) => String(command.id)).sort();
    assert(
        JSON.stringify(deliveredIds) === JSON.stringify(["cmd_multi_a", "cmd_multi_b", "cmd_multi_c"]),
        `each command must be delivered once (saw ${deliveredIds.join(",")})`,
    );
    const claimIds = new Set(deliveries.map((command) => String(command.claimId)));
    assert(claimIds.size === 3, "each delivery must carry a distinct claim id");

    // ── 2. Authorization + account isolation ────────────────────────────────
    seed();
    seedCommand("cmd_guarded");
    const badToken = await pollCommands(pollRequest("wrong-token"));
    assert(badToken.status === 403, `an invalid gateway token must be rejected (got ${badToken.status})`);
    const wrongAccount = await pollCommands(pollRequest(GATEWAY_TOKEN, "111111"));
    const wrongAccountBody = (await wrongAccount.json()) as { commands: unknown[] };
    assert(wrongAccountBody.commands.length === 0, "another account must not receive the command");
    assert(
        entriesUnder(`trading_order_requests/${UID}`).cmd_guarded.status === "queued",
        "a non-matching account must not claim the command",
    );

    const unauthorized = await reconcileGateway(anonymousRequest());
    assert(unauthorized.status === 401, `reconciliation must require auth (got ${unauthorized.status})`);

    // ── 3. Expired claim, no broker evidence → uncertain, never re-queued ───
    seed();
    seedCommand("cmd_expired", {
        status: "executing",
        executingAt: Date.now() - 10 * 60_000,
        gatewayRetrievedAt: Date.now() - 10 * 60_000,
        claimId: "claim-expired",
        claimExpiresAt: Date.now() - 60_000,
    });
    seedExecution("cmd_expired");
    const expiredRun = await reconcileGateway(cronRequest());
    assert(expiredRun.status === 200, `the sweep must run (got ${expiredRun.status})`);
    const expiredCommand = entriesUnder(`trading_order_requests/${UID}`).cmd_expired;
    assert(expiredCommand.status === "uncertain", `no evidence must retain uncertainty (got ${String(expiredCommand.status)})`);
    assert(expiredCommand.reconciliationRequired === true, "the command must be surfaced for resolution");
    assert(
        entriesUnder(`bot_executions/${BOT_ID}`).BEXEC_cmd_expired.status === "uncertain",
        "the bot execution must be marked uncertain, never filled or failed",
    );
    const repoll = await pollCommands(pollRequest());
    const repollBody = (await repoll.json()) as { commands: unknown[] };
    assert(repollBody.commands.length === 0, "an uncertain command must never be re-delivered for blind retry");

    // ── 4. EA disconnect after claim, broker state proves the fill ───────────
    seed();
    seedCommand("cmd_recovered", {
        status: "executing",
        executingAt: Date.now() - 10 * 60_000,
        gatewayRetrievedAt: Date.now() - 10 * 60_000,
        claimId: "claim-recovered",
        claimExpiresAt: Date.now() - 60_000,
    });
    seedExecution("cmd_recovered");
    rtDbStore.set(`trading_positions/${UID}/${ACCOUNT_KEY}`, {
        "880001": {
            ticket: "880001",
            symbol: "EURUSD",
            type: "BUY",
            volume: 0.1,
            openPrice: 1.1,
            currentPrice: 1.101,
            magic: MAGIC,
            comment: buildOrderComment(STRATEGY_ID),
        },
    });
    const recoveredRun = await reconcileGateway(cronRequest());
    const recoveredBody = (await recoveredRun.json()) as { recovered: number };
    assert(recoveredBody.recovered === 1, `broker evidence must recover the command (got ${recoveredBody.recovered})`);
    const recoveredCommand = entriesUnder(`trading_order_requests/${UID}`).cmd_recovered;
    assert(recoveredCommand.status === "filled", "a recovered command must be broker-confirmed");
    assert(String(recoveredCommand.mt5Ticket) === "880001", "the recovered command must carry the broker ticket");
    assert(recoveredCommand.recoverySource === "broker_snapshot", "recovery evidence must be recorded");
    const recoveredExecution = entriesUnder(`bot_executions/${BOT_ID}`).BEXEC_cmd_recovered;
    assert(recoveredExecution.status === "filled", "the bot execution must be broker-confirmed");
    assert(Number(recoveredExecution.mt5Ticket) === 880001, "the execution must carry the broker ticket");
    assert(Number(recoveredExecution.recoveredAt) > 0, "the recovery timestamp must be recorded");

    // ── 5. Lost report recovered from a later broker snapshot ────────────────
    seed();
    seedCommand("cmd_snapshot", {
        status: "uncertain",
        reconciliationRequired: true,
        claimExpiresAt: Date.now() - 60_000,
    });
    seedExecution("cmd_snapshot", { status: "uncertain", executionOutcome: "uncertain" });
    const snapshotRes = await postSnapshot(
        gatewayRequest({
            accountNumber: ACCOUNT_NUMBER,
            positions: [{
                ticket: "990001",
                symbol: "EURUSD",
                type: "BUY",
                volume: 0.1,
                openPrice: 1.1,
                currentPrice: 1.105,
                magic: MAGIC,
                comment: buildOrderComment(STRATEGY_ID),
                openedAt: Math.floor(Date.now() / 1000),
            }],
            orders: [],
            closedDeals: [],
        }) as unknown as Parameters<typeof postSnapshot>[0],
    );
    assert(snapshotRes.status === 200, `the snapshot must be accepted (got ${snapshotRes.status})`);
    const adopted = entriesUnder(`bot_executions/${BOT_ID}`).BEXEC_cmd_snapshot;
    assert(adopted.status === "filled", "a lone in-flight execution must adopt the broker ticket");
    assert(Number(adopted.mt5Ticket) === 990001, "the adopted ticket must be the broker ticket");
    assert(adopted.recoverySource === "broker_snapshot", "snapshot recovery must be labelled");
    assert(
        entriesUnder(`trading_order_requests/${UID}`).cmd_snapshot.status === "filled",
        "the command must reflect the recovered broker state",
    );

    // ── 6. Duplicate / out-of-order reports never downgrade a fill ───────────
    seed();
    seedCommand("cmd_duplicate", { status: "executing", clientRequestId: "cmd_duplicate" });
    seedExecution("cmd_duplicate");
    const reportRequest = () =>
        gatewayRequest(executionBody("cmd_duplicate")) as unknown as Parameters<typeof postExecutionReport>[0];
    const firstReport = await postExecutionReport(reportRequest());
    assert(firstReport.status === 200, `the first report must be accepted (got ${firstReport.status})`);
    const duplicate = await postExecutionReport(reportRequest());
    assert(duplicate.status === 200, "a duplicate report must be accepted idempotently");
    const stale = await postExecutionReport(
        gatewayRequest(executionBody("cmd_duplicate", { status: "unknown", retcode: 0, order: "" })) as unknown as Parameters<typeof postExecutionReport>[0],
    );
    assert(stale.status === 200, "a late/unknown report must not error");
    const finalCommand = entriesUnder(`trading_order_requests/${UID}`).cmd_duplicate;
    assert(finalCommand.status === "filled", `a late report must not downgrade the fill (got ${String(finalCommand.status)})`);
    assert(String(finalCommand.mt5Ticket) === "880001", "the confirmed ticket must be preserved");
    const finalExecution = entriesUnder(`bot_executions/${BOT_ID}`).BEXEC_cmd_duplicate;
    assert(finalExecution.status === "filled", "the bot execution must stay broker-confirmed");
    assert(Number(finalExecution.mt5Ticket) === 880001, "the bot execution ticket must be preserved");

    // ── 6b. A never-claimed command is never settled from broker state ───────
    seed();
    seedCommand("cmd_unclaimed");
    seedExecution("cmd_unclaimed");
    await postSnapshot(
        gatewayRequest({
            accountNumber: ACCOUNT_NUMBER,
            positions: [{
                ticket: "991001",
                symbol: "EURUSD",
                type: "BUY",
                volume: 0.1,
                openPrice: 1.1,
                currentPrice: 1.105,
                magic: MAGIC,
                comment: buildOrderComment(STRATEGY_ID),
                openedAt: Math.floor(Date.now() / 1000),
            }],
            orders: [],
            closedDeals: [],
        }) as unknown as Parameters<typeof postSnapshot>[0],
    );
    assert(
        entriesUnder(`bot_executions/${BOT_ID}`).BEXEC_cmd_unclaimed.status === "submitted",
        "a queued command can never explain a broker position, so its execution must stay submitted",
    );
    assert(
        entriesUnder(`trading_order_requests/${UID}`).cmd_unclaimed.status === "queued",
        "an unclaimed command must remain deliverable",
    );

    // ── 7. Unknown broker outcome becomes explicit uncertainty, then a late
    //       real report still confirms it (never a fabricated fill) ─────────
    seed();
    seedCommand("cmd_unknown", { status: "executing" });
    seedExecution("cmd_unknown");
    const unknownReport = await postExecutionReport(
        gatewayRequest(executionBody("cmd_unknown", { status: "unknown", retcode: 0, order: "" })) as unknown as Parameters<typeof postExecutionReport>[0],
    );
    assert(unknownReport.status === 200, `an unknown outcome must be accepted (got ${unknownReport.status})`);
    const unknownCommand = entriesUnder(`trading_order_requests/${UID}`).cmd_unknown;
    assert(unknownCommand.status === "uncertain", `an unknown outcome must persist as uncertain (got ${String(unknownCommand.status)})`);
    assert(unknownCommand.reconciliationRequired === true, "an unknown outcome must be surfaced for resolution");
    assert(
        entriesUnder(`bot_executions/${BOT_ID}`).BEXEC_cmd_unknown.status === "uncertain",
        "the execution must be uncertain, never filled or failed",
    );

    const lateFill = await postExecutionReport(
        gatewayRequest(executionBody("cmd_unknown", { order: "770001" })) as unknown as Parameters<typeof postExecutionReport>[0],
    );
    assert(lateFill.status === 200, "a late authoritative report must still be accepted");
    const lateCommand = entriesUnder(`trading_order_requests/${UID}`).cmd_unknown;
    assert(lateCommand.status === "filled", `a late real fill must confirm (got ${String(lateCommand.status)})`);
    assert(lateCommand.reconciliationRequired === false, "a resolved outcome must clear the review flag");
    assert(
        entriesUnder(`bot_executions/${BOT_ID}`).BEXEC_cmd_unknown.status === "filled",
        "the execution must be confirmed by the late report",
    );

    // ── 8. A live claim is never swept, and an order that was never executed
    //       is never fabricated into a fill ─────────────────────────────────
    seed();
    seedCommand("cmd_held", {
        status: "executing",
        claimId: "claim-held",
        claimExpiresAt: Date.now() + 60_000,
    });
    seedExecution("cmd_held");
    const heldRun = await reconcileGateway(cronRequest());
    const heldBody = (await heldRun.json()) as { scanned: number; recovered: number };
    assert(heldBody.scanned === 0 && heldBody.recovered === 0, "an unexpired claim must not be reconciled");
    assert(
        entriesUnder(`trading_order_requests/${UID}`).cmd_held.status === "executing",
        "an unexpired claim must keep executing",
    );

    // Broker-confirmed evidence already on the execution survives a late sweep
    // even while the command itself is still marked executing.
    seed();
    seedCommand("cmd_confirmed_early", {
        status: "executing",
        claimExpiresAt: Date.now() - 60_000,
    });
    seedExecution("cmd_confirmed_early", {
        status: "executed_pending_sync",
        executionOutcome: "confirmed",
        mt5Ticket: 660001,
    });
    await reconcileGateway(cronRequest());
    const earlyExecution = entriesUnder(`bot_executions/${BOT_ID}`).BEXEC_cmd_confirmed_early;
    assert(
        earlyExecution.status === "executed_pending_sync",
        `a broker-confirmed execution must not be downgraded by a sweep (got ${String(earlyExecution.status)})`,
    );
    assert(Number(earlyExecution.mt5Ticket) === 660001, "a confirmed ticket must survive the sweep");
    assert(
        entriesUnder(`trading_order_requests/${UID}`).cmd_confirmed_early.status === "uncertain",
        "the command itself stays explicitly uncertain until broker state proves it",
    );

    // ── 9. POST alias is authorized the same way ────────────────────────────
    const postUnauthorized = await reconcileGatewayPost(anonymousRequest());
    assert(postUnauthorized.status === 401, "the POST alias must require auth too");

    // ── 10. Ambiguous timeouts are never reported as rejections ─────────────
    // The EA labels a timed-out (10012) submission "rejected"; the server must
    // keep it uncertain, because the broker may already have executed it.
    seed();
    seedCommand("cmd_timeout", {
        status: "executing",
        claimExpiresAt: Date.now() + 60_000,
    });
    const timeoutReport = await postExecutionReport(
        gatewayRequest(executionBody("cmd_timeout", { success: false, status: "rejected", retcode: 10012 })),
    );
    assert(timeoutReport.status === 200, `a timeout report must be accepted (got ${timeoutReport.status})`);
    const timedOut = entriesUnder(`trading_order_requests/${UID}`).cmd_timeout;
    assert(timedOut.status === "uncertain", `a timeout must stay uncertain (got ${String(timedOut.status)})`);
    assert(timedOut.reconciliationRequired === true, "a timeout must require reconciliation");

    // Connection loss (10031) is the same ambiguous class.
    seed();
    seedCommand("cmd_conn", { status: "executing", claimExpiresAt: Date.now() + 60_000 });
    await postExecutionReport(
        gatewayRequest(executionBody("cmd_conn", { success: false, status: "rejected", retcode: 10031 })),
    );
    assert(
        entriesUnder(`trading_order_requests/${UID}`).cmd_conn.status === "uncertain",
        "a connection loss must stay uncertain",
    );

    // A genuine broker rejection is still a rejection.
    seed();
    seedCommand("cmd_rejected", { status: "executing", claimExpiresAt: Date.now() + 60_000 });
    await postExecutionReport(
        gatewayRequest(executionBody("cmd_rejected", { success: false, status: "rejected", retcode: 10016 })),
    );
    assert(
        entriesUnder(`trading_order_requests/${UID}`).cmd_rejected.status === "rejected",
        "a definitive broker rejection must stay rejected",
    );

    // ── 11. Disconnect: authenticated, owner-scoped, never touches commands ──
    seed();
    rtDbStore.set(`live_accounts/gateway_${ACCOUNT_NUMBER}`, {
        userId: UID,
        status: "online",
        lastHeartbeatAt: Date.now(),
    });
    const disconnectAnon = await postDisconnect(
        {
            headers: { get: () => null },
            json: async () => ({ accountNumber: ACCOUNT_NUMBER }),
        } as unknown as Parameters<typeof postDisconnect>[0],
    );
    assert(disconnectAnon.status === 400, `a disconnect without a token must be rejected (got ${disconnectAnon.status})`);

    const disconnectBadToken = await postDisconnect(
        gatewayRequest({ accountNumber: ACCOUNT_NUMBER }, "not-a-real-token"),
    );
    assert(disconnectBadToken.status === 403, `an unknown token must be rejected (got ${disconnectBadToken.status})`);

    const disconnectOk = await postDisconnect(gatewayRequest({ accountNumber: ACCOUNT_NUMBER }));
    assert(disconnectOk.status === 200, `a valid disconnect must succeed (got ${disconnectOk.status})`);
    assert(
        entriesUnder("live_accounts")[`gateway_${ACCOUNT_NUMBER}`]?.status === "offline",
        "a valid disconnect must mark the live account offline",
    );

    console.log("  ✓ Gateway claim/recovery tests passed.");
    console.log("\nAll gateway claim/recovery tests passed.\n");
}

await runGatewayClaimRecoveryTests();
