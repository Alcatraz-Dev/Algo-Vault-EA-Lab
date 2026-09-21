import { PluginInterval } from "../types";
import { loadMarketSnapshot, resolveTimeframe } from "./market";

/**
 * Scheduler — background execution abstraction.
 *
 * Plugins that monitor markets run server-side on a cadence. This module
 * computes the next run time for each interval type and provides the
 * `runDueTasks` entry point that a worker (Vercel cron hit, background
 * process, external scheduler) invokes. It never relies on the client.
 */

export const INTERVALS_MS: Record<Exclude<PluginInterval, "market_open" | "market_close" | "event" | "manual">, number> = {
    "10s": 10_000,
    "30s": 30_000,
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    hourly: 3_600_000,
    daily: 86_400_000,
};

export const INTERVAL_LABELS: Record<PluginInterval, string> = {
    "10s": "Every 10 seconds",
    "30s": "Every 30 seconds",
    "1m": "Every minute",
    "5m": "Every 5 minutes",
    "15m": "Every 15 minutes",
    hourly: "Every hour",
    daily: "Every day",
    market_open: "At market open",
    market_close: "At market close",
    event: "Event-based",
    manual: "Manually triggered",
};

export function roundIntervalLabel(interval: PluginInterval): string {
    return INTERVAL_LABELS[interval] || interval;
}

export function intervalMs(interval: PluginInterval): number | null {
    if (interval in INTERVALS_MS) return INTERVALS_MS[interval as keyof typeof INTERVALS_MS];
    return null;
}

/**
 * Recommended cadence for market-data providers that are rate-limited.
 * 10s/30s intervals are supported but flagged — most free providers can't
 * sustain sub-minute polling across many symbols.
 */
export function recommendedCadence(interval: PluginInterval): PluginInterval {
    if (interval === "10s" || interval === "30s") return "1m";
    return interval;
}

export function computeNextRunAt(interval: PluginInterval, fromMs: number, state?: { lastRunAt?: number | null }): number | null {
    switch (interval) {
        case "event":
        case "manual":
            return null;
        case "market_open":
        case "market_close": {
            // Daily run around the main FX session transition (07:00 UTC for
            // London open, 21:00 UTC for effective close) — approximation that
            // does not depend on exchange calendars.
            const d = new Date(fromMs);
            const hour = interval === "market_open" ? 7 : 21;
            const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0, 0);
            let next = target;
            if (interval === "market_open" && fromMs >= target) next = target + 86_400_000;
            if (interval === "market_close" && fromMs >= target) next = target + 86_400_000;
            return next;
        }
        default: {
            const ms = INTERVALS_MS[interval];
            if (!ms) return null;
            const base = state?.lastRunAt && state.lastRunAt > 0 ? state.lastRunAt : fromMs;
            return base + ms;
        }
    }
}

export function isDue(state: { status: string; nextRunAt: number | null }, now: number): boolean {
    if (state.status !== "scheduled") return false;
    if (!state.nextRunAt) return false;
    return state.nextRunAt <= now;
}

/**
 * Sanity guard against thundering-herd scheduling: never run a plugin more
 * than ~1.5× its cadence (covers a worker that missed a tick).
 */
export function driftGuard(interval: PluginInterval, lastRunAt: number | null, now: number): boolean {
    const ms = intervalMs(interval);
    if (!ms || !lastRunAt) return true;
    return now - lastRunAt < ms * 1.5;
}

export type NewsFetchResult = {
    incoming: { id: string; title: string; currency: string; impact: "High" | "Medium" | "Low"; date: string; timeUtc: string }[];
    error?: string;
};

/**
 * Fetch the economic calendar from the existing AlgoVault feed. If the
 * external feed is unavailable, returns an empty list with a clear error so
 * callers can surface a graceful configuration error instead of pretending.
 */
export async function fetchEconomicEvents(): Promise<NewsFetchResult> {
    try {
        const response = await fetch("https://n8n.w-v.co/webhook/forex-calendar", {
            next: { revalidate: 300 },
            cache: "no-store",
        });
        if (!response.ok) {
            return { incoming: [], error: "Economic calendar feed unavailable." };
        }
        const data = (await response.json()) as { events?: unknown[] };
        const events = Array.isArray(data.events) ? data.events : [];
        const now = Date.now();
        const incoming = events
            .map((raw, index) => {
                const item = raw as Record<string, unknown>;
                const impact = String(item.impact || "").toLowerCase();
                return {
                    id: `calendar_${index}`,
                    title: String(item.title || item.event || "Economic release"),
                    currency: String(item.currency || item.country || "USD").toUpperCase(),
                    impact: impact.includes("high") ? ("High" as const) : impact.includes("medium") ? ("Medium" as const) : ("Low" as const),
                    date: String(item.date || ""),
                    timeUtc: String(item.time || ""),
                };
            })
            .filter((e) => e.date || e.timeUtc)
            .slice(0, 50);
        return { incoming };
    } catch {
        return { incoming: [], error: "Economic calendar feed unavailable." };
    }
}

export { loadMarketSnapshot, resolveTimeframe };