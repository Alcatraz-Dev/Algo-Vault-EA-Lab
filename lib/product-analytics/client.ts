"use client";

/**
 * Product Analytics — browser tracker.
 *
 * Design constraints:
 *  - NEVER blocks or slows the product. `track()` enqueues into a timer-backed
 *    buffer and returns in microseconds. No `await` on the caller's path.
 *  - Never throws. A broken tracker must not break a chart.
 *  - Respects an opt-out flag so a user can decline analytics.
 *  - Sends only sanitized allowlisted properties (the server re-validates, but
 *    we do not ship junk across the network either).
 *
 * Usage:
 *   import { track, ProductEventType } from "@/lib/product-analytics/client";
 *   track("CHART_OPENED", { symbol: "XAUUSD", timeframe: "M5" }, "chart");
 */

import { safeProps } from "./privacy";
import type { ProductEventType, ProductSurface } from "./events";

const ENDPOINT = "/api/analytics/events";
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER = 50;
const BATCH_SIZE = 10;
const ANON_KEY = "av_anon_id";
const SESSION_KEY = "av_session_id";
const OPT_OUT_KEY = "av_analytics_opt_out";

type QueuedEvent = {
    type: ProductEventType;
    surface: ProductSurface;
    props: Record<string, string | number | boolean | null>;
    clientEventId: string;
    occurredAt: number;
};

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sessionId: string | null = null;
let anonId: string | null = null;
let optedOut: boolean | null = null;

function randomId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getAnonId(): string | null {
    if (typeof window === "undefined") return null;
    try {
        let id = window.localStorage.getItem(ANON_KEY);
        if (!id) {
            id = randomId();
            window.localStorage.setItem(ANON_KEY, id);
        }
        return id;
    } catch {
        // Private browsing / storage disabled: skip anonymous identity rather
        // than throwing. Visitor counting degrades, the product does not.
        return null;
    }
}

function getSessionId(): string | null {
    if (typeof window === "undefined") return null;
    try {
        let id = window.sessionStorage.getItem(SESSION_KEY);
        if (!id) {
            id = randomId();
            window.sessionStorage.setItem(SESSION_KEY, id);
        }
        return id;
    } catch {
        return null;
    }
}

/** Whether the user has declined analytics. Defaults to enabled. */
export function isOptedOut(): boolean {
    if (optedOut !== null) return optedOut;
    if (typeof window === "undefined") return false;
    try {
        optedOut = window.localStorage.getItem(OPT_OUT_KEY) === "1";
    } catch {
        optedOut = false;
    }
    return optedOut;
}

/** Let a user opt out. Stops collection and clears the pending queue. */
export function setOptedOut(value: boolean): void {
    optedOut = value;
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(OPT_OUT_KEY, value ? "1" : "0");
    } catch {
        // Storage unavailable — in-memory flag still applies for this session.
    }
    if (value) queue = [];
}

function scheduleFlush(): void {
    if (timer) return;
    timer = setTimeout(() => {
        timer = null;
        void flush();
    }, FLUSH_INTERVAL_MS);
}

/** Send whatever is buffered. Safe to call on page hide. */
export async function flush(): Promise<void> {
    if (typeof window === "undefined" || queue.length === 0) return;
    if (isOptedOut()) {
        queue = [];
        return;
    }
    if (!navigator.onLine) return; // Keep the events; retry on the next tick.

    const batch = queue.slice(0, BATCH_SIZE);
    queue = queue.slice(batch.length);

    try {
        await fetch(ENDPOINT, {
            method: "POST",
            keepalive: true,
            headers: {
                "Content-Type": "application/json",
                ...(sessionId ? { "x-session-id": sessionId } : {}),
                ...(anonId ? { "x-anon-id": anonId } : {}),
            },
            body: JSON.stringify({ events: batch }),
        });
    } catch {
        // Network failure: drop the batch rather than retrying forever. Product
        // analytics is not worth unbounded memory growth in a flaky connection.
        return;
    }
    if (queue.length > 0) scheduleFlush();
}

let counter = 0;

/** Record a product event. Never blocks, never throws. */
export function track(
    type: ProductEventType,
    props?: Record<string, unknown>,
    surface: ProductSurface = "other"
): void {
    try {
        if (typeof window === "undefined" || isOptedOut()) return;
        if (queue.length > MAX_BUFFER) queue = queue.slice(queue.length - MAX_BUFFER);

        if (!sessionId) sessionId = getSessionId();
        if (!anonId) anonId = getAnonId();

        counter = (counter + 1) % 1_000_000;
        queue.push({
            type,
            surface,
            props: safeProps(props),
            clientEventId: `c_${Date.now().toString(36)}_${counter.toString(36)}${randomId().slice(0, 4)}`,
            occurredAt: Date.now(),
        });
        scheduleFlush();
    } catch {
        // Instrumentation must never surface to the user.
    }
}

/** Flush on page hide so a quick session is not lost. Call once from a layout. */
export function installLifecycleFlush(): () => void {
    if (typeof window === "undefined") return () => {};
    const onHide = () => {
        void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
        document.removeEventListener("visibilitychange", onHide);
        window.removeEventListener("pagehide", onHide);
    };
}
