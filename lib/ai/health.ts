// AI provider account health for the admin console.
//
// ── What "health" means here ──────────────────────────────────────────────────
// One operator question, answered honestly: "if the gateway needed this provider
// account right now, would it serve the request — and would that cost money?"
// It is deliberately NOT a liveness probe: this module makes no network call and
// consumes no provider quota. Everything it reports is derived from facts the
// caller already holds (credential presence, the provider's own `isAvailable()`
// gate, the cost policy, budget utilisation and recorded usage).
//
// ── Why it is honest about ignorance ──────────────────────────────────────────
// A provider that has simply never been used this month is reported as `idle`,
// not `healthy`. Claiming "healthy" for an account nobody has called would be an
// untested claim rendered as a green badge. Likewise an unknown cost stays
// unknown, and a budget that cannot be read is surfaced through
// `stateAvailable` rather than being reported as a comfortable 0%.
//
// ── Purity ────────────────────────────────────────────────────────────────────
// No Firebase, no providers, no env mutation: every function takes the facts it
// needs as arguments, so the whole verdict matrix is testable offline.

import type { AIBudgetStatus } from "./budget";
import type { AIUsageCountersPublic, AIUsageStatus } from "./usage-events";
import type { AIErrorCode } from "./types";

/**
 * Error codes that mean "the guard refused", not "the provider failed".
 *
 * A budget block and a paid-model block are recorded on the usage stream so the
 * admin can see them, but attributing them to the provider would report a
 * perfectly healthy account as faulty the moment a cap is reached — which is
 * exactly the moment an operator is watching this page.
 */
const GUARD_ERROR_CODES: ReadonlySet<string> = new Set<AIErrorCode>([
    "AI_BUDGET_EXCEEDED",
    "PAID_MODEL_BLOCKED",
]);

/** Why a provider cannot serve at all. */
export type AIProviderGate = "credentials" | "policy" | null;

/** Which limit is currently refusing calls, if any. */
export type AIBudgetBlocker = "global" | "provider" | null;

export type AIProviderHealthState =
    /** Ready, and the recorded evidence shows it working. */
    | "healthy"
    /** Ready, but nothing this month proves it works. Not the same as healthy. */
    | "idle"
    /** Ready, but the recorded evidence shows it failing. */
    | "degraded"
    /** Ready, but a budget limit refuses every call before it is contacted. */
    | "blocked"
    /** Cannot serve at all: no credential, or gated by the current policy. */
    | "unavailable";

/** Recency signals read from the raw usage event stream. */
export interface AIProviderActivity {
    /** Events inspected for this provider inside the lookback window. */
    attempts: number;
    lastUsedAt: number | null;
    lastStatus: AIUsageStatus | null;
    lastSuccessAt: number | null;
    lastErrorAt: number | null;
    /** Sanitised code only — never a provider message. */
    lastErrorCode: string | null;
}

export function emptyAIProviderActivity(): AIProviderActivity {
    return {
        attempts: 0,
        lastUsedAt: null,
        lastStatus: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorCode: null,
    };
}

export interface AIProviderHealthInput {
    provider: string;
    name: string;
    /** `AIProvider.isAvailable()` — the gateway's own pre-flight gate. */
    available: boolean;
    /**
     * Whether a credential is present, independent of policy.
     *
     * Needed because `isAvailable()` conflates "no key" with "key present but the
     * cost policy forbids this account". Those are different problems with
     * different fixes, and reporting both as "no API key" would send an operator
     * to set a key that is already set.
     */
    credentialsConfigured: boolean;
    /** `providerHasMeteredRisk` — can this account be put on the meter. */
    meteredRisk: boolean;
    /** This provider's own limit, or `null` when no limit is configured. */
    budget: AIBudgetStatus | null;
    /** The global limit, which every provider is subject to. */
    globalBudget: AIBudgetStatus | null;
    usage: AIUsageCountersPublic;
    activity: AIProviderActivity;
}

export interface AIProviderHealth {
    provider: string;
    name: string;
    state: AIProviderHealthState;
    /** One short sentence. Never contains a secret, a key or a raw message. */
    detail: string;
    available: boolean;
    credentialsConfigured: boolean;
    meteredRisk: boolean;
    gate: AIProviderGate;
    budgetBlocked: boolean;
    blockedBy: AIBudgetBlocker;
    /** A limit is at or above the warning threshold (not yet refusing calls). */
    budgetWarning: boolean;
    budget: AIBudgetStatus | null;
    usage: AIUsageCountersPublic;
    activity: AIProviderActivity;
    /** Requests that reached a provider and were not refused by a guard. */
    attempts: number;
    /** `failedRequests` minus budget blocks: genuine provider failures. */
    providerFailures: number;
    /** `null` when nothing was recorded, rather than a misleading 0%. */
    failureRate: number | null;
}

/**
 * Failure ratio at or above which a working provider is reported as degraded.
 *
 * Overridable so an operator can tune it without a code change, but clamped to
 * (0, 1] so a typo cannot silently disable the check or mark everything broken.
 */
export function aiHealthFailureRateThreshold(): number {
    const parsed = Number.parseFloat(process.env.AI_HEALTH_FAILURE_RATE_THRESHOLD || "");
    if (!Number.isFinite(parsed) || parsed <= 0) return 0.5;
    return Math.min(parsed, 1);
}

/** Default lookback, in days, for the raw-event recency scan. */
export function aiHealthLookbackDays(): number {
    const parsed = Number.parseInt(process.env.AI_HEALTH_LOOKBACK_DAYS || "", 10);
    if (!Number.isFinite(parsed) || parsed < 1) return 2;
    return Math.min(parsed, 14);
}

/**
 * Accept a provider error code only if it looks like one.
 *
 * The code originates from an upstream response, so it is treated as untrusted
 * text: anything that is not a short opaque token is dropped rather than echoed
 * into the admin UI. A message could contain a key, an account id or a URL.
 */
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

export function sanitizeAIErrorCode(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed || !ERROR_CODE_PATTERN.test(trimmed)) return null;
    return trimmed;
}

export function isGuardErrorCode(raw: unknown): boolean {
    const code = sanitizeAIErrorCode(raw);
    return code !== null && GUARD_ERROR_CODES.has(code);
}

/**
 * Classify one provider account.
 *
 * Precedence is most-operationally-severe first, so the badge never understates
 * a problem: cannot serve, then refused by budget, then failing, then unknown,
 * then working.
 */
export function resolveAIProviderHealth(
    input: AIProviderHealthInput,
    failureRateThreshold: number = aiHealthFailureRateThreshold(),
): AIProviderHealth {
    const threshold = Number.isFinite(failureRateThreshold) && failureRateThreshold > 0
        ? Math.min(failureRateThreshold, 1)
        : 0.5;

    // A budget block is recorded with the same `error` status as a real failure,
    // but the provider was never contacted. `blockedRequests` is exactly that
    // count, so subtracting it keeps a capped provider from looking faulty.
    const providerFailures = Math.max(0, input.usage.failedRequests - input.usage.blockedRequests);
    const attempts = input.usage.successfulRequests + input.usage.failedRequests;
    const failureRate = attempts > 0 ? providerFailures / attempts : null;

    const blockedBy: AIBudgetBlocker =
        input.budget?.status === "exceeded" ? "provider"
            : input.globalBudget?.status === "exceeded" ? "global"
                : null;
    const budgetBlocked = blockedBy !== null;
    const budgetWarning =
        !budgetBlocked && (input.budget?.status === "warning" || input.globalBudget?.status === "warning");

    let state: AIProviderHealthState;
    let detail: string;
    let gate: AIProviderGate = null;

    if (!input.credentialsConfigured) {
        state = "unavailable";
        gate = "credentials";
        detail = "No API key configured, so the gateway never considers it.";
    } else if (!input.available) {
        state = "unavailable";
        gate = "policy";
        detail =
            "Credential present, but the account reports itself unavailable under the current cost policy, so it is skipped before a model is chosen.";
    } else if (budgetBlocked) {
        state = "blocked";
        detail =
            blockedBy === "global"
                ? "Refused before the provider is contacted: the global monthly budget is exhausted."
                : "Refused before the provider is contacted: this provider's monthly budget is exhausted.";
    } else if (input.activity.lastStatus === "error" && !isGuardErrorCode(input.activity.lastErrorCode)) {
        state = "degraded";
        detail = input.activity.lastErrorCode
            ? `The most recent recorded attempt failed (${input.activity.lastErrorCode}).`
            : "The most recent recorded attempt failed.";
    } else if (failureRate !== null && failureRate >= threshold) {
        state = "degraded";
        detail = `${Math.round(failureRate * 100)}% of recorded requests failed this month.`;
    } else if (attempts === 0) {
        state = "idle";
        detail = "Ready, but no request has been routed to it this month, so it is untested.";
    } else {
        state = "healthy";
        detail = "Serving normally.";
    }

    return {
        provider: input.provider,
        name: input.name,
        state,
        detail,
        available: input.available,
        credentialsConfigured: input.credentialsConfigured,
        meteredRisk: input.meteredRisk,
        gate,
        budgetBlocked,
        blockedBy,
        budgetWarning,
        budget: input.budget,
        usage: input.usage,
        activity: input.activity,
        attempts,
        providerFailures,
        failureRate,
    };
}

export interface AIProviderHealthReport {
    month: string;
    freeOnly: boolean;
    /** True when at least one limit is configured anywhere. */
    enforcementActive: boolean;
    /**
     * False when the raw-event recency scan could not be read. The page says so
     * instead of showing every provider as "no recent activity", which would
     * read as a quiet week rather than a broken reader.
     */
    activityAvailable: boolean;
    failureRateThreshold: number;
    providers: AIProviderHealth[];
    totals: {
        registered: number;
        /** Can serve a request right now: available and not budget-blocked. */
        ready: number;
        blocked: number;
        degraded: number;
        idle: number;
        unavailable: number;
    };
    /** Nothing can serve a request: the gateway has no usable account. */
    gatewayImpaired: boolean;
}

/** Roll a per-provider verdict list up into the page's headline numbers. */
export function buildAIProviderHealthReport(params: {
    month: string;
    freeOnly: boolean;
    enforcementActive: boolean;
    activityAvailable: boolean;
    providers: AIProviderHealth[];
    failureRateThreshold?: number;
}): AIProviderHealthReport {    const totals = { registered: 0, ready: 0, blocked: 0, degraded: 0, idle: 0, unavailable: 0 };

    for (const provider of params.providers) {
        totals.registered++;
        if (provider.state === "unavailable") totals.unavailable++;
        else if (provider.state === "blocked") totals.blocked++;
        else if (provider.state === "degraded") totals.degraded++;
        else if (provider.state === "idle") totals.idle++;
        if (provider.available && !provider.budgetBlocked) totals.ready++;
    }

    return {
        month: params.month,
        freeOnly: params.freeOnly,
        enforcementActive: params.enforcementActive,
        activityAvailable: params.activityAvailable,
        failureRateThreshold: params.failureRateThreshold ?? aiHealthFailureRateThreshold(),
        providers: params.providers,
        totals,
        gatewayImpaired: totals.ready === 0,
    };
}

/**
 * Credential environment variable per provider.
 *
 * `isAvailable()` deliberately answers a policy question ("may this account be
 * used right now?"), so it cannot distinguish a missing key from a policy
 * block. This map is what lets the health report say which one it is. It is
 * presence-checked only — the value is never read, returned or logged.
 *
 * A provider missing from this map still reports, just without the
 * credentials/policy distinction; the test suite asserts the map covers every
 * registered provider so a newly added one cannot silently lose the nuance.
 */
export const PROVIDER_CREDENTIAL_ENV: Readonly<Record<string, string>> = {
    gemini: "GEMINI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    opencode: "OPENCODE_API_KEY",
    codecraft: "CODECRAFT_API_KEY",
    bai: "BAI_API_KEY",
    bytez: "BYTEZ_API_KEY",
};

/** True when the provider's credential env var holds a non-empty value. */
export function hasProviderCredential(providerId: string): boolean {
    const env = PROVIDER_CREDENTIAL_ENV[String(providerId ?? "").trim().toLowerCase()];
    if (!env) return false;
    return Boolean((process.env[env] || "").trim());
}
