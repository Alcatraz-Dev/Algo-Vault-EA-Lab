"use client";

/**
 * Phase 11 — mobile analytics.
 *
 * A thin, typed wrapper over the Phase 10 product-analytics tracker. It adds the
 * cross-device context the brief asks for — `platform`, `appVersion`,
 * `osVersion`, `networkState` — and nothing else.
 *
 * What it deliberately does NOT do:
 *   • introduce a second analytics pipeline (events go to the same
 *     `/api/analytics/events` ingestion path with the same privacy sanitizer)
 *   • send a device id. Counting distinct *devices* is useful; tying events to a
 *     pseudonymous per-install identifier is surveillance. The server can derive
 *     "active devices" from `mobileDevices` counts instead.
 *   • report symbol positions, balances, P&L or any free text. The sanitizer's
 *     allowlist drops them anyway; this module simply never offers them.
 */

import { track, isOptedOut } from "@/lib/product-analytics/client";
import type { ProductEventType } from "@/lib/product-analytics/events";
import { detectAppVersion, detectPlatform } from "@/lib/mobile/device";

type MobileEventType =
    | "MOBILE_SESSION_STARTED"
    | "WORKSPACE_SYNCED"
    | "WORKSPACE_CONFLICT_RESOLVED"
    | "DEEP_LINK_OPENED"
    | "NOTIFICATION_OPENED"
    | "STALE_DATA_BLOCKED_ACTION"
    | "LIVE_ORDER_BLOCKED";

/**
 * Network state at the moment of the event. Derived from the browser API, never
 * from a request the tracker itself makes — measuring our own connectivity would
 * be circular and would generate traffic to answer a question about traffic.
 */
function networkState(): "online" | "offline" {
    if (typeof navigator === "undefined") return "online";
    return navigator.onLine ? "online" : "offline";
}

/**
 * Track a mobile/cross-device event. Never throws and never blocks: a broken
 * tracker must not break a chart or a trading screen.
 */
export function trackMobile(
    type: MobileEventType,
    props: Record<string, string | number | boolean | null> = {},
): void {
    if (typeof window === "undefined") return;
    if (isOptedOut()) return;
    try {
        track(
            type as ProductEventType,
            {
                platform: detectPlatform(),
                appVersion: detectAppVersion(),
                networkState: networkState(),
                ...props,
            },
            "mobile",
        );
    } catch {
        // Analytics must never surface an error to the trader.
    }
}

/** A sync attempt finished. `outcome` is one of the SyncStatus values. */
export function trackSync(outcome: "idle" | "syncing" | "offline" | "error" | "conflict", conflicts = 0): void {
    trackMobile("WORKSPACE_SYNCED", { syncOutcome: outcome, count: conflicts });
}

/** A deep link resolved. `kind` is the target kind, never the record contents. */
export function trackDeepLink(kind: string): void {
    trackMobile("DEEP_LINK_OPENED", { deepLinkKind: kind });
}

/**
 * A safety gate refused an action. These are the most valuable Phase 11 events
 * in the whole product: they tell us how often the fail-closed rules actually
 * fire, which is the only honest way to know whether the freshness signal is too
 * aggressive on real hardware and real networks.
 */
export function trackBlockedAction(kind: "stale-data" | "live-order", blocker: string): void {
    trackMobile(kind === "live-order" ? "LIVE_ORDER_BLOCKED" : "STALE_DATA_BLOCKED_ACTION", {
        blocker,
    });
}
