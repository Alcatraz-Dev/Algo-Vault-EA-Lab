/**
 * Provider health tracking + circuit breaker for the Unified Intelligence
 * Fabric.
 *
 * The legacy gateway (lib/ai/health.ts) reports month-level usage facts for
 * the admin console; THIS module is the runtime guard the router consults
 * before every attempt:
 *
 *   CLOSED    → normal operation, requests flow
 *   OPEN      → provider is cooling down after repeated failures,
 *               no attempts are made (prevents retry storms)
 *   HALF_OPEN → one probe request is allowed after the cooldown elapses;
 *               success closes the circuit, failure re-opens it
 *
 * Non-retryable errors (authentication, invalid request, policy blocks) trip
 * the breaker immediately and are never retried.
 *
 * Design constraints:
 *  - In-memory per server process. Facts are recomputed cheaply after a cold
 *    start; the breaker only needs recent failure history to work.
 *  - Injectable clock + failure threshold so tests can drive the state
 *    machine deterministically without sleeps.
 */

export type IntelligenceErrorCode =
    | "RATE_LIMITED"
    | "QUOTA_EXCEEDED"
    | "MODEL_UNAVAILABLE"
    | "PROVIDER_UNAVAILABLE"
    | "TIMEOUT"
    | "INVALID_API_KEY"
    | "INVALID_REQUEST"
    | "PAID_MODEL_BLOCKED"
    | "AI_BUDGET_EXCEEDED"
    | "UNKNOWN_ERROR";

/** Errors that must never be retried against the same provider. */
const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
    "INVALID_API_KEY",
    "INVALID_REQUEST",
    "PAID_MODEL_BLOCKED",
    "AI_BUDGET_EXCEEDED",
]);

export function isNonRetryable(code: string): boolean {
    return NON_RETRYABLE_CODES.has(code);
}

export interface ProviderHealthSnapshot {
    provider: string;
    circuitState: "closed" | "open" | "half_open";
    consecutiveFailures: number;
    successes: number;
    failures: number;
    rateLimitErrors: number;
    timeouts: number;
    /** Exponentially-weighted average latency in ms (α=0.25). */
    avgLatencyMs: number | null;
    lastSuccessAt: number | null;
    lastErrorAt: number | null;
    lastErrorCode: IntelligenceErrorCode | null;
    /** Unix ms until which the provider is cooling down (open circuit). */
    cooldownUntil: number | null;
    /** 0..1 success rate over the tracked window (null when no attempts). */
    successRate: number | null;
    /** 0..1 — reliability estimate blending success rate and recency. */
    reliabilityScore: number;
}

export interface HealthOptions {
    /** Consecutive failures before the circuit opens (default 3). */
    openAfterConsecutiveFailures?: number;
    /** Base cooldown in ms when a circuit opens (default 30_000). */
    cooldownMs?: number;
    /** Maximum cooldown after repeated open events (default 10 minutes). */
    maxCooldownMs?: number;
    /** Success-rate window size (default 50 attempts). */
    windowSize?: number;
    now?: () => number;
}

const DEFAULTS = {
    openAfterConsecutiveFailures: 3,
    cooldownMs: 30_000,
    maxCooldownMs: 600_000,
    windowSize: 50,
};

interface ProviderRecord {
    circuitState: "closed" | "open" | "half_open";
    consecutiveFailures: number;
    openCount: number;
    cooldownUntil: number;
    probeInFlight: boolean;
    successes: number;
    failures: number;
    rateLimitErrors: number;
    timeouts: number;
    recent: Array<{ ok: boolean }>;
    latencies: number[];
    lastSuccessAt: number | null;
    lastErrorAt: number | null;
    lastErrorCode: IntelligenceErrorCode | null;
}

function newRecord(): ProviderRecord {
    return {
        circuitState: "closed",
        consecutiveFailures: 0,
        openCount: 0,
        cooldownUntil: 0,
        probeInFlight: false,
        successes: 0,
        failures: 0,
        rateLimitErrors: 0,
        timeouts: 0,
        recent: [],
        latencies: [],
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorCode: null,
    };
}

export class ProviderHealthTracker {
    private records = new Map<string, ProviderRecord>();
    private opts: Required<HealthOptions>;
    private now: () => number;

    constructor(options: HealthOptions = {}) {
        this.opts = {
            openAfterConsecutiveFailures:
                options.openAfterConsecutiveFailures ?? DEFAULTS.openAfterConsecutiveFailures,
            cooldownMs: options.cooldownMs ?? DEFAULTS.cooldownMs,
            maxCooldownMs: options.maxCooldownMs ?? DEFAULTS.maxCooldownMs,
            windowSize: options.windowSize ?? DEFAULTS.windowSize,
            now: options.now ?? Date.now,
        };
        this.now = this.opts.now;
    }

    private rec(provider: string): ProviderRecord {
        let r = this.records.get(provider);
        if (!r) {
            r = newRecord();
            this.records.set(provider, r);
        }
        return r;
    }

    /**
     * May this provider receive an attempt right now? When the circuit is
     * HALF_OPEN it permits exactly one probe at a time.
     */
    canAttempt(provider: string): boolean {
        const r = this.rec(provider);
        const t = this.now();
        if (r.circuitState === "open") {
            if (t >= r.cooldownUntil) {
                r.circuitState = "half_open";
                r.probeInFlight = false;
            } else {
                return false;
            }
        }
        if (r.circuitState === "half_open") {
            if (r.probeInFlight) return false;
            r.probeInFlight = true;
            return true;
        }
        return true;
    }

    /** Record the outcome of one attempt. */
    record(provider: string, outcome: { ok: boolean; latencyMs: number; errorCode?: IntelligenceErrorCode }): void {
        const r = this.rec(provider);
        const t = this.now();

        r.recent.push({ ok: outcome.ok });
        if (r.recent.length > this.opts.windowSize) r.recent.shift();
        r.latencies.push(outcome.latencyMs);
        if (r.latencies.length > this.opts.windowSize) r.latencies.shift();

        if (outcome.ok) {
            r.successes += 1;
            r.consecutiveFailures = 0;
            r.lastSuccessAt = t;
            r.lastErrorCode = null;
            if (r.circuitState !== "closed") {
                // Probe (or retried call after cooldown) succeeded: close.
                r.circuitState = "closed";
                r.openCount = 0;
                r.cooldownUntil = 0;
            }
            r.probeInFlight = false;
            return;
        }

        r.failures += 1;
        r.consecutiveFailures += 1;
        r.lastErrorAt = t;
        r.lastErrorCode = outcome.errorCode ?? "UNKNOWN_ERROR";
        if (outcome.errorCode === "RATE_LIMITED" || outcome.errorCode === "QUOTA_EXCEEDED") {
            r.rateLimitErrors += 1;
        }
        if (outcome.errorCode === "TIMEOUT") r.timeouts += 1;

        const nonRetryable = outcome.errorCode ? isNonRetryable(outcome.errorCode) : false;
        const shouldOpen =
            r.circuitState === "half_open" ||
            nonRetryable ||
            r.consecutiveFailures >= this.opts.openAfterConsecutiveFailures;

        if (shouldOpen) {
            // Exponential cooldown with cap: 30s → 60s → 120s … 10min max.
            const backoff = Math.min(
                this.opts.cooldownMs * Math.pow(2, r.openCount),
                this.opts.maxCooldownMs,
            );
            r.circuitState = "open";
            r.openCount += 1;
            r.cooldownUntil = t + backoff;
        }
        r.probeInFlight = false;
    }

    /** Force-close (admin override / "test provider" action). */
    reset(provider: string): void {
        this.records.set(provider, newRecord());
    }

    snapshot(provider: string): ProviderHealthSnapshot {
        const r = this.rec(provider);
        const attempts = r.recent.length;
        const successes = r.recent.filter((x) => x.ok).length;
        // EWMA latency, α = 0.25 (recent attempts dominate).
        let ema: number | null = null;
        for (const l of r.latencies) {
            ema = ema === null ? l : ema * 0.75 + l * 0.25;
        }
        const successRate = attempts > 0 ? successes / attempts : null;

        // Reliability: success rate first, recency as a tie-breaker boost.
        let reliability = successRate ?? 0.5;
        if (r.lastSuccessAt !== null) {
            const age = this.now() - r.lastSuccessAt;
            const recency = Math.max(0, 1 - age / (6 * 60 * 60 * 1000)); // decays over 6h
            reliability = reliability * 0.8 + recency * 0.2;
        }
        if (r.circuitState === "open") reliability = Math.min(reliability, 0.2);

        const circuitState =
            r.circuitState === "open" && this.now() >= r.cooldownUntil ? "half_open" : r.circuitState;

        return {
            provider,
            circuitState,
            consecutiveFailures: r.consecutiveFailures,
            successes: r.successes,
            failures: r.failures,
            rateLimitErrors: r.rateLimitErrors,
            timeouts: r.timeouts,
            avgLatencyMs: ema !== null ? Math.round(ema) : null,
            lastSuccessAt: r.lastSuccessAt,
            lastErrorAt: r.lastErrorAt,
            lastErrorCode: r.lastErrorCode,
            cooldownUntil: r.circuitState === "open" ? r.cooldownUntil : null,
            successRate,
            reliabilityScore: Math.round(reliability * 1000) / 1000,
        };
    }

    snapshotAll(): ProviderHealthSnapshot[] {
        return Array.from(this.records.keys()).map((p) => this.snapshot(p));
    }
}

/** Process-wide tracker used by the unified router. */
let sharedTracker: ProviderHealthTracker | null = null;

export function getSharedHealthTracker(): ProviderHealthTracker {
    if (!sharedTracker) {
        sharedTracker = new ProviderHealthTracker({
            openAfterConsecutiveFailures: Number(
                process.env.AI_HEALTH_OPEN_AFTER_FAILURES || "",
            ) || undefined,
            cooldownMs: Number(process.env.AI_HEALTH_COOLDOWN_MS || "") || undefined,
        });
    }
    return sharedTracker;
}

/** Test seam: drop the shared tracker so tests start from a clean state. */
export function resetSharedHealthTracker(): void {
    sharedTracker = null;
}
