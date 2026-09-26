// The one place where pure AI policy meets Firebase.
//
// ── Why this module exists ────────────────────────────────────────────────────
// `lib/ai/router.ts` must be importable from ordinary server code without
// dragging `firebase-admin` — and therefore service-account credentials — into a
// bundle a client component could ever reach. So the router depends on this
// module, which is dependency-clean, and this module reaches `usage-store`
// through a `import()` performed at call time, guarded by a `window` check.
//
// If Firebase is unreachable, or the module is somehow evaluated in a browser,
// every function here degrades to a no-op or to the fail-safe policy instead of
// throwing. The AI request itself is never affected.
//
// ── Testability ───────────────────────────────────────────────────────────────
// `__setAIUsageSinkForTests` and `__setAIBudgetReadersForTests` install in-memory
// doubles so the entire budget and accounting path can be exercised without a
// database and without touching a provider's quota.

import {
    AIBudgetOverrides,
    AIBudgetOverrideReader,
    AIBudgetUsageReader,
    AIBudgetUsageSnapshot,
    AIBudgetEvaluation,
    AIBudgetEvaluationInput,
    AIBudgetStatus,
    aiMonthKey,
    budgetThresholds,
    computeBudgetStatus,
    emptyAIBudgetLimits,
    envAIBudgetConfig,
    evaluateAIBudget,
    invalidateAIBudgetConfigCache,
    mergeAIBudgetConfig,
    resolveAIBudgetConfig,
    setAIBudgetOverrideReader,
    setAIBudgetUsageReader,
} from "./budget";
import { AIUsageEvent, AIUsagePersistResult, redactAIUsageError } from "./usage-events";
import { AIConfig } from "./config";

export type AIUsageSink = (event: AIUsageEvent) => Promise<AIUsagePersistResult | void>;

let usageSink: AIUsageSink | null = null;
let budgetUsageReader: AIBudgetUsageReader | null = null;
let wired = false;
/** Latched once wiring is known to be impossible, so it is attempted once, not per request. */
let wiringFailed = false;
let wiring: Promise<boolean> | null = null;

function isServerRuntime(): boolean {
    return typeof window === "undefined";
}

/**
 * Install the real Firebase-backed implementations exactly once.
 *
 * Returns false when there is no server runtime or the store could not be
 * loaded — both of which the callers treat as "accounting unavailable", never
 * as an error.
 *
 * Two failure modes are deliberately handled, because either one would
 * otherwise turn a misconfigured deployment into a per-request log storm:
 *
 *  1. The store module fails to evaluate at all (no Firebase env in this
 *     process). The reason is logged once and the failure is LATCHED, because
 *     environment variables do not appear mid-process and re-importing on
 *     every request would just repeat a known failure forever.
 *  2. The module resolves but does not expose callable implementations —
 *     which is what a bundler or a partially-evaluated module graph can
 *     produce. Installing those would mean calling `undefined` per request and
 *     logging a stack trace each time, so the shapes are validated first.
 */
async function ensureWired(): Promise<boolean> {
    if (usageSink && budgetUsageReader) return true;
    if (!isServerRuntime() || wiringFailed) return false;
    if (wiring) return wiring;

    wiring = (async () => {
        try {
            const store = await import("./usage-store");
            const persist = store.persistAIUsageEvent;
            const readUsage = store.readAIMonthBudgetUsage;
            const readOverrides = store.readAIBudgetOverrides;
            if (
                typeof persist !== "function" ||
                typeof readUsage !== "function" ||
                typeof readOverrides !== "function"
            ) {
                throw new Error("AI usage store resolved without usable implementations");
            }
            usageSink = persist;
            budgetUsageReader = readUsage;
            setAIBudgetUsageReader(readUsage);
            setAIBudgetOverrideReader(readOverrides);
            invalidateAIBudgetConfigCache();
            wired = true;
            return true;
        } catch (err) {
            wiringFailed = true;
            console.warn(`[AI Guards] Usage/budget store unavailable: ${redactAIUsageError(err)}`);
            return false;
        } finally {
            wiring = null;
        }
    })();

    return wiring;
}

export function isAIRuntimeWired(): boolean {
    return wired;
}

/**
 * Record one usage event. Never throws and never rejects.
 *
 * A failure here is logged and dropped by design: analytics must not be able to
 * fail an AI request that already succeeded.
 */
export async function recordAIUsageSafely(event: AIUsageEvent): Promise<void> {
    try {
        await ensureWired();
        if (!usageSink) return;
        const result = await usageSink(event);
        if (result && result.persisted === false && result.error) {
            console.warn(`[AI Usage] Usage persistence degraded: ${result.error}`);
        }
    } catch (err) {
        console.warn(`[AI Usage] Usage persistence failed: ${redactAIUsageError(err)}`);
    }
}

/**
 * Budget decision for one provider candidate.
 *
 * If the store cannot be loaded at all the decision is ALLOW with
 * `stateAvailable: false`, which is only reachable when no budget could even be
 * read — `evaluateAIBudget` itself applies the fail-closed rule for metered
 * providers once it does have state.
 */
export async function evaluateBudgetSafely(
    input: AIBudgetEvaluationInput,
    now?: number,
): Promise<AIBudgetEvaluation> {
    try {
        await ensureWired();
        return await evaluateAIBudget(input, now);
    } catch (err) {
        console.warn(`[AI Budget] Budget check failed: ${redactAIUsageError(err)}`);
        return {
            decision: "ALLOW",
            reason: `AI budget check unavailable: ${redactAIUsageError(err)}`,
            checks: [],
            stateAvailable: false,
        };
    }
}

// ── Admin reporting helpers ───────────────────────────────────────────────────

export interface AIBudgetStatusReport {
    month: string;
    warnThreshold: number;
    blockThreshold: number;
    global: AIBudgetStatus;
    providers: AIBudgetStatus[];
    users: AIBudgetStatus[];
    plugins: AIBudgetStatus[];
    /** True when at least one limit is configured anywhere. */
    enforcementActive: boolean;
}

/**
 * Budget utilisation for the admin UI.
 *
 * Only scopes that actually have a limit configured are listed: reporting a
 * provider with no cap as "unlimited / 0%" would imply it is being monitored.
 */
export async function getAIBudgetStatusReport(
    month: string = aiMonthKey(),
): Promise<AIBudgetStatusReport> {
    await ensureWired();
    const thresholds = budgetThresholds();
    const config = mergeAIBudgetConfig(envAIBudgetConfig(), await resolveAIBudgetConfig());

    const usage: AIBudgetUsageSnapshot = budgetUsageReader
        ? await budgetUsageReader(month).catch(() => ({
            stateAvailable: false,
            totals: { requests: 0, successfulRequests: 0, failedRequests: 0, blockedRequests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsdMicros: 0, costUnknownRequests: 0 },
            providers: {},
            users: {},
            dimensions: {},
        }))
        : { stateAvailable: false, totals: { requests: 0, successfulRequests: 0, failedRequests: 0, blockedRequests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsdMicros: 0, costUnknownRequests: 0 }, providers: {}, users: {}, dimensions: {} };

    const empty = {
        requests: 0, successfulRequests: 0, failedRequests: 0, blockedRequests: 0,
        promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsdMicros: 0, costUnknownRequests: 0,
    };

    const providers = Object.entries(config.providers)
        .filter(([, limits]) => limits.monthlyUsd !== null || limits.monthlyTokens !== null)
        .map(([id, limits]) =>
            computeBudgetStatus("provider", id, limits, usage.providers[id] ?? empty, thresholds),
        )
        .sort((a, b) => (b.tokenUtilization ?? 0) - (a.tokenUtilization ?? 0));

    const users = Object.entries(config.users)
        .filter(([, limits]) => limits.monthlyUsd !== null || limits.monthlyTokens !== null)
        .map(([id, limits]) =>
            computeBudgetStatus("user", id, limits, usage.users[id] ?? empty, thresholds),
        )
        .sort((a, b) => (b.tokenUtilization ?? 0) - (a.tokenUtilization ?? 0))
        .slice(0, 50);

    const plugins = Object.entries(config.plugins)
        .filter(([, limits]) => limits.monthlyUsd !== null || limits.monthlyTokens !== null)
        .map(([id, limits]) =>
            computeBudgetStatus("plugin", id, limits, usage.dimensions[id] ?? empty, thresholds),
        )
        .sort((a, b) => (b.tokenUtilization ?? 0) - (a.tokenUtilization ?? 0))
        .slice(0, 50);

    const globalHasLimit = config.global.monthlyUsd !== null || config.global.monthlyTokens !== null;

    return {
        month,
        warnThreshold: thresholds.warn,
        blockThreshold: thresholds.block,
        global: computeBudgetStatus(
            "global",
            "global",
            globalHasLimit ? config.global : emptyAIBudgetLimits(),
            usage.totals,
            thresholds,
        ),
        providers,
        users,
        plugins,
        enforcementActive: globalHasLimit || providers.length > 0 || users.length > 0 || plugins.length > 0,
    };
}

/** Effective (env + override) limits, for the admin editor. */
export async function getEffectiveAIBudgetConfig() {
    return resolveAIBudgetConfig();
}

/** Persist admin budget edits and drop the config cache so they take effect now. */
export async function applyAIBudgetOverrides(patch: AIBudgetOverrides): Promise<void> {
    await ensureWired();
    const store = await import("./usage-store");
    await store.writeAIBudgetOverrides(patch);
    invalidateAIBudgetConfigCache();
}

// ── Test seams ────────────────────────────────────────────────────────────────

export function __setAIUsageSinkForTests(sink: AIUsageSink | null): void {
    usageSink = sink;
    wired = sink !== null;
}

export function __setAIBudgetReadersForTests(
    usage: AIBudgetUsageReader | null,
    overrides?: AIBudgetOverrideReader | null,
): void {
    budgetUsageReader = usage;
    setAIBudgetUsageReader(usage);
    setAIBudgetOverrideReader(overrides ?? null);
    invalidateAIBudgetConfigCache();
}

export function __resetAIRuntimeGuards(): void {
    usageSink = null;
    budgetUsageReader = null;
    wired = false;
    wiringFailed = false;
    wiring = null;
    invalidateAIBudgetConfigCache();
}

export { AIConfig };
