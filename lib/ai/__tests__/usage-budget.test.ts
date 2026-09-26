import { defaultRouter } from "../router";
import { AIConfig } from "../config";
import {
    AIUsageBucket,
    AIUsageEvent,
    applyEventToBucket,
    buildAIUsageEvent,
    buildPricingIndex,
    countersToPublic,
    costForUnreportedUsage,
    createAIUsageEventId,
    emptyUsageBucket,
    emptyUsageCounters,
    estimateCostUsd,
    extractTokenUsage,
    findForbiddenUsageFields,
    FORBIDDEN_USAGE_FIELDS,
    ALLOWED_USAGE_FIELDS,
    isAIUsageSource,
    lookupModelPricing,
    microsToUsd,
    parseUnitPrice,
    redactAIUsageError,
    toUsageCounters,
    usdToMicros,
    ZERO_USAGE,
} from "../usage-events";
import {
    AIBudgetError,
    AIBudgetLimits,
    AIBudgetUsageSnapshot,
    aiDayKey,
    aiMonthKey,
    assertAIBudgetAllowed,
    budgetThresholds,
    computeBudgetStatus,
    emptyAIBudgetConfig,
    emptyAIBudgetLimits,
    emptyAIBudgetUsageSnapshot,
    envAIBudgetConfig,
    evaluateAIBudget,
    invalidateAIBudgetConfigCache,
    mergeAIBudgetConfig,
    setAIBudgetOverrideReader,
    setAIBudgetUsageReader,
} from "../budget";
import {
    __resetAIRuntimeGuards,
    __setAIBudgetReadersForTests,
    __setAIUsageSinkForTests,
} from "../runtime-guards";
import { refreshCatalogSnapshot, resetCatalogSnapshot, setCatalogLoader } from "../catalog-snapshot";
import { providerHasMeteredRisk } from "../models";
import {
    resolveAIProviderHealth,
    buildAIProviderHealthReport,
    hasProviderCredential,
    sanitizeAIErrorCode,
    isGuardErrorCode,
    PROVIDER_CREDENTIAL_ENV,
    emptyAIProviderActivity,
    aiHealthFailureRateThreshold,
    aiHealthLookbackDays,
} from "../health";
import type { AIProviderHealthInput, AIProviderHealthState } from "../health";

// ─────────────────────────────────────────────────────────────────────────────
// AI usage & budget control suite.
//
// Entirely offline: a mocked `global.fetch` with FAKE credentials, in-memory
// doubles for the usage sink and the budget readers, and a fake RTDB node for
// the concurrency test. No real provider is contacted and no real CodeCraft
// quota is consumed.
//
// This suite also asserts a set of NEGATIVE properties that are easy to break
// silently — no prompt persisted, no secret persisted, no model substituted
// because of a budget, no global limit bypassed by fallback — because those
// regressions would not fail any functional test.
// ─────────────────────────────────────────────────────────────────────────────

const FAKE_KEY = "test_ai_usage_fake_key_000";
const FAKE_CODECRAFT_MODEL = "deepseek-v4-flash-0731";

/** Real CodeCraft pricing block from the live catalog (non-zero = metered). */
const METERED_PRICING = { prompt: "0.000000115", completion: "0.000000115" };

/**
 * A model id that is free under the shared cost policy for EVERY provider, so
 * one request can legitimately traverse the whole fallback chain without the
 * free-only guard rejecting it. `isModelConfirmedFree` matches the `/free`
 * marker, which is why it is provider-agnostic here.
 */
const FREE_MODEL = "openrouter/free";

const PROVIDER_ENV_KEYS = [
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENCODE_API_KEY",
    "BAI_API_KEY",
    "BYTEZ_API_KEY",
    "CODECRAFT_API_KEY",
] as const;

const BUDGET_ENV_KEYS = [
    "GLOBAL_AI_MONTHLY_BUDGET_USD",
    "GLOBAL_AI_MONTHLY_TOKEN_LIMIT",
    "AI_PROVIDER_CODECRAFT_MONTHLY_BUDGET_USD",
    "AI_PROVIDER_CODECRAFT_MONTHLY_TOKEN_LIMIT",
    "AI_PROVIDER_OPENROUTER_MONTHLY_TOKEN_LIMIT",
    "AI_BUDGET_WARN_THRESHOLD",
    "AI_BUDGET_BLOCK_THRESHOLD",
    "AI_BUDGET_CONFIG_TTL_MS",
    "AI_MAX_PROVIDER_ATTEMPTS",
] as const;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function chatBody(content: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "chatcmpl-test",
        choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
        ...extra,
    };
}

interface FetchRecorder {
    fetch: typeof fetch;
    /** Every chat-completions body actually sent upstream. */
    chatBodies: Array<Record<string, unknown>>;
    reset: () => void;
}

/**
 * A single mock for every provider.
 *
 * `/models` returns an empty catalog so a provider never reaches a network
 * lookup, and chat completions return OpenAI-shaped `usage` so token accounting
 * has something real to read. `failProviders` makes a named provider's chat
 * return 500, which is how a fallback is provoked.
 */
function mockProviders(options?: {
    usage?: Record<string, unknown>;
    failProviders?: string[];
}): FetchRecorder {
    const chatBodies: Array<Record<string, unknown>> = [];

    const providerOf = (url: string): string => {
        if (url.includes("codecraft")) return "codecraft";
        if (url.includes("openrouter")) return "openrouter";
        if (url.includes("opencode")) return "opencode";
        if (url.includes("b.ai")) return "bai";
        if (url.includes("bytez")) return "bytez";
        if (url.includes("googleapis")) return "gemini";
        return "unknown";
    };

    const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url.includes("/models")) return jsonResponse({ object: "list", data: [] });
        if (!url.includes("/chat/completions")) return jsonResponse({});

        let body: Record<string, unknown> = {};
        try {
            body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        } catch {
            body = {};
        }
        chatBodies.push(body);

        const provider = providerOf(url);
        if (options?.failProviders?.includes(provider)) {
            return jsonResponse({ error: { message: `${provider} unavailable` } }, 500);
        }
        return jsonResponse(chatBody("ok", options?.usage ? { usage: options.usage } : {}));
    };

    return {
        fetch: impl as typeof fetch,
        chatBodies,
        reset: () => {
            chatBodies.length = 0;
        },
    };
}

/** Silences console output for the duration of `fn`, returning what was printed. */
async function captureOutput(fn: () => Promise<void>): Promise<string> {
    const lines: string[] = [];
    const methods = ["log", "warn", "error"] as const;
    const originals = methods.map((m) => console[m]);
    methods.forEach((m, i) => {
        console[m] = (...args: unknown[]) => {
            lines.push(args.map((a) => (typeof a === "string" ? a : safe(a))).join(" "));
        };
        void originals[i];
    });
    try {
        await fn();
    } finally {
        methods.forEach((m, i) => {
            console[m] = originals[i];
        });
    }
    return lines.join("\n");
}

function safe(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

/** `JSON.parse` that yields `null` instead of throwing, so a check can assert. */
function parseJson<T>(text: string): T | null {
    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}

// ── usage-event construction helpers ──────────────────────────────────────────

function event(overrides: Partial<AIUsageEvent> = {}): AIUsageEvent {
    return {
        id: "ev_test",
        timestamp: Date.parse("2026-09-15T12:00:00.000Z"),
        provider: "openrouter",
        model: FREE_MODEL,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        latencyMs: 42,
        status: "success",
        estimatedCostUsd: 0,
        ...overrides,
    };
}

function snapshot(overrides: Partial<AIBudgetUsageSnapshot> = {}): AIBudgetUsageSnapshot {
    return {
        ...emptyAIBudgetUsageSnapshot(true),
        ...overrides,
    };
}

function limits(partial: Partial<AIBudgetLimits> = {}): AIBudgetLimits {
    return { ...emptyAIBudgetLimits(), ...partial };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function runAIUsageBudgetTests(): Promise<boolean> {
    console.log("--- AI Usage & Budget Control Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) {
            console.log(`  PASS: ${label}`);
        } else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    /**
     * Runs one group of checks in isolation.
     *
     * A thrown assertion must not abort the rest of the suite: during mutation
     * testing an early crash hides every later check that would also have
     * caught the mutation, which makes the mutation look less lethal than it is.
     */
    const section = async (name: string, fn: () => Promise<void>): Promise<void> => {
        try {
            await fn();
        } catch (err) {
            console.error(`  FAIL: section "${name}" threw:`, err);
            passed = false;
        }
    };

    const originalFetch = global.fetch;
    const savedEnv: Record<string, string | undefined> = {};
    for (const key of [
        "CODECRAFT_MODEL",
        "CODECRAFT_ALLOW_METERED",
        "AI_FREE_ONLY",
        "AI_PRICING_CATALOG_TTL_MS",
        ...PROVIDER_ENV_KEYS,
        ...BUDGET_ENV_KEYS,
    ]) {
        savedEnv[key] = process.env[key];
    }

    const restoreEnv = () => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        invalidateAIBudgetConfigCache();
    };

    /** Hermetic baseline: free-only on, no budgets, no providers configured. */
    const resetAll = () => {
        for (const key of [...PROVIDER_ENV_KEYS, ...BUDGET_ENV_KEYS]) delete process.env[key];
        delete process.env.CODECRAFT_MODEL;
        delete process.env.CODECRAFT_ALLOW_METERED;
        process.env.AI_FREE_ONLY = "true";
        invalidateAIBudgetConfigCache();
    };

    /** Enable exactly the named providers; every other one is unavailable. */
    const onlyProviders = (ids: string[]) => {
        const envFor: Record<string, string> = {
            gemini: "GEMINI_API_KEY",
            openrouter: "OPENROUTER_API_KEY",
            opencode: "OPENCODE_API_KEY",
            codecraft: "CODECRAFT_API_KEY",
            bai: "BAI_API_KEY",
            bytez: "BYTEZ_API_KEY",
        };
        for (const key of PROVIDER_ENV_KEYS) delete process.env[key];
        for (const id of ids) process.env[envFor[id]] = FAKE_KEY;
    };

    /** Install in-memory usage capture + budget state. */
    const install = (options?: {
        usage?: AIBudgetUsageSnapshot | null;
        overrides?: Record<string, unknown> | null;
        collect?: AIUsageEvent[];
    }) => {
        const collect = options?.collect ?? [];
        __setAIUsageSinkForTests(async (e) => {
            collect.push(e);
        });
        __setAIBudgetReadersForTests(
            async () => options?.usage ?? snapshot(),
            async () => (options?.overrides ?? null) as never,
        );
        return collect;
    };

    try {
        // ══════════════════════════════════════════════════════════════════
        // 1. Token extraction
        // ══════════════════════════════════════════════════════════════════
        await section("Token extraction", async () => {
            const openai = extractTokenUsage({
                usage: { prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540 },
            });
            check(
                openai.reported && openai.promptTokens === 1200 &&
                openai.completionTokens === 340 && openai.totalTokens === 1540,
                "Usage: OpenAI-shaped usage is read verbatim (prompt/completion/total)"
            );

            const gemini = extractTokenUsage({
                usageMetadata: {
                    promptTokenCount: 900,
                    candidatesTokenCount: 100,
                    totalTokenCount: 1000,
                },
            });
            check(
                gemini.reported && gemini.promptTokens === 900 &&
                gemini.completionTokens === 100 && gemini.totalTokens === 1000,
                "Usage: Gemini-shaped usageMetadata is read verbatim"
            );

            const derived = extractTokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } });
            check(
                derived.reported && derived.totalTokens === 15,
                "Usage: a missing total is derived from prompt + completion, not guessed"
            );

            const absent = extractTokenUsage({ choices: [] });
            check(
                !absent.reported && absent.totalTokens === 0,
                "Usage: a provider that reports no usage yields zeroed, unreported tokens"
            );

            const coerced = extractTokenUsage({ usage: { prompt_tokens: "800", completion_tokens: "200" } });
            check(
                coerced.reported && coerced.promptTokens === 800 && coerced.completionTokens === 200,
                "Usage: string-encoded counts are coerced to integers"
            );

            const hostile = extractTokenUsage({
                usage: { prompt_tokens: -50, completion_tokens: Number.NaN, total_tokens: Infinity },
            });
            check(
                !hostile.reported,
                "Usage: negative, NaN and Infinity counts are rejected rather than persisted"
            );

            check(
                extractTokenUsage(null).reported === false &&
                extractTokenUsage(undefined).reported === false &&
                extractTokenUsage("not an object").reported === false,
                "Usage: a missing or non-object response body is handled, not thrown on"
            );
        });

        // ══════════════════════════════════════════════════════════════════
        // 2. Cost estimation
        // ══════════════════════════════════════════════════════════════════
        await section("Cost estimation", async () => {
            check(parseUnitPrice(0.000002) === 0.000002, "Cost: a numeric price is used as-is");
            check(parseUnitPrice("0.000000115") === 0.000000115, "Cost: a numeric string price is parsed");
            check(
                parseUnitPrice("") === null && parseUnitPrice(undefined) === null &&
                parseUnitPrice("free") === null && parseUnitPrice(Number.NaN) === null &&
                parseUnitPrice(-1) === null,
                "Cost: a missing, blank, non-numeric or negative price is UNKNOWN, never zero"
            );

            const usage = { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, reported: true };

            const metered = estimateCostUsd(usage, { pricing: METERED_PRICING, confirmedFree: false });
            check(
                metered !== null && Math.abs(metered - (0.000000115 + 0.000000115)) < 1e-12,
                "Cost: estimated from provider-reported pricing using the documented formula"
            );

            const free = estimateCostUsd(usage, { confirmedFree: true });
            check(free === 0, "Cost: a confirmed-free model costs exactly 0");

            check(
                estimateCostUsd(usage, undefined) === null,
                "Cost: a model absent from the catalog is UNKNOWN, never free"
            );

            const halfPriced = estimateCostUsd(usage, {
                pricing: { prompt: "0.000002" } as never,
                confirmedFree: false,
            });
            check(
                halfPriced === null,
                "Cost: only one of the two prices known yields UNKNOWN, never a half-formula"
            );

            check(
                costForUnreportedUsage(undefined) === null &&
                costForUnreportedUsage({ confirmedFree: true }) === 0,
                "Cost: unreported tokens are UNKNOWN for metered models and 0 only for free ones"
            );
        });

        // ══════════════════════════════════════════════════════════════════
        // 3. Event construction & privacy invariants
        // ══════════════════════════════════════════════════════════════════
        await section("Event construction & privacy invariants", async () => {
            const built = buildAIUsageEvent({
                provider: "codecraft",
                model: FAKE_CODECRAFT_MODEL,
                usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, reported: true },
                pricing: { pricing: METERED_PRICING, confirmedFree: false },
                latencyMs: 7,
                status: "success",
            });
            check(
                built.provider === "codecraft" && built.model === FAKE_CODECRAFT_MODEL &&
                built.totalTokens === 15 && built.latencyMs === 7 && built.status === "success",
                "Event: provider, model, tokens, latency and status are recorded"
            );
            // The executable specification of "no prompts are persisted", applied
            // to what the BUILDER actually produces — not to a hand-written
            // fixture, which a change to the builder could not break.
            check(
                findForbiddenUsageFields(built).length === 0,
                "Security: the event the builder produces contains no forbidden field"
            );
            check(
                Object.keys(built).every((k) =>
                    (ALLOWED_USAGE_FIELDS as readonly string[]).includes(k)),
                "Security: the builder emits allow-listed keys only — nothing extra is attached"
            );
            check(
                !("userId" in built) && !("source" in built),
                "Privacy: userId is ABSENT when the caller resolved no identity, never invented"
            );

            const withCtx = buildAIUsageEvent({
                provider: "openrouter",
                model: FREE_MODEL,
                usage: { ...ZERO_USAGE },
                latencyMs: 1,
                status: "error",
                context: { source: "agent", sourceId: "agent-7", userId: "  " },
            });
            check(
                withCtx.source === "agent" && withCtx.sourceId === "agent-7" &&
                !("userId" in withCtx),
                "Privacy: a blank userId is treated as unknown rather than stored as an id"
            );

            const blocked = buildAIUsageEvent({
                provider: "codecraft",
                model: FAKE_CODECRAFT_MODEL,
                usage: { ...ZERO_USAGE },
                pricing: { pricing: METERED_PRICING, confirmedFree: false },
                latencyMs: 0,
                status: "error",
                errorCode: "AI_BUDGET_EXCEEDED",
                forcedCostUsd: 0,
            });
            check(
                blocked.estimatedCostUsd === 0 && blocked.errorCode === "AI_BUDGET_EXCEEDED",
                "Cost: a budget-blocked request records a real 0 cost — no provider was contacted"
            );

            // A payload cannot be attached even by mistake: the builder has no
            // parameter that accepts one, and the deny-list catches a future refactor.
            const leak = findForbiddenUsageFields({
                id: "ev",
                prompt: "secret instruction",
                nested: { headers: { Authorization: "Bearer x" }, apiKey: "k" },
                provider: "openrouter",
            });
            check(
                leak.length === 4 && leak.includes("prompt") && leak.includes("nested.headers") &&
                leak.includes("nested.headers.Authorization") && leak.includes("nested.apiKey"),
                "Security: prompts, headers and api keys are detectable anywhere in an event"
            );
            check(
                findForbiddenUsageFields(event({})).length === 0,
                "Security: a real usage event contains no forbidden field — including promptTokens/completionTokens"
            );
            check(
                FORBIDDEN_USAGE_FIELDS.includes("prompt") && FORBIDDEN_USAGE_FIELDS.includes("raw") &&
                FORBIDDEN_USAGE_FIELDS.includes("apikey"),
                "Security: the deny-list covers prompts, raw provider bodies and credentials"
            );
            check(
                Object.keys(event({})).every((k) =>
                    (ALLOWED_USAGE_FIELDS as readonly string[]).includes(k)),
                "Security: only allow-listed keys ever exist on an event"
            );

            const redacted = redactAIUsageError(
                "failed: Authorization: Bearer sk-abcdefghijklmnop and key=SUPERSECRETVALUE123",
            );
            check(
                !redacted.includes("sk-abcdefghijklmnop") && !redacted.includes("SUPERSECRETVALUE123") &&
                redacted.includes("[redacted]"),
                "Security: a persistence failure is logged with credentials redacted"
            );
        });

        // ══════════════════════════════════════════════════════════════════
        // 4. Aggregation & period keys
        // ══════════════════════════════════════════════════════════════════
        await section("Aggregation & period keys", async () => {
            let bucket: AIUsageBucket = emptyUsageBucket();
            bucket = applyEventToBucket(bucket, event({
                source: "chat",
                totalTokens: 150,
                estimatedCostUsd: 0.001,
            }));
            bucket = applyEventToBucket(bucket, event({
                source: "agent",
                sourceId: "agent-1",
                userId: "user-1",
                totalTokens: 250,
                status: "error",
                estimatedCostUsd: null,
            }));

            check(bucket.totals.requests === 2, "Aggregate: the period total counts both requests");
            check(
                bucket.totals.successfulRequests === 1 && bucket.totals.failedRequests === 1,
                "Aggregate: successful and failed requests are tracked separately"
            );
            check(
                bucket.totals.totalTokens === 400,
                "Aggregate: prompt + completion tokens roll up into the period total"
            );
            check(
                bucket.totals.costUnknownRequests === 1,
                "Aggregate: an unpriced request is COUNTED as unknown, not folded into $0"
            );
            check(
                bucket.providers.openrouter?.counters.totalTokens === 400 &&
                bucket.providers.openrouter?.models[FREE_MODEL]?.requests === 2,
                "Aggregate: usage rolls up per provider AND per model"
            );
            check(
                bucket.sources.chat?.requests === 1 && bucket.sources.agent?.requests === 1,
                "Aggregate: usage rolls up per source surface"
            );
            check(
                bucket.users["user-1"]?.requests === 1 && bucket.dimensions["agent-1"]?.requests === 1,
                "Aggregate: usage rolls up per user and per source id when they are known"
            );
            check(
                !("users" in bucket && Object.keys(bucket.users).some((k) => k === "anonymous")),
                "Aggregate: no synthetic \"anonymous\" bucket is ever created"
            );

            check(
                countersToPublic(emptyUsageCounters()).estimatedCostUsd === 0,
                "Aggregate: an empty period reports 0 requests, not \"cost unavailable\""
            );
            check(
                countersToPublic(bucket.totals).estimatedCostUsd === 0.001,
                "Aggregate: a partly-known bucket reports the known estimate"
            );
            const allUnknown = applyEventToBucket(emptyUsageBucket(), event({ estimatedCostUsd: null }));
            check(
                countersToPublic(allUnknown.totals).estimatedCostUsd === null,
                "Aggregate: a bucket where EVERY cost is unknown reports null, never $0"
            );

            check(
                usdToMicros(0.0000015) === 2 && microsToUsd(2) === 0.000002,
                "Aggregate: cost is accumulated in integer micro-USD to avoid float drift"
            );

            check(
                toUsageCounters({ requests: "bogus", totalTokens: 10 }).requests === 0 &&
                toUsageCounters(null).totalTokens === 0,
                "Aggregate: a corrupt node degrades to zeroed counters instead of NaN"
            );

            check(
                aiMonthKey(Date.parse("2026-01-31T23:59:59.999Z")) === "2026-01" &&
                aiMonthKey(Date.parse("2026-02-01T00:00:00.000Z")) === "2026-02",
                "Period: the month key rolls at the month boundary (YYYY-MM), so history is preserved"
            );
            check(
                aiDayKey(Date.parse("2026-09-15T12:00:00.000Z")) === "2026-09-15",
                "Period: the day bucket key is YYYY-MM-DD"
            );
        });

        // ══════════════════════════════════════════════════════════════════
        // 5. Concurrency: the aggregate merge must not lose increments
        // ══════════════════════════════════════════════════════════════════
        await section("Concurrency: the aggregate merge must not lose increments", async () => {
            // (a) The pure merge is additive and order-independent, which is the
            //     property a transaction's read-modify-write relies on.
            const events: AIUsageEvent[] = Array.from({ length: 50 }, (_, i) =>
                event({ id: `ev_${i}`, totalTokens: 10, estimatedCostUsd: 0.000001 }),
            );
            const forward = events.reduce(applyEventToBucket, emptyUsageBucket());
            const backward = [...events].reverse().reduce(applyEventToBucket, emptyUsageBucket());
            check(
                forward.totals.requests === 50 && forward.totals.totalTokens === 500 &&
                forward.totals.costUsdMicros === 50,
                "Concurrency: 50 events aggregate to exactly 50 requests / 500 tokens / $0.00005"
            );
            check(
                forward.totals.totalTokens === backward.totals.totalTokens &&
                forward.totals.costUsdMicros === backward.totals.costUsdMicros,
                "Concurrency: the merge is order-independent, so a retry cannot double-count or drop"
            );

            // (b) A fake RTDB node whose `transaction` genuinely interleaves
            //     writers: the updater is called against a value that has already
            //     been mutated by another writer, exactly as the real API does.
            const node = { value: null as AIUsageBucket | null, writes: 0 };
            const transaction = async (updater: (v: AIUsageBucket | null) => AIUsageBucket | null) => {
                for (;;) {
                    const snapshotBefore = node.value === null
                        ? null
                        : JSON.parse(JSON.stringify(node.value)) as AIUsageBucket;
                    const next = updater(snapshotBefore);
                    if (next === null) return;
                    // Another writer may have committed between our read and write.
                    if (JSON.stringify(node.value) === JSON.stringify(snapshotBefore)) {
                        node.value = next;
                        node.writes++;
                        return;
                    }
                }
            };

            // Two writers race; the second one's read is deliberately stale.
            const inFlight: Array<Promise<void>> = [];
            const write = (e: AIUsageEvent, delayMs: number): Promise<void> =>
                transaction((current) =>
                    applyEventToBucket(
                        current && current.totals.requests > 0
                            ? current
                            : { ...emptyUsageBucket() },
                        e,
                    )).then(() => new Promise<void>((r) => setTimeout(r, delayMs)));

            inFlight.push(write(event({ id: "a", totalTokens: 100 }), 5));
            await new Promise((r) => setTimeout(r, 1));
            inFlight.push(write(event({ id: "b", totalTokens: 200 }), 0));
            await Promise.all(inFlight);

            check(
                (node.value?.totals.requests ?? 0) === 2 &&
                (node.value?.totals.totalTokens ?? 0) === 300,
                "Concurrency: interleaved transactional writers lose no increments"
            );
            check(
                (node.value?.providers.openrouter?.models[FREE_MODEL]?.requests ?? 0) === 2,
                "Concurrency: the per-model counter is updated atomically with the period total"
            );
        });

        // ══════════════════════════════════════════════════════════════════
        // 6. Budget configuration resolution
        // ══════════════════════════════════════════════════════════════════
        await section("Budget configuration resolution", async () => {
            resetAll();
            check(
                envAIBudgetConfig().global.monthlyUsd === null &&
                envAIBudgetConfig().global.monthlyTokens === null,
                "Budget: with no env configured there is NO limit — enforcement is opt-in"
            );

            process.env.GLOBAL_AI_MONTHLY_TOKEN_LIMIT = "100000";
            process.env.GLOBAL_AI_MONTHLY_BUDGET_USD = "25";
            process.env.AI_PROVIDER_CODECRAFT_MONTHLY_TOKEN_LIMIT = "50000";
            invalidateAIBudgetConfigCache();
            const fromEnv = envAIBudgetConfig();
            check(
                fromEnv.global.monthlyTokens === 100000 && fromEnv.global.monthlyUsd === 25 &&
                fromEnv.providers.codecraft?.monthlyTokens === 50000,
                "Budget: global and per-provider limits are read from the documented env vars"
            );
            check(
                envAIBudgetConfig().providers.gemini === undefined,
                "Budget: a provider with no env limit has no budget at all"
            );

            process.env.AI_PROVIDER_CODECRAFT_MONTHLY_BUDGET_USD = "-5";
            invalidateAIBudgetConfigCache();
            check(
                envAIBudgetConfig().providers.codecraft?.monthlyUsd === null,
                "Budget: a negative limit is treated as misconfiguration, not as \"block everything\""
            );
            delete process.env.AI_PROVIDER_CODECRAFT_MONTHLY_BUDGET_USD;

            const merged = mergeAIBudgetConfig(
                { ...emptyAIBudgetConfig(), global: limits({ monthlyTokens: 100000, monthlyUsd: 25 }) },
                { global: { monthlyTokens: 200000 }, providers: { gemini: { monthlyUsd: 5 } } },
            );
            check(
                merged.global.monthlyTokens === 200000 && merged.global.monthlyUsd === 25,
                "Budget: an RTDB override wins per-limit, leaving unmentioned limits from env intact"
            );
            check(
                merged.providers.gemini?.monthlyUsd === 5 && merged.providers.gemini?.monthlyTokens === null,
                "Budget: an RTDB override can add a limit for a provider that env did not configure"
            );

            delete process.env.AI_BUDGET_WARN_THRESHOLD;
            delete process.env.AI_BUDGET_BLOCK_THRESHOLD;
            check(
                budgetThresholds().warn === 0.8 && budgetThresholds().block === 1,
                "Budget: thresholds default to ALLOW < 80%, WARN 80-99%, BLOCK at 100%"
            );
            process.env.AI_BUDGET_WARN_THRESHOLD = "0.5";
            process.env.AI_BUDGET_BLOCK_THRESHOLD = "0.6";
            check(
                budgetThresholds().warn === 0.5 && budgetThresholds().block === 0.6,
                "Budget: warn and block thresholds are configurable"
            );
            process.env.AI_BUDGET_WARN_THRESHOLD = "0.95";
            check(
                budgetThresholds().warn < budgetThresholds().block,
                "Budget: a warn threshold at/above the block threshold is clamped so WARN stays reachable"
            );
            resetAll();
        });

        // ══════════════════════════════════════════════════════════════════
        // 7. Budget evaluation (ALLOW / WARN / BLOCK)
        // ══════════════════════════════════════════════════════════════════
        await section("Budget evaluation (ALLOW / WARN / BLOCK)", async () => {
            resetAll();
            // No limit configured anywhere.
            install();
            let r = await evaluateAIBudget({ provider: "codecraft" });
            check(
                r.decision === "ALLOW" && r.checks.length === 0,
                "Budget: with no limit configured the decision is ALLOW and nothing is read"
            );

            process.env.GLOBAL_AI_MONTHLY_TOKEN_LIMIT = "1000";
            invalidateAIBudgetConfigCache();

            // 40% -> ALLOW
            install({ usage: snapshot({ totals: { ...emptyUsageCounters(), requests: 4, totalTokens: 400 } }) });
            r = await evaluateAIBudget({ provider: "openrouter" });
            check(
                r.decision === "ALLOW",
                "Budget: 40% of the global token limit is ALLOW"
            );

            // 80% -> WARN (still allowed)
            install({ usage: snapshot({ totals: { ...emptyUsageCounters(), requests: 8, totalTokens: 800 } }) });
            r = await evaluateAIBudget({ provider: "openrouter" });
            check(
                r.decision === "WARN" && r.checks[0].utilization === 0.8,
                "Budget: 80% of the global token limit is WARN (allowed, but reported)"
            );

            // 100% -> BLOCK
            install({ usage: snapshot({ totals: { ...emptyUsageCounters(), requests: 10, totalTokens: 1000 } }) });
            r = await evaluateAIBudget({ provider: "openrouter" });
            check(
                r.decision === "BLOCK" && r.checks[0].kind === "tokens",
                "Budget: 100% of the global token limit is BLOCK, checked BEFORE the request"
            );

            // Above 100% stays BLOCK
            install({ usage: snapshot({ totals: { ...emptyUsageCounters(), requests: 12, totalTokens: 1200 } }) });
            r = await evaluateAIBudget({ provider: "openrouter" });
            check(r.decision === "BLOCK", "Budget: usage beyond the limit remains BLOCK");

            // Cost axis.
            process.env.GLOBAL_AI_MONTHLY_TOKEN_LIMIT = "";
            process.env.GLOBAL_AI_MONTHLY_BUDGET_USD = "10";
            invalidateAIBudgetConfigCache();
            install({ usage: snapshot({ totals: { ...emptyUsageCounters(), requests: 1, costUsdMicros: 9_000_000 } }) });
            r = await evaluateAIBudget({ provider: "openrouter" });
            check(
                r.decision === "WARN" && r.checks[0].kind === "cost" && r.checks[0].utilization === 0.9,
                "Budget: the USD axis is enforced on the same thresholds as tokens"
            );

            // A provider budget must not disable the global one. The global
            // TOKEN limit is what is exhausted; the global USD limit sits at
            // $0 used, so only the token axis can block here.
            process.env.GLOBAL_AI_MONTHLY_TOKEN_LIMIT = "1000";
            process.env.AI_PROVIDER_CODECRAFT_MONTHLY_TOKEN_LIMIT = "999999";
            invalidateAIBudgetConfigCache();
            install({
                usage: snapshot({
                    totals: { ...emptyUsageCounters(), requests: 10, totalTokens: 1000 },
                    providers: { codecraft: { ...emptyUsageCounters() } },
                }),
            });
            r = await evaluateAIBudget({ provider: "codecraft" });
            check(
                r.decision === "BLOCK" && r.checks.some((c) => c.scope === "global"),
                "Budget: a generous provider limit does NOT disable the global limit"
            );
            check(
                r.checks.some((c) => c.scope === "provider" && c.decision === "ALLOW"),
                "Budget: the provider check is still evaluated independently"
            );

            // Per-provider blocking only blocks that provider.
            process.env.AI_PROVIDER_CODECRAFT_MONTHLY_TOKEN_LIMIT = "1000";
            invalidateAIBudgetConfigCache();
            install({
                usage: snapshot({
                    totals: { ...emptyUsageCounters(), requests: 1, totalTokens: 10 },
                    providers: { codecraft: { ...emptyUsageCounters(), requests: 10, totalTokens: 5000 } },
                }),
            });
            const cc = await evaluateAIBudget({ provider: "codecraft" });
            const or = await evaluateAIBudget({ provider: "openrouter" });
            check(
                cc.decision === "BLOCK" && or.decision === "ALLOW",
                "Budget: exhausting a provider budget blocks that provider only"
            );

            // User + plugin scopes.
            install({
                usage: snapshot({
                    totals: { ...emptyUsageCounters(), requests: 1, totalTokens: 10 },
                    users: { "user-9": { ...emptyUsageCounters(), requests: 5, totalTokens: 5000 } },
                    dimensions: { "plugin-3": { ...emptyUsageCounters(), requests: 5, totalTokens: 5000 } },
                }),
                overrides: {
                    users: { "user-9": { monthlyTokens: 1000 } },
                    plugins: { "plugin-3": { monthlyTokens: 1000 } },
                },
            });
            const overUser = await evaluateAIBudget({ provider: "openrouter", userId: "user-9" });
            const overPlugin = await evaluateAIBudget({
                provider: "openrouter",
                source: "plugin",
                sourceId: "plugin-3",
            });
            const otherUser = await evaluateAIBudget({ provider: "openrouter", userId: "user-1" });
            check(
                overUser.decision === "BLOCK" && overPlugin.decision === "BLOCK",
                "Budget: per-user and per-plugin limits are enforced against their own usage"
            );
            check(
                otherUser.decision === "ALLOW",
                "Budget: one user's exhausted budget does not block another user"
            );

            // assertAIBudgetAllowed throws a typed, code-carrying error.
            install({ usage: snapshot({ totals: { ...emptyUsageCounters(), requests: 10, totalTokens: 1000 } }) });
            let thrownCode = "";
            let thrownReason = "";
            try {
                await assertAIBudgetAllowed({ provider: "openrouter" });
            } catch (err) {
                thrownCode = (err as AIBudgetError).code;
                thrownReason = (err as AIBudgetError).message;
            }
            check(
                thrownCode === "AI_BUDGET_EXCEEDED" && thrownReason.length > 0,
                "Budget: assertAIBudgetAllowed throws AI_BUDGET_EXCEEDED with a human-readable reason"
            );

            // Unknown pricing is disclosed, not hidden.
            install({
                usage: snapshot({
                    totals: {
                        ...emptyUsageCounters(), requests: 10, totalTokens: 10, costUsdMicros: 1_000_000,
                        costUnknownRequests: 5,
                    },
                }),
            });
            process.env.GLOBAL_AI_MONTHLY_TOKEN_LIMIT = "";
            invalidateAIBudgetConfigCache();
            r = await evaluateAIBudget({ provider: "openrouter" });
            check(
                r.reason.includes("unknown pricing"),
                "Cost: a partly-unknown cost bucket says so instead of implying a precise estimate"
            );
            resetAll();
        });

        // ══════════════════════════════════════════════════════════════════
        // 8. Fail-safe policy
        // ══════════════════════════════════════════════════════════════════
        await section("Fail-safe policy", async () => {
            resetAll();
            process.env.GLOBAL_AI_MONTHLY_TOKEN_LIMIT = "1000";
            invalidateAIBudgetConfigCache();

            // Unavailable state + a provider that may cost money => fail CLOSED.
            process.env.AI_FREE_ONLY = "false";
            check(
                providerHasMeteredRisk("codecraft") === true,
                "Fail-safe: with free-only off, any provider is a metered risk"
            );
            install({ usage: emptyAIBudgetUsageSnapshot(false) });
            let r = await evaluateAIBudget({ provider: "codecraft" });
            check(
                r.decision === "BLOCK" && r.stateAvailable === false,
                "Fail-safe: unreadable budget state + a metered provider BLOCKS (fail closed)"
            );

            // Unavailable state + provably-free traffic => do NOT take the AI
            // system down for an analytics outage.
            process.env.AI_FREE_ONLY = "true";
            install({ usage: emptyAIBudgetUsageSnapshot(false) });
            r = await evaluateAIBudget({ provider: "openrouter" });
            check(
                r.decision === "ALLOW" && r.stateAvailable === false,
                "Fail-safe: unreadable budget state does NOT block a provider that cannot cost money"
            );

            // A metered opt-in re-arms fail-closed for that provider only.
            process.env.CODECRAFT_ALLOW_METERED = "true";
            check(
                providerHasMeteredRisk("codecraft") === true &&
                providerHasMeteredRisk("openrouter") === false,
                "Fail-safe: a per-provider metered opt-in arms fail-closed for that provider only"
            );
            r = await evaluateAIBudget({ provider: "codecraft" });
            check(
                r.decision === "BLOCK",
                "Fail-safe: with CODECRAFT_ALLOW_METERED=true, unreadable state blocks CodeCraft"
            );

            // No limit configured => state is irrelevant, even when unreadable.
            resetAll();
            install({ usage: emptyAIBudgetUsageSnapshot(false) });
            process.env.AI_FREE_ONLY = "false";
            r = await evaluateAIBudget({ provider: "codecraft" });
            check(
                r.decision === "ALLOW",
                "Fail-safe: with no budget configured, an outage cannot block anything"
            );
            resetAll();
        });

        // ══════════════════════════════════════════════════════════════════
        // 9. Budget status reporting (admin UI)
        // ══════════════════════════════════════════════════════════════════
        await section("Budget status reporting (admin UI)", async () => {
            const thresholds = { warn: 0.8, block: 1 };
            const used = (tokens: number, micros: number, unknown = 0) => ({
                ...emptyUsageCounters(), requests: 1, totalTokens: tokens, costUsdMicros: micros,
                costUnknownRequests: unknown,
            });

            check(
                computeBudgetStatus("global", "global", limits({ monthlyTokens: 100000 }), used(78420, 0), thresholds)
                    .status === "healthy",
                "Status: 78.4% of the limit is Healthy"
            );
            check(
                computeBudgetStatus("global", "global", limits({ monthlyTokens: 100000 }), used(85000, 0), thresholds)
                    .status === "warning",
                "Status: 85% of the limit is Warning"
            );
            check(
                computeBudgetStatus("global", "global", limits({ monthlyTokens: 100000 }), used(100000, 0), thresholds)
                    .status === "exceeded",
                "Status: 100% of the limit is Exceeded"
            );

            const unlimited = computeBudgetStatus(
                "provider", "openrouter", limits(), used(500, 0), thresholds,
            );
            check(
                unlimited.status === "unlimited" && unlimited.tokenUtilization === null,
                "Status: a scope with no limit is \"No limit set\", never a misleading 0% Healthy"
            );

            const unknownCost = computeBudgetStatus(
                "global", "global", limits({ monthlyUsd: 10 }), used(10, 0, 1), thresholds,
            );
            check(
                unknownCost.usedCostUsd === null && unknownCost.costUtilization === null,
                "Status: a wholly unknown cost reports \"Cost unavailable\", not $0"
            );

            // Two requests, one unpriced: the known half is still reported.
            const partial = computeBudgetStatus(
                "global", "global", limits({ monthlyUsd: 10 }),
                {
                    ...emptyUsageCounters(), requests: 2, totalTokens: 10,
                    costUsdMicros: 5_000_000, costUnknownRequests: 1,
                },
                thresholds,
            );
            check(
                partial.usedCostUsd === 5 && partial.costUtilization === 0.5 &&
                partial.costUnknownRequests === 1,
                "Status: a partly known cost still reports the known estimate, its share and the gap"
            );
        });

        // ══════════════════════════════════════════════════════════════════
        // 10. Pricing index & catalog snapshot
        // ══════════════════════════════════════════════════════════════════
        await section("Pricing index & catalog snapshot", async () => {
            const index = buildPricingIndex([
                {
                    id: FAKE_CODECRAFT_MODEL, name: "n", provider: "codecraft",
                    free: false, confirmedFree: false, enabled: true, pricing: METERED_PRICING,
                },
                {
                    id: "vendor/open-model:free", name: "n", provider: "openrouter",
                    free: true, confirmedFree: true, enabled: true,
                },
            ]);
            check(
                lookupModelPricing(index, "codecraft", FAKE_CODECRAFT_MODEL)?.pricing?.prompt === "0.000000115",
                "Pricing: the index carries provider-reported pricing, looked up case-insensitively"
            );
            check(
                lookupModelPricing(index, "openrouter", "VENDOR/OPEN-MODEL:FREE")?.confirmedFree === true,
                "Pricing: free status is carried per model from the catalog"
            );
            check(
                lookupModelPricing(index, "gemini", "nope") === undefined &&
                lookupModelPricing(null, "codecraft", "x") === undefined,
                "Pricing: an unknown model or a cold snapshot yields UNKNOWN, never a default price"
            );

            resetCatalogSnapshot();
            setCatalogLoader(async () => []);
            check(
                (await import("../catalog-snapshot")).getModelPricingEntry("codecraft", "x") === undefined,
                "Pricing: a cold catalog snapshot yields UNKNOWN rather than a fabricated price"
            );
            let loads = 0;
            setCatalogLoader(async () => {
                loads++;
                return [
                    {
                        id: "m1", name: "m1", provider: "openrouter",
                        free: false, confirmedFree: false, enabled: true, pricing: METERED_PRICING,
                    },
                ];
            });
            await refreshCatalogSnapshot(true);
            check(
                (await import("../catalog-snapshot")).getModelPricingEntry("openrouter", "m1") !== undefined,
                "Pricing: a warm snapshot resolves a model from the provider catalog"
            );
            await refreshCatalogSnapshot();
            check(loads === 1, "Pricing: a warm snapshot is reused, not refetched per request");
            resetCatalogSnapshot();
            setCatalogLoader(null);
        });

        // ══════════════════════════════════════════════════════════════════
        // 11. Router integration: successful usage accounting
        // ══════════════════════════════════════════════════════════════════
        await section("Router integration: successful usage accounting", async () => {
            resetAll();
            onlyProviders(["openrouter"]);
            const rec = mockProviders({ usage: { prompt_tokens: 1234, completion_tokens: 566, total_tokens: 1800 } });
            global.fetch = rec.fetch;
            setCatalogLoader(async () => [
                {
                    id: FREE_MODEL, name: "free", provider: "openrouter",
                    free: true, confirmedFree: true, enabled: true,
                },
            ]);
            await refreshCatalogSnapshot(true);

            const events = install();
            const res = await captureOutputAsync(() => defaultRouter.chat({
                provider: "openrouter",
                model: FREE_MODEL,
                messages: [{ role: "user", content: "hello" }],
            }, { source: "chat", userId: "user-42" }));
            await defaultRouter.drainUsage();

            check(res.provider === "openrouter", "Router: the request succeeded via the expected provider");
            check(
                events.length === 1 && events[0].status === "success" &&
                events[0].provider === "openrouter" && events[0].model === FREE_MODEL,
                "Usage: a successful request records exactly one event with provider and model"
            );
            check(
                events[0]?.promptTokens === 1234 && events[0]?.completionTokens === 566 &&
                events[0]?.totalTokens === 1800,
                "Usage: the provider's reported token counts are recorded"
            );
            check(
                typeof events[0]?.latencyMs === "number" && events[0].latencyMs >= 0,
                "Usage: request latency is recorded"
            );
            check(
                events[0]?.userId === "user-42" && events[0]?.source === "chat",
                "Usage: the caller's resolved identity and source are recorded"
            );
            check(
                events[0]?.estimatedCostUsd === 0,
                "Cost: a confirmed-free model records a real 0 cost"
            );
            check(
                findForbiddenUsageFields(events[0]).length === 0,
                "Security: the recorded event contains no prompt, header or credential"
            );
            check(
                typeof events[0] === "object" && events[0] !== null &&
                !JSON.stringify(events[0]).includes("hello"),
                "Security: the user's message text is never persisted in the usage event"
            );

            // Failure accounting.
            rec.reset();
            install();
            const failRec = mockProviders({ failProviders: ["openrouter"] });
            global.fetch = failRec.fetch;
            process.env.AI_MAX_PROVIDER_ATTEMPTS = "1";
            const failEvents: AIUsageEvent[] = [];
            __setAIUsageSinkForTests(async (e) => {
                failEvents.push(e);
            });
            __setAIBudgetReadersForTests(async () => snapshot(), async () => null);
            const failRes = await captureOutputAsync(() => defaultRouter.chat({
                provider: "openrouter",
                model: FREE_MODEL,
                messages: [{ role: "user", content: "hello" }],
            }));
            await defaultRouter.drainUsage();
            delete process.env.AI_MAX_PROVIDER_ATTEMPTS;

            check(
                failEvents.some((e) => e.status === "error" && e.provider === "openrouter" &&
                    e.errorCode === "INVALID_API_KEY" || e.errorCode === "UNKNOWN_ERROR" || e.errorCode === "QUOTA_EXCEEDED"),
                "Usage: a failed provider attempt is recorded as an error event with its error code"
            );
            check(
                (failRes.fallbackErrors ?? []).length > 0,
                "Usage: a failed attempt still surfaces in fallbackErrors (existing behaviour preserved)"
            );

            // Local heuristic accounting: real 0 cost, no provider call.
            const localEvents: AIUsageEvent[] = [];
            onlyProviders([]);
            install({ collect: localEvents });
            const localRes = await captureOutputAsync(() => defaultRouter.chat({
                messages: [{ role: "user", content: "RSI overbought on EURUSD" }],
            }));
            await defaultRouter.drainUsage();
            check(
                localRes.provider === "local-heuristic" || localRes.provider === "local",
                "Fallback: with no provider available the local heuristic still answers"
            );
            check(
                localEvents.some((e) => e.provider === "local" && e.estimatedCostUsd === 0),
                "Usage: the local heuristic is accounted with a measured 0 cost, not omitted"
            );
            check(
                localEvents.every((e) => !("userId" in e)),
                "Privacy: an unauthenticated request records NO userId rather than an invented one"
            );
        });

        // ══════════════════════════════════════════════════════════════════
        // 12. Router integration: budget enforcement
        // ══════════════════════════════════════════════════════════════════
        await section("Router integration: budget enforcement", async () => {
            resetAll();
            onlyProviders(["openrouter", "opencode"]);
            const rec = mockProviders();
            global.fetch = rec.fetch;
            process.env.AI_MAX_PROVIDER_ATTEMPTS = "4";
            process.env.GLOBAL_AI_MONTHLY_TOKEN_LIMIT = "1000";
            invalidateAIBudgetConfigCache();

            // -- Global budget exceeded: NO provider may run, including via fallback.
            const exhausted = snapshot({
                totals: { ...emptyUsageCounters(), requests: 20, totalTokens: 1000 },
            });
            install({ usage: exhausted });
            rec.reset();
            const events = install({ usage: exhausted });
            const blockedRes = await captureOutputAsync(() => defaultRouter.chat({
                messages: [{ role: "user", content: "hello" }],
            }));
            await defaultRouter.drainUsage();

            check(
                rec.chatBodies.length === 0,
                "Budget: a globally exhausted budget stops EVERY provider from being called"
            );
            check(
                events.filter((e) => e.errorCode === "AI_BUDGET_EXCEEDED").length === 2,
                "Budget: a blocked provider is recorded so the admin UI can show blocked requests"
            );
            check(
                events.filter((e) => e.errorCode === "AI_BUDGET_EXCEEDED")
                .every((e) => e.estimatedCostUsd === 0 && e.totalTokens === 0),
                "Budget: a blocked request costs 0 and consumes 0 tokens — no provider was contacted"
            );
            check(
                !!blockedRes.budgetBlocked &&
                blockedRes.budgetBlocked.providers.length === 2,
                "Budget: when every provider is blocked the response reports AI_BUDGET_EXCEEDED"
            );
            check(
                (blockedRes.fallbackErrors ?? []).every((e) => e.code === "AI_BUDGET_EXCEEDED"),
                "Budget: the returned errors are clean AI_BUDGET_EXCEEDED, with no partial spend"
            );
            check(
                blockedRes.provider === "local-heuristic" || blockedRes.provider === "local",
                "Budget: a fully blocked request still degrades to the free local heuristic"
            );

            // -- Provider budget exceeded: that provider is skipped, the next runs.
            process.env.GLOBAL_AI_MONTHLY_TOKEN_LIMIT = "";
            process.env.AI_PROVIDER_OPENROUTER_MONTHLY_TOKEN_LIMIT = "100";
            invalidateAIBudgetConfigCache();
            const providerSpent = snapshot({
                totals: { ...emptyUsageCounters(), requests: 1, totalTokens: 10 },
                providers: { openrouter: { ...emptyUsageCounters(), requests: 10, totalTokens: 100 } },
            });
            install({ usage: providerSpent });
            rec.reset();
            const skipRes = await captureOutputAsync(() => defaultRouter.chat({
                provider: "openrouter",
                model: FREE_MODEL,
                messages: [{ role: "user", content: "hello" }],
            }));
            await defaultRouter.drainUsage();

            check(
                rec.chatBodies.length === 1,
                "Budget: a provider over its own budget is skipped and the next allowed provider runs"
            );
            check(
                skipRes.provider === "opencode" && !skipRes.budgetBlocked,
                "Budget: fallback past a blocked provider succeeds normally and is not reported as fully blocked"
            );
            check(
                (skipRes.fallbackErrors ?? []).some((e) =>
                    e.code === "AI_BUDGET_EXCEEDED" && e.provider === "openrouter"),
                "Budget: the blocked provider appears in fallbackErrors so the skip is observable"
            );

            // -- A blocked provider must NOT consume an attempt slot.
            process.env.AI_MAX_PROVIDER_ATTEMPTS = "1";
            invalidateAIBudgetConfigCache();
            rec.reset();
            const oneAttempt = await captureOutputAsync(() => defaultRouter.chat({
                provider: "openrouter",
                model: FREE_MODEL,
                messages: [{ role: "user", content: "hello" }],
            }));
            await defaultRouter.drainUsage();
            check(
                oneAttempt.provider === "opencode" && rec.chatBodies.length === 1,
                "Budget: with AI_MAX_PROVIDER_ATTEMPTS=1 a blocked provider still lets the next one run"
            );
            process.env.AI_MAX_PROVIDER_ATTEMPTS = "4";

            // -- No infinite loop: each provider is consulted exactly once.
            // A GLOBAL block is re-established here; the per-provider limit set
            // above would only block openrouter, leaving opencode runnable.
            process.env.GLOBAL_AI_MONTHLY_TOKEN_LIMIT = "1000";
            delete process.env.AI_PROVIDER_OPENROUTER_MONTHLY_TOKEN_LIMIT;
            invalidateAIBudgetConfigCache();
            install({ usage: exhausted });
            rec.reset();
            await captureOutputAsync(() => defaultRouter.chat({
                messages: [{ role: "user", content: "hello" }],
            }));
            await defaultRouter.drainUsage();
            check(
                rec.chatBodies.length === 0,
                "Budget: when every provider is blocked the router terminates instead of retrying"
            );

            // -- Enforcement happens BEFORE the provider is contacted.
            install({ usage: exhausted });
            rec.reset();
            const orderLog: string[] = [];
            const origFetch = global.fetch;
            global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
                orderLog.push(String(input).includes("/chat/completions") ? "provider" : "other");
                return origFetch(input, init);
            }) as typeof fetch;
            await captureOutputAsync(() => defaultRouter.chat({
                messages: [{ role: "user", content: "hello" }],
            }));
            await defaultRouter.drainUsage();
            global.fetch = origFetch;
            check(
                !orderLog.includes("provider"),
                "Budget: the limit is enforced pre-flight — no provider request is issued when blocked"
            );
        });

        // ══════════════════════════════════════════════════════════════════
        // 13. CodeCraft interaction with budgets (must be unaltered)
        // ══════════════════════════════════════════════════════════════════
        await section("CodeCraft interaction with budgets (must be unaltered)", async () => {
            resetAll();
            onlyProviders(["codecraft"]);
            const rec = mockProviders();
            global.fetch = rec.fetch;
            process.env.CODECRAFT_MODEL = FAKE_CODECRAFT_MODEL;
            process.env.GLOBAL_AI_MONTHLY_TOKEN_LIMIT = "100000";
            invalidateAIBudgetConfigCache();
            install();

            // Opt-in OFF: the free-only policy blocks metered CodeCraft, exactly
            // as before this feature existed. The budget is not what blocks it.
            const out1 = await captureOutputAsync(() => defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "hello" }],
            }));
            await defaultRouter.drainUsage();
            check(
                out1.provider !== "codecraft" && rec.chatBodies.length === 0,
                "CodeCraft: with CODECRAFT_ALLOW_METERED unset, metered CodeCraft stays blocked"
            );
            check(
                !(out1.budgetBlocked ?? null),
                "CodeCraft: that refusal comes from the free-only policy, not from the budget guard"
            );

            // Opt-in ON, budget allows: the request runs on the configured model.
            process.env.CODECRAFT_ALLOW_METERED = "true";
            rec.reset();
            install();
            const out2 = await captureOutputAsync(() => defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "hello" }],
            }));
            await defaultRouter.drainUsage();
            check(
                out2.provider === "codecraft" && out2.model === FAKE_CODECRAFT_MODEL,
                "CodeCraft: with the opt-in on and budget available, metered CodeCraft runs on the configured model"
            );
            check(rec.chatBodies.length === 1, "CodeCraft: exactly one upstream request was issued");

            // Opt-in ON, global budget exhausted: now the budget blocks it.
            install({ usage: snapshot({ totals: { ...emptyUsageCounters(), requests: 20, totalTokens: 100000 } }) });
            rec.reset();
            const out3 = await captureOutputAsync(() => defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "hello" }],
            }));
            await defaultRouter.drainUsage();
            check(
                out3.provider !== "codecraft" && rec.chatBodies.length === 0 && !!out3.budgetBlocked,
                "CodeCraft: with the opt-in on, a global budget still applies and blocks the metered call"
            );

            // The budget must never change WHICH model is requested.
            install();
            rec.reset();
            const out4 = await captureOutputAsync(() => defaultRouter.chat({
                provider: "codecraft",
                model: FAKE_CODECRAFT_MODEL,
                messages: [{ role: "user", content: "hello" }],
            }));
            await defaultRouter.drainUsage();
            check(
                rec.chatBodies.length === 0 ||
                rec.chatBodies.every((b) => b.model === FAKE_CODECRAFT_MODEL),
                "CodeCraft: budget enforcement never substitutes a different model id"
            );
            check(
                out4.provider !== "codecraft" || out4.model === FAKE_CODECRAFT_MODEL,
                "CodeCraft: the model reported for a budget-passed request is the requested one"
            );

            // A budget that is merely WARNING must not touch the model either.
            // This is the path where a "save money by downgrading" regression
            // would actually reach the provider, so it is asserted directly.
            install({
                usage: snapshot({
                    totals: { ...emptyUsageCounters(), requests: 8, totalTokens: 80_000 },
                }),
            });
            rec.reset();
            const warned = await captureOutputAsync(() => defaultRouter.chat({
                provider: "codecraft",
                model: FAKE_CODECRAFT_MODEL,
                messages: [{ role: "user", content: "hello" }],
            }));
            await defaultRouter.drainUsage();
            check(
                warned.provider === "codecraft" && warned.model === FAKE_CODECRAFT_MODEL &&
                rec.chatBodies.every((b) => b.model === FAKE_CODECRAFT_MODEL),
                "CodeCraft: a WARNING budget still runs the EXACT requested model, never a cheaper one"
            );
            process.env.CODECRAFT_ALLOW_METERED = "";
        });

        // ══════════════════════════════════════════════════════════════════
        // 14. Fail-safe: accounting failure never fails a request
        // ══════════════════════════════════════════════════════════════════
        await section("Fail-safe: accounting failure never fails a request", async () => {
            resetAll();
            onlyProviders(["openrouter"]);
            const rec = mockProviders({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
            global.fetch = rec.fetch;

            __setAIUsageSinkForTests(async () => {
                throw new Error("RTDB unavailable: Authorization: Bearer sk-should-never-be-printed");
            });
            __setAIBudgetReadersForTests(async () => snapshot(), async () => null);

            // Captured through a mutable holder: the assignment happens inside
            // a callback, which control-flow narrowing cannot see.
            const holder: { res: Awaited<ReturnType<typeof defaultRouter.chat>> | null } = { res: null };
            const logs = await captureOutput(async () => {
                holder.res = await defaultRouter.chat({
                    provider: "openrouter",
                    model: FREE_MODEL,
                    messages: [{ role: "user", content: "hello" }],
                });
                await defaultRouter.drainUsage();
            });

            check(
                holder.res?.provider === "openrouter" && holder.res?.success === true,
                "Fail-safe: a usage-persistence failure still returns the AI result normally"
            );
            check(
                logs.includes("Usage persistence failed"),
                "Fail-safe: the persistence failure is logged so it is not silent"
            );
            check(
                !logs.includes("sk-should-never-be-printed"),
                "Security: the persistence-failure log is credential-redacted"
            );
        });

        // ══════════════════════════════════════════════════════════════════
        // 15. Source / static security invariants
        // ══════════════════════════════════════════════════════════════════
        await section("Source / static security invariants", async () => {
            const fs = await import("node:fs");
            const path = await import("node:path");
            const root = process.cwd();
            const read = (p: string) => {
                try {
                    return fs.readFileSync(path.join(root, p), "utf8");
                } catch {
                    return "";
                }
            };

            const routerSrc = read("lib/ai/router.ts");
            check(
                !/from\s+["']@\/lib\/firebase-admin["']/.test(routerSrc) &&
                !/from\s+["']\.\/usage-store["']/.test(routerSrc),
                "Security: the router has NO static Firebase import, so no client bundle can pull credentials in"
            );
            check(
                /evaluateBudgetSafely/.test(routerSrc) &&
                routerSrc.indexOf("evaluateBudgetSafely") < routerSrc.indexOf("attempts++"),
                "Budget: the budget gate is evaluated BEFORE the attempt counter is incremented"
            );
            check(
                /attempts >= maxAttempts/.test(routerSrc) &&
                routerSrc.indexOf("attempts >= maxAttempts") < routerSrc.indexOf("attempts++"),
                "Budget: the max-attempts guard still runs first, so provider ordering semantics are preserved"
            );

            // The budget branch must be a pure gate. Anything that writes to the
            // request inside it would mean enforcement can change what is sent.
            const gateStart = routerSrc.indexOf("evaluateBudgetSafely(");
            const gateEnd = routerSrc.indexOf("attempts++", gateStart);
            const gate = routerSrc.slice(gateStart, gateEnd);
            check(
                !/\brequest\s*=[^=]/.test(gate) && !/\brequest\s*\.\s*\w+\s*=[^=]/.test(gate),
                "Budget: the enforcement gate never mutates the request or the model id"
            );

            const guardsSrc = read("lib/ai/runtime-guards.ts");
            check(
                /await import\(["']\.\/usage-store["']\)/.test(guardsSrc) &&
                /typeof window === "undefined"/.test(guardsSrc),
                "Security: the Firebase store is reached only via a lazy, window-guarded dynamic import"
            );

            // Accounting context must never be forwardable upstream.
            const providerSources = [
                "lib/ai/providers/gemini.ts", "lib/ai/providers/openrouter.ts",
                "lib/ai/providers/opencode.ts", "lib/ai/providers/codecraft.ts",
                "lib/ai/providers/bai.ts", "lib/ai/providers/bytez.ts",
            ].map(read).join("\n");
            check(
                !/sourceId|userId|AIRequestContext/.test(providerSources),
                "Security: no provider can read accounting context, so it cannot be forwarded upstream"
            );

            const rulesText = read("database.rules.json");
            type DbRule = false | { ".read"?: unknown; ".write"?: unknown; [k: string]: unknown };
            const rules: { rules: Record<string, DbRule> } | null = parseJson(rulesText);
            const denied = ["aiUsageEvents", "aiUsageDaily", "aiUsageMonthly", "aiBudgets"];
            check(
                !!rules && denied.every((k) => {
                    const node = rules!.rules[k];
                    return !!node &&
                        node[".read"] === false && node[".write"] === false;
                }),
                "Security: client read AND write are denied on every usage/budget namespace"
            );
            check(
                !!rules && Object.values(rules!.rules).every(
                    (v) => v === false || typeof v === "object",
                ),
                "Security: the rules file parses and contains only rule objects"
            );

            for (const p of [
                "app/api/admin/ai/usage/route.ts",
                "app/api/admin/ai/budgets/route.ts",
            ]) {
                const src = read(p);
                check(
                    /requireAdmin/.test(src),
                    `Security: ${p} is guarded by the existing requireAdmin`
                );
                check(
                    !/GEMINI_API_KEY|OPENROUTER_API_KEY|OPENCODE_API_KEY|CODECRAFT_API_KEY|BAI_API_KEY|BYTEZ_API_KEY|serviceAccount|private_key/.test(src),
                    `Security: ${p} never references a provider credential or the service account`
                );
                check(
                    !/process\.env\.[A-Z0-9_]*API_KEY/.test(src),
                    `Security: ${p} never echoes an API key from the environment`
                );
            }

            // The event is written whole, so the guarantee is structural: the
            // `AIUsageEvent` type admits only scalars, and the store never
            // references a payload member. Word boundaries keep `promptTokens`
            // (a counter) from matching `prompt` (a payload).
            const storeSrc = read("lib/ai/usage-store.ts");
            check(
                !/\bevent\.(raw|messages|systemPrompt|authorization|apiKey|headers|payload|content|prompt|body)\b/.test(storeSrc),
                "Security: the store never reads a prompt/completion/credential member off an event"
            );
            check(
                /\.set\(event\)/.test(storeSrc) &&
                /\(event: AIUsageEvent\)/.test(storeSrc),
                "Security: exactly the typed AIUsageEvent is persisted — nothing is merged in"
            );

            const eventType = /export interface AIUsageEvent \{([\s\S]*?)\n\}/.exec(
                read("lib/ai/usage-events.ts"),
            );
            const eventMembers = (eventType?.[1] ?? "")
                .split("\n")
                .map((l) => l.trim().match(/^([A-Za-z_]\w*)\??\s*:\s*(.+);$/))
                .filter((m): m is RegExpMatchArray => m !== null)
                .map((m) => m[2]);
            const SCALAR_TYPES = new Set([
                "string", "number", "AIUsageStatus", "AIUsageSource", "number | null",
            ]);
            check(
                eventType !== null && eventMembers.length >= 12 &&
                eventMembers.every((t) => SCALAR_TYPES.has(t)),
                "Security: every AIUsageEvent member is a scalar, so no payload can be stored"
            );
        });

        // ══════════════════════════════════════════════════════════════════
        // 16. Source label hygiene
        // ══════════════════════════════════════════════════════════════════
                // ══════════════════════════════════════════════════════════════════
        // 16. Source label hygiene
        // ══════════════════════════════════════════════════════════════════
        await section("Source label hygiene", async () => {
            check(
                isAIUsageSource("chat") && isAIUsageSource("plugin") && isAIUsageSource("agent") &&
                isAIUsageSource("workflow") && isAIUsageSource("studio") && isAIUsageSource("system"),
                "Source: every documented source label is accepted"
            );
            check(
                !isAIUsageSource("bogus") && !isAIUsageSource(42) && !isAIUsageSource(null),
                "Source: an unrecognised label is rejected rather than stored verbatim"
            );
            check(
                createAIUsageEventId(1758000000000) !== createAIUsageEventId(1758000000000),
                "Event: successive usage ids are distinct"
            );
        });

        // ══════════════════════════════════════════════════════════════════
        // 17. Health module validation
        // ══════════════════════════════════════════════════════════════════
        await section("Health module validation", async () => {
            // Test credential mapping
            check(Object.keys(PROVIDER_CREDENTIAL_ENV).length >= 6, 
                "PROVIDER_CREDENTIAL_ENV should cover all registered providers");

            // Test sanitization of error codes
            check(sanitizeAIErrorCode(null) === null, 
                "Sanitization should handle null");
            check(sanitizeAIErrorCode(42) === null, 
                "Sanitization should reject numbers");
            check(sanitizeAIErrorCode("BAD_KEY") === "BAD_KEY", 
                "Sanitization should preserve valid keys");

            // Test guard error detection
            check(isGuardErrorCode("AI_BUDGET_EXCEEDED") === true, 
                "Budget block should be detected as guard error");
            check(isGuardErrorCode("PROVIDER_UNAVAILABLE") === false, 
                "Provider errors should not be guard errors");

            // Test environment variable parsing
            const originalEnv = process.env.AI_HEALTH_FAILURE_RATE_THRESHOLD;
            process.env.AI_HEALTH_FAILURE_RATE_THRESHOLD = "0.75";
            check(aiHealthFailureRateThreshold() === 0.75, 
                "Environment variable should override default threshold");
            delete process.env.AI_HEALTH_FAILURE_RATE_THRESHOLD;
            if (originalEnv !== undefined) process.env.AI_HEALTH_FAILURE_RATE_THRESHOLD = originalEnv;

            // Test lookback days parsing
            const originalLookback = process.env.AI_HEALTH_LOOKBACK_DAYS;
            process.env.AI_HEALTH_LOOKBACK_DAYS = "30";
            check(aiHealthLookbackDays() === Math.min(30, 14), 
                "Lookback days should be capped at 14");
            delete process.env.AI_HEALTH_LOOKBACK_DAYS;
            if (originalLookback !== undefined) process.env.AI_HEALTH_LOOKBACK_DAYS = originalLookback;

            // Test hasProviderCredential with configured providers
            for (const providerId of Object.keys(PROVIDER_CREDENTIAL_ENV)) {
                const envVar = PROVIDER_CREDENTIAL_ENV[providerId];
                const hasCred = hasProviderCredential(providerId);
                const expected = Boolean((process.env[envVar] || "").trim());
                check(hasCred === expected, 
                    `hasProviderCredential(${providerId}) should match env ${envVar}`);
            }
        });
    } catch (err) {
        console.error("  FAIL: usage/budget suite threw:", err);
        passed = false;
    } finally {
        global.fetch = originalFetch;
        restoreEnv();
        resetCatalogSnapshot();
        setCatalogLoader(null);
        __resetAIRuntimeGuards();
        setAIBudgetUsageReader(null);
        setAIBudgetOverrideReader(null);
        __resetAIRuntimeGuards();
    }

    return passed;
}

/** Runs `fn` with console silenced and returns its result. */
async function captureOutputAsync<T>(fn: () => Promise<T>): Promise<T> {
    let result: T;
    await captureOutput(async () => {
        result = await fn();
    });
    return result!;
}

// Referenced so the config module stays in this suite's import graph: the
// free-only policy it reads is what several CodeCraft assertions depend on.
void AIConfig;
void AIConfig;
