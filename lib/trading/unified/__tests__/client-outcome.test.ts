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

    return s.finish();
}
