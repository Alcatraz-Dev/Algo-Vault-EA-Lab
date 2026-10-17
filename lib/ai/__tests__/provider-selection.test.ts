import { defaultRouter } from "../router";
import { emptyAIBudgetUsageSnapshot } from "../budget";
import {
    __resetAIRuntimeGuards,
    __setAIBudgetReadersForTests,
    __setAIUsageSinkForTests,
} from "../runtime-guards";

type Handler = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function installFetch(handler: Handler): { calls: Array<{ url: string; init?: RequestInit }>; restore: () => void } {
    const original = global.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        return handler(url, init);
    }) as typeof fetch;
    return { calls, restore: () => { global.fetch = original; } };
}

const ENV_KEYS = [
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENCODE_API_KEY",
    "CODECRAFT_API_KEY",
    "BAI_API_KEY",
    "BYTEZ_API_KEY",
    "ALGOVAULT_LOCAL_AI",
    "OLLAMA_ENABLED",
    "OLLAMA_BASE_URL",
    "OLLAMA_TIMEOUT_MS",
    "AI_FREE_ONLY",
    "AI_MAX_PROVIDER_ATTEMPTS",
] as const;

function ollamaHandler(chatFails = false): Handler {
    return async (url) => {
        if (url.endsWith("/api/tags")) return jsonResponse({ models: [{ name: "qwen3:8b" }] });
        if (url.endsWith("/api/show")) {
            return jsonResponse({
                capabilities: ["completion", "tools"],
                model_info: { "qwen3.context_length": 40960 },
            });
        }
        if (url.endsWith("/api/chat")) {
            if (chatFails) return jsonResponse({ error: "boom" }, 500);
            return jsonResponse({
                model: "qwen3:8b",
                message: { role: "assistant", content: "local answer" },
                done: true,
                done_reason: "stop",
                prompt_eval_count: 10,
                eval_count: 2,
            });
        }
        return jsonResponse({});
    };
}

function clearCloudKeys(): void {
    for (const key of [
        "GEMINI_API_KEY",
        "OPENROUTER_API_KEY",
        "OPENCODE_API_KEY",
        "CODECRAFT_API_KEY",
        "BAI_API_KEY",
        "BYTEZ_API_KEY",
    ]) {
        delete process.env[key];
    }
}

export async function runProviderSelectionTests(): Promise<boolean> {
    console.log("--- Provider Selection & Fallback Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) console.log(`  PASS: ${label}`);
        else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    const saved: Record<string, string | undefined> = {};
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    const restore = () => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    };

    // Keep router accounting entirely in-memory: these tests must never touch
    // Firebase or a real provider quota.
    __setAIUsageSinkForTests(async () => {});
    __setAIBudgetReadersForTests(async () => emptyAIBudgetUsageSnapshot(true), async () => null);

    try {
        process.env.AI_FREE_ONLY = "true";
        process.env.AI_MAX_PROVIDER_ATTEMPTS = "4";
        process.env.ALGOVAULT_LOCAL_AI = "1";
        process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
        delete process.env.OLLAMA_ENABLED;
        clearCloudKeys();

        // 1. Registration and auto-selection flags.
        {
            const ollama = defaultRouter.getProvider("ollama");
            check(Boolean(ollama), "Ollama is registered in the existing AI router");
            check(ollama?.isLocal === true, "Ollama is marked as local");
            check(ollama?.autoSelectable === false, "Ollama is excluded from automatic routing");
        }

        // 2. Strict mode requires an explicit provider.
        {
            let code = "";
            try {
                await defaultRouter.chat({
                    mode: "strict",
                    messages: [{ role: "user", content: "hi" }],
                });
            } catch (err) {
                code = String((err as { code?: string })?.code ?? "");
            }
            check(code === "INVALID_REQUEST", "strict mode without a provider is rejected");
        }

        // 3. Strict Ollama success.
        {
            const mock = installFetch(ollamaHandler());
            try {
                const res = await defaultRouter.chat({
                    provider: "ollama",
                    mode: "strict",
                    model: "qwen3:8b",
                    messages: [{ role: "user", content: "hi" }],
                });
                check(res.provider === "ollama", "strict mode serves from the selected provider");
                check(res.content === "local answer", "strict Ollama returns the local answer");
                check(res.requestedProvider === "ollama", "the requested provider is reported");
                check(res.requestedModel === "qwen3:8b", "the requested model is reported");
                check(
                    !mock.calls.some((c) => c.url.includes("openrouter") || c.url.includes("opencode")),
                    "strict local inference makes no cloud request",
                );
            } finally {
                mock.restore();
            }
        }

        // 4. Explicit Ollama failure may fall back to the local heuristic, never cloud.
        {
            const mock = installFetch(ollamaHandler(true));
            try {
                const res = await defaultRouter.chat({
                    provider: "ollama",
                    mode: "auto",
                    model: "qwen3:8b",
                    messages: [{ role: "user", content: "hi" }],
                });
                check(res.provider === "local-heuristic", "Ollama failure falls back locally, not to cloud");
                check(
                    !mock.calls.some((c) => c.url.includes("openrouter") || c.url.includes("opencode")),
                    "an explicit local request makes no cloud fallback call",
                );
            } finally {
                mock.restore();
            }
        }

        // 5. Automatic mode never selects Ollama.
        {
            const mock = installFetch(ollamaHandler());
            try {
                const res = await defaultRouter.chat({
                    messages: [{ role: "user", content: "hi" }],
                });
                check(res.provider === "local-heuristic", "automatic mode uses the deterministic fallback, not Ollama");
                check(
                    !mock.calls.some((c) => c.url.endsWith("/api/chat")),
                    "automatic mode never sends a background request to local Ollama",
                );
            } finally {
                mock.restore();
            }
        }

        // 6. Strict selection of an unavailable local provider is explicit.
        {
            delete process.env.ALGOVAULT_LOCAL_AI;
            let code = "";
            try {
                await defaultRouter.chat({
                    provider: "ollama",
                    mode: "strict",
                    model: "qwen3:8b",
                    messages: [{ role: "user", content: "hi" }],
                });
            } catch (err) {
                code = String((err as { code?: string })?.code ?? "");
            }
            check(code === "PROVIDER_UNAVAILABLE", "strict mode reports an unavailable provider");
        }

        // 6b. Automatic mode with an explicitly unavailable provider still
        //     degrades (existing behaviour), but never silently: the caller
        //     sees which provider was skipped in `fallbackErrors`.
        {
            const mock = installFetch(ollamaHandler());
            try {
                const res = await defaultRouter.chat({
                    provider: "ollama",
                    mode: "auto",
                    model: "qwen3:8b",
                    messages: [{ role: "user", content: "hi" }],
                });
                check(
                    res.provider === "local-heuristic",
                    "an unavailable explicit local provider degrades to the local heuristic",
                );
                check(
                    (res.fallbackErrors ?? []).some(
                        (e) => e.provider === "ollama" && e.code === "PROVIDER_UNAVAILABLE",
                    ),
                    "the skipped provider is reported in fallbackErrors",
                );
                check(
                    !mock.calls.some((c) => c.url.endsWith("/api/chat")),
                    "no request reaches an unavailable local provider",
                );
            } finally {
                mock.restore();
            }
        }

        // 7. Strict OpenRouter failure does not fall through to another cloud provider.
        {
            process.env.OPENROUTER_API_KEY = "test_openrouter_fake";
            process.env.OPENCODE_API_KEY = "test_opencode_fake";
            const mock = installFetch(async (url) => {
                if (url.includes("openrouter") && url.endsWith("/models")) {
                    return jsonResponse({
                        data: [
                            {
                                id: "openrouter/free",
                                name: "Free Router",
                                pricing: { prompt: "0", completion: "0" },
                            },
                        ],
                    });
                }
                if (url.includes("openrouter") && url.includes("/chat/completions")) {
                    return jsonResponse({ error: "upstream" }, 500);
                }
                return jsonResponse({ choices: [{ message: { content: "fallback" } }] });
            });
            try {
                let code = "";
                try {
                    await defaultRouter.chat({
                        provider: "openrouter",
                        mode: "strict",
                        model: "openrouter/free",
                        messages: [{ role: "user", content: "hi" }],
                    });
                } catch (err) {
                    code = String((err as { code?: string })?.code ?? "");
                }
                check(code === "PROVIDER_UNAVAILABLE", "strict OpenRouter failure returns the provider error");
                check(
                    !mock.calls.some((c) => c.url.includes("opencode")),
                    "strict mode never falls through to another cloud provider",
                );
            } finally {
                mock.restore();
            }
        }

        // 8. Paid models are refused before any provider call. OpenRouter owns
        //    the decision (it resolves ids against its live free catalog), so
        //    the refusal arrives as "not in the free catalog" — never as a
        //    dispatch to a metered model.
        {
            process.env.OPENROUTER_API_KEY = "test_openrouter_fake";
            const mock = installFetch(async (url) => {
                if (url.includes("openrouter") && url.endsWith("/models")) {
                    return jsonResponse({
                        data: [
                            {
                                id: "openrouter/free",
                                name: "Free Router",
                                pricing: { prompt: "0", completion: "0" },
                            },
                        ],
                    });
                }
                return jsonResponse({ choices: [{ message: { content: "paid" } }] });
            });
            try {
                let code = "";
                try {
                    await defaultRouter.chat({
                        provider: "openrouter",
                        mode: "strict",
                        model: "vendor/paid-model",
                        messages: [{ role: "user", content: "hi" }],
                    });
                } catch (err) {
                    code = String((err as { code?: string })?.code ?? "");
                }
                check(
                    code === "MODEL_UNAVAILABLE",
                    "a paid model is refused because the live catalog is free-only",
                );
                check(
                    !mock.calls.some((c) => c.url.includes("/chat/completions")),
                    "a paid model is refused before any inference request",
                );
            } finally {
                mock.restore();
            }
        }

        // 9. No catalog means no inference: the default model path fails closed.
        {
            process.env.OPENROUTER_API_KEY = "test_openrouter_fake";
            delete process.env.OPENCODE_API_KEY;
            const mock = installFetch(async (url) => {
                if (url.includes("openrouter") && url.endsWith("/models")) {
                    return jsonResponse({ data: [] });
                }
                return jsonResponse({ choices: [{ message: { content: "must not be used" } }] });
            });
            try {
                // Force a fresh read so the empty catalog replaces the entry
                // cached by the previous scenario.
                await defaultRouter.getProvider("openrouter")!.getModels(true);
                let code = "";
                try {
                    await defaultRouter.chat({
                        provider: "openrouter",
                        mode: "strict",
                        messages: [{ role: "user", content: "hi" }],
                    });
                } catch (err) {
                    code = String((err as { code?: string })?.code ?? "");
                }
                check(code === "NO_FREE_PROVIDER", "an empty free catalog refuses the default model");
                check(
                    !mock.calls.some((c) => c.url.includes("/chat/completions")),
                    "the default path sends no inference request without a confirmed-free model",
                );
            } finally {
                mock.restore();
            }
        }
    } finally {
        restore();
        __resetAIRuntimeGuards();
    }

    return passed;
}
