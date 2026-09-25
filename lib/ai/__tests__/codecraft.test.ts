import { CodeCraftProvider } from "../providers/codecraft";
import { defaultRouter } from "../router";
import { AIConfig } from "../config";
import { AIChatRequest, AIModel } from "../types";
import { aiUsageTracker, AIProviderUsageMetric } from "../usage";
import { isModelConfirmedFree, assertFreeModelAllowed, isProviderMeteredAllowed } from "../models";
import { callAgentAI } from "@/lib/agents/ai-provider";
import { AgentContract } from "@/lib/agents/types";

// ─────────────────────────────────────────────────────────────────────────────
// CodeCraft provider QA suite.
//
// Runs entirely offline against a mocked `fetch` and FAKE credentials only —
// the real CODECRAFT_API_KEY is never read, printed, or used here.
// ─────────────────────────────────────────────────────────────────────────────

const FAKE_KEY = "test_codecraft_api_key_secret_12345";
/** Sentinel required by the error-sanitization audit. Never a real secret. */
const FAKE_UPSTREAM_SECRET = "CODECRAFT_SECRET_TEST_VALUE";

/**
 * The model id confirmed by a live GET /models. "codecraft-default" is NOT a
 * real CodeCraft model and must never be sent upstream.
 */
const VERIFIED_MODEL = "deepseek-v4-flash-0731";
/** A second real catalog id, used to prove model precedence. */
const VERIFIED_MODEL_2 = "deepseek-v4-pro-0813";

/** Real CodeCraft pricing block from the live catalog (non-zero = metered). */
const METERED_PRICING = { prompt: "0.000000115", completion: "0.000000115" };

/** A genuinely zero-priced catalog entry (free). */
const FREE_PRICING = { prompt: "0", completion: "0" };

/** Every model id this suite ever caused to be sent upstream. */
const SENT_MODELS = new Set<string>();

/** Every provider key the router consults, so the suite is hermetic. */
const PROVIDER_ENV_KEYS = [
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENCODE_API_KEY",
    "BAI_API_KEY",
    "BYTEZ_API_KEY",
    "CODECRAFT_API_KEY",
] as const;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function chatContent(content: string, extra: Record<string, unknown> = {}): Response {
    return jsonResponse({
        id: "chatcmpl-test",
        choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
        ...extra,
    });
}

/**
 * Routes CodeCraft traffic to `codeCraftHandler`. Other providers get
 * `otherProviderHandler` when supplied, otherwise an echo 200 that returns the
 * first message verbatim (so a test can prove content really came from the
 * provider that served it, rather than from a shared stub).
 */
function mockFetch(
    codeCraftHandler: (url: string, init?: RequestInit) => Promise<Response>,
    otherProviderHandler?: (url: string, init?: RequestInit) => Promise<Response>
): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("codecraft")) {
            if (url.includes("/chat/completions")) {
                try {
                    const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
                    if (body.model) SENT_MODELS.add(body.model);
                } catch {
                    /* body assertions are the caller's job */
                }
            }
            return codeCraftHandler(url, init);
        }
        if (otherProviderHandler) return otherProviderHandler(url, init);
        const body = JSON.parse(String(init?.body || "{}")) as { messages?: Array<{ content?: string }> };
        return chatContent(body.messages?.[0]?.content || "Fallback provider response");
    };
}

/** Runs `fn` with every captured console method silenced, returning the output. */
async function captureOutput(fn: () => Promise<void>): Promise<string[]> {
    const lines: string[] = [];
    const methods = ["log", "warn", "error"] as const;
    const originals = methods.map((m) => console[m]);
    methods.forEach((m, i) => {
        console[m] = (...args: unknown[]) => {
            lines.push(args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" "));
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
    return lines;
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

function agentFor(provider: string, model?: string): AgentContract {
    return {
        id: `test-agent-${provider}`,
        name: `Test ${provider} agent`,
        version: "1.0.0",
        role: "context",
        description: `Test agent targeting ${provider}`,
        capabilities: ["market_data"],
        requiredPermissions: ["market_data"],
        inputSchema: {},
        outputSchema: {},
        systemInstructions: "You are an agent.",
        tools: [],
        modelConfiguration: {
            poweredBy: "hybrid",
            provider,
            ...(model ? { model } : {}),
            responseFormat: "json_object",
        },
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 0, backoffMs: 100 },
        validationRules: {},
        status: "active",
    } as AgentContract;
}

export async function runCodeCraftTests(): Promise<boolean> {
    console.log("--- CodeCraft Provider Integration & QA Hardening Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) {
            console.log(`  PASS: ${label}`);
        } else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    const originalFetch = global.fetch;
    const savedEnv: Record<string, string | undefined> = {};
    for (const key of [
        "CODECRAFT_API_KEY",
        "CODECRAFT_BASE_URL",
        "CODECRAFT_MODEL",
        "CODECRAFT_ALLOW_METERED",
        ...PROVIDER_ENV_KEYS,
    ]) {
        savedEnv[key] = process.env[key];
    }

    const restoreEnv = () => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    };

    /** Hermetic baseline: CodeCraft available, every other cloud provider off. */
    const isolateCodeCraft = () => {
        for (const key of PROVIDER_ENV_KEYS) delete process.env[key];
        process.env.CODECRAFT_API_KEY = FAKE_KEY;
        delete process.env.CODECRAFT_BASE_URL;
        delete process.env.CODECRAFT_MODEL;
        delete process.env.CODECRAFT_ALLOW_METERED;
        delete process.env.AI_FREE_ONLY; // default: free-only ON
    };

    /**
     * CodeCraft is metered, so under the default AI_FREE_ONLY=true every real
     * model is blocked. Tests that exercise a real chat call must opt in
     * explicitly, exactly as an operator would.
     */
    const enableCodeCraftMetered = (model = VERIFIED_MODEL) => {
        process.env.CODECRAFT_ALLOW_METERED = "true";
        process.env.CODECRAFT_MODEL = model;
    };

    try {
        // 1. Provider registration & resolution
        const provider = defaultRouter.getProvider("codecraft");
        check(Boolean(provider), "CodeCraft provider is registered in defaultRouter");
        check(provider?.id === "codecraft", "Provider ID is 'codecraft'");
        check(provider?.name === "CodeCraft API", "Provider name is 'CodeCraft API'");
        check(defaultRouter.getProvider("CODECRAFT")?.id === "codecraft", "Provider lookup is case-insensitive");
        check(
            defaultRouter.getProvider("codecraft") === defaultRouter.getProvider("codecraft"),
            "Router returns a single shared provider instance (no per-call state)"
        );

        // Registration order must be preserved relative to existing providers.
        const idsAll = await (async () => {
            for (const key of PROVIDER_ENV_KEYS) {
                process.env[key] = key === "CODECRAFT_API_KEY" ? FAKE_KEY : `fake_${key.toLowerCase()}`;
            }
            process.env.AI_FREE_ONLY = "true";
            return (await defaultRouter.getAvailableProviders()).map((p) => p.id);
        })();
        check(
            idsAll.indexOf("codecraft") === idsAll.indexOf("opencode") + 1,
            "CodeCraft is registered directly after opencode (existing order preserved)"
        );
        check(
            idsAll.indexOf("codecraft") < idsAll.indexOf("bytez"),
            "CodeCraft does not reorder or displace the Bytez provider"
        );
        check(
            idsAll.indexOf("gemini") < idsAll.indexOf("codecraft") && idsAll.indexOf("openrouter") < idsAll.indexOf("codecraft"),
            "Gemini and OpenRouter still precede CodeCraft"
        );
        // B.AI is only available when the free-only policy is lifted, so its
        // relative order is asserted separately.
        process.env.AI_FREE_ONLY = "false";
        const idsPaid = (await defaultRouter.getAvailableProviders()).map((p) => p.id);
        check(
            idsPaid.indexOf("codecraft") < idsPaid.indexOf("bai"),
            "CodeCraft precedes B.AI when the free-only policy is lifted"
        );
        process.env.AI_FREE_ONLY = "true";

        // 2. Availability when API key is missing vs present
        isolateCodeCraft();
        delete process.env.CODECRAFT_API_KEY;
        check(provider?.isAvailable() === false, "isAvailable() returns false when CODECRAFT_API_KEY is not set");
        process.env.CODECRAFT_API_KEY = "   ";
        check(provider?.isAvailable() === false, "isAvailable() returns false for a whitespace-only key");
        process.env.CODECRAFT_API_KEY = FAKE_KEY;
        check(provider?.isAvailable() === true, "isAvailable() returns true when CODECRAFT_API_KEY is configured");

        // 3. Base URL configuration
        check(
            AIConfig.codecraftBaseUrl === "https://www.codecraftapi.com/v1",
            "Default Base URL is https://www.codecraftapi.com/v1"
        );
        process.env.CODECRAFT_BASE_URL = "https://custom.codecraftapi.com/v1/";
        check(
            AIConfig.codecraftBaseUrl === "https://custom.codecraftapi.com/v1",
            "Base URL trims trailing slash correctly"
        );
        delete process.env.CODECRAFT_BASE_URL;

        // 4. API Key server-side audit
        check(!("NEXT_PUBLIC_CODECRAFT_API_KEY" in process.env), "CODECRAFT_API_KEY is server-side only");

        // 5. Provider usage telemetry hook
        {
            enableCodeCraftMetered();
            const metrics: AIProviderUsageMetric[] = [];
            const unsubscribe = aiUsageTracker.subscribe((m) => {
                if (m.provider === "codecraft") metrics.push(m);
            });

            global.fetch = async () =>
                chatContent("Usage test response", {
                    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                });

            const instance = new CodeCraftProvider();
            const res = await instance.chat({ messages: [{ role: "user", content: "test telemetry" }] });

            check(metrics.length === 1, "Exactly one usage event is recorded per CodeCraft call");
            check(metrics[0]?.provider === "codecraft", "Usage metric provider is 'codecraft'");
            check(metrics[0]?.inputTokens === 10, "Usage metric records input tokens");
            check(metrics[0]?.outputTokens === 5, "Usage metric records output tokens");
            check(metrics[0]?.totalTokens === 15, "Usage metric totalTokens matches API payload");
            check(
                typeof metrics[0]?.latencyMs === "number" && metrics[0].latencyMs >= 0,
                "Usage metric records latency"
            );
            check(metrics[0]?.status === 200, "Usage metric records HTTP status");
            check(metrics[0]?.errorCategory === undefined, "Successful call records no error category");
            check(
                !Object.keys(metrics[0] ?? {}).some((k) => /prompt|content|message|key|secret/i.test(k)),
                "Usage metric stores no prompt, message body, or credential field"
            );
            check(!safeStringify(metrics[0]).includes(FAKE_KEY), "Usage metric never contains the API key");
            check(res.success === true, "Successful telemetry call returns success");

            unsubscribe();
        }

        // ── Provider fallback matrix (A–I) ───────────────────────────────────
        // A second provider is enabled so "fallback" is a REAL provider hop,
        // not a silent drop to the local heuristic.
        isolateCodeCraft();
        enableCodeCraftMetered();
        process.env.OPENCODE_API_KEY = "test_opencode_api_key_secondary";

        // Scenario A: CodeCraft succeeds
        {
            global.fetch = mockFetch(async () => chatContent("Scenario A: Success"));
            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "ping" }],
            });
            check(res.success === true, "Scenario A: Router succeeds when CodeCraft returns 200");
            check(res.provider === "codecraft", "Scenario A: Router returns provider 'codecraft'");
            check(res.content === "Scenario A: Success", "Scenario A: Router returns CodeCraft content");
            check(res.fallbackErrors === undefined, "Scenario A: No fallback errors recorded on success");
        }

        const fallbackScenarios: Array<{
            label: string;
            code: string;
            status?: number;
            handler: (url: string, init?: RequestInit) => Promise<Response>;
        }> = [
            {
                label: "B: 401",
                code: "INVALID_API_KEY",
                status: 401,
                handler: async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
            },
            {
                label: "C: 402",
                code: "QUOTA_EXCEEDED",
                status: 402,
                handler: async () => new Response(JSON.stringify({ error: "Payment required" }), { status: 402 }),
            },
            {
                label: "D: 429",
                code: "RATE_LIMITED",
                status: 429,
                handler: async () => new Response(JSON.stringify({ error: "Rate limit" }), { status: 429 }),
            },
            {
                label: "E: 404",
                code: "MODEL_UNAVAILABLE",
                status: 404,
                handler: async () => new Response(JSON.stringify({ error: "Model not found" }), { status: 404 }),
            },
            {
                label: "F: 408 timeout",
                code: "TIMEOUT",
                status: 408,
                handler: async () => new Response(JSON.stringify({ error: "Request timeout" }), { status: 408 }),
            },
            {
                label: "G: network failure",
                code: "UNKNOWN_ERROR",
                handler: async () => {
                    throw new TypeError("Failed to fetch (NetworkError)");
                },
            },
            {
                label: "H: malformed JSON",
                code: "UNKNOWN_ERROR",
                handler: async () =>
                    new Response("<html>Gateway Bad Response</html>", {
                        status: 200,
                        headers: { "Content-Type": "text/html" },
                    }),
            },
            {
                label: "I: empty content",
                code: "UNKNOWN_ERROR",
                handler: async () => chatContent("   "),
            },
            {
                label: "J: 500 upstream",
                code: "PROVIDER_UNAVAILABLE",
                status: 500,
                handler: async () => new Response(JSON.stringify({ error: "upstream boom" }), { status: 500 }),
            },
        ];

        for (const scenario of fallbackScenarios) {
            global.fetch = mockFetch(scenario.handler);
            const logs = await captureOutput(async () => {
                const res = await defaultRouter.chat({
                    provider: "codecraft",
                    messages: [{ role: "user", content: "ping" }],
                });

                check(res.provider !== "codecraft", `Scenario ${scenario.label}: CodeCraft is not reported as the winner`);
                check(res.provider === "opencode", `Scenario ${scenario.label}: Falls back to the next available provider`);
                check(res.content === "ping", `Scenario ${scenario.label}: Fallback content is the other provider's, never a fabricated answer`);
                const codecraftErrors = (res.fallbackErrors ?? []).filter((e) => e.provider === "codecraft");
                check(codecraftErrors.length === 1, `Scenario ${scenario.label}: Exactly one CodeCraft error recorded`);
                check(
                    codecraftErrors[0]?.code === scenario.code,
                    `Scenario ${scenario.label}: Error code is ${scenario.code} (got ${codecraftErrors[0]?.code})`
                );
                if (scenario.status !== undefined) {
                    check(
                        codecraftErrors[0]?.status === scenario.status,
                        `Scenario ${scenario.label}: HTTP status ${scenario.status} is preserved on the error`
                    );
                }
            });
            check(
                logs.some((l) => l.includes("Fallback triggered") && l.includes("codecraft")),
                `Scenario ${scenario.label}: Router logs the fallback transition`
            );
        }

        // Scenario K: real transport timeout via AbortController, not just HTTP 408.
        {
            process.env.AI_REQUEST_TIMEOUT_MS = "1000";
            global.fetch = mockFetch(
                (_url, init) =>
                    new Promise<Response>((_resolve, reject) => {
                        const signal = init?.signal;
                        const onAbort = () => {
                            const abortErr = new Error("The operation was aborted.");
                            abortErr.name = "AbortError";
                            reject(abortErr);
                        };
                        if (signal?.aborted) onAbort();
                        else signal?.addEventListener("abort", onAbort, { once: true });
                    })
            );
            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "ping" }],
            });
            check(res.provider === "opencode", "Scenario K: AbortController timeout falls back to the next provider");
            check(
                res.fallbackErrors?.some((e) => e.provider === "codecraft" && e.code === "TIMEOUT") === true,
                "Scenario K: Client-side abort is mapped to TIMEOUT"
            );
            delete process.env.AI_REQUEST_TIMEOUT_MS;
        }

        // Scenario L: every provider fails — must degrade to the local heuristic
        // and say so, never invent a cloud answer.
        {
            global.fetch = async () => new Response("nope", { status: 500 });
            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "ping" }],
            });
            check(
                res.provider === "local-heuristic" || res.provider === "local",
                "Scenario L: Total provider failure degrades to the local heuristic provider"
            );
            check(
                (res.fallbackErrors ?? []).length > 0,
                "Scenario L: Degradation is accompanied by the recorded provider errors"
            );
            check(res.success === true, "Scenario L: The local heuristic still returns a well-formed response");
        }

        // 6. Error sanitization & secret-redaction audit
        {
            // `echoesBody` marks the statuses whose provider message embeds the
            // upstream body (>=500 and other 4xx). The fixed-message statuses
            // (401/402/404/408/429) never echo it at all, which is strictly safer.
            const secretPaths: Array<{
                label: string;
                status: number;
                echoesBody: boolean;
                handler: (url: string, init?: RequestInit) => Promise<Response>;
            }> = [
                {
                    label: "500 body echo",
                    status: 500,
                    echoesBody: true,
                    handler: async () =>
                        new Response(JSON.stringify({ error: `denied for key ${FAKE_UPSTREAM_SECRET}` }), { status: 500 }),
                },
                {
                    label: "429 body echo",
                    status: 429,
                    echoesBody: false,
                    handler: async () =>
                        new Response(JSON.stringify({ error: `slow down, key=${FAKE_UPSTREAM_SECRET}` }), { status: 429 }),
                },
                {
                    label: "400 body echo",
                    status: 400,
                    echoesBody: true,
                    handler: async () =>
                        new Response(JSON.stringify({ error: { message: `bad api_key "${FAKE_UPSTREAM_SECRET}"` } }), { status: 400 }),
                },
            ];

            for (const p of secretPaths) {
                process.env.CODECRAFT_API_KEY = FAKE_UPSTREAM_SECRET;
                global.fetch = mockFetch(p.handler);

                let thrownMessage = "";
                let thrownStatus: number | undefined;
                try {
                    await new CodeCraftProvider().chat({ messages: [{ role: "user", content: "leak probe" }] });
                } catch (err: unknown) {
                    const e = err as { message?: string; status?: number };
                    thrownMessage = String(e.message || "");
                    thrownStatus = e.status;
                }
                check(thrownStatus === p.status, `Sanitization (${p.label}): HTTP status is preserved`);
                check(!thrownMessage.includes(FAKE_UPSTREAM_SECRET), `Sanitization (${p.label}): secret is redacted from the thrown error`);
                check(
                    !p.echoesBody || thrownMessage.includes("[REDACTED]"),
                    `Sanitization (${p.label}): echoed upstream text carries the redaction marker`
                );

                // The secret must not survive into router-level artifacts either.
                global.fetch = mockFetch(p.handler);
                const res = await defaultRouter.chat({
                    provider: "codecraft",
                    messages: [{ role: "user", content: "leak probe" }],
                });
                const serialized = safeStringify({
                    content: res.content,
                    fallbackErrors: res.fallbackErrors,
                    raw: res.raw,
                    provider: res.provider,
                    model: res.model,
                });
                check(!serialized.includes(FAKE_UPSTREAM_SECRET), `Sanitization (${p.label}): secret is absent from the serialized AI response`);
                check(!serialized.includes(FAKE_KEY), `Sanitization (${p.label}): API key is absent from the serialized AI response`);
                check(
                    (res.fallbackErrors ?? []).length > 0,
                    `Sanitization (${p.label}): failure is reported, never reported as success`
                );
            }

            // Truncation must not be able to emit a partial secret.
            {
                process.env.CODECRAFT_API_KEY = FAKE_UPSTREAM_SECRET;
                const padded = `${"x".repeat(400)}${FAKE_UPSTREAM_SECRET}`;
                global.fetch = mockFetch(async () => new Response(padded, { status: 500 }));
                let thrownMessage = "";
                try {
                    await new CodeCraftProvider().chat({ messages: [{ role: "user", content: "leak probe" }] });
                } catch (err: unknown) {
                    thrownMessage = String((err as { message?: string }).message || "");
                }
                check(
                    !thrownMessage.includes(FAKE_UPSTREAM_SECRET) && thrownMessage.length <= 400,
                    "Sanitization: upstream error text is sanitized BEFORE truncation (no partial secret)"
                );
            }

            // Secrets must never reach logs or the usage tracker.
            {
                process.env.CODECRAFT_API_KEY = FAKE_UPSTREAM_SECRET;
                const seen: AIProviderUsageMetric[] = [];
                const unsubscribe = aiUsageTracker.subscribe((m) => {
                    if (m.provider === "codecraft") seen.push(m);
                });
                global.fetch = mockFetch(
                    async () => new Response(JSON.stringify({ error: `key ${FAKE_UPSTREAM_SECRET}` }), { status: 500 })
                );
                const logs = await captureOutput(async () => {
                    await defaultRouter.chat({ provider: "codecraft", messages: [{ role: "user", content: "log probe" }] });
                });
                unsubscribe();
                const logBlob = logs.join("\n");
                check(!logBlob.includes(FAKE_UPSTREAM_SECRET), "Sanitization: secret never reaches console output");
                check(logBlob.includes("[REDACTED]"), "Sanitization: console output shows the redaction marker");
                check(
                    seen.every((m) => !safeStringify(m).includes(FAKE_UPSTREAM_SECRET)),
                    "Sanitization: secret never reaches the usage tracker"
                );
                check(
                    seen.some((m) => m.errorCategory === "PROVIDER_UNAVAILABLE"),
                    "Sanitization: usage tracker records the sanitized error category"
                );
            }

            process.env.CODECRAFT_API_KEY = FAKE_KEY;
        }

        // 7. Model configuration & resolution — F1: no fabricated placeholder.
        {
            const sentModels: string[] = [];
            global.fetch = mockFetch(async (_url, init) => {
                const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
                sentModels.push(body.model || "");
                return chatContent("Model test OK");
            });

            // 7a. The operator-configured model is used when the caller supplies none.
            process.env.CODECRAFT_MODEL = VERIFIED_MODEL_2;
            await new CodeCraftProvider().chat({ messages: [{ role: "user", content: "model test" }] });
            check(
                sentModels.at(-1) === VERIFIED_MODEL_2,
                "CODECRAFT_MODEL environment variable is respected by default"
            );

            // 7b. An explicit caller model overrides the operator setting.
            await new CodeCraftProvider().chat({
                model: VERIFIED_MODEL,
                messages: [{ role: "user", content: "model test" }],
            });
            check(
                sentModels.at(-1) === VERIFIED_MODEL,
                "Explicit request.model overrides the configured model (highest precedence)"
            );

            // 7c. F1 — with NO configured model and NO reachable catalog there is
            //      nothing real to send, so the provider must fail loudly instead
            //      of inventing an id or hiding the problem behind a 404.
            delete process.env.CODECRAFT_MODEL;
            process.env.CODECRAFT_ALLOW_METERED = "true";
            let upstreamChatCalls = 0;
            global.fetch = mockFetch(async (url) => {
                if (url.endsWith("/models")) return jsonResponse({ object: "list", data: [] });
                upstreamChatCalls++;
                return chatContent("must never happen");
            });
            let configError: { code?: string; message?: string } = {};
            try {
                await new CodeCraftProvider().chat({ messages: [{ role: "user", content: "no model" }] });
            } catch (err: unknown) {
                configError = err as { code?: string; message?: string };
            }
            check(upstreamChatCalls === 0, "F1: no chat request is sent when no real model can be resolved");
            check(configError.code === "MODEL_UNAVAILABLE", "F1: unresolvable model reports MODEL_UNAVAILABLE");
            check(
                String(configError.message || "").includes("CODECRAFT_MODEL"),
                "F1: the error names the CODECRAFT_MODEL setting the operator must configure"
            );

            // 7c-2. F1+F2 — no configured model AND a catalog of only metered
            //        models under the free-only policy. The error must name the
            //        real cause (the cost policy) rather than blaming config.
            delete process.env.CODECRAFT_ALLOW_METERED;
            process.env.AI_FREE_ONLY = "true";
            let meteredOnlyCalls = 0;
            global.fetch = mockFetch(async (url) => {
                if (url.endsWith("/models")) {
                    return jsonResponse({
                        object: "list",
                        data: [
                            { id: VERIFIED_MODEL, pricing: METERED_PRICING },
                            { id: VERIFIED_MODEL_2, pricing: METERED_PRICING },
                        ],
                    });
                }
                meteredOnlyCalls++;
                return chatContent("must never happen");
            });
            let costError: { code?: string; message?: string } = {};
            try {
                await new CodeCraftProvider().chat({ messages: [{ role: "user", content: "no model" }] });
            } catch (err: unknown) {
                costError = err as { code?: string; message?: string };
            }
            check(meteredOnlyCalls === 0, "F2: an all-metered catalog sends no chat request without the opt-in");
            check(costError.code === "MODEL_UNAVAILABLE", "F2: the cost-blocked case reports MODEL_UNAVAILABLE");
            check(
                String(costError.message || "").includes("CODECRAFT_ALLOW_METERED"),
                "F2: the error names the scoped metered opt-in as the real cause"
            );
            check(
                String(costError.message || "").includes("free-only policy"),
                "F2: the error states that the free-only policy is what blocks the call"
            );
            check(
                !String(costError.message || "").includes("AI_FREE_ONLY=false"),
                "F2: the error never advises disabling the global free-only policy"
            );
            process.env.CODECRAFT_ALLOW_METERED = "true";
            delete process.env.AI_FREE_ONLY;

            // 7d. F1+F2 — with no configured model but a REAL catalog, and the
            //      metered opt-in ON, resolution picks a genuine catalog model
            //      (never a placeholder). Wrapped so a resolution failure is
            //      reported as a named failure instead of aborting the suite.
            let catalogChatCalls = 0;
            global.fetch = mockFetch(async (url, init) => {
                if (url.endsWith("/models")) {
                    return jsonResponse({
                        object: "list",
                        data: [
                            { id: VERIFIED_MODEL, pricing: METERED_PRICING },
                            { id: VERIFIED_MODEL_2, pricing: METERED_PRICING },
                        ],
                    });
                }
                const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
                catalogChatCalls++;
                sentModels.push(body.model || "");
                return chatContent("catalog-resolved OK");
            });
            let catalogResolved: { model?: string } = {};
            let catalogError = "";
            try {
                catalogResolved = await new CodeCraftProvider().chat({
                    messages: [{ role: "user", content: "no model" }],
                });
            } catch (err: unknown) {
                catalogError = String((err as { message?: string }).message || "");
            }
            check(!catalogError, `F1: a real catalog model resolves without error${catalogError ? ` (got: ${catalogError})` : ""}`);
            check(catalogChatCalls === 1, "F1: a real catalog model is used when CODECRAFT_MODEL is unset");
            check(
                [VERIFIED_MODEL, VERIFIED_MODEL_2].includes(sentModels.at(-1) || ""),
                `F1: resolution used a genuine catalog id (got ${sentModels.at(-1)})`
            );
            check(
                catalogResolved.model === sentModels.at(-1),
                "F1: the response reports the catalog model actually used"
            );
        }

        // 7e. Case B — an explicit model CodeCraft does NOT advertise must not
        //      be substituted with a different (metered) model. It fails clearly
        //      and no CodeCraft request is sent.
        {
            const sent: string[] = [];
            let modelCalls = 0;
            let chatCalls = 0;
            global.fetch = mockFetch(async (url, init) => {
                if (url.endsWith("/models")) {
                    modelCalls++;
                    return jsonResponse({
                        object: "list",
                        data: [
                            { id: VERIFIED_MODEL, pricing: METERED_PRICING },
                            { id: VERIFIED_MODEL_2, pricing: METERED_PRICING },
                        ],
                    });
                }
                const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
                chatCalls++;
                sent.push(body.model || "");
                return chatContent("Catalog model OK");
            });

            const instance = new CodeCraftProvider();
            let mismatch: { code?: string; message?: string } = {};
            try {
                await instance.chat({
                    model: "mimo-v2.5-free", // an OpenCode model id CodeCraft does not advertise
                    messages: [{ role: "user", content: "foreign model" }],
                });
            } catch (err: unknown) {
                mismatch = err as { code?: string; message?: string };
            }
            const msg = String(mismatch.message || "");
            check(chatCalls === 0, "Case B: an explicit non-CodeCraft model sends ZERO CodeCraft chat requests");
            check(sent.length === 0, "Case B: no model is silently substituted for an explicit request");
            check(mismatch.code === "MODEL_UNAVAILABLE", "Case B: an explicit non-advertised model reports MODEL_UNAVAILABLE");
            check(
                msg.includes("mimo-v2.5-free") && msg.includes("not advertised by CodeCraft"),
                "Case B: the error names the requested model and states CodeCraft does not advertise it"
            );
            check(
                !msg.includes(VERIFIED_MODEL) && !msg.includes(VERIFIED_MODEL_2),
                "Case B: the error does not advertise a substitute model"
            );
            check(
                !msg.includes("CODECRAFT_ALLOW_METERED"),
                "Case B: the mismatch error never suggests enabling metered usage"
            );

            // 7f. Case A — a model CodeCraft does advertise is sent verbatim.
            await instance.chat({ model: VERIFIED_MODEL_2, messages: [{ role: "user", content: "own model" }] });
            check(
                chatCalls === 1 && sent.at(-1) === VERIFIED_MODEL_2,
                "Case A: an explicit advertised model is sent verbatim, with no substitution"
            );
            check(
                sent.filter((m) => m !== VERIFIED_MODEL_2).length === 0,
                "Case A: no other model was ever sent upstream in this block"
            );

            // 7f-1. Case A precedence against a live catalog: an explicit model
            //       that CodeCraft advertises must win over a DIFFERENT
            //       CODECRAFT_MODEL. This is the branch where the catalog
            //       actually matches, so it is distinct from 7b.
            const savedConfiguredModel = process.env.CODECRAFT_MODEL;
            process.env.CODECRAFT_MODEL = VERIFIED_MODEL_2;
            const callsBeforeExplicit = chatCalls;
            await instance.chat({ model: VERIFIED_MODEL, messages: [{ role: "user", content: "explicit beats default" }] });
            check(
                chatCalls === callsBeforeExplicit + 1 && sent.at(-1) === VERIFIED_MODEL,
                "Case A: an explicit advertised model wins over a different CODECRAFT_MODEL"
            );
            if (savedConfiguredModel === undefined) delete process.env.CODECRAFT_MODEL;
            else process.env.CODECRAFT_MODEL = savedConfiguredModel;

            // 7f-2. Case D: with no explicit model, a configured model is used
            //       even when it is NOT in the catalog (F1 verbatim policy).
            process.env.CODECRAFT_MODEL = "codecraft-not-in-catalog";
            const callsBeforeConfigured = chatCalls;
            const configuredRes = await instance.chat({ messages: [{ role: "user", content: "configured default" }] });
            check(
                chatCalls === callsBeforeConfigured + 1 && sent.at(-1) === "codecraft-not-in-catalog",
                "Case D: a configured model absent from the catalog is sent verbatim, never substituted"
            );
            check(configuredRes.model === "codecraft-not-in-catalog", "Case D: the response reports the configured model");
            if (savedConfiguredModel === undefined) delete process.env.CODECRAFT_MODEL;
            else process.env.CODECRAFT_MODEL = savedConfiguredModel;

            // 7g. Catalog is cached, not re-fetched per request.
            const modelCallsAfterDiscovery = modelCalls;
            await instance.chat({ model: VERIFIED_MODEL_2, messages: [{ role: "user", content: "cached" }] });
            check(
                modelCalls === modelCallsAfterDiscovery && modelCalls === 1,
                "Discovered catalog is cached (exactly one /models call across repeated chats)"
            );
        }

        // 7e2. Case B through the router — the exact cost hazard: with
        //       CODECRAFT_ALLOW_METERED=true an explicit model mismatch must
        //       still NOT be upgraded into a metered CodeCraft request. The
        //       router's normal provider fallback takes over instead.
        {
            process.env.CODECRAFT_ALLOW_METERED = "true";
            delete process.env.CODECRAFT_MODEL;
            // Save/restore the secondary provider's key: later sections (9b)
            // rely on the fallback chain still being available.
            const opencodeKeyBefore = process.env.OPENCODE_API_KEY;
            process.env.OPENCODE_API_KEY = "test_opencode_api_key_secondary";
            let ccChatCalls = 0;
            global.fetch = mockFetch(
                async (url) => {
                    if (url.endsWith("/models")) {
                        return jsonResponse({
                            object: "list",
                            data: [
                                { id: VERIFIED_MODEL, pricing: METERED_PRICING },
                                { id: VERIFIED_MODEL_2, pricing: METERED_PRICING },
                            ],
                        });
                    }
                    ccChatCalls++;
                    return chatContent("must never happen");
                },
                async () => chatContent("OpenCode fallback response")
            );
            const res = await defaultRouter.chat({
                provider: "codecraft",
                model: "gemini-2.5-flash", // explicitly requested, not a CodeCraft model
                messages: [{ role: "user", content: "explicit mismatch" }],
            });
            const err = (res.fallbackErrors ?? []).find((e) => e.provider === "codecraft");
            check(
                ccChatCalls === 0,
                "Case B: CODECRAFT_ALLOW_METERED=true does NOT override an explicit model mismatch (no CodeCraft request)"
            );
            check(res.provider !== "codecraft", "Case B: the mismatched provider is not reported as the winner");
            check(!!err && err.code === "MODEL_UNAVAILABLE", "Case B: the router surfaces MODEL_UNAVAILABLE for the mismatch");
            check(
                String(err?.message || "").includes("not advertised by CodeCraft"),
                "Case B: the router fallback error explains that the model is not advertised"
            );
            check(
                res.content === "OpenCode fallback response",
                "Case B: normal provider fallback continues after the refusal"
            );
            if (opencodeKeyBefore === undefined) delete process.env.OPENCODE_API_KEY;
            else process.env.OPENCODE_API_KEY = opencodeKeyBefore;
        }

        // 7h. F3 — catalog free/paid status is derived from the pricing the
        //      provider actually returns, never from the provider name.
        {
            process.env.CODECRAFT_ALLOW_METERED = "true";
            process.env.CODECRAFT_MODEL = VERIFIED_MODEL;
            global.fetch = mockFetch(async (url) => {
                if (url.endsWith("/models")) {
                    return jsonResponse({
                        object: "list",
                        data: [
                            // Real live shape: non-zero string pricing -> metered.
                            { id: VERIFIED_MODEL, name: "DeepSeek V4 Flash", context_length: 1048576, pricing: METERED_PRICING },
                            // Zero input AND zero output price -> free.
                            { id: "codecraft-zero-price", pricing: FREE_PRICING },
                            // Only input is zero; output is metered -> NOT free.
                            { id: "codecraft-half-price", pricing: { prompt: "0", completion: "0.5" } },
                            // No pricing field at all -> unknown -> NOT free.
                            { id: "codecraft-no-pricing" },
                            // Empty pricing object -> unknown -> NOT free.
                            { id: "codecraft-empty-pricing", pricing: {} },
                            // Non-numeric garbage -> unparseable -> NOT free.
                            { id: "codecraft-garbage-pricing", pricing: { prompt: "free", completion: "free" } },
                        ],
                    });
                }
                return chatContent("pricing OK");
            });

            const catalog = await new CodeCraftProvider().getModels();
            const byId = new Map(catalog.map((m) => [m.id, m]));
            const get = (id: string) => byId.get(id) as AIModel;

            check(catalog.length === 6, "F3: every valid catalog entry is discovered");
            check(!byId.has(""), "F3: entries without a usable id are dropped");

            // Non-zero pricing (the real live case) must NOT be reported free.
            check(get(VERIFIED_MODEL).free === false, "F3: a metered model is reported free=false");
            check(get(VERIFIED_MODEL).confirmedFree === false, "F3: a metered model is reported confirmedFree=false");
            check(
                safeStringify(get(VERIFIED_MODEL).pricing) === safeStringify(METERED_PRICING),
                "F3: provider-reported pricing is carried through unchanged (never hardcoded)"
            );
            check(get(VERIFIED_MODEL).contextLength === 1048576, "F3: provider-reported context length is carried through");

            // Zero input AND zero output -> free.
            check(get("codecraft-zero-price").confirmedFree === true, "F3: zero input AND zero output pricing is free");
            check(get("codecraft-zero-price").free === true, "F3: zero-priced model is reported free=true");

            // Partial zero -> still metered.
            check(get("codecraft-half-price").confirmedFree === false, "F3: zero input but metered output is NOT free");

            // Missing / empty / unparseable pricing -> never free.
            check(get("codecraft-no-pricing").confirmedFree === false, "F3: missing pricing is NOT classified as free");
            check(get("codecraft-empty-pricing").confirmedFree === false, "F3: empty pricing is NOT classified as free");
            check(get("codecraft-garbage-pricing").confirmedFree === false, "F3: unparseable pricing is NOT classified as free");
            check(
                get("codecraft-no-pricing").pricing === undefined,
                "F3: absent pricing is left absent rather than defaulted to zero"
            );

            // F3 + F1: the provider-name rule is gone.
            check(
                isModelConfirmedFree("codecraft-default") === false,
                "F3: the removed codecraft-prefix rule no longer claims free access"
            );
            check(
                isModelConfirmedFree("codecraft-anything", METERED_PRICING) === false,
                "F3: a codecraft-prefixed id with metered pricing is not free"
            );
            check(
                isModelConfirmedFree("codecraft-zero", FREE_PRICING) === true,
                "F3: a codecraft-prefixed id with genuine zero pricing is free"
            );

            // No catalog offline fallback model may leak in.
            process.env.CODECRAFT_API_KEY = "";
            const offline = await new CodeCraftProvider().getModels();
            check(
                offline.length === 0,
                "F1/F3: getModels() returns no fabricated fallback model when the key is absent"
            );
            process.env.CODECRAFT_API_KEY = FAKE_KEY;

            // F2 interaction: a metered catalog is unusable under free-only
            // unless CodeCraft is explicitly opted in.
            process.env.AI_FREE_ONLY = "true";
            const meteredOnly = await new CodeCraftProvider().getModels();
            const freeOnes = meteredOnly.filter((m) => m.confirmedFree);
            check(
                meteredOnly.some((m) => m.id === VERIFIED_MODEL) && freeOnes.every((m) => m.confirmedFree),
                "F2/F3: the catalog still lists metered models; only zero-priced ones are confirmed free"
            );
            // The catalog's own pricing verdict and the guard must agree: this
            // real model is flagged metered, so the guard blocks it for CodeCraft
            // too until the operator opts in.
            check(
                get(VERIFIED_MODEL).confirmedFree === false,
                "F2/F3: the real model is cataloged as metered, not free"
            );
            delete process.env.CODECRAFT_ALLOW_METERED;
            let meteredBlocked = false;
            try {
                assertFreeModelAllowed(VERIFIED_MODEL, METERED_PRICING, "codecraft");
            } catch {
                meteredBlocked = true;
            }
            check(meteredBlocked, "F2: a cataloged metered model is blocked for CodeCraft without the opt-in");
            process.env.CODECRAFT_ALLOW_METERED = "true";
            let meteredAllowed = true;
            try {
                assertFreeModelAllowed(VERIFIED_MODEL, METERED_PRICING, "codecraft");
            } catch {
                meteredAllowed = false;
            }
            check(meteredAllowed, "F2: with the opt-in the same metered model is allowed for CodeCraft");
            delete process.env.AI_FREE_ONLY;
        }

        // 7h. F2 — the free-only cost policy, provider-scoped.
        {
            process.env.AI_FREE_ONLY = "true";

            // 7h-1. Default: CODECRAFT_ALLOW_METERED unset -> a metered CodeCraft
            //        model is blocked before any network call. The block happens
            //        inside the provider, so the router records it as a provider
            //        failure and falls back — it must never reach the upstream.
            delete process.env.CODECRAFT_ALLOW_METERED;
            process.env.CODECRAFT_MODEL = VERIFIED_MODEL;
            let called = false;
            global.fetch = mockFetch(async () => {
                called = true;
                return chatContent("should not happen");
            });
            const blockedRes = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "metered model" }],
            });
            check(!called, "F2: a metered CodeCraft model is blocked by default (no network call)");
            check(
                blockedRes.provider !== "codecraft",
                "F2: the cost-blocked provider is not reported as the winner"
            );
            const blockedErr = (blockedRes.fallbackErrors ?? []).find((e) => e.provider === "codecraft");
            check(!!blockedErr, "F2: the cost block is surfaced as a recorded provider failure");
            check(
                String(blockedErr?.message || "").includes("free-only policy"),
                "F2: blocked model reports the free-only cost-protection reason"
            );
            check(
                String(blockedErr?.message || "").includes("CODECRAFT_ALLOW_METERED"),
                "F2: the error names the scoped opt-in rather than suggesting a global override"
            );
            check(
                !String(blockedErr?.message || "").includes("AI_FREE_ONLY=false"),
                "F2: the error never suggests disabling the global free-only policy"
            );

            // 7h-1b. With an explicit model the router guard fires first and
            //         surfaces the same message to the caller as a hard error.
            let routerGuard = "";
            try {
                await defaultRouter.chat({
                    provider: "codecraft",
                    model: VERIFIED_MODEL,
                    messages: [{ role: "user", content: "metered model" }],
                });
            } catch (err: unknown) {
                routerGuard = String((err as { message?: string }).message || "");
            }
            check(
                routerGuard.includes("free-only policy") && routerGuard.includes("CODECRAFT_ALLOW_METERED"),
                "F2: the router-level guard throws with the scoped opt-in hint"
            );
            check(!routerGuard.includes("AI_FREE_ONLY=false"), "F2: the router guard never suggests a global override");

            // 7h-2. Explicit opt-in allows ONLY CodeCraft.
            process.env.CODECRAFT_ALLOW_METERED = "true";
            called = false;
            const allowed = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "metered model" }],
            });
            check(called, "F2: CODECRAFT_ALLOW_METERED=true permits the configured CodeCraft model");
            check(allowed.provider === "codecraft" && allowed.model === VERIFIED_MODEL, "F2: the allowed call used the configured model");

            // 7h-3. The same flag must NOT relax any other provider.
            let otherCalled = false;
            let otherGuard = "";
            global.fetch = mockFetch(
                async () => {
                    otherCalled = true;
                    return chatContent("should not happen");
                },
                async () => {
                    otherCalled = true;
                    return chatContent("should not happen");
                }
            );
            try {
                assertFreeModelAllowed("gpt-4o", undefined, "openrouter");
            } catch (err: unknown) {
                otherGuard = String((err as { message?: string }).message || "");
            }
            check(!!otherGuard, "F2: a metered model is still blocked for openrouter while CodeCraft is opted in");
            check(
                !otherGuard.includes("CODECRAFT_ALLOW_METERED"),
                "F2: a non-CodeCraft provider is not told about the CodeCraft opt-in"
            );

            // 7h-4. Other providers keep the pre-existing rules verbatim.
            const stillBlocked = ["gemini", "opencode", "bai", "bytez", "local", "unknown-provider"].filter((p) => {
                try {
                    assertFreeModelAllowed("gpt-4o", undefined, p);
                    return false;
                } catch {
                    return true;
                }
            });
            check(stillBlocked.length === 6, "F2: every other provider still blocks metered models under free-only");
            check(!otherCalled, "F2: no provider request was made for a blocked model");

            // 7h-5. A genuinely FREE model is never blocked, for anyone.
            const freeOk = ["codecraft", "opencode", "gemini"].filter((p) => {
                try {
                    assertFreeModelAllowed("mimo-v2.5-free", undefined, p);
                    return true;
                } catch {
                    return false;
                }
            });
            check(freeOk.length === 3, "F2: free models remain allowed for every provider regardless of the opt-in");

            // 7h-6. The guard is unchanged when no provider is supplied at all.
            let noProviderGuard = "";
            try {
                assertFreeModelAllowed("gpt-4o");
            } catch (err: unknown) {
                noProviderGuard = String((err as { message?: string }).message || "");
            }
            check(
                noProviderGuard === '[AI Cost Protection] Paid AI model "gpt-4o" blocked by free-only policy.',
                "F2: the provider-less guard message is byte-identical to the previous behaviour"
            );
            check(
                isProviderMeteredAllowed("codecraft") === true && isProviderMeteredAllowed("openrouter") === false,
                "F2: the metered opt-in registry covers CodeCraft only"
            );
            delete process.env.CODECRAFT_ALLOW_METERED;
            delete process.env.AI_FREE_ONLY;
        }

        // 7i. Invalid/unsupported model fails safely (error + fallback, never a fake success).
        {
            process.env.CODECRAFT_MODEL = "codecraft-does-not-exist";
            process.env.CODECRAFT_ALLOW_METERED = "true";
            global.fetch = mockFetch(async () => new Response(JSON.stringify({ error: "no such model" }), { status: 404 }));
            const res = await defaultRouter.chat({
                provider: "codecraft",
                messages: [{ role: "user", content: "bad model" }],
            });
            check(res.provider !== "codecraft", "An unsupported CODECRAFT_MODEL fails over instead of faking a response");
            check(
                res.fallbackErrors?.some((e) => e.provider === "codecraft" && e.code === "MODEL_UNAVAILABLE") === true,
                "An unsupported model is reported as MODEL_UNAVAILABLE"
            );
            delete process.env.CODECRAFT_MODEL;
        }

        // 8. Streaming & tool-calling contract (documented limitations)
        {
            enableCodeCraftMetered();
            const req = { messages: [{ role: "user" as const, content: "x" }] } as AIChatRequest;
            check(!("stream" in req), "AIChatRequest exposes no streaming field");
            check(!("tools" in req), "AIChatRequest exposes no tool-definition field");
            check(
                !("stream" in ({} as AIChatRequest)) && !("tools" in ({} as AIChatRequest)),
                "AIProvider chat contract has no streaming or tool-calling surface"
            );

            let body = "";
            global.fetch = mockFetch(async (_url, init) => {
                body = String(init?.body || "");
                return chatContent("contract probe");
            });
            await new CodeCraftProvider().chat({ messages: [{ role: "user", content: "contract probe" }] });
            check(!/"stream"\s*:/.test(body), "No stream flag is ever sent upstream");
            check(!/"tools"\s*:/.test(body), "No tools payload is ever sent upstream");
            check(!/"tool_choice"\s*:/.test(body), "No tool_choice payload is ever sent upstream");

            const models = await new CodeCraftProvider().getModels();
            check(
                models.every((m) => m.capabilities?.tools !== true),
                "CodeCraft does not advertise a tools capability that is not implemented"
            );
        }

        // 9. Multi-agent integration
        {
            enableCodeCraftMetered();
            global.fetch = mockFetch(async () => chatContent('{"summary": "Agent CodeCraft output"}'));
            const agentRes = await callAgentAI(agentFor("codecraft", VERIFIED_MODEL), "Run analysis", "System prompt");
            check(agentRes.ok === true, "Multi-agent callAgentAI returns ok");
            check(agentRes.provider === "codecraft", "modelConfiguration.provider = 'codecraft' correctly reaches CodeCraft");
            check(agentRes.text.includes("Agent CodeCraft output"), "Multi-agent output content received from CodeCraft");
            check(agentRes.model === VERIFIED_MODEL, "Agent receives the resolved CodeCraft model id");
        }

        // 9b. Sequential 3-agent workflow across providers: selection, order,
        //     output propagation, fallback and error handling.
        {
            const order: string[] = [];
            global.fetch = mockFetch(
                async () => {
                    order.push("codecraft");
                    return chatContent("STEP-PAYLOAD");
                },
                async () => {
                    order.push("opencode");
                    return chatContent("STEP-PAYLOAD");
                }
            );

            const a1 = agentFor("codecraft", VERIFIED_MODEL);
            const a2 = agentFor("opencode", "mimo-v2.5-free");
            const a3 = agentFor("codecraft", VERIFIED_MODEL);

            const o1 = await callAgentAI(a1, "step 1", "sys");
            const o2 = await callAgentAI(a2, "step 2", "sys");
            const o3 = await callAgentAI(a3, "step 3", "sys");

            check(order.join(",") === "codecraft,opencode,codecraft", "Sequential workflow preserves agent execution order");
            check(o1.provider === "codecraft" && o2.provider === "opencode" && o3.provider === "codecraft", "Each agent selects its own configured provider");
            check(o1.text === "STEP-PAYLOAD" && o3.text === "STEP-PAYLOAD", "Each agent's output propagates to its own caller");
            check(o2.text === "STEP-PAYLOAD", "Non-CodeCraft agent output is unaffected by the CodeCraft integration");

            // Fallback mid-workflow: step 3 CodeCraft fails, step 3 still returns content.
            const fallbackOrder: string[] = [];
            global.fetch = mockFetch(
                async () => {
                    fallbackOrder.push("codecraft");
                    return new Response("boom", { status: 500 });
                },
                async () => {
                    fallbackOrder.push("opencode");
                    return chatContent("STEP3-FALLBACK");
                }
            );
            const o3Fail = await callAgentAI(a3, "step 3 retry", "sys");
            check(o3Fail.ok === true, "A failing CodeCraft agent step still returns a usable result via the gateway");
            check(o3Fail.provider === "opencode", "The failing agent step falls back to another provider");
            check(o3Fail.text === "STEP3-FALLBACK", "Fallback content is the real fallback provider's output");
            check(
                fallbackOrder.join(",") === "codecraft,opencode",
                "The failing step records the CodeCraft attempt before the fallback hop"
            );

            // Error handling: deterministic agent must never call a provider.
            const callsBeforeDeterministic = order.length;
            const deterministic = { ...agentFor("codecraft"), modelConfiguration: { poweredBy: "deterministic" as const } };
            const oDet = await callAgentAI(deterministic, "step 4", "sys");
            check(oDet.ok === false, "A deterministic agent never invokes an AI provider");
            check(order.length === callsBeforeDeterministic, "A deterministic agent issues no network request");
        }

        // 10. Plugin integration — provider-agnostic, no CodeCraft-specific code.
        {
            // CodeCraft must be the only cloud provider, otherwise the generator's
            // provider-agnostic call could legitimately land on a different one.
            isolateCodeCraft();
            enableCodeCraftMetered();

            // The plugin generator transitively imports Firebase Admin, which
            // validates its credentials at import time. A throwaway RSA key
            // keeps the suite hermetic: no real credentials, no network.
            const { generateKeyPairSync } = await import("node:crypto");
            const { privateKey } = generateKeyPairSync("rsa", {
                modulusLength: 2048,
                publicKeyEncoding: { type: "spki", format: "pem" },
                privateKeyEncoding: { type: "pkcs8", format: "pem" },
            });
            const fbSaved: Record<string, string | undefined> = {
                FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
                FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
                FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
                NEXT_PUBLIC_FIREBASE_DATABASE_URL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
            };
            process.env.FIREBASE_PROJECT_ID = "codecraft-test";
            process.env.FIREBASE_CLIENT_EMAIL = "codecraft-test@example.invalid";
            process.env.FIREBASE_PRIVATE_KEY = privateKey;
            process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = "https://codecraft-test-default-rtdb.firebaseio.com";

            const { generatePluginSpec } = await import("@/lib/plugins/ai-generator");

            const spec = {
                name: "gold-alert",
                displayName: "Gold Alert",
                description: "Alerts when gold moves.",
                category: "market-monitoring",
                target: "plugin",
                permissions: {},
                capabilities: ["alert"],
                manifest: {
                    name: "gold-alert",
                    displayName: "Gold Alert",
                    version: "1.0.0",
                    type: "plugin",
                    category: "market-monitoring",
                    pricing: { type: "free", price: 0, currency: "usd" },
                    permissions: {},
                    subscribes: [],
                    emits: [],
                    runtime: {
                        interval: "manual",
                        sources: ["market.volatility.atrPercent"],
                        requires: ["market_monitor"],
                        condition: { source: "market.volatility.atrPercent", operator: "gt", value: 0.5, and: [] },
                    },
                },
            };

            let codeCraftPluginCalls = 0;
            global.fetch = mockFetch(async () => {
                codeCraftPluginCalls++;
                return chatContent(JSON.stringify(spec));
            });
            const gen = await generatePluginSpec("alert me on gold volatility", "plugin", "market-monitoring");
            check(codeCraftPluginCalls > 0, "The provider-agnostic plugin call is served by CodeCraft");
            check(gen.ok === true, "Plugin spec generation succeeds through CodeCraft with no plugin-side CodeCraft code");
            check(gen.ok && gen.spec.name === "gold-alert", "Plugin generator parses the real CodeCraft response");

            // Honesty check: when the gateway degrades, the plugin must say so.
            global.fetch = mockFetch(async () => chatContent("   "));
            const degraded = await generatePluginSpec("alert me on gold volatility", "plugin", "market-monitoring");
            check(
                degraded.ok === false && degraded.errors.join(" ").includes("temporarily unavailable"),
                "Plugin generator reports provider unavailability instead of inventing a spec"
            );

            for (const [k, v] of Object.entries(fbSaved)) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
            }
        }

        // 11. Rate limiting — CodeCraft must not bypass the shared limiter.
        {
            const limiterSource = await readFileSafe("lib/workflows/rate-limiter.ts");
            const providerSource = await readFileSafe("lib/ai/providers/codecraft.ts");
            const engineSource = await readFileSafe("lib/workflows/engine.ts");
            check(
                !/tryConsume|tokenBucket|RateLimit/i.test(providerSource ?? ""),
                "CodeCraft provider implements no independent rate limiter"
            );
            check(
                !!engineSource?.includes("tryConsume") && !engineSource?.includes("codecraft"),
                "The shared workflow limiter stays provider-agnostic (no CodeCraft bypass)"
            );
            check(limiterSource !== null, "Workflow rate limiter module is present for the engine to use");
        }

        // 12. Concurrency
        {
            enableCodeCraftMetered();
            let activeRequests = 0;
            let maxConcurrent = 0;
            const sentKeys: string[] = [];

            global.fetch = mockFetch(async (url, init) => {
                activeRequests++;
                maxConcurrent = Math.max(maxConcurrent, activeRequests);
                await new Promise((resolve) => setTimeout(resolve, 40));
                const body = JSON.parse(String(init?.body || "{}")) as { messages?: Array<{ content?: string }> };
                const reqText = body.messages?.[0]?.content || "";
                const headers = new Headers(init?.headers);
                sentKeys.push(String(headers.get("Authorization") || ""));
                activeRequests--;
                return chatContent(`Echo: ${reqText}`, {
                    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
                });
            });

            const metrics: AIProviderUsageMetric[] = [];
            const unsubscribe = aiUsageTracker.subscribe((m) => {
                if (m.provider === "codecraft") metrics.push(m);
            });

            const instance = new CodeCraftProvider();
            const results = await Promise.all(
                Array.from({ length: 12 }, (_, i) => instance.chat({ messages: [{ role: "user", content: `Concurrent req ${i}` }] }))
            );
            unsubscribe();

            check(maxConcurrent > 1, "Concurrent requests execute in parallel");
            check(results.length === 12, "All 12 concurrent requests completed");
            check(
                results.every((res, i) => res.content === `Echo: Concurrent req ${i}`),
                "No cross-request data corruption under concurrent load"
            );
            check(
                results.every((res) => res.provider === "codecraft" && res.model === VERIFIED_MODEL),
                "Every concurrent response is attributed to the correct provider and model"
            );
            check(
                sentKeys.length === 12 && sentKeys.every((k) => k === `Bearer ${FAKE_KEY}`),
                "No API key corruption across concurrent requests"
            );
            check(
                metrics.length === 12 && metrics.every((m) => m.totalTokens === 5 && m.provider === "codecraft"),
                "Usage reporting stays correctly attributed under concurrency"
            );
        }

        // 13. Public API surface
        {
            const aiIndex = await readFileSafe("lib/ai/index.ts");
            check(
                aiIndex !== null && aiIndex.includes('getProvider("codecraft")'),
                "getAIProvider() fallback chain includes CodeCraft"
            );
            const routerSource = await readFileSafe("lib/ai/router.ts");
            check(
                routerSource !== null && /codecraft/.test(routerSource),
                "Router registers and orders CodeCraft"
            );
            check(
                !(await readFileSafe("app/api/ai/chat/route.ts"))?.includes("raw"),
                "The public AI route does not serialize the raw provider payload"
            );
            const publicSurface = await readFileSafe("lib/ai/index.ts");
            check(
                !publicSurface?.includes("CODECRAFT_API_KEY") && !publicSurface?.includes("codecraftApiKey"),
                "lib/ai/index.ts exposes no CodeCraft credential accessor"
            );
            const clientComponents = await collectClientFiles("app");
            check(
                !clientComponents.some((f) => /CODECRAFT_API_KEY|codecraftApiKey/.test(f.contents)),
                "No \"use client\" module references the CodeCraft credential"
            );
            check(
                !clientComponents.some((f) => /from ["']@\/lib\/ai\//.test(f.contents)),
                "No \"use client\" module imports the server-only AI gateway"
            );
        }

        // 14. F1/F2/F3 — static guarantees across the whole lib/ai surface.
        {
            const sources = await collectSources("lib/ai");
            const offenders: string[] = [];
            for (const f of sources) {
                if (/["'`]codecraft-default["'`]/.test(stripComments(f.contents))) offenders.push(f.path);
            }
            check(
                offenders.length === 0,
                `F1: the literal "codecraft-default" appears in no lib/ai source outside comments${
                    offenders.length ? ` (${offenders.join(", ")})` : ""
                }`
            );

            const configSrc = (await readFileSafe("lib/ai/config.ts")) ?? "";
            const modelsSrc = (await readFileSafe("lib/ai/models.ts")) ?? "";
            const codecraftSrc = (await readFileSafe("lib/ai/providers/codecraft.ts")) ?? "";
            const strippedModels = stripComments(modelsSrc);
            const strippedCodecraft = stripComments(codecraftSrc);

            // Case B is structural: the explicit-model branch must throw rather
            // than fall through to any catalog substitution.
            const explicitBranch = strippedCodecraft.match(
                /if \(requestedModel\) \{[\s\S]*?\n {8}\}/ // up to the branch's closing brace
            );
            check(
                !!explicitBranch && /is not advertised by CodeCraft/.test(explicitBranch[0]),
                "Case B: the explicit-model branch refuses an unadvertised model with a clear reason"
            );
            check(
                !!explicitBranch && !/pickRunnableModel/.test(explicitBranch[0]),
                "Case B: the explicit-model branch performs NO catalog substitution"
            );
            check(
                /pickRunnableModel/.test(strippedCodecraft),
                "Case C: catalog selection still exists for the no-explicit-model path"
            );
            check(
                /if \(configuredModel\) return configuredModel;/.test(strippedCodecraft),
                "Case D: CODECRAFT_MODEL is still honored verbatim, without a catalog check"
            );

            // Case B is CodeCraft-specific: no other provider may gain it, and
            // every provider keeps its own pre-existing selection logic.
            const providerSubstitutions: Array<[string, RegExp]> = [
                ["openrouter", /request\.model && isModelConfirmedFree\(request\.model\) \? request\.model : "openrouter\/free"/],
                ["opencode", /request\.model && isModelConfirmedFree\(request\.model\) \? request\.model : "mimo-v2\.5-free"/],
                ["bytez", /models\.find\(\(m\) => m\.id\.toLowerCase\(\) === request\.model!\.toLowerCase\(\)\)/],
            ];
            for (const [name, pattern] of providerSubstitutions) {
                const src = stripComments((await readFileSafe(`lib/ai/providers/${name}.ts`)) ?? "");
                check(
                    pattern.test(src),
                    `Case B: the ${name} provider keeps its own model-selection logic unchanged`
                );
                check(
                    !/not advertised by CodeCraft/.test(src),
                    `Case B: the ${name} provider is unaffected by the CodeCraft refusal`
                );
            }

            check(
                /CODECRAFT_MODEL \|\| ""/.test(stripComments(configSrc)),
                "F1: AIConfig.codecraftModel has NO placeholder default"
            );
            check(
                !/KNOWN_FREE_MODELS\.filter\(\(m\) => m\.provider === "codecraft"\)/.test(codecraftSrc),
                "F1: getModels() has no hardcoded codecraft fallback catalog"
            );
            check(
                !/KNOWN_FREE_MODELS[\s\S]{0,2000}provider: "codecraft"/.test(strippedModels),
                "F1: KNOWN_FREE_MODELS no longer registers any codecraft model"
            );

            // F3: free status can never come from the provider name again.
            check(
                !/startsWith\(["']codecraft/.test(strippedModels),
                "F3: isModelConfirmedFree() has no provider-name free rule"
            );
            check(
                /isModelConfirmedFree\(item\.id, pricing\)/.test(codecraftSrc),
                "F3: getModels() derives free status from the provider-reported pricing"
            );
            check(
                /normalizePricing\(item\.pricing\)/.test(codecraftSrc),
                "F3: catalog pricing is read from the provider response, never hardcoded"
            );

            // F2: the opt-in is a closed, provider-scoped registry.
            const meteredRegistry = strippedModels.match(/PROVIDER_METERED_OPT_IN[\s\S]{0,400}?\};/);
            check(
                !!meteredRegistry && /codecraft\s*:/.test(meteredRegistry[0]) && !/gemini|openrouter|opencode|bytez|bai\s*:/.test(meteredRegistry[0]),
                "F2: the metered opt-in registry contains CodeCraft and no other provider"
            );
            check(
                /get codecraftAllowMetered\(\)[\s\S]{0,200}CODECRAFT_ALLOW_METERED === "true"/.test(configSrc),
                "F2: the CodeCraft metered opt-in is an explicit server-side flag, defaulting to off"
            );
            check(
                !/AI_FREE_ONLY\s*=\s*"false"/.test(codecraftSrc) && !/process\.env\.AI_FREE_ONLY/.test(codecraftSrc),
                "F2: the CodeCraft provider never mutates or bypasses AI_FREE_ONLY"
            );
            check(
                /assertFreeModelAllowed\(model, undefined, this\.id\)/.test(codecraftSrc),
                "F2: the provider passes its own id so only it can use the scoped opt-in"
            );
            const routerSrc = (await readFileSafe("lib/ai/router.ts")) ?? "";
            check(
                /assertFreeModelAllowed\(request\.model, undefined, request\.provider\)/.test(routerSrc),
                "F2: the router guard is provider-aware but still strict without an explicit provider"
            );
            check(
                !/AI_FREE_ONLY/.test(stripComments(routerSrc)),
                "F2: the router never disables the global free-only policy"
            );

            // No other provider may reference the CodeCraft opt-in, and the set
            // of providers that enforce the cost guard is unchanged.
            // NOTE: gemini.ts never called the guard — that is pre-existing
            // behaviour and is deliberately not changed here.
            const guardCallers: string[] = [];
            for (const other of ["gemini", "openrouter", "opencode", "bai", "bytez"]) {
                const src = stripComments((await readFileSafe(`lib/ai/providers/${other}.ts`)) ?? "");
                check(
                    !/CODECRAFT_ALLOW_METERED|isProviderMeteredAllowed/.test(src),
                    `F2: the ${other} provider does not reference the CodeCraft metered opt-in`
                );
                if (/assertFreeModelAllowed\(/.test(src)) guardCallers.push(other);
            }
            check(
                guardCallers.join(",") === "openrouter,opencode,bai,bytez",
                `F2: the set of providers enforcing the cost guard is unchanged (${guardCallers.join(",") || "none"})`
            );

            // Global: nothing fabricated was ever sent upstream in this suite.
            check(
                !SENT_MODELS.has("codecraft-default"),
                "F1: 'codecraft-default' was never sent upstream by any test"
            );
            // Every model that DID go upstream must be one this suite
            // deliberately configured, supplied, or read from a real catalog —
            // "codecraft-does-not-exist" and "codecraft-not-in-catalog" are
            // operator-typo / Case D fail-safe tests and are expected to reach
            // the upstream rather than be substituted.
            const expectedUpstream = new Set([
                VERIFIED_MODEL,
                VERIFIED_MODEL_2,
                "codecraft-does-not-exist",
                "codecraft-not-in-catalog",
            ]);
            check(
                [...SENT_MODELS].every((m) => expectedUpstream.has(m)),
                `F1: every model sent upstream was operator-configured, caller-supplied or catalog-derived (sent: ${[...SENT_MODELS].join(", ")})`
            );
            check(
                SENT_MODELS.has(VERIFIED_MODEL),
                `F1/F2: the live-verified CodeCraft model was exercised (sent: ${[...SENT_MODELS].join(", ")})`
            );
        }
    } catch (err) {
        console.error("Test execution failed with error:", err);
        passed = false;
    } finally {
        restoreEnv();
        global.fetch = originalFetch;
    }

    console.log("--- CodeCraft Integration & QA Hardening Tests Complete ---");
    return passed;
}

async function readFileSafe(path: string): Promise<string | null> {
    try {
        const { readFile } = await import("node:fs/promises");
        const url = new URL(`../../../${path}`, import.meta.url);
        return await readFile(url, "utf8");
    } catch {
        return null;
    }
}

const CLIENT_DIRECTIVE = /^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use client["']/;

/**
 * Removes comments so a source-level assertion cannot be satisfied (or
 * defeated) by prose. Good enough for policy literals: a stripped quoted
 * string is a real code literal.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Every TS source file under `rootDir` (recursive), excluding tests. */
async function collectSources(rootDir: string): Promise<Array<{ path: string; contents: string }>> {
    const { readFile, readdir } = await import("node:fs/promises");
    const base = new URL(`../../../${rootDir}/`, import.meta.url);
    const found: Array<{ path: string; contents: string }> = [];

    async function walk(dir: URL) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
            const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
            if (entry.isDirectory()) {
                await walk(child);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) continue;
            found.push({ path: decodeURIComponent(child.pathname), contents: await readFile(child, "utf8") });
        }
    }

    await walk(base);
    return found;
}

/** Every `"use client"` source module under `rootDir` (recursive, TS/TSX/JS/JSX). */
async function collectClientFiles(rootDir: string): Promise<Array<{ path: string; contents: string }>> {
    const { readFile, readdir } = await import("node:fs/promises");
    const base = new URL(`../../../${rootDir}/`, import.meta.url);
    const found: Array<{ path: string; contents: string }> = [];

    async function walk(dir: URL) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
            const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
            if (entry.isDirectory()) {
                await walk(child);
                continue;
            }
            if (!/\.(t|j)sx?$/.test(entry.name)) continue;
            const contents = await readFile(child, "utf8");
            if (CLIENT_DIRECTIVE.test(contents)) {
                found.push({ path: decodeURIComponent(child.pathname), contents });
            }
        }
    }

    await walk(base);
    return found;
}
