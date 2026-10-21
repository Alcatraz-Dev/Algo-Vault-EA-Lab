/**
 * Client-side outcome classification for the Unified Trading API client.
 *
 * Invariant under test: a timeout, a dropped transport, or an unreadable
 * response means the broker outcome is UNKNOWN — the order may already have
 * executed. Such outcomes must be flagged by `isUnknownOutcome` so the terminal
 * locks resubmission. A confirmed broker/risk rejection must NOT be flagged.
 *
 * `fetch` is replaced with a scripted mock; no network or live MT5 is touched.
 */

import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import {
    ExecutionOutcomeTracker,
    executeUnified,
    isUnknownOutcome,
    targetKeyFor,
    UnifiedExecutionError,
    type UnifiedExecutePayload,
} from "@/lib/trading/unified/client";

const PAYLOAD: UnifiedExecutePayload = {
    accountId: "gateway_777001",
    clientRequestId: "pt-test-1",
    executionType: "PLACE_ORDER",
    symbol: "XAUUSD",
    side: "BUY",
    volume: 0.01,
    kind: "MARKET",
};

function resultEnvelope(status: string, error: { code: string; message: string } | null) {
    return {
        clientRequestId: PAYLOAD.clientRequestId,
        executionType: "PLACE_ORDER",
        status,
        provider: "MT5",
        accountId: PAYLOAD.accountId,
        error,
        providerRef: null,
        createdAt: 0,
        completedAt: 0,
    };
}

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

async function withFetch<T>(mock: FetchMock, run: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = mock as unknown as typeof fetch;
    try {
        return await run();
    } finally {
        globalThis.fetch = original;
    }
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
        return null;
    } catch (error) {
        return error;
    }
}

export async function runClientOutcomeTests(): Promise<boolean> {
    const s = createSuite("client-outcome");

    s.section("Classifier: which errors mean the outcome is UNKNOWN");
    s.check(isUnknownOutcome(new UnifiedExecutionError("t", { code: "EXECUTION_TIMEOUT", status: 504, result: null })), "EXECUTION_TIMEOUT is an unknown outcome");
    s.check(isUnknownOutcome(new UnifiedExecutionError("t", { code: "NETWORK", status: 0, result: null })), "NETWORK loss is an unknown outcome");
    s.check(isUnknownOutcome(new UnifiedExecutionError("t", { code: "UNREADABLE_RESPONSE", status: 502, result: null })), "an unreadable response is an unknown outcome");
    s.check(!isUnknownOutcome(new UnifiedExecutionError("t", { code: "ORDER_REJECTED", status: 409, result: null })), "a broker rejection is a confirmed failure, not unknown");
    s.check(!isUnknownOutcome(new UnifiedExecutionError("t", { code: "INSUFFICIENT_MARGIN", status: 409, result: null })), "a margin rejection is a confirmed failure");
    s.check(!isUnknownOutcome(new Error("plain error")), "non-execution errors are not classified as unknown");

    s.section("Timeout response (FAILED/EXECUTION_TIMEOUT) surfaces as UNKNOWN, not a confirmed failure");
    const timeoutError = await withFetch(
        async () => jsonResponse(504, { success: false, duplicate: false, result: resultEnvelope("UNKNOWN", { code: "EXECUTION_TIMEOUT", message: "timed out" }) }),
        () => captureError(() => executeUnified(PAYLOAD, "token")),
    );
    s.check(timeoutError instanceof UnifiedExecutionError, "the timeout is thrown as a UnifiedExecutionError");
    s.check((timeoutError as UnifiedExecutionError)?.code === "EXECUTION_TIMEOUT", "the code is preserved as EXECUTION_TIMEOUT");
    s.check(isUnknownOutcome(timeoutError), "the timeout is classified as an UNKNOWN outcome");

    s.section("Transport loss after send is UNKNOWN");
    const networkError = await withFetch(
        async () => { throw new TypeError("fetch failed"); },
        () => captureError(() => executeUnified(PAYLOAD, "token")),
    );
    s.check(isUnknownOutcome(networkError), "a dropped connection is UNKNOWN, never a failure");
    s.check(!String((networkError as Error).message).includes("nothing was sent"), "the message no longer claims nothing was sent");

    s.section("Confirmed outcomes are not flagged");
    const rejectedError = await withFetch(
        async () => jsonResponse(409, { success: false, duplicate: false, result: resultEnvelope("REJECTED", { code: "ORDER_REJECTED", message: "broker said no" }) }),
        () => captureError(() => executeUnified(PAYLOAD, "token")),
    );
    s.check((rejectedError as UnifiedExecutionError)?.code === "ORDER_REJECTED", "a broker rejection keeps its ORDER_REJECTED code");
    s.check(!isUnknownOutcome(rejectedError), "a confirmed broker rejection is not UNKNOWN");

    const filled = await withFetch(
        async () => jsonResponse(200, { success: true, duplicate: false, result: resultEnvelope("SUCCEEDED", null) }),
        () => executeUnified(PAYLOAD, "token"),
    );
    s.check(filled.status === "SUCCEEDED", "a confirmed fill is returned verbatim as SUCCEEDED");

    s.section("UI lock: an UNKNOWN outcome blocks new submissions until a safe resolution");
    const tracker = new ExecutionOutcomeTracker();
    const KEY = "PLACE_ORDER:";
    const trackerSent: string[] = [];
    const timeoutOnce = async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { clientRequestId?: string };
        trackerSent.push(body.clientRequestId ?? "");
        return trackerSent.length === 1
            ? jsonResponse(504, { success: false, duplicate: false, result: resultEnvelope("UNKNOWN", { code: "EXECUTION_TIMEOUT", message: "timed out" }) })
            : jsonResponse(200, { success: true, duplicate: true, result: resultEnvelope("SUCCEEDED", null) });
    };
    await withFetch(timeoutOnce, async () => {
        const first = await captureError(() => tracker.submit(KEY, PAYLOAD, "token"));
        s.check(isUnknownOutcome(first), "the first submission ends UNKNOWN");
        s.check(tracker.hasUnresolved(KEY) && tracker.isLocked(KEY), "an UNKNOWN outcome locks the action");

        const blocked = await captureError(() => tracker.submit(KEY, PAYLOAD, "token"));
        s.check((blocked as UnifiedExecutionError)?.code === "OUTCOME_UNRESOLVED", "a new submission is blocked while UNKNOWN");
        s.check(trackerSent.length === 1, "the blocked submission is never sent to the server");

        const settled = await tracker.retry(KEY, "token");
        s.check(settled.status === "SUCCEEDED", "an explicit retry settles the outcome");
        s.check(trackerSent[1] === trackerSent[0], "the retry replays the ORIGINAL clientRequestId");
        s.check(!tracker.isLocked(KEY), "the lock releases only after a settled outcome");
    });

    s.section("UI lock: a confirmed rejection releases the lock");
    const rejectTracker = new ExecutionOutcomeTracker();
    await withFetch(
        async () => jsonResponse(422, { success: false, duplicate: false, result: resultEnvelope("REJECTED", { code: "ORDER_REJECTED", message: "no" }) }),
        async () => {
            await captureError(() => rejectTracker.submit(KEY, PAYLOAD, "token"));
        },
    );
    s.check(!rejectTracker.isLocked(KEY), "a confirmed rejection is definite and unlocks the action");

    s.section("UI lock: a fresh submission is allowed only after a safe resolution");
    const freshSent: string[] = [];
    await withFetch(
        async (_url, init) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { clientRequestId?: string };
            freshSent.push(body.clientRequestId ?? "");
            return jsonResponse(200, { success: true, duplicate: false, result: resultEnvelope("SUCCEEDED", null) });
        },
        async () => {
            await tracker.submit(KEY, PAYLOAD, "token");
        },
    );
    s.check(freshSent.length === 1 && freshSent[0] !== trackerSent[0], "after resolution a new action gets a new clientRequestId");

    s.section("UI lock: a queued (ACCEPTED) outcome is unresolved until a terminal result");
    const queueTracker = new ExecutionOutcomeTracker();
    const QKEY = "CLOSE_POSITION:POS-1";
    const queueSent: string[] = [];
    const scripted: Array<() => Response> = [
        () => jsonResponse(202, { success: false, pending: true, duplicate: false, result: resultEnvelope("ACCEPTED", null) }),
        () => jsonResponse(202, { success: false, pending: true, duplicate: true, result: { ...resultEnvelope("ACCEPTED", null), duplicate: true } }),
        () => jsonResponse(409, { success: false, duplicate: false, result: resultEnvelope("REJECTED", { code: "DUPLICATE_REQUEST", message: "in flight" }) }),
        () => new Response("<html>gateway</html>", { status: 502 }),
        () => jsonResponse(200, { success: true, duplicate: true, result: resultEnvelope("SUCCEEDED", null) }),
    ];
    await withFetch(
        async (_url, init) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { clientRequestId?: string };
            queueSent.push(body.clientRequestId ?? "");
            const next = scripted.shift();
            if (!next) throw new Error("unexpected extra request");
            return next();
        },
        async () => {
            const queued = await queueTracker.submit(QKEY, PAYLOAD, "token");
            s.check(queued.status === "ACCEPTED", "a queued close returns ACCEPTED");
            s.check(queueTracker.isLocked(QKEY) && queueTracker.hasUnresolved(QKEY), "ACCEPTED keeps the action locked");

            const blockedQueued = await captureError(() => queueTracker.submit(QKEY, PAYLOAD, "token"));
            s.check((blockedQueued as UnifiedExecutionError)?.code === "OUTCOME_UNRESOLVED", "a new submission is blocked while ACCEPTED");
            s.check(queueSent.length === 1, "the blocked submission is never sent");

            const replayed = await queueTracker.retry(QKEY, "token");
            s.check(replayed.status === "ACCEPTED" && replayed.duplicate === true, "replaying a queued close returns it still ACCEPTED");
            s.check(queueTracker.isLocked(QKEY), "a pending replay does not unlock the UI");

            const dup = await captureError(() => queueTracker.retry(QKEY, "token"));
            s.check((dup as UnifiedExecutionError)?.code === "DUPLICATE_REQUEST", "DUPLICATE_REQUEST for a pending original is surfaced");
            s.check(queueTracker.isLocked(QKEY), "DUPLICATE_REQUEST does not unlock the UI");

            const unreadable = await captureError(() => queueTracker.retry(QKEY, "token"));
            s.check((unreadable as UnifiedExecutionError)?.code === "UNREADABLE_RESPONSE", "an unreadable response is surfaced as unknown");
            s.check(queueTracker.isLocked(QKEY), "an unreadable response keeps the lock");

            const settledQueued = await queueTracker.retry(QKEY, "token");
            s.check(settledQueued.status === "SUCCEEDED", "a confirmed terminal result settles the queued close");
            s.check(!queueTracker.isLocked(QKEY), "the lock releases only after the terminal result");
        },
    );
    s.check(queueSent.length === 5 && queueSent.every((id) => id === queueSent[0]), "every replay reuses the ORIGINAL clientRequestId");

    s.section("Replay keeps the original key (no new idempotency key minted by the client)");
    const sentIds: string[] = [];
    await withFetch(
        async (_url, init) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { clientRequestId?: string };
            sentIds.push(body.clientRequestId ?? "");
            return jsonResponse(200, { success: true, duplicate: true, result: resultEnvelope("DUPLICATE", null) });
        },
        () => executeUnified(PAYLOAD, "token"),
    );
    s.check(sentIds[0] === PAYLOAD.clientRequestId, "the caller's clientRequestId is sent unchanged");

    s.section("Automatic reconciliation: ACCEPTED settles from the stored status and never redispatches");
    const CLOSE: Omit<UnifiedExecutePayload, "clientRequestId"> = {
        accountId: "gateway_777001",
        executionType: "CLOSE_POSITION",
        positionId: "POS-R",
    };
    const MODIFY: Omit<UnifiedExecutePayload, "clientRequestId"> = {
        accountId: "gateway_777001",
        executionType: "MODIFY_POSITION",
        positionId: "POS-R",
        stopLoss: 2300,
        takeProfit: null,
    };
    const statusBody = (status: string) =>
        jsonResponse(200, { success: true, pending: status === "ACCEPTED", result: resultEnvelope(status, null) });
    let posts: string[] = [];
    let statusReads = 0;
    let statusQueue: Array<() => Response> = [];
    const routed: FetchMock = async (url, init) => {
        if (url.includes("/api/trading/execute/status")) {
            statusReads += 1;
            const next = statusQueue.shift();
            if (!next) throw new Error("unexpected status read");
            return next();
        }
        const body = JSON.parse(String(init?.body ?? "{}")) as { clientRequestId?: string };
        posts.push(body.clientRequestId ?? "");
        return jsonResponse(202, {
            success: false,
            pending: true,
            duplicate: false,
            result: resultEnvelope("ACCEPTED", null),
        });
    };
    const resetRouted = () => {
        posts = [];
        statusReads = 0;
        statusQueue = [];
    };

    const autoTracker = new ExecutionOutcomeTracker({ autoPoll: false });
    await withFetch(routed, async () => {
        resetRouted();
        const queued = await autoTracker.run(targetKeyFor(CLOSE), CLOSE, "token");
        s.check(queued.status === "ACCEPTED" && autoTracker.isLocked(targetKeyFor(CLOSE)), "a queued close keeps the target locked");

        statusQueue = [() => statusBody("ACCEPTED")];
        const stillPending = await autoTracker.reconcile(targetKeyFor(CLOSE));
        s.check(stillPending === "PENDING" && autoTracker.isLocked(targetKeyFor(CLOSE)), "status still ACCEPTED keeps the lock");

        statusQueue = [() => statusBody("SUCCEEDED")];
        const settled = await autoTracker.reconcile(targetKeyFor(CLOSE));
        s.check(settled === "SETTLED" && !autoTracker.isLocked(targetKeyFor(CLOSE)), "a terminal SUCCEEDED status releases the lock");
        s.check(posts.length === 1, "reconciliation never redispatches the execution");
        s.check(statusReads === 2, "reconciliation reads the stored status only");
    });

    s.section("Unresolved statuses keep the lock until a definitive outcome");
    const unresolvedTracker = new ExecutionOutcomeTracker({ autoPoll: false });
    await withFetch(routed, async () => {
        for (const [label, next] of [
            ["UNKNOWN status", () => statusBody("UNKNOWN")],
            ["no stored status yet (404)", () => jsonResponse(404, { success: false })],
            ["unreadable status body", () => new Response("<html>gateway</html>", { status: 502 })],
            ["network failure reading status", () => { throw new TypeError("fetch failed"); }],
        ] as const) {
            resetRouted();
            const fresh = new ExecutionOutcomeTracker({ autoPoll: false });
            await fresh.run(targetKeyFor(CLOSE), CLOSE, "token");
            statusQueue = [next];
            const outcome = await fresh.reconcile(targetKeyFor(CLOSE));
            s.check(outcome === "PENDING" && fresh.isLocked(targetKeyFor(CLOSE)), `${label} keeps the lock`);
            s.check(posts.length === 1, `${label} does not redispatch`);
        }
    });

    s.section("Shared target lock: CLOSE and MODIFY on one position block each other");
    const sharedTracker = new ExecutionOutcomeTracker({ autoPoll: false });
    s.check(targetKeyFor(CLOSE) === targetKeyFor(MODIFY), "CLOSE and MODIFY on one position share a target key");
    await withFetch(routed, async () => {
        resetRouted();
        await sharedTracker.run(targetKeyFor(CLOSE), CLOSE, "token");
        const blockedModify = await captureError(() => sharedTracker.run(targetKeyFor(MODIFY), MODIFY, "token"));
        s.check((blockedModify as UnifiedExecutionError)?.code === "OUTCOME_UNRESOLVED", "MODIFY is blocked while CLOSE is pending");
        s.check(posts.length === 1, "the blocked MODIFY is never sent");
        s.check(sharedTracker.ownerOf(targetKeyFor(CLOSE)) === posts[0], "the CLOSE request still owns the target");

        const replayClose = await sharedTracker.run(targetKeyFor(CLOSE), CLOSE, "token");
        s.check(replayClose.status === "ACCEPTED" && posts[1] === posts[0], "an identical CLOSE replays the ORIGINAL request");
    });

    const modifyFirst = new ExecutionOutcomeTracker({ autoPoll: false });
    await withFetch(routed, async () => {
        resetRouted();
        await modifyFirst.run(targetKeyFor(MODIFY), MODIFY, "token");
        const blockedClose = await captureError(() => modifyFirst.run(targetKeyFor(CLOSE), CLOSE, "token"));
        s.check((blockedClose as UnifiedExecutionError)?.code === "OUTCOME_UNRESOLVED", "CLOSE is blocked while MODIFY is pending");
        s.check(posts.length === 1, "the blocked CLOSE is never sent");
    });

    s.section("Independent targets: releasing one request does not release another target");
    const twoTargets = new ExecutionOutcomeTracker({ autoPoll: false });
    const OTHER: Omit<UnifiedExecutePayload, "clientRequestId"> = { ...CLOSE, positionId: "POS-OTHER" };
    await withFetch(routed, async () => {
        resetRouted();
        await twoTargets.run(targetKeyFor(CLOSE), CLOSE, "token");
        await twoTargets.run(targetKeyFor(OTHER), OTHER, "token");
        statusQueue = [() => statusBody("SUCCEEDED")];
        await twoTargets.reconcile(targetKeyFor(CLOSE));
        s.check(!twoTargets.isLocked(targetKeyFor(CLOSE)), "the settled target is released");
        s.check(twoTargets.isLocked(targetKeyFor(OTHER)), "the other unresolved target stays locked");
    });

    s.section("Concurrent reconciliation for one request is coalesced (no duplicate or conflicting reads)");
    const coalesced = new ExecutionOutcomeTracker({ autoPoll: false });
    let finishStatus: (response: Response) => void = () => {};
    let gatedReads = 0;
    await withFetch(
        async (url, init) => {
            if (url.includes("/api/trading/execute/status")) {
                gatedReads += 1;
                return new Promise<Response>((resolve) => {
                    finishStatus = resolve;
                });
            }
            return routed(url, init);
        },
        async () => {
            resetRouted();
            await coalesced.run(targetKeyFor(CLOSE), CLOSE, "token");
            const first = coalesced.reconcile(targetKeyFor(CLOSE));
            const second = await coalesced.reconcile(targetKeyFor(CLOSE));
            s.check(second === "PENDING", "an overlapping reconcile reports pending without a second read");
            finishStatus(statusBody("SUCCEEDED"));
            s.check((await first) === "SETTLED", "the single in-flight read settles the lock");
            s.check(gatedReads === 1 && posts.length === 1, "one status read and no redispatch");
        },
    );

    s.section("Two requests on one target: an in-flight owner is never displaced");
    const inflightTracker = new ExecutionOutcomeTracker({ autoPoll: false });
    // Only the FIRST execute POST is held open; it is still recorded when sent.
    let finishPost: () => void = () => {};
    let holdNextPost = true;
    const gatedPost: FetchMock = (url, init) => {
        if (url.includes("/api/trading/execute/status") || !holdNextPost) return routed(url, init);
        holdNextPost = false;
        const response = routed(url, init);
        return new Promise<Response>((resolve) => {
            finishPost = () => {
                void response.then(resolve);
            };
        });
    };
    await withFetch(gatedPost, async () => {
        resetRouted();
        const firstRun = inflightTracker.run(targetKeyFor(CLOSE), CLOSE, "token");
        await new Promise((r) => setTimeout(r, 0));
        s.check(posts.length === 1 && inflightTracker.isLocked(targetKeyFor(CLOSE)), "the in-flight request owns the target");
        const second = await captureError(() => inflightTracker.run(targetKeyFor(CLOSE), CLOSE, "token"));
        s.check((second as UnifiedExecutionError)?.code === "OUTCOME_UNRESOLVED", "a second request on the target is refused while the first is in flight");
        s.check(posts.length === 1, "the refused second request is never sent");
        s.check(inflightTracker.ownerOf(targetKeyFor(CLOSE)) === posts[0], "the first request still owns the target");

        finishPost();
        await firstRun;
        s.check(inflightTracker.isLocked(targetKeyFor(CLOSE)), "an ACCEPTED first request keeps the lock after send");
        statusQueue = [() => statusBody("SUCCEEDED")];
        await inflightTracker.reconcile(targetKeyFor(CLOSE));
        s.check(!inflightTracker.isLocked(targetKeyFor(CLOSE)), "the owner's settled status releases the target exactly once");
        await inflightTracker.run(targetKeyFor(CLOSE), CLOSE, "token");
        s.check(posts.length === 2 && posts[1] !== posts[0], "after release a new request gets a new clientRequestId");
    });
    inflightTracker.dispose();

    s.section("Settled-owner behaviour: a settled key accepts a fresh request with a new ID");
    const freshAfterSettle = new ExecutionOutcomeTracker({ autoPoll: false });
    await withFetch(routed, async () => {
        resetRouted();
        await freshAfterSettle.run(targetKeyFor(CLOSE), CLOSE, "token");
        statusQueue = [() => statusBody("SUCCEEDED")];
        await freshAfterSettle.reconcile(targetKeyFor(CLOSE));
        await freshAfterSettle.run(targetKeyFor(CLOSE), CLOSE, "token");
        s.check(posts.length === 2 && posts[1] !== posts[0], "after settlement a new action uses a new clientRequestId");
    });
    dispose(autoTracker, unresolvedTracker, sharedTracker, modifyFirst, twoTargets, freshAfterSettle);

    return s.finish();
}

function dispose(...trackers: ExecutionOutcomeTracker[]): void {
    for (const tracker of trackers) tracker.dispose();
}
