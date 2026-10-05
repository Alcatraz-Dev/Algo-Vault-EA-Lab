/**
 * Phase 11 — data freshness & transport state.
 *
 * The rule this file exists to enforce: a trader must never be shown a number
 * without being told how old it is, and a stale number must never be presented
 * as if it were current.
 *
 * Everything here is a pure function of timestamps, so the phone, the desktop
 * and the server reach the same verdict about the same data — which is what
 * makes it safe to gate a live order on it.
 *
 * Pure module: no I/O, no React.
 */

import type { DataFreshness, FreshnessDescriptor } from "./contracts";

/** Transport-level connectivity, independent of how old the data is. */
export type TransportState = "online" | "offline" | "reconnecting";

export interface FreshnessInput {
    /** Epoch ms of the newest datum actually rendered. `null` = nothing loaded. */
    dataTimestamp: number | null;
    /** Epoch ms now. Injected so tests are deterministic. */
    now: number;
    transport: TransportState;
    /** Where the data came from. */
    source: string;
    /** True when served from the local cache. */
    fromCache?: boolean;
    /** Feed-reported latency, if the provider publishes one. */
    providerDelayMs?: number;
    /**
     * Age at which this feed's data is considered delayed rather than live.
     * Defaults are per-timeframe-ish, not per-symbol: a 5-minute chart can be
     * 90 seconds behind and still be live, a tick chart cannot.
     */
    liveThresholdMs?: number;
    /** Age at which the data is declared stale. Must exceed `liveThresholdMs`. */
    staleThresholdMs?: number;
}

export const DEFAULT_LIVE_THRESHOLD_MS = 120_000; // 2 minutes
export const DEFAULT_STALE_THRESHOLD_MS = 600_000; // 10 minutes

/**
 * Derive the freshness verdict.
 *
 * Precedence is deliberate and is the whole point of this function:
 *
 *   no data          → STALE      (never pretend an empty view is "live")
 *   offline          → OFFLINE
 *   reconnecting     → RECONNECTING
 *   age > stale      → STALE
 *   age > live       → DELAYED
 *   otherwise        → LIVE
 *
 * `RECONNECTING` outranks a stale verdict so the user is told what the client is
 * *doing* rather than only how old the numbers are.
 */
export function describeFreshness(input: FreshnessInput): FreshnessDescriptor {
    const liveThreshold = input.liveThresholdMs ?? DEFAULT_LIVE_THRESHOLD_MS;
    const staleThreshold = input.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;

    if (input.dataTimestamp === null || !Number.isFinite(input.dataTimestamp)) {
        return {
            freshness: "stale",
            dataTimestamp: 0,
            evaluatedAt: input.now,
            source: input.source,
            fromCache: input.fromCache ?? false,
        };
    }

    const ageMs = Math.max(0, input.now - input.dataTimestamp);

    let freshness: DataFreshness;
    if (input.transport === "offline") {
        freshness = "offline";
    } else if (input.transport === "reconnecting") {
        freshness = "reconnecting";
    } else if (ageMs > staleThreshold) {
        freshness = "stale";
    } else if (ageMs > liveThreshold) {
        freshness = "delayed";
    } else {
        freshness = "live";
    }

    return {
        freshness,
        dataTimestamp: input.dataTimestamp,
        evaluatedAt: input.now,
        source: input.source,
        fromCache: input.fromCache ?? false,
        ...(input.providerDelayMs !== undefined ? { providerDelayMs: input.providerDelayMs } : {}),
    };
}

/** Convenience: is this descriptor good enough to submit a LIVE order against? */
export function isTradeableFreshness(descriptor: FreshnessDescriptor): boolean {
    return descriptor.freshness === "live";
}

/** Human-readable age, e.g. "12s", "4m", "1h 12m". */
export function formatAge(dataTimestamp: number | null, now: number): string {
    if (dataTimestamp === null || !Number.isFinite(dataTimestamp)) return "—";
    const seconds = Math.max(0, Math.floor((now - dataTimestamp) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

/**
 * The freshness thresholds for a given timeframe. A 1-minute chart is expected
 * to tick far more often than a daily one, so the "stale" verdict must scale.
 */
export function freshnessThresholdsFor(timeframe: string): {
    liveThresholdMs: number;
    staleThresholdMs: number;
} {
    const unit = timeframe.startsWith("M") ? 60_000 : timeframe.startsWith("H") ? 3_600_000 : 86_400_000;
    const interval = Number(timeframe.replace(/[^\d]/g, "")) || 1;
    const period = unit * interval;
    return {
        // Live if a bar could still legitimately be forming.
        liveThresholdMs: Math.max(30_000, period / 2),
        // Stale once two full bars have gone by without an update.
        staleThresholdMs: Math.max(180_000, period * 2),
    };
}

/**
 * Bridge the CANONICAL freshness verdict into the client transport model.
 *
 * `lib/market-data/market-truth.ts` already owns the question "is this market
 * data fresh enough to trust?", including per-timeframe thresholds and the
 * `unavailable` case. This function does not re-answer it — it maps that answer
 * onto the five-state model the UI renders. Keeping the decision in one place is
 * the whole point: a second, mobile-only notion of "stale" would drift from the
 * desktop's and eventually disagree with the risk engine.
 *
 * Transport wins when it disagrees: if the socket is down, no amount of recent
 * data age makes the view live.
 */
export function fromCanonicalFreshness(
    result: { fresh: boolean; status: "fresh" | "stale" | "unavailable"; dataAgeMs: number; category: string },
    options: { now: number; transport: TransportState; source: string; timestamp?: number | null },
): FreshnessDescriptor {
    if (options.transport === "offline") {
        return {
            freshness: "offline",
            dataTimestamp: options.timestamp ?? options.now - result.dataAgeMs,
            evaluatedAt: options.now,
            source: options.source,
            fromCache: true,
        };
    }
    if (options.transport === "reconnecting") {
        return {
            freshness: "reconnecting",
            dataTimestamp: options.timestamp ?? options.now - result.dataAgeMs,
            evaluatedAt: options.now,
            source: options.source,
            fromCache: true,
        };
    }

    // `unavailable` maps to stale, NOT to live and NOT to a neutral state: there
    // is nothing to show, and pretending otherwise is how fake data gets in.
    if (result.status === "fresh") {
        return {
            freshness: "live",
            dataTimestamp: options.timestamp ?? options.now - result.dataAgeMs,
            evaluatedAt: options.now,
            source: options.source,
            fromCache: false,
        };
    }

    return {
        freshness: "stale",
        dataTimestamp: options.timestamp ?? options.now - result.dataAgeMs,
        evaluatedAt: options.now,
        source: options.source,
        fromCache: false,
    };
}
