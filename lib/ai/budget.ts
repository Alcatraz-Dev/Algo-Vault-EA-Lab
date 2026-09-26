// AI budget policy: configuration resolution, threshold maths, and the
// pre-flight decision that the router consults BEFORE every provider call.
//
// This module is PURE with respect to persistence. It reads configuration and
// usage through two injectable functions, both installed by `lib/ai/usage-store`
// (Firebase RTDB) on the server, and both replaceable in tests. There is no
// Firebase import here, so the policy can be exercised without a database and
// without credentials.
//
// ── Budget period ─────────────────────────────────────────────────────────────
// Budgets are evaluated against a `YYYY-MM` month key derived in UTC. Nothing
// is reset destructively: when the month rolls over the key simply names a
// different node, and the previous month's history is still there to read.
//
// ── Fail-safe policy (documented deliberately) ────────────────────────────────
//   * Usage accounting is best-effort. If persisting an event fails the AI
//     result is still returned; analytics must never take down the product.
//   * Budget enforcement is the opposite. A budget that is configured but whose
//     usage cannot be read means "we cannot prove we are under the limit".
//     For a provider that can incur cost, that is treated as BLOCK (fail
//     closed). For a provider that provably cannot incur cost, the request is
//     allowed, because an analytics outage must not take down free traffic.

import { providerHasMeteredRisk } from "./models";
import {
    AIUsageCounters,
    AIUsageSource,
    emptyUsageCounters,
    toUsageCounters,
    usdToMicros,
} from "./usage-events";

export type AIBudgetScope = "global" | "provider" | "user" | "plugin";
export type AIBudgetDecision = "ALLOW" | "WARN" | "BLOCK";
export type AIBudgetLimitKind = "tokens" | "cost";

/** Per-scope limits. `null` means "this dimension is not limited". */
export interface AIBudgetLimits {
    monthlyUsd: number | null;
    monthlyTokens: number | null;
}

export interface AIBudgetConfig {
    global: AIBudgetLimits;
    providers: Record<string, AIBudgetLimits>;
    users: Record<string, AIBudgetLimits>;
    plugins: Record<string, AIBudgetLimits>;
}

export function emptyAIBudgetLimits(): AIBudgetLimits {
    return { monthlyUsd: null, monthlyTokens: null };
}

/** Shape persisted at `/aiBudgets`, i.e. the admin-editable overrides. */
export interface AIBudgetOverrides {
    global?: Partial<AIBudgetLimits>;
    providers?: Record<string, Partial<AIBudgetLimits>>;
    users?: Record<string, Partial<AIBudgetLimits>>;
    plugins?: Record<string, Partial<AIBudgetLimits>>;
}

export function emptyAIBudgetConfig(): AIBudgetConfig {
    return {
        global: emptyAIBudgetLimits(),
        providers: {},
        users: {},
        plugins: {},
    };
}

/** `YYYY-MM` in UTC. The month key is the reset mechanism. */
export function aiMonthKey(now: number = Date.now()): string {
    return new Date(now).toISOString().slice(0, 7);
}

/** `YYYY-MM-DD` in UTC. */
export function aiDayKey(now: number = Date.now()): string {
    return new Date(now).toISOString().slice(0, 10);
}

function parseLimit(raw: string | undefined): number | null {
    if (raw === undefined) return null;
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    // A negative limit would block everything; treat it as misconfiguration.
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const PROVIDER_ENV = /^AI_PROVIDER_(.+)_MONTHLY_(BUDGET_USD|TOKEN_LIMIT)$/;

/**
 * Environment baseline.
 *
 * Provider limits are discovered by scanning for the
 * `AI_PROVIDER_<ID>_MONTHLY_*` convention rather than from a hardcoded provider
 * list, so adding a provider needs no change here and no provider name is
 * assumed anywhere in this module. User and plugin limits are RTDB-only: their
 * keyspace is unbounded, so an env var could not express them.
 */
export function envAIBudgetConfig(): AIBudgetConfig {
    const config = emptyAIBudgetConfig();

    config.global = {
        monthlyUsd: parseLimit(process.env.GLOBAL_AI_MONTHLY_BUDGET_USD),
        monthlyTokens: parseLimit(process.env.GLOBAL_AI_MONTHLY_TOKEN_LIMIT),
    };

    for (const [key, value] of Object.entries(process.env)) {
        if (!key.startsWith("AI_PROVIDER_")) continue;
        const match = PROVIDER_ENV.exec(key);
        if (!match) continue;
        const providerId = match[1].toLowerCase();
        if (!config.providers[providerId]) config.providers[providerId] = emptyAIBudgetLimits();
        const limit = parseLimit(value);
        if (match[2] === "BUDGET_USD") config.providers[providerId].monthlyUsd = limit;
        else config.providers[providerId].monthlyTokens = limit;
    }

    return config;
}

function mergeLimits(
    base: AIBudgetLimits,
    override: Partial<AIBudgetLimits> | undefined,
): AIBudgetLimits {
    if (!override) return base;
    return {
        monthlyUsd: override.monthlyUsd === undefined ? base.monthlyUsd : override.monthlyUsd,
        monthlyTokens:
            override.monthlyTokens === undefined ? base.monthlyTokens : override.monthlyTokens,
    };
}

function mergeScope(
    base: Record<string, AIBudgetLimits>,
    override: Record<string, Partial<AIBudgetLimits>> | undefined,
): Record<string, AIBudgetLimits> {
    if (!override) return base;
    const merged = { ...base };
    for (const [key, value] of Object.entries(override)) {
        if (!key) continue;
        merged[key] = mergeLimits(merged[key] ?? emptyAIBudgetLimits(), value);
    }
    return merged;
}

/**
 * RTDB overrides take precedence over the env baseline, per limit.
 *
 * Per-limit rather than per-scope so an admin can tighten one number in the UI
 * without having to restate the rest of the environment configuration.
 */
export function mergeAIBudgetConfig(
    base: AIBudgetConfig,
    overrides: AIBudgetOverrides | null | undefined,
): AIBudgetConfig {
    if (!overrides) return base;
    return {
        global: mergeLimits(base.global, overrides.global),
        providers: mergeScope(base.providers, overrides.providers),
        users: mergeScope(base.users, overrides.users),
        plugins: mergeScope(base.plugins, overrides.plugins),
    };
}

export interface AIBudgetThresholds {
    warn: number;
    block: number;
}

/** Configurable share-of-limit thresholds. `>= warn` warns, `>= block` blocks. */
export function budgetThresholds(): AIBudgetThresholds {
    const parse = (raw: string | undefined, fallback: number): number => {
        const parsed = parseFloat(raw ?? "");
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    const warn = parse(process.env.AI_BUDGET_WARN_THRESHOLD, 0.8);
    const block = parse(process.env.AI_BUDGET_BLOCK_THRESHOLD, 1);
    // A warn threshold at or above the block threshold would make the warning
    // state unreachable; clamp it so WARN always remains a distinct outcome.
    return { warn: Math.min(warn, block - 0.01), block };
}

// ── Usage + configuration readers (installed server-side) ─────────────────────

export interface AIBudgetUsageSnapshot {
    /** False when the usage nodes could not be read. Drives fail-closed. */
    stateAvailable: boolean;
    totals: AIUsageCounters;
    providers: Record<string, AIUsageCounters>;
    users: Record<string, AIUsageCounters>;
    dimensions: Record<string, AIUsageCounters>;
}

export function emptyAIBudgetUsageSnapshot(stateAvailable: boolean): AIBudgetUsageSnapshot {
    return {
        stateAvailable,
        totals: emptyUsageCounters(),
        providers: {},
        users: {},
        dimensions: {},
    };
}

export function unavailableAIBudgetUsageSnapshot(): AIBudgetUsageSnapshot {
    return emptyAIBudgetUsageSnapshot(false);
}

/** Serialized usage readers so N concurrent checks share one database read. */
export interface AIBudgetUsageReader {
    (month: string): Promise<AIBudgetUsageSnapshot>;
}

export interface AIBudgetOverrideReader {
    (): Promise<AIBudgetOverrides | null>;
}

let usageReader: AIBudgetUsageReader = async () => unavailableAIBudgetUsageSnapshot();
let overrideReader: AIBudgetOverrideReader = async () => null;

export function setAIBudgetUsageReader(fn: AIBudgetUsageReader | null): void {
    usageReader = fn ?? (async () => unavailableAIBudgetUsageSnapshot());
}

export function setAIBudgetOverrideReader(fn: AIBudgetOverrideReader | null): void {
    overrideReader = fn ?? (async () => null);
}

let usageReadInFlight: Promise<AIBudgetUsageSnapshot> | null = null;
let usageReadMonth: string | null = null;

/**
 * Read this month's usage, de-duplicating concurrent reads.
 *
 * Usage is deliberately NOT cached across time: a stale usage figure would
 * under-count spend and quietly let an exhausted budget through. What is shared
 * is only the read *in flight*, so a burst of simultaneous AI calls costs one
 * database round-trip rather than one per call.
 */
export async function readAIBudgetUsage(month: string): Promise<AIBudgetUsageSnapshot> {
    if (usageReadInFlight && usageReadMonth === month) return usageReadInFlight;

    const pending = (async (): Promise<AIBudgetUsageSnapshot> => {
        try {
            return await usageReader(month);
        } catch {
            // A reader that throws is indistinguishable from one that could not
            // connect: either way the state is unavailable and enforcement must
            // fail closed for metered providers.
            return unavailableAIBudgetUsageSnapshot();
        }
    })();

    usageReadInFlight = pending;
    usageReadMonth = month;
    try {
        return await pending;
    } finally {
        if (usageReadInFlight === pending) {
            usageReadInFlight = null;
            usageReadMonth = null;
        }
    }
}

export async function readAIBudgetOverrides(): Promise<AIBudgetOverrides | null> {
    try {
        return await overrideReader();
    } catch {
        return null;
    }
}

let configCache: { value: AIBudgetConfig; at: number } | null = null;

function configTtlMs(): number {
    const parsed = parseInt(process.env.AI_BUDGET_CONFIG_TTL_MS || "15000", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15000;
}

/** Drop the resolved-config cache. Called after an admin edits a budget. */
export function invalidateAIBudgetConfigCache(): void {
    configCache = null;
}

/**
 * Env baseline merged with RTDB overrides, cached briefly.
 *
 * Unlike usage, configuration is cached: a limit that is up to
 * `AI_BUDGET_CONFIG_TTL_MS` stale is an operational lag of seconds, whereas an
 * uncached config would put a database read on every single AI request even in
 * deployments that have configured no budgets at all. The admin PATCH route
 * invalidates this immediately.
 */
export async function resolveAIBudgetConfig(): Promise<AIBudgetConfig> {
    if (configCache && Date.now() - configCache.at < configTtlMs()) {
        return configCache.value;
    }
    const overrides = await readAIBudgetOverrides();
    const value = mergeAIBudgetConfig(envAIBudgetConfig(), overrides);
    configCache = { value, at: Date.now() };
    return value;
}

// ── Evaluation ────────────────────────────────────────────────────────────────

export class AIBudgetError extends Error {
    readonly code = "AI_BUDGET_EXCEEDED" as const;
    readonly evaluation: AIBudgetEvaluation;

    constructor(evaluation: AIBudgetEvaluation) {
        super(evaluation.reason);
        this.name = "AIBudgetError";
        this.evaluation = evaluation;
    }
}

export interface AIBudgetCheck {
    scope: AIBudgetScope;
    /** Which limit tripped: the global pool, a provider, a user, a plugin. */
    dimension: string;
    kind: AIBudgetLimitKind;
    used: number;
    limit: number;
    /** Share of the limit consumed. May exceed 1 once over budget. */
    utilization: number;
    decision: AIBudgetDecision;
}

export interface AIBudgetEvaluation {
    decision: AIBudgetDecision;
    reason: string;
    checks: AIBudgetCheck[];
    /** Set when the state could not be read; true means we blocked anyway. */
    stateAvailable: boolean;
}

export interface AIBudgetEvaluationInput {
    provider: string;
    model?: string;
    userId?: string;
    source?: AIUsageSource;
    sourceId?: string;
}

function decideFor(utilization: number, thresholds: AIBudgetThresholds): AIBudgetDecision {
    if (utilization >= thresholds.block) return "BLOCK";
    if (utilization >= thresholds.warn) return "WARN";
    return "ALLOW";
}

function formatUsd(value: number): string {
    return `$${value.toFixed(4)}`;
}

function describeCheck(check: AIBudgetCheck): string {
    const kind = check.kind === "tokens"
        ? `${Math.round(check.used).toLocaleString("en-US")}/${Math.round(check.limit).toLocaleString("en-US")} tokens`
        : `${formatUsd(check.used)}/${formatUsd(check.limit)}`;
    return `${check.dimension} ${kind} (${(check.utilization * 100).toFixed(1)}%)`;
}

/**
 * Decide whether one request may proceed.
 *
 * Order of evaluation is significant: the global check is computed first so its
 * reason is the one reported when several scopes are simultaneously over, and
 * so a provider-level limit can never be reported as if the global pool were
 * fine when it is not. Because the router calls this once per provider
 * candidate, a global block is re-derived for every attempt — which is what
 * makes the global budget unbypassable through fallback.
 */
export async function evaluateAIBudget(
    input: AIBudgetEvaluationInput,
    now: number = Date.now(),
): Promise<AIBudgetEvaluation> {
    const month = aiMonthKey(now);
    const thresholds = budgetThresholds();
    const config = await resolveAIBudgetConfig();

    const globalLimited = config.global.monthlyUsd !== null || config.global.monthlyTokens !== null;
    const providerLimits = input.provider ? config.providers[input.provider.toLowerCase()] : undefined;
    const providerLimited = !!providerLimits &&
        (providerLimits!.monthlyUsd !== null || providerLimits!.monthlyTokens !== null);
    const userLimits = input.userId ? config.users[input.userId] : undefined;
    const userLimited = !!userLimits && (userLimits!.monthlyUsd !== null || userLimits!.monthlyTokens !== null);
    // A "plugin" budget is keyed by the source id, so plugin and any other
    // source id share one namespace. That keeps the future user/plugin
    // expansion possible without a schema change.
    const pluginLimits = input.sourceId ? config.plugins[input.sourceId] : undefined;
    const pluginLimited = !!pluginLimits &&
        (pluginLimits!.monthlyUsd !== null || pluginLimits!.monthlyTokens !== null);

    const anyLimitConfigured = globalLimited || providerLimited || userLimited || pluginLimited;

    if (!anyLimitConfigured) {
        // Nothing is capped, so there is nothing to protect against. This is
        // also the pre-existing behaviour for deployments that have not opted
        // in: tracking still happens, enforcement is simply inert.
        return {
            decision: "ALLOW",
            reason: "No AI budget limit is configured.",
            checks: [],
            stateAvailable: true,
        };
    }

    const usage = await readAIBudgetUsage(month);

    if (!usage.stateAvailable) {
        // Fail closed only where money is at stake. See the fail-safe note at
        // the top of this file.
        if (providerHasMeteredRisk(input.provider)) {
            return {
                decision: "BLOCK",
                reason:
                    `AI budget state for ${month} could not be read, and provider "${input.provider}" ` +
                    "may incur cost. Failing closed rather than spending unbudgeted.",
                checks: [],
                stateAvailable: false,
            };
        }
        return {
            decision: "ALLOW",
            reason: `AI budget state unavailable, but provider "${input.provider}" is not permitted to incur cost.`,
            checks: [],
            stateAvailable: false,
        };
    }

    const checks: AIBudgetCheck[] = [];

    const pushCheck = (
        scope: AIBudgetScope,
        dimension: string,
        kind: AIBudgetLimitKind,
        counters: AIUsageCounters,
        limit: number | null,
    ): void => {
        if (limit === null || limit <= 0) return;
        const used = kind === "tokens" ? counters.totalTokens : counters.costUsdMicros / 1_000_000;
        const utilization = used / limit;
        checks.push({
            scope,
            dimension,
            kind,
            used,
            limit,
            utilization,
            decision: decideFor(utilization, thresholds),
        });
    };

    const providerKey = input.provider.toLowerCase();
    const providerCounters = usage.providers[providerKey] ?? emptyUsageCounters();
    const userCounters = input.userId ? (usage.users[input.userId] ?? emptyUsageCounters()) : null;
    const pluginCounters = input.sourceId ? (usage.dimensions[input.sourceId] ?? emptyUsageCounters()) : null;

    pushCheck("global", "global", "tokens", usage.totals, config.global.monthlyTokens);
    pushCheck("global", "global", "cost", usage.totals, config.global.monthlyUsd);
    if (providerLimited && providerLimits) {
        pushCheck("provider", providerKey, "tokens", providerCounters, providerLimits.monthlyTokens);
        pushCheck("provider", providerKey, "cost", providerCounters, providerLimits.monthlyUsd);
    }
    if (userLimited && userLimits && userCounters) {
        pushCheck("user", input.userId!, "tokens", userCounters, userLimits.monthlyTokens);
        pushCheck("user", input.userId!, "cost", userCounters, userLimits.monthlyUsd);
    }
    if (pluginLimited && pluginLimits && pluginCounters) {
        pushCheck("plugin", input.sourceId!, "tokens", pluginCounters, pluginLimits.monthlyTokens);
        pushCheck("plugin", input.sourceId!, "cost", pluginCounters, pluginLimits.monthlyUsd);
    }

    if (checks.length === 0) {
        return {
            decision: "ALLOW",
            reason: "No AI budget limit is configured.",
            checks: [],
            stateAvailable: true,
        };
    }

    const worst = checks.reduce((a, b) => (b.utilization > a.utilization ? b : a));
    const decision: AIBudgetDecision = checks.some((c) => c.decision === "BLOCK")
        ? "BLOCK"
        : checks.some((c) => c.decision === "WARN")
            ? "WARN"
            : "ALLOW";

    // When some requests in the bucket had unknown cost, the cost limit is being
    // enforced against a partial estimate. Say so rather than implying precision.
    const costIncomplete = worst.kind === "cost" && usage.totals.costUnknownRequests > 0;
    const incompleteNote = costIncomplete
        ? ` Cost is an estimate: ${usage.totals.costUnknownRequests} request(s) in ${month} had unknown pricing.`
        : "";

    return {
        decision,
        reason: `${decision === "ALLOW" ? "Within budget" : decision === "WARN" ? "Approaching AI budget limit" : "AI budget exceeded"}: ${describeCheck(worst)}.${incompleteNote}`,
        checks,
        stateAvailable: true,
    };
}

/** Throwing form of `evaluateAIBudget`, for guard-style call sites. */
export async function assertAIBudgetAllowed(
    input: AIBudgetEvaluationInput,
    now: number = Date.now(),
): Promise<AIBudgetEvaluation> {
    const evaluation = await evaluateAIBudget(input, now);
    if (evaluation.decision === "BLOCK") {
        throw new AIBudgetError(evaluation);
    }
    return evaluation;
}

/** Convert RTDB nodes into a counters map, tolerating partial data. */
export function toCountersMap(raw: unknown): Record<string, AIUsageCounters> {
    const out: Record<string, AIUsageCounters> = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        out[key] = toUsageCounters(value);
    }
    return out;
}

/** Exposed for the admin API: whether a limit is currently set for a scope. */
export function hasAnyLimit(limits: AIBudgetLimits | undefined): boolean {
    return !!limits && (limits.monthlyUsd !== null || limits.monthlyTokens !== null);
}

export type AIBudgetStatusLevel = "healthy" | "warning" | "exceeded" | "unlimited";

export interface AIBudgetStatus {
    scope: AIBudgetScope;
    id: string;
    monthlyUsd: number | null;
    monthlyTokens: number | null;
    usedTokens: number;
    /** `null` when nothing in the bucket had a determinable cost. */
    usedCostUsd: number | null;
    tokenUtilization: number | null;
    costUtilization: number | null;
    status: AIBudgetStatusLevel;
    costUnknownRequests: number;
}

/**
 * Budget utilisation for one scope.
 *
 * A scope with no limit set reports `unlimited` and a `null` utilisation. It is
 * deliberately NOT reported as 0% used, because "0% of nothing" would render as
 * a healthy green bar and imply the scope is being watched when it is not.
 */
export function computeBudgetStatus(
    scope: AIBudgetScope,
    id: string,
    limits: AIBudgetLimits,
    usage: AIUsageCounters,
    thresholds: AIBudgetThresholds,
): AIBudgetStatus {
    const allCostUnknown = usage.requests > 0 && usage.costUnknownRequests >= usage.requests;
    const usedCostUsd = allCostUnknown ? null : usage.costUsdMicros / 1_000_000;
    const tokenUtilization = limits.monthlyTokens ? usage.totalTokens / limits.monthlyTokens : null;
    const costUtilization = limits.monthlyUsd && usedCostUsd !== null
        ? usedCostUsd / limits.monthlyUsd
        : null;

    const utilizations = [tokenUtilization, costUtilization].filter((v): v is number => v !== null);
    const worst = utilizations.length > 0 ? Math.max(...utilizations) : null;

    let status: AIBudgetStatusLevel;
    if (worst === null) status = "unlimited";
    else if (worst >= thresholds.block) status = "exceeded";
    else if (worst >= thresholds.warn) status = "warning";
    else status = "healthy";

    return {
        scope,
        id,
        monthlyUsd: limits.monthlyUsd,
        monthlyTokens: limits.monthlyTokens,
        usedTokens: usage.totalTokens,
        usedCostUsd,
        tokenUtilization,
        costUtilization,
        status,
        costUnknownRequests: usage.costUnknownRequests,
    };
}

export { usdToMicros };
