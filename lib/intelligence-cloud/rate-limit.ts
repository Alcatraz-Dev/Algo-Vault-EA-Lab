/**
 * Intelligence Cloud — Rate Limiting & Usage Metering (Phase 13)
 *
 * Rate limits are configuration, not hard-coded constants scattered through the
 * application. A policy is resolved from, in precedence order:
 *
 *   per-key override  →  tenant plan  →  endpoint policy  →  global fallback
 *
 * The counter store is RTDB-backed with an in-process cache, so limits hold
 * across serverless instances while a burst does not turn every request into a
 * database round-trip.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { CLOUD_ROOT } from "./api-keys";
import { errors } from "./errors";
import { sanitizeSegment, type TenantPlan } from "./tenancy";

export type RateLimitWindow = "second" | "minute" | "hour" | "day";

export interface RateLimitPolicy {
    /** Sustained requests per window. 0 ⇒ unlimited for that window. */
    requestsPerMinute?: number;
    requestsPerHour?: number;
    requestsPerDay?: number;
}

/**
 * Endpoint cost weights. A research submission costs more of the budget than a
 * quote read, which keeps quota abuse from being trivially shaped by endpoint.
 */
export const ENDPOINT_COST: Record<string, number> = {
    "GET /v1/market": 1,
    "GET /v1/indicators": 1,
    "GET /v1/smart-money": 2,
    "GET /v1/setups": 2,
    "GET /v1/strategies": 2,
    "POST /v1/research": 10,
    "GET /v1/research": 1,
    "POST /v1/strategies/validate": 3,
};

/**
 * Plan defaults. Configuration lives here rather than inline in routes so that
 * commercial changes do not require touching business logic.
 */
export const PLAN_RATE_LIMITS: Record<TenantPlan, RateLimitPolicy> = {
    developer: { requestsPerMinute: 60, requestsPerHour: 2_000, requestsPerDay: 20_000 },
    professional: { requestsPerMinute: 240, requestsPerHour: 10_000, requestsPerDay: 100_000 },
    business: { requestsPerMinute: 1_000, requestsPerHour: 50_000, requestsPerDay: 500_000 },
    enterprise: { requestsPerMinute: 0, requestsPerHour: 0, requestsPerDay: 0 }, // negotiated
};

/** Used when a caller has no resolvable plan (e.g. legacy single-user keys). */
export const FALLBACK_RATE_LIMITS: RateLimitPolicy = { requestsPerMinute: 30, requestsPerDay: 5_000 };

export interface RateLimitDecision {
    allowed: boolean;
    limit: number;
    remaining: number;
    /** Epoch seconds at which the caller may retry. */
    resetAtSeconds: number;
    /** Which window blocked the request, when blocked. */
    window?: RateLimitWindow;
    policy: RateLimitPolicy;
}

const WINDOW_MS: Record<RateLimitWindow, number> = {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
};

// ── Counter store ───────────────────────────────────────────────────────────

/**
 * Fixed-window counters in RTDB.
 *
 * Fixed windows (not sliding/token buckets) because they map onto a single RTDB
 * node per window — cheap to increment atomically across instances, which is
 * what actually bounds abuse here.
 */
interface WindowCounter {
    count: number;
    resetAt: number;
}

export interface CounterStore {
    read(key: string): Promise<WindowCounter | null>;
    /** Atomic increment. Returns the new count. */
    increment(key: string, ttlMs: number): Promise<number>;
}

const cache = new Map<string, { value: WindowCounter; readAt: number }>();
const CACHE_TTL_MS = 1_000;

export const rtdbCounterStore: CounterStore = {
    async read(key) {
        const cached = cache.get(key);
        if (cached && Date.now() - cached.readAt < CACHE_TTL_MS) return cached.value;
        const snap = await adminDatabase.ref(`${CLOUD_ROOT}/rateLimits/${key}`).get();
        const value = snap.exists() ? (snap.val() as WindowCounter) : null;
        if (value) cache.set(key, { value, readAt: Date.now() });
        return value;
    },
    async increment(key, ttlMs) {
        const ref = adminDatabase.ref(`${CLOUD_ROOT}/rateLimits/${key}`);
        const now = Date.now();
        // Transaction makes the read-modify-write atomic across instances.
        const result = await ref.transaction((current: WindowCounter | null) => {
            if (!current || current.resetAt <= now) {
                return { count: 1, resetAt: now + ttlMs } as WindowCounter;
            }
            return { count: (current.count ?? 0) + 1, resetAt: current.resetAt } as WindowCounter;
        });
        const committed = (result.snapshot?.val() as WindowCounter | null) ?? { count: 1, resetAt: now + ttlMs };
        cache.set(key, { value: committed, readAt: now });
        return committed.count;
    },
};

// ── Policy resolution ───────────────────────────────────────────────────────

/**
 * Merge limit sources so the *tightest* limit at each window wins. Precedence
 * matters: a per-key override must be able to lower a plan limit, and a key
 * override must never be able to raise past its plan's commercial ceiling
 * without an explicit negotiated plan.
 */
export function resolvePolicy(...sources: Array<RateLimitPolicy | undefined | null>): RateLimitPolicy {
    const out: RateLimitPolicy = {};
    for (const source of sources) {
        if (!source) continue;
        for (const window of ["requestsPerMinute", "requestsPerHour", "requestsPerDay"] as const) {
            const value = source[window];
            if (value === undefined) continue;
            const current = out[window];
            // 0 means "unlimited"; never let an unlimited override mask a limit.
            if (current === undefined) out[window] = value;
            else if (value === 0) out[window] = 0;
            else out[window] = Math.min(current, value);
        }
    }
    return out;
}

export function endpointCost(endpoint: string): number {
    return ENDPOINT_COST[endpoint] ?? 1;
}

// ── Enforcement ─────────────────────────────────────────────────────────────

export interface RateLimitInput {
    /** Dimensions the caller is identified by. All are optional but at least one is required. */
    tenantId?: string;
    apiKeyId?: string;
    ip?: string;
    endpoint: string;
    plan?: TenantPlan;
    keyOverride?: RateLimitPolicy | null;
    store?: CounterStore;
}

/** Identity dimension precedence — first present wins, giving a stable bucket key. */
function dimensionKey(input: RateLimitInput): string {
    if (input.tenantId && input.apiKeyId) return `key:${sanitizeSegment(input.apiKeyId)}`;
    if (input.apiKeyId) return `key:${sanitizeSegment(input.apiKeyId)}`;
    if (input.tenantId) return `tenant:${sanitizeSegment(input.tenantId)}`;
    if (input.ip) return `ip:${sanitizeSegment(input.ip)}`;
    return "anonymous";
}

/**
 * Consume budget for one request.
 *
 * Checks each window from tightest to loosest and consumes cost from all of
 * them, so a caller cannot pass the daily ceiling by spending only the hourly
 * allowance. Throws RATE_LIMITED (carrying `retryAfterSeconds`) when any window
 * is exhausted.
 */
export async function consumeRateLimit(input: RateLimitInput): Promise<RateLimitDecision> {
    const store = input.store ?? rtdbCounterStore;
    const dimension = dimensionKey(input);
    const cost = endpointCost(input.endpoint);

    const policy = resolvePolicy(
        input.keyOverride,
        input.plan ? PLAN_RATE_LIMITS[input.plan] : undefined,
        FALLBACK_RATE_LIMITS
    );

    const windows: Array<[RateLimitWindow, keyof RateLimitPolicy]> = [
        ["minute", "requestsPerMinute"],
        ["hour", "requestsPerHour"],
        ["day", "requestsPerDay"],
    ];

    // Pre-flight the tightest window so an over-budget caller does not burn
    // budget in the looser windows before being rejected.
    for (const [window, field] of windows) {
        const limit = policy[field];
        if (limit === undefined || limit === 0) continue;
        const counter = await store.read(`${dimension}:${window}`);
        const now = Date.now();
        const used = counter && counter.resetAt > now ? counter.count : 0;
        if (used + cost > limit) {
            const resetAtSeconds = Math.ceil((counter?.resetAt ?? now + WINDOW_MS[window]) / 1000);
            throw errors.rateLimited(Math.max(1, resetAtSeconds - Math.floor(now / 1000)));
        }
    }

    let minRemaining = Number.POSITIVE_INFINITY;
    let limitingLimit = 0;
    let resetAtSeconds = 0;

    for (const [window, field] of windows) {
        const limit = policy[field];
        if (limit === undefined || limit === 0) continue;
        const count = await store.increment(`${dimension}:${window}`, WINDOW_MS[window]);
        const remaining = Math.max(0, limit - count);
        const resetAt = Math.ceil((Date.now() + WINDOW_MS[window]) / 1000);
        if (remaining < minRemaining) {
            minRemaining = remaining;
            limitingLimit = limit;
            resetAtSeconds = resetAt;
        }
    }

    return {
        allowed: true,
        limit: limitingLimit,
        remaining: minRemaining === Number.POSITIVE_INFINITY ? 0 : minRemaining,
        resetAtSeconds,
        policy,
    };
}

/** Read-only budget check, for portal display. Consumes nothing. */
export async function inspectRateLimit(input: RateLimitInput): Promise<RateLimitDecision> {
    const store = input.store ?? rtdbCounterStore;
    const dimension = dimensionKey(input);
    const policy = resolvePolicy(
        input.keyOverride,
        input.plan ? PLAN_RATE_LIMITS[input.plan] : undefined,
        FALLBACK_RATE_LIMITS
    );
    const now = Date.now();
    let remaining = Number.POSITIVE_INFINITY;
    let limit = 0;
    for (const window of ["minute", "hour", "day"] as const) {
        const field = `requestsPer${window[0].toUpperCase()}${window.slice(1)}` as keyof RateLimitPolicy;
        const windowLimit = policy[field];
        if (windowLimit === undefined || windowLimit === 0) continue;
        const counter = await store.read(`${dimension}:${window}`);
        const used = counter && counter.resetAt > now ? counter.count : 0;
        const left = Math.max(0, windowLimit - used);
        if (left < remaining) {
            remaining = left;
            limit = windowLimit;
        }
    }
    return {
        allowed: remaining > 0,
        limit,
        remaining: remaining === Number.POSITIVE_INFINITY ? 0 : remaining,
        resetAtSeconds: Math.ceil((now + WINDOW_MS.minute) / 1000),
        policy,
    };
}

/** Test seam: drop the in-process counter cache. */
export function __resetRateLimitCacheForTests(): void {
    cache.clear();
}

// ── Usage metering ──────────────────────────────────────────────────────────

export type UsageCategory =
    | "api.request"
    | "market.data"
    | "indicator.compute"
    | "smc.compute"
    | "setup.query"
    | "research.job"
    | "backtest.job"
    | "ai.call"
    | "webhook.delivery";

export type UsageResult = "success" | "error" | "rate_limited" | "unauthorized";

/**
 * One billable usage record.
 *
 * These are actual observed events only — never estimates. `units` is derived
 * from the computation cost metadata attached to the real response.
 */
export interface UsageRecord {
    tenantId: string;
    apiKeyId?: string;
    userId?: string;
    requestId: string;
    category: UsageCategory;
    endpoint: string;
    at: number;
    latencyMs: number;
    /** Billable weight; 1 = one LOW-cost operation. */
    units: number;
    result: UsageResult;
    /** HTTP status, when the request produced one. */
    status?: number;
    /** Data timestamp of the intelligence served, for freshness-aware billing. */
    dataTimestamp?: number;
}

function dayKey(at: number): string {
    return new Date(at).toISOString().slice(0, 10);
}

/**
 * Persist a usage record and roll it into per-day aggregates.
 *
 * The append-only record is the billing source of truth; the aggregate exists
 * only to keep portal dashboards off an unbounded scan.
 */
export async function recordUsage(record: UsageRecord): Promise<void> {
    const tenant = sanitizeSegment(record.tenantId);
    const day = dayKey(record.at);
    const base = `${CLOUD_ROOT}/usage/${tenant}/${day}`;

    const writes: Array<Promise<unknown>> = [
        adminDatabase.ref(`${base}/records/${record.requestId}`).set(record),
    ];

    // Aggregate counters per category.
    const categoryCounter = adminDatabase.ref(`${base}/categories/${record.category}`);
    writes.push(
        categoryCounter.transaction((current: { requests: number; units: number } | null) => {
            const next = {
                requests: (current?.requests ?? 0) + 1,
                units: (current?.units ?? 0) + record.units,
            };
            return record.result === "success" ? next : (current ?? { requests: 0, units: 0 });
        })
    );

    await Promise.all(writes).catch((error) => {
        // Usage loss must not fail the caller's intelligence request.
        console.error("[intelligence-cloud] failed to record usage", error);
    });
}

/** Aggregate usage for a tenant day, as consumed by the developer portal. */
export async function getTenantUsage(
    tenantId: string,
    day: string
): Promise<{ requests: number; units: number; byCategory: Record<string, { requests: number; units: number }> }> {
    const snap = await adminDatabase
        .ref(`${CLOUD_ROOT}/usage/${sanitizeSegment(tenantId)}/${day}/categories`)
        .get();
    const byCategory: Record<string, { requests: number; units: number }> = {};
    let requests = 0;
    let units = 0;
    snap.forEach((child) => {
        const value = child.val() as { requests: number; units: number };
        byCategory[child.key as string] = { requests: value.requests, units: value.units };
        requests += value.requests;
        units += value.units;
    });
    return { requests, units, byCategory };
}
