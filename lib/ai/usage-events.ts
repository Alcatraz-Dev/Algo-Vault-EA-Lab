// Canonical AI usage event model, token accounting and cost estimation.
//
// This module is deliberately PURE: no Firebase, no fetch, no filesystem, no
// environment reads. Everything here is a deterministic function of its inputs,
// which keeps the accounting rules (how tokens are read, how cost is derived,
// what is forbidden from being stored) unit-testable and keeps Firebase
// credentials out of any module graph that a bundler might walk.
//
// ── What is stored ────────────────────────────────────────────────────────────
// Only scalars needed for accounting and analytics: provider, model, token
// counts, latency, status, an optional caller-supplied userId, an optional
// source label, and an ESTIMATED cost.
//
// ── What is never stored ──────────────────────────────────────────────────────
// Prompts, system prompts, completions, raw provider responses, request/response
// headers, and any credential. `findForbiddenUsageFields` is the executable
// version of that rule and is asserted by the test suite; it is intentionally
// written as a deny-list of names so that a future refactor which accidentally
// starts attaching a payload will fail loudly instead of leaking quietly.
//
// ── Estimated cost is not an invoice ──────────────────────────────────────────
// `estimatedCostUsd` is computed from the pricing the provider's OWN catalog
// reported, applied to the tokens the provider reported. It is an estimate.
// When the provider reports no pricing, the result is `null` ("unknown"), never
// `0` — a fabricated zero would understate spend and silently defeat a budget.

import { AIModel, AIModelPricing } from "./types";

export type AIUsageStatus = "success" | "error";

/** Where a request originated. Used only for aggregation, never for identity. */
export type AIUsageSource = "chat" | "plugin" | "agent" | "workflow" | "studio" | "system";

/**
 * Optional accounting context supplied by the caller.
 *
 * This is passed as a SEPARATE argument to `router.chat()` rather than added to
 * `AIChatRequest`, so that it can never be forwarded upstream by a provider —
 * providers receive only the request object and build their own HTTP bodies.
 */
export interface AIRequestContext {
    source?: AIUsageSource;
    sourceId?: string;
    /**
     * Only set when the caller already knows the authenticated user id.
     * Callers that cannot resolve a real user MUST leave this absent rather
     * than invent one (e.g. "anonymous"), otherwise per-user budgets would
     * collide on a shared fake bucket.
     */
    userId?: string;
}

export interface AIUsageEvent {
    id: string;
    timestamp: number;
    userId?: string;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs?: number;
    status: AIUsageStatus;
    source?: AIUsageSource;
    sourceId?: string;
    /** `null` = pricing unknown. `0` = genuinely free. Never invented. */
    estimatedCostUsd?: number | null;
    /** Provider/guard error code for a failed or blocked request. */
    errorCode?: string;
}

/** Token counts as reported by the provider, or zeroed-and-flagged if absent. */
export interface AIProviderTokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /**
     * True only when the provider actually returned usage numbers. When false
     * the three counts are 0 and cost must be treated as unknown rather than
     * as a free request.
     */
    reported: boolean;
}

export const ZERO_USAGE: AIProviderTokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    reported: false,
};

/** Pricing knowledge about one model, derived only from the provider catalog. */
export interface AIModelPricingEntry {
    /** Raw provider-reported pricing, if the catalog carried any. */
    pricing?: AIModelPricing;
    /** Catalog says this model is free (zero pricing or an explicit marker). */
    confirmedFree: boolean;
}

/** Coerce a provider-reported count to a non-negative integer, else null. */
function toTokenCount(value: unknown): number | null {
    if (typeof value === "number") {
        if (!Number.isFinite(value) || value < 0) return null;
        return Math.round(value);
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
    }
    return null;
}

function firstTokenCount(source: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const parsed = toTokenCount(source[key]);
        if (parsed !== null) return parsed;
    }
    return null;
}

/**
 * Read token usage out of a provider response body.
 *
 * Every provider in this gateway already returns the full upstream JSON as
 * `AIResponse.raw`, so accounting can read usage centrally at the router
 * instead of asking each provider to report it. That is why no provider file
 * needs to change: this function only inspects bytes that are already in hand.
 *
 * Two wire shapes are supported because the providers genuinely differ:
 *  - OpenAI-compatible (`usage.prompt_tokens` / `input_tokens`, …): OpenRouter,
 *    OpenCode, CodeCraft, B.AI, Bytez.
 *  - Gemini (`usageMetadata.promptTokenCount` / `candidatesTokenCount`, …).
 */
export function extractTokenUsage(raw: unknown): AIProviderTokenUsage {
    if (!raw || typeof raw !== "object") return { ...ZERO_USAGE };
    const body = raw as Record<string, unknown>;

    const openai = body.usage;
    if (openai && typeof openai === "object") {
        const u = openai as Record<string, unknown>;
        const prompt = firstTokenCount(u, ["prompt_tokens", "input_tokens"]);
        const completion = firstTokenCount(u, ["completion_tokens", "output_tokens"]);
        const total = firstTokenCount(u, ["total_tokens"]);
        if (prompt !== null || completion !== null || total !== null) {
            return {
                promptTokens: prompt ?? 0,
                completionTokens: completion ?? 0,
                totalTokens: total ?? (prompt ?? 0) + (completion ?? 0),
                reported: true,
            };
        }
    }

    const gemini = body.usageMetadata;
    if (gemini && typeof gemini === "object") {
        const u = gemini as Record<string, unknown>;
        const prompt = firstTokenCount(u, ["promptTokenCount"]);
        const completion = firstTokenCount(u, ["candidatesTokenCount"]);
        const total = firstTokenCount(u, ["totalTokenCount"]);
        if (prompt !== null || completion !== null || total !== null) {
            return {
                promptTokens: prompt ?? 0,
                completionTokens: completion ?? 0,
                totalTokens: total ?? (prompt ?? 0) + (completion ?? 0),
                reported: true,
            };
        }
    }

    return { ...ZERO_USAGE };
}

/**
 * Parse a per-1k-token price.
 *
 * Returns `null` for anything that is not a finite, non-negative number —
 * including `""`, `"free"`, `undefined`, and `NaN`. A missing price is NOT zero:
 * treating absence as free is exactly the bug that lets unmetered spend through.
 */
export function parseUnitPrice(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) && value >= 0 ? value : null;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") return null;
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return null;
}

/**
 * Estimated cost in USD for one request.
 *
 * Precedence, and the reason for it:
 *  1. No catalog knowledge at all          -> `null` (unknown, not free)
 *  2. Catalog says the model is confirmed free -> `0`
 *  3. Both unit prices parse                -> the formula
 *  4. Otherwise                             -> `null`
 *
 * Rule 4 matters: a model with only one of the two prices known cannot have its
 * cost computed, and half a formula would silently under-report. There is no
 * fallback price, no provider-specific table, and no name-based inference.
 */
export function estimateCostUsd(
    usage: AIProviderTokenUsage,
    entry: AIModelPricingEntry | undefined,
): number | null {
    if (!entry) return null;
    if (entry.confirmedFree) return 0;

    const inputPrice = parseUnitPrice(entry.pricing?.prompt);
    const outputPrice = parseUnitPrice(entry.pricing?.completion);
    if (inputPrice === null || outputPrice === null) return null;

    const prompt = Number.isFinite(usage.promptTokens) ? usage.promptTokens : 0;
    const completion = Number.isFinite(usage.completionTokens) ? usage.completionTokens : 0;

    const cost = (prompt / 1000) * inputPrice + (completion / 1000) * outputPrice;
    return Number.isFinite(cost) ? cost : null;
}

/**
 * Cost of a request whose tokens the provider never reported.
 *
 * Token usage is the input to every price formula, so without it the cost is
 * unknown — never zero. Returning 0 here would let a provider that omits
 * `usage` drain a cost budget invisibly.
 */
export function costForUnreportedUsage(entry: AIModelPricingEntry | undefined): number | null {
    if (!entry) return null;
    if (entry.confirmedFree) return 0;
    // A free model costs nothing even if usage was not reported; a metered model
    // with no reported tokens has an unknowable cost.
    return null;
}

let usageIdCounter = 0;

/** Monotonic-ish, collision-resistant id. Never contains a secret. */
export function createAIUsageEventId(timestamp: number): string {
    usageIdCounter = (usageIdCounter + 1) % 0xffff;
    const time = timestamp.toString(36);
    const seq = usageIdCounter.toString(36).padStart(3, "0");
    const rand = Math.floor(Math.random() * 0xffffff).toString(36);
    return `ev_${time}_${seq}_${rand}`;
}

export interface BuildAIUsageEventInput {
    provider: string;
    model: string;
    usage: AIProviderTokenUsage;
    pricing?: AIModelPricingEntry | undefined;
    latencyMs: number;
    status: AIUsageStatus;
    errorCode?: string | undefined;
    context?: AIRequestContext | undefined;
    timestamp?: number;
    id?: string;
    /**
     * Overrides the computed cost. Only for cases where the cost is known as a
     * fact rather than estimated from pricing — a request refused by the budget
     * guard, or one served by the local heuristic. Both consumed zero billable
     * tokens, so `0` there is a measurement, not a fabrication. `null` is not a
     * meaningful override; omit the field instead.
     */
    forcedCostUsd?: number;
}

/**
 * Assemble the canonical event from scalars only.
 *
 * Note the parameter list: it accepts usage counts, never `content`,
 * `messages`, or a response body. That is a structural guarantee — a payload
 * cannot be persisted because there is no parameter to pass it through.
 */
export function buildAIUsageEvent(input: BuildAIUsageEventInput): AIUsageEvent {
    const timestamp = input.timestamp ?? Date.now();
    const { usage } = input;
    const entry = input.pricing;

    // A failed request still costs whatever the provider billed for the tokens
    // it consumed before failing, so cost is derived identically for both
    // statuses; only the token counts fall back to 0 when unreported.
    const estimatedCostUsd = input.forcedCostUsd !== undefined
        ? input.forcedCostUsd
        : usage.reported
            ? estimateCostUsd(usage, entry)
            : costForUnreportedUsage(entry);

    const event: AIUsageEvent = {
        id: input.id ?? createAIUsageEventId(timestamp),
        timestamp,
        provider: String(input.provider || "unknown"),
        model: String(input.model || "unknown"),
        promptTokens: usage.reported ? usage.promptTokens : 0,
        completionTokens: usage.reported ? usage.completionTokens : 0,
        totalTokens: usage.reported ? usage.totalTokens : 0,
        latencyMs: input.latencyMs,
        status: input.status,
    };

    // Identity is only recorded when the caller actually resolved one.
    const userId = input.context?.userId?.trim();
    if (userId) event.userId = userId;

    const source = input.context?.source;
    if (source) event.source = source;

    const sourceId = input.context?.sourceId?.trim();
    if (sourceId) event.sourceId = sourceId;

    if (estimatedCostUsd !== undefined) event.estimatedCostUsd = estimatedCostUsd;

    const errorCode = input.errorCode?.trim();
    if (errorCode) event.errorCode = errorCode;

    return event;
}

/**
 * Names that must never appear as a key anywhere in a persisted usage event.
 *
 * Substring matching is deliberate: it also catches a nested key such as
 * `rawProviderResponse` or `userAuthorization`. A nested match is reported
 * with its dotted path so the finding is actionable.
 */
export const FORBIDDEN_USAGE_FIELDS: readonly string[] = [
    "prompt",
    "content",
    "completion",
    "messages",
    "apikey",
    "api_key",
    "authorization",
    "bearer",
    "secret",
    "password",
    "token_string",
    "raw",
    "headers",
    "body",
    "response",
    "systemprompt",
];

/**
 * Keys that are legitimately present on an event.
 *
 * This is the authoritative exception list for `findForbiddenUsageFields`.
 * It exists because substring matching is intentionally broad: it has to catch
 * a nested `rawProviderResponse` or `userAuthorization`, but it would otherwise
 * also flag the two counters `promptTokens` and `completionTokens`, which are
 * counts rather than payloads. A key that is explicitly permitted here can
 * never be a leak, so a valid event always reports zero findings and any
 * finding at all is a real defect.
 */
export const ALLOWED_USAGE_FIELDS: readonly string[] = [
    "id",
    "timestamp",
    "userId",
    "provider",
    "model",
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "latencyMs",
    "status",
    "source",
    "sourceId",
    "estimatedCostUsd",
    "errorCode",
];

const ALLOWED_USAGE_FIELD_SET = new Set(ALLOWED_USAGE_FIELDS.map((f) => f.toLowerCase()));

/** Returns the dotted paths of any forbidden key found in `value`. */
export function findForbiddenUsageFields(value: unknown, path = ""): string[] {
    const found: string[] = [];
    if (!value || typeof value !== "object") return found;

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const normalized = key.toLowerCase();
        const childPath = path ? `${path}.${key}` : key;
        if (
            !ALLOWED_USAGE_FIELD_SET.has(normalized) &&
            FORBIDDEN_USAGE_FIELDS.some((forbidden) => normalized.includes(forbidden))
        ) {
            found.push(childPath);
        }
        if (child && typeof child === "object") {
            found.push(...findForbiddenUsageFields(child, childPath));
        }
    }
    return found;
}

const VALID_SOURCES: readonly AIUsageSource[] = [
    "chat",
    "plugin",
    "agent",
    "workflow",
    "studio",
    "system",
];

export function isAIUsageSource(value: unknown): value is AIUsageSource {
    return typeof value === "string" && (VALID_SOURCES as readonly string[]).includes(value);
}

// ── Log hygiene ───────────────────────────────────────────────────────────────

/**
 * Redact anything credential-shaped before it reaches a log line.
 *
 * Usage persistence failures are logged from a module that sits next to the
 * Firebase client, so a raw error string could in principle carry a URL with
 * embedded credentials or a long opaque token. Everything printed from this
 * feature goes through here first.
 */
const REDACTED = "[redacted]";

export function redactAIUsageError(value: unknown): string {
    const text = value instanceof Error ? value.message : String(value);
    return (
        text
            // A credential embedded in a URL query string. Runs first so the
            // parameter name survives and the log stays diagnosable.
            .replace(
                /([?&][^=\s&#"']*(?:key|token|secret|auth|password)[^=\s&#"']*=)[^&\s"']+/gi,
                `$1${REDACTED}`,
            )
            // `Authorization: Bearer <opaque>`
            .replace(/\bbearer\s+[\w.\-]+/gi, REDACTED)
            // `key=…`, `api_key: …`, `token - …`, `secret=…`, `auth: <opaque>`.
            // The separator class includes `=`, which the previous version
            // omitted, so the single most common shape — `key=<opaque>` — was
            // passing through unredacted.
            .replace(
                /\b[A-Za-z0-9_\-]*(?:api[_-]?key|key|token|secret|password|auth)[\-_:=]?\s*["']?[\w.\-]{12,}/gi,
                REDACTED,
            )
            .slice(0, 300)
    );
}

/** Outcome of a persistence attempt. Persistence failure is never fatal. */
export interface AIUsagePersistResult {
    persisted: boolean;
    /** Present when persistence failed. The AI result is still returned. */
    error?: string;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/**
 * Cost is accumulated in integer micro-USD.
 *
 * Adding `0.1 + 0.2` a few thousand times inside a Firebase transaction drifts,
 * and a drifting budget eventually lets an exhausted budget through. Integer
 * micros make the increment exactly associative, which is what lets a
 * transaction's read-modify-write stay correct under concurrency.
 */
export const COST_MICROS_PER_USD = 1_000_000;

/** USD -> integer micro-USD, rounded to the nearest micro. */
export function usdToMicros(usd: number | null | undefined): number | null {
    if (usd === null || usd === undefined || !Number.isFinite(usd)) return null;
    return Math.round(usd * COST_MICROS_PER_USD);
}

export function microsToUsd(micros: number | null | undefined): number | null {
    if (micros === null || micros === undefined || !Number.isFinite(micros)) return null;
    return micros / COST_MICROS_PER_USD;
}

export interface AIUsageCounters {
    requests: number;
    successfulRequests: number;
    failedRequests: number;
    /** Refused by the budget guard before any provider call was made. */
    blockedRequests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Sum of estimated cost in micro-USD. */
    costUsdMicros: number;
    /** Requests in this bucket whose cost could not be determined. */
    costUnknownRequests: number;
}

export function emptyUsageCounters(): AIUsageCounters {
    return {
        requests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        blockedRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsdMicros: 0,
        costUnknownRequests: 0,
    };
}

/** Coerce a node read back from RTDB into counters, tolerating absent/garbage. */
export function toUsageCounters(raw: unknown): AIUsageCounters {
    const base = emptyUsageCounters();
    if (!raw || typeof raw !== "object") return base;
    const r = raw as Record<string, unknown>;
    const num = (v: unknown): number =>
        typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
    return {
        requests: num(r.requests),
        successfulRequests: num(r.successfulRequests),
        failedRequests: num(r.failedRequests),
        blockedRequests: num(r.blockedRequests),
        promptTokens: num(r.promptTokens),
        completionTokens: num(r.completionTokens),
        totalTokens: num(r.totalTokens),
        costUsdMicros: num(r.costUsdMicros),
        costUnknownRequests: num(r.costUnknownRequests),
    };
}

/**
 * Apply one event to a counters object. Pure, additive, and the exact body of
 * the Firebase transaction updater — so "concurrent updates do not lose
 * increments" reduces to a property of this function that the suite can assert
 * directly, without a live database.
 */
export function applyUsageToCounters(
    target: AIUsageCounters,
    event: AIUsageEvent,
): AIUsageCounters {
    const costMicros = usdToMicros(event.estimatedCostUsd);
    return {
        requests: target.requests + 1,
        successfulRequests: target.successfulRequests + (event.status === "success" ? 1 : 0),
        failedRequests: target.failedRequests + (event.status === "success" ? 0 : 1),
        blockedRequests: target.blockedRequests + (event.errorCode === "AI_BUDGET_EXCEEDED" ? 1 : 0),
        promptTokens: target.promptTokens + event.promptTokens,
        completionTokens: target.completionTokens + event.completionTokens,
        totalTokens: target.totalTokens + event.totalTokens,
        costUsdMicros: target.costUsdMicros + (costMicros ?? 0),
        // A cost the provider never priced is counted, not zeroed: a budget must
        // be able to see that it is flying on estimates alone.
        costUnknownRequests: target.costUnknownRequests + (costMicros === null ? 1 : 0),
    };
}

/** Public, JSON-facing shape of a counters node. */
export interface AIUsageCountersPublic {
    requests: number;
    successfulRequests: number;
    failedRequests: number;
    blockedRequests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
    costUnknownRequests: number;
}

/**
 * `estimatedCostUsd` is `null` — never `0` — when every request in the bucket
 * had unknown cost, so the UI can print "Cost unavailable" rather than a
 * confident, fabricated `$0.00`.
 */
export function countersToPublic(counters: AIUsageCounters): AIUsageCountersPublic {
    const cost = counters.costUnknownRequests >= counters.requests && counters.requests > 0
        ? null
        : microsToUsd(counters.costUsdMicros);
    return {
        requests: counters.requests,
        successfulRequests: counters.successfulRequests,
        failedRequests: counters.failedRequests,
        blockedRequests: counters.blockedRequests,
        promptTokens: counters.promptTokens,
        completionTokens: counters.completionTokens,
        totalTokens: counters.totalTokens,
        estimatedCostUsd: cost,
        costUnknownRequests: counters.costUnknownRequests,
    };
}

/** One period (day or month) of aggregated usage, grouped by dimension. */
export interface AIUsageBucket {
    totals: AIUsageCounters;
    providers: Record<string, { counters: AIUsageCounters; models: Record<string, AIUsageCounters> }>;
    sources: Record<string, AIUsageCounters>;
    users: Record<string, AIUsageCounters>;
    dimensions: Record<string, AIUsageCounters>;
}

export function emptyUsageBucket(): AIUsageBucket {
    return {
        totals: emptyUsageCounters(),
        providers: {},
        sources: {},
        users: {},
        dimensions: {},
    };
}

/**
 * Fold one event into a period bucket across every aggregation dimension.
 *
 * The dimensions are written as a single nested object so a period can be
 * updated in ONE Firebase transaction: the read-modify-write is atomic across
 * totals, provider, model, source, user and source-id at once, so two
 * concurrent requests can never interleave and drop one another's increments.
 */
export function applyEventToBucket(bucket: AIUsageBucket, event: AIUsageEvent): AIUsageBucket {
    const next: AIUsageBucket = {
        totals: applyUsageToCounters(bucket.totals, event),
        providers: { ...bucket.providers },
        sources: { ...bucket.sources },
        users: { ...bucket.users },
        dimensions: { ...bucket.dimensions },
    };

    const providerId = event.provider || "unknown";
    const existingProvider = next.providers[providerId];
    const existingCounters = existingProvider ? existingProvider.counters : emptyUsageCounters();
    const existingModels: Record<string, AIUsageCounters> = existingProvider
        ? { ...existingProvider.models }
        : {};

    const providerBucket: AIUsageBucket["providers"][string] = {
        counters: applyUsageToCounters(existingCounters, event),
        models: existingModels,
    };
    const modelKey = event.model || "unknown";
    providerBucket.models[modelKey] = applyUsageToCounters(
        existingModels[modelKey] ?? emptyUsageCounters(),
        event,
    );
    next.providers[providerId] = providerBucket;

    if (event.source) {
        next.sources[event.source] = applyUsageToCounters(
            next.sources[event.source] ?? emptyUsageCounters(),
            event,
        );
    }

    // Identity dimensions are only written when a real id was resolved, so a
    // caller with no user never piles into a shared "anonymous" bucket.
    if (event.userId) {
        next.users[event.userId] = applyUsageToCounters(
            next.users[event.userId] ?? emptyUsageCounters(),
            event,
        );
    }
    if (event.sourceId) {
        next.dimensions[event.sourceId] = applyUsageToCounters(
            next.dimensions[event.sourceId] ?? emptyUsageCounters(),
            event,
        );
    }

    return next;
}

/**
 * Reduce a catalog to a lookup table of pricing knowledge.
 *
 * Keyed by `provider::modelId` in lowercase because model ids are matched
 * case-insensitively everywhere else in the gateway. Models with no pricing and
 * no free marker are still indexed, with `confirmedFree: false` and no pricing,
 * so the consumer can distinguish "unknown model" from "known metered model
 * with no numbers" — both yield a `null` cost, but only the latter is a catalog
 * miss rather than an unknown id.
 */
export function buildPricingIndex(models: AIModel[]): Map<string, AIModelPricingEntry> {
    const index = new Map<string, AIModelPricingEntry>();
    for (const model of models) {
        if (!model || typeof model.id !== "string" || !model.id) continue;
        const provider = (model.provider || "unknown").toLowerCase();
        const key = `${provider}::${model.id.toLowerCase()}`;
        if (index.has(key)) continue;
        index.set(key, {
            pricing: model.pricing,
            confirmedFree: model.confirmedFree === true,
        });
    }
    return index;
}

/** Look up a model in a pricing index. `undefined` means "not in the catalog". */
export function lookupModelPricing(
    index: Map<string, AIModelPricingEntry> | null,
    provider: string,
    model: string,
): AIModelPricingEntry | undefined {
    if (!index || !provider || !model) return undefined;
    return index.get(`${provider.toLowerCase()}::${model.toLowerCase()}`);
}
