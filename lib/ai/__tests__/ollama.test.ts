import { OllamaProvider, resolveOllamaEndpoint } from "../providers/ollama";
import { isLoopbackRequest } from "../local-endpoint";

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

function standardHandler(chatResponse?: Response): Handler {
    return async (url, init) => {
        if (url.endsWith("/api/tags")) {
            return jsonResponse({
                models: [{ name: "qwen3:8b" }, { name: "gemma4:latest" }],
            });
        }
        if (url.endsWith("/api/show")) {
            const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
            if (body.model === "gemma4:latest") {
                return jsonResponse({
                    capabilities: ["completion", "vision", "audio", "tools", "thinking"],
                    model_info: { "gemma4.context_length": 131072 },
                });
            }
            return jsonResponse({
                capabilities: ["completion", "tools", "thinking"],
                model_info: { "qwen3.context_length": 40960 },
            });
        }
        if (url.endsWith("/api/chat")) {
            if (chatResponse) return chatResponse;
            return jsonResponse({
                model: "qwen3:8b",
                message: { role: "assistant", content: "ok" },
                done: true,
                done_reason: "stop",
                prompt_eval_count: 12,
                eval_count: 2,
            });
        }
        return jsonResponse({});
    };
}

export async function runOllamaTests(): Promise<boolean> {
    console.log("--- Ollama Local Provider Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) console.log(`  PASS: ${label}`);
        else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    const saved = {
        enabled: process.env.ALGOVAULT_LOCAL_AI,
        legacyEnabled: process.env.OLLAMA_ENABLED,
        base: process.env.OLLAMA_BASE_URL,
        model: process.env.OLLAMA_MODEL,
        timeout: process.env.OLLAMA_TIMEOUT_MS,
    };
    const restore = () => {
        for (const [key, value] of [
            ["ALGOVAULT_LOCAL_AI", saved.enabled],
            ["OLLAMA_ENABLED", saved.legacyEnabled],
            ["OLLAMA_BASE_URL", saved.base],
            ["OLLAMA_MODEL", saved.model],
            ["OLLAMA_TIMEOUT_MS", saved.timeout],
        ] as const) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    };

    try {
        process.env.ALGOVAULT_LOCAL_AI = "1";
        delete process.env.OLLAMA_ENABLED;
        process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
        process.env.OLLAMA_TIMEOUT_MS = "5000";
        delete process.env.OLLAMA_MODEL;

        // 1. Endpoint validation.
        check(resolveOllamaEndpoint("http://127.0.0.1:11434") === "http://127.0.0.1:11434", "loopback IPv4 is accepted");
        check(resolveOllamaEndpoint("http://localhost:11434") === "http://localhost:11434", "localhost is accepted");
        check(resolveOllamaEndpoint("http://192.168.1.20:11434") === null, "a LAN address is rejected");
        check(resolveOllamaEndpoint("https://ollama.example.com") === null, "a public host is rejected");
        check(resolveOllamaEndpoint("http://127.0.0.1:11434/api") === null, "a path is rejected");
        check(resolveOllamaEndpoint("http://user:pass@127.0.0.1:11434") === null, "credentials in the URL are rejected");

        // 2. Availability and catalog/capability discovery.
        {
            const mock = installFetch(standardHandler());
            try {
                const provider = new OllamaProvider();
                check(await provider.isAvailable() === true, "a reachable Ollama service is available");
                const models = await provider.getModels();
                const qwen = models.find((m) => m.id === "qwen3:8b");
                const gemma = models.find((m) => m.id === "gemma4:latest");
                check(models.length === 2, "all installed models are listed");
                check(qwen?.contextLength === 40960, "context length is read from /api/show");
                check(qwen?.capabilities?.tools === true, "tool capability is read per model");
                check(qwen?.capabilities?.reasoning === true, "thinking capability is mapped to reasoning");
                check(qwen?.capabilities?.structuredOutput === false, "structured output is not overclaimed");
                check(gemma?.capabilities?.vision === true, "vision capability is read per model");
                check(
                    !mock.calls.some((c) => c.url.includes("/api/pull")),
                    "catalog discovery never downloads a model",
                );
            } finally {
                mock.restore();
            }
        }

        // 3. Successful chat and request shape.
        {
            const mock = installFetch(standardHandler());
            try {
                const provider = new OllamaProvider();
                const res = await provider.chat({
                    model: "qwen3:8b",
                    messages: [{ role: "user", content: "hello" }],
                    maxTokens: 32,
                    temperature: 0.2,
                    responseFormat: "json_object",
                });
                const chatCall = mock.calls.find((c) => c.url.endsWith("/api/chat"));
                const body = JSON.parse(String(chatCall?.init?.body || "{}")) as Record<string, unknown>;
                check(res.provider === "ollama", "the response identifies the local provider");
                check(res.content === "ok", "the assistant content is returned");
                check(body.stream === false, "chat uses the non-streaming native API");
                check(body.think === false, "chain-of-thought is not surfaced");
                check(body.format === "json", "JSON mode uses Ollama's format field");
                check((body.options as { num_predict?: number })?.num_predict === 32, "max tokens map to num_predict");
                check((res.raw as { usage?: { prompt_tokens?: number } })?.usage?.prompt_tokens === 12, "token usage is recorded");
            } finally {
                mock.restore();
            }
        }

        // 4. Missing model: fail before any chat request.
        {
            const mock = installFetch(standardHandler());
            try {
                const provider = new OllamaProvider();
                let code = "";
                try {
                    await provider.chat({
                        model: "missing:latest",
                        messages: [{ role: "user", content: "hello" }],
                    });
                } catch (err) {
                    code = String((err as { code?: string })?.code ?? "");
                }
                check(code === "MODEL_UNAVAILABLE", "an uninstalled model is reported as unavailable");
                check(
                    !mock.calls.some((c) => c.url.endsWith("/api/chat")),
                    "an uninstalled model never reaches the chat endpoint",
                );
            } finally {
                mock.restore();
            }
        }

        // 5. Connection failure.
        {
            const mock = installFetch(async () => {
                throw new Error("ECONNREFUSED");
            });
            try {
                const provider = new OllamaProvider();
                check(await provider.isAvailable() === false, "connection refusal reports unavailable");
                let code = "";
                try {
                    await provider.chat({
                        model: "qwen3:8b",
                        messages: [{ role: "user", content: "hello" }],
                    });
                } catch (err) {
                    code = String((err as { code?: string })?.code ?? "");
                }
                check(code === "PROVIDER_UNAVAILABLE", "connection refusal is mapped to PROVIDER_UNAVAILABLE");
            } finally {
                mock.restore();
            }
        }

        // 6. Memory pressure.
        {
            const mock = installFetch(standardHandler(
                new Response("model requires more system memory", { status: 500 }),
            ));
            try {
                const provider = new OllamaProvider();
                let code = "";
                try {
                    await provider.chat({
                        model: "qwen3:8b",
                        messages: [{ role: "user", content: "hello" }],
                    });
                } catch (err) {
                    code = String((err as { code?: string })?.code ?? "");
                }
                check(code === "RESOURCE_EXHAUSTED", "model load memory failure is reported distinctly");
            } finally {
                mock.restore();
            }
        }

        // 7. Cancellation/timeout.
        {
            const mock = installFetch(async (url, init) => {
                if (url.endsWith("/api/tags")) return jsonResponse({ models: [{ name: "qwen3:8b" }] });
                if (url.endsWith("/api/show")) return jsonResponse({ capabilities: ["completion"] });
                if (url.endsWith("/api/chat")) {
                    if (init?.signal?.aborted) {
                        const err = new Error("aborted");
                        err.name = "AbortError";
                        throw err;
                    }
                    return jsonResponse({ message: { content: "late" } });
                }
                return jsonResponse({});
            });
            try {
                const provider = new OllamaProvider();
                const controller = new AbortController();
                controller.abort();
                let code = "";
                try {
                    await provider.chat({
                        model: "qwen3:8b",
                        messages: [{ role: "user", content: "hello" }],
                        signal: controller.signal,
                    });
                } catch (err) {
                    code = String((err as { code?: string })?.code ?? "");
                }
                check(code === "TIMEOUT", "a cancelled local request is reported without retrying");
            } finally {
                mock.restore();
            }
        }

        // 8. Disabled local AI.
        {
            delete process.env.ALGOVAULT_LOCAL_AI;
            delete process.env.OLLAMA_ENABLED;
            const provider = new OllamaProvider();
            check(await provider.isAvailable() === false, "local AI is off by default");
            check((await provider.getModels()).length === 0, "no local models are exposed when disabled");
            let code = "";
            try {
                await provider.chat({
                    model: "qwen3:8b",
                    messages: [{ role: "user", content: "hello" }],
                });
            } catch (err) {
                code = String((err as { code?: string })?.code ?? "");
            }
            check(code === "PROVIDER_UNAVAILABLE", "a disabled local provider refuses to run");
        }

        // 8b. A forced catalog refresh also refreshes reachability, so the
        //     settings "Recheck" action does not report a stale probe.
        {
            process.env.ALGOVAULT_LOCAL_AI = "1";
            const provider = new OllamaProvider();
            const failing = installFetch(async () => {
                throw new Error("ECONNREFUSED");
            });
            try {
                await provider.getModels(true);
            } finally {
                failing.restore();
            }
            check(await provider.isAvailable() === false, "a failed catalog read marks the service unreachable");

            const working = installFetch(standardHandler());
            try {
                const models = await provider.getModels(true);
                check(models.length === 2, "a forced refresh recovers the catalog");
                check(await provider.isAvailable() === true, "a successful refresh also reports the service as reachable");
            } finally {
                working.restore();
            }
        }

        // 9. Request-origin gating: local inference is only reachable from
        //    this machine, even if the server has local AI enabled.
        {
            const headers = (init: Record<string, string>) => new Headers(init);
            check(isLoopbackRequest(headers({ host: "127.0.0.1:3000" })) === true, "a loopback IPv4 request is accepted");
            check(isLoopbackRequest(headers({ host: "localhost:3001" })) === true, "a localhost request is accepted");
            check(isLoopbackRequest(headers({ host: "[::1]:3000" })) === true, "a loopback IPv6 request is accepted");
            check(isLoopbackRequest(headers({ host: "algovault.example.com" })) === false, "a public host is rejected");
            check(isLoopbackRequest(headers({ host: "192.168.1.20:3000" })) === false, "a LAN host is rejected");
            check(isLoopbackRequest(headers({ host: "127.0.0.1:3000", "x-forwarded-for": "127.0.0.1" })) === true, "the loopback forwarding header Next.js writes is accepted");
            check(isLoopbackRequest(headers({ host: "127.0.0.1:3000", "x-forwarded-for": "203.0.113.7" })) === false, "a public forwarded address is rejected even with a loopback Host");
            check(isLoopbackRequest(headers({ host: "127.0.0.1:3000", "x-forwarded-for": "203.0.113.7, 127.0.0.1" })) === false, "a mixed forwarding chain is rejected");
            check(isLoopbackRequest(headers({ host: "127.0.0.1:3000", "x-real-ip": "203.0.113.7" })) === false, "a public x-real-ip is rejected");
            check(isLoopbackRequest(headers({ host: "127.0.0.1:3000", "forwarded": "for=203.0.113.7" })) === false, "an RFC 7239 Forwarded header is rejected");
            check(isLoopbackRequest(headers({})) === false, "a missing Host header is rejected");
        }
    } finally {
        restore();
    }

    return passed;
}
