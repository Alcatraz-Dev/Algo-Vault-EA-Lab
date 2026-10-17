import { OpenRouterProvider, isCatalogWithinMaxStale } from "../providers/openrouter";
import { assertFreeModelAllowed, assertVerifiedFreeModel, isModelConfirmedFree } from "../models";

type Handler = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
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

const CATALOG = {
    data: [
        {
            id: "openrouter/free",
            name: "Free Router",
            pricing: { prompt: "0", completion: "0" },
            context_length: 200000,
            supported_parameters: ["response_format"],
            architecture: { input_modalities: ["text"] },
        },
        {
            id: "free/zero:free",
            name: "Zero Priced",
            pricing: { prompt: "0", completion: "0", request: "0" },
            context_length: 131072,
            supported_parameters: ["tools", "response_format", "reasoning"],
            architecture: { input_modalities: ["text", "image"] },
        },
        {
            id: "free/zero-no-marker",
            name: "Zero Without Marker",
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["temperature"],
            architecture: { input_modalities: ["text"] },
        },
        {
            id: "paid/model",
            name: "Paid",
            pricing: { prompt: "0.000001", completion: "0.000002" },
        },
        {
            id: "paid/request-fee",
            name: "Request Fee",
            pricing: { prompt: "0", completion: "0", request: "0.001" },
        },
        {
            id: "free/expired",
            name: "Expired",
            pricing: { prompt: "0", completion: "0" },
            expiration_date: "2020-01-01T00:00:00.000Z",
        },
        {
            id: "unknown/pricing",
            name: "Unknown Pricing",
        },
        {
            id: "paid/free-suffix:free",
            name: "Paid Despite Free Suffix",
            pricing: { prompt: "0.000003", completion: "0.000004" },
        },
        {
            id: "paid/malformed-free",
            name: "Malformed Pricing Free Suffix",
            pricing: { prompt: "n/a", completion: "n/a" },
        },
    ],
};

export async function runOpenRouterCatalogTests(): Promise<boolean> {
    console.log("--- OpenRouter Dynamic Catalog Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) console.log(`  PASS: ${label}`);
        else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    const saved = {
        key: process.env.OPENROUTER_API_KEY,
        base: process.env.OPENROUTER_BASE_URL,
        freeOnly: process.env.AI_FREE_ONLY,
    };
    const restore = () => {
        if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = saved.key;
        if (saved.base === undefined) delete process.env.OPENROUTER_BASE_URL;
        else process.env.OPENROUTER_BASE_URL = saved.base;
        if (saved.freeOnly === undefined) delete process.env.AI_FREE_ONLY;
        else process.env.AI_FREE_ONLY = saved.freeOnly;
    };

    try {
        process.env.OPENROUTER_API_KEY = "test_openrouter_fake_key";
        process.env.AI_FREE_ONLY = "true";
        delete process.env.OPENROUTER_BASE_URL;

        // 1. Catalog parsing and pricing-based free classification.
        {
            const mock = installFetch(async (url) => {
                if (url.endsWith("/models")) return jsonResponse(CATALOG);
                return jsonResponse({});
            });
            try {
                const provider = new OpenRouterProvider();
                const models = await provider.getModels();
                const ids = models.map((m) => m.id);
                check(models.length === 3, "only zero-priced, unexpired models are returned");
                check(ids.includes("openrouter/free"), "the free router is discovered from the catalog");
                check(!ids.includes("paid/free-suffix:free"), "a :free suffix never overrides non-zero pricing");
                check(!ids.includes("paid/malformed-free"), "a -free suffix never overrides malformed pricing");
                check(ids.includes("free/zero:free"), "a zero-priced :free model is included");
                check(ids.includes("free/zero-no-marker"), "zero pricing is sufficient without a :free suffix");
                check(!ids.includes("paid/model"), "a token-priced model is excluded");
                check(!ids.includes("paid/request-fee"), "a per-request fee makes a model non-free");
                check(!ids.includes("free/expired"), "an expired model is excluded");
                check(!ids.includes("unknown/pricing"), "unknown pricing is not treated as free");

                const zero = models.find((m) => m.id === "free/zero:free");
                check(zero?.contextLength === 131072, "context length is read from the catalog");
                check(zero?.capabilities?.tools === true, "tools capability comes from supported_parameters");
                check(zero?.capabilities?.structuredOutput === true, "structured output comes from response_format");
                check(zero?.capabilities?.reasoning === true, "reasoning capability comes from supported_parameters");
                check(zero?.capabilities?.vision === true, "vision comes from input_modalities");
                check(
                    zero?.pricing?.request === "0",
                    "provider pricing is preserved on the model",
                );

                await provider.getModels();
                const catalogCalls = mock.calls.filter((c) => c.url.endsWith("/models")).length;
                check(catalogCalls === 1, "the catalog is cached instead of fetched per call");
            } finally {
                mock.restore();
            }
        }

        // 2. Public metadata without an API key.
        {
            delete process.env.OPENROUTER_API_KEY;
            const mock = installFetch(async (url) => {
                if (url.endsWith("/models")) return jsonResponse(CATALOG);
                return jsonResponse({});
            });
            try {
                const provider = new OpenRouterProvider();
                check(provider.isAvailable() === false, "the provider is unavailable without a key");
                const models = await provider.getModels();
                check(models.length === 3, "public catalog metadata is still discoverable without a key");
                const auth = new Headers(mock.calls[0]?.init?.headers);
                check(!auth.has("authorization"), "catalog discovery does not require or send a key");
            } finally {
                mock.restore();
            }
        }

        // 3. Catalog failures degrade to empty or the last good cache, never a stale hardcoded list.
        {
            process.env.OPENROUTER_API_KEY = "test_openrouter_fake_key";
            const failing = installFetch(async () => {
                throw new Error("catalog offline");
            });
            try {
                const provider = new OpenRouterProvider();
                const models = await provider.getModels();
                check(models.length === 0, "a catalog failure with no cache returns no models");
            } finally {
                failing.restore();
            }

            const warm = installFetch(async (url) => {
                if (url.endsWith("/models")) return jsonResponse(CATALOG);
                return jsonResponse({});
            });
            let provider: OpenRouterProvider;
            try {
                provider = new OpenRouterProvider();
                await provider.getModels();
            } finally {
                warm.restore();
            }

            const failingAgain = installFetch(async () => {
                throw new Error("catalog offline");
            });
            try {
                const models = await provider!.getModels(true);
                check(models.length === 3, "a failed refresh keeps the last real catalog instead of hardcoding ids");
            } finally {
                failingAgain.restore();
            }
        }

        // 4. Strict stale model: no completion request, no substitution.
        {
            process.env.OPENROUTER_API_KEY = "test_openrouter_fake_key";
            const mock = installFetch(async (url) => {
                if (url.endsWith("/models")) return jsonResponse(CATALOG);
                return jsonResponse({ choices: [{ message: { content: "should not be called" } }] });
            });
            try {
                const provider = new OpenRouterProvider();
                let code = "";
                try {
                    await provider.chat({
                        model: "removed/model",
                        mode: "strict",
                        messages: [{ role: "user", content: "hi" }],
                    });
                } catch (err) {
                    code = String((err as { code?: string })?.code ?? "");
                }
                check(code === "MODEL_UNAVAILABLE", "strict mode reports a removed model as unavailable");
                check(
                    !mock.calls.some((c) => c.url.includes("/chat/completions")),
                    "strict mode sends no completion request for a stale model",
                );
            } finally {
                mock.restore();
            }
        }

        // 5. Automatic stale model substitution stays free and is disclosed.
        {
            process.env.OPENROUTER_API_KEY = "test_openrouter_fake_key";
            const mock = installFetch(async (url) => {
                if (url.endsWith("/models")) return jsonResponse(CATALOG);
                if (url.includes("/chat/completions")) {
                    return jsonResponse({ choices: [{ message: { content: "free answer" }, finish_reason: "stop" }] });
                }
                return jsonResponse({});
            });
            try {
                const provider = new OpenRouterProvider();
                const res = await provider.chat({
                    model: "removed/model",
                    mode: "auto",
                    messages: [{ role: "user", content: "hi" }],
                });
                const chatCall = mock.calls.find((c) => c.url.includes("/chat/completions"));
                const body = JSON.parse(String(chatCall?.init?.body || "{}")) as { model?: string };
                check(body.model === "openrouter/free", "automatic substitution uses only the free router");
                check(res.substituted === true, "automatic substitution is disclosed to the caller");
                check(res.requestedModel === "removed/model", "the originally requested model is reported");
            } finally {
                mock.restore();
            }
        }

        // 6. Quota errors keep the retry hint.
        {
            process.env.OPENROUTER_API_KEY = "test_openrouter_fake_key";
            const mock = installFetch(async (url) => {
                if (url.includes("/chat/completions")) {
                    return jsonResponse({ error: { message: "rate limited" } }, 429, { "Retry-After": "5" });
                }
                return jsonResponse(CATALOG);
            });
            try {
                const provider = new OpenRouterProvider();
                let err: { code?: string; retryAfterMs?: number } | null = null;
                try {
                    await provider.chat({
                        model: "openrouter/free",
                        messages: [{ role: "user", content: "hi" }],
                    });
                } catch (caught) {
                    err = caught as { code?: string; retryAfterMs?: number };
                }
                check(err?.code === "RATE_LIMITED", "429 is reported as RATE_LIMITED");
                check(err?.retryAfterMs === 5000, "Retry-After is converted to milliseconds");
            } finally {
                mock.restore();
            }
        }

        // 7. The default path is resolved from the live catalog before any
        //    inference request, not sent as an unverified literal id.
        {
            process.env.OPENROUTER_API_KEY = "test_openrouter_fake_key";
            const mock = installFetch(async (url) => {
                if (url.endsWith("/models")) return jsonResponse(CATALOG);
                if (url.includes("/chat/completions")) {
                    return jsonResponse({ choices: [{ message: { content: "ok" } }] });
                }
                return jsonResponse({});
            });
            try {
                const provider = new OpenRouterProvider();
                const res = await provider.chat({
                    messages: [{ role: "user", content: "hi" }],
                });
                const chatCall = mock.calls.find((c) => c.url.includes("/chat/completions"));
                const body = JSON.parse(String(chatCall?.init?.body || "{}")) as { model?: string };
                const catalogIndex = mock.calls.findIndex((c) => c.url.endsWith("/models"));
                const chatIndex = mock.calls.findIndex((c) => c.url.includes("/chat/completions"));
                check(body.model === "openrouter/free", "the default resolves to the catalog's free router");
                check(
                    catalogIndex !== -1 && chatIndex !== -1 && catalogIndex < chatIndex,
                    "the catalog is consulted before the inference request",
                );
                check(res.substituted !== true, "an absent model is not reported as a substitution");
                check(res.requestedModel === undefined, "no requested model is invented for the default path");
            } finally {
                mock.restore();
            }
        }

        // 8. Catalog unavailable: no inference at all (fail closed).
        {
            process.env.OPENROUTER_API_KEY = "test_openrouter_fake_key";
            const mock = installFetch(async (url) => {
                if (url.endsWith("/models")) throw new Error("catalog offline");
                if (url.includes("/chat/completions")) {
                    return jsonResponse({ choices: [{ message: { content: "must not be used" } }] });
                }
                return jsonResponse({});
            });
            try {
                const provider = new OpenRouterProvider();
                let code = "";
                try {
                    await provider.chat({ messages: [{ role: "user", content: "hi" }] });
                } catch (err) {
                    code = String((err as { code?: string })?.code ?? "");
                }
                check(code === "NO_FREE_PROVIDER", "an unavailable catalog rejects the request");
                check(
                    !mock.calls.some((c) => c.url.includes("/chat/completions")),
                    "no inference request is sent without a confirmed-free model",
                );
            } finally {
                mock.restore();
            }
        }

        // 9. A model that changes pricing is no longer selectable.
        {
            process.env.OPENROUTER_API_KEY = "test_openrouter_fake_key";
            const nowPaid = {
                data: [
                    {
                        id: "openrouter/free",
                        name: "Now Paid",
                        pricing: { prompt: "0.00001", completion: "0.00002" },
                    },
                ],
            };
            const mock = installFetch(async (url) => {
                if (url.endsWith("/models")) return jsonResponse(nowPaid);
                if (url.includes("/chat/completions")) {
                    return jsonResponse({ choices: [{ message: { content: "must not be used" } }] });
                }
                return jsonResponse({});
            });
            try {
                const provider = new OpenRouterProvider();
                const models = await provider.getModels(true);
                check(models.length === 0, "the repriced default is removed from the free catalog");
                let code = "";
                try {
                    await provider.chat({ messages: [{ role: "user", content: "hi" }] });
                } catch (err) {
                    code = String((err as { code?: string })?.code ?? "");
                }
                check(code === "NO_FREE_PROVIDER", "a repriced model is refused after the catalog refresh");
                check(
                    !mock.calls.some((c) => c.url.includes("/chat/completions")),
                    "a repriced model is never sent to inference",
                );
            } finally {
                mock.restore();
            }
        }

        // 10. A `:free` id with paid pricing in the catalog is never chosen.
        {
            process.env.OPENROUTER_API_KEY = "test_openrouter_fake_key";
            const mock = installFetch(async (url) => {
                if (url.endsWith("/models")) return jsonResponse(CATALOG);
                if (url.includes("/chat/completions")) {
                    return jsonResponse({ choices: [{ message: { content: "free answer" } }] });
                }
                return jsonResponse({});
            });
            try {
                const provider = new OpenRouterProvider();
                let code = "";
                try {
                    await provider.chat({
                        model: "paid/free-suffix:free",
                        mode: "strict",
                        messages: [{ role: "user", content: "hi" }],
                    });
                } catch (err) {
                    code = String((err as { code?: string })?.code ?? "");
                }
                check(code === "MODEL_UNAVAILABLE", "strict mode refuses a paid id with a free suffix");

                const res = await provider.chat({
                    model: "paid/free-suffix:free",
                    mode: "auto",
                    messages: [{ role: "user", content: "hi" }],
                });
                const sent = mock.calls
                    .filter((c) => c.url.includes("/chat/completions"))
                    .map((c) => JSON.parse(String(c.init?.body || "{}")) as { model?: string });
                check(
                    sent.every((body) => body.model !== "paid/free-suffix:free"),
                    "automatic mode never sends a paid model",
                );
                check(res.model === "openrouter/free", "automatic mode substitutes the free router");
                check(res.substituted === true, "the substitution is disclosed");
            } finally {
                mock.restore();
            }
        }

        // 11. Bounded stale cache.
        {
            const now = Date.now();
            check(isCatalogWithinMaxStale(now - 1_000, now, 60_000) === true, "a recent catalog is usable");
            check(isCatalogWithinMaxStale(now - 120_000, now, 60_000) === false, "a catalog past max-stale is discarded");
        }

        // 12. Direct free-classification invariants.
        check(
            isModelConfirmedFree("x", { prompt: "0", completion: "0" }) === true,
            "zero token pricing is free",
        );
        check(
            isModelConfirmedFree("x", { prompt: "0", completion: "0", request: "0.01" }) === false,
            "a request fee is not free",
        );
        check(
            isModelConfirmedFree("x", { prompt: "0" }) === false,
            "missing completion pricing is not treated as free",
        );
        check(
            isModelConfirmedFree("x:free", { prompt: "0.0001", completion: "0" }) === false,
            ":free does not override non-zero pricing",
        );
        check(
            isModelConfirmedFree("x-free", { prompt: "n/a", completion: "0" }) === false,
            "-free does not override malformed pricing",
        );
        check(
            isModelConfirmedFree("x:free") === false,
            "a :free id with no pricing is not confirmed free",
        );
        check(
            isModelConfirmedFree("x-free") === false,
            "a -free id with no pricing is not confirmed free",
        );
        check(
            isModelConfirmedFree("big-pickle") === true,
            "an explicitly reviewed registry entry remains confirmed free",
        );

        // Provider-verified entries may assert free status without pricing, but
        // pricing always wins when it is present.
        let verifiedThrew = false;
        try {
            assertVerifiedFreeModel({ id: "probe-verified", confirmedFree: true });
        } catch {
            verifiedThrew = true;
        }
        check(!verifiedThrew, "a provider-verified free entry is accepted");

        let unverifiedThrew = false;
        try {
            assertVerifiedFreeModel({ id: "probe-unverified", confirmedFree: false });
        } catch {
            unverifiedThrew = true;
        }
        check(unverifiedThrew, "an unverified entry is refused");

        let assertedPaidThrew = false;
        try {
            assertVerifiedFreeModel({
                id: "paid/asserted:free",
                confirmedFree: true,
                pricing: { prompt: "0.0001", completion: "0" },
            });
        } catch {
            assertedPaidThrew = true;
        }
        check(assertedPaidThrew, "pricing overrides a provider's free assertion");

        let suffixGuardThrew = false;
        try {
            assertFreeModelAllowed("paid/model:free");
        } catch {
            suffixGuardThrew = true;
        }
        check(suffixGuardThrew, "the canonical guard refuses a bare :free id");
    } finally {
        restore();
    }

    return passed;
}
