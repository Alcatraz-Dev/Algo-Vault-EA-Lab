// AI usage persistence and aggregation on Firebase Realtime Database.
//
// ── Server-only ───────────────────────────────────────────────────────────────
// This module imports `lib/firebase-admin`, which reads service-account
// credentials from the environment at import time. It is therefore reached only
// through the lazily-loaded boundary in `lib/ai/runtime-guards.ts`, never
// statically from `lib/ai/router.ts`, so no client bundle can ever contain it.
// The Firebase Admin SDK also bypasses security rules entirely, so these writes
// are server-authorised by construction; the rules file additionally denies
// every client read/write on these paths (see `database.rules.json`).
//
// ── Node layout ───────────────────────────────────────────────────────────────
//   aiUsageEvents/{YYYY-MM-DD}/{eventId}       one immutable event per request
//   aiUsageDaily/{YYYY-MM-DD}/...              one transaction per day
//   aiUsageMonthly/{YYYY-MM}/...               one transaction per month
//   aiBudgets/global|providers|users|plugins    admin-editable limit overrides
//
// Events are bucketed by day rather than stored flat so that retention is a
// single `remove()` of a day node — no index, no range query, no per-event
// delete — and so a month of history is readable with one node read.
//
// Monthly buckets are keyed `YYYY-MM`, so the next month is a fresh bucket
// automatically. There is no reset job and nothing destructive to schedule.
//
// ── Cost precision ────────────────────────────────────────────────────────────
// Cost is stored as integer micro-USD (`costUsdMicros`) so that a transaction's
// read-modify-write stays exactly associative; floating-point accumulation
// would eventually drift a budget past its limit. The admin API divides by 1e6
// on read. `costUnknownRequests` counts requests whose price was unknown, so a
// bucket can report "cost unavailable" instead of a fabricated $0.

import { adminDatabase } from "@/lib/firebase-admin";
import {
    AIUsageBucket,
    AIUsageCounters,
    AIUsageCountersPublic,
    AIUsageEvent,
    AIUsageStatus,
    AIRequestContext,
    AIUsagePersistResult,
    applyEventToBucket,
    countersToPublic,
    emptyUsageBucket,
    emptyUsageCounters,
    redactAIUsageError,
    toUsageCounters,
} from "./usage-events";
import {
    AIBudgetLimits,
    AIBudgetOverrides,
    AIBudgetUsageSnapshot,
    aiDayKey,
    aiMonthKey,
    emptyAIBudgetLimits,
    hasAnyLimit,
} from "./budget";
import { AIProviderActivity, emptyAIProviderActivity, sanitizeAIErrorCode } from "./health";

const EVENTS_ROOT = "aiUsageEvents";
const DAILY_ROOT = "aiUsageDaily";
const MONTHLY_ROOT = "aiUsageMonthly";
const BUDGETS_ROOT = "aiBudgets";

const USAGE_PATHS = [EVENTS_ROOT, DAILY_ROOT, MONTHLY_ROOT, BUDGETS_ROOT] as const;

export const AI_USAGE_PATHS = USAGE_PATHS;

// ── Key encoding ──────────────────────────────────────────────────────────────

/**
 * Make an arbitrary id safe as a Realtime Database key.
 *
 * RTDB rejects `.` `#` `$` `[` `]` and `/` in key names, and real model ids use
 * all of them (`google/gemma-2-9b-it:free` contains `/`, `deepseek-v4-pro.1`
 * would contain `.`). `~` is escaped too, which is what makes the mapping
 * injective: without it the literal id `a~2fb` would collide with `a/b`.
 * Encoding is a bijection, so the admin API can recover the exact original.
 */
export function encodeAIUsageKey(value: string): string {
    return String(value ?? "").replace(/[~.#$\[\]\/]/g, (ch) => `~${ch.charCodeAt(0).toString(16)}~`);
}

export function decodeAIUsageKey(value: string): string {
    return String(value ?? "").replace(/~([0-9a-f]{2})~/gi, (_m, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
    );
}

// ── Serialisation ─────────────────────────────────────────────────────────────

/** The in-memory bucket and its RTDB node shape are the same object. */
function bucketFromNode(raw: unknown): AIUsageBucket {
    const bucket = emptyUsageBucket();
    if (!raw || typeof raw !== "object") return bucket;
    const node = raw as Record<string, unknown>;

    bucket.totals = toUsageCounters(node.totals);

    if (node.providers && typeof node.providers === "object") {
        for (const [providerId, value] of Object.entries(node.providers as Record<string, unknown>)) {
            const p = (value ?? {}) as Record<string, unknown>;
            const models: Record<string, AIUsageCounters> = {};
            if (p.models && typeof p.models === "object") {
                for (const [modelId, counters] of Object.entries(p.models as Record<string, unknown>)) {
                    models[modelId] = toUsageCounters(counters);
                }
            }
            bucket.providers[providerId] = { counters: toUsageCounters(p.counters), models };
        }
    }

    for (const [field, target] of [
        ["sources", bucket.sources],
        ["users", bucket.users],
        ["dimensions", bucket.dimensions],
    ] as const) {
        const group = node[field];
        if (group && typeof group === "object") {
            for (const [key, counters] of Object.entries(group as Record<string, unknown>)) {
                target[key] = toUsageCounters(counters);
            }
        }
    }

    return bucket;
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function foldIntoPeriod(root: string, period: string, event: AIUsageEvent): Promise<void> {
    const ref = adminDatabase.ref(`${root}/${period}`);
    // One transaction per period, whose updater folds the event into the whole
    // bucket. Because the read-modify-write is atomic per period, two concurrent
    // requests cannot both read the same counters and each write back their own
    // total — the classic lost-increment race cannot occur here.
    await ref.transaction((current) => applyEventToBucket(bucketFromNode(current), event));
}

/**
 * Persist one usage event plus its daily and monthly aggregates.
 *
 * Never throws. Usage tracking is analytics: if Firebase is unavailable the
 * caller still gets its AI result, which is the required fail-safe direction.
 * The event write and the two aggregate transactions are attempted
 * independently so one failing does not skip the others.
 */
export async function persistAIUsageEvent(event: AIUsageEvent): Promise<AIUsagePersistResult> {
    const day = aiDayKey(event.timestamp);
    const month = aiMonthKey(event.timestamp);
    const eventId = encodeAIUsageKey(event.id);
    const errors: string[] = [];

    const steps: Array<() => Promise<unknown>> = [
        () => adminDatabase.ref(`${EVENTS_ROOT}/${day}/${eventId}`).set(event),
        () => foldIntoPeriod(DAILY_ROOT, day, event),
        () => foldIntoPeriod(MONTHLY_ROOT, month, event),
    ];

    for (const step of steps) {
        try {
            await step();
        } catch (err) {
            errors.push(redactAIUsageError(err));
        }
    }

    if (errors.length > 0) {
        return { persisted: false, error: errors.join("; ") };
    }
    return { persisted: true };
}

// ── Budget state ──────────────────────────────────────────────────────────────

/**
 * Read this month's usage for budget evaluation. One node read serves the
 * global, provider, user and plugin checks.
 */
export async function readAIMonthBudgetUsage(month: string): Promise<AIBudgetUsageSnapshot> {
    const snap = await adminDatabase.ref(`${MONTHLY_ROOT}/${month}`).get();
    if (snap.val() === null || snap.val() === undefined) {
        // A brand-new month legitimately has no node. That is "zero usage",
        // which is available state — not an outage — so fail open here.
        return {
            stateAvailable: true,
            totals: emptyUsageCounters(),
            providers: {},
            users: {},
            dimensions: {},
        };
    }
    const bucket = bucketFromNode(snap.val());
    return {
        stateAvailable: true,
        totals: bucket.totals,
        providers: Object.fromEntries(
            Object.entries(bucket.providers).map(([id, p]) => [decodeAIUsageKey(id), p.counters]),
        ),
        users: Object.fromEntries(
            Object.entries(bucket.users).map(([id, c]) => [decodeAIUsageKey(id), c]),
        ),
        dimensions: Object.fromEntries(
            Object.entries(bucket.dimensions).map(([id, c]) => [decodeAIUsageKey(id), c]),
        ),
    };
}

// ── Budget configuration ──────────────────────────────────────────────────────

function limitsFromNode(raw: unknown): Partial<AIBudgetLimits> {
    if (!raw || typeof raw !== "object") return {};
    const n = raw as Record<string, unknown>;
    const out: Partial<AIBudgetLimits> = {};
    if (typeof n.monthlyUsd === "number" && Number.isFinite(n.monthlyUsd)) out.monthlyUsd = n.monthlyUsd;
    if (typeof n.monthlyTokens === "number" && Number.isFinite(n.monthlyTokens)) {
        out.monthlyTokens = n.monthlyTokens;
    }
    return out;
}

function scopeFromNode(raw: unknown): Record<string, Partial<AIBudgetLimits>> {
    const out: Record<string, Partial<AIBudgetLimits>> = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const limits = limitsFromNode(value);
        if (Object.keys(limits).length > 0) out[decodeAIUsageKey(key)] = limits;
    }
    return out;
}

/** Read the admin-editable budget overrides. */
export async function readAIBudgetOverrides(): Promise<AIBudgetOverrides | null> {
    const snap = await adminDatabase.ref(BUDGETS_ROOT).get();
    if (!snap.exists()) return null;
    const node = snap.val() as Record<string, unknown>;
    const overrides: AIBudgetOverrides = {};
    const global = limitsFromNode(node.global);
    if (Object.keys(global).length > 0) overrides.global = global;
    const providers = scopeFromNode(node.providers);
    if (Object.keys(providers).length > 0) overrides.providers = providers;
    const users = scopeFromNode(node.users);
    if (Object.keys(users).length > 0) overrides.users = users;
    const plugins = scopeFromNode(node.plugins);
    if (Object.keys(plugins).length > 0) overrides.plugins = plugins;
    return overrides;
}

/**
 * Merge budget overrides.
 *
 * A `null` value explicitly CLEARS a limit (an admin removing a cap must be
 * able to). A `null` scope removes that scope's limits entirely. Anything not
 * mentioned is left untouched, so two admins editing different providers do
 * not overwrite each other.
 */
export async function writeAIBudgetOverrides(patch: AIBudgetOverrides): Promise<void> {
    const updates: Record<string, unknown> = {};

    if (patch.global) {
        const current = (await readAIBudgetOverrides())?.global ?? {};
        updates[`${BUDGETS_ROOT}/global`] = mergeLimitNode(current, patch.global);
    }
    for (const scope of ["providers", "users", "plugins"] as const) {
        const incoming = patch[scope];
        if (!incoming) continue;
        for (const [key, limits] of Object.entries(incoming)) {
            if (limits === null) {
                updates[`${BUDGETS_ROOT}/${scope}/${encodeAIUsageKey(key)}`] = null;
                continue;
            }
            const existing = (await readAIBudgetOverrides())?.[scope]?.[key] ?? {};
            updates[`${BUDGETS_ROOT}/${scope}/${encodeAIUsageKey(key)}`] = mergeLimitNode(existing, limits);
        }
    }

    if (Object.keys(updates).length === 0) return;
    await adminDatabase.ref().update(updates);
}

function mergeLimitNode(
    current: Partial<AIBudgetLimits>,
    patch: Partial<AIBudgetLimits>,
): AIBudgetLimits {
    const next: AIBudgetLimits = emptyAIBudgetLimits();
    for (const field of ["monthlyUsd", "monthlyTokens"] as const) {
        const value = patch[field] === undefined ? current[field] : patch[field];
        if (value === null) {
            next[field] = null;
        } else if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
            next[field] = value;
        } else if (current[field] !== undefined) {
            next[field] = current[field] as number | null;
        }
    }
    return next;
}

// ── Reporting ─────────────────────────────────────────────────────────────────

export interface AIUsageProviderSummary extends AIUsageCountersPublic {
    provider: string;
    models: Array<AIUsageCountersPublic & { model: string }>;
}

export interface AIUsageSummary {
    month: string;
    totals: AIUsageCountersPublic;
    providers: AIUsageProviderSummary[];
    sources: Record<string, AIUsageCountersPublic>;
    /** Distinct model ids seen in the filtered window. */
    modelCount: number;
}

export interface AIUsageSummaryFilters {
    month?: string;
    provider?: string;
    model?: string;
    source?: string;
}

/**
 * Read a month's usage for the admin API. Filters are applied after the read,
 * so one node read serves every breakdown regardless of which filters are set.
 */
export async function getAIMonthlySummary(
    filters: AIUsageSummaryFilters = {},
): Promise<AIUsageSummary> {
    const month = filters.month?.trim() || aiMonthKey();
    const snap = await adminDatabase.ref(`${MONTHLY_ROOT}/${month}`).get();
    const bucket = bucketFromNode(snap.val());

    const providerFilter = filters.provider?.trim().toLowerCase() || "";
    const modelFilter = filters.model?.trim().toLowerCase() || "";
    const sourceFilter = filters.source?.trim().toLowerCase() || "";

    const providers: AIUsageProviderSummary[] = [];
    const totals = emptyUsageCounters();
    const modelIds = new Set<string>();

    for (const [encodedProvider, providerBucket] of Object.entries(bucket.providers)) {
        const provider = decodeAIUsageKey(encodedProvider);
        if (providerFilter && provider.toLowerCase() !== providerFilter) continue;

        const models: Array<AIUsageCountersPublic & { model: string }> = [];
        for (const [encodedModel, counters] of Object.entries(providerBucket.models)) {
            const model = decodeAIUsageKey(encodedModel);
            if (modelFilter && model.toLowerCase() !== modelFilter) continue;
            models.push({ model, ...countersToPublic(counters) });
            modelIds.add(model);
            addCounters(totals, counters);
        }
        // A provider with no surviving model is dropped, unless no model filter
        // narrowed things — then its own counters still belong in the view.
        if (modelFilter && models.length === 0) continue;
        if (models.length === 0 && !modelFilter) {
            addCounters(totals, providerBucket.counters);
        }
        providers.push({ provider, ...countersToPublic(providerBucket.counters), models });
    }

    const sources: Record<string, AIUsageCountersPublic> = {};
    for (const [encodedSource, counters] of Object.entries(bucket.sources)) {
        const source = decodeAIUsageKey(encodedSource);
        if (sourceFilter && source.toLowerCase() !== sourceFilter) continue;
        sources[source] = countersToPublic(counters);
    }

    // With no narrowing filters, the authoritative total is the bucket's own
    // totals node rather than a re-sum of the (possibly filtered) breakdown.
    const isUnfiltered = !providerFilter && !modelFilter;
    return {
        month,
        totals: countersToPublic(isUnfiltered ? bucket.totals : totals),
        providers,
        sources,
        modelCount: modelIds.size,
    };
}

function addCounters(target: AIUsageCounters, delta: AIUsageCounters): void {
    target.requests += delta.requests;
    target.successfulRequests += delta.successfulRequests;
    target.failedRequests += delta.failedRequests;
    target.blockedRequests += delta.blockedRequests;
    target.promptTokens += delta.promptTokens;
    target.completionTokens += delta.completionTokens;
    target.totalTokens += delta.totalTokens;
    target.costUsdMicros += delta.costUsdMicros;
    target.costUnknownRequests += delta.costUnknownRequests;
}

// ── Provider activity (recency) ───────────────────────────────────────────────

/**
 * Recency signals per provider, read from the raw event stream.
 *
 * The month aggregates answer "how much", which cannot distinguish a provider
 * that worked all month from one that broke an hour ago. This answers "when",
 * by scanning day buckets newest-first and stopping as soon as every registered
 * provider has been seen — in practice the first day usually satisfies that, so
 * the read stays small.
 *
 * Privacy: exactly four fields are read off each event (`provider`,
 * `timestamp`, `status`, `errorCode`) and folded into a fresh object. No user id,
 * model, prompt or raw provider payload is read, so none can reach the admin UI.
 */
export async function readAIProviderActivity(
    providerIds: readonly string[],
    lookbackDays: number = 2,
    now: number = Date.now(),
): Promise<Record<string, AIProviderActivity>> {
    const activity: Record<string, AIProviderActivity> = {};
    const wanted: string[] = [];
    for (const raw of providerIds) {
        const id = String(raw ?? "").trim().toLowerCase();
        if (!id || activity[id]) continue;
        activity[id] = emptyAIProviderActivity();
        wanted.push(id);
    }
    if (wanted.length === 0) return activity;

    const days = Number.isFinite(lookbackDays) && lookbackDays >= 1
        ? Math.min(Math.floor(lookbackDays), 14)
        : 1;

    const allSeen = () => wanted.every((id) => activity[id].lastUsedAt !== null);

    // Newest day first. A day that cannot be read is skipped rather than
    // failing the report: partial recency is still useful, no recency is not.
    for (let back = 0; back < days && !allSeen(); back++) {
        let node: unknown;
        try {
            node = (await adminDatabase.ref(`${EVENTS_ROOT}/${aiDayKey(now - back * 86_400_000)}`).get()).val();
        } catch {
            continue;
        }
        if (!node || typeof node !== "object") continue;

        for (const raw of Object.values(node as Record<string, unknown>)) {
            if (!raw || typeof raw !== "object") continue;
            const event = raw as Record<string, unknown>;
            const provider = typeof event.provider === "string" ? event.provider.trim().toLowerCase() : "";
            const target = provider ? activity[provider] : undefined;
            if (!target) continue;

            const at = typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
                ? event.timestamp
                : null;
            const status: AIUsageStatus = event.status === "success" ? "success" : "error";

            target.attempts++;
            if (at !== null && (target.lastUsedAt === null || at > target.lastUsedAt)) {
                target.lastUsedAt = at;
                target.lastStatus = status;
            }
            if (status === "success" && (at === null || target.lastSuccessAt === null || at > target.lastSuccessAt)) {
                target.lastSuccessAt = at;
            }
            if (status === "error" && (at === null || target.lastErrorAt === null || at > target.lastErrorAt)) {
                target.lastErrorAt = at;
                target.lastErrorCode = sanitizeAIErrorCode(event.errorCode);
            }
        }
    }

    return activity;
}

// ── Retention ─────────────────────────────────────────────────────────────────

/**
 * Drop whole day-buckets of raw events older than `retentionDays`.
 *
 * Whole-node removal keeps retention index-free. Aggregates are intentionally
 * left intact: the day and month counters are the reporting surface and must
 * survive event pruning.
 */
export async function pruneAIUsageEvents(retentionDays: number, now: number = Date.now()): Promise<number> {
    const days = Number.isFinite(retentionDays) && retentionDays > 0 ? Math.floor(retentionDays) : 0;
    if (days <= 0) return 0;

    const cutoff = now - days * 24 * 60 * 60 * 1000;
    const snap = await adminDatabase.ref(EVENTS_ROOT).get();
    if (!snap.exists()) return 0;

    const updates: Record<string, unknown> = {};
    let removed = 0;
    for (const dayKey of Object.keys(snap.val() as Record<string, unknown>)) {
        const dayTime = Date.parse(`${dayKey}T00:00:00.000Z`);
        if (Number.isFinite(dayTime) && dayTime < cutoff) {
            updates[`${EVENTS_ROOT}/${dayKey}`] = null;
            removed++;
        }
    }
    if (removed === 0) return 0;
    await adminDatabase.ref().update(updates);
    return removed;
}

/** Re-exported so the API layer need not import two modules for one type. */
export type { AIUsageEvent, AIRequestContext, AIUsagePersistResult };
export { hasAnyLimit, redactAIUsageError };
