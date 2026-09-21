import { pushBusEvent } from "../database";

/**
 * Internal Plugin Event Bus.
 *
 * Plugins communicate through typed events, never through direct access to
 * each other's data. Every event records a source plugin and a timestamp.
 * Consumers subscribe only to event types listed in their manifest.
 */

export const EVENT_TYPES = [
    "market.condition.detected",
    "market.anomaly.detected",
    "market.opportunity.detected",
    "strategy.pattern.detected",
    "behavior.pattern.detected",
    "risk.threshold.reached",
    "correlation.exposure.detected",
    "news.event.upcoming",
    "news.post_event_volatility",
    "plugin.execution.completed",
    "plugin.execution.failed",
    "plugin.counterfactual.completed",
    "user.configuration.updated",
    "license.expired",
] as const;

export type PluginEventType = (typeof EVENT_TYPES)[number];

export function isKnownEventType(type: string): boolean {
    return (EVENT_TYPES as readonly string[]).includes(type);
}

export async function emitEvent(input: {
    userId: string;
    sourcePlugin: string;
    type: string;
    payload: Record<string, unknown>;
    allowedTypes?: string[];
}): Promise<void> {
    if (input.allowedTypes && !input.allowedTypes.includes(input.type)) {
        return; // plugin may only emit types declared in its manifest
    }
    if (!isKnownEventType(input.type)) return;
    await pushBusEvent(input.userId, {
        type: input.type,
        sourcePlugin: input.sourcePlugin,
        payload: input.payload,
    });
}

/**
 * Returns the event types a plugin manifest permits it to subscribe to.
 * The engine re-runs subscriptions on each execution; for now the internal
 * bus is append-only and consumers can read recent events on demand.
 */
export function allowedSubscriberTypes(subscribes: string[]): string[] {
    return (subscribes || []).filter((t) => isKnownEventType(t));
}