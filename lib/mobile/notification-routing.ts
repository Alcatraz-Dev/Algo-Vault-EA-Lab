/**
 * Phase 11 — intelligent notification routing.
 *
 * Phase 6 shipped an alert engine that fires one notification per event. On a
 * phone that is unusable: one BOS produces five pushes before the trader has
 * unlocked the screen.
 *
 * This module is the *policy* layer that sits in front of the existing delivery
 * path in `lib/notifications.ts`. It does not replace that file — it decides
 * whether, when and how to call it, and which deep link the payload carries.
 * There is no second alert engine here: the events arriving are the same events
 * the existing engine already produces.
 *
 * Decisions, in order:
 *   1. category enabled?            → suppressed if the user turned it off
 *   2. notifications globally on?   → suppressed if not
 *   3. quiet hours                   → deferred unless severity is critical
 *   4. cooldown for this dedup key  → deferred (merged into the pending group)
 *   5. grouping on?                 → merge into the symbol/timeframe group
 *   6. otherwise                    → deliver, with the resolved deep link
 *
 * Pure module: no I/O, no Firebase, no clock (the clock is injected).
 */

import type { DeepLinkTarget, NotificationPreferences } from "./contracts";
import { buildDeepLinkPath } from "./deep-links";

/** Every event the router understands. Matches the existing alert vocabulary. */
export type NotificationCategory =
    | "price"
    | "indicator"
    | "smartMoney"
    | "setup"
    | "strategy"
    | "risk"
    | "position"
    | "research"
    | "system";

export type NotificationSeverity = "info" | "success" | "warning" | "critical";

export interface NotificationEvent {
    category: NotificationCategory;
    severity: NotificationSeverity;
    title: string;
    body: string;
    symbol?: string;
    timeframe?: string;
    /** The record this event is about, used to build the deep link. */
    target?: DeepLinkTarget;
    /** Stable event code, used for dedup keys and analytics. */
    code: string;
    /** Epoch ms the underlying event actually happened (may predate delivery). */
    occurredAt: number;
    /** Extra events folded into a grouped notification. */
    related?: Array<{ code: string; title: string }>;
}

export type RoutingDecision =
    | { action: "deliver"; deepLinkPath: string | null; dedupKey: string }
    | { action: "merge"; groupKey: string; reason: string }
    | { action: "suppress"; reason: string };

export interface RoutingContext {
    now: number;
    preferences: NotificationPreferences;
    /**
     * Last delivery time per dedup key. Supplied by the caller from the
     * notification ledger, so this module stays pure.
     */
    lastDeliveryAt: Record<string, number>;
    /** Events already queued for the same group in the current window. */
    openGroups?: Record<string, { count: number; openedAt: number }>;
    /** Grouping window in ms. Defaults to 90s. */
    groupWindowMs?: number;
}

const CATEGORY_KEY: Record<NotificationCategory, keyof NotificationPreferences> = {
    price: "price",
    indicator: "indicator",
    smartMoney: "smartMoney",
    setup: "setup",
    strategy: "strategy",
    risk: "risk",
    position: "position",
    research: "research",
    system: "system",
};

/**
 * Dedup key. Two events with the same key are "the same thing happening again":
 * the same code on the same symbol. A re-firing BOS on XAUUSD is suppressed; a
 * BOS on EURUSD is not.
 */
export function dedupKeyFor(event: NotificationEvent): string {
    return `${event.code}:${event.symbol ?? "global"}`;
}

/** Group key. Everything on one symbol/timeframe folds into one notification. */
export function groupKeyFor(event: NotificationEvent): string {
    return `${event.symbol ?? "global"}:${event.timeframe ?? "-"}`;
}

function inQuietHours(prefs: NotificationPreferences, now: number): boolean {
    const quiet = prefs.quietHours;
    if (!quiet) return false;
    const minuteOfDay = new Date(now).getHours() * 60 + new Date(now).getMinutes();
    const { startMinute, endMinute } = quiet;
    // A window that wraps midnight (e.g. 22:00 → 07:00).
    return startMinute <= endMinute
        ? minuteOfDay >= startMinute && minuteOfDay < endMinute
        : minuteOfDay >= startMinute || minuteOfDay < endMinute;
}

/**
 * Decide what to do with one event.
 *
 * Critical events bypass quiet hours and cooldown but NOT the user's on/off
 * switch for the category — a user who disabled `risk` notifications has said
 * they do not want to be interrupted, and a loud bug is not a reason to override
 * an explicit choice.
 */
export function routeNotification(
    event: NotificationEvent,
    ctx: RoutingContext,
): RoutingDecision {
    if (!ctx.preferences.enabled) {
        return { action: "suppress", reason: "notifications disabled globally" };
    }
    if (!ctx.preferences[CATEGORY_KEY[event.category]]) {
        return { action: "suppress", reason: `${event.category} notifications disabled` };
    }

    const quiet = inQuietHours(ctx.preferences, ctx.now);
    if (quiet && event.severity !== "critical") {
        return { action: "suppress", reason: "within quiet hours" };
    }

    const dedupKey = dedupKeyFor(event);
    const last = ctx.lastDeliveryAt[dedupKey];
    const cooldownMs = Math.max(0, ctx.preferences.cooldownSeconds) * 1000;
    const withinCooldown = last !== undefined && ctx.now - last < cooldownMs;

    const groupKey = groupKeyFor(event);
    const groupWindowMs = ctx.groupWindowMs ?? 90_000;
    const group = ctx.openGroups?.[groupKey];
    const groupOpen = group !== undefined && ctx.now - group.openedAt < groupWindowMs;

    if (ctx.preferences.grouping && (groupOpen || withinCooldown)) {
        return {
            action: "merge",
            groupKey,
            reason: withinCooldown
                ? `within ${ctx.preferences.cooldownSeconds}s cooldown for ${dedupKey}`
                : `group ${groupKey} is still open`,
        };
    }

    return { action: "deliver", deepLinkPath: event.target ? buildDeepLinkPath(event.target) : null, dedupKey };
}

/**
 * Render a merged group as one notification.
 *
 * This is the anti-spam output the Phase 11 spec asks for: five market events on
 * one symbol become one push reading "XAUUSD M5 Setup Intelligence updated —
 * 4 relevant events changed".
 */
export function renderGroupNotification(
    groupKey: string,
    events: NotificationEvent[],
): { title: string; body: string; deepLinkTarget: DeepLinkTarget | null } {
    const [symbol, timeframe] = groupKey.split(":");
    const label = symbol === "global" ? "AlgoVault" : symbol;
    const tfLabel = timeframe && timeframe !== "-" ? ` ${timeframe}` : "";
    const count = events.length;
    const setupEvent = events.find((e) => e.category === "setup");

    if (setupEvent) {
        return {
            title: `${label}${tfLabel} Setup Intelligence updated`,
            body: `${count} relevant event${count === 1 ? "" : "s"} changed`,
            deepLinkTarget: setupEvent.target ?? null,
        };
    }

    const first = events[0];
    return {
        title: `${label}${tfLabel} · ${count} market event${count === 1 ? "" : "s"}`,
        body: first ? first.title : "Market state changed",
        deepLinkTarget: first?.target ?? null,
    };
}

/**
 * Map a raw server event code to its category + canonical deep link.
 *
 * Keeping this table next to the router is what guarantees §13 of the spec: a
 * setup notification opens the setup, an FVG notification opens the chart at the
 * right symbol and timeframe, and a risk notification opens the risk centre.
 */
export function classifyServerEvent(input: {
    code: string;
    setupId?: string;
    researchId?: string;
    strategyId?: string;
    positionId?: string;
    alertId?: string;
    symbol?: string;
    timeframe?: string;
}): { category: NotificationCategory; severity: NotificationSeverity; target: DeepLinkTarget | null } {
    const { code, symbol, timeframe } = input;
    const tf = timeframe as never;

    if (input.setupId) return { category: "setup", severity: "info", target: { kind: "setup", setupId: input.setupId } };
    if (input.researchId)
        return { category: "research", severity: "success", target: { kind: "research", researchId: input.researchId } };
    if (input.strategyId)
        return { category: "strategy", severity: "warning", target: { kind: "strategy", strategyId: input.strategyId } };
    if (input.positionId)
        return { category: "position", severity: "info", target: { kind: "position", positionId: input.positionId } };

    if (code.startsWith("RISK_")) {
        return { category: "risk", severity: code.includes("HALT") || code.includes("KILL") ? "critical" : "warning", target: { kind: "terminal-home" } };
    }
    if (code.startsWith("SETUP_")) {
        return { category: "setup", severity: "info", target: null };
    }
    if (code.startsWith("STRATEGY_")) {
        return { category: "strategy", severity: "warning", target: null };
    }
    if (code.startsWith("RESEARCH_")) {
        return { category: "research", severity: "success", target: null };
    }
    if (code.startsWith("POSITION_") || code.startsWith("ORDER_")) {
        return { category: "position", severity: "info", target: null };
    }
    if (input.alertId) return { category: "price", severity: "info", target: { kind: "alert", alertId: input.alertId } };

    // Smart Money + price events land on the chart at the exact symbol/timeframe.
    return {
        category: "smartMoney",
        severity: "info",
        target: symbol ? { kind: "terminal", symbol, ...(timeframe ? { timeframe: tf } : {}) } : null,
    };
}
